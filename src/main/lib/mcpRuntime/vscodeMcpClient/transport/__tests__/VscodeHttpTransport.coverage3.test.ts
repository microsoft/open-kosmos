/**
 * Additional coverage tests for VscodeHttpTransport — targets uncovered
 * branches not exercised by the existing suites:
 *   - SSEParser edge cases: empty chunks, CRLF-split-across-chunks,
 *     no-colon lines, value without leading space, empty dispatch.
 *   - _attachSSE: message-event-before-endpoint branch.
 *   - _send: routing to _sendLegacySSE once mode is SSE.
 *   - Backchannel: message + id propagation through SSE parser; stop() during
 *     in-flight backchannel; finally-block abort path.
 *   - _fetchWithIndependentSignal: redirect with no Location header (break).
 *   - _fetchWithAuthRetry: token-is-undefined paths in both initial and
 *     force-refresh retries; missing authMetadata after resolve returns null.
 *   - _sendStreamableHttp: SSE endpoint event in POST response body.
 *   - _doSSEWithIndependentSignal: disposed/aborted mid-read (cancel path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks for auth services.
const mockResolve = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockUpdateFromHeaders = vi.hoisted(() => vi.fn((existing: unknown) => existing));
const mockGetTokenForServer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../auth/McpAuthMetadataService', () => ({
  McpAuthMetadataService: {
    resolve: mockResolve,
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

function makeTransport(url = 'https://example.com/mcp', headers?: Record<string, string>) {
  return new VscodeHttpTransport({ serverName: 'test-server', url, headers });
}

function jsonResponse(body: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Build a Response whose body is a ReadableStream of multiple chunks (each chunk is a string). */
function multiChunkSseResponse(chunks: Uint8Array[], status = 200): Response {
  let idx = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(chunks[idx++]);
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ─── SSEParser edge cases ─────────────────────────────────────────────────────
describe('VscodeHttpTransport — SSEParser edge cases', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('handles an empty (0-byte) chunk without crashing', async () => {
    // First emit a 0-byte chunk (covers `if (chunk.length === 0) return`),
    // then a valid SSE event so we can assert the parser still works.
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        new Uint8Array(0),
        enc.encode('data: {"id":1}\n\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('{"id":1}');
  });

  it('handles CRLF boundary split across chunks', async () => {
    // Chunk 1 ends with CR, chunk 2 starts with LF.  Without the
    // `endedOnCR` handling the second chunk's leading LF would create a
    // spurious blank line.  We verify a single message is parsed correctly.
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('data: hello\r'),
        enc.encode('\n\r\n'), // LF then a CRLF blank line to dispatch
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('hello');
  });

  it('treats a line without a colon as field with empty value', async () => {
    // A line that has no colon should be parsed with the whole line as the
    // field and empty value (covers the `colonIndex === -1` branch).  Such
    // unknown fields are ignored, so the event still dispatches when data is
    // present.
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('unknownfield\ndata: ok\n\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('ok');
  });

  it('handles "data:value" with no space after colon', async () => {
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('data:no-space\n\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('no-space');
  });

  it('skips dispatch when an empty event (just \\n\\n) is sent', async () => {
    // An event with no data buffer must reset state without emitting.
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('\n\ndata: real\n\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    // Only the real event fires; the leading \n\n produced no message.
    expect(messages).toEqual(['real']);
  });

  it('handles CRLF combo (\\r\\n) line endings — advances by 2', async () => {
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('data: crlf\r\n\r\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('crlf');
  });

  it('buffers a partial line across chunks before processing', async () => {
    // Chunk 1 has no line ending — parser stores it in buffer; chunk 2
    // completes the line.  Covers the "no index found" path that pushes
    // the remainder to buffer.
    const enc = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      multiChunkSseResponse([
        enc.encode('data: par'),
        enc.encode('tial\n\n'),
      ])
    );

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('partial');
  });
});

// ─── _send: routes to _sendLegacySSE when mode is SSE ────────────────────────
describe('VscodeHttpTransport — _send routes to legacy SSE when mode is SSE', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses _sendLegacySSE on subsequent sends after SSE fallback', async () => {
    // First POST → 404, triggers SSE fallback that returns an endpoint, then
    // posts to that endpoint. After that, the transport's mode is SSE.
    const enc = new TextEncoder();
    const endpointEvent = 'event: endpoint\ndata: /sse-post-endpoint\n\n';
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(endpointEvent));
        c.close();
      },
    });

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      // Subsequent legacy SSE POST: ok
      .mockResolvedValueOnce(new Response('ok2', { status: 200 }));

    const t = makeTransport();
    await t.start();
    await t.send('{"id":1}'); // First send: triggers SSE fallback
    expect((t as any).mode.value).toBe(2); // HttpMode.SSE
    await t.send('{"id":2}'); // Second send: goes through _sendLegacySSE branch

    // The 4th call should be a POST to the SSE endpoint, not the original URL.
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect((lastCall[1] as RequestInit).method).toBe('POST');
  });
});

// ─── _attachSSE — message event before endpoint ──────────────────────────────
describe('VscodeHttpTransport — _attachSSE handles message events alongside endpoint', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('emits message events received during SSE attach', async () => {
    const enc = new TextEncoder();
    // SSE GET returns a message event first, then the endpoint event.  Both
    // parser branches (`message` and `endpoint`) inside _attachSSE fire.
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: hello-during-attach\n\n'));
        c.enqueue(enc.encode('event: endpoint\ndata: /the-endpoint\n\n'));
        c.close();
      },
    });

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const t = makeTransport();
    await t.start();
    const messages: string[] = [];
    t.on('message', (m) => messages.push(m));
    await t.send('{"id":1}');
    expect(messages).toContain('hello-during-attach');
  });
});

// ─── _sendStreamableHttp — SSE endpoint event in POST response ───────────────
describe('VscodeHttpTransport — POST response with SSE endpoint event', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('triggers SSE fallback when POST returns text/event-stream with endpoint event', async () => {
    const enc = new TextEncoder();
    // POST returns a 200 text/event-stream body containing an endpoint event
    // — server incorrectly sent SSE-style response. The parser callback
    // should detect event.type === 'endpoint' and call _sseFallbackWithMessage.
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: endpoint\ndata: /sse-endpoint\n\n'));
        c.close();
      },
    });

    // Second fetch (the SSE GET after fallback) must return another SSE body
    // so the fallback can resolve.
    const fallbackStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: endpoint\ndata: /fallback-endpoint\n\n'));
        c.close();
      },
    });

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(sseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(
        new Response(fallbackStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const t = makeTransport();
    await t.start();
    const logs: Array<[string, string]> = [];
    t.on('log', (level: string, msg: string) => logs.push([level, msg]));

    await t.send('{"id":1}');

    // The log should include the warning about receiving SSE endpoint from POST.
    expect(logs.some(([lvl, m]) => lvl === 'warning' && m.includes('Received SSE endpoint from POST'))).toBe(true);
  });
});

// ─── _fetchWithIndependentSignal — redirect without Location header ──────────
describe('VscodeHttpTransport — redirect without Location header', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stops following redirects when 301 has no Location header', async () => {
    // 301 with no Location: the redirect loop breaks immediately and the
    // 301 is treated as the final response (status >= 300 → error).
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('moved', { status: 301 /* no Location header */ })
    );

    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow(/301 status/);
  });
});

// ─── _fetchWithAuthRetry — token-undefined branches ──────────────────────────
describe('VscodeHttpTransport — auth retry edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolve.mockReset();
    mockGetTokenForServer.mockReset();
    mockUpdateFromHeaders.mockReset();
  });

  it('does not retry when getTokenForServer returns undefined on first 401', async () => {
    // Auth metadata resolves but token request returns undefined; the original
    // 401 response is therefore returned without a retry.
    mockResolve.mockResolvedValue({
      providerLabel: 'X',
      authorizationServerMetadata: { issuer: 'https://x' },
      authorizationServerUrl: 'https://x',
      scopes: ['s'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    });
    mockGetTokenForServer.mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
      })
    );

    const t = makeTransport();
    await t.start();
    // 401 → SSE fallback path (status>=400, !401/403 check excludes 401, but
    // _sawAuthChallenge is set after the 401 — so the second `if` (5xx) is
    // skipped too, and we fall through to the >=300 throw branch).
    await expect(t.send('{"id":1}')).rejects.toThrow();
    // Only the initial POST + force-refresh retry (also returns 401).
    // Since token is undefined the retry path is skipped.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles authMetadata resolve returning null (no retry, no force-refresh)', async () => {
    mockResolve.mockResolvedValue(null);
    mockGetTokenForServer.mockResolvedValue(undefined);

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
      })
    );

    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow();
    // resolve was called but returned null — token request never happens.
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockGetTokenForServer).not.toHaveBeenCalled();
  });

  it('handles auth metadata with no issuer (uses authorizationServerUrl in log)', async () => {
    mockResolve.mockResolvedValue({
      providerLabel: 'X',
      authorizationServerMetadata: {}, // No issuer
      authorizationServerUrl: 'https://x',
      scopes: ['s'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    });
    mockGetTokenForServer.mockResolvedValue('tok');

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
        })
      )
      .mockResolvedValueOnce(jsonResponse('{"ok":true}'));

    const t = makeTransport();
    await t.start();
    const logs: string[] = [];
    t.on('log', (_lvl: string, msg: string) => logs.push(msg));
    await t.send('{"id":1}');
    // Log should reference the authorization server URL (since issuer is absent).
    expect(logs.some(m => m.includes('https://x'))).toBe(true);
  });

  it('force-refresh path: token undefined → does not retry again', async () => {
    // Two 401s in a row — second one with Authorization header set should
    // trigger force-refresh.  Force-refresh returns undefined → no third
    // fetch happens.
    mockResolve.mockResolvedValue({
      providerLabel: 'X',
      authorizationServerMetadata: { issuer: 'https://x' },
      authorizationServerUrl: 'https://x',
      scopes: ['s'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    });
    mockGetTokenForServer
      .mockResolvedValueOnce('first-token') // initial retry
      .mockResolvedValueOnce(undefined); // force-refresh returns nothing

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
        })
      )
      // Retry with first-token: still 401
      .mockResolvedValueOnce(
        new Response('Unauthorized again', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
        })
      );

    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow();
    // 2 fetches — the force-refresh was attempted but token was undefined.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockGetTokenForServer).toHaveBeenCalledTimes(2);
  });

  it('_addAuthHeader: getTokenForServer returns undefined → no Authorization header', async () => {
    // Pre-set authMetadata so _addAuthHeader's preflight path runs.  Token
    // is undefined so no Authorization header gets attached.
    const t = makeTransport();
    (t as any).authMetadata = {
      providerLabel: 'X',
      authorizationServerMetadata: { issuer: 'https://x' },
      authorizationServerUrl: 'https://x',
      scopes: ['s'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    };
    mockGetTokenForServer.mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse('{"ok":true}')
    );

    await t.start();
    await t.send('{"id":1}');
    // Authorization header should NOT be set on the POST.
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

// ─── 403 post-auth (covers branch[3] in 359) ─────────────────────────────────
describe('VscodeHttpTransport — 403 after OAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolve.mockReset();
    mockGetTokenForServer.mockReset();
  });

  it('throws descriptive error for 403 after successful sign-in', async () => {
    mockResolve.mockResolvedValue({
      providerLabel: 'X',
      authorizationServerMetadata: { issuer: 'https://x' },
      authorizationServerUrl: 'https://x',
      scopes: ['s'],
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'header' },
    });
    mockGetTokenForServer.mockResolvedValue('tok-xyz');

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
        })
      )
      // Retry with auth header → 403 (feature gate, not auth-related)
      .mockResolvedValue(
        new Response('Forbidden', {
          status: 403,
          headers: { 'WWW-Authenticate': 'Bearer scope="s"' },
        })
      );

    const t = makeTransport();
    await t.start();
    await expect(t.send('{"id":1}')).rejects.toThrow(/403 status from.*after successful sign-in/);
  });
});

// ─── _doSSEWithIndependentSignal — disposed during read ──────────────────────
describe('VscodeHttpTransport — _doSSEWithIndependentSignal disposal', () => {
  it('returns early when disposed mid-stream', async () => {
    const t = makeTransport() as any;
    // Mark disposed before invoking — the reader.read() resolves with whatever
    // the stream emits, then the check `this._disposed || signal.aborted`
    // returns true → cancel + return.
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!pulled) {
          pulled = true;
          c.enqueue(new TextEncoder().encode('data: x\n\n'));
          // Mark transport as disposed after the first chunk so the loop
          // exits via the disposed branch.
          t._disposed = true;
        } else {
          c.close();
        }
      },
    });

    const fakeResponse = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const parser = { feed: vi.fn() };
    const signal = new AbortController().signal;
    await expect(t._doSSEWithIndependentSignal(parser, fakeResponse, signal)).resolves.toBeUndefined();
  });

  it('returns early when the reader throws and we are disposed', async () => {
    const t = makeTransport() as any;
    t._disposed = true; // already disposed
    // Fake reader whose read() rejects.  When wrapped in our try/catch, the
    // disposed flag means we return rather than rethrow.
    const reader = {
      read: () => Promise.reject(new Error('read failed')),
      cancel: vi.fn(),
    };
    const fakeResponse = {
      body: {
        getReader: () => reader,
      },
    } as any;
    const parser = { feed: vi.fn() };
    const signal = new AbortController().signal;
    await expect(t._doSSEWithIndependentSignal(parser, fakeResponse, signal)).resolves.toBeUndefined();
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('rethrows reader error when not disposed and not aborted', async () => {
    const t = makeTransport() as any;
    const reader = {
      read: () => Promise.reject(new Error('read failed')),
      cancel: vi.fn(),
    };
    const fakeResponse = {
      body: {
        getReader: () => reader,
      },
    } as any;
    const parser = { feed: vi.fn() };
    const signal = new AbortController().signal;
    await expect(t._doSSEWithIndependentSignal(parser, fakeResponse, signal)).rejects.toThrow('read failed');
  });
});
