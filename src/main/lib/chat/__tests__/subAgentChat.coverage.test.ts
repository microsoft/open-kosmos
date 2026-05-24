// @ts-nocheck
/**
 * SubAgentChat coverage tests
 *
 * File location: src/main/lib/chat/__tests__/subAgentChat.coverage.test.ts
 * Target: src/main/lib/subAgent/subAgentChat.ts
 *
 * Covers remaining uncovered code paths.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../subAgent/../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('../../subAgent/../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: vi.fn().mockResolvedValue({
        ghcAuth: { copilotTokens: { token: 'mock-token' } },
      }),
    })),
  },
}));

vi.mock('../../subAgent/../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'mock',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

const { mockGetEndpointForModel, mockCallModel } = vi.hoisted(() => ({
  mockGetEndpointForModel: vi.fn(() => '/chat/completions'),
  mockCallModel: vi.fn().mockResolvedValue('LLM summary'),
}));

vi.mock('../../subAgent/../llm/ghcModelApi', () => ({
  getEndpointForModel: mockGetEndpointForModel,
  ghcModelApi: { callModel: mockCallModel },
}));

vi.mock('../../subAgent/../llm/ghcModelsManager', () => ({
  getModelCapabilities: vi.fn(() => ({ maxContextLength: 128000 })),
  buildMaxTokensParam: vi.fn(() => ({ max_tokens: 4096 })),
}));

vi.mock('../../subAgent/../token/TokenCounter', () => ({
  TokenCounter: vi.fn().mockImplementation(function () {
    return { countTextTokens: vi.fn((text: string) => Math.ceil((text || '').length / 4)) };
  }),
}));

const { mockGetToolsForSubAgent, mockExecuteTool } = vi.hoisted(() => ({
  mockGetToolsForSubAgent: vi.fn().mockReturnValue([]),
  mockExecuteTool: vi.fn().mockResolvedValue('tool result'),
}));

vi.mock('../../subAgent/../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getToolsForSubAgent: (...args: any[]) => mockGetToolsForSubAgent(...args),
    executeTool: (...args: any[]) => mockExecuteTool(...args),
  },
}));

vi.mock('../../subAgent/../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    setExecutionContext: vi.fn(),
    clearExecutionContext: vi.fn(),
  },
}));

vi.mock('../../subAgent/../skill/skillManager', () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: null, error: 'Not found' })),
  },
}));

vi.mock('../../subAgent/../chat/agentChatUtilities', () => ({
  normalizeToolCalls: vi.fn((calls: any) => calls),
}));

vi.mock('../../subAgent/../chat/systemReminderUtils', () => ({
  wrapInSystemReminder: vi.fn((text: string) => text),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { SubAgentChat, truncateToLines } from '../../subAgent/subAgentChat';
import type { SubAgentChatOptions } from '../../subAgent/types';
import type { SubAgent } from '../../subAgent/types';
import type { SubAgentConfig } from '../../subAgent/../userDataADO/types/profile';
import type { CancellationToken } from '../../subAgent/../cancellation/CancellationToken';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function makeSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    display_name: 'Test Agent',
    description: 'desc',
    emoji: '🤖',
    version: '1.0',
    system_prompt: 'You are helpful.',
    mcp_servers: [],
    ...overrides,
  } as SubAgentConfig;
}

function makeSubAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    config: makeSubAgentConfig(),
    inheritedModel: 'gpt-4o',
    parentChatId: 'parent-chat',
    parentSessionId: 'parent-session',
    userAlias: 'user1',
    resolvedMcpServers: [],
    resolvedSkills: [],
    resolvedKnowledgeBase: undefined,
    taskId: 'task-1',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChatOptions {
  return {
    subAgent: makeSubAgent(),
    task: 'Do something useful',
    cancellationToken: makeCancellationToken(),
    currentUserAlias: 'user1',
    onStepUpdate: vi.fn(),
    onTurnComplete: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('truncateToLines', () => {
  it('returns empty string for empty input', () => {
    expect(truncateToLines('', 5, 100)).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    expect(truncateToLines(null as unknown as string, 5, 100)).toBe('');
  });

  it('appends ... when text has more lines than maxLines', () => {
    const text = 'line1\nline2\nline3\nline4\nline5\nline6';
    const result = truncateToLines(text, 3, 1000);
    expect(result).toContain('...');
    expect(result).not.toContain('line4');
  });

  it('truncates to maxChars and appends ...', () => {
    const text = 'a'.repeat(100);
    const result = truncateToLines(text, 10, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns full text when within limits', () => {
    const text = 'hello\nworld';
    const result = truncateToLines(text, 5, 100);
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });
});

describe('SubAgentChat.getTurnCount', () => {
  it('returns 0 initially', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(chat.getTurnCount()).toBe(0);
  });
});

describe('SubAgentChat.dispose', () => {
  it('disposes without error', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(() => chat.dispose()).not.toThrow();
    expect(chat.getTurnCount()).toBe(0);
  });
});

describe('SubAgentChat - getAvailableTools (private)', () => {
  it('returns empty array when mcpClientManager.getToolsForSubAgent throws', async () => {
    mockGetToolsForSubAgent.mockImplementationOnce(() => { throw new Error('MCP error'); });
    const chat = new SubAgentChat(makeOptions());
    const tools = await (chat as any).getAvailableTools();
    expect(tools).toEqual([]);
  });

  it('uses resolvedMcpServers when non-empty', async () => {
    mockGetToolsForSubAgent.mockReturnValueOnce([{ name: 'mock_tool' }]);
    const options = makeOptions({
      subAgent: makeSubAgent({
        resolvedMcpServers: [{ name: 'my-mcp', connected: true, tools: ['tool1'], inherited: false }],
      }),
    });
    const chat = new SubAgentChat(options);
    const tools = await (chat as any).getAvailableTools();
    expect(tools).toHaveLength(1);
  });
});

describe('SubAgentChat - extractFinalResult (private)', () => {
  it('returns fallback when no assistant messages', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('Sub-agent completed without producing a text result.');
  });

  it('returns safety-limit warning when turnCount >= 200 with no text', () => {
    const chat = new SubAgentChat(makeOptions({
    }));
    (chat as any).turnCount = 200;
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('safety turn limit');
  });

  it('extracts text from the last assistant message', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'task' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'The answer is 42.' }] },
    ];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('The answer is 42.');
  });

  it('appends truncation warning when at safety turn limit with text', () => {
    const chat = new SubAgentChat(makeOptions({
    }));
    (chat as any).turnCount = 200;
    (chat as any).contextHistory = [
      { role: 'assistant', content: [{ type: 'text', text: 'partial result' }] },
    ];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('partial result');
    expect(result).toContain('⚠️');
  });

  it('extracts string content from assistant message', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'assistant', content: 'Direct string result' },
    ];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('Direct string result');
  });
});

describe('SubAgentChat - trackDeliverables (private)', () => {
  let chat: SubAgentChat;

  beforeEach(() => {
    chat = new SubAgentChat(makeOptions());
  });

  it('tracks write_file filePath', () => {
    (chat as any).trackDeliverables('write_file', { filePath: '/out/result.txt' });
    expect((chat as any).deliverables).toContain('/out/result.txt');
  });

  it('tracks create_file filePath', () => {
    (chat as any).trackDeliverables('create_file', { filePath: '/out/new.txt' });
    expect((chat as any).deliverables).toContain('/out/new.txt');
  });

  it('tracks append_to_file filePath', () => {
    (chat as any).trackDeliverables('append_to_file', { filePath: '/out/append.txt' });
    expect((chat as any).deliverables).toContain('/out/append.txt');
  });

  it('tracks file_path (underscore variant)', () => {
    (chat as any).trackDeliverables('write_file', { file_path: '/out/underscore.txt' });
    expect((chat as any).deliverables).toContain('/out/underscore.txt');
  });

  it('deduplicates deliverables', () => {
    (chat as any).trackDeliverables('write_file', { filePath: '/out/dup.txt' });
    (chat as any).trackDeliverables('write_file', { filePath: '/out/dup.txt' });
    expect((chat as any).deliverables).toHaveLength(1);
  });

  it('tracks download_file with saveDirectory + filename (unix)', () => {
    (chat as any).trackDeliverables('download_file', {
      saveDirectory: '/downloads',
      filename: 'data.csv',
    });
    expect((chat as any).deliverables).toContain('/downloads/data.csv');
  });

  it('tracks download_file with Windows saveDirectory', () => {
    (chat as any).trackDeliverables('download_file', {
      saveDirectory: 'C:\\Users\\user\\Downloads',
      filename: 'report.pdf',
    });
    expect((chat as any).deliverables).toContain('C:\\Users\\user\\Downloads\\report.pdf');
  });

  it('tracks present_deliverables filePaths array', () => {
    (chat as any).trackDeliverables('present_deliverables', {
      filePaths: ['/out/a.txt', '/out/b.txt'],
    });
    expect((chat as any).deliverables).toContain('/out/a.txt');
    expect((chat as any).deliverables).toContain('/out/b.txt');
  });

  it('ignores unknown tool names', () => {
    (chat as any).trackDeliverables('read_file', { filePath: '/some/file.txt' });
    expect((chat as any).deliverables).toHaveLength(0);
  });
});

describe('SubAgentChat - formatDeliverablesSection (private)', () => {
  it('returns empty string when no deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).formatDeliverablesSection()).toBe('');
  });

  it('formats deliverables list', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).deliverables = ['/out/result.txt', '/out/report.md'];
    const section = (chat as any).formatDeliverablesSection();
    expect(section).toContain('Deliverables');
    expect(section).toContain('2 file(s)');
    expect(section).toContain('/out/result.txt');
  });
});

describe('SubAgentChat - createAbortSignal (private)', () => {
  it('returns already-aborted signal when cancellation already requested', () => {
    const token = { isCancellationRequested: true, onCancellationRequested: vi.fn() };
    const chat = new SubAgentChat(makeOptions({ cancellationToken: token as any }));
    const signal = (chat as any).createAbortSignal();
    expect(signal.aborted).toBe(true);
  });

  it('aborts signal when cancellation fires later', () => {
    let onCancelFn: (() => void) | null = null;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn((fn: () => void) => { onCancelFn = fn; return { dispose: vi.fn() }; }),
    };
    const chat = new SubAgentChat(makeOptions({ cancellationToken: token as any }));
    const signal = (chat as any).createAbortSignal();
    expect(signal.aborted).toBe(false);
    onCancelFn?.();
    expect(signal.aborted).toBe(true);
  });
});

describe('SubAgentChat - sanitizeOrphanedToolResults (private)', () => {
  it('removes orphaned tool results', () => {
    const chat = new SubAgentChat(makeOptions());
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'tool', content: [{ type: 'text', text: 'result' }], tool_call_id: 'orphan-id' },
    ];
    const result = (chat as any).sanitizeOrphanedToolResults(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('keeps tool results that have matching assistant tool_call', () => {
    const chat = new SubAgentChat(makeOptions());
    const messages: any[] = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 'call-valid', type: 'function', function: { name: 'search' } }],
      },
      { role: 'tool', content: [], tool_call_id: 'call-valid' },
    ];
    const result = (chat as any).sanitizeOrphanedToolResults(messages);
    expect(result).toHaveLength(2);
  });

  it('passes through tool messages without tool_call_id', () => {
    const chat = new SubAgentChat(makeOptions());
    const messages: any[] = [
      { role: 'tool', content: [{ type: 'text', text: 'result' }] },
    ];
    const result = (chat as any).sanitizeOrphanedToolResults(messages);
    expect(result).toHaveLength(1);
  });
});

describe('SubAgentChat - sanitizeContextHistoryToolCalls (private)', () => {
  it('repairs invalid JSON tool call arguments', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'web_search', arguments: 'invalid json {' } },
        ],
      },
    ];
    (chat as any).sanitizeContextHistoryToolCalls();
    const args = (chat as any).contextHistory[0].tool_calls[0].function.arguments;
    expect(() => JSON.parse(args)).not.toThrow();
  });

  it('leaves valid JSON unchanged', () => {
    const chat = new SubAgentChat(makeOptions());
    const validArgs = '{"query":"test"}';
    (chat as any).contextHistory = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search', arguments: validArgs } },
        ],
      },
    ];
    (chat as any).sanitizeContextHistoryToolCalls();
    expect((chat as any).contextHistory[0].tool_calls[0].function.arguments).toBe(validArgs);
  });

  it('skips messages without tool_calls', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    expect(() => (chat as any).sanitizeContextHistoryToolCalls()).not.toThrow();
  });
});

describe('SubAgentChat - adjustBatchBoundaryForToolPairs (private)', () => {
  it('expands batch to include tool results after assistant tool_calls', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search' } }],
      },
      { role: 'tool', content: [], tool_call_id: 'c1' },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
    ];
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(2);
    expect(adjusted).toBeGreaterThanOrEqual(3);
  });

  it('returns original batchSize when no adjustment needed', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
    ];
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(1);
    expect(adjusted).toBe(1);
  });

  it('includes orphaned tool message at boundary', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'tool', content: [], tool_call_id: 'orphan' },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
    ];
    // batchSize = 1 → next is a tool msg (orphan), should expand
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(1);
    expect(adjusted).toBeGreaterThanOrEqual(2);
  });
});

describe('SubAgentChat - compressToolResult (private)', () => {
  it('returns LLM summary when successful', async () => {
    mockCallModel.mockResolvedValueOnce('Key findings from the tool output');
    const chat = new SubAgentChat(makeOptions());
    const content = 'A'.repeat(20000);
    const result = await (chat as any).compressToolResult(content, 'fetch_tool', content.length);
    expect(result).toContain('[Summarized from');
    expect(result).toContain('Key findings from the tool output');
  });

  it('hard-truncates when LLM fails and content > MAX_TOOL_RESULT_CHARS', async () => {
    mockCallModel.mockRejectedValueOnce(new Error('LLM down'));
    const chat = new SubAgentChat(makeOptions());
    const content = 'X'.repeat(60000);
    const result = await (chat as any).compressToolResult(content, 'big_tool', content.length);
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain('[... content truncated from');
  });

  it('returns content unchanged when LLM returns empty and content < MAX_TOOL_RESULT_CHARS', async () => {
    mockCallModel.mockResolvedValueOnce('');
    const chat = new SubAgentChat(makeOptions());
    const content = 'small content';
    const result = await (chat as any).compressToolResult(content, 'test_tool', content.length);
    expect(result).toBe(content);
  });
});

describe('SubAgentChat - compressEarlyMessages (private)', () => {
  it('skips when actualBatch <= 0', async () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    await (chat as any).compressEarlyMessages(0);
    expect((chat as any).contextHistory).toHaveLength(1);
  });

  it('replaces early messages with LLM summary', async () => {
    mockCallModel.mockResolvedValueOnce('Early conversation summary');
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'msg1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'resp1' }] },
      { role: 'user', content: [{ type: 'text', text: 'msg2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'resp2' }] },
      { role: 'user', content: [{ type: 'text', text: 'msg3' }] },
    ];
    await (chat as any).compressEarlyMessages(3);
    expect((chat as any).contextHistory).toHaveLength(3);
    const first = (chat as any).contextHistory[0];
    const text = first.content?.[0]?.text || '';
    expect(text).toContain('[Context Summary');
  });

  it('falls back to truncation when LLM fails', async () => {
    mockCallModel.mockRejectedValueOnce(new Error('LLM offline'));
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'msg1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'resp1' }] },
      { role: 'user', content: [{ type: 'text', text: 'msg2' }] },
    ];
    await (chat as any).compressEarlyMessages(2);
    expect((chat as any).contextHistory).toHaveLength(2);
    const first = (chat as any).contextHistory[0];
    const text = first.content?.[0]?.text || '';
    expect(text).toContain('[Context Summary — truncated from');
  });

  it('falls back when LLM returns empty', async () => {
    mockCallModel.mockResolvedValueOnce('');
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'msg1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'resp1' }] },
      { role: 'user', content: [{ type: 'text', text: 'msg2' }] },
    ];
    await (chat as any).compressEarlyMessages(2);
    const first = (chat as any).contextHistory[0];
    const text = first.content?.[0]?.text || '';
    expect(text).toContain('[Context Summary — truncated from');
  });
});

describe('SubAgentChat - estimateMessagesTokens (private)', () => {
  it('counts tokens for text messages', () => {
    const chat = new SubAgentChat(makeOptions());
    const fakeCounter = { countTextTokens: vi.fn(() => 10) };
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
    ];
    const total = (chat as any).estimateMessagesTokens(fakeCounter, messages);
    expect(total).toBeGreaterThan(0);
  });

  it('counts tool_calls tokens for assistant messages', () => {
    const chat = new SubAgentChat(makeOptions());
    const fakeCounter = { countTextTokens: vi.fn(() => 5) };
    const messages: any[] = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      },
    ];
    const total = (chat as any).estimateMessagesTokens(fakeCounter, messages);
    expect(total).toBeGreaterThan(0);
  });

  it('counts name tokens for tool messages', () => {
    const chat = new SubAgentChat(makeOptions());
    const fakeCounter = { countTextTokens: vi.fn(() => 3) };
    const messages: any[] = [
      { role: 'tool', content: [{ type: 'text', text: 'result' }], name: 'search', tool_call_id: 'c1' },
    ];
    const total = (chat as any).estimateMessagesTokens(fakeCounter, messages);
    expect(total).toBeGreaterThan(0);
  });
});

describe('SubAgentChat - estimateToolsTokens (private)', () => {
  it('returns 0 for empty tools array', () => {
    const chat = new SubAgentChat(makeOptions());
    const fakeCounter = { countTextTokens: vi.fn(() => 5) };
    const result = (chat as any).estimateToolsTokens(fakeCounter, []);
    expect(result).toBe(0);
  });

  it('returns token count for non-empty tools', () => {
    const chat = new SubAgentChat(makeOptions());
    const fakeCounter = { countTextTokens: vi.fn(() => 10) };
    const tools = [{ name: 'search', description: 'search the web', inputSchema: {} }];
    const result = (chat as any).estimateToolsTokens(fakeCounter, tools);
    expect(result).toBe(10);
  });
});

describe('SubAgentChat - detectTruncatedToolCalls (private)', () => {
  it('detects empty args as truncated', () => {
    const chat = new SubAgentChat(makeOptions());
    const toolCalls = [{ id: 'c1', function: { name: 'write_file', arguments: '' } }];
    const truncated = (chat as any).detectTruncatedToolCalls(toolCalls);
    expect(truncated).toHaveLength(1);
  });

  it('detects brace imbalance as truncated', () => {
    const chat = new SubAgentChat(makeOptions());
    const toolCalls = [{ id: 'c1', function: { name: 'search', arguments: '{"query": "test"' } }];
    const truncated = (chat as any).detectTruncatedToolCalls(toolCalls);
    expect(truncated).toHaveLength(1);
  });

  it('returns empty for valid complete tool call', () => {
    const chat = new SubAgentChat(makeOptions());
    const toolCalls = [{ id: 'c1', function: { name: 'search', arguments: '{"query":"hello"}' } }];
    const truncated = (chat as any).detectTruncatedToolCalls(toolCalls);
    expect(truncated).toHaveLength(0);
  });

  it('detects missing critical fields as truncated', () => {
    const chat = new SubAgentChat(makeOptions());
    // write_file needs filePath + content
    const toolCalls = [{ id: 'c1', function: { name: 'write_file', arguments: '{"filePath":"/out/f.txt"}' } }];
    const truncated = (chat as any).detectTruncatedToolCalls(toolCalls);
    expect(truncated).toHaveLength(1);
  });
});

describe('SubAgentChat - isMissingCriticalFields (private)', () => {
  it('returns false for unknown tool', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).isMissingCriticalFields('unknown_tool', { anything: 'value' });
    expect(result).toBe(false);
  });

  it('returns true for write_file missing content', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).isMissingCriticalFields('write_file', { filePath: '/tmp/f.txt' });
    expect(result).toBe(true);
  });

  it('returns false for write_file with all fields', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).isMissingCriticalFields('write_file', { filePath: '/tmp/f.txt', content: 'data' });
    expect(result).toBe(false);
  });

  it('returns false for null parsed', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).isMissingCriticalFields('write_file', null)).toBe(false);
  });
});

describe('SubAgentChat - repairToolCallArguments (private)', () => {
  it('repairs by trimming whitespace', () => {
    const chat = new SubAgentChat(makeOptions());
    const tc = { id: 'c1', function: { name: 'search', arguments: '  {"query":"test"}  ' } };
    const repaired = (chat as any).repairToolCallArguments(tc);
    expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
  });

  it('repairs by stripping code fences', () => {
    const chat = new SubAgentChat(makeOptions());
    const tc = { id: 'c1', function: { name: 'search', arguments: '```json\n{"query":"test"}\n```' } };
    const repaired = (chat as any).repairToolCallArguments(tc);
    expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
  });

  it('falls back to {} for completely invalid args', () => {
    const chat = new SubAgentChat(makeOptions());
    const tc = { id: 'c1', function: { name: 'search', arguments: 'NOT JSON AT ALL $$$' } };
    const repaired = (chat as any).repairToolCallArguments(tc);
    expect(repaired.function.arguments).toBe('{}');
  });
});

describe('SubAgentChat - tryRepairTruncatedJson (private)', () => {
  it('returns null for empty string', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).tryRepairTruncatedJson('')).toBeNull();
  });

  it('returns null when JSON is already balanced', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).tryRepairTruncatedJson('{"key":"value"}')).toBeNull();
  });

  it('repairs truncated object', () => {
    const chat = new SubAgentChat(makeOptions());
    const repaired = (chat as any).tryRepairTruncatedJson('{"key":"value"');
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });
});

describe('SubAgentChat - extractFirstJson (private)', () => {
  it('returns null for text without JSON structure', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).extractFirstJson('no json here')).toBeNull();
  });

  it('extracts first JSON object from text', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).extractFirstJson('before{"key":"val"}after');
    expect(result).toBe('{"key":"val"}');
  });
});

describe('SubAgentChat - getMessageText (private)', () => {
  it('returns joined text for array content', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = { role: 'user', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] };
    expect((chat as any).getMessageText(msg)).toBe('hello world');
  });

  it('returns string for string content', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = { role: 'user', content: 'direct string' };
    expect((chat as any).getMessageText(msg)).toBe('direct string');
  });
});

describe('SubAgentChat - summarizeToolArgs (private)', () => {
  it('extracts query key as primary', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('bing_web_search', { query: 'AI news' });
    expect(result).toContain('AI news');
  });

  it('falls back to first string value', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('custom_tool', { unknown_key: 'some_value' });
    expect(result).toContain('some_value');
  });

  it('returns tool name when no string values', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('tool', { count: 5 });
    expect(result).toBe('tool');
  });

  it('truncates long summaries to 200 chars', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('tool', { query: 'q'.repeat(300) });
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('SubAgentChat - buildSystemPrompt (private)', () => {
  it('builds system prompt with task context', () => {
    const options = makeOptions({ task: 'Find the weather' });
    const chat = new SubAgentChat(options);
    const messages = (chat as any).buildSystemPrompt();
    expect(messages).toHaveLength(1);
    const text = messages[0].content[0].text;
    expect(text).toContain('Sub-Agent');
    expect(text).toContain('Operating Rules');
  });

  it('parentContext option no longer included (removed during extraction)', () => {
    const options = makeOptions({ parentContext: 'Parent context data here' });
    const chat = new SubAgentChat(options);
    const messages = (chat as any).buildSystemPrompt();
    const text = messages[0].content[0].text;
    // parentContext was removed during prompt builder extraction
    expect(text).not.toContain('Parent context data here');
  });

  it('includes deliverables path when provided', () => {
    const options = makeOptions({ deliverablesPath: '/workspace/deliverables' });
    const chat = new SubAgentChat(options);
    const messages = (chat as any).buildSystemPrompt();
    const text = messages[0].content[0].text;
    expect(text).toContain('/workspace/deliverables');
  });

  it('does not use workspace as deliverables path (no longer a fallback)', () => {
    const options = makeOptions({
      subAgent: makeSubAgent({ config: makeSubAgentConfig({ workspace: '/my/workspace' }) }),
    });
    const chat = new SubAgentChat(options);
    const messages = (chat as any).buildSystemPrompt();
    const text = messages[0].content[0].text;
    // workspace is no longer used as deliverables path fallback
    expect(text).not.toContain('Deliverables Directory');
  });

  it('includes knowledge base when resolvedKnowledgeBase is set', () => {
    const options = makeOptions({
      subAgent: makeSubAgent({ resolvedKnowledgeBase: '/kb/path' }),
    });
    const chat = new SubAgentChat(options);
    const messages = (chat as any).buildSystemPrompt();
    const text = messages[0].content[0].text;
    expect(text).toContain('/kb/path');
  });
});

describe('SubAgentChat - buildTurnProgressHint — removed', () => {
  it('buildTurnProgressHint no longer exists on SubAgentChat', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).buildTurnProgressHint).toBeUndefined();
  });
});

describe('SubAgentChat - processSSELine (private)', () => {
  it('processes /chat/completions text delta', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let content = '';
    let reason = '';
    (chat as any).processSSELine(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' }, finish_reason: null }] })}`,
      '/chat/completions',
      state,
      (fc: string) => { content = fc; },
      (fr: string) => { reason = fr; },
    );
    expect(content).toBe('hello');
  });

  it('processes /chat/completions finish_reason', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: 'done', toolCalls: [], finishReason: '' };
    let reason = '';
    (chat as any).processSSELine(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      '/chat/completions',
      state,
      () => {},
      (fr: string) => { reason = fr; },
    );
    expect(reason).toBe('stop');
  });

  it('processes /responses text delta', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let content = '';
    (chat as any).processSSELine(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: ' world' })}`,
      '/responses',
      state,
      (fc: string) => { content = fc; },
      () => {},
    );
    expect(content).toBe(' world');
  });

  it('processes /responses function_call item done', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    (chat as any).processSSELine(
      `data: ${JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'cid1', name: 'search', arguments: '{"q":"test"}' },
      })}`,
      '/responses',
      state,
      () => {},
      () => {},
    );
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0].function.name).toBe('search');
  });

  it('processes /responses completed with function_call', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let reason = '';
    (chat as any).processSSELine(
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: { output: [{ type: 'function_call', call_id: 'c1' }] },
      })}`,
      '/responses',
      state,
      () => {},
      (fr: string) => { reason = fr; },
    );
    expect(reason).toBe('tool_calls');
  });

  it('skips non-data lines', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: 'existing', toolCalls: [], finishReason: '' };
    let content = 'existing';
    (chat as any).processSSELine(
      'event: ping',
      '/chat/completions',
      state,
      (fc: string) => { content = fc; },
      () => {},
    );
    expect(content).toBe('existing');
  });

  it('skips [DONE] line', () => {
    const chat = new SubAgentChat(makeOptions());
    const state = { fullContent: 'existing', toolCalls: [], finishReason: '' };
    let content = 'existing';
    (chat as any).processSSELine(
      'data: [DONE]',
      '/chat/completions',
      state,
      (fc: string) => { content = fc; },
      () => {},
    );
    expect(content).toBe('existing');
  });
});

describe('SubAgentChat - formatMessageForAPI (private)', () => {
  it('formats user message correctly', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const formatted = (chat as any).formatMessageForAPI(msg);
    expect(formatted.role).toBe('user');
    expect(formatted.content).toBe('hello');
  });

  it('formats tool message with tool_call_id', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = { role: 'tool', content: [{ type: 'text', text: 'result' }], tool_call_id: 'cid', name: 'search' };
    const formatted = (chat as any).formatMessageForAPI(msg);
    expect(formatted.tool_call_id).toBe('cid');
    expect(formatted.name).toBe('search');
  });

  it('formats assistant message with valid JSON tool_calls unchanged', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = {
      role: 'assistant',
      content: [],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } }],
    };
    const formatted = (chat as any).formatMessageForAPI(msg);
    expect((formatted as any).tool_calls[0].function.arguments).toBe('{"q":"test"}');
  });

  it('repairs invalid JSON in assistant tool_calls', () => {
    const chat = new SubAgentChat(makeOptions());
    const msg = {
      role: 'assistant',
      content: [],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: 'bad json' } }],
    };
    const formatted = (chat as any).formatMessageForAPI(msg);
    const args = (formatted as any).tool_calls[0].function.arguments;
    expect(() => JSON.parse(args)).not.toThrow();
  });
});

describe('SubAgentChat - getDeliverablesPath (private)', () => {
  it('returns deliverablesPath from options when provided', () => {
    const chat = new SubAgentChat(makeOptions({ deliverablesPath: '/custom/path' }));
    expect((chat as any).getDeliverablesPath()).toBe('/custom/path');
  });

  it('returns null when workspace is set but no deliverablesPath (workspace no longer used as fallback)', () => {
    const chat = new SubAgentChat(makeOptions({
      subAgent: makeSubAgent({ config: makeSubAgentConfig({ workspace: '/workspace/path' }) }),
    }));
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });

  it('returns null when no path configured', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });
});

describe('SubAgentChat - shouldContinueAfterTextResponse (private)', () => {
  it('returns true when finish_reason=length', () => {
    const chat = new SubAgentChat(makeOptions());
    const response = { finishReason: 'length', textContent: 'some text', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
    expect((chat as any).shouldContinueAfterTextResponse(response, 1, true)).toBe(true);
  });

  it('returns false when no tools available', () => {
    const chat = new SubAgentChat(makeOptions());
    const response = { finishReason: 'stop', textContent: 'final answer', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
    expect((chat as any).shouldContinueAfterTextResponse(response, 1, false)).toBe(false);
  });

  it('returns false on 2+ consecutive text-only rounds', () => {
    const chat = new SubAgentChat(makeOptions());
    const response = { finishReason: 'stop', textContent: 'text', hasToolCalls: false, toolCalls: [], assistantMessage: {} as any };
    expect((chat as any).shouldContinueAfterTextResponse(response, 2, true)).toBe(false);
  });

  it('returns true on first round with intent text', () => {
    const chat = new SubAgentChat(makeOptions());
    const response = {
      finishReason: 'stop',
      textContent: "Let me search for that information and gather data.",
      hasToolCalls: false, toolCalls: [], assistantMessage: {} as any,
    };
    expect((chat as any).shouldContinueAfterTextResponse(response, 1, true)).toBe(true);
  });

  it('returns false on first round with non-intent text', () => {
    const chat = new SubAgentChat(makeOptions());
    const response = {
      finishReason: 'stop',
      textContent: 'The capital of France is Paris.',
      hasToolCalls: false, toolCalls: [], assistantMessage: {} as any,
    };
    expect((chat as any).shouldContinueAfterTextResponse(response, 1, true)).toBe(false);
  });
});
