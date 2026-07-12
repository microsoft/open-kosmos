/**
 * Tests for the local OAuth callback HTTP server.
 *
 * Strategy: bind the singleton to a random ephemeral port (port 0) for each
 * test to avoid collisions with the real default 33420 and other tests.
 *
 * Coverage:
 *   - happy path: state matches → resolves with code
 *   - state mismatch: 400 + waiter still pending (timed out, not resolved)
 *   - provider error in query: rejects with provider error message
 *   - timeout: 5-min default reduced to 100ms in tests
 *   - missing-state callback: 400 response, all waiters untouched
 *   - duplicate state registration is rejected
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request as httpRequest } from 'http';
import {
  __resetCallbackServerForTests,
  getCallbackServer,
} from '../CallbackServer';

function call(port: number, qs: Record<string, string>): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams(qs).toString();
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: `/callback?${params}`, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c.toString('utf-8'); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let port = 0;

beforeEach(async () => {
  __resetCallbackServerForTests();
  // Bind on a random ephemeral port for the whole suite to avoid collision
  // with the production default of 33420.
  await getCallbackServer().ensureRunning(0);
  port = getCallbackServer().currentPort!;
});

afterEach(async () => {
  await getCallbackServer().stop();
});

describe('CallbackServer', () => {
  it('happy path: state match → waitForCode resolves with the code', async () => {
    const cs = getCallbackServer();
    const codePromise = cs.waitForCode('STATE_OK', { timeoutMs: 1000 });
    const res = await call(port, { state: 'STATE_OK', code: 'AUTH_CODE_123' });
    expect(res.status).toBe(200);
    await expect(codePromise).resolves.toBe('AUTH_CODE_123');
  });

  it('state mismatch: callback responds 400, waiter unaffected', async () => {
    const cs = getCallbackServer();
    const codePromise = cs.waitForCode('GOOD', { timeoutMs: 100 });
    const res = await call(port, { state: 'WRONG', code: 'X' });
    expect(res.status).toBe(400);
    await expect(codePromise).rejects.toThrow(/timed out/);
  });

  it('provider error → rejects with the provider error message', async () => {
    const cs = getCallbackServer();
    const codePromise = cs.waitForCode('S1', { timeoutMs: 1000 });
    // Attach a no-op handler so the rejection that happens during
    // `call()` (handler runs synchronously when the request comes in) is
    // never seen as "unhandled" by the test runner. The real assertion
    // lives in the final `expect.rejects` below.
    codePromise.catch(() => {});
    const res = await call(port, {
      state: 'S1',
      error: 'access_denied',
      error_description: 'user said no',
    });
    expect(res.status).toBe(200);
    await expect(codePromise).rejects.toThrow(/access_denied/);
  });

  it('timeout fires after the configured window', async () => {
    const cs = getCallbackServer();
    await expect(cs.waitForCode('TO', { timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });

  it('AbortSignal cancels the waiter', async () => {
    const cs = getCallbackServer();
    const ctrl = new AbortController();
    const p = cs.waitForCode('AB', { timeoutMs: 5000, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toThrow(/cancelled/);
  });

  it('missing state → 400, no waiter affected', async () => {
    const cs = getCallbackServer();
    const codePromise = cs.waitForCode('Z', { timeoutMs: 200 });
    const res = await call(port, { code: 'X' }); // no state
    expect(res.status).toBe(400);
    await expect(codePromise).rejects.toThrow(/timed out/);
  });

  it('non-/callback path returns 404', async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path: '/elsewhere', method: 'GET' },
        (r) => {
          r.resume();
          resolve({ status: r.statusCode ?? 0 });
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(404);
  });

  it('duplicate state registration is rejected', async () => {
    const cs = getCallbackServer();
    const p1 = cs.waitForCode('DUP', { timeoutMs: 200 });
    // waitForCode is async; the duplicate-state throw turns into a rejection.
    const p2 = cs.waitForCode('DUP', { timeoutMs: 200 });
    await expect(p2).rejects.toThrow(/Duplicate OAuth state/);
    // p1 should still time out cleanly
    await expect(p1).rejects.toThrow(/timed out/);
  });

  it('html-escapes provider error in the response body', async () => {
    const cs = getCallbackServer();
    const p = cs.waitForCode('XSS', { timeoutMs: 1000 });
    p.catch(() => {});
    const res = await call(port, {
      state: 'XSS',
      error: '<script>alert(1)</script>',
      error_description: '<img/>',
    });
    expect(res.body).not.toContain('<script>');
    expect(res.body).toContain('&lt;script&gt;');
    await expect(p).rejects.toThrow();
  });

  it('rejects ensureRunning with a different port after first bind', async () => {
    const cs = getCallbackServer();
    // already bound on `port` from beforeEach
    await expect(cs.ensureRunning(port + 1)).rejects.toThrow(/already running/);
  });

  it('rejects concurrent ensureRunning with a different port while start is pending', async () => {
    // Start with a fresh registry so we can race two ensureRunning calls
    // against the same brand-new instance — the existing server bound by
    // beforeEach is on a known port, so we point a new instance at port 0
    // and immediately race a second ensureRunning(other) before bind
    // resolves. The mismatch must surface as a rejection on the second
    // call, not a silent same-port lie.
    __resetCallbackServerForTests();
    const cs = getCallbackServer(0);
    const first = cs.ensureRunning(0);
    const second = cs.ensureRunning(33999);
    await expect(second).rejects.toThrow(/starting on port 0/);
    // First call still completes successfully on its requested port.
    await first;
    expect(cs.currentPort).not.toBeNull();
    await cs.stop();
  });

  it('per-port instances are independent (multi-port support)', async () => {
    __resetCallbackServerForTests();
    const csA = getCallbackServer(0);
    const csB = getCallbackServer(33998);
    expect(csA).not.toBe(csB);
    // getCallbackServer returns the same instance for the same port key.
    expect(getCallbackServer(0)).toBe(csA);
    expect(getCallbackServer(33998)).toBe(csB);
  });
});
