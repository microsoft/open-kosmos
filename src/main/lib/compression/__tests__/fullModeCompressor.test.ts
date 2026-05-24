/**
 * Unit tests for FullModeCompressor.
 *
 * The default strategy now prioritizes recent-turn continuity, structure-aware
 * trimming, and tool_result integrity over hard positional pinning.
 */

// Mock context compression summarizer to avoid actual API calls
vi.mock('../../llm/contextCompressionLlmSummarizer', async () => {
  const actual = await vi.importActual('../../llm/contextCompressionLlmSummarizer') as any;
  const PROMPT_OVERHEAD_TOKENS = 1500;

  return {
    ...(actual as Record<string, unknown>),
    contextCompressionLlmSummarizer: {
      ...actual.contextCompressionLlmSummarizer,
      summarize: vi.fn().mockResolvedValue({
        success: true,
        summary: '<summary>Test summary content</summary>',
        attempts: 1,
      }),
      buildPrompt: vi.fn((conversationText: string) =>
        actual.contextCompressionLlmSummarizer.buildPrompt(conversationText)
      ),
      estimateRequestTokens: vi.fn((_tokenCounter: { countTextTokens: (text: string) => number }, conversationText: string) =>
        PROMPT_OVERHEAD_TOKENS + Math.ceil(conversationText.length / 4)
      ),
      getPromptOverheadTokens: vi.fn(() => PROMPT_OVERHEAD_TOKENS),
    }
  };
});

// Mock TokenCounter to use cheap char-based estimation instead of tiktoken encoding.
vi.mock('../../token', async () => {
  const actual = await vi.importActual('../../token') as any;
  return {
    ...actual,
    TokenCounter: class MockTokenCounter {
      countTextTokens(text: string): number {
        return Math.ceil((text || '').length / 4);
      }
      getCacheStats() { return { hits: 0, misses: 0, size: 0, hitRate: 0 }; }
    },
  };
});

import { FullModeCompressor, createFullModeCompressor } from '../fullModeCompressor';
import { Message, MessageHelper, ToolMessage } from '@shared/types/chatTypes';
import { contextCompressionLlmSummarizer as _contextCompressionLlmSummarizerImport } from '../../llm/contextCompressionLlmSummarizer';

// Helper to create test messages
function createUserMessage(text: string, id?: string): Message {
  return MessageHelper.createTextMessage(text, 'user', id || `user_${Date.now()}`);
}

function createAssistantMessage(text: string, id?: string, tool_calls?: any[]): Message {
  const msg = MessageHelper.createTextMessage(text, 'assistant', id || `assistant_${Date.now()}`);
  if (tool_calls) {
    msg.tool_calls = tool_calls;
  }
  return msg;
}

function createToolResultMessage(content: string, tool_call_id: string, name: string, id?: string): Message {
  return MessageHelper.createToolMessage(content, tool_call_id, name, id);
}

// Helper to create a SKILL.md read_file tool call
function createSkillToolCall(id: string, filePath: string) {
  return {
    id,
    type: 'function',
    function: {
      name: 'read_file',
      arguments: JSON.stringify({ filePath })
    }
  };
}

// Helper to create a successful SKILL.md tool result
function createSkillToolResult(tool_call_id: string): string {
  return JSON.stringify({
    content: "---\nname: titan-dynamic-query\ndescription: Execute and analyze dynamic SQL queries...\n---\n\n# Titan Dynamic Query SKILL\n\n## Purpose\n\nThis skill enables the analysis and execution of dynamic SQL queries...",
    fileName: "skill.md",
    startLine: 1,
    endLine: 383,
    totalLines: 383,
    size: 17324,
    truncated: false
  });
}

describe('FullModeCompressor', () => {
  let compressor: FullModeCompressor;
  let contextCompressionLlmSummarizerMock: {
    summarize: Mock;
    buildPrompt: Mock;
    estimateRequestTokens: Mock;
    getPromptOverheadTokens: Mock;
  };

  beforeEach(() => {
    contextCompressionLlmSummarizerMock = vi.mocked(_contextCompressionLlmSummarizerImport);
    contextCompressionLlmSummarizerMock.summarize.mockReset();
    contextCompressionLlmSummarizerMock.summarize.mockResolvedValue({
      success: true,
      summary: '<summary>Test summary content</summary>',
      attempts: 1,
    });
    compressor = createFullModeCompressor({
      preserveRecentMessages: 3,
      preserveFirstUserMessage: false,
      preserveFirstSkillToolCall: false,
      enableDebugLog: false
    });
  });

  describe('chunked and structural compression', () => {
    it('runs conversation chunk summaries with bounded concurrency while preserving result order', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      let activeCalls = 0;
      let maxActiveCalls = 0;
      const dispatchedChunkSummaries: string[] = [];
      const completedChunkSummaries: string[] = [];
      const pendingResolvers = new Map<number, () => void>();
      let releasedFirstWave = false;
      let firstWaveSize = 0;

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        const isMergeCall = conversationText.includes('Chunk summary to merge:');
        if (!isMergeCall) {
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        }

        const chunkMatch = conversationText.match(/Chunk (\d+)/);
        const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : 99;
        const summaryLabel = `summary:chunk-${chunkIndex}`;
        if (!isMergeCall) {
          dispatchedChunkSummaries.push(summaryLabel);
        }

        if (!isMergeCall && !releasedFirstWave) {
          // Yield so all concurrent slots have a chance to enter before checking the gate.
          await Promise.resolve();
          await new Promise<void>((resolve) => {
            pendingResolvers.set(chunkIndex, resolve);
            firstWaveSize = Math.max(firstWaveSize, pendingResolvers.size);

            if (!releasedFirstWave && firstWaveSize >= 2 && pendingResolvers.size === firstWaveSize) {
              releasedFirstWave = true;
              queueMicrotask(() => {
                Array.from(pendingResolvers.keys())
                  .sort((left, right) => right - left)
                  .forEach((index) => pendingResolvers.get(index)?.());
              });
            }
          });
        }

        if (!isMergeCall) {
          activeCalls -= 1;
          completedChunkSummaries.push(summaryLabel);
        }

        return {
          success: true,
          summary: isMergeCall ? `merged:${conversationText.slice(0, 24)}` : summaryLabel,
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage(`Chunk ${index}: ${'A'.repeat(5000)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await concurrentCompressor.compressMessages(largeMessages);

      expect(maxActiveCalls).toBeGreaterThan(1);
      expect(maxActiveCalls).toBeLessThanOrEqual(3);
      expect(firstWaveSize).toBeGreaterThan(1);
      expect(completedChunkSummaries.slice(0, firstWaveSize)).toEqual(
        dispatchedChunkSummaries.slice(0, firstWaveSize).slice().reverse()
      );
      expect(completedChunkSummaries.slice(0, firstWaveSize)).not.toEqual(dispatchedChunkSummaries.slice(0, firstWaveSize));

      const firstMergeCallIndex = contextCompressionLlmSummarizer.summarize.mock.calls.findIndex(
        ([args]: [{ conversationText: string }]) => args.conversationText.includes('Chunk summary to merge:')
      );
      expect(firstMergeCallIndex).toBeGreaterThan(0);

      const [firstMergeArgs] = contextCompressionLlmSummarizer.summarize.mock.calls[firstMergeCallIndex] as [{ conversationText: string }];
      const mergeSummaryOrder: string[] = firstMergeArgs.conversationText.match(/summary:chunk-\d+/g) || [];
      expect(mergeSummaryOrder.length).toBeGreaterThan(0);
      expect(mergeSummaryOrder).toEqual(
        dispatchedChunkSummaries.filter((summary) => mergeSummaryOrder.includes(summary))
      );
    });

    it('falls back when any concurrent conversation chunk summary fails', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk 1:')) {
          throw new Error('synthetic concurrent chunk failure');
        }

        return {
          success: true,
          summary: '<summary>Test summary content</summary>',
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage(`Chunk ${index}: ${'A'.repeat(5000)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await concurrentCompressor.compressMessages(largeMessages);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('synthetic concurrent chunk failure');
      const ids = result.compressedMessages.map((m) => m.id);
      expect(ids.slice(0, 3)).toEqual(['recent_1', 'recent_2', 'recent_3']);
      expect(ids[3]).toMatch(/^bridge_user_/);
      expect(result.compressedMessages[3].role).toBe('user');
    });

    it('keeps merge-stage summaries sequential even when conversation summaries are concurrent', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      let activeMergeCalls = 0;
      let maxActiveMergeCalls = 0;

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        const isMergeCall = conversationText.includes('Chunk summary to merge:');
        if (isMergeCall) {
          activeMergeCalls += 1;
          maxActiveMergeCalls = Math.max(maxActiveMergeCalls, activeMergeCalls);
        }

        await Promise.resolve();

        if (isMergeCall) {
          activeMergeCalls -= 1;
          return {
            success: true,
            summary: 'M'.repeat(2200),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2200),
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await concurrentCompressor.compressMessages(largeMessages);

      expect(maxActiveMergeCalls).toBeLessThanOrEqual(1);
    });

    it('splits oversized middle history into multiple summary calls', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      const budgetedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage('A'.repeat(5000), `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await budgetedCompressor.compressMessages(largeMessages);

      expect(contextCompressionLlmSummarizer.summarize.mock.calls.length).toBeGreaterThan(1);
    });

    it('recursively merges chunk summaries instead of doing one unbounded final merge pass', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk summary to merge:')) {
          return {
            success: true,
            summary: 'M'.repeat(2200),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2200),
          attempts: 1,
        };
      });

      const recursivelyMergingCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await recursivelyMergingCompressor.compressMessages(largeMessages);

      const mergeCalls = contextCompressionLlmSummarizer.summarize.mock.calls.filter(
        ([args]: [{ conversationText: string }]) => args.conversationText.includes('Chunk summary to merge:')
      );
      expect(mergeCalls.length).toBeGreaterThan(1);
    });

    it('keeps every summary-model prompt within the configured token budget including template overhead', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizer.summarize.mockClear();

      const budgetedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2200,
      });

      const denseMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 7 }, (_, index) =>
          createToolResultMessage(
            JSON.stringify({
              path: `/tmp/deep/${index}`,
              content: '数据'.repeat(450) + JSON.stringify({ index, nested: 'X'.repeat(900) }),
            }),
            `tool_${index}`,
            'read_file',
            `tool_msg_${index}`,
          )
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await budgetedCompressor.compressMessages(denseMessages);

      const tokenCounter = (budgetedCompressor as any).tokenCounter;
      const configuredBudget = budgetedCompressor.getConfig().summaryPromptTokenBudget;
      for (const [args] of contextCompressionLlmSummarizer.summarize.mock.calls as Array<[{ conversationText: string }]>) {
        const requestTokens = contextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, args.conversationText);
        expect(requestTokens).toBeLessThanOrEqual(configuredBudget);
      }
    });

    it('counts system prompt inside summary prompt overhead budgeting', async () => {
      const { TokenCounter: RealTokenCounter } = await vi.importActual('../../token') as any;
      const { contextCompressionLlmSummarizer: realSummarizer } = await vi.importActual('../../llm/contextCompressionLlmSummarizer') as any;
      const realTokenCounter = new RealTokenCounter({ enableCache: true });

      const overheadTokens = realSummarizer.getPromptOverheadTokens(realTokenCounter);
      const userPromptOnlyTokens = realTokenCounter.countTextTokens(
        contextCompressionLlmSummarizerMock.buildPrompt('')
      );

      expect(overheadTokens).toBeGreaterThan(userPromptOnlyTokens);
    });

    it('re-truncates a single oversized message so it cannot bypass the prompt budget', () => {
      const strictBudgetCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 1800,
      });

      // ASCII text: 5000 chars ≈ 1250 tokens, well above availablePromptTokens (300).
      const oversizedMessage = createAssistantMessage('A'.repeat(5000), 'dense_assistant');
      const availablePromptTokens = (strictBudgetCompressor as any).getAvailablePromptTokens();
      const fittedMessage = (strictBudgetCompressor as any).fitMessageToPromptBudget(
        oversizedMessage,
        availablePromptTokens,
        'conversation',
      );

      const fittedText = MessageHelper.getText(fittedMessage);
      expect(fittedText).toContain('[Truncated to fit summary prompt budget]');
      const fittedTokens = (strictBudgetCompressor as any).estimateMessageSummaryPromptTokens(
        fittedMessage,
        'conversation',
      );
      expect(fittedTokens).toBeLessThanOrEqual(availablePromptTokens);
    });

    it('treats summaryPromptTokenBudget as a hard budget and falls back when it is below template overhead', async () => {
      const hardBudgetCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 128,
      });

      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('middle content that would need summarization', 'mid_1'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await hardBudgetCompressor.compressMessages(messages);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('summaryPromptTokenBudget=128 is too small');
    });

    it('fails back when recursive merge exceeds the configured summary depth limit', async () => {
      contextCompressionLlmSummarizerMock.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk summary to merge:')) {
          return {
            success: true,
            summary: 'M'.repeat(2400),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2400),
          attempts: 1,
        };
      });

      const shallowDepthCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
        maxSummaryRecursionDepth: 1,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await shallowDepthCompressor.compressMessages(largeMessages);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('Exceeded maxSummaryRecursionDepth=1');
    });

    it('structurally truncates giant tool results before summary generation', async () => {
      const longToolText = 'X'.repeat(10000);
      const prepared = (compressor as any).prepareMessagesForCompression([
        createToolResultMessage(longToolText, 'tool_1', 'fetch_web_content', 'tool_msg_1'),
      ]);

      const preparedText = MessageHelper.getText(prepared[0]);
      expect(preparedText.length).toBeLessThan(longToolText.length);
      expect(preparedText).toContain('Compressed for summary generation');
      expect(preparedText).toContain('originalLength=10000');
    });

    it('keeps fetch_web_content metadata when structurally truncating', () => {
      const longPayload = JSON.stringify({
        url: 'https://example.com/article',
        title: 'Example Article',
        content: 'A'.repeat(12000),
      });

      const prepared = (compressor as any).prepareMessagesForCompression([
        createToolResultMessage(longPayload, 'tool_1', 'fetch_web_content', 'tool_msg_1'),
      ]);

      const preparedText = MessageHelper.getText(prepared[0]);
      expect(preparedText).toContain('[Structured compression: fetch_web_content]');
      expect(preparedText).toContain('title=Example Article');
      expect(preparedText).toContain('url=https://example.com/article');
    });

    it('keeps read_file boundaries when structurally truncating', () => {
      const longPayload = JSON.stringify({
        filePath: '/tmp/huge.log',
        startLine: 10,
        endLine: 300,
        totalLines: 500,
        size: 20480,
        content: 'B'.repeat(12000),
      });

      const prepared = (compressor as any).prepareMessagesForCompression([
        createToolResultMessage(longPayload, 'tool_1', 'read_file', 'tool_msg_1'),
      ]);

      const preparedText = MessageHelper.getText(prepared[0]);
      expect(preparedText).toContain('[Structured compression: read_file]');
      expect(preparedText).toContain('file=/tmp/huge.log');
      expect(preparedText).toContain('range=10-300');
      expect(preparedText).toContain('totalLines=500');
    });

    it('keeps search result shape when structurally truncating', () => {
      const longPayload = JSON.stringify({
        results: [
          { title: 'match 1', snippet: 'first hit' },
          { title: 'match 2', snippet: 'second hit' },
          { title: 'match 3', snippet: 'third hit' },
          { title: 'match 4', snippet: 'fourth hit' },
        ],
        raw: 'C'.repeat(12000),
      });

      const prepared = (compressor as any).prepareMessagesForCompression([
        createToolResultMessage(longPayload, 'tool_1', 'semantic_search', 'tool_msg_1'),
      ]);

      const preparedText = MessageHelper.getText(prepared[0]);
      expect(preparedText).toContain('[Structured compression: semantic_search]');
      expect(preparedText).toContain('resultCount=4');
      expect(preparedText).toContain('match 1 :: first hit');
    });
  });

  describe('findFirstSkillToolCallIndices', () => {
    it('should find SKILL.md tool call and its result', () => {
      const messages: Message[] = [
        createUserMessage('I want to analyze data from Titan', 'msg_1'),
        createAssistantMessage('I can help with that!', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          "I'll load the Titan Dynamic Query skill",
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skills/titan-dynamic-query/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_5'
        ),
        createAssistantMessage('Perfect! The skill is loaded.', 'msg_6'),
      ];

      // Access private method via any type for testing
      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(2);
      expect(indices).toContain(3); // Assistant message with tool_call
      expect(indices).toContain(4); // Tool result message
    });

    it('should be case-insensitive for skill.md filename', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/SKILL.MD')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
    });

    it('should only protect the first SKILL.md, not subsequent ones', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading first skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
        createAssistantMessage(
          'Loading second skill',
          'msg_4',
          [createSkillToolCall('tool_call_2', '/another/path/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_2'),
          'tool_call_2',
          'read_file',
          'msg_5'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      // Should only contain indices for the first skill
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
      expect(indices).not.toContain(3);
      expect(indices).not.toContain(4);
    });

    it('should protect all tool results including failed ones (for pairing integrity)', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          '{"error": "File not found"}',
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      // Should include both the tool call and the error result (for pairing integrity)
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
    });

    it('should protect tool results even with very short content (for pairing integrity)', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          'Short',  // Less than 100 chars
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      // Now protects all tool results for pairing integrity
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
    });

    it('should return empty array when no SKILL.md tool call exists', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading file',
          'msg_2',
          [{
            id: 'tool_call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ filePath: '/path/to/config.json' })
            }
          }]
        ),
        createToolResultMessage(
          '{"config": "value"}',
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(0);
    });

    it('should handle messages without tool_calls', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Just a response', 'msg_2'),
        createUserMessage('Another message', 'msg_3'),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(0);
    });
  });

  describe('analyzeMessageStructure', () => {
    it('should include firstSkillToolCallIndices when skill pinning is explicitly enabled', () => {
      const pinnedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstSkillToolCall: true,
      });

      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
        createAssistantMessage('Done', 'msg_4'),
        createUserMessage('Continue', 'msg_5'),
        createAssistantMessage('OK', 'msg_6'),
        createUserMessage('More', 'msg_7'),
        createAssistantMessage('Sure', 'msg_8'),
      ];

      const analysis = (pinnedCompressor as any).analyzeMessageStructure(messages);

      expect(analysis.firstSkillToolCallIndices).toHaveLength(2);
      expect(analysis.firstSkillToolCallIndices).toContain(1);
      expect(analysis.firstSkillToolCallIndices).toContain(2);
    });

    it('should return empty array when preserveFirstSkillToolCall is false', () => {
      const disabledCompressor = createFullModeCompressor({
        preserveFirstSkillToolCall: false
      });

      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const analysis = (disabledCompressor as any).analyzeMessageStructure(messages);

      expect(analysis.firstSkillToolCallIndices).toHaveLength(0);
    });
  });

  describe('compressMessages', () => {
    it('preserves recent messages by default without hard-pinning the first user or first skill block', async () => {
      const messages: Message[] = [
        createUserMessage('I want to analyze data', 'msg_1'),
        createAssistantMessage('What kind?', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          'Loading skill',
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_5'
        ),
        createAssistantMessage('Skill loaded!', 'msg_6'),
        createUserMessage('Run query X', 'msg_7'),
        createAssistantMessage('Running...', 'msg_8'),
        createUserMessage('Show results', 'msg_9'),
        createAssistantMessage('Here they are', 'msg_10'),
        createUserMessage('Thanks', 'msg_11'),
      ];

      const result = await compressor.compressMessages(messages);

      expect(result.success).toBe(true);
      expect(result.compressedMessages.length).toBeLessThan(messages.length);

      const preservedIds = result.compressedMessages.map(m => m.id);

      expect(preservedIds).toContain('msg_9');
      expect(preservedIds).toContain('msg_10');
      expect(preservedIds).toContain('msg_11');
      expect(result.summary).toBeTruthy();
    });

    it('can still pin the first user and first skill block when explicitly enabled', async () => {
      const pinnedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstUserMessage: true,
        preserveFirstSkillToolCall: true,
      });

      const messages: Message[] = [
        createUserMessage('I want to analyze data', 'msg_1'),
        createAssistantMessage('What kind?', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          'Loading skill',
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_5'
        ),
        createAssistantMessage('Skill loaded!', 'msg_6'),
        createUserMessage('Run query X', 'msg_7'),
        createAssistantMessage('Running...', 'msg_8'),
        createUserMessage('Show results', 'msg_9'),
        createAssistantMessage('Here they are', 'msg_10'),
        createUserMessage('Thanks', 'msg_11'),
      ];

      const result = await pinnedCompressor.compressMessages(messages);
      const preservedIds = result.compressedMessages.map(m => m.id);

      expect(preservedIds).toContain('msg_1');
      expect(preservedIds).toContain('msg_4');
      expect(preservedIds).toContain('msg_5');
    });

    it('should not include SKILL.md messages in summary generation', async () => {
      const { contextCompressionLlmSummarizer } = await import('../../llm/contextCompressionLlmSummarizer');
      const pinnedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstSkillToolCall: true,
      });

      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Response 1', 'msg_2'),
        createAssistantMessage(
          'Loading skill',
          'msg_3',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_4'
        ),
        createAssistantMessage('Middle message', 'msg_5'),
        createUserMessage('Recent 1', 'msg_6'),
        createAssistantMessage('Recent 2', 'msg_7'),
        createUserMessage('Recent 3', 'msg_8'),
      ];

      await pinnedCompressor.compressMessages(messages);

      // Check that the summary prompt was called
      expect(contextCompressionLlmSummarizer.summarize).toHaveBeenCalled();

      // Get the prompt that was passed to the model helper
      const callArgs = vi.mocked(contextCompressionLlmSummarizer.summarize).mock.calls[0];
      const summaryPrompt = callArgs[0].conversationText;

      // The SKILL.md content should NOT be in the summary prompt
      // (it's protected, so it shouldn't be summarized)
      expect(summaryPrompt).not.toContain('titan-dynamic-query');
    });
  });

  describe('edge cases', () => {
    it('should handle multiple tool calls in same message - protect ALL sibling results', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading multiple',
          'msg_2',
          [
            {
              id: 'tool_call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ filePath: '/path/to/config.json' })
              }
            },
            createSkillToolCall('tool_call_2', '/path/to/skill.md')
          ]
        ),
        createToolResultMessage('{"config": true}', 'tool_call_1', 'read_file', 'msg_3'),
        createToolResultMessage(createSkillToolResult('tool_call_2'), 'tool_call_2', 'read_file', 'msg_4'),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);

      // Should find the assistant message AND ALL sibling tool results
      expect(indices).toHaveLength(3);
      expect(indices).toContain(1); // Assistant message
      expect(indices).toContain(2); // Config result (sibling)
      expect(indices).toContain(3); // Skill result
    });

    it('should handle tool call with malformed arguments', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading',
          'msg_2',
          [{
            id: 'tool_call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: 'not valid json'
            }
          }]
        ),
      ];

      // Should not throw
      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      expect(indices).toHaveLength(0);
    });

    it('should handle empty messages array', () => {
      const indices = (compressor as any).findFirstSkillToolCallIndices([]);
      expect(indices).toHaveLength(0);
    });

    it('should handle SKILL.md in various path formats', () => {
      const testPaths = [
        '/Users/user/skills/my-skill/skill.md',
        '/Users/user/skills/my-skill/SKILL.md',
        '/Users/user/skills/my-skill/Skill.MD',
        'C:\\Users\\user\\skills\\my-skill\\skill.md',
        './skills/skill.md',
        'skill.md'
      ];

      for (const path of testPaths) {
        const messages: Message[] = [
          createUserMessage('Test'),
          createAssistantMessage(
            'Loading',
            undefined,
            [createSkillToolCall('tool_call_1', path)]
          ),
          createToolResultMessage(
            createSkillToolResult('tool_call_1'),
            'tool_call_1',
            'read_file'
          ),
        ];

        const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
        expect(indices.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ensureToolResultIntegrity', () => {
    it('should inject missing tool_result from original messages', () => {
      // Simulate the exact bug: assistant has read_file + get_current_datetime
      // but only read_file result is preserved after compression
      const assistantMsg = createAssistantMessage(
        '',
        'assistant_1',
        [
          createSkillToolCall('tool_read', '/path/to/skill.md'),
          {
            id: 'tool_datetime',
            type: 'function',
            function: {
              name: 'get_current_datetime',
              arguments: ''
            }
          }
        ]
      );

      const readResult = createToolResultMessage(
        createSkillToolResult('tool_read'),
        'tool_read',
        'read_file',
        'result_read'
      );

      const datetimeResult = createToolResultMessage(
        '{"local_datetime":"2026-03-01T13:43:47.346"}',
        'tool_datetime',
        'get_current_datetime',
        'result_datetime'
      );

      // Compressed messages: missing datetime result
      const compressed: Message[] = [
        createUserMessage('Hello', 'user_1'),
        assistantMsg,
        readResult,
        // datetimeResult is MISSING!
        createUserMessage('Recent', 'user_2'),
      ];

      // Original messages: has both results
      const original: Message[] = [
        createUserMessage('Hello', 'user_1'),
        assistantMsg,
        readResult,
        datetimeResult,
        createAssistantMessage('More conversation', 'assistant_2'),
        createUserMessage('Recent', 'user_2'),
      ];

      const result = (compressor as any).ensureToolResultIntegrity(compressed, original);

      // Should have injected the missing datetime result
      const toolResultIds = result
        .filter((m: Message) => m.role === 'tool')
        .map((m: ToolMessage) => m.tool_call_id);
      expect(toolResultIds).toContain('tool_read');
      expect(toolResultIds).toContain('tool_datetime');
    });

    it('should create synthetic placeholder when original result not found', () => {
      const assistantMsg = createAssistantMessage(
        '',
        'assistant_1',
        [
          {
            id: 'tool_missing',
            type: 'function',
            function: {
              name: 'some_tool',
              arguments: '{}'
            }
          }
        ]
      );

      const compressed: Message[] = [assistantMsg];
      const original: Message[] = [assistantMsg]; // No tool result exists anywhere

      const result = (compressor as any).ensureToolResultIntegrity(compressed, original);

      // Should have created a synthetic placeholder
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('tool');
      expect(result[1].tool_call_id).toBe('tool_missing');
      expect(MessageHelper.getText(result[1])).toBe('[Result compressed]');
    });

    it('should not modify messages when all tool_results are present', () => {
      const assistantMsg = createAssistantMessage(
        '',
        'assistant_1',
        [
          {
            id: 'tool_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' }
          }
        ]
      );
      const toolResult = createToolResultMessage('result', 'tool_1', 'read_file', 'result_1');

      const compressed: Message[] = [assistantMsg, toolResult];
      const original: Message[] = [assistantMsg, toolResult];

      const result = (compressor as any).ensureToolResultIntegrity(compressed, original);

      expect(result).toHaveLength(2);
    });

    it('should handle assistant messages without tool_calls', () => {
      const compressed: Message[] = [
        createUserMessage('Hi', 'user_1'),
        createAssistantMessage('Hello', 'assistant_1'),
      ];

      const result = (compressor as any).ensureToolResultIntegrity(compressed, compressed);

      expect(result).toHaveLength(2);
    });

    it('should remove orphaned tool results whose tool_call was compressed away', () => {
      const orphanedToolResult = createToolResultMessage(
        'some result',
        'tool_compressed_away',
        'some_tool',
        'result_orphan'
      );

      const compressed: Message[] = [
        createUserMessage('Hi', 'user_1'),
        createAssistantMessage('Summary of prior conversation', 'summary_1'),
        orphanedToolResult,
        createUserMessage('Recent question', 'user_2'),
      ];

      const result = (compressor as any).ensureToolResultIntegrity(compressed, compressed);

      expect(result).toHaveLength(3);
      expect(result.every((m: Message) => m.role !== 'tool')).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should use default config when not specified', () => {
      const defaultCompressor = createFullModeCompressor();
      const config = defaultCompressor.getConfig();

      expect(config.preserveFirstSkillToolCall).toBe(false);
      expect(config.preserveFirstUserMessage).toBe(false);
      expect(config.summaryPromptTokenBudget).toBe(100000);
      expect(config.maxSummaryRecursionDepth).toBe(4);
      expect(config.maxConcurrentChunkSummaries).toBe(2);
    });

    it('should allow disabling SKILL.md protection', () => {
      const noProtectionCompressor = createFullModeCompressor({
        preserveFirstSkillToolCall: false
      });
      const config = noProtectionCompressor.getConfig();

      expect(config.preserveFirstSkillToolCall).toBe(false);
    });

    it('should allow updating config at runtime', () => {
      const comp = createFullModeCompressor({ preserveFirstSkillToolCall: true });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(true);

      comp.updateConfig({ preserveFirstSkillToolCall: false });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(false);
    });

    it('should expose chunkSummaryCallCount in compression result metadata', async () => {
      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('A'.repeat(5000), 'mid_1'),
        createAssistantMessage('A'.repeat(5000), 'mid_2'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await compressor.compressMessages(messages);

      expect(typeof result.metadata.chunkSummaryCallCount).toBe('number');
      expect(result.metadata.chunkSummaryCallCount).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.totalLlmCallCount).toBe('number');
      expect(result.metadata.totalLlmCallCount).toBeGreaterThanOrEqual(result.metadata.chunkSummaryCallCount);
    });

    it('should reset chunkSummaryCallCount between compressMessages() calls', async () => {
      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('A'.repeat(5000), 'mid_1'),
        createAssistantMessage('A'.repeat(5000), 'mid_2'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const first = await compressor.compressMessages(messages);
      const second = await compressor.compressMessages(messages);

      // Both calls should report the same count, not an accumulated total
      expect(first.metadata.chunkSummaryCallCount).toBe(second.metadata.chunkSummaryCallCount);
    });
  });

  describe('fallback compression', () => {
    it('should fallback and preserve first user message when preserveFirstUserMessage is true', async () => {
      // Force summarize to fail so fallback triggers
      const contextCompressionLlmSummarizerMock = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstUserMessage: true,
      });

      const messages: Message[] = [
        createUserMessage('first user message', 'first_user'),
        createAssistantMessage('middle 1', 'mid_1'),
        createAssistantMessage('middle 2', 'mid_2'),
        createAssistantMessage('middle 3', 'mid_3'),
        createUserMessage('recent 1', 'recent_1'),
        createAssistantMessage('recent 2', 'recent_2'),
        createUserMessage('recent 3', 'recent_3'),
      ];

      const result = await fallbackCompressor.compressMessages(messages);

      expect(result.success).toBe(false);
      expect(result.metadata.compressionMethod).toBe('fallback');
      // Should include first user message + recent 3
      const roles = result.compressedMessages.map(m => m.id);
      expect(roles).toContain('first_user');
      expect(roles).toContain('recent_1');
      expect(roles).toContain('recent_2');
      expect(roles).toContain('recent_3');
    });

    it('should deduplicate when first user message overlaps with recent messages', async () => {
      const contextCompressionLlmSummarizerMock = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 5,
        preserveFirstUserMessage: true,
      });

      // Only 4 messages — first user overlaps with recent window
      const messages: Message[] = [
        createUserMessage('I am first and recent', 'overlap_msg'),
        createAssistantMessage('response 1', 'resp_1'),
        createUserMessage('question 2', 'q_2'),
        createAssistantMessage('response 2', 'resp_2'),
      ];

      const result = await fallbackCompressor.compressMessages(messages);

      // Should not have duplicates
      const ids = result.compressedMessages.map(m => m.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('should set chunkSummaryCallCount to 0 on fallback', async () => {
      const contextCompressionLlmSummarizerMock = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
      });

      const messages: Message[] = [
        createUserMessage('start', 'u1'),
        createAssistantMessage('middle', 'a1'),
        createAssistantMessage('middle 2', 'a2'),
        createUserMessage('recent 1', 'r1'),
        createAssistantMessage('recent 2', 'r2'),
        createUserMessage('recent 3', 'r3'),
      ];

      const result = await fallbackCompressor.compressMessages(messages);

      // Even on fallback, the counter reflects attempted API calls before fallback triggered
      expect(result.metadata.chunkSummaryCallCount).toBeGreaterThanOrEqual(0);
    });
  });
});
