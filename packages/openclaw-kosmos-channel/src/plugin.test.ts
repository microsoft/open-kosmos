import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock openclaw SDK — not installed in Kosmos repo
vi.mock('openclaw/plugin-sdk/channel-core', () => ({}));
vi.mock('openclaw/plugin-sdk/inbound-reply-dispatch', () => ({
  dispatchInboundReplyWithBase: vi.fn(),
}));

let mockWsInstance: any;
let wsConstructCount = 0;
vi.mock('ws', () => {
  return {
    WebSocket: class extends EventEmitter {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      close = vi.fn(function (this: any) { this.readyState = 3; });
      constructor(..._args: any[]) {
        super();
        mockWsInstance = this as any;
        wsConstructCount++;
      }
    },
  };
});

// Import after mocks
const { kosmosPlugin } = await import('./plugin.js');

// Helper: create a minimal gateway context
function createGatewayCtx(overrides: Record<string, any> = {}) {
  return {
    cfg: {
      plugins: { entries: { kosmos: { config: { url: 'ws://localhost:9527', accounts: { default: { token: 'test-token' } } } } } },
    },
    accountId: 'default',
    account: { accountId: 'default', token: 'test-token', configured: true },
    abortSignal: new AbortController().signal,
    setStatus: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    channelRuntime: {
      routing: { resolveAgentRoute: vi.fn(() => ({ agentId: 'main', sessionKey: 'key' })) },
      session: { resolveStorePath: vi.fn(() => '/tmp/store'), recordInboundSession: vi.fn() },
      reply: {
        formatAgentEnvelope: vi.fn(() => 'envelope'),
        finalizeInboundContext: vi.fn(() => ({})),
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      },
    },
    ...overrides,
  };
}

describe('config resolution', () => {
  it('resolves account with valid config', () => {
    const cfg = {
      plugins: { entries: { kosmos: { config: { accounts: { mybot: { token: 'abc123' } } } } } },
    };
    const result = kosmosPlugin.config.resolveAccount(cfg as any, 'mybot');
    expect(result).toEqual({ accountId: 'mybot', token: 'abc123', configured: true });
  });

  it('falls back to default accountId when omitted', () => {
    const cfg = {
      plugins: { entries: { kosmos: { config: { accounts: { default: { token: 'def' } } } } } },
    };
    const result = kosmosPlugin.config.resolveAccount(cfg as any, null);
    expect(result.accountId).toBe('default');
    expect(result.token).toBe('def');
  });

  it('returns configured: false when token is missing', () => {
    const cfg = {
      plugins: { entries: { kosmos: { config: { accounts: { default: {} } } } } },
    };
    const result = kosmosPlugin.config.resolveAccount(cfg as any, 'default');
    expect(result.configured).toBe(false);
    expect(result.token).toBe('');
  });

  it('returns empty account list when config is missing', () => {
    const ids = kosmosPlugin.config.listAccountIds({} as any);
    expect(ids).toEqual([]);
  });

  it('isConfigured returns true when configured', () => {
    expect(kosmosPlugin.config.isConfigured({ accountId: 'a', token: 't', configured: true })).toBe(true);
  });

  it('isConfigured returns false when not configured', () => {
    expect(kosmosPlugin.config.isConfigured({ accountId: 'a', token: '', configured: false })).toBe(false);
  });
});

describe('gateway.startAccount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sends auth message on ws open', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    // Simulate ws open
    mockWsInstance.emit('open');

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'test-token' })
    );
  });

  it('sets connected status on auth_success', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    mockWsInstance.emit('open');
    mockWsInstance.emit('message', JSON.stringify({ type: 'auth_success' }));

    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true, running: true })
    );
  });

  it('does not reconnect on 4004 close (invalid token)', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    mockWsInstance.emit('open');
    mockWsInstance.emit('close', 4004);

    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Auth token rejected')
    );

    // Advance timers — should NOT create a new WebSocket
    const countBefore = wsConstructCount;
    vi.advanceTimersByTime(60000);
    expect(wsConstructCount).toBe(countBefore);
  });

  it('schedules reconnect on normal close', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    const countBefore = wsConstructCount;

    mockWsInstance.emit('close', 1006);

    // Advance past first reconnect delay (1000ms)
    vi.advanceTimersByTime(1000);
    expect(wsConstructCount).toBe(countBefore + 1);
  });

  it('returns early when url is not configured', async () => {
    const ctx = createGatewayCtx({
      cfg: { plugins: { entries: { kosmos: { config: {} } } } },
    });
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.stringContaining('No url configured')
    );
    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ configured: false })
    );
  });
});

describe('gateway.stopAccount', () => {
  it('closes ws connection', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    mockWsInstance.emit('open');
    mockWsInstance.emit('message', JSON.stringify({ type: 'auth_success' }));

    await kosmosPlugin.gateway!.stopAccount!({
      accountId: 'default',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any);

    expect(mockWsInstance.close).toHaveBeenCalled();
  });
});

describe('outbound.sendText', () => {
  it('sends push with correct conversationId', async () => {
    const ctx = createGatewayCtx();
    await kosmosPlugin.gateway!.startAccount!(ctx as any);

    mockWsInstance.emit('open');
    mockWsInstance.emit('message', JSON.stringify({ type: 'auth_success' }));

    const result = await kosmosPlugin.outbound!.sendText!({
      text: 'hello',
      to: 'conv-123',
      accountId: 'default',
    } as any);

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'push', text: 'hello', conversationId: 'conv-123' })
    );
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'push_end', conversationId: 'conv-123' })
    );
    expect(result.messageId).toMatch(/^kosmos-/);
  });

  it('throws when no connected client', async () => {
    await expect(
      kosmosPlugin.outbound!.sendText!({
        text: 'hello',
        to: 'conv-123',
        accountId: 'nonexistent',
      } as any)
    ).rejects.toThrow('No connected Kosmos client');
  });
});
