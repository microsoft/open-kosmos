// @ts-nocheck
/**
 * subAgentChat.deep4.test.ts
 *
 * Targets remaining uncovered statements in subAgentChat.ts (round 4):
 * - adjustBatchBoundaryForToolPairs: tool_call/tool_result boundary expansion
 * - sanitizeOrphanedToolResults: orphaned tool results removed + logged
 * - estimateMessagesTokens: tool_calls and tool role messages
 * - estimateToolsTokens: empty and non-empty tools
 * - compressEarlyMessages: LLM success, LLM empty (fallback), LLM error (fallback),
 *   batch == 0 early exit
 * - compressToolResult: LLM success, timeout (null), error, hard truncation
 * - sanitizeContextHistoryToolCalls: repairs invalid JSON in tool_calls
 * - detectTruncatedToolCalls: empty args, structural imbalance, json parse failure,
 *   isMissingCriticalFields detection
 * - processSSELine: /responses format (output_text, function_call, completed),
 *   /chat/completions tool_calls accumulation, finish_reason
 * - buildTurnProgressHint: low turns, exceeded max turns, normal progress
 * - compactContextIfNeeded: msg count threshold triggers, token threshold,
 *   below threshold returns early, error is swallowed
 * - sanitizeContextHistoryToolCalls
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

const { mockGetCurrentAuth } = vi.hoisted(() => ({
  mockGetCurrentAuth: vi.fn().mockResolvedValue({
    ghcAuth: { copilotTokens: { token: 'mock-token' } },
  }),
}));

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: mockGetCurrentAuth,
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

const { mockGetTokenCounter } = vi.hoisted(() => ({
  mockGetTokenCounter: vi.fn(),
}));

vi.mock('../../token', () => ({
  getTokenCounter: mockGetTokenCounter,
  TokenCounter: vi.fn().mockImplementation(function () {
    return { countTextTokens: vi.fn((text: string) => Math.ceil((text || '').length / 4)) };
  }),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getToolsForSubAgent: vi.fn().mockReturnValue([]),
    executeTool: vi.fn().mockResolvedValue('tool result'),
  },
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    setExecutionContext: vi.fn(),
    clearExecutionContext: vi.fn(),
  },
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: { description: 'Test skill' }, error: null })),
  },
}));

vi.mock('../../chat/agentChatUtilities', () => ({
  normalizeToolCalls: vi.fn((calls: any) => calls),
}));

vi.mock('../../chat/systemReminderUtils', () => ({
  wrapInSystemReminder: vi.fn((text: string) => `[SYS]${text}[/SYS]`),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentChat } from '../subAgentChat';
import type { SubAgentChatOptions } from '../types';
import type { SubAgentConfig } from '../../userDataADO/types/profile';
import type { CancellationToken } from '../../cancellation/CancellationToken';

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
    tools: [],
    mcp_servers: [],
    skills: [],
    ...overrides,
  } as SubAgentConfig;
}

function makeOptions(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChatOptions {
  return {
    subAgent: {
      config: makeSubAgentConfig(),
      inheritedModel: 'gpt-5',
      inheritedSystemPrompt: '',
      parentChatId: 'parent-chat-1',
      parentChatSessionId: 'parent-session-1',
      userAlias: 'user1',
      resolvedSystemPrompt: 'You are helpful.',
      resolvedSkills: [],
      resolvedMcpServers: [],
      resolvedKnowledgeBase: [],
      parentContextSummary: '',
    },
    currentUserAlias: 'user1',
    cancellationToken: makeCancellationToken(),
    onStepUpdate: vi.fn(),
    ...overrides,
  } as SubAgentChatOptions;
}

function makeChat(optOverrides: Partial<SubAgentChatOptions> = {}) {
  return new SubAgentChat(makeOptions(optOverrides));
}

// Stub mock token counter
const mockTokenCounter = {
  countTextTokens: vi.fn((text: string) => Math.ceil((text || '').length / 4)),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTokenCounter.mockResolvedValue(mockTokenCounter);
});

// ─── adjustBatchBoundaryForToolPairs ─────────────────────────────────────────

describe('adjustBatchBoundaryForToolPairs', () => {
  it('expands batch when last batch message has tool_calls and next is tool', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [], tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', name: 'search', content: [{ type: 'text', text: 'result' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    // Ask to cut at index 2 (after assistant with tool_calls) — should expand to include tool result
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(2);
    expect(adjusted).toBe(3); // expanded to include the tool result
  });

  it('expands batch when next remaining message is orphan tool', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'tool', tool_call_id: 'tc-orphan', name: 'fn', content: [] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(1);
    expect(adjusted).toBe(2);
  });

  it('returns unchanged batch when no expansion needed', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
    ];
    const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(1);
    expect(adjusted).toBe(1);
  });
});

// ─── sanitizeOrphanedToolResults ─────────────────────────────────────────────

describe('sanitizeOrphanedToolResults', () => {
  it('removes tool result without matching tool_call_id', () => {
    const chat = makeChat();
    const messages = [
      { role: 'assistant', content: [], tool_calls: [{ id: 'tc1', function: { name: 'f' } }] },
      { role: 'tool', tool_call_id: 'tc-ORPHAN', name: 'f', content: [] },
      { role: 'tool', tool_call_id: 'tc1', name: 'f', content: [{ type: 'text', text: 'ok' }] },
    ] as any[];
    const result = (chat as any).sanitizeOrphanedToolResults(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m: any) => m.tool_call_id !== 'tc-ORPHAN')).toBe(true);
  });

  it('keeps all messages when no orphans present', () => {
    const chat = makeChat();
    const messages = [
      { role: 'assistant', content: [], tool_calls: [{ id: 'tc1', function: { name: 'f' } }] },
      { role: 'tool', tool_call_id: 'tc1', name: 'f', content: [] },
    ] as any[];
    expect((chat as any).sanitizeOrphanedToolResults(messages)).toHaveLength(2);
  });
});

// ─── estimateMessagesTokens ───────────────────────────────────────────────────

describe('estimateMessagesTokens', () => {
  it('counts tokens for tool role messages including name field', () => {
    const chat = makeChat();
    const messages = [
      { role: 'tool', tool_call_id: 'tc1', name: 'search', content: [{ type: 'text', text: 'res' }] },
    ] as any[];
    const total = (chat as any).estimateMessagesTokens(mockTokenCounter, messages);
    expect(total).toBeGreaterThan(0);
  });

  it('counts tokens for assistant messages with tool_calls', () => {
    const chat = makeChat();
    const messages = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } },
        ],
      },
    ] as any[];
    const total = (chat as any).estimateMessagesTokens(mockTokenCounter, messages);
    expect(total).toBeGreaterThan(0);
  });
});

// ─── estimateToolsTokens ──────────────────────────────────────────────────────

describe('estimateToolsTokens', () => {
  it('returns 0 for empty tools array', () => {
    const chat = makeChat();
    expect((chat as any).estimateToolsTokens(mockTokenCounter, [])).toBe(0);
  });

  it('returns positive count for non-empty tools', () => {
    const chat = makeChat();
    const tools = [{ name: 'search', description: 'search the web', inputSchema: { type: 'object' } }];
    expect((chat as any).estimateToolsTokens(mockTokenCounter, tools)).toBeGreaterThan(0);
  });
});

// ─── processSSELine ─────────────────────────────────────────────────────────

describe('processSSELine - /responses endpoint', () => {
  it('handles response.output_text.delta', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn((v: string) => { state.fullContent = v; });
    const setFR = vi.fn((v: string) => { state.finishReason = v; });

    const line = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hello ' })}`;
    (chat as any).processSSELine(line, '/responses', state, setFC, setFR);
    expect(setFC).toHaveBeenCalledWith('hello ');
  });

  it('handles response.output_item.done with function_call', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn();

    const item = { type: 'function_call', call_id: 'cid1', name: 'search', arguments: '{"q":"hi"}' };
    const line = `data: ${JSON.stringify({ type: 'response.output_item.done', item })}`;
    (chat as any).processSSELine(line, '/responses', state, setFC, setFR);
    expect(state.toolCalls[0]).toMatchObject({ id: 'cid1', function: { name: 'search' } });
  });

  it('handles response.completed with function_call output', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn((v: string) => { state.finishReason = v; });

    const line = `data: ${JSON.stringify({
      type: 'response.completed',
      response: { output: [{ type: 'function_call' }] },
    })}`;
    (chat as any).processSSELine(line, '/responses', state, setFC, setFR);
    expect(setFR).toHaveBeenCalledWith('tool_calls');
  });

  it('handles response.completed with no function_call (stop)', () => {
    const chat = makeChat();
    const state = { fullContent: 'text', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn((v: string) => { state.finishReason = v; });

    const line = `data: ${JSON.stringify({
      type: 'response.completed',
      response: { output: [{ type: 'text' }] },
    })}`;
    (chat as any).processSSELine(line, '/responses', state, setFC, setFR);
    expect(setFR).toHaveBeenCalledWith('stop');
  });
});

describe('processSSELine - /chat/completions endpoint', () => {
  it('accumulates text delta', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn((v: string) => { state.fullContent = v; });
    const setFR = vi.fn();

    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' } }] })}`;
    (chat as any).processSSELine(line, '/chat/completions', state, setFC, setFR);
    expect(setFC).toHaveBeenCalledWith('world');
  });

  it('accumulates tool_calls with incremental chunks', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn();

    // First chunk: establishes tool call
    const line1 = `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'search', arguments: '{"q":' } }] } }],
    })}`;
    (chat as any).processSSELine(line1, '/chat/completions', state, setFC, setFR);
    expect(state.toolCalls[0].id).toBe('tc1');

    // Second chunk: appends arguments
    const line2 = `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }],
    })}`;
    (chat as any).processSSELine(line2, '/chat/completions', state, setFC, setFR);
    expect(state.toolCalls[0].function.arguments).toBe('{"q":"test"}');
  });

  it('records finish_reason', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn((v: string) => { state.finishReason = v; });

    const line = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`;
    (chat as any).processSSELine(line, '/chat/completions', state, setFC, setFR);
    expect(setFR).toHaveBeenCalledWith('stop');
  });

  it('swallows JSON parse errors', () => {
    const chat = makeChat();
    const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn();
    expect(() =>
      (chat as any).processSSELine('data: {INVALID}', '/chat/completions', state, setFC, setFR)
    ).not.toThrow();
  });

  it('skips data: [DONE] lines', () => {
    const chat = makeChat();
    const state = { fullContent: 'existing', toolCalls: [] as any[], finishReason: '' };
    const setFC = vi.fn();
    const setFR = vi.fn();
    (chat as any).processSSELine('data: [DONE]', '/chat/completions', state, setFC, setFR);
    expect(setFC).not.toHaveBeenCalled();
  });
});

// ─── buildTurnProgressHint — removed (sub-agents no longer have turn budgets) ──

describe('buildTurnProgressHint', () => {
  it('buildTurnProgressHint no longer exists on SubAgentChat', () => {
    const chat = makeChat();
    expect((chat as any).buildTurnProgressHint).toBeUndefined();
  });
});

// ─── detectTruncatedToolCalls ─────────────────────────────────────────────────

describe('detectTruncatedToolCalls', () => {
  it('marks tool calls with empty arguments as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'write_file', arguments: '' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).toContain(tc);
  });

  it('marks tool calls with {} arguments as truncated when name provided', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'write_file', arguments: '{}' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).toContain(tc);
  });

  it('marks tool calls with unbalanced braces as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'search', arguments: '{"q": "test"' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).toContain(tc);
  });

  it('marks tool calls with invalid JSON as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'search', arguments: 'not-json-at-all!' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).toContain(tc);
  });

  it('marks write_file missing content field as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'write_file', arguments: '{"filePath":"/f.ts"}' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).toContain(tc);
  });

  it('does not mark complete write_file as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'write_file', arguments: '{"filePath":"/f.ts","content":"hi"}' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).not.toContain(tc);
  });

  it('does not mark unknown tool with valid JSON as truncated', () => {
    const chat = makeChat();
    const tc = { id: 'tc1', function: { name: 'custom_tool', arguments: '{"x":1}' } };
    const result = (chat as any).detectTruncatedToolCalls([tc]);
    expect(result).not.toContain(tc);
  });
});

// ─── sanitizeContextHistoryToolCalls ─────────────────────────────────────────

describe('sanitizeContextHistoryToolCalls', () => {
  it('repairs invalid JSON arguments in tool_calls', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: 'NOT-JSON' } }],
      },
    ];
    (chat as any).sanitizeContextHistoryToolCalls();
    const repaired = (chat as any).contextHistory[0].tool_calls[0];
    // After repair the arguments should be valid JSON (fallback is '{}')
    expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
  });

  it('leaves valid JSON arguments untouched', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: '{"x":1}' } }],
      },
    ];
    (chat as any).sanitizeContextHistoryToolCalls();
    expect((chat as any).contextHistory[0].tool_calls[0].function.arguments).toBe('{"x":1}');
  });

  it('skips non-assistant messages', () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    expect(() => (chat as any).sanitizeContextHistoryToolCalls()).not.toThrow();
  });
});

// ─── compressEarlyMessages ────────────────────────────────────────────────────

describe('compressEarlyMessages', () => {
  it('returns early when actualBatch <= 0', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = [{ role: 'user', content: [] }];
    await expect((chat as any).compressEarlyMessages(5)).resolves.toBeUndefined();
  });

  it('uses LLM summary when callModel succeeds', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `msg ${i}` }],
    }));
    mockCallModel.mockResolvedValueOnce('Compressed summary');
    await (chat as any).compressEarlyMessages(4);
    expect((chat as any).contextHistory[0].content[0].text).toContain('compressed from 4 earlier messages');
  });

  it('falls back to simple truncation when LLM returns empty', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `msg ${i}` }],
    }));
    mockCallModel.mockResolvedValueOnce('');
    await (chat as any).compressEarlyMessages(4);
    expect((chat as any).contextHistory[0].content[0].text).toContain('Context Summary');
  });

  it('falls back to simple truncation when LLM throws', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `msg ${i}` }],
    }));
    mockCallModel.mockRejectedValueOnce(new Error('LLM error'));
    await (chat as any).compressEarlyMessages(4);
    expect((chat as any).contextHistory[0].content[0].text).toContain('Context Summary');
  });

  it('includes tool role message info in conversationText', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'tool', tool_call_id: 'tc1', name: 'search', content: [{ type: 'text', text: 'result' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    mockCallModel.mockResolvedValueOnce('Summary');
    await (chat as any).compressEarlyMessages(2);
    expect(mockCallModel).toHaveBeenCalled();
  });
});

// ─── compressToolResult ───────────────────────────────────────────────────────

describe('compressToolResult', () => {
  it('returns LLM summary when callModel succeeds', async () => {
    const chat = makeChat();
    mockCallModel.mockResolvedValueOnce('Summarized output');
    const result = await (chat as any).compressToolResult('A'.repeat(200), 'web_fetch', 200);
    expect(result).toContain('Summarized');
  });

  it('falls back to hard truncation when LLM returns null (timeout)', async () => {
    const chat = makeChat();
    mockCallModel.mockResolvedValueOnce(null);
    const longContent = 'X'.repeat(60000);
    const result = await (chat as any).compressToolResult(longContent, 'web_fetch', longContent.length);
    expect(result.length).toBeLessThan(longContent.length);
    expect(result).toContain('truncated');
  });

  it('falls back to hard truncation when LLM throws', async () => {
    const chat = makeChat();
    mockCallModel.mockRejectedValueOnce(new Error('network fail'));
    const longContent = 'Y'.repeat(60000);
    const result = await (chat as any).compressToolResult(longContent, 'web_fetch', longContent.length);
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('returns content unchanged when below MAX_TOOL_RESULT_CHARS after LLM fallback', async () => {
    const chat = makeChat();
    mockCallModel.mockResolvedValueOnce('');
    const shortContent = 'short';
    const result = await (chat as any).compressToolResult(shortContent, 'fn', shortContent.length);
    expect(result).toBe(shortContent);
  });
});

// ─── compactContextIfNeeded ───────────────────────────────────────────────────

describe('compactContextIfNeeded', () => {
  it('returns early when contextHistory is empty', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = [];
    await expect((chat as any).compactContextIfNeeded([], [])).resolves.toBeUndefined();
    expect(mockGetTokenCounter).not.toHaveBeenCalled();
  });

  it('returns early when token usage is below threshold', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    (chat as any).contextWindowSize = 100000;
    // All messages are tiny → ratio << 0.60
    await (chat as any).compactContextIfNeeded([], []);
    // No compression attempted (no mockCallModel call)
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it('triggers Phase 0 when message count exceeds threshold', async () => {
    const chat = makeChat();
    // Create 21 messages (> MSG_COUNT_COMPRESS_THRESHOLD = 20)
    (chat as any).contextHistory = Array.from({ length: 21 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `m${i}` }],
    }));
    (chat as any).contextWindowSize = 128000;
    mockCallModel.mockResolvedValue('summary');
    // compactContextIfNeeded should not throw even when Phase 0 is triggered
    await expect((chat as any).compactContextIfNeeded([], [])).resolves.toBeUndefined();
  });

  it('swallows errors from compaction', async () => {
    const chat = makeChat();
    (chat as any).contextHistory = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    (chat as any).contextWindowSize = 1; // extremely small window
    mockGetTokenCounter.mockRejectedValueOnce(new Error('token fail'));
    await expect((chat as any).compactContextIfNeeded([], [])).resolves.toBeUndefined();
  });
});
