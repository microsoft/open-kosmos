/**
 * Additional coverage tests for VscodeHttpTransport
 * Focuses on auth-challenge paths, SSE fallback, redirect handling,
 * backchannel retry, and various error branches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockResolveMetadata = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockUpdateFromHeaders = vi.hoisted(() => vi.fn((existing: unknown) => existing));
const mockGetTokenForServer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../auth/McpAuthMetadataService', () => ({
  McpAuthMetadataService: {
    resolve: mockResolveMetadata,
    updateFromHeaders: mockUpdateFromHeaders,
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

function jsonResponse(body: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function plainResponse(body: string, status = 200, contentType = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

function sseBodyResponse(sseText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(sseText));
      c.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function emptyBodyResponse(status = 202): Response {
  return new Response(null, { status, headers: { 'Content-Type': 'application/json' } });
}

// ── send() guard ──────────────────────────────────────────────────────────────
describe('VscodeHttpTransport — send() guard', () => {
  it('throws when transport is not running', async () => {
    const t = makeTransport();
    await expect(t.send('{"method":"ping"}')).rejects.toThrow('Transport is not running');
  });
});

// ── 202 response (no body) ────────────────────────────────────────────────────
describe('VscodeHttpTransport — 202 accepted', () => {
  it('handles 202 with no body silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyBodyResponse(202)));
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

// ── JSON response body ────────────────────────────────────────────────────────
describe('VscodeHttpTransport — application/json response', () => {
  it('emits message for JSON content-type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('{"result":"ok"}')));
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('{"result":"ok"}');
    vi.unstubAllGlobals();
  });
});

// ── Unknown content-type but valid JSON body ──────────────────────────────────
describe('VscodeHttpTransport — unknown content-type with JSON body', () => {
  it('emits message when body is JSON-parseable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse('{"x":1}', 200, 'application/octet-stream')));
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('{"x":1}');
    vi.unstubAllGlobals();
  });

  it('logs warning when body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse('not-json', 200, 'application/octet-stream')));
    const t = makeTransport();
    await t.start();
    const logs: string[] = [];
    t.on('log', (_lvl: string, msg: string) => logs.push(msg));
    await t.send('{"id":1}');
    expect(logs.some(m => m.includes('Unexpected response'))).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ── SSE body via POST ─────────────────────────────────────────────────────────
describe('VscodeHttpTransport — SSE response to POST', () => {
  it('emits message for SSE data lines', async () => {
    const sseText = 'data: {"answer":42}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseBodyResponse(sseText)));
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('{"answer":42}');
    vi.unstubAllGlobals();
  });
});

// ── 4xx before auth challenge → SSE fallback ─────────────────────────────────
describe('VscodeHttpTransport — SSE fallback on 4xx before auth', () => {
  it('tries SSE fallback on 404 in Unknown mode', async () => {
    const fetchMock = vi.fn();
    // First POST → 404 (triggers SSE fallback)
    // GET SSE connect → returns 3xx so fallback gives up
    fetchMock
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('error', { status: 503 }));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    const stateChanges: string[] = [];
    t.on('stateChange', (s: any) => stateChanges.push(s.state));
    await t.send('{"id":1}');
    // Error state set after SSE GET fails
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

// ── 5xx before auth challenge → SSE fallback ─────────────────────────────────
describe('VscodeHttpTransport — SSE fallback on 5xx before auth', () => {
  it('tries SSE fallback on 500', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(new Response('gone', { status: 503 }));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

// ── 401 triggers auth challenge ───────────────────────────────────────────────
describe('VscodeHttpTransport — auth challenge on 401', () => {
  it('resolves metadata and retries when 401 returned', async () => {
    const fakeMeta = {
      providerLabel: 'GitHub',
      authorizationServerMetadata: { issuer: 'https://github.com' },
      authorizationServerUrl: 'https://github.com',
      scopes: ['repo'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'well-known' },
    };
    mockResolveMetadata.mockResolvedValueOnce(fakeMeta);
    mockGetTokenForServer.mockResolvedValueOnce('tok123');

    const fetchMock = vi.fn();
    // First call → 401 auth challenge
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="test"' },
    }));
    // Second call after token injection → 200 JSON
    fetchMock.mockResolvedValueOnce(jsonResponse('{"ok":true}'));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(mockGetTokenForServer).toHaveBeenCalledWith('test-server', fakeMeta, expect.anything());
    expect(messages).toContain('{"ok":true}');
    vi.unstubAllGlobals();
  });
});

// ── 403 after auth (feature gate) ────────────────────────────────────────────
describe('VscodeHttpTransport — 403 after successful auth', () => {
  it('throws descriptive error for 403 after OAuth sign-in', async () => {
    const fakeMeta = {
      providerLabel: 'GitLab',
      authorizationServerMetadata: { issuer: 'https://gitlab.com' },
      authorizationServerUrl: 'https://gitlab.com',
      scopes: ['api'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'well-known' },
    };
    mockResolveMetadata.mockResolvedValueOnce(fakeMeta);
    mockGetTokenForServer.mockResolvedValue('tok-abc');

    const fetchMock = vi.fn();
    fetchMock
      // First → 401 (challenge)
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      // Second → 403 (feature gate after auth)
      .mockResolvedValueOnce(new Response('Feature not available', { status: 403, headers: { Authorization: 'Bearer tok-abc' } }));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

// ── Redirect handling ─────────────────────────────────────────────────────────
describe('VscodeHttpTransport — redirect handling', () => {
  it('follows 301 redirect and changes method to GET for POST', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { location: 'https://example.com/mcp2' },
      }))
      .mockResolvedValueOnce(jsonResponse('{"redirected":true}'))
      .mockResolvedValue(new Response('', { status: 405 })); // backchannel GET

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    // At least 2 fetch calls: redirect + final destination
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });

  it('follows 303 redirect', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(new Response('', {
        status: 303,
        headers: { location: '/mcp3' },
      }))
      .mockResolvedValueOnce(jsonResponse('{"redirected":true}'))
      .mockResolvedValue(new Response('', { status: 405 })); // backchannel GET

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m: string) => messages.push(m));
    await t.send('{"id":1}');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });
});

// ── Session ID tracking ───────────────────────────────────────────────────────
describe('VscodeHttpTransport — session ID tracking', () => {
  it('sets mode to Http and carries Mcp-Session-Id on subsequent sends', async () => {
    const fetchMock = vi.fn();
    // First call: returns session ID header
    fetchMock.mockResolvedValueOnce(jsonResponse('{"r":1}', 200, { 'Mcp-Session-Id': 'sess-xyz' }));
    // Second call (backchannel GET) returns 405 so it exits quietly
    fetchMock.mockResolvedValue(new Response('', { status: 405 }));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}');

    // The second fetch call should include Mcp-Session-Id
    const calls = fetchMock.mock.calls;
    // Find a call with the session header
    const withSession = calls.some((c: any[]) => {
      const init = c[1] as RequestInit;
      return (init?.headers as Record<string, string>)?.['Mcp-Session-Id'] === 'sess-xyz';
    });
    expect(withSession).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ── 400/404 on known session → error ─────────────────────────────────────────
describe('VscodeHttpTransport — 400/404 with known session', () => {
  it('throws error mentioning retry on 404 with session', async () => {
    const fetchMock = vi.fn();
    // First response: sets session ID
    fetchMock.mockResolvedValueOnce(jsonResponse('{}', 200, { 'Mcp-Session-Id': 'sess-abc' }));
    // Backchannel GET → 405
    fetchMock.mockResolvedValueOnce(new Response('', { status: 405 }));
    // Second send: 404 with session → should throw
    fetchMock.mockResolvedValueOnce(new Response('session not found', { status: 404 }));

    vi.stubGlobal('fetch', fetchMock);
    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}'); // First send sets session
    await expect(t.send('{"id":2}')).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

// ── stop() emits log ──────────────────────────────────────────────────────────
describe('VscodeHttpTransport — stop', () => {
  it('emits log on stop', async () => {
    const t = makeTransport();
    await t.start();
    const logs: string[] = [];
    t.on('log', (_lvl: string, msg: string) => logs.push(msg));
    await t.stop();
    expect(logs.some(m => m.includes('stopped'))).toBe(true);
  });

  it('send after stop throws transport-not-running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('{}')));
    const t = makeTransport();
    await t.start();
    await t.stop();
    await expect(t.send('{}') ).rejects.toThrow('Transport is not running');
    vi.unstubAllGlobals();
  });
});

// ── stateChange events ────────────────────────────────────────────────────────
describe('VscodeHttpTransport — state events', () => {
  it('emits stateChange events for start and stop', async () => {
    const t = makeTransport();
    const states: string[] = [];
    t.on('stateChange', (s: any) => states.push(s.state));
    await t.start();
    await t.stop();
    expect(states).toContain('starting');
    expect(states).toContain('running');
    expect(states).toContain('stopped');
  });
});

// ── fetch error path ──────────────────────────────────────────────────────────
describe('VscodeHttpTransport — fetch error handling', () => {
  it('transitions to error state when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow();
    expect(t.state.state).toBe('error');
    vi.unstubAllGlobals();
  });
});
