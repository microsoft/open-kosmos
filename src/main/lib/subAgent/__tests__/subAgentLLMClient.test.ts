// @ts-nocheck
/**
 * SubAgentLLMClient unit tests
 *
 * Covers:
 * - callLLM: auth guard, /responses endpoint, /chat/completions endpoint,
 *   empty tools, error response (body logging, tool_call JSON validity check), abort signal
 * - parseStreamingResponse: throttled emit skip, force emit, cancellation mid-stream,
 *   done=true with remaining buffer
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const { mockGetCurrentAuth } = vi.hoisted(() => ({
  mockGetCurrentAuth: vi.fn().mockResolvedValue({
    ghcAuth: { copilotTokens: { token: 'mock-copilot-token' } },
  }),
}));

vi.mock('../../auth/authManager', async () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: mockGetCurrentAuth,
    })),
  },
}));

vi.mock('../../auth/ghcConfig', async () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'MockAgent/1.0',
    EDITOR_VERSION: 'vscode/1.0',
    EDITOR_PLUGIN_VERSION: 'openkosmos/1.0',
  },
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(() => '/chat/completions'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelCapabilities: vi.fn(() => ({
    maxContextLength: 128000,
    supportsTools: true,
  })),
  getDefaultModel: vi.fn(() => 'gpt-4o'),
  buildMaxTokensParam: vi.fn(() => ({ max_tokens: 4096 })),
}));

vi.mock('../subAgentToolCallRepair', async () => ({
  repairToolCallArguments: vi.fn((tc: any) => ({
    ...tc,
    function: { ...tc.function, arguments: '{}' },
  })),
}));

// ─── Helpers ───

import { SubAgentLLMClient } from '../subAgentLLMClient';
import { getEndpointForModel } from '../../llm/ghcModelApi';
import type { CancellationToken } from '../../cancellation/CancellationToken';

function makeCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function makeOptions(overrides: any = {}): any {
  return {
    subAgent: {
      inheritedModel: 'gpt-4o',
      parentSessionId: 'session-1',
      parentChatId: 'chat-1',
      userAlias: 'testUser',
      resolvedMcpServers: [],
      config: { mcp_servers: [] },
      taskId: 'sa-1',
    },
    task: 'test task',
    cancellationToken: makeCancellationToken(),
    currentUserAlias: 'testUser',
    onStepUpdate: vi.fn(),
    ...overrides,
  };
}

function makeClient(options?: any, overrides: any = {}) {
  const opts = options ?? makeOptions();
  return new SubAgentLLMClient(
    opts,
    overrides.getTurnCount ?? (() => 0),
    overrides.sanitizeOrphanedToolResults ?? ((msgs: any[]) => msgs),
    overrides.createAbortSignal ?? (() => new AbortController().signal),
  );
}

/** Build a minimal streaming ReadableStream from an array of SSE data strings */
function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeFetchResponse(ok: boolean, body: ReadableStream | null, status = 200, statusText = 'OK', extraText = '') {
  return {
    ok,
    status,
    statusText,
    body,
    text: vi.fn().mockResolvedValue(extraText || `Error from server status ${status}`),
  } as any;
}

// ─── Tests ───

describe('SubAgentLLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset endpoint mock to default
    vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');
  });

  // ── Auth guard ──
  describe('callLLM — auth guard', () => {
    it('throws when no copilot token is present', async () => {
      mockGetCurrentAuth.mockResolvedValueOnce(null);

      const client = makeClient();
      await expect(client.callLLM([], [], [])).rejects.toThrow(
        'No valid authentication token available for sub-agent',
      );
    });

    it('throws when token is empty string', async () => {
      mockGetCurrentAuth.mockResolvedValueOnce({
        ghcAuth: { copilotTokens: { token: '' } },
      });

      const client = makeClient();
      await expect(client.callLLM([], [], [])).rejects.toThrow(
        'No valid authentication token available for sub-agent',
      );
    });

    it('throws when ghcAuth is missing', async () => {
      mockGetCurrentAuth.mockResolvedValueOnce({ ghcAuth: null });

      const client = makeClient();
      await expect(client.callLLM([], [], [])).rejects.toThrow(
        'No valid authentication token available for sub-agent',
      );
    });
  });

  // ── /chat/completions endpoint ──
  describe('callLLM — /chat/completions endpoint', () => {
    it('sends messages key in request body', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const client = makeClient();
      const result = await client.callLLM(
        [{ role: 'system', content: [{ type: 'text', text: 'sys' }] }],
        [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        [],
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/chat/completions');
      const body = JSON.parse(init.body);
      expect(body).toHaveProperty('messages');
      expect(body).not.toHaveProperty('input');
      expect(result.textContent).toBe('Hello');
      expect(result.finishReason).toBe('stop');
    });

    it('includes nested tool format when tools provided', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const tools = [
        { name: 'web_search', description: 'search the web', inputSchema: { type: 'object', properties: {} } },
      ];
      const client = makeClient();
      await client.callLLM([], [], tools);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]).toHaveProperty('function'); // nested format
      expect(body.tools[0].function.name).toBe('web_search');
    });

    it('omits tools key when tools array is empty', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const client = makeClient();
      await client.callLLM([], [], []);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });
  });

  // ── /responses endpoint ──
  describe('callLLM — /responses endpoint', () => {
    it('sends input key and include field in request body', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/responses');

      const sseLines = [
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi there' })}`,
        `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'message' }] } })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const client = makeClient(makeOptions({ subAgent: { inheritedModel: 'o1', resolvedMcpServers: [], config: { mcp_servers: [] } } }));
      const result = await client.callLLM([], [], []);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toHaveProperty('input');
      expect(body).toHaveProperty('include');
      expect(body).not.toHaveProperty('messages');
      expect(result.textContent).toBe('Hi there');
      expect(result.finishReason).toBe('stop');
    });

    it('includes flat tool format for /responses endpoint', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/responses');

      const sseLines = [
        `data: ${JSON.stringify({ type: 'response.completed', response: { output: [] } })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const tools = [
        { name: 'web_search', description: 'search', inputSchema: { type: 'object' } },
      ];
      const client = makeClient();
      await client.callLLM([], [], tools);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]).toHaveProperty('name', 'web_search'); // flat format — no nested function key
      expect(body.tools[0]).not.toHaveProperty('function');
    });
  });

  // ── !response.ok error path ──
  describe('callLLM — error response', () => {
    it('throws with status code when response is not ok', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse(false, null, 401, 'Unauthorized', 'invalid_token'),
      );
      vi.stubGlobal('fetch', fetchMock);

      const client = makeClient();
      await expect(client.callLLM([], [], [])).rejects.toThrow('LLM API error (401)');
    });

    it('logs tool_call JSON validity in error request context', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse(false, null, 400, 'Bad Request', 'invalid_tool_call_format'),
      );
      vi.stubGlobal('fetch', fetchMock);

      // Pass a context history message with tool_calls so the error-path loops over them
      const ctxHistory: any[] = [
        {
          role: 'assistant',
          content: [],
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } },
            { id: 'c2', type: 'function', function: { name: 'bad_tool', arguments: 'NOT JSON' } },
          ],
        },
      ];

      const client = makeClient();
      await expect(client.callLLM([], ctxHistory, [])).rejects.toThrow('LLM API error (400)');
    });

    it('logs error when tool_call has no arguments property', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse(false, null, 500, 'Internal Server Error', 'server error'),
      );
      vi.stubGlobal('fetch', fetchMock);

      const ctxHistory: any[] = [
        {
          role: 'assistant',
          content: [],
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'noop' } }, // no arguments field
          ],
        },
      ];

      const client = makeClient();
      await expect(client.callLLM([], ctxHistory, [])).rejects.toThrow('LLM API error (500)');
    });
  });

  // ── Abort signal ──
  describe('callLLM — abort signal', () => {
    it('passes abort signal to fetch', async () => {
      vi.mocked(getEndpointForModel).mockReturnValue('/chat/completions');

      const controller = new AbortController();
      const createAbortSignal = vi.fn(() => controller.signal);

      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]',
      ];
      const stream = makeSseStream(sseLines);
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true, stream));
      vi.stubGlobal('fetch', fetchMock);

      const client = makeClient(undefined, { createAbortSignal });
      await client.callLLM([], [], []);

      const [, init] = fetchMock.mock.calls[0];
      expect(init.signal).toBe(controller.signal);
      expect(createAbortSignal).toHaveBeenCalledOnce();
    });
  });

  // ── parseStreamingResponse — throttle paths ──
  describe('parseStreamingResponse — streaming emit throttle', () => {
    it('skips emit when interval not elapsed AND delta < 100 chars', async () => {
      const onStepUpdate = vi.fn();
      const options = makeOptions({ onStepUpdate });
      const client = makeClient(options);

      // Provide 2 chunks: first sets content, second adds < 100 chars within 300ms
      const encoder = new TextEncoder();
      const sseChunk1 = `data: ${JSON.stringify({ choices: [{ delta: { content: 'A'.repeat(50) }, finish_reason: null }] })}\n`;
      const sseChunk2 = `data: ${JSON.stringify({ choices: [{ delta: { content: 'B'.repeat(20) }, finish_reason: null }] })}\n`;
      const sseDone = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;

      let chunkIndex = 0;
      const chunks = [encoder.encode(sseChunk1), encoder.encode(sseChunk2), encoder.encode(sseDone)];

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < chunks.length) {
            return { done: false, value: chunks[chunkIndex++] };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      // Patch Date.now to keep time constant so throttle threshold not exceeded
      const fixedTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      const result = await client.parseStreamingResponse(mockResponse, '/chat/completions');

      // Force emit at end should have been called
      const llmStreamingCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'llm_streaming');
      expect(llmStreamingCalls.length).toBeGreaterThanOrEqual(1);
      // The final force=true emit carries the full text
      const lastCall = llmStreamingCalls[llmStreamingCalls.length - 1];
      expect(lastCall[0].streamingText).toContain('A');

      vi.restoreAllMocks();
    });

    it('emits when delta >= 100 chars even within throttle interval', async () => {
      const onStepUpdate = vi.fn();
      const options = makeOptions({ onStepUpdate });
      const client = makeClient(options);

      const encoder = new TextEncoder();
      const bigContent = 'X'.repeat(150);
      const sseChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: bigContent }, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;

      let called = false;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (!called) { called = true; return { done: false, value: encoder.encode(sseChunk) }; }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      // Freeze time to force throttle condition on interval
      const fixedTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      await client.parseStreamingResponse(mockResponse, '/chat/completions');

      // Should have emitted at least once during the loop (delta >= 100)
      const llmStreamingCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'llm_streaming');
      expect(llmStreamingCalls.length).toBeGreaterThanOrEqual(1);

      vi.restoreAllMocks();
    });
  });

  // ── parseStreamingResponse — cancellation mid-stream ──
  describe('parseStreamingResponse — cancellation mid-stream', () => {
    it('cancels reader and throws when cancellation is requested', async () => {
      const cancelToken = makeCancellationToken(false);
      const options = makeOptions({ cancellationToken: cancelToken });
      const client = makeClient(options);

      const encoder = new TextEncoder();
      let readCount = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          readCount++;
          if (readCount === 1) {
            // Set cancellation before second read
            (cancelToken as any).isCancellationRequested = true;
            const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n`;
            return { done: false, value: encoder.encode(chunk) };
          }
          return { done: false, value: encoder.encode('more data\n') };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      await expect(client.parseStreamingResponse(mockResponse, '/chat/completions'))
        .rejects.toThrow('Sub-agent task cancelled during streaming');

      expect(mockReader.cancel).toHaveBeenCalledOnce();
    });
  });

  // ── parseStreamingResponse — remaining buffer on done ──
  describe('parseStreamingResponse — buffer flushed on done', () => {
    it('processes remaining buffer when done=true without trailing newline', async () => {
      const options = makeOptions();
      const client = makeClient(options);

      const encoder = new TextEncoder();
      // Send a chunk without trailing newline so it ends up in buffer
      const dataLine = `data: ${JSON.stringify({ choices: [{ delta: { content: 'buffered' }, finish_reason: null }] })}`;

      let step = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          step++;
          if (step === 1) {
            return { done: false, value: encoder.encode(dataLine) }; // no trailing newline → stays in buffer
          }
          if (step === 2) {
            // Now send done signal
            return { done: true, value: undefined };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      const result = await client.parseStreamingResponse(mockResponse, '/chat/completions');
      expect(result.textContent).toBe('buffered');
    });
  });

  // ── parseStreamingResponse — no body ──
  describe('parseStreamingResponse — no body', () => {
    it('throws when response body is null', async () => {
      const client = makeClient();
      const mockResponse = { body: null } as any;
      await expect(client.parseStreamingResponse(mockResponse, '/chat/completions'))
        .rejects.toThrow('Failed to get response stream reader');
    });
  });

  // ── parseStreamingResponse — tool calls ──
  describe('parseStreamingResponse — tool call result', () => {
    it('returns hasToolCalls=true and populates toolCalls', async () => {
      const options = makeOptions();
      const client = makeClient(options);

      const encoder = new TextEncoder();
      const tc1 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"' } }] }, finish_reason: null }] });
      const tc2 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'test"}' } }] }, finish_reason: 'tool_calls' }] });
      const sseText = `data: ${tc1}\ndata: ${tc2}\ndata: [DONE]\n`;

      let done = false;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (!done) { done = true; return { done: false, value: encoder.encode(sseText) }; }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      const result = await client.parseStreamingResponse(mockResponse, '/chat/completions');

      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].id).toBe('call-1');
      expect(result.toolCalls[0].function.arguments).toBe('{"q":"test"}');
      expect(result.finishReason).toBe('tool_calls');
    });
  });

  // ── parseStreamingResponse — empty content ──
  describe('parseStreamingResponse — empty content', () => {
    it('returns empty assistantMessage content when no text', async () => {
      const client = makeClient();
      const encoder = new TextEncoder();
      const sseText = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;

      let done = false;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (!done) { done = true; return { done: false, value: encoder.encode(sseText) }; }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      const result = await client.parseStreamingResponse(mockResponse, '/chat/completions');
      expect(result.textContent).toBe('');
      expect(result.assistantMessage.content).toEqual([]);
    });
  });
});
