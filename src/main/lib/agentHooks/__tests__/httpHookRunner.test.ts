import { EventEmitter } from 'events';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({
  lookup: lookupMock,
}));

const httpsRequestMock = vi.hoisted(() => vi.fn());
const httpRequestMock = vi.hoisted(() => vi.fn());
vi.mock('https', () => ({ request: httpsRequestMock }));
vi.mock('http', () => ({ request: httpRequestMock }));

import { runHttpHook, validateHookUrl } from '../httpHookRunner';
import {
  MAX_HOOK_HTTP_BODY_LENGTH,
  MAX_HOOK_HTTP_HEADER_CHARS,
  MAX_HOOK_HTTP_HEADERS,
  MAX_HOOK_OUTPUT_BYTES,
} from '../types';
import type { CommandHookEnv } from '../commandHookRunner';
import type { AgentHookInput, HttpHookAction } from '../types';

const env: CommandHookEnv = {
  event: 'PreToolUse',
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Kobi',
};

const input: AgentHookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  user_alias: 'alice',
  chat_id: 'chat-1',
  chat_session_id: 'sess-1',
  agent_id: 'Kobi',
  agent_name: 'Kobi',
  tool_name: 'Read',
  tool_use_id: 'tc-1',
  tool_call_id: 'tc-1',
  tool_input: { path: '/a' },
};

const action = (over: Partial<HttpHookAction> = {}): HttpHookAction => ({
  type: 'http',
  url: 'https://example.com/hook',
  ...over,
});

class FakeRequest extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
}

class FakeResponse extends EventEmitter {
  constructor(readonly statusCode: number) {
    super();
  }
}

function mockHttpsResponse(text: string | null, opts: { status?: number } = {}): FakeRequest {
  const req = new FakeRequest();
  httpsRequestMock.mockImplementationOnce((_url: URL, _options: any, cb: (res: FakeResponse) => void) => {
    const res = new FakeResponse(opts.status ?? 200);
    queueMicrotask(() => {
      cb(res);
      if (text !== null) res.emit('data', Buffer.from(text));
      res.emit('end');
    });
    return req;
  });
  return req;
}

function mockHttpsError(error: unknown): FakeRequest {
  const req = new FakeRequest();
  httpsRequestMock.mockImplementationOnce(() => {
    queueMicrotask(() => req.emit('error', error));
    return req;
  });
  return req;
}

function mockHttpsAbortableRequest(): FakeRequest {
  const req = new FakeRequest();
  httpsRequestMock.mockImplementationOnce((_url: URL, options: any) => {
    options.signal?.addEventListener('abort', () => {
      req.emit('error', new DOMException('Aborted', 'AbortError'));
    });
    return req;
  });
  return req;
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  httpsRequestMock.mockReset();
  httpRequestMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateHookUrl', () => {
  it('rejects empty and whitespace-only URLs', () => {
    expect(validateHookUrl('')).toBe('Empty hook URL');
    expect(validateHookUrl('   ')).toBe('Empty hook URL');
  });

  it('rejects unparseable URLs', () => {
    expect(validateHookUrl('not a url')).toBe('Hook URL is not a valid URL');
  });

  it('rejects non-http(s) protocols', () => {
    expect(validateHookUrl('ftp://example.com')).toBe('Hook URL must use http or https');
    expect(validateHookUrl('file:///etc/passwd')).toBe('Hook URL must use http or https');
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateHookUrl('https://user:pass@example.com')).toBe('Hook URL must not contain credentials');
  });

  it('rejects loopback, localhost and private/reserved hosts', () => {
    const blocked = [
      'http://localhost/x',
      'http://app.localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/x',
      'http://0.1.2.3/x',
      'http://10.1.2.3/x',
      'http://169.254.169.254/latest/meta-data',
      'http://172.16.0.1/x',
      'http://172.31.255.1/x',
      'http://192.168.1.1/x',
      'http://100.64.0.1/x',
      'http://224.0.0.1/x',
      'http://[::1]/x',
      'http://[fc00::1]/x',
      'http://[fd12::1]/x',
      'http://[fe80::1]/x',
      'http://[fe90::1]/x',
      'http://[febf::1]/x',
      'http://[ff02::1]/x',
      'http://[2001:db8::1]/x',
      'http://localhost./x',
      'http://127.0.0.1./x',
      'http://[::ffff:7f00:1]/x',
      'http://[::ffff:127.0.0.1]/x',
      'http://[::ffff:a9fe:a9fe]/x',
    ];
    for (const url of blocked) {
      expect(validateHookUrl(url)).toBe('Hook URL targets a blocked (private, loopback, or reserved) host');
    }
  });

  it('accepts public http and https URLs without blocking DNS-like prefixes', () => {
    expect(validateHookUrl('https://example.com/hook')).toBeUndefined();
    expect(validateHookUrl('https://fc.example.com/hook')).toBeUndefined();
    expect(validateHookUrl('http://203.0.113.5/hook')).toBeUndefined();
    expect(validateHookUrl('http://172.32.0.1/hook')).toBeUndefined();
    expect(validateHookUrl('http://192.169.0.1/hook')).toBeUndefined();
  });
});

describe('runHttpHook', () => {
  it('blocks a disallowed URL before opening a request', async () => {
    const res = await runHttpHook(action({ url: 'http://127.0.0.1/x' }), input, env);
    expect(res.success).toBe(false);
    expect(res.error).toContain('blocked');
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to private addresses before opening a request', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    const res = await runHttpHook(action({ url: 'http://127.0.0.1.nip.io/x' }), input, env);

    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook URL resolves to a blocked (private, loopback, or reserved) address');
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to IPv6 link-local or multicast addresses', async () => {
    lookupMock.mockResolvedValueOnce([{ address: 'fe90::1', family: 6 }]);

    const linkLocal = await runHttpHook(action({ url: 'https://ipv6-link-local.example/hook' }), input, env);

    expect(linkLocal.success).toBe(false);
    expect(linkLocal.error).toBe('Hook URL resolves to a blocked (private, loopback, or reserved) address');
    lookupMock.mockResolvedValueOnce([{ address: 'ff02::1', family: 6 }]);

    const multicast = await runHttpHook(action({ url: 'https://ipv6-multicast.example/hook' }), input, env);

    expect(multicast.success).toBe(false);
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('fails closed when hostname resolution fails', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const res = await runHttpHook(action({ url: 'https://missing.example/hook' }), input, env);

    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook URL hostname could not be resolved');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('applies hook timeout while waiting for DNS resolution', async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockImplementationOnce(() => new Promise(() => {}));

      const pending = runHttpHook(action({ url: 'https://slow-dns.example/hook', timeout: 0.1 }), input, env);
      await vi.advanceTimersByTimeAsync(100);
      const res = await pending;

      expect(res.success).toBe(false);
      expect(res.timedOut).toBe(true);
      expect(res.error).toBe('Hook timed out after 100ms');
      expect(httpsRequestMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns early when the parent signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await runHttpHook(action(), input, env, controller.signal);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook cancelled before start');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('posts the input JSON by default and maps a 2xx response with pinned DNS lookup', async () => {
    const req = mockHttpsResponse('{"ok":true}', { status: 200 });
    const res = await runHttpHook(action(), input, env);

    expect(res.success).toBe(true);
    expect(res.exitCode).toBe(200);
    expect(res.stdout).toBe('{"ok":true}');
    const [url, init] = httpsRequestMock.mock.calls[0] as unknown as [URL, any];
    expect(url.href).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(req.write).toHaveBeenCalledWith(JSON.stringify(input));
    expect(req.end).toHaveBeenCalled();
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-openkosmos-hook-event']).toBe('PreToolUse');
    await new Promise<void>((resolve) => init.lookup('example.com', {}, (_err: unknown, address: string, family: number) => {
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
      resolve();
    }));
    await new Promise<void>((resolve) => init.lookup('example.com', { all: true }, (_err: unknown, addresses: Array<{ address: string; family: number }>) => {
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
      resolve();
    }));
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('falls back to DNS lookup for unexpected hostnames in the pinned lookup callback', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce({ address: '93.184.216.35', family: 4 });
    mockHttpsResponse('ok', { status: 200 });
    await runHttpHook(action(), input, env);

    const init = (httpsRequestMock.mock.calls[0] as unknown as [URL, any])[1];
    await new Promise<void>((resolve) => init.lookup('cdn.example.com', {}, (_err: unknown, address: string, family: number) => {
      expect(address).toBe('93.184.216.35');
      expect(family).toBe(4);
      resolve();
    }));
  });

  it('does not attach a pinned lookup for IP literal URLs', async () => {
    mockHttpsResponse('ok', { status: 200 });

    await runHttpHook(action({ url: 'https://203.0.113.5/hook' }), input, env);

    expect(lookupMock).not.toHaveBeenCalled();
    const init = (httpsRequestMock.mock.calls[0] as unknown as [URL, any])[1];
    expect(init.lookup).toBeUndefined();
  });

  it('does not send a body for GET and honors a custom method/headers/body', async () => {
    const getReq = mockHttpsResponse('', { status: 204 });
    await runHttpHook(action({ method: 'GET', headers: { 'X-A': '1' } }), input, env);
    let init = (httpsRequestMock.mock.calls[0] as unknown as [URL, any])[1];
    expect(init.method).toBe('GET');
    expect(getReq.write).not.toHaveBeenCalled();
    expect(init.headers['X-A']).toBe('1');

    const putReq = mockHttpsResponse('', { status: 200 });
    await runHttpHook(action({ method: 'PUT', body: 'raw-body' }), input, env);
    init = (httpsRequestMock.mock.calls[1] as unknown as [URL, any])[1];
    expect(init.method).toBe('PUT');
    expect(putReq.write).toHaveBeenCalledWith('raw-body');
  });

  it('rejects oversized request headers before sending the request', async () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i <= MAX_HOOK_HTTP_HEADERS; i += 1) {
      headers[`H${i}`] = 'v';
    }

    const res = await runHttpHook(action({ headers }), input, env);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Hook headers exceed');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects oversized request header characters before sending the request', async () => {
    const res = await runHttpHook(
      action({ headers: { H: 'v'.repeat(MAX_HOOK_HTTP_HEADER_CHARS + 1) } }),
      input,
      env,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('Hook headers exceed');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('allows maximum custom request header characters without counting default headers', async () => {
    mockHttpsResponse('ok');
    const headerValue = 'v'.repeat(MAX_HOOK_HTTP_HEADER_CHARS - 'H'.length);

    const res = await runHttpHook(action({ headers: { H: headerValue } }), input, env);

    expect(res.success).toBe(true);
    expect(httpsRequestMock).toHaveBeenCalled();
  });

  it('rejects oversized request bodies before sending the request', async () => {
    const res = await runHttpHook(action({ body: 'b'.repeat(MAX_HOOK_HTTP_BODY_LENGTH + 1) }), input, env);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Hook body exceeds');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('falls back to POST when the configured method is not allowed', async () => {
    mockHttpsResponse('ok');
    await runHttpHook(action({ method: 'TRACE' as unknown as HttpHookAction['method'] }), input, env);
    expect((httpsRequestMock.mock.calls[0] as unknown as [URL, any])[1].method).toBe('POST');
  });

  it('uses the http transport for http URLs', async () => {
    const req = new FakeRequest();
    httpRequestMock.mockImplementationOnce((_url: URL, _options: any, cb: (res: FakeResponse) => void) => {
      const res = new FakeResponse(200);
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('ok'));
        res.emit('end');
      });
      return req;
    });

    const res = await runHttpHook(action({ url: 'http://example.com/hook' }), input, env);

    expect(res.success).toBe(true);
    expect(httpRequestMock).toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('marks a non-2xx response as failure with the status', async () => {
    mockHttpsResponse('nope', { status: 503 });
    const res = await runHttpHook(action(), input, env);
    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(503);
    expect(res.error).toBe('HTTP hook returned status 503');
    expect(res.stdout).toBe('nope');
  });

  it('returns an empty body when the response has no data', async () => {
    mockHttpsResponse(null, { status: 200 });
    const res = await runHttpHook(action(), input, env);
    expect(res.success).toBe(true);
    expect(res.stdout).toBe('');
  });

  it('accepts string response chunks and ignores chunks after the byte cap', async () => {
    const req = new FakeRequest();
    httpsRequestMock.mockImplementationOnce((_url: URL, _options: any, cb: (res: FakeResponse) => void) => {
      const res = new FakeResponse(200);
      queueMicrotask(() => {
        cb(res);
        res.emit('data', 'x'.repeat(MAX_HOOK_OUTPUT_BYTES));
        res.emit('data', 'ignored');
        res.emit('end');
      });
      return req;
    });

    const res = await runHttpHook(action(), input, env);

    expect(res.stdout.length).toBe(MAX_HOOK_OUTPUT_BYTES);
  });

  it('reports response stream errors as HTTP hook errors', async () => {
    const req = new FakeRequest();
    httpsRequestMock.mockImplementationOnce((_url: URL, _options: any, cb: (res: FakeResponse) => void) => {
      const res = new FakeResponse(200);
      queueMicrotask(() => {
        cb(res);
        res.emit('error', new Error('stream exploded'));
      });
      return req;
    });

    const res = await runHttpHook(action(), input, env);

    expect(res.success).toBe(false);
    expect(res.error).toBe('HTTP hook error: stream exploded');
  });

  it('treats a response without status code as non-success status 0', async () => {
    const req = new FakeRequest();
    httpsRequestMock.mockImplementationOnce((_url: URL, _options: any, cb: (res: FakeResponse) => void) => {
      const res = new FakeResponse(undefined as unknown as number);
      queueMicrotask(() => {
        cb(res);
        res.emit('end');
      });
      return req;
    });

    const res = await runHttpHook(action(), input, env);

    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(0);
  });

  it('caps an oversized response body', async () => {
    const big = 'x'.repeat(MAX_HOOK_OUTPUT_BYTES + 100);
    mockHttpsResponse(big, { status: 200 });
    const res = await runHttpHook(action(), input, env);
    expect(res.stdout.length).toBe(MAX_HOOK_OUTPUT_BYTES);
  });

  it('caps a multibyte response body by bytes, not characters', async () => {
    const big = 'ñ'.repeat(MAX_HOOK_OUTPUT_BYTES);
    mockHttpsResponse(big, { status: 200 });
    const res = await runHttpHook(action(), input, env);
    expect(new TextEncoder().encode(res.stdout).length).toBe(MAX_HOOK_OUTPUT_BYTES);
    expect(res.stdout.length).toBe(MAX_HOOK_OUTPUT_BYTES / 2);
  });

  it('reports a timeout when the request exceeds its timeout', async () => {
    mockHttpsAbortableRequest();
    const res = await runHttpHook(action({ timeout: 0.05 }), input, env);
    expect(res.success).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.error).toContain('timed out');
  });

  it('reports cancellation when the parent signal aborts mid-flight', async () => {
    mockHttpsAbortableRequest();
    const parent = new AbortController();
    const promise = runHttpHook(action({ timeoutMs: 60_000 }), input, env, parent.signal);
    while (httpsRequestMock.mock.calls.length === 0) {
      await Promise.resolve();
    }
    parent.abort();
    const res = await promise;
    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook cancelled');
  });

  it('reports a network error from an Error rejection', async () => {
    mockHttpsError(new Error('boom'));
    const res = await runHttpHook(action(), input, env);
    expect(res.success).toBe(false);
    expect(res.error).toBe('HTTP hook error: boom');
  });

  it('reports a network error from a non-Error rejection', async () => {
    mockHttpsError('plain failure');
    const res = await runHttpHook(action(), input, env);
    expect(res.success).toBe(false);
    expect(res.error).toBe('HTTP hook error: plain failure');
  });
});
