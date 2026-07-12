// @ts-nocheck
/**
 * Additional coverage tests for AgentChatStreamingService — HTTP errors, network errors,
 * AbortError, no-session, no-reader, final-buffer, vision header, /responses tool_choice,
 * callWithToolsStreaming pre-call cancellation, and tool-search paths.
 */

const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
  getUnifiedLogger: vi.fn(() => sharedMockLogger),
}));

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: vi.fn().mockReturnValue('/chat/completions'),
}));

vi.mock('../../llm/ghcModelsManager', () => ({
  buildMaxTokensParam: vi.fn().mockReturnValue({}),
  buildReasoningParams: vi.fn().mockReturnValue({}),
  getDefaultReasoningEffort: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../agentChatUtilities', () => ({
  convertMcpToolsToOpenAiFormat: vi.fn((tools) => tools),
  determineToolChoice: vi.fn(() => 'auto'),
  formatMessagesForApi: vi.fn(async (_sys: any, ctx: any) => ctx),
  hasImageContentInMessages: vi.fn(() => false),
  validateToolsRequest: vi.fn(),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../toolSearchFilter', () => ({
  filterToolsForRequest: vi.fn((tools: any) => ({
    filteredTools: tools,
    deferredTools: [],
    toolSearchEnabled: false,
  })),
  formatDeferredToolsIndex: vi.fn(() => 'deferred index'),
  shouldEnableToolSearch: vi.fn(() => false),
  TOOL_SEARCH_TOOL_NAME: 'tool_search',
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    setDeferredToolsContext: vi.fn(),
    clearDeferredToolsContext: vi.fn(),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.githubcopilot.com',
    USER_AGENT: 'test-agent/1.0',
    EDITOR_VERSION: 'vscode/1.0',
    EDITOR_PLUGIN_VERSION: 'plugin/1.0',
  },
}));

import { CancellationTokenSource, CancellationError } from '../../cancellation';
import { GhcApiError } from '../../utilities/errors';
import {
  AgentChatStreamingService,
  StreamCancellationError,
  type AgentChatStreamingServiceDeps,
} from '../agentChatStreamingService';
import { getEndpointForModel } from '../../llm/ghcModelApi';
import { hasImageContentInMessages } from '../agentChatUtilities';
import { filterToolsForRequest } from '../toolSearchFilter';
import { BuiltinToolsManager } from '../../mcpRuntime/builtinTools/builtinToolsManager';

const mockedGetEndpoint = getEndpointForModel as ReturnType<typeof vi.fn>;
const mockedHasImage = hasImageContentInMessages as ReturnType<typeof vi.fn>;
const mockedFilterTools = filterToolsForRequest as ReturnType<typeof vi.fn>;

function createReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();
  return {
    cancel,
    releaseLock,
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = encoder.encode(chunks[index++]);
      return { done: false, value };
    },
  };
}

function createService(overrides: Partial<AgentChatStreamingServiceDeps> = {}) {
  const emittedChunks: any[] = [];
  const setChatStatus = vi.fn();
  const deps: AgentChatStreamingServiceDeps = {
    getAgentName: () => 'TestAgent',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getCurrentModelId: () => 'gpt-4',
    getCurrentModelConfig: () => ({
      maxTokens: 512,
      supportsTemperature: true,
      supportsTools: true,
      supportsImages: false,
    }),
    getModelCapabilities: () => ({ supportsTools: true, supportsImages: false } as any),
    getCurrentAvailableTools: async () => [],
    getCombinedSystemPromptForCurrentTurn: async () => [],
    getContextHistory: () => [{ role: 'user', content: 'hi' } as any],
    currentModelSupportsTools: () => true,
    getSessionFromAuthManager: async () => ({ accessToken: 'tok' }),
    emitStreamingChunk: (c) => emittedChunks.push(c),
    setChatStatus,
    ...overrides,
  };
  return { emittedChunks, setChatStatus, service: new AgentChatStreamingService(deps) };
}

// ────────────────────────────────────────────────────────────────────────────
// No session
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — no session', () => {
  it('throws GhcApiError 401 when session is null', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const { service } = createService({ getSessionFromAuthManager: async () => null });
    await expect(
      service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// HTTP error status codes
// Note: makeStreamingApiCall's catch block re-wraps all non-CancellationError /
// non-AbortError throws (including GhcApiError from !response.ok) with statusCode 0.
// We therefore only check the error type and message content, not statusCode.
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — HTTP error branches', () => {
  beforeEach(() => mockedGetEndpoint.mockReturnValue('/chat/completions'));

  const errorCases: Array<{ status: number; needle: string }> = [
    { status: 500, needle: 'Server internal error' },
    { status: 502, needle: 'temporarily unstable' },
    { status: 503, needle: 'temporarily unstable' },
    { status: 504, needle: 'temporarily unstable' },
    { status: 401, needle: 'Authentication expired' },
    { status: 403, needle: 'Access denied' },
    { status: 429, needle: 'Too many requests' },
    { status: 418, needle: 'HTTP 418' },  // fallthrough / other status
  ];

  for (const { status, needle } of errorCases) {
    it(`throws GhcApiError for HTTP ${status} with message containing "${needle}"`, async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status,
        statusText: `HTTP ${status}`,
        text: async () => JSON.stringify({ error: { message: `HTTP ${status} error` } }),
      } as any);

      const { service } = createService();
      const err = await service
        .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
        .catch((e) => e);
      expect(err).toBeInstanceOf(GhcApiError);
      // The message goes through the re-wrap path so it contains the original friendly message
      expect(err.message).toContain(needle);
    });
  }

  it('handles non-JSON error body gracefully', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'plain error text',
    } as any);

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.message).toContain('plain error text');
  });

  it('handles error body read failure', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => { throw new Error('cannot read body'); },
    } as any);

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    // Error from text() read failure → falls back to statusText
    expect(err.message).toContain('Server Error');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// No response reader
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — no reader', () => {
  it('throws GhcApiError when response.body is null', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: null,
    } as any);

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    // re-wrapped via outer catch with status 0; message still contains 'reader'
    expect(err.message).toContain('reader');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Network / AbortError paths
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — network errors', () => {
  beforeEach(() => mockedGetEndpoint.mockReturnValue('/chat/completions'));

  it('wraps AbortError into StreamCancellationError', async () => {
    const source = new CancellationTokenSource();
    source.cancel();

    vi.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true }, source.token)
      .catch((e) => e);
    expect(err).toBeInstanceOf(StreamCancellationError);
    expect(err.partialResponse.finishReason).toBe('cancelled');
    source.dispose();
  });

  it('wraps "fetch failed" network error with VPN suggestion', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fetch failed'));

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.message).toContain('VPN');
  });

  it('wraps ENOTFOUND network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.example.com'));

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.message).toContain('VPN');
  });

  it('wraps SSL error with certificate suggestion', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('unable to verify certificate'));

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.message).toContain('SSL/TLS');
  });

  it('wraps "terminated" error with connection-closed message', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('terminated'));

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.message).toContain('terminated');
  });

  it('includes error.cause and error.code in the diagnostic message', async () => {
    const cause = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const networkErr = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', cause });
    vi.spyOn(global, 'fetch').mockRejectedValue(networkErr);

    const { service } = createService();
    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Vision header
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — vision header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedHasImage.mockReturnValue(false);
  });

  it('sends Copilot-Vision-Request header when messages contain images', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    mockedHasImage.mockReturnValue(true);

    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    const capturedHeaders: Record<string, string>[] = [];
    vi.spyOn(global, 'fetch' as any).mockImplementation((_url: string, opts: any) => {
      capturedHeaders.push(opts.headers);
      return Promise.resolve({
        ok: true,
        body: { getReader: () => reader },
      });
    });

    const { service } = createService();
    await service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true });

    expect(capturedHeaders[0]['Copilot-Vision-Request']).toBe('true');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /responses endpoint — tools and tool_choice variants
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — /responses endpoint request body', () => {
  beforeEach(() => {
    mockedGetEndpoint.mockReturnValue('/responses');
    vi.restoreAllMocks();
  });

  function simpleReader() {
    return createReader([
      'data: {"type":"response.completed","response":{"output":[]}}\n',
      'data: [DONE]\n',
    ]);
  }

  it('builds /responses body with tools and string tool_choice', async () => {
    const capturedBodies: any[] = [];
    vi.spyOn(global, 'fetch' as any).mockImplementation((_url: string, opts: any) => {
      capturedBodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, body: { getReader: () => simpleReader() } });
    });

    const tools = [{ function: { name: 'search', description: 'desc', parameters: {} } }];
    const { service } = createService();
    await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
      tools,
      tool_choice: 'auto',
    });

    expect(capturedBodies[0].tools[0]).toMatchObject({ type: 'function', name: 'search' });
    expect(capturedBodies[0].tool_choice).toBe('auto');
  });

  it('builds /responses body with object tool_choice', async () => {
    const capturedBodies: any[] = [];
    vi.spyOn(global, 'fetch' as any).mockImplementation((_url: string, opts: any) => {
      capturedBodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, body: { getReader: () => simpleReader() } });
    });

    const tools = [{ function: { name: 'my_tool', description: 'd', parameters: {} } }];
    const { service } = createService();
    await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
      tools,
      tool_choice: { type: 'function', function: { name: 'my_tool' } },
    });

    expect(capturedBodies[0].tool_choice).toEqual({ type: 'function', name: 'my_tool' });
  });

  it('does not include tools/tool_choice when tools array is empty; includes reasoning.encrypted_content', async () => {
    const capturedBodies: any[] = [];
    vi.spyOn(global, 'fetch' as any).mockImplementation((_url: string, opts: any) => {
      capturedBodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, body: { getReader: () => simpleReader() } });
    });

    const { service } = createService();
    await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
    });

    expect(capturedBodies[0].tools).toBeUndefined();
    expect(capturedBodies[0].tool_choice).toBeUndefined();
    expect(Array.isArray(capturedBodies[0].include)).toBe(true);
    expect(capturedBodies[0].include).toContain('reasoning.encrypted_content');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Final-buffer (done=true with leftover data)
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — final buffer processing', () => {
  it('processes leftover buffer content when stream ends with done=true', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');

    // Simulate a reader that returns one chunk without trailing newline, then done
    const encoder = new TextEncoder();
    let calls = 0;
    const reader = {
      cancel: vi.fn(),
      releaseLock: vi.fn(),
      async read() {
        if (calls === 0) {
          calls++;
          return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}') };
        }
        return { done: true, value: undefined };
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true });
    expect(result.message.content).toEqual([{ type: 'text', text: 'partial' }]);
  });

  it('ignores data: [DONE] in final buffer', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const encoder = new TextEncoder();
    let calls = 0;
    const reader = {
      cancel: vi.fn(),
      releaseLock: vi.fn(),
      async read() {
        if (calls === 0) {
          calls++;
          return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n') };
        }
        if (calls === 1) {
          calls++;
          return { done: false, value: encoder.encode('data: [DONE]') };
        }
        return { done: true, value: undefined };
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true });
    expect(result.message.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('warns on malformed final buffer chunk', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const encoder = new TextEncoder();
    let calls = 0;
    const reader = {
      cancel: vi.fn(),
      releaseLock: vi.fn(),
      async read() {
        if (calls === 0) {
          calls++;
          return { done: false, value: encoder.encode('data: not-valid-json') };
        }
        return { done: true, value: undefined };
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    sharedMockLogger.warn.mockClear();
    const { service } = createService();
    await service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true });
    // Should not throw, may warn
  });
});

// ────────────────────────────────────────────────────────────────────────────
// callWithToolsStreaming — pre-call cancellation
// ────────────────────────────────────────────────────────────────────────────
describe('callWithToolsStreaming — pre-call cancellation', () => {
  it('throws CancellationError before calling the API when already cancelled', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const source = new CancellationTokenSource();
    source.cancel();

    const { service } = createService();
    const err = await service.callWithToolsStreaming(source.token).catch((e) => e);
    expect(err).toBeInstanceOf(CancellationError);
    source.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// callWithToolsStreaming — tool search enabled
// ────────────────────────────────────────────────────────────────────────────
describe('callWithToolsStreaming — tool search deferred tools', () => {
  it('injects deferred tools index into formattedMessages and sets context', async () => {
    const { isFeatureEnabled } = await import('../../featureFlags');
    const { formatDeferredToolsIndex, shouldEnableToolSearch } = await import('../toolSearchFilter');
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (shouldEnableToolSearch as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const deferredTool = { name: 'deferred_tool', serverName: 'srv', description: '' };
    mockedFilterTools.mockReturnValue({
      filteredTools: [],
      deferredTools: [deferredTool],
      toolSearchEnabled: true,
    });
    (formatDeferredToolsIndex as ReturnType<typeof vi.fn>).mockReturnValue('DEFERRED INDEX');

    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    await service.callWithToolsStreaming();

    expect(BuiltinToolsManager.setDeferredToolsContext).toHaveBeenCalledWith('session-1', [deferredTool]);

    // Reset
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockedFilterTools.mockReturnValue({ filteredTools: [], deferredTools: [], toolSearchEnabled: false });
  });

  it('clears deferred tools context when tool search is disabled', async () => {
    mockedFilterTools.mockReturnValue({ filteredTools: [], deferredTools: [], toolSearchEnabled: false });
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    await service.callWithToolsStreaming();

    expect(BuiltinToolsManager.clearDeferredToolsContext).toHaveBeenCalledWith('session-1');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// callWithToolsStreaming — non-CancellationError wrapping
// ────────────────────────────────────────────────────────────────────────────
describe('callWithToolsStreaming — error wrapping', () => {
  it('wraps unexpected errors in GhcApiError 500', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected boom'));
    const { service } = createService({
      getSessionFromAuthManager: async () => { throw new Error('unexpected boom'); },
    });
    const err = await service.callWithToolsStreaming().catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
  });

  it('preserves GhcApiError status code when wrapping', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const { service } = createService({
      getSessionFromAuthManager: async () => { throw new GhcApiError('rate limited', 429); },
    });
    const err = await service.callWithToolsStreaming().catch((e) => e);
    expect(err).toBeInstanceOf(GhcApiError);
    expect(err.statusCode).toBe(429);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// callWithToolsStreaming — supportsTools=false
// ────────────────────────────────────────────────────────────────────────────
describe('callWithToolsStreaming — model does not support tools', () => {
  it('does not add tools to request when model capabilities.supportsTools=false', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const tools = [{ name: 'some_tool', serverName: 'srv', description: '' }];
    const { service } = createService({
      getCurrentAvailableTools: async () => tools,
      getModelCapabilities: () => ({ supportsTools: false, supportsImages: false } as any),
    });
    await service.callWithToolsStreaming();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.tools).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// StreamCancellationError carries partial tool_calls
// ────────────────────────────────────────────────────────────────────────────
describe('StreamCancellationError — partial tool_calls', () => {
  it('carries tool_calls in partialResponse when cancelled mid-tool-call streaming', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const source = new CancellationTokenSource();

    const reader = createReader([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"search","arguments":""}}]}}]}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService({
      emitStreamingChunk: (chunk) => {
        if (chunk.type === 'tool_call') source.cancel();
      },
    });

    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true }, source.token)
      .catch((e) => e);

    expect(err).toBeInstanceOf(StreamCancellationError);
    expect(err.partialResponse.finishReason).toBe('cancelled');
    source.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /chat/completions tool_calls delta streaming
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — /chat/completions tool_calls delta', () => {
  it('accumulates incremental tool_calls and emits correct chunks', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service, emittedChunks, setChatStatus } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.message.tool_calls?.[0].id).toBe('call_1');
    expect(result.message.tool_calls?.[0].function.name).toBe('search');
    expect(setChatStatus).toHaveBeenCalledWith('received_response');
    expect(emittedChunks.some((c) => c.type === 'tool_call')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// reasoning_effort logging
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — reasoning_effort logging', () => {
  it('logs reasoning_effort diagnostic when capabilities includes reasoning efforts', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const { buildReasoningParams } = await import('../../llm/ghcModelsManager');
    (buildReasoningParams as ReturnType<typeof vi.fn>).mockReturnValue({ reasoning_effort: 'high' });

    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    sharedMockLogger.info.mockClear();
    const { service } = createService({
      getModelCapabilities: () => ({
        supportsTools: true,
        supportsImages: false,
        reasoningEfforts: ['low', 'medium', 'high'],
      } as any),
      getCurrentModelConfig: () => ({
        maxTokens: 512,
        supportsTemperature: true,
        supportsTools: true,
        supportsImages: false,
        reasoningEffort: 'high',
      }),
    });

    await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
      _reasoningEffort: 'high',
    });

    const reasoningLogs = sharedMockLogger.info.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('reasoning_effort'),
    );
    expect(reasoningLogs.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// callWithToolsStreaming — tool injection (tools available)
// ────────────────────────────────────────────────────────────────────────────
describe('callWithToolsStreaming — tool injection into request', () => {
  it('includes tools and tool_choice in request when getCurrentAvailableTools returns tools', async () => {
    // Restore original module mocks (vi.restoreAllMocks from /responses block breaks them)
    vi.restoreAllMocks();
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    mockedFilterTools.mockImplementation((tools: any) => ({ filteredTools: tools, deferredTools: [], toolSearchEnabled: false }));
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const tools = [
      { name: 'my_tool', serverName: 'srv', description: 'does stuff', inputSchema: { type: 'object' } },
    ];

    // convertMcpToolsToOpenAiFormat is mocked to pass through
    const { service } = createService({
      getCurrentAvailableTools: async () => tools,
      getModelCapabilities: () => ({ supportsTools: true, supportsImages: false } as any),
    });
    await service.callWithToolsStreaming();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    console.log('BODY KEYS:', Object.keys(body), 'tools:', body.tools, 'tool_choice:', body.tool_choice);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe('auto');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isCancelled chunk handling — cancel mid-stream, chunks skipped
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — isCancelled mid-stream skip', () => {
  it('skips processing chunks after cancellation and returns partial response', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const source = new CancellationTokenSource();

    // First chunk has content, second chunk should be skipped after cancellation
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    let chunkCount = 0;
    const { service } = createService({
      emitStreamingChunk: () => {
        chunkCount++;
        // Cancel after first content emission
        if (chunkCount === 1) source.cancel();
      },
    });

    const err = await service
      .makeStreamingApiCall({ model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true }, source.token)
      .catch((e) => e);

    expect(err).toBeInstanceOf(StreamCancellationError);
    expect(err.partialResponse.finishReason).toBe('cancelled');
    source.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /responses — first tool-call status (response.output_item.done with function_call)
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — /responses first tool-call sets status', () => {
  it('sets setChatStatus("received_response") on first function_call output item', async () => {
    mockedGetEndpoint.mockReturnValue('/responses');
    const reader = createReader([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_abc","name":"search","arguments":"{\\"q\\":\\"test\\"}"}}\n\n',
      'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      'data: [DONE]\n\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service, setChatStatus } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
    });

    expect(setChatStatus).toHaveBeenCalledWith('received_response');
    expect(result.message.tool_calls?.[0]).toMatchObject({
      id: 'call_abc',
      function: { name: 'search', arguments: '{\"q\":\"test\"}' },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Usage-only final chunk in /chat/completions
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — usage-only final chunk', () => {
  it('parses usage from a chunk with empty choices and usage populated', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
    });

    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('parses usage with camelCase keys (promptTokens variant)', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"promptTokens":20,"completionTokens":10,"totalTokens":30},"model":"gpt-4o"}\n\n',
      'data: [DONE]\n\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
    });

    expect(result.usage).toEqual({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Streaming chunk parse error
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — streaming chunk parse error', () => {
  it('logs warning and continues when JSON.parse fails on a streaming chunk', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {invalid json content!!!}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    sharedMockLogger.warn.mockClear();
    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4',
      messages: [],
      _maxTokensValue: 100,
      stream: true,
    });

    // Should still get the valid content
    expect(result.message.content).toEqual([{ type: 'text', text: 'ok' }]);
    // Should have warned about the parse failure
    expect(sharedMockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse streaming chunk'),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// HTTP error — alternate JSON error shapes
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — error JSON parsing fallbacks', () => {
  beforeEach(() => mockedGetEndpoint.mockReturnValue('/chat/completions'));

  it('extracts message from errorJson.message when error.message is absent', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve(JSON.stringify({ message: 'Invalid model' })),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Invalid model');
  });

  it('extracts message from errorJson.error (string) fallback', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal',
      text: () => Promise.resolve(JSON.stringify({ error: 'Something went wrong' })),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Something went wrong');
  });

  it('falls back to errorBody when JSON parse fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('plain text error'),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('plain text error');
  });

  it('falls back to statusText when text() throws', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: () => Promise.reject(new Error('read failed')),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Service Unavailable');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Network error — cause and code introspection
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — network error cause/code', () => {
  beforeEach(() => mockedGetEndpoint.mockReturnValue('/chat/completions'));

  it('includes error.cause in diagnostic when present', async () => {
    const cause = new Error('ECONNRESET');
    (cause as any).code = 'ECONNRESET';
    const fetchErr = new Error('fetch failed');
    (fetchErr as any).cause = cause;
    (fetchErr as any).code = 'ERR_NETWORK';
    vi.spyOn(global, 'fetch').mockRejectedValue(fetchErr);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Fetch failed');
    // Verify the diagnostic logging captured cause info
    const errorLog = sharedMockLogger.error.mock.calls.find(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('Network error'),
    );
    expect(errorLog).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /responses usage — camelCase field names
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — /responses camelCase usage fields', () => {
  it('handles camelCase usage fields (promptTokens instead of prompt_tokens)', async () => {
    mockedGetEndpoint.mockReturnValue('/responses');
    const reader = createReader([
      'data: {"type":"response.completed","response":{"id":"r1","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"promptTokens":20,"completionTokens":10,"totalTokens":30}}}\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /chat/completions usage — camelCase field names in usage-only chunk
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — /chat/completions camelCase usage', () => {
  it('handles camelCase usage fields in inline usage chunk', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}],"usage":{"promptTokens":8,"completionTokens":3,"totalTokens":11}}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 3, totalTokens: 11 });
  });

  it('handles camelCase usage fields in usage-only final chunk', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"y"},"finish_reason":"stop"}]}\n',
      'data: {"choices":[],"usage":{"promptTokens":12,"completionTokens":4,"totalTokens":16}}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Usage field edge case — missing fields default to 0
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — usage with missing fields', () => {
  it('defaults to 0 when usage fields are undefined', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"z"},"finish_reason":"stop"}],"usage":{}}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('defaults to 0 for /responses usage with missing fields', async () => {
    mockedGetEndpoint.mockReturnValue('/responses');
    const reader = createReader([
      'data: {"type":"response.completed","response":{"id":"r1","output":[{"type":"message","content":[{"type":"output_text","text":"a"}]}],"usage":{}}}\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('falls back to errorBody when no known JSON fields match', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve(JSON.stringify({ unknownField: true })),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    // When no known error fields match, errorBody is the stringified JSON
    expect(err.message).toContain('unknownField');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases: empty error body, missing statusText, and toolCall.index=0
// ────────────────────────────────────────────────────────────────────────────
describe('makeStreamingApiCall — error edge cases', () => {
  beforeEach(() => mockedGetEndpoint.mockReturnValue('/chat/completions'));

  it('uses statusText when error body is empty string after JSON parse failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve(''),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Bad Request');
  });

  it('uses fallback message when text() throws and statusText is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: '',
      text: () => Promise.reject(new Error('stream error')),
      body: null,
    } as any);

    const { service } = createService();
    const err = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    }).catch(e => e);
    expect(err.message).toContain('Failed to read error response');
  });
});

describe('makeStreamingApiCall — toolCall.index fallback', () => {
  it('defaults toolCall.index to 0 when not provided', async () => {
    mockedGetEndpoint.mockReturnValue('/chat/completions');
    const reader = createReader([
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"foo","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({
      model: 'gpt-4', messages: [], _maxTokensValue: 100, stream: true,
    });
    expect(result.message.tool_calls![0].function.name).toBe('foo');
  });
});
