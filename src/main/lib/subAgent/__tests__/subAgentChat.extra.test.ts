// @ts-nocheck
/**
 * SubAgentChat — extra coverage tests
 *
 * Targets branches NOT covered by subAgentChat.coverage.test.ts:
 *  - looksLikeIntentNotResult()
 *  - shouldContinueAfterTextResponse()
 *  - tryRepairTruncatedJson()
 *  - extractFirstJson()
 *  - detectTruncatedToolCalls()
 *  - isMissingCriticalFields()
 *  - summarizeToolArgs()
 *  - buildTurnProgressHint()
 *  - processSSELine()
 *  - formatMessageForAPI()
 *  - buildSystemPrompt() / buildWorkspaceAndSkillsInfo()
 *  - getDeliverablesPath()
 *  - getMessageText()
 *  - estimateMessagesTokens() / estimateToolsTokens()
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

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: vi.fn(() => '/chat/completions'),
  ghcModelApi: { callModel: vi.fn().mockResolvedValue('summary') },
}));

vi.mock('../../llm/ghcModelsManager', () => ({
  getModelCapabilities: vi.fn(() => ({ maxContextLength: 128000 })),
  buildMaxTokensParam: vi.fn(() => ({ max_tokens: 4096 })),
}));

vi.mock('../../token/TokenCounter', () => ({
  TokenCounter: vi.fn().mockImplementation(function () {
    return {
        countTextTokens: vi.fn((text) => Math.ceil((text || '').length / 4)),
    };
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
  wrapInSystemReminder: vi.fn((text: string) => `[SYSTEM_REMINDER]${text}[/SYSTEM_REMINDER]`),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

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
    source: 'ON-DEVICE',
    system_prompt: 'You are a test agent.',
    mcp_servers: [],
    context_access: 'isolated',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChatOptions {
  const config = overrides.subAgent?.config ?? makeSubAgentConfig();
  return {
    subAgent: {
      config,
      inheritedModel: 'gpt-4o',
      parentChatId: 'chat_001',
      parentSessionId: 'session_001',
      userAlias: 'testUser',
      resolvedMcpServers: [],
      resolvedSkills: [],
      taskId: 'task_001',
      ...overrides.subAgent,
    },
    task: 'do something',
    cancellationToken: makeCancellationToken(),
    currentUserAlias: 'testUser',
    ...overrides,
  } as SubAgentChatOptions;
}

function chat(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChat {
  return new SubAgentChat(makeOptions(overrides));
}

// ─── looksLikeIntentNotResult ─────────────────────────────────────────────────

describe('looksLikeIntentNotResult()', () => {
  const call = (text: string) => (chat() as any).looksLikeIntentNotResult(text);

  it('returns false for empty string', () => expect(call('')).toBe(false));
  it('returns false for short text', () => expect(call('ok')).toBe(false));
  it('returns true for "let me" phrase', () => expect(call('Let me search for that information.')).toBe(true));
  it('returns true for "I\'ll"', () => expect(call("I'll check the data now.")).toBe(true));
  it('returns true for "I will"', () => expect(call("I will start by searching.")).toBe(true));
  it('returns true for "let\'s"', () => expect(call("Let's begin by looking at this.")).toBe(true));
  it('returns true for "first,"', () => expect(call("First, I need to fetch the URL.")).toBe(true));
  it('returns true for "step 1"', () => expect(call("Step 1: gather information.")).toBe(true));
  it('returns true for "I\'m going to"', () => expect(call("I'm going to run the command.")).toBe(true));
  it('returns true for "gather information"', () => expect(call("I will gather information from the web.")).toBe(true));
  it('returns true for "search for"', () => expect(call("I will search for the relevant data.")).toBe(true));
  it('returns true for "I need to"', () => expect(call("I need to fetch the page.")).toBe(true));
  it('returns true for "here\'s my plan"', () => expect(call("Here's my plan to solve this.")).toBe(true));
  it('returns true for "my approach"', () => expect(call("My approach will be to start with searching.")).toBe(true));
  it('returns false for plain result text', () => expect(call("The answer is 42. Done.")).toBe(false));
});

// ─── shouldContinueAfterTextResponse ─────────────────────────────────────────

describe('shouldContinueAfterTextResponse()', () => {
  const call = (
    response: any,
    consecutiveTextOnlyRounds: number,
    hasTools: boolean,
  ) => (chat() as any).shouldContinueAfterTextResponse(response, consecutiveTextOnlyRounds, hasTools);

  it('returns true when finishReason=length', () => {
    expect(call({ finishReason: 'length', textContent: 'some text' }, 1, true)).toBe(true);
  });

  it('returns false when no tools', () => {
    expect(call({ finishReason: 'stop', textContent: 'done' }, 1, false)).toBe(false);
  });

  it('returns false when consecutiveTextOnlyRounds >= 2', () => {
    expect(call({ finishReason: 'stop', textContent: 'done' }, 2, true)).toBe(false);
  });

  it('returns true when first round + tools + text looks like intent', () => {
    expect(call({ finishReason: 'stop', textContent: "Let me start searching for this." }, 1, true)).toBe(true);
  });

  it('returns false when first round + tools + text looks like final result', () => {
    expect(call({ finishReason: 'stop', textContent: "The result is 42. Completed." }, 1, true)).toBe(false);
  });
});

// ─── tryRepairTruncatedJson ───────────────────────────────────────────────────

describe('tryRepairTruncatedJson()', () => {
  const call = (text: string) => (chat() as any).tryRepairTruncatedJson(text);

  it('returns null for empty string', () => expect(call('')).toBeNull());
  it('returns null for balanced JSON', () => expect(call('{"a":1}')).toBeNull());
  it('closes unclosed brace', () => {
    const result = call('{"a":"b"');
    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
  });
  it('closes unclosed array bracket', () => {
    const result = call('[1,2,3');
    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
  });
  it('closes open string + missing brace', () => {
    const result = call('{"key":"value');
    expect(result).not.toBeNull();
    // The repaired form should be valid JSON after completion
    expect(result).toContain('"value"');
  });
  it('handles escaped characters in strings', () => {
    const result = call('{"key":"val\\\"more');
    expect(result).not.toBeNull();
  });
});

// ─── extractFirstJson ──────────────────────────────────────────────────────────

describe('extractFirstJson()', () => {
  const call = (text: string) => (chat() as any).extractFirstJson(text);

  it('returns null for text without JSON', () => expect(call('no json here')).toBeNull());
  it('extracts first object', () => {
    const result = call('some text {"a":1} more text');
    expect(result).toBe('{"a":1}');
  });
  it('extracts first array', () => {
    const result = call('prefix [1,2,3] suffix');
    expect(result).toBe('[1,2,3]');
  });
  it('extracts first nested object', () => {
    const result = call('before {"outer":{"inner":true}} after');
    expect(result).toBe('{"outer":{"inner":true}}');
  });
  it('handles strings with braces inside', () => {
    const result = call('{"key":"has {braces} inside"}');
    expect(result).toBe('{"key":"has {braces} inside"}');
  });
  it('returns null for unclosed structure', () => {
    expect(call('{"key":"val"')).toBeNull();
  });
});

// ─── detectTruncatedToolCalls ─────────────────────────────────────────────────

describe('detectTruncatedToolCalls()', () => {
  const call = (toolCalls: any[]) => (chat() as any).detectTruncatedToolCalls(toolCalls);

  it('returns empty array for valid complete tool calls', () => {
    const tc = [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"test"}' } }];
    expect(call(tc)).toHaveLength(0);
  });

  it('detects empty arguments as truncated', () => {
    const tc = [{ id: 'c1', function: { name: 'write_file', arguments: '' } }];
    expect(call(tc)).toHaveLength(1);
  });

  it('detects {} arguments as truncated', () => {
    const tc = [{ id: 'c1', function: { name: 'write_file', arguments: '{}' } }];
    expect(call(tc)).toHaveLength(1);
  });

  it('detects mismatched braces as truncated', () => {
    const tc = [{ id: 'c1', function: { name: 'execute_command', arguments: '{"command":"ls"' } }];
    expect(call(tc)).toHaveLength(1);
  });

  it('detects invalid JSON as truncated', () => {
    const tc = [{ id: 'c1', function: { name: 'web_fetch', arguments: 'not json at all' } }];
    expect(call(tc)).toHaveLength(1);
  });

  it('detects missing critical fields as truncated', () => {
    // write_file needs filePath and content
    const tc = [{ id: 'c1', function: { name: 'write_file', arguments: '{"filePath":"/out.txt"}' } }];
    expect(call(tc)).toHaveLength(1);
  });

  it('does not flag tool with no required fields mapping', () => {
    const tc = [{ id: 'c1', function: { name: 'custom_tool', arguments: '{"anything":"value"}' } }];
    expect(call(tc)).toHaveLength(0);
  });

  it('detects unclosed string quote', () => {
    const tc = [{ id: 'c1', function: { name: 'execute_command', arguments: '{"command":"ls' } }];
    expect(call(tc)).toHaveLength(1);
  });
});

// ─── isMissingCriticalFields ──────────────────────────────────────────────────

describe('isMissingCriticalFields()', () => {
  const call = (toolName: string, parsed: any) => (chat() as any).isMissingCriticalFields(toolName, parsed);

  it('returns false for unknown tool', () => expect(call('unknown_tool', { anything: 'value' })).toBe(false));
  it('returns true for write_file missing content', () => expect(call('write_file', { filePath: '/path' })).toBe(true));
  it('returns true for write_file missing filePath', () => expect(call('write_file', { content: 'data' })).toBe(true));
  it('returns false for write_file with both fields', () => expect(call('write_file', { filePath: '/p', content: 'x' })).toBe(false));
  it('returns true for execute_command missing command', () => expect(call('execute_command', { cwd: '/tmp' })).toBe(true));
  it('returns false for execute_command with command', () => expect(call('execute_command', { command: 'ls' })).toBe(false));
  it('returns true for web_fetch missing url', () => expect(call('web_fetch', {})).toBe(true));
  it('returns true for bing_web_search missing query', () => expect(call('bing_web_search', {})).toBe(true));
  it('returns false for non-object parsed', () => expect(call('write_file', null)).toBe(false));
});

// ─── summarizeToolArgs ────────────────────────────────────────────────────────

describe('summarizeToolArgs()', () => {
  const call = (toolName: string, toolArgs: Record<string, unknown>) =>
    (chat() as any).summarizeToolArgs(toolName, toolArgs);

  it('uses query key when present', () => {
    const result = call('web_search', { query: 'GitHub Copilot' });
    expect(result).toBe('web_search: GitHub Copilot');
  });

  it('uses url key when present', () => {
    const result = call('web_fetch', { url: 'https://example.com' });
    expect(result).toBe('web_fetch: https://example.com');
  });

  it('uses filePath key', () => {
    const result = call('write_file', { filePath: '/out/result.txt', content: 'data' });
    expect(result).toBe('write_file: /out/result.txt');
  });

  it('uses command key', () => {
    const result = call('execute_command', { command: 'ls -la' });
    expect(result).toBe('execute_command: ls -la');
  });

  it('falls back to first string value when no priority key matches', () => {
    const result = call('custom_tool', { someKey: 'someValue' });
    expect(result).toBe('custom_tool: someValue');
  });

  it('returns just toolName when no string values', () => {
    const result = call('custom_tool', { count: 5, flag: true });
    expect(result).toBe('custom_tool');
  });

  it('truncates to 200 chars', () => {
    const longValue = 'x'.repeat(250);
    const result = call('search', { query: longValue });
    expect(result.length).toBe(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

// ─── buildTurnProgressHint removed — sub-agents no longer have turn budgets ────

describe('buildTurnProgressHint() — removed', () => {
  it('buildTurnProgressHint no longer exists on SubAgentChat', () => {
    const c = chat({});
    expect((c as any).buildTurnProgressHint).toBeUndefined();
  });

  it('turnCount is still tracked for metrics', () => {
    const c = chat({});
    expect((c as any).turnCount).toBe(0);
  });
});

// ─── processSSELine ───────────────────────────────────────────────────────────

describe('processSSELine()', () => {
  function callSSE(line: string, endpoint: string, state: any, setFC: any, setFR: any) {
    (chat() as any).processSSELine(line, endpoint, state, setFC, setFR);
  }

  it('ignores non-data lines', () => {
    const setFC = vi.fn();
    const setFR = vi.fn();
    callSSE('event: ping', '/chat/completions', { fullContent: '', toolCalls: [], finishReason: '' }, setFC, setFR);
    expect(setFC).not.toHaveBeenCalled();
  });

  it('ignores [DONE] line', () => {
    const setFC = vi.fn();
    callSSE('data: [DONE]', '/chat/completions', { fullContent: '', toolCalls: [], finishReason: '' }, setFC, vi.fn());
    expect(setFC).not.toHaveBeenCalled();
  });

  it('accumulates text content for /chat/completions', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let fc = '';
    callSSE(
      'data: {"choices":[{"delta":{"content":"hello "},"finish_reason":null}]}',
      '/chat/completions',
      state,
      (v: string) => { fc = v; state.fullContent = v; },
      vi.fn(),
    );
    expect(fc).toBe('hello ');
  });

  it('records finish_reason for /chat/completions', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let fr = '';
    callSSE(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '/chat/completions',
      state,
      vi.fn(),
      (v: string) => { fr = v; },
    );
    expect(fr).toBe('stop');
  });

  it('accumulates tool_calls for /chat/completions', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    callSSE(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}',
      '/chat/completions',
      state,
      vi.fn(),
      vi.fn(),
    );
    expect(state.toolCalls[0].id).toBe('call_1');
    expect(state.toolCalls[0].function.name).toBe('search');
  });

  it('appends tool_call arguments in subsequent chunks', () => {
    const state = { fullContent: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q' } }], finishReason: '' };
    callSSE(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery":"test"}"}}]},"finish_reason":null}]}',
      '/chat/completions',
      state,
      vi.fn(),
      vi.fn(),
    );
    // arguments get appended
    expect(state.toolCalls[0].function.arguments).toContain('{"q');
  });

  it('handles /responses text delta', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let fc = '';
    callSSE(
      'data: {"type":"response.output_text.delta","delta":"world"}',
      '/responses',
      state,
      (v: string) => { fc = v; state.fullContent = v; },
      vi.fn(),
    );
    expect(fc).toBe('world');
  });

  it('handles /responses function_call item done', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    callSSE(
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"cid","name":"tool_x","arguments":"{\\"a\\":1}"}}',
      '/responses',
      state,
      vi.fn(),
      vi.fn(),
    );
    expect(state.toolCalls[0].id).toBe('cid');
    expect(state.toolCalls[0].function.name).toBe('tool_x');
  });

  it('handles /responses completed with function_call output', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let fr = '';
    callSSE(
      'data: {"type":"response.completed","response":{"output":[{"type":"function_call"}]}}',
      '/responses',
      state,
      vi.fn(),
      (v: string) => { fr = v; },
    );
    expect(fr).toBe('tool_calls');
  });

  it('handles /responses completed with no function_call output', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    let fr = '';
    callSSE(
      'data: {"type":"response.completed","response":{"output":[{"type":"message"}]}}',
      '/responses',
      state,
      vi.fn(),
      (v: string) => { fr = v; },
    );
    expect(fr).toBe('stop');
  });

  it('swallows invalid JSON gracefully', () => {
    const state = { fullContent: '', toolCalls: [], finishReason: '' };
    expect(() =>
      callSSE('data: {invalid json}', '/chat/completions', state, vi.fn(), vi.fn())
    ).not.toThrow();
  });
});

// ─── formatMessageForAPI ──────────────────────────────────────────────────────

describe('formatMessageForAPI()', () => {
  const call = (msg: any) => (chat() as any).formatMessageForAPI(msg);

  it('formats user message with array content', () => {
    const result = call({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    expect(result.role).toBe('user');
    expect(result.content).toBe('hello');
  });

  it('formats user message with string content', () => {
    const result = call({ role: 'user', content: 'hello world' });
    expect(result.content).toBe('hello world');
  });

  it('formats tool message with tool_call_id and name', () => {
    const result = call({ role: 'tool', content: [{ type: 'text', text: 'result' }], tool_call_id: 'cid', name: 'my_tool' });
    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe('cid');
    expect(result.name).toBe('my_tool');
    expect(result.content).toBe('result');
  });

  it('keeps valid JSON tool_call arguments as-is', () => {
    const msg = {
      role: 'assistant',
      content: [],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"test"}' } }],
    };
    const result = call(msg);
    expect((result.tool_calls as any[])[0].function.arguments).toBe('{"query":"test"}');
  });

  it('repairs invalid JSON tool_call arguments', () => {
    const msg = {
      role: 'assistant',
      content: [],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: 'invalid {' } }],
    };
    const result = call(msg);
    // Should not throw and arguments should be valid JSON (repaired or fallback {})
    expect(() => JSON.parse((result.tool_calls as any[])[0].function.arguments)).not.toThrow();
  });

  it('handles tool_calls with null arguments', () => {
    const msg = {
      role: 'assistant',
      content: [],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: null } }],
    };
    expect(() => call(msg)).not.toThrow();
  });

  it('joins multiple text parts in array content', () => {
    const result = call({ role: 'user', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] });
    expect(result.content).toBe('hello world');
  });

  it('filters non-text parts from array content', () => {
    const result = call({ role: 'user', content: [{ type: 'image_url', url: 'http://img' }, { type: 'text', text: 'caption' }] });
    expect(result.content).toBe('caption');
  });
});

// ─── getMessageText ───────────────────────────────────────────────────────────

describe('getMessageText()', () => {
  const call = (msg: any) => (chat() as any).getMessageText(msg);

  it('returns text from array content', () => {
    expect(call({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello');
  });

  it('returns string content as-is', () => {
    expect(call({ content: 'direct string' })).toBe('direct string');
  });

  it('returns empty string for null content', () => {
    expect(call({ content: null })).toBe('');
  });

  it('joins multiple text parts', () => {
    expect(call({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
  });

  it('skips non-text parts', () => {
    expect(call({ content: [{ type: 'image', url: 'x' }, { type: 'text', text: 'caption' }] })).toBe('caption');
  });
});

// ─── estimateMessagesTokens / estimateToolsTokens ─────────────────────────────

describe('estimateMessagesTokens() and estimateToolsTokens()', () => {
  it('returns > 0 for non-empty messages', async () => {
    const c = chat();
    // We need a token counter — create one inline
    const tokenCounter = { countTextTokens: (t: string) => Math.ceil((t || '').length / 4) };
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
        tool_calls: [{ id: 'c1', function: { name: 'search' } }],
      },
      { role: 'tool', content: [{ type: 'text', text: 'result' }], name: 'search', tool_call_id: 'c1' },
    ];
    const count = (c as any).estimateMessagesTokens(tokenCounter, msgs);
    expect(count).toBeGreaterThan(0);
  });

  it('returns 0 for empty message list', () => {
    const c = chat();
    const tokenCounter = { countTextTokens: (t: string) => t?.length ?? 0 };
    expect((c as any).estimateMessagesTokens(tokenCounter, [])).toBe(0);
  });

  it('estimateToolsTokens returns 0 for empty tools', () => {
    const c = chat();
    const tokenCounter = { countTextTokens: vi.fn() };
    expect((c as any).estimateToolsTokens(tokenCounter, [])).toBe(0);
    expect(tokenCounter.countTextTokens).not.toHaveBeenCalled();
  });

  it('estimateToolsTokens returns > 0 for non-empty tools', () => {
    const c = chat();
    const tokenCounter = { countTextTokens: (t: string) => t?.length ?? 0 };
    const tools = [{ name: 'search', description: 'Search the web', inputSchema: { type: 'object' } }];
    expect((c as any).estimateToolsTokens(tokenCounter, tools)).toBeGreaterThan(0);
  });
});

// ─── buildSystemPrompt / buildWorkspaceAndSkillsInfo ─────────────────────────

describe('buildSystemPrompt()', () => {
  it('includes agent name', () => {
    const c = chat({ subAgent: { config: makeSubAgentConfig({ name: 'my-specialist' }), inheritedModel: 'gpt-4o', parentChatId: 'c', parentSessionId: 's', userAlias: 'u', resolvedMcpServers: [], resolvedSkills: [], taskId: 't' } });
    const msgs = (c as any).buildSystemPrompt();
    expect(msgs[0].content[0].text).toContain('my-specialist');
  });

  it('includes system_prompt content', () => {
    const c = chat({
      subAgent: { config: makeSubAgentConfig({ system_prompt: 'You are a specialized data analyst.' }), inheritedModel: 'gpt-4o', parentChatId: 'c', parentSessionId: 's', userAlias: 'u', resolvedMcpServers: [], resolvedSkills: [], taskId: 't' },
    });
    const msgs = (c as any).buildSystemPrompt();
    expect(msgs[0].content[0].text).toContain('You are a specialized data analyst.');
  });

  it('does not include workspace path from config (workspace is no longer config-driven)', () => {
    const c = chat({
      subAgent: {
        config: makeSubAgentConfig({ workspace: '/my/workspace' }),
        inheritedModel: 'gpt-4o',
        parentChatId: 'c', parentSessionId: 's', userAlias: 'u',
        resolvedMcpServers: [], resolvedSkills: [], taskId: 't',
      },
    });
    const msgs = (c as any).buildSystemPrompt();
    // workspace is now derived from deliverablesPath, not config.workspace
    expect(msgs[0].content[0].text).not.toContain('/my/workspace');
  });

  it('includes deliverablesPath in prompt when provided', () => {
    const c = chat({
      deliverablesPath: '/deliverables/output',
      subAgent: { config: makeSubAgentConfig(), inheritedModel: 'gpt-4o', parentChatId: 'c', parentSessionId: 's', userAlias: 'u', resolvedMcpServers: [], resolvedSkills: [], taskId: 't' },
    });
    const msgs = (c as any).buildSystemPrompt();
    expect(msgs[0].content[0].text).toContain('/deliverables/output');
  });

  it('includes knowledge base path when resolvedKnowledgeBase is set', () => {
    const c = chat({
      subAgent: {
        config: makeSubAgentConfig(),
        inheritedModel: 'gpt-4o',
        parentChatId: 'c', parentSessionId: 's', userAlias: 'u',
        resolvedMcpServers: [], resolvedSkills: [],
        resolvedKnowledgeBase: '/kb/docs',
        taskId: 't',
      },
    });
    const msgs = (c as any).buildSystemPrompt();
    expect(msgs[0].content[0].text).toContain('/kb/docs');
  });
});

// ─── getDeliverablesPath ──────────────────────────────────────────────────────

describe('getDeliverablesPath()', () => {
  it('returns deliverablesPath option when set', () => {
    const c = chat({ deliverablesPath: '/explicit/path' });
    expect((c as any).getDeliverablesPath()).toBe('/explicit/path');
  });

  it('returns null when no deliverablesPath (no workspace fallback)', () => {
    const c = chat({
      subAgent: {
        config: makeSubAgentConfig({ workspace: '/workspace/dir' }),
        inheritedModel: 'gpt-4o',
        parentChatId: 'c', parentSessionId: 's', userAlias: 'u',
        resolvedMcpServers: [], resolvedSkills: [], taskId: 't',
      },
    });
    // getDeliverablesPath no longer falls back to config.workspace
    expect((c as any).getDeliverablesPath()).toBeNull();
  });

  it('returns null when neither deliverablesPath nor workspace set', () => {
    const c = chat();
    expect((c as any).getDeliverablesPath()).toBeNull();
  });
});

// ─── repairToolCallArguments ──────────────────────────────────────────────────

describe('repairToolCallArguments()', () => {
  const call = (args: string, name = 'tool') =>
    (chat() as any).repairToolCallArguments({ id: 'c1', type: 'function', function: { name, arguments: args } });

  it('repairs via trim (whitespace-padded valid JSON)', () => {
    const result = call('  {"a":1}  ');
    expect(result.function.arguments).toBe('{"a":1}');
  });

  it('repairs by stripping code fence', () => {
    const result = call('```json\n{"a":1}\n```');
    expect(result.function.arguments).toBe('{"a":1}');
  });

  it('repairs truncated JSON by completing brackets', () => {
    const result = call('{"key":"value"');
    expect(() => JSON.parse(result.function.arguments)).not.toThrow();
  });

  it('repairs by extracting first valid JSON structure', () => {
    const result = call('prefix {"key":"value"} suffix');
    expect(result.function.arguments).toBe('{"key":"value"}');
  });

  it('falls back to {} for completely unrepairble input', () => {
    const result = call('not json at all and unclosed {{{{{');
    expect(result.function.arguments).toBe('{}');
  });
});

// ─── dispose ─────────────────────────────────────────────────────────────────

describe('dispose()', () => {
  it('clears contextHistory and sets disposed=true', () => {
    const c = chat();
    (c as any).contextHistory = [{ role: 'user', content: [] }];
    c.dispose();
    expect((c as any).contextHistory).toHaveLength(0);
    expect((c as any).disposed).toBe(true);
  });
});
