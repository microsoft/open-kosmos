const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
  createConsoleLogger: vi.fn(() => sharedMockLogger),
  getUnifiedLogger: vi.fn(() => sharedMockLogger),
  createHighPerformanceLogger: vi.fn(() => sharedMockLogger),
  createDebugLogger: vi.fn(() => sharedMockLogger),
  getRefactoredLogger: vi.fn(() => sharedMockLogger),
  getGlobalLogger: vi.fn(() => sharedMockLogger),
  initializeGlobalLogger: vi.fn(() => sharedMockLogger),
  resetGlobalLogger: vi.fn(),
  isGlobalLoggerInitialized: vi.fn(() => false),
  default: vi.fn(() => sharedMockLogger),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

vi.mock('../agentChatUtilities', async () => ({
  convertMcpToolsToOpenAiFormat: vi.fn((tools) => tools),
  determineToolChoice: vi.fn(() => 'auto'),
  formatMessagesForApi: vi.fn(async (_systemMessages, contextHistory) => contextHistory),
  hasImageContentInMessages: vi.fn(() => false),
  validateToolsRequest: vi.fn(),
}));

import type { StreamingChunk } from '@shared/types/streamingTypes';
import { CancellationError, CancellationTokenSource } from '../../cancellation';
import { getEndpointForModel } from '../../llm/ghcModelApi';
import { AgentChatStreamingService, type AgentChatStreamingServiceDeps } from '../agentChatStreamingService';

const mockedGetEndpointForModel = getEndpointForModel as MockedFunction<typeof getEndpointForModel>;

function createReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();

  return {
    cancel,
    releaseLock,
    async read() {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }

      const value = encoder.encode(chunks[index]);
      index += 1;
      return { done: false, value };
    },
  };
}

function createService(overrides: Partial<AgentChatStreamingServiceDeps> = {}) {
  const emittedChunks: StreamingChunk[] = [];
  const setChatStatus = vi.fn();

  const deps: AgentChatStreamingServiceDeps = {
    getAgentName: () => 'OpenKosmos',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getCurrentModelId: () => 'gpt-5',
    getCurrentModelConfig: () => ({
      maxTokens: 1024,
      supportsTemperature: true,
      supportsTools: true,
      supportsImages: false,
    }),
    getModelCapabilities: () => ({
      supportsTools: true,
      supportsImages: false,
    } as any),
    getCurrentAvailableTools: async () => [],
    getCombinedSystemPromptForCurrentTurn: async () => [],
    getContextHistory: () => [{ role: 'user', content: 'hello' } as any],
    currentModelSupportsTools: () => true,
    getSessionFromAuthManager: async () => ({ accessToken: 'token' }),
    emitStreamingChunk: (chunk) => {
      emittedChunks.push(chunk);
    },
    setChatStatus,
    ...overrides,
  };

  return {
    emittedChunks,
    setChatStatus,
    service: new AgentChatStreamingService(deps),
  };
}

describe('AgentChatStreamingService', () => {
  afterEach(() => {
    mockedGetEndpointForModel.mockReset();
    vi.restoreAllMocks();
  });

  it('parses /responses SSE text and tool-call events into chunks and final tool_calls', async () => {
    mockedGetEndpointForModel.mockReturnValue('/responses' as any);
    const reader = createReader([
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"search_docs","arguments":"{\\"q\\":\\"test\\"}"}}\n',
      'data: {"type":"response.completed","response":{"output":[{"type":"function_call"}]}}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service, emittedChunks, setChatStatus } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.message.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'search_docs',
          arguments: '{"q":"test"}',
        },
      },
    ]);
    expect(setChatStatus).toHaveBeenCalledWith('received_response');
    expect(emittedChunks.map((chunk) => chunk.type)).toEqual(['content', 'tool_call', 'complete']);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('parses /chat/completions content deltas and marks first response arrival', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service, emittedChunks, setChatStatus } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.finishReason).toBe('stop');
    expect(result.message.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(setChatStatus).toHaveBeenCalledTimes(1);
    expect(setChatStatus).toHaveBeenCalledWith('received_response');
    expect(emittedChunks.map((chunk) => chunk.type)).toEqual(['content', 'content', 'complete']);
  });

  it('extracts usage and model from /chat/completions usage-only final chunk', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    // The usage-only chunk has choices: [] (empty array) — this is the key scenario
    const reader = createReader([
      'data: {"model":"gpt-4.1-2025-04-14","choices":[{"delta":{"content":"Hi"}}]}\n',
      'data: {"model":"gpt-4.1-2025-04-14","choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      'data: {"model":"gpt-4.1-2025-04-14","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    expect(result.model).toBe('gpt-4.1-2025-04-14');
  });

  it('extracts usage and model from /chat/completions when usage is on a delta chunk', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    // Some providers put usage on the same chunk as the last delta
    const reader = createReader([
      'data: {"model":"claude-sonnet-4","choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":10,"total_tokens":60}}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.usage).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });
    expect(result.model).toBe('claude-sonnet-4');
  });

  it('extracts usage and model from /responses completed event', async () => {
    mockedGetEndpointForModel.mockReturnValue('/responses' as any);
    const reader = createReader([
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
      'data: {"type":"response.completed","response":{"model":"claude-opus-4.6","output":[],"usage":{"prompt_tokens":200,"completion_tokens":80,"total_tokens":280}}}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
    });
    expect(result.model).toBe('claude-opus-4.6');
  });

  it('returns undefined usage and model when API does not include them', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    const result = await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    expect(result.usage).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  it('includes stream_options for /chat/completions requests', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    const reader = createReader(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n', 'data: [DONE]\n']);
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService();
    await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

    const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
    // gpt-5 models must use max_completion_tokens, not max_tokens
    expect(requestBody.max_completion_tokens).toBe(100);
    expect(requestBody.max_tokens).toBeUndefined();
    // internal key must not leak into the request body
    expect(requestBody._maxTokensValue).toBeUndefined();
  });

  it('throws CancellationError during streaming and cancels the reader when the token is cancelled', async () => {
    mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
    const source = new CancellationTokenSource();
    const reader = createReader([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: [DONE]\n',
    ]);

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as any);

    const { service } = createService({
      emitStreamingChunk: (chunk) => {
        if (chunk.type === 'content') {
          source.cancel();
        }
      },
    });

    await expect(
      service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true }, source.token),
    ).rejects.toBeInstanceOf(CancellationError);

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  describe('callWithToolsStreaming - tool limit', () => {
    it('throws GhcApiError when tools exceed 128', async () => {
      const { validateToolsRequest } = await import('../agentChatUtilities');
      const mockedValidate = validateToolsRequest as MockedFunction<typeof validateToolsRequest>;
      mockedValidate.mockImplementation(() => {
        throw new Error('Cannot have more than 128 tools. Current: 248');
      });

      const tools = Array.from({ length: 248 }, (_, i) => ({ name: `tool_${i}` }));
      const { service } = createService({
        getCurrentAvailableTools: async () => tools,
      });

      await expect(service.callWithToolsStreaming()).rejects.toThrow(
        'Tool limit exceeded: this agent has 248 tools, but the maximum is 128. Please disconnect some MCP servers and retry.'
      );

      mockedValidate.mockReset();
    });

    it('falls back to no tools for non-limit tool errors', async () => {
      const { validateToolsRequest } = await import('../agentChatUtilities');
      const mockedValidate = validateToolsRequest as MockedFunction<typeof validateToolsRequest>;
      mockedValidate.mockImplementation(() => {
        throw new Error('Invalid tool name "foo bar"');
      });

      mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
      const tools = [{ name: 'foo bar' }];

      const reader = createReader([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
        'data: [DONE]\n',
      ]);
      vi.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      } as any);

      const { service } = createService({
        getCurrentAvailableTools: async () => tools,
      });

      // Should NOT throw — falls back gracefully
      const result = await service.callWithToolsStreaming();
      expect(result.message.content).toEqual([{ type: 'text', text: 'Hi' }]);

      mockedValidate.mockReset();
    });
  });

  describe('reasoning_effort injection', () => {
    function setupFetchSpy() {
      const reader = createReader([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
        'data: [DONE]\n',
      ]);
      return vi.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      } as any);
    }

    function parseRequestBody(spy: ReturnType<typeof setupFetchSpy>): any {
      const call = spy.mock.calls[0] as any[];
      const init = call[1] as RequestInit;
      return JSON.parse(init.body as string);
    }

    it('injects reasoning_effort (flat form) for /chat/completions when capabilities support it', async () => {
      mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
      const fetchSpy = setupFetchSpy();

      const { service } = createService({
        getCurrentModelConfig: () => ({
          maxTokens: 1024,
          supportsTemperature: true,
          supportsTools: true,
          supportsImages: false,
          reasoningEffort: 'high',
        }),
        getModelCapabilities: () => ({
          supportsTools: true,
          supportsImages: false,
          reasoningEfforts: ['low', 'medium', 'high'],
        } as any),
      });

      await service.callWithToolsStreaming();

      const body = parseRequestBody(fetchSpy);
      expect(body.reasoning_effort).toBe('high');
      expect(body.reasoning).toBeUndefined();
    });

    it('injects nested reasoning.effort for /responses when capabilities support it', async () => {
      mockedGetEndpointForModel.mockReturnValue('/responses' as any);
      const fetchSpy = setupFetchSpy();

      const { service } = createService({
        getCurrentModelConfig: () => ({
          maxTokens: 1024,
          supportsTemperature: true,
          supportsTools: true,
          supportsImages: false,
          reasoningEffort: 'medium',
        }),
        getModelCapabilities: () => ({
          supportsTools: true,
          supportsImages: false,
          reasoningEfforts: ['low', 'medium', 'high'],
        } as any),
      });

      await service.callWithToolsStreaming();

      const body = parseRequestBody(fetchSpy);
      expect(body.reasoning).toEqual({ effort: 'medium' });
      expect(body.reasoning_effort).toBeUndefined();
    });

    it('does NOT inject reasoning fields when the model has no supported efforts (gating)', async () => {
      mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
      const fetchSpy = setupFetchSpy();

      const { service } = createService({
        getCurrentModelConfig: () => ({
          maxTokens: 1024,
          supportsTemperature: true,
          supportsTools: true,
          supportsImages: false,
          reasoningEffort: 'high',
        }),
        getModelCapabilities: () => ({
          supportsTools: true,
          supportsImages: false,
          // reasoningEfforts intentionally omitted → model does not support effort param.
        } as any),
      });

      await service.callWithToolsStreaming();

      const body = parseRequestBody(fetchSpy);
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.reasoning).toBeUndefined();
    });

    it('injects vendor-aware default reasoning_effort when reasoningEffort is undefined (model=gpt-5 → medium)', async () => {
      mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
      const fetchSpy = setupFetchSpy();

      const { service } = createService({
        getCurrentModelConfig: () => ({
          maxTokens: 1024,
          supportsTemperature: true,
          supportsTools: true,
          supportsImages: false,
          // reasoningEffort intentionally omitted — user didn't pick.
        }),
        getModelCapabilities: () => ({
          supportsTools: true,
          supportsImages: false,
          reasoningEfforts: ['low', 'medium', 'high'],
        } as any),
      });

      await service.callWithToolsStreaming();

      const body = parseRequestBody(fetchSpy);
      // Model is gpt-5 → default is 'medium', and it IS sent to the API.
      expect(body.reasoning_effort).toBe('medium');
    });

    it('passes through new tiers (e.g. minimal, xhigh) advertised by the model', async () => {
      mockedGetEndpointForModel.mockReturnValue('/chat/completions' as any);
      const fetchSpy = setupFetchSpy();

      const { service } = createService({
        getCurrentModelConfig: () => ({
          maxTokens: 1024,
          supportsTemperature: true,
          supportsTools: true,
          supportsImages: false,
          reasoningEffort: 'xhigh',
        }),
        getModelCapabilities: () => ({
          supportsTools: true,
          supportsImages: false,
          reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
        } as any),
      });

      await service.callWithToolsStreaming();

      const body = parseRequestBody(fetchSpy);
      expect(body.reasoning_effort).toBe('xhigh');
    });
  });

  describe('unknown event type deduplication', () => {
    it('logs first occurrence of an unknown /responses event type and suppresses subsequent ones', async () => {
      mockedGetEndpointForModel.mockReturnValue('/responses' as any);
      // Send the same unknown event type 3 times, then a different unknown type once
      const reader = createReader([
        'data: {"type":"response.some_unknown_event","foo":"bar"}\n',
        'data: {"type":"response.some_unknown_event","foo":"baz"}\n',
        'data: {"type":"response.some_unknown_event","foo":"qux"}\n',
        'data: {"type":"response.another_unknown","x":1}\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n',
        'data: [DONE]\n',
      ]);

      vi.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      } as any);

      const { service } = createService();
      sharedMockLogger.info.mockClear();
      await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

      // Filter logger.info calls that match our unknown event log
      const infoCallArgs = sharedMockLogger.info.mock.calls.filter(
        (args: any[]) => typeof args[0] === 'string' && args[0].includes('unknown event type')
      );

      // Should log exactly 2 times: once for 'response.some_unknown_event', once for 'response.another_unknown'
      expect(infoCallArgs).toHaveLength(2);
      expect(infoCallArgs[0][2].type).toBe('response.some_unknown_event');
      expect(infoCallArgs[1][2].type).toBe('response.another_unknown');
    });

    it('does not log known excluded event types', async () => {
      mockedGetEndpointForModel.mockReturnValue('/responses' as any);
      const reader = createReader([
        'data: {"type":"response.output_text.delta","delta":"hi"}\n',
        'data: {"type":"response.function_call_arguments.delta","delta":"x"}\n',
        'data: {"type":"response.in_progress"}\n',
        'data: {"type":"response.created"}\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n',
        'data: {"type":"response.output_item.done","item":{"type":"message","content":[]}}\n',
        'data: [DONE]\n',
      ]);

      vi.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      } as any);

      sharedMockLogger.info.mockClear();

      const { service } = createService();
      await service.makeStreamingApiCall({ model: 'gpt-5', messages: [], _maxTokensValue: 100, stream: true });

      const unknownEventCalls = sharedMockLogger.info.mock.calls.filter(
        (args: any[]) => typeof args[0] === 'string' && args[0].includes('unknown event type')
      );

      expect(unknownEventCalls).toHaveLength(0);
    });
  });
});