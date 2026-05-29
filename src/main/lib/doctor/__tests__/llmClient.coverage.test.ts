import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAuth = vi.hoisted(() => vi.fn());
const mockGetEndpoint = vi.hoisted(() => vi.fn());

vi.mock('../../auth/authManager', () => ({
  mainAuthManager: { getCurrentAuth: mockGetAuth },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.example.com',
    USER_AGENT: 'test-agent',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '2.0',
  },
}));

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: mockGetEndpoint,
}));

vi.mock('../agentConfig', () => ({
  DOCTOR_MODEL: 'test-model',
}));

import { callDoctorLlm } from '../llmClient';


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

function makeResponse(lines: string[], ok = true, status = 200) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue('error body'),
    body: makeSseStream(lines),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEndpoint.mockReturnValue('/chat/completions');
});

describe('callDoctorLlm', () => {
  it('throws when no auth session', async () => {
    mockGetAuth.mockReturnValue(null);
    await expect(callDoctorLlm([], [])).rejects.toThrow('No GitHub Copilot session available');
  });

  it('throws when token is missing', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: '' } } });
    await expect(callDoctorLlm([], [])).rejects.toThrow('No GitHub Copilot session available');
  });

  it('throws on non-ok response', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue('Unauthorized') });
    vi.stubGlobal('fetch', mockFetch);
    await expect(callDoctorLlm([], [])).rejects.toThrow('GHC API error 401: Unauthorized');
    vi.unstubAllGlobals();
  });

  it('parses a simple text completion', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([{ role: 'user', content: 'hi' }], []);
    expect(result.content).toBe('Hello');
    expect(result.finishReason).toBe('stop');
    expect(result.toolCalls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('accumulates multiple content deltas', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"World"},"finish_reason":"stop"}]}',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([], []);
    expect(result.content).toBe('Hello World');
    vi.unstubAllGlobals();
  });

  it('parses tool calls from stream', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","type":"function","function":{"name":"my_tool","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\":1}"}}]},"finish_reason":"tool_calls"}]}',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([], []);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('my_tool');
    expect(result.toolCalls[0].function.arguments).toBe('{"x":1}');
    vi.unstubAllGlobals();
  });

  it('skips tool calls without a function name', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","type":"function","function":{"name":"","arguments":""}}]},"finish_reason":"stop"}]}',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([], []);
    expect(result.toolCalls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('skips unparseable SSE chunks gracefully', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      'data: NOT_JSON',
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([], []);
    expect(result.content).toBe('ok');
    vi.unstubAllGlobals();
  });

  it('skips lines without data: prefix', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    const lines = [
      ': comment',
      '',
      'data: {"choices":[{"delta":{"content":"X"},"finish_reason":"stop"}]}',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(lines)));
    const result = await callDoctorLlm([], []);
    expect(result.content).toBe('X');
    vi.unstubAllGlobals();
  });

  it('throws when response body is null', async () => {
    mockGetAuth.mockReturnValue({ ghcAuth: { copilotTokens: { token: 'tok' } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }));
    await expect(callDoctorLlm([], [])).rejects.toThrow('Failed to get response stream reader');
    vi.unstubAllGlobals();
  });
});
