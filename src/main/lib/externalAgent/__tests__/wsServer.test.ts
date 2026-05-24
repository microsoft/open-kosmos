vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Real WebSocket is needed — use ws library directly
import WebSocket from 'ws';
import { ExternalAgentWsServer } from '../wsServer';

const TEST_PORT = 19527;
const TOKEN = 'test-token-123';

function connectAndAuth(
  port: number,
  token = TOKEN,
): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: any[] = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (msg.type === 'auth_success' || msg.type === 'auth_error') {
        resolve({ ws, messages });
      }
    });
    ws.on('error', reject);
    // Timeout safety
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function connectRaw(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on('close', (code) => resolve(code));
    setTimeout(() => resolve(-1), 5000);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ExternalAgentWsServer', () => {
  let server: ExternalAgentWsServer;

  beforeEach(() => {
    server = new ExternalAgentWsServer({ port: TEST_PORT });
    server.setTokenValidator((token) => token === TOKEN);
  });

  afterEach(async () => {
    server.stop();
    await delay(50); // allow port to release
  });

  describe('auth', () => {
    it('authenticates with valid token', async () => {
      server.start();
      const { ws, messages } = await connectAndAuth(TEST_PORT);
      expect(messages[0].type).toBe('auth_success');
      expect(server.isConnected).toBe(true);
      ws.close();
    });

    it('fires onConnected when client authenticates', async () => {
      let connected = false;
      server.onConnected(() => { connected = true; });
      server.start();
      const { ws } = await connectAndAuth(TEST_PORT);
      expect(connected).toBe(true);
      ws.close();
    });

    it('rejects invalid token with 4004', async () => {
      server.start();
      const { ws, messages } = await connectAndAuth(TEST_PORT, 'bad-token');
      expect(messages[0].type).toBe('auth_error');
      const code = await waitForClose(ws);
      expect(code).toBe(4004);
    });

    it('closes connection after auth timeout (10s)', async () => {
      const localServer = new ExternalAgentWsServer({ port: TEST_PORT + 2 });
      localServer.setTokenValidator(() => true);
      localServer.start();

      // Connect but do NOT authenticate — just wait for the unauthenticated
      // connection to be set up, then fire the underlying auth timeout callback
      // by spying on setTimeout after the server is started.
      const originalSetTimeout = global.setTimeout;
      let capturedAuthTimeoutFn: (() => void) | null = null;
      const spied = (fn: (...args: unknown[]) => void, ms?: number) => {
        // Only capture the short-ish auth timeout (10000ms)
        if (ms === 10000) capturedAuthTimeoutFn = fn as () => void;
        return originalSetTimeout(fn, ms);
      };
      global.setTimeout = spied as typeof setTimeout;

      const ws = await connectRaw(TEST_PORT + 2);
      await delay(30); // let connection handler fire and register the timeout

      global.setTimeout = originalSetTimeout;

      const closePromise = waitForClose(ws);
      expect(capturedAuthTimeoutFn).not.toBeNull();
      capturedAuthTimeoutFn!();

      const code = await closePromise;
      expect(code).toBe(1008);

      localServer.stop();
      await delay(50);
    });

    it('blocks IP after repeated auth failures', async () => {
      server.start();

      // Exhaust the failure threshold (5 attempts)
      for (let i = 0; i < 5; i++) {
        const { ws } = await connectAndAuth(TEST_PORT, 'wrong-token');
        await waitForClose(ws);
      }

      // 6th connection should be immediately closed with 4008
      const ws = await connectRaw(TEST_PORT);
      const code = await waitForClose(ws);
      expect(code).toBe(4008);
    });
  });

  describe('connection dedup (4009)', () => {
    it('closes previous connection when same token reconnects', async () => {
      server.start();

      const first = await connectAndAuth(TEST_PORT);
      expect(server.isConnected).toBe(true);

      const closePromise = waitForClose(first.ws);
      const second = await connectAndAuth(TEST_PORT);

      const code = await closePromise;
      expect(code).toBe(4009);
      expect(server.isConnected).toBe(true);

      second.ws.close();
    });
  });

  describe('rate limiting (4010)', () => {
    it('closes connection when rate limit exceeded', async () => {
      server.start();

      // Open MAX_CONNECTIONS_PER_WINDOW (5) connections quickly
      const connections: WebSocket[] = [];
      for (let i = 0; i < 5; i++) {
        connections.push(await connectRaw(TEST_PORT));
      }

      // 6th should be rate limited
      const ws = await connectRaw(TEST_PORT);
      const code = await waitForClose(ws);
      expect(code).toBe(4010);

      // Cleanup
      connections.forEach((c) => c.close());
    });
  });

  describe('push routing', () => {
    it('forwards push and push_end to handlers', async () => {
      const pushes: { text: string; convId: string; token: string }[] = [];
      const pushEnds: { convId: string; token: string }[] = [];

      server.onPush((text, convId, token) => pushes.push({ text, convId, token }));
      server.onPushEnd((convId, token) => pushEnds.push({ convId, token }));
      server.start();

      const { ws } = await connectAndAuth(TEST_PORT);
      ws.send(JSON.stringify({ type: 'push', text: 'hello', conversationId: 'conv-1' }));
      ws.send(JSON.stringify({ type: 'push_end', conversationId: 'conv-1' }));
      await delay(50);

      expect(pushes).toEqual([{ text: 'hello', convId: 'conv-1', token: TOKEN }]);
      expect(pushEnds).toEqual([{ convId: 'conv-1', token: TOKEN }]);
      ws.close();
    });

    it('rejects push from unauthenticated client', async () => {
      const pushes: any[] = [];
      server.onPush((text, convId, token) => pushes.push({ text, convId, token }));
      server.start();

      const ws = await connectRaw(TEST_PORT);
      ws.send(JSON.stringify({ type: 'push', text: 'sneaky', conversationId: 'conv-1' }));
      const code = await waitForClose(ws);

      expect(pushes).toHaveLength(0);
      expect(code).toBe(4004); // 'not authenticated'
    });

    it('ignores push missing text or conversationId', async () => {
      const pushes: any[] = [];
      server.onPush((text, convId, token) => pushes.push({ text, convId, token }));
      server.start();

      const { ws } = await connectAndAuth(TEST_PORT);
      // Missing text
      ws.send(JSON.stringify({ type: 'push', conversationId: 'conv-1' }));
      // Missing conversationId
      ws.send(JSON.stringify({ type: 'push', text: 'hello' }));
      // Missing conversationId for push_end
      ws.send(JSON.stringify({ type: 'push_end' }));
      await delay(50);

      expect(pushes).toHaveLength(0);
      ws.close();
    });

    it('handles malformed JSON gracefully', async () => {
      server.start();
      const { ws } = await connectAndAuth(TEST_PORT);
      // Send invalid JSON — should not crash
      ws.send('not-valid-json{{{');
      await delay(50);
      expect(server.isConnected).toBe(true);
      ws.close();
    });
  });

  describe('sendMessage', () => {
    it('delivers message to authenticated client', async () => {
      server.start();
      const { ws, messages } = await connectAndAuth(TEST_PORT);

      server.sendMessage('hi bot', 'conv-1', TOKEN);
      await delay(50);

      const serverMsg = messages.find((m) => m.type === 'message');
      expect(serverMsg).toEqual({ type: 'message', text: 'hi bot', conversationId: 'conv-1' });
      ws.close();
    });

    it('returns false for unknown token', () => {
      server.start();
      expect(server.sendMessage('hi', 'conv-1', 'unknown')).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('fires onDisconnected when last client leaves', async () => {
      let disconnected = false;
      server.onDisconnected(() => { disconnected = true; });
      server.start();

      const { ws } = await connectAndAuth(TEST_PORT);
      ws.close();
      await delay(50);

      expect(disconnected).toBe(true);
      expect(server.isConnected).toBe(false);
    });

    it('does not throw when client disconnects without onDisconnected handler set', async () => {
      // Do NOT call server.onDisconnected — test the null-handler path
      server.start();
      const { ws } = await connectAndAuth(TEST_PORT);
      ws.close();
      await delay(50);
      // No assertion needed — just verify it doesn't throw
      expect(server.isConnected).toBe(false);
    });

    it('does not fire onDisconnected when replaced connection closes', async () => {
      let disconnectCount = 0;
      server.onDisconnected(() => { disconnectCount++; });
      server.start();

      const first = await connectAndAuth(TEST_PORT);
      const second = await connectAndAuth(TEST_PORT);
      // first gets closed with 4009 — should NOT trigger onDisconnected
      await waitForClose(first.ws);
      await delay(50);

      expect(disconnectCount).toBe(0);
      expect(server.isConnected).toBe(true);

      second.ws.close();
      await delay(50);
      expect(disconnectCount).toBe(1);
    });
  });
});
