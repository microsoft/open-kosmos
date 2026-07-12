import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer, request as httpRequest } from 'http';
import {
  __resetCallbackServerForTests,
  getCallbackServer,
  OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT,
} from '../CallbackServer';

const activeServers = new Set<any>();

function trackServer<T>(server: T): T {
  activeServers.add(server);
  return server;
}

async function call(port: number, qs: Record<string, string | undefined>): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(qs)) {
    if (typeof value === 'string') {
      params.set(key, value);
    }
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: `/callback?${params.toString()}`,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function closeNodeServer(server: any): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  for (const server of Array.from(activeServers)) {
    if (typeof server.stop === 'function') {
      await server.stop();
    } else {
      await closeNodeServer(server);
    }
  }
  activeServers.clear();
  __resetCallbackServerForTests();
});

describe('CallbackServer additional coverage', () => {
  it('reports null currentPort and throws before startup', async () => {
    const cs = trackServer(getCallbackServer(0));

    expect(cs.currentPort).toBeNull();
    expect(() => cs.getRedirectUri()).toThrow(/not started/);
    await expect(cs.waitForCode('state-before-start')).rejects.toThrow(/not started/);
  });

  it('uses the default callback port when ensureRunning is called without a preferred port', async () => {
    const cs = getCallbackServer();
    const startInternalSpy = vi.spyOn(cs as any, 'startInternal').mockResolvedValue(undefined);

    await cs.ensureRunning();

    expect(startInternalSpy).toHaveBeenCalledWith(OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT);
    startInternalSpy.mockRestore();
  });

  it('reuses the same in-flight startup promise when the requested port matches', async () => {
    const cs = getCallbackServer(0);
    let resolveStart!: () => void;
    const startPromise = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    const startInternalSpy = vi.spyOn(cs as any, 'startInternal').mockReturnValue(startPromise);

    const firstStart = cs.ensureRunning(0);
    const secondStart = cs.ensureRunning(0);

    resolveStart();
    await Promise.all([firstStart, secondStart]);
    expect(startInternalSpy).toHaveBeenCalledTimes(1);

    startInternalSpy.mockRestore();
  });

  it('surfaces an already-in-use port with a friendly message', async () => {
    const blocker = trackServer(createHttpServer());
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const port = (blocker.address() as { port: number }).port;
    const cs = trackServer(getCallbackServer(port));

    await expect(cs.ensureRunning(port)).rejects.toThrow(/already in use/);
  });

  it('rejects immediately when the wait signal is already aborted', async () => {
    const cs = trackServer(getCallbackServer(0));
    await cs.ensureRunning(0);
    const controller = new AbortController();
    controller.abort();

    await expect(cs.waitForCode('aborted-state', { signal: controller.signal })).rejects.toThrow(/before callback/);
  });

  it('rejects signal-aware waiters when the server stops', async () => {
    const cs = trackServer(getCallbackServer(0));
    await cs.ensureRunning(0);
    const controller = new AbortController();

    const waitPromise = cs.waitForCode('stop-state', { signal: controller.signal, timeoutMs: 1_000 });
    await cs.stop();

    expect(cs.currentPort).toBeNull();
    await expect(waitPromise).rejects.toThrow(/stopped/);
    activeServers.delete(cs);
  });

  it('resolves a signal-aware waiter and allows idempotent ensureRunning on the bound port', async () => {
    const cs = trackServer(getCallbackServer(0));
    await cs.ensureRunning(0);
    const port = cs.currentPort!;
    const controller = new AbortController();

    await expect(cs.ensureRunning(port)).resolves.toBeUndefined();

    const waitPromise = cs.waitForCode('resolved-state', { signal: controller.signal });
    const response = await call(port, { state: 'resolved-state', code: 'resolved-code' });

    expect(response.status).toBe(200);
    await expect(waitPromise).resolves.toBe('resolved-code');
  });

  it('renders provider errors without a description and escapes post-startup non-Error emissions', async () => {
    const cs = trackServer(getCallbackServer(0));
    await cs.ensureRunning(0);
    const port = cs.currentPort!;
    const waitPromise = cs.waitForCode('provider-error', { timeoutMs: 1_000 });
    waitPromise.catch(() => {});

    (cs as any).server.emit('error', 'socket closed unexpectedly');
    const response = await call(port, { state: 'provider-error', error: 'access_denied' });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain('access_denied:');
    await expect(waitPromise).rejects.toThrow('OAuth provider error: access_denied');
  });

  it('rejects callbacks that omit the authorization code', async () => {
    const cs = trackServer(getCallbackServer(0));
    await cs.ensureRunning(0);
    const port = cs.currentPort!;
    const waitPromise = cs.waitForCode('missing-code', { timeoutMs: 1_000 });
    waitPromise.catch(() => {});

    const response = await call(port, { state: 'missing-code' });

    expect(response.status).toBe(400);
    await expect(waitPromise).rejects.toThrow(/missing authorization code/);
  });
});
