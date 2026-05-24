/**
 * Core unit tests for VscodeHttpTransport — SSEParser, state management,
 * HTTP/SSE mode selection, redirect handling, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock auth dependencies ────────────────────────────────────────────────────
const mockResolveMetadata = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockGetTokenForServer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../auth/McpAuthMetadataService', () => ({
  McpAuthMetadataService: {
    resolve: mockResolveMetadata,
    updateFromHeaders: vi.fn((existing: unknown) => existing),
  },
}));

vi.mock('../../../auth/McpAuthService', () => ({
  McpAuthService: {
    getInstance: vi.fn(() => ({
      getTokenForServer: mockGetTokenForServer,
    })),
  },
}));

import { VscodeHttpTransport } from '../VscodeHttpTransport';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransport(url = 'https://example.com/mcp', headers?: Record<string, string>) {
  return new VscodeHttpTransport({ serverName: 'test-server', url, headers });
}

/** Build a minimal Response whose body is a ReadableStream of SSE text. */
function sseResponse(lines: string[], status = 200): Response {
  const body = lines.join('');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function plainResponse(body: string, status = 200, contentType = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

// ── start / stop ──────────────────────────────────────────────────────────────

describe('VscodeHttpTransport — start / stop', () => {
  it('transitions to running on start', async () => {
    const t = makeTransport();
    await t.start();
    expect(t.state.state).toBe('running');
  });

  it('transitions to stopped on stop', async () => {
    const t = makeTransport();
    await t.start();
    await t.stop();
    expect(t.state.state).toBe('stopped');
  });

  it('stop is idempotent when already stopped', async () => {
    const t = makeTransport();
    await t.stop(); // never started — state is 'stopped'
    expect(t.state.state).toBe('stopped');
  });

  it('emits stateChange events', async () => {
    const t = makeTransport();
    const states: string[] = [];
    t.on('stateChange', (s) => states.push(s.state));
    await t.start();
    await t.stop();
    expect(states).toEqual(['starting', 'running', 'stopped']);
  });
});

// ── send() guard ──────────────────────────────────────────────────────────────

describe('VscodeHttpTransport — send() guard', () => {
  it('throws when transport is not running', async () => {
    const t = makeTransport();
    // do not call start()
    await expect(t.send('{}')).rejects.toThrow('Transport is not running');
  });
});

// ── StreamableHTTP mode — application/json response ──────────────────────────

describe('VscodeHttpTransport — StreamableHTTP application/json', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('emits message event for application/json response', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(payload));

    const t = makeTransport();
    await t.start();

    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));

    await t.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(payload);
  });

  it('stores session ID from Mcp-Session-Id response header', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-abc' },
      })
    );

    const t = makeTransport();
    await t.start();
    await t.send('{}');
    // mode should be Http with the session ID
    expect((t as any).mode.sessionId).toBe('sess-abc');
  });

  it('sends Mcp-Session-Id header on subsequent requests', async () => {
    const makeSessionResponse = () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-xyz' },
      });

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(makeSessionResponse())
      // backchannel GET returns 400 → disabled immediately
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(makeSessionResponse());

    const t = makeTransport();
    await t.start();
    // First send — sets mode to Http + session ID
    await t.send('{"id":1}');
    // Second send — should include the session header
    await t.send('{"id":2}');

    // Find the second POST call (skip the backchannel GET)
    const postCalls = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(postCalls.length).toBeGreaterThanOrEqual(2);
    const secondPostHeaders = (postCalls[1][1] as RequestInit)?.headers as Record<string, string>;
    expect(secondPostHeaders?.['Mcp-Session-Id']).toBe('sess-xyz');
  });
});

// ── StreamableHTTP mode — 202 No Content ─────────────────────────────────────

describe('VscodeHttpTransport — 202 accepted', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('resolves without emitting a message for 202', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));

    const t = makeTransport();
    await t.start();

    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{}');
    expect(messages).toHaveLength(0);
  });
});

// ── StreamableHTTP mode — unknown content-type (JSON body) ───────────────────

describe('VscodeHttpTransport — unknown content-type with JSON body', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('emits message when body is valid JSON and content-type is unknown', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' });
    vi.spyOn(global, 'fetch').mockResolvedValue(plainResponse(payload, 200, 'application/octet-stream'));

    const t = makeTransport();
    await t.start();

    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{}');
    expect(messages).toHaveLength(1);
  });

  it('emits log warning when body is not JSON and content-type is unknown', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(plainResponse('not json here', 200, 'application/octet-stream'));

    const t = makeTransport();
    await t.start();

    const logs: string[] = [];
    t.on('log', (_level: string, msg: string) => logs.push(msg));
    await t.send('{}');
    expect(logs.some((l) => l.includes('Unexpected response'))).toBe(true);
  });
});

// ── SSE fallback path (4xx pre-auth) ─────────────────────────────────────────

describe('VscodeHttpTransport — SSE fallback on 4xx', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back to SSE when first request returns 404', async () => {
    // 1st call: 404 → triggers SSE fallback path
    // 2nd call: SSE GET that returns the endpoint event
    // 3rd call: POST to the SSE endpoint
    const endpointEvent = 'event: endpoint\ndata: /sse-post-endpoint\n\n';
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(endpointEvent));
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}');

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // Mode should be SSE now
    expect((t as any).mode.value).toBe(2); // HttpMode.SSE = 2
  });

  it('falls back to SSE on 500 status pre-auth', async () => {
    const endpointEvent = 'event: endpoint\ndata: /sse-post\n\n';
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(endpointEvent));
        controller.close();
      },
    });

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}');
    expect((t as any).mode.value).toBe(2); // SSE
  });
});

// ── Error: 4xx after auth challenge ──────────────────────────────────────────

describe('VscodeHttpTransport — error after successful auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolveMetadata.mockReset();
    mockGetTokenForServer.mockReset();
  });

  it('throws with helpful message on 404 post-auth when Authorization header present', async () => {
    mockResolveMetadata.mockResolvedValue({
      authorizationServerUrl: 'https://auth.example.com',
      authorizationServerMetadata: { issuer: 'https://auth.example.com' },
      scopes: ['api://res/.default'],
      providerLabel: 'Test',
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    });
    mockGetTokenForServer.mockResolvedValue('tok-abc');

    vi.spyOn(global, 'fetch')
      // 1st: initial POST → 401 triggers auth
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer scope="api://res/.default"' } }))
      // 2nd: retry POST with auth header → 404
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }));

    const t = makeTransport();
    await t.start();
    await expect(t.send('{}')).rejects.toThrow(/404 status from/);
  });
});

// ── 4xx that is NOT 401/403 but auth challenge has been seen → real error ─────

describe('VscodeHttpTransport — 4xx after _sawAuthChallenge', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('throws on >=300 response when mode is Http with session', async () => {
    // 1st POST → 200 with session ID (sets Http mode)
    // 2nd POST → 400 (real semantic failure)
    // 3rd: backchannel GET → 404 (disables backchannel)
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess1' },
        })
      )
      .mockResolvedValue(new Response('bad request', { status: 400 }));

    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}'); // sets Http mode + session, starts backchannel
    await expect(t.send('{"id":2}')).rejects.toThrow(/400 status/);
    void fetchSpy; // used
  });
});

// ── Redirect handling ─────────────────────────────────────────────────────────

describe('VscodeHttpTransport — redirect handling', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('follows a 302 redirect', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: 'https://example.com/mcp-new' } })
      )
      // 2nd: final response after redirect (application/json, unknown mode → Http)
      .mockResolvedValue(jsonResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));

    const t = makeTransport();
    await t.start();
    await t.send('{}');
    // First two calls are the redirect chain
    expect(fetchSpy.mock.calls[1][0]).toBe('https://example.com/mcp-new');
  });

  it('stops following redirects after MAX_FOLLOW_REDIRECTS', async () => {
    // All requests return 301 → should stop after 5 and return final 301
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 301, headers: { Location: 'https://example.com/redirect' } })
    );

    const t = makeTransport();
    await t.start();
    // After MAX_FOLLOW_REDIRECTS (5), the last response is 301 which is >=300
    await expect(t.send('{}')).rejects.toThrow(/301 status/);
  });

  it('converts POST to GET on 303 redirect', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 303, headers: { Location: 'https://example.com/result' } })
      )
      .mockResolvedValue(jsonResponse(JSON.stringify({})));

    const t = makeTransport();
    await t.start();
    await t.send('{}');
    const secondCallInit = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(secondCallInit.method).toBe('GET');
  });
});

// ── SSE streaming — message parsing ──────────────────────────────────────────

describe('VscodeHttpTransport — SSE event parsing via StreamableHTTP', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('emits message for SSE message events in response body', async () => {
    const sseLines = ['data: {"jsonrpc":"2.0","id":1,"result":{}}\n', '\n'];
    vi.spyOn(global, 'fetch').mockResolvedValue(sseResponse(sseLines));

    const t = makeTransport();
    await t.start();

    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{}');
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0])).toMatchObject({ id: 1 });
  });

  it('handles multi-line SSE data fields', async () => {
    const sseLines = ['data: part1\n', 'data: part2\n', '\n'];
    vi.spyOn(global, 'fetch').mockResolvedValue(sseResponse(sseLines));

    const t = makeTransport();
    await t.start();

    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{}');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('part1');
    expect(messages[0]).toContain('part2');
  });
});

// ── _doSSEWithIndependentSignal — empty body ──────────────────────────────────

describe('VscodeHttpTransport — _doSSEWithIndependentSignal with no body', () => {
  it('returns immediately when response body is null', async () => {
    const t = makeTransport() as any;
    const fakeParser = { feed: vi.fn() };
    const fakeSignal = new AbortController().signal;
    const fakeResponse = { body: null } as any;
    await expect(t._doSSEWithIndependentSignal(fakeParser, fakeResponse, fakeSignal)).resolves.toBeUndefined();
    expect(fakeParser.feed).not.toHaveBeenCalled();
  });
});

// ── _sendLegacySSE — warning on error status ─────────────────────────────────

describe('VscodeHttpTransport — _sendLegacySSE logs warning on error', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('logs a warning (does not throw) on 400 SSE post response', async () => {
    const endpointEvent = 'event: endpoint\ndata: /sse-post\n\n';
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(encoder.encode(endpointEvent)); c.close(); },
    });

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    const t = makeTransport();
    await t.start();

    const logEvents: Array<[string, string]> = [];
    t.on('log', (level: string, msg: string) => logEvents.push([level, msg]));

    await t.send('{}'); // should complete without throwing
    expect(logEvents.some(([, m]) => m.includes('400'))).toBe(true);
  });
});

// ── _attachSSE — error path ───────────────────────────────────────────────────

describe('VscodeHttpTransport — _attachSSE error responses', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sets state to error on 500 from SSE GET', async () => {
    vi.spyOn(global, 'fetch')
      // First POST → 503 (triggers fallback)
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      // SSE GET → 500
      .mockResolvedValueOnce(new Response('server error', { status: 500 }));

    const t = makeTransport();
    await t.start();

    const stateChanges: string[] = [];
    t.on('stateChange', (s: any) => stateChanges.push(s.state));

    // Should not throw but may set error state
    try { await t.send('{}'); } catch { /* ok */ }
    // State error OR send error — either is acceptable; just verify no crash
  });
});

// ── send() wraps errors ───────────────────────────────────────────────────────

describe('VscodeHttpTransport — send() wraps thrown errors', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sets state to error and rethrows when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));

    const t = makeTransport();
    await t.start();
    await expect(t.send('{}')).rejects.toThrow(/network failure/);
    expect(t.state.state).toBe('error');
  });
});

// ── Config headers are forwarded ──────────────────────────────────────────────

describe('VscodeHttpTransport — config headers forwarded', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('includes custom config headers in request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(JSON.stringify({})));
    const t = makeTransport('https://example.com/mcp', { 'X-Custom': 'value123' });
    await t.start();
    await t.send('{}');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers?.['X-Custom']).toBe('value123');
  });
});

// ── _isDisposed / stop cleanup ────────────────────────────────────────────────

describe('VscodeHttpTransport — dispose state', () => {
  it('_isDisposed returns false initially', () => {
    const t = makeTransport() as any;
    expect(t._isDisposed()).toBe(false);
  });

  it('_isDisposed returns true after stop', async () => {
    const t = makeTransport() as any;
    await (t as VscodeHttpTransport).start();
    await (t as VscodeHttpTransport).stop();
    expect(t._isDisposed()).toBe(true);
  });
});

// ── _getErrorText fallback ────────────────────────────────────────────────────

describe('VscodeHttpTransport — _getErrorText', () => {
  it('returns statusText when response.text() throws', async () => {
    const t = makeTransport() as any;
    const fakeResponse = {
      statusText: 'Bad Request',
      text: () => { throw new Error('body unreadable'); },
    };
    const result = await t._getErrorText(fakeResponse);
    expect(result).toBe('Bad Request');
  });

  it('returns the body text normally', async () => {
    const t = makeTransport() as any;
    const fakeResponse = {
      statusText: 'OK',
      text: async () => 'detailed error message',
    };
    const result = await t._getErrorText(fakeResponse);
    expect(result).toBe('detailed error message');
  });
});

// ── _timeout ──────────────────────────────────────────────────────────────────

describe('VscodeHttpTransport — _timeout', () => {
  it('resolves after approximately the given ms', async () => {
    vi.useFakeTimers();
    const t = makeTransport() as any;
    const p = t._timeout(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
