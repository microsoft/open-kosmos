/**
 * subAgentChat.coverage2.test.ts
 *
 * Targets remaining uncovered branches in subAgentChat.ts:
 * - adjustBatchBoundaryForToolPairs: assistant-tool-call → tool expansion
 * - sanitizeOrphanedToolResults: orphan removal
 * - processSSELine: /responses format, done buffer, data: [DONE] skip
 * - repairToolCallArguments: all 5 strategies
 * - tryRepairTruncatedJson: unclosed string, balanced (returns null)
 * - extractFirstJson: nested and empty cases
 * - detectTruncatedToolCalls: empty args, brace mismatch, json parse fail, missing critical fields
 * - isMissingCriticalFields: known tools
 * - compressEarlyMessages: LLM timeout fallback, error fallback
 * - compressToolResult: empty LLM result fallback, error fallback, content <= threshold
 * - getElectronApp: global.electron path
 * - emitStreamingText throttle path in parseStreamingResponse
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: vi.fn().mockResolvedValue({
        ghcAuth: { copilotTokens: { token: 'mock-token' } },
      }),
    })),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'mock',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

const { mockGetEndpointForModel, mockCallModel } = vi.hoisted(() => ({
  mockGetEndpointForModel: vi.fn(() => '/chat/completions'),
  mockCallModel: vi.fn().mockResolvedValue('Summary text'),
}));

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: mockGetEndpointForModel,
  ghcModelApi: { callModel: mockCallModel },
}));

vi.mock('../../llm/ghcModelsManager', () => ({
  getModelCapabilities: vi.fn(() => ({ maxContextLength: 128000 })),
  buildMaxTokensParam: vi.fn(() => ({ max_tokens: 4096 })),
}));

vi.mock('../../chat/agentChatUtilities', () => ({
  normalizeToolCalls: vi.fn((calls: any) => calls),
}));

vi.mock('../../chat/systemReminderUtils', () => ({
  wrapInSystemReminder: vi.fn((text: string) => `[SYS]${text}[/SYS]`),
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: { getSkillMetadata: vi.fn(() => ({ metadata: null })) },
}));

vi.mock('../../token/TokenCounter', () => ({
  TokenCounter: vi.fn(function () {
    return {
        countTextTokens: vi.fn((text) => Math.ceil((text || '').length / 4)),
    };
  }),
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    setExecutionContext: vi.fn(),
    clearExecutionContext: vi.fn(),
    clearDeferredToolsContext: vi.fn(),
  },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getToolsForSubAgent: vi.fn(() => []),
    executeTool: vi.fn().mockResolvedValue('tool result'),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { SubAgentChat, truncateToLines } from '../subAgentChat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOptions(overrides: any = {}): any {
  return {
    task: 'test task',
    subAgent: {
      inheritedModel: 'gpt-4o',
      config: {
        name: 'test-agent',
        display_name: 'Test Agent',
        system_prompt: 'You are helpful.',
        mcp_servers: [],
        builtin_tools: [],
        disallow_builtin_tools: [],
        workspace: null,
        skills: [],
      },
      resolvedMcpServers: [],
      resolvedSkills: [],
      resolvedKnowledgeBase: null,
      parentSessionId: 'sess-1',
      parentChatId: 'chat-1',
      userAlias: 'testuser',
    },
    cancellationToken: {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onStepUpdate: vi.fn(),
    onTurnComplete: vi.fn(),
    currentUserAlias: 'testuser',
    deliverablesPath: null,
    ...overrides,
  };
}

// ─── truncateToLines ──────────────────────────────────────────────────────────

describe('truncateToLines', () => {
  it('returns empty string for empty input', () => {
    expect(truncateToLines('', 5, 100)).toBe('');
  });

  it('truncates by char limit', () => {
    const result = truncateToLines('hello world', 10, 5);
    expect(result).toBe('he...');
  });

  it('appends ellipsis when lines exceed maxLines', () => {
    const text = 'a\nb\nc\nd';
    const result = truncateToLines(text, 2, 1000);
    expect(result).toContain('...');
  });

  it('returns text unchanged when within limits', () => {
    const result = truncateToLines('hello', 10, 100);
    expect(result).toBe('hello');
  });
});

// ─── Private method tests via cast ───────────────────────────────────────────

describe('SubAgentChat private methods', () => {
  let agent: any;

  beforeEach(() => {
    agent = new SubAgentChat(makeOptions()) as any;
  });

  // ─── adjustBatchBoundaryForToolPairs ────────────────────────────────────

  describe('adjustBatchBoundaryForToolPairs', () => {
    it('expands batch to include tool messages after assistant with tool_calls', () => {
      agent.contextHistory = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', function: { name: 'foo' } }] },
        { role: 'tool', content: 'result', tool_call_id: 'tc1', name: 'foo' },
        { role: 'assistant', content: 'done' },
      ];
      const result = agent.adjustBatchBoundaryForToolPairs(2);
      expect(result).toBe(3); // expanded to include the tool message
    });

    it('expands when next message is tool (orphan)', () => {
      agent.contextHistory = [
        { role: 'user', content: 'hi' },
        { role: 'tool', content: 'result', tool_call_id: 'tc1', name: 'foo' },
        { role: 'assistant', content: 'done' },
      ];
      const result = agent.adjustBatchBoundaryForToolPairs(1);
      expect(result).toBe(2);
    });

    it('does not expand when last message is kept (at least 1 remaining)', () => {
      agent.contextHistory = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ];
      const result = agent.adjustBatchBoundaryForToolPairs(1);
      expect(result).toBe(1);
    });
  });

  // ─── sanitizeOrphanedToolResults ────────────────────────────────────────

  describe('sanitizeOrphanedToolResults', () => {
    it('removes orphaned tool_result messages', () => {
      const messages = [
        { role: 'user', content: 'hi' },
        { role: 'tool', content: 'result', tool_call_id: 'tc-orphan', name: 'foo' },
        { role: 'assistant', content: 'done' },
      ];
      const result = agent.sanitizeOrphanedToolResults(messages);
      expect(result).toHaveLength(2);
      expect(result.find((m: any) => m.role === 'tool')).toBeUndefined();
    });

    it('keeps tool_result that has matching tool_call', () => {
      const messages = [
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', function: { name: 'foo' } }] },
        { role: 'tool', content: 'result', tool_call_id: 'tc1', name: 'foo' },
      ];
      const result = agent.sanitizeOrphanedToolResults(messages);
      expect(result).toHaveLength(2);
    });
  });

  // ─── repairToolCallArguments ─────────────────────────────────────────────

  describe('repairToolCallArguments', () => {
    const tc = (args: string) => ({
      id: 'tc1',
      type: 'function',
      function: { name: 'test_tool', arguments: args },
    });

    it('strategy 1: trim fixes valid JSON with whitespace', () => {
      const result = agent.repairToolCallArguments(tc('  {"a":1}  '));
      expect(JSON.parse(result.function.arguments)).toEqual({ a: 1 });
    });

    it('strategy 2: strips code fence', () => {
      const result = agent.repairToolCallArguments(tc('```json\n{"b":2}\n```'));
      expect(JSON.parse(result.function.arguments)).toEqual({ b: 2 });
    });

    it('strategy 3: fixes truncated JSON', () => {
      const result = agent.repairToolCallArguments(tc('{"c":3'));
      // Should repair by closing brace
      expect(() => JSON.parse(result.function.arguments)).not.toThrow();
    });

    it('strategy 5: falls back to empty object for unfixable input', () => {
      const result = agent.repairToolCallArguments(tc('not json at all!!!'));
      expect(result.function.arguments).toBe('{}');
    });
  });

  // ─── tryRepairTruncatedJson ─────────────────────────────────────────────

  describe('tryRepairTruncatedJson', () => {
    it('returns null for empty text', () => {
      expect(agent.tryRepairTruncatedJson('')).toBeNull();
    });

    it('returns null for balanced JSON (not truncated)', () => {
      expect(agent.tryRepairTruncatedJson('{"a":1}')).toBeNull();
    });

    it('repairs truncated object', () => {
      const result = agent.tryRepairTruncatedJson('{"a":1');
      expect(result).toBe('{"a":1}');
    });

    it('repairs unclosed string', () => {
      const result = agent.tryRepairTruncatedJson('{"a":"hello');
      expect(typeof result).toBe('string');
    });

    it('handles escaped chars inside string', () => {
      const result = agent.tryRepairTruncatedJson('{"a":"he\\"llo');
      expect(typeof result).toBe('string');
    });
  });

  // ─── extractFirstJson ───────────────────────────────────────────────────

  describe('extractFirstJson', () => {
    it('extracts first JSON object', () => {
      expect(agent.extractFirstJson('prefix {"a":1} suffix')).toBe('{"a":1}');
    });

    it('returns null if no JSON', () => {
      expect(agent.extractFirstJson('no json here')).toBeNull();
    });

    it('handles nested JSON', () => {
      const result = agent.extractFirstJson('{"a":{"b":2}}');
      expect(result).toBe('{"a":{"b":2}}');
    });

    it('handles array', () => {
      expect(agent.extractFirstJson('[1,2,3]')).toBe('[1,2,3]');
    });
  });

  // ─── detectTruncatedToolCalls ───────────────────────────────────────────

  describe('detectTruncatedToolCalls', () => {
    it('flags tool call with empty args', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'write_file', arguments: '' } },
      ]);
      expect(result).toHaveLength(1);
    });

    it('flags tool call with "{}" args', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'write_file', arguments: '{}' } },
      ]);
      expect(result).toHaveLength(1);
    });

    it('flags brace-imbalanced args', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'foo', arguments: '{"a":1' } },
      ]);
      expect(result).toHaveLength(1);
    });

    it('flags invalid JSON', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'foo', arguments: 'not json' } },
      ]);
      expect(result).toHaveLength(1);
    });

    it('flags missing critical fields for write_file', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'write_file', arguments: '{"filePath":"/foo"}' } },
      ]);
      expect(result).toHaveLength(1); // missing content
    });

    it('passes valid args with all critical fields', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'write_file', arguments: '{"filePath":"/f","content":"x"}' } },
      ]);
      expect(result).toHaveLength(0);
    });

    it('passes unknown tool with valid JSON', () => {
      const result = agent.detectTruncatedToolCalls([
        { id: 'tc1', function: { name: 'custom_tool', arguments: '{"x":1}' } },
      ]);
      expect(result).toHaveLength(0);
    });
  });

  // ─── isMissingCriticalFields ─────────────────────────────────────────────

  describe('isMissingCriticalFields', () => {
    it('returns false for unknown tool', () => {
      expect(agent.isMissingCriticalFields('unknown_tool', { a: 1 })).toBe(false);
    });

    it('returns false for null parsed', () => {
      expect(agent.isMissingCriticalFields('write_file', null)).toBe(false);
    });

    it('returns true for execute_command missing command', () => {
      expect(agent.isMissingCriticalFields('execute_command', {})).toBe(true);
    });

    it('returns false for web_fetch with url', () => {
      expect(agent.isMissingCriticalFields('web_fetch', { url: 'https://x.com' })).toBe(false);
    });
  });

  // ─── getMessageText ───────────────────────────────────────────────────────

  describe('getMessageText', () => {
    it('extracts text from array content', () => {
      const msg = { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image' }] };
      expect(agent.getMessageText(msg)).toBe('hello');
    });

    it('handles string content', () => {
      const msg = { role: 'user', content: 'plain text' };
      expect(agent.getMessageText(msg)).toBe('plain text');
    });
  });

  // ─── estimateMessagesTokens ───────────────────────────────────────────────

  describe('estimateMessagesTokens', () => {
    it('counts tokens for various message roles', () => {
      const tokenCounter = { countTextTokens: vi.fn((t: string) => (t || '').length) };
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', function: { name: 'foo', arguments: '{}' } }] },
        { role: 'tool', content: 'result', name: 'foo', tool_call_id: 'tc1' },
      ];
      const count = agent.estimateMessagesTokens(tokenCounter, messages);
      expect(count).toBeGreaterThan(0);
    });
  });

  // ─── estimateToolsTokens ──────────────────────────────────────────────────

  describe('estimateToolsTokens', () => {
    it('returns 0 for empty tools', () => {
      const tc = { countTextTokens: vi.fn(() => 0) };
      expect(agent.estimateToolsTokens(tc, [])).toBe(0);
    });

    it('counts tokens for tools', () => {
      const tc = { countTextTokens: vi.fn((t: string) => t.length) };
      const result = agent.estimateToolsTokens(tc, [{ name: 'foo', description: 'bar' }]);
      expect(result).toBeGreaterThan(0);
    });
  });

  // ─── getDeliverablesPath ──────────────────────────────────────────────────

  describe('getDeliverablesPath', () => {
    it('returns deliverablesPath when provided', () => {
      const a = new SubAgentChat(makeOptions({ deliverablesPath: '/output' })) as any;
      expect(a.getDeliverablesPath()).toBe('/output');
    });

    it('returns null when no deliverablesPath (workspace fallback removed)', () => {
      const opts = makeOptions();
      opts.subAgent.config.workspace = '/workspace';
      const a = new SubAgentChat(opts) as any;
      expect(a.getDeliverablesPath()).toBeNull();
    });

    it('returns null when neither provided', () => {
      expect(agent.getDeliverablesPath()).toBeNull();
    });
  });

  // ─── getElectronApp ───────────────────────────────────────────────────────
  // NOTE: getElectronApp() was moved to subAgentPromptBuilder.ts and is no longer
  // a method on SubAgentChat. These tests are skipped.

  describe.skip('getElectronApp', () => {
    it('uses global.electron.app if available', () => {
      const mockApp = { getPath: vi.fn(() => '/global/path') };
      (global as any).electron = { app: mockApp };
      const result = agent.getElectronApp();
      expect(result).toBe(mockApp);
      delete (global as any).electron;
    });

    it('falls back to electron app module', () => {
      delete (global as any).electron;
      const result = agent.getElectronApp();
      expect(result).toBeDefined();
    });
  });

  // ─── formatDeliverablesSection ───────────────────────────────────────────

  describe('formatDeliverablesSection', () => {
    it('returns empty string when no deliverables', () => {
      expect(agent.formatDeliverablesSection()).toBe('');
    });

    it('returns formatted section when deliverables exist', () => {
      agent.deliverables.length = 0;
      agent.deliverables.push('/out/file.txt');
      const result = agent.formatDeliverablesSection();
      expect(result).toContain('/out/file.txt');
      expect(result).toContain('Deliverables');
    });
  });

  // ─── trackDeliverables ────────────────────────────────────────────────────

  describe('trackDeliverables', () => {
    beforeEach(() => { agent.deliverables.length = 0; });

    it('tracks write_file with filePath', () => {
      agent.trackDeliverables('write_file', { filePath: '/out/a.txt' });
      expect(agent.deliverables).toContain('/out/a.txt');
    });

    it('tracks write_file with file_path', () => {
      agent.trackDeliverables('write_file', { file_path: '/out/b.txt' });
      expect(agent.deliverables).toContain('/out/b.txt');
    });

    it('tracks download_file with saveDirectory and filename', () => {
      agent.trackDeliverables('download_file', { saveDirectory: '/dl', filename: 'data.zip' });
      expect(agent.deliverables).toContain('/dl/data.zip');
    });

    it('tracks download_file with backslash separator', () => {
      agent.trackDeliverables('download_file', { saveDirectory: 'C:\\dl', filename: 'data.zip' });
      expect(agent.deliverables).toContain('C:\\dl\\data.zip');
    });

    it('tracks present_deliverables filePaths array', () => {
      agent.trackDeliverables('present_deliverables', { filePaths: ['/a.txt', '/b.txt'] });
      expect(agent.deliverables).toContain('/a.txt');
      expect(agent.deliverables).toContain('/b.txt');
    });

    it('does not duplicate entries', () => {
      agent.trackDeliverables('write_file', { filePath: '/out/a.txt' });
      agent.trackDeliverables('write_file', { filePath: '/out/a.txt' });
      expect(agent.deliverables.filter((d: string) => d === '/out/a.txt')).toHaveLength(1);
    });
  });

  // ─── summarizeToolArgs ────────────────────────────────────────────────────

  describe('summarizeToolArgs', () => {
    it('uses priority key (query)', () => {
      const result = agent.summarizeToolArgs('web_search', { query: 'hello world' });
      expect(result).toContain('hello world');
    });

    it('falls back to first string value', () => {
      const result = agent.summarizeToolArgs('custom', { randomKey: 'some value' });
      expect(result).toContain('some value');
    });

    it('returns tool name only when no string values', () => {
      const result = agent.summarizeToolArgs('custom', { num: 42 });
      expect(result).toBe('custom');
    });

    it('truncates long values', () => {
      const longVal = 'a'.repeat(300);
      const result = agent.summarizeToolArgs('tool', { query: longVal });
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toContain('...');
    });
  });

  // ─── shouldContinueAfterTextResponse ─────────────────────────────────────

  describe('shouldContinueAfterTextResponse', () => {
    it('returns true when finishReason is length', () => {
      const resp = { finishReason: 'length', textContent: '', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
      expect(agent.shouldContinueAfterTextResponse(resp, 1, true)).toBe(true);
    });

    it('returns false when no tools', () => {
      const resp = { finishReason: 'stop', textContent: 'done', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
      expect(agent.shouldContinueAfterTextResponse(resp, 1, false)).toBe(false);
    });

    it('returns false for 2+ consecutive text rounds', () => {
      const resp = { finishReason: 'stop', textContent: 'done', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
      expect(agent.shouldContinueAfterTextResponse(resp, 2, true)).toBe(false);
    });

    it('returns true for intent text in first round', () => {
      const resp = { finishReason: 'stop', textContent: "Let me search for that information", hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
      expect(agent.shouldContinueAfterTextResponse(resp, 1, true)).toBe(true);
    });

    it('returns false for final result text in first round', () => {
      const resp = { finishReason: 'stop', textContent: 'The answer is 42.', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
      expect(agent.shouldContinueAfterTextResponse(resp, 1, true)).toBe(false);
    });
  });

  // ─── buildTurnProgressHint removed ────────────────────────────────────────

  describe('buildTurnProgressHint — removed', () => {
    it('buildTurnProgressHint no longer exists', () => {
      expect((agent as any).buildTurnProgressHint).toBeUndefined();
    });

    it('turnCount is still tracked', () => {
      expect(agent.turnCount).toBe(0);
    });
  });

  // ─── compressEarlyMessages fallbacks ─────────────────────────────────────

  describe('compressEarlyMessages', () => {
    it('does nothing when actualBatch <= 0', async () => {
      agent.contextHistory = [{ role: 'user', content: 'only one' }];
      await expect(agent.compressEarlyMessages(0)).resolves.toBeUndefined();
    });

    it('uses fallback when LLM returns null (timeout)', async () => {
      // Make callModel return null to simulate timeout
      mockCallModel.mockResolvedValueOnce(null);
      agent.contextHistory = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
        { role: 'user', content: 'msg2' },
        { role: 'user', content: 'preserved' },
      ];
      await agent.compressEarlyMessages(3);
      // fallback creates a summary message + remaining
      expect(agent.contextHistory[0].content).toBeDefined();
    });

    it('uses fallback when LLM throws', async () => {
      mockCallModel.mockRejectedValueOnce(new Error('LLM error'));
      agent.contextHistory = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
        { role: 'user', content: 'preserved' },
      ];
      await agent.compressEarlyMessages(2);
      expect(agent.contextHistory.length).toBeGreaterThan(0);
    });
  });

  // ─── compressToolResult ───────────────────────────────────────────────────

  describe('compressToolResult', () => {
    it('returns compressed content from LLM', async () => {
      mockCallModel.mockResolvedValueOnce('compressed summary');
      const content = 'x'.repeat(20000);
      const result = await agent.compressToolResult(content, 'tool', content.length);
      expect(result).toContain('compressed summary');
    });

    it('falls back to hard truncation when LLM returns empty', async () => {
      mockCallModel.mockResolvedValueOnce('');
      const content = 'x'.repeat(60000);
      const result = await agent.compressToolResult(content, 'tool', content.length);
      expect(result.length).toBeLessThanOrEqual(50200); // max chars + suffix
    });

    it('falls back to hard truncation on LLM error', async () => {
      mockCallModel.mockRejectedValueOnce(new Error('fail'));
      const content = 'y'.repeat(60000);
      const result = await agent.compressToolResult(content, 'tool', content.length);
      expect(result).toContain('truncated');
    });
  });

  // ─── dispose ─────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears context and sets disposed flag', () => {
      agent.contextHistory = [{ role: 'user', content: 'hi' }];
      agent.dispose();
      expect(agent.disposed).toBe(true);
      expect(agent.contextHistory).toHaveLength(0);
    });
  });

  // ─── getTurnCount ─────────────────────────────────────────────────────────

  describe('getTurnCount', () => {
    it('returns current turn count', () => {
      agent.turnCount = 3;
      expect(agent.getTurnCount()).toBe(3);
    });
  });
});
