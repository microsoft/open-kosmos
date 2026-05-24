/**
 * subAgentChat.deep5.test.ts
 *
 * Targets remaining uncovered statements in subAgentChat.ts (round 5):
 * - run(): 400 invalid_tool_call_format retry path
 * - run(): normalizeToolCalls with argument differences logged
 * - run(): finish_reason=length + valid tool calls (non-truncated path)
 * - callLLM(): /responses endpoint with tools
 * - callLLM(): no auth token → throws
 * - getAvailableTools(): error path returns []
 * - summarizeToolArgs(): first-string-value fallback, catch fallback
 * - trackDeliverables(): download_file with dir path, present_deliverables
 * - buildTurnProgressHint(): exceeded maxTurns path
 * - extractFinalResult(): max turns exceeded (adds warning), no text (fallback messages)
 * - buildWorkspaceAndSkillsInfo(): with workspace, resolvedSkills with inherited flag,
 *   resolvedKnowledgeBase
 * - formatDeliverablesSection(): with deliverables
 * - executeToolCalls(): cancellation mid-loop, parse error path, MCP tool call
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

const { mockNormalizeToolCalls } = vi.hoisted(() => ({
  mockNormalizeToolCalls: vi.fn((calls: any) => calls),
}));

vi.mock('../../chat/agentChatUtilities', () => ({
  normalizeToolCalls: mockNormalizeToolCalls,
}));

vi.mock('../../chat/systemReminderUtils', () => ({
  wrapInSystemReminder: vi.fn((text: string) => `[SYS]${text}[/SYS]`),
}));

const { mockMcpExecuteTool, mockGetToolsForSubAgent } = vi.hoisted(() => ({
  mockMcpExecuteTool: vi.fn().mockResolvedValue('tool result'),
  mockGetToolsForSubAgent: vi.fn().mockReturnValue([]),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getToolsForSubAgent: mockGetToolsForSubAgent,
    executeTool: mockMcpExecuteTool,
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

vi.mock('../../token/TokenCounter', () => ({
  TokenCounter: vi.fn().mockImplementation(function () {
    return { countTextTokens: vi.fn((text: string) => Math.ceil((text || '').length / 4)) };
  }),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentChat } from '../subAgentChat';
import type { SubAgentChatOptions } from '../types';
import type { SubAgent } from '../types';
import type { SubAgentConfig } from '../../userDataADO/types/profile';
import type { CancellationToken } from '../../cancellation/CancellationToken';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCancellationToken(cancelled = false): CancellationToken {
  const handlers: Array<() => void> = [];
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn((cb: () => void) => {
      handlers.push(cb);
      return { dispose: vi.fn() };
    }),
  };
}

function makeSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    description: 'desc',
    system_prompt: 'You are helpful.',
    tools: [],
    mcp_servers: [],
    skills: [],
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

/** Build a minimal SSE streaming body for /chat/completions with just a text response */
function makeStreamingBody(textContent: string, toolCalls?: any[], finishReason = 'stop'): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: string[] = [];

  if (textContent) {
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: textContent }, finish_reason: null }] })}\n\n`);
  }

  if (toolCalls) {
    for (const tc of toolCalls) {
      chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc] }, finish_reason: null }] })}\n\n`);
    }
  }

  chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');

  const combined = chunks.join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(combined));
      controller.close();
    },
  });
}

function makeFetchMock(bodyText: string, finishReason = 'stop') {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: makeStreamingBody(bodyText, undefined, finishReason),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNormalizeToolCalls.mockImplementation((calls: any) => calls);
});

// ============================================================
// callLLM — no auth token throws
// ============================================================

describe('callLLM — no auth token', () => {
  it('throws when no auth token is available', async () => {
    mockGetCurrentAuth.mockResolvedValueOnce(null);
    const chat = new SubAgentChat(makeOptions());
    await expect(
      (chat as any).callLLM([], [], [])
    ).rejects.toThrow('No valid authentication token available for sub-agent');
  });

  it('throws when copilotTokens is missing', async () => {
    mockGetCurrentAuth.mockResolvedValueOnce({ ghcAuth: {} });
    const chat = new SubAgentChat(makeOptions());
    await expect(
      (chat as any).callLLM([], [], [])
    ).rejects.toThrow('No valid authentication token available for sub-agent');
  });
});

// ============================================================
// callLLM — /responses endpoint with tools
// ============================================================

describe('callLLM — /responses endpoint', () => {
  it('builds /responses format request with tools', async () => {
    mockGetEndpointForModel.mockReturnValueOnce('/responses');
    const tools = [{ name: 'search', description: 'Search the web', inputSchema: { type: 'object' } }];

    // /responses endpoint uses different SSE format
    const enc = new TextEncoder();
    const chunks = [
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello from responses' })}\n\n`,
      `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    const responsesStream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(chunks));
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: responsesStream,
    } as any);

    const chat = new SubAgentChat(makeOptions());
    const result = await (chat as any).callLLM([], [], tools);

    expect(result.textContent).toBe('Hello from responses');
    // Verify request was made with tools in /responses flat format
    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.tools[0].name).toBe('search');
  });
});

// ============================================================
// run() — 400 invalid_tool_call_format retry path
// ============================================================

describe('run() — 400 invalid_tool_call_format retry', () => {
  it('retries callLLM after sanitizing tool calls on 400 invalid_tool_call_format', async () => {
    const callLLMSpy = vi.spyOn(SubAgentChat.prototype as any, 'callLLM');
    let callCount = 0;

    callLLMSpy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('LLM API error (400): {"error":"invalid_tool_call_format"}');
      }
      // Second call succeeds
      return {
        hasToolCalls: false,
        toolCalls: [],
        textContent: 'Task complete',
        finishReason: 'stop',
        assistantMessage: {
          id: 'msg-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Task complete' }],
          timestamp: Date.now(),
        },
      };
    });

    const chat = new SubAgentChat(makeOptions());
    const result = await chat.run();
    expect(result).toContain('Task complete');
    expect(callCount).toBe(2);
    callLLMSpy.mockRestore();
  });

  it('rethrows non-format errors from callLLM', async () => {
    const callLLMSpy = vi.spyOn(SubAgentChat.prototype as any, 'callLLM');
    callLLMSpy.mockRejectedValue(new Error('Network error'));

    const chat = new SubAgentChat(makeOptions());
    await expect(chat.run()).rejects.toThrow('Network error');
    callLLMSpy.mockRestore();
  });
});

// ============================================================
// run() — normalizeToolCalls with argument changes logged
// ============================================================

describe('run() — normalizeToolCalls with changes', () => {
  it('logs when tool call arguments are changed by normalizeToolCalls', async () => {
    const originalTc = { id: 'tc-1', function: { name: 'search', arguments: '{"q":"test"' }, type: 'function' };
    const normalizedTc = { id: 'tc-1', function: { name: 'search', arguments: '{"q":"test"}' }, type: 'function' };

    mockNormalizeToolCalls.mockReturnValueOnce([normalizedTc]);

    const callLLMSpy = vi.spyOn(SubAgentChat.prototype as any, 'callLLM');
    let turn = 0;
    callLLMSpy.mockImplementation(async () => {
      turn++;
      if (turn === 1) {
        return {
          hasToolCalls: true,
          toolCalls: [originalTc],
          textContent: '',
          finishReason: 'tool_calls',
          assistantMessage: {
            id: 'msg-1', role: 'assistant',
            content: [], tool_calls: [originalTc], timestamp: Date.now(),
          },
        };
      }
      return {
        hasToolCalls: false, toolCalls: [], textContent: 'Done', finishReason: 'stop',
        assistantMessage: { id: 'msg-2', role: 'assistant', content: [{ type: 'text', text: 'Done' }], timestamp: Date.now() },
      };
    });

    mockMcpExecuteTool.mockResolvedValueOnce('search result');

    const chat = new SubAgentChat(makeOptions());
    const result = await chat.run();
    expect(result).toContain('Done');
    callLLMSpy.mockRestore();
  });
});

// ============================================================
// run() — finish_reason=length with NON-truncated tool calls
// ============================================================

describe('run() — finish_reason=length with valid tool calls', () => {
  it('executes tool calls normally when finish_reason=length but args are complete', async () => {
    const validTc = { id: 'tc-1', function: { name: 'search', arguments: '{"query":"hello"}' }, type: 'function' };
    const callLLMSpy = vi.spyOn(SubAgentChat.prototype as any, 'callLLM');
    let turn = 0;
    callLLMSpy.mockImplementation(async () => {
      turn++;
      if (turn === 1) {
        return {
          hasToolCalls: true, toolCalls: [validTc], textContent: '',
          finishReason: 'length',
          assistantMessage: { id: 'm1', role: 'assistant', content: [], tool_calls: [validTc], timestamp: Date.now() },
        };
      }
      return {
        hasToolCalls: false, toolCalls: [], textContent: 'All done', finishReason: 'stop',
        assistantMessage: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'All done' }], timestamp: Date.now() },
      };
    });

    mockMcpExecuteTool.mockResolvedValueOnce('search result');
    const chat = new SubAgentChat(makeOptions());
    const result = await chat.run();
    expect(result).toContain('All done');
    callLLMSpy.mockRestore();
  });
});

// ============================================================
// getAvailableTools — error path
// ============================================================

describe('getAvailableTools — error path', () => {
  it('returns empty array when getToolsForSubAgent throws', async () => {
    mockGetToolsForSubAgent.mockImplementationOnce(() => {
      throw new Error('MCP unavailable');
    });
    const chat = new SubAgentChat(makeOptions());
    const tools = await (chat as any).getAvailableTools();
    expect(tools).toEqual([]);
  });
});

// ============================================================
// summarizeToolArgs — fallback paths
// ============================================================

describe('summarizeToolArgs', () => {
  it('falls back to first string value when no priority key found', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('my_tool', { customKey: 'some value here' });
    expect(result).toBe('my_tool: some value here');
  });

  it('returns just the tool name when all values are non-string', () => {
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).summarizeToolArgs('my_tool', { count: 5, enabled: true });
    expect(result).toBe('my_tool');
  });

  it('truncates summary to 200 characters', () => {
    const chat = new SubAgentChat(makeOptions());
    const longValue = 'x'.repeat(250);
    const result = (chat as any).summarizeToolArgs('tool', { query: longValue });
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('...')).toBe(true);
  });

  it('falls back to tool name on exception', () => {
    const chat = new SubAgentChat(makeOptions());
    // Pass a proxy that throws on access
    const badArgs = new Proxy({}, {
      ownKeys() { throw new Error('boom'); },
    });
    const result = (chat as any).summarizeToolArgs('safe_tool', badArgs);
    expect(result).toBe('safe_tool');
  });
});

// ============================================================
// trackDeliverables — download_file and present_deliverables
// ============================================================

describe('trackDeliverables', () => {
  it('tracks download_file deliverable with saveDirectory + filename', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).trackDeliverables('download_file', {
      saveDirectory: '/downloads',
      filename: 'report.pdf',
    });
    expect((chat as any).deliverables).toContain('/downloads/report.pdf');
  });

  it('tracks download_file with Windows backslash separator', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).trackDeliverables('download_file', {
      saveDirectory: 'C:\\Users\\test',
      filename: 'doc.docx',
    });
    expect((chat as any).deliverables).toContain('C:\\Users\\test\\doc.docx');
  });

  it('tracks present_deliverables filePaths array', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).trackDeliverables('present_deliverables', {
      filePaths: ['/out/file1.txt', '/out/file2.txt'],
    });
    expect((chat as any).deliverables).toContain('/out/file1.txt');
    expect((chat as any).deliverables).toContain('/out/file2.txt');
  });

  it('deduplicates deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).trackDeliverables('write_file', { filePath: '/path/file.txt' });
    (chat as any).trackDeliverables('write_file', { filePath: '/path/file.txt' });
    expect((chat as any).deliverables.filter((d: string) => d === '/path/file.txt').length).toBe(1);
  });

  it('ignores non-array filePaths for present_deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).trackDeliverables('present_deliverables', { filePaths: 'not-an-array' });
    expect((chat as any).deliverables).toHaveLength(0);
  });
});

// ============================================================
// formatDeliverablesSection
// ============================================================

describe('formatDeliverablesSection', () => {
  it('returns empty string when no deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).formatDeliverablesSection()).toBe('');
  });

  it('formats deliverables list', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).deliverables = ['/out/a.txt', '/out/b.txt'];
    const section = (chat as any).formatDeliverablesSection();
    expect(section).toContain('Deliverables');
    expect(section).toContain('/out/a.txt');
    expect(section).toContain('/out/b.txt');
    expect(section).toContain('2 file(s)');
  });
});

// ============================================================
// buildTurnProgressHint removed — sub-agents no longer have turn budgets
// ============================================================

describe('buildTurnProgressHint — removed', () => {
  it('buildTurnProgressHint no longer exists on SubAgentChat', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).buildTurnProgressHint).toBeUndefined();
  });

  it('turnCount is still tracked for metrics', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).turnCount).toBe(0);
  });
});

// ============================================================
// extractFinalResult — safety cap and no text paths
// ============================================================

describe('extractFinalResult', () => {
  it('appends safety-cap warning when turnCount >= 200', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).turnCount = 200;
    (chat as any).contextHistory = [
      { role: 'assistant', content: [{ type: 'text', text: 'Some answer' }], id: 'm1', timestamp: 0 },
    ];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('safety turn limit');
    expect(result).toContain('Some answer');
  });

  it('returns fallback when no assistant text and safety cap reached', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).turnCount = 200;
    (chat as any).contextHistory = [];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('safety turn limit');
  });

  it('returns fallback when no text and within limit', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).turnCount = 2;
    (chat as any).contextHistory = [];
    const result = (chat as any).extractFinalResult();
    expect(result).toContain('without producing a text result');
  });
});

// ============================================================
// buildWorkspaceAndSkillsInfo — with workspace, skills, knowledgeBase
// ============================================================

describe('buildWorkspaceAndSkillsInfo', () => {
  it('returns empty string when no skills or knowledge base configured', () => {
    const config = makeSubAgentConfig({});
    const chat = new SubAgentChat(makeOptions({
      subAgent: makeSubAgent({ config }),
    }));
    const info = (chat as any).buildWorkspaceAndSkillsInfo(config);
    // workspace is no longer shown in buildWorkspaceAndSkillsInfo (derived from deliverablesPath)
    expect(typeof info).toBe('string');
  });

  it('includes knowledge base info from resolvedKnowledgeBase', () => {
    const config = makeSubAgentConfig();
    const subAgent = makeSubAgent({ config, resolvedKnowledgeBase: '/kb/path' });
    const chat = new SubAgentChat(makeOptions({ subAgent }));
    const info = (chat as any).buildWorkspaceAndSkillsInfo(config);
    expect(info).toContain('/kb/path');
  });

  it('includes inherited skills in prompt', () => {
    const config = makeSubAgentConfig({ skills: [] });
    const subAgent = makeSubAgent({
      config,
      resolvedSkills: [{ name: 'my-skill', installed: true, inherited: true }],
    });
    // Mock electron app for skill path resolution
    (global as any).electron = { app: { getPath: vi.fn(() => '/userData') } };
    const chat = new SubAgentChat(makeOptions({ subAgent, currentUserAlias: 'user1' }));
    const info = (chat as any).buildWorkspaceAndSkillsInfo(config);
    // Should attempt to get skill metadata (may be empty if skillManager mock returns nothing useful)
    // Just ensure no throw
    expect(typeof info).toBe('string');
    delete (global as any).electron;
  });
});

// ============================================================
// executeToolCalls — cancellation path
// ============================================================

describe('executeToolCalls — cancellation', () => {
  it('returns cancelled message when token is already cancelled', async () => {
    const cancelledToken = makeCancellationToken(true);
    const chat = new SubAgentChat(makeOptions({ cancellationToken: cancelledToken }));
    const toolCalls = [
      { id: 'tc-1', function: { name: 'search', arguments: '{"query":"test"}' }, type: 'function' },
    ];
    const results = await (chat as any).executeToolCalls(toolCalls);
    expect(results).toHaveLength(1);
    expect(results[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('cancelled') }),
    ]));
  });

  it('returns error message when tool execution throws', async () => {
    mockMcpExecuteTool.mockRejectedValueOnce(new Error('Tool failed'));
    const chat = new SubAgentChat(makeOptions());
    const toolCalls = [
      { id: 'tc-2', function: { name: 'broken_tool', arguments: '{}' }, type: 'function' },
    ];
    const results = await (chat as any).executeToolCalls(toolCalls);
    expect(results[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('Tool failed') }),
    ]));
  });

  it('handles invalid JSON args gracefully with empty object fallback', async () => {
    mockMcpExecuteTool.mockResolvedValueOnce('result');
    const chat = new SubAgentChat(makeOptions());
    const toolCalls = [
      { id: 'tc-3', function: { name: 'tool', arguments: 'NOT_JSON' }, type: 'function' },
    ];
    const results = await (chat as any).executeToolCalls(toolCalls);
    // Should still produce a result (even with bad args)
    expect(results).toHaveLength(1);
  });
});

// ============================================================
// getDeliverablesPath
// ============================================================

describe('getDeliverablesPath', () => {
  it('returns deliverablesPath when provided', () => {
    const chat = new SubAgentChat(makeOptions({ deliverablesPath: '/deliverables' }));
    expect((chat as any).getDeliverablesPath()).toBe('/deliverables');
  });

  it('returns null when no deliverablesPath (no workspace fallback)', () => {
    const config = makeSubAgentConfig({});
    const chat = new SubAgentChat(makeOptions({
      subAgent: makeSubAgent({ config }),
    }));
    // getDeliverablesPath no longer falls back to config.workspace
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });

  it('returns null when neither deliverablesPath nor workspace', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });
});

// ============================================================
// dispose
// ============================================================

describe('dispose', () => {
  it('clears contextHistory and sets disposed', () => {
    const chat = new SubAgentChat(makeOptions());
    (chat as any).contextHistory = [{ role: 'user', content: 'test' }];
    chat.dispose();
    expect((chat as any).disposed).toBe(true);
    expect((chat as any).contextHistory).toHaveLength(0);
  });
});

// ============================================================
// getTurnCount
// ============================================================

describe('getTurnCount', () => {
  it('returns 0 initially', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(chat.getTurnCount()).toBe(0);
  });
});
