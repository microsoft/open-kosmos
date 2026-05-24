// @ts-nocheck
/**
 * McpConnection coverage tests — targets uncovered branches and callbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockTransportFactory = vi.hoisted(() => ({
  VscodeTransportFactory: {
    createFromVscodeConfig: vi.fn(),
  },
}));

vi.mock('../../transport/VscodeTransportFactory', () => mockTransportFactory);

const mockAdapterClass = vi.hoisted(() => vi.fn());
vi.mock('../../adapters/VscodeToJsonRpcTransportAdapter', () => ({
  VscodeToJsonRpcTransportAdapter: mockAdapterClass,
}));

const mockJsonRpcClientClass = vi.hoisted(() => vi.fn());
vi.mock('../../core/JsonRpc', () => ({
  JsonRpcClient: mockJsonRpcClientClass,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransport() {
  const emitter = new EventEmitter();
  const transport: any = {
    state: { state: 'stopped' },
    start: vi.fn().mockImplementation(async () => {
      transport.state = { state: 'running' };
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    on: (event: string, fn: any) => { emitter.on(event, fn); return transport; },
    off: (event: string, fn: any) => { emitter.off(event, fn); return transport; },
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  };
  return transport;
}

function makeJsonRpcClient() {
  const emitter = new EventEmitter();
  const client: any = {
    request: vi.fn(),
    notify: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    on: (event: string, fn: any) => { emitter.on(event, fn); return client; },
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  };
  return client;
}

const INIT_RESULT = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  serverInfo: { name: 'test', version: '1.0.0' },
};

import { McpConnection } from '../McpConnection';

describe('McpConnection — coverage tests', () => {
  let transport: ReturnType<typeof makeTransport>;
  let jsonRpcClient: ReturnType<typeof makeJsonRpcClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = makeTransport();
    jsonRpcClient = makeJsonRpcClient();

    mockTransportFactory.VscodeTransportFactory.createFromVscodeConfig.mockReturnValue(transport);
    mockAdapterClass.mockImplementation(class { constructor() {} });
    jsonRpcClient.request.mockResolvedValue(INIT_RESULT);

    const capturedClient = jsonRpcClient;
    mockJsonRpcClientClass.mockImplementation(class {
      request = capturedClient.request;
      notify = capturedClient.notify;
      close = capturedClient.close;
      on = capturedClient.on.bind(capturedClient);
      emit = capturedClient.emit.bind(capturedClient);
    });
    mockJsonRpcClientClass.EVENTS = {
      ERROR: 'error',
      CLOSE: 'close',
      NOTIFICATION: 'notification',
      REQUEST: 'request',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDef(t: 'stdio' | 'http' | 'sse' = 'stdio') {
    return { name: 'srv', transport: t, command: 'node', args: [], url: 'http://localhost' };
  }

  // ── dispose ───────────────────────────────────────────────────────────────

  it('dispose() is idempotent', async () => {
    const conn = new McpConnection(makeDef());
    conn.dispose();
    expect(() => conn.dispose()).not.toThrow();
  });

  it('dispose() while connected calls stop', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    // Spy on internal stop by checking transport.stop — but dispose is fire-and-forget.
    // We verify it doesn't throw and the connection becomes unusable.
    expect(() => conn.dispose()).not.toThrow();
    await expect(conn.start()).rejects.toThrow(/disposed/);
  });

  // ── stop edge cases ───────────────────────────────────────────────────────

  it('stop() is a no-op when isDisposed', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    conn.dispose();
    // Second stop should not throw
    await expect(conn.stop()).resolves.toBeUndefined();
  });

  it('stop() returns pending closePromise if already disconnecting', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    // Both calls should resolve (second returns the same in-flight promise)
    const p1 = conn.stop();
    const p2 = conn.stop(); // while first is in-flight
    await Promise.all([p1, p2]);
    expect(conn.state).toBe('stopped');
  });

  it('stop() handles error during jsonRpcClient.close gracefully', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    jsonRpcClient.close.mockRejectedValue(new Error('close fail'));
    await expect(conn.stop()).resolves.toBeUndefined();
    expect(conn.state).toBe('stopped');
  });

  it('stop() handles error during transport.stop gracefully', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    transport.stop.mockRejectedValue(new Error('transport stop fail'));
    await expect(conn.stop()).resolves.toBeUndefined();
    expect(conn.state).toBe('stopped');
  });

  // ── normalizeServerDefinition — transport headers ─────────────────────────

  it('creates http transport with Content-Type headers', async () => {
    const conn = new McpConnection({ name: 'srv', transport: 'http', url: 'http://localhost/mcp' });
    await conn.start();
    expect(mockTransportFactory.VscodeTransportFactory.createFromVscodeConfig).toHaveBeenCalledWith(
      'srv',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
    await conn.stop();
  });

  it('creates sse transport with Accept: text/event-stream header', async () => {
    const conn = new McpConnection({ name: 'srv', transport: 'sse', url: 'http://localhost/sse' });
    await conn.start();
    expect(mockTransportFactory.VscodeTransportFactory.createFromVscodeConfig).toHaveBeenCalledWith(
      'srv',
      expect.objectContaining({ headers: expect.objectContaining({ 'Accept': 'text/event-stream' }) }),
    );
    await conn.stop();
  });

  it('creates stdio transport with undefined headers', async () => {
    const conn = new McpConnection(makeDef('stdio'));
    await conn.start();
    expect(mockTransportFactory.VscodeTransportFactory.createFromVscodeConfig).toHaveBeenCalledWith(
      'srv',
      expect.objectContaining({ headers: undefined }),
    );
    await conn.stop();
  });

  // ── transport error listeners ──────────────────────────────────────────────

  it('transport error state while running triggers reconnect', async () => {
    const conn = new McpConnection(makeDef(), { retries: 1, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();

    const reconnectedPromise = new Promise<void>(resolve =>
      conn.on(McpConnection.EVENTS.INITIALIZED, () => resolve()),
    );

    transport.emit('stateChange', { state: 'error' });

    vi.advanceTimersByTime(100);
    await reconnectedPromise;
    await conn.stop();
  });

  it('transport stopped state while running triggers handleUnexpectedDisconnection', async () => {
    const conn = new McpConnection(makeDef(), { retries: 1, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();

    const reconnectedPromise = new Promise<void>(resolve =>
      conn.on(McpConnection.EVENTS.INITIALIZED, () => resolve()),
    );

    transport.emit('stateChange', { state: 'stopped' });

    vi.advanceTimersByTime(100);
    await reconnectedPromise;
    await conn.stop();
  });

  it('transport log error event emits error on connection', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    const errors: Error[] = [];
    conn.on(McpConnection.EVENTS.ERROR, e => errors.push(e));

    transport.emit('log', 'error', 'something went wrong');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Transport error');
    await conn.stop();
  });

  it('transport log non-error level does not emit error', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    const errors: Error[] = [];
    conn.on(McpConnection.EVENTS.ERROR, e => errors.push(e));

    transport.emit('log', 'info', 'some info message');
    expect(errors).toHaveLength(0);
    await conn.stop();
  });

  // ── JSON-RPC client event listeners ───────────────────────────────────────

  it('JSON-RPC ERROR event emits error on connection', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    const errors: Error[] = [];
    conn.on(McpConnection.EVENTS.ERROR, e => errors.push(e));

    jsonRpcClient.emit('error', new Error('rpc boom'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('JSON-RPC error');
    await conn.stop();
  });

  it('JSON-RPC CLOSE event while running triggers reconnect', async () => {
    const conn = new McpConnection(makeDef(), { retries: 1, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();

    const reconnectedPromise = new Promise<void>(resolve =>
      conn.on(McpConnection.EVENTS.INITIALIZED, () => resolve()),
    );

    jsonRpcClient.emit('close');

    vi.advanceTimersByTime(100);
    await reconnectedPromise;
    await conn.stop();
  });

  it('JSON-RPC NOTIFICATION event is handled without error', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    expect(() => jsonRpcClient.emit('notification', { method: 'test', params: {} })).not.toThrow();
    await conn.stop();
  });

  it('JSON-RPC REQUEST event is handled without error', async () => {
    const conn = new McpConnection(makeDef());
    await conn.start();
    expect(() => jsonRpcClient.emit('request', { method: 'test', id: 1 })).not.toThrow();
    await conn.stop();
  });

  // ── createTransport failure ────────────────────────────────────────────────

  it('start() throws ValidationError when transport factory throws', async () => {
    mockTransportFactory.VscodeTransportFactory.createFromVscodeConfig.mockImplementation(() => {
      throw new Error('bad config');
    });
    const conn = new McpConnection(makeDef());
    await expect(conn.start()).rejects.toThrow(/Failed to create transport/);
    conn.dispose();
  });

  // ── initializeMcp failure ─────────────────────────────────────────────────

  it('start() throws ConnectionError wrapping initialize failure', async () => {
    jsonRpcClient.request.mockRejectedValue(new Error('init fail'));
    const conn = new McpConnection(makeDef());
    await expect(conn.start()).rejects.toThrow(/MCP initialization failed/);
    conn.dispose();
  });

  // ── health check ──────────────────────────────────────────────────────────

  it('health check fires ping at configured interval', async () => {
    const conn = new McpConnection(makeDef(), { healthCheckIntervalMs: 1000 });
    await conn.start();
    jsonRpcClient.request.mockResolvedValue({});

    // Advance just past one interval tick
    vi.advanceTimersByTime(1100);
    // Let promises settle without running infinite intervals
    await Promise.resolve();

    const pingCalls = jsonRpcClient.request.mock.calls.filter((c: any[]) => c[0] === 'ping');
    expect(pingCalls.length).toBeGreaterThanOrEqual(1);
    await conn.stop();
  });

  it('health check emits error when ping fails', async () => {
    const conn = new McpConnection(makeDef(), { healthCheckIntervalMs: 500 });
    await conn.start();
    jsonRpcClient.request.mockRejectedValue(new Error('timeout'));
    const errors: Error[] = [];
    conn.on(McpConnection.EVENTS.ERROR, (e: Error) => errors.push(e));

    vi.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve(); // Let the rejection propagate

    expect(errors.some(e => e.message.includes('Health check failed'))).toBe(true);
    await conn.stop();
  });

  it('health check does not fire when healthCheckIntervalMs is 0', async () => {
    const conn = new McpConnection(makeDef(), { healthCheckIntervalMs: 0 });
    await conn.start();
    jsonRpcClient.request.mockResolvedValue({});

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    const pingCalls = jsonRpcClient.request.mock.calls.filter(c => c[0] === 'ping');
    expect(pingCalls.length).toBe(0);
    await conn.stop();
  });

  // ── reconnect exhaustion ───────────────────────────────────────────────────

  it('stops reconnecting when retries exhausted', async () => {
    // Use retries=0 so scheduleReconnect immediately sets state to stopped
    const conn = new McpConnection(makeDef(), { retries: 0, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();

    const stateChanges: string[] = [];
    conn.on(McpConnection.EVENTS.STATE_CHANGED, (_prev: string, next: string) => stateChanges.push(next));

    // Trigger handleTransportError → scheduleReconnect → retries=0 → stopped immediately
    transport.emit('stateChange', { state: 'error' });

    // scheduleReconnect with reconnectAttempts(0) >= retries(0) sets state to stopped synchronously
    expect(stateChanges).toContain('stopped');
    conn.dispose();
  });

  it('does not schedule reconnect when disposed', async () => {
    const conn = new McpConnection(makeDef(), { retries: 3, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();
    conn.dispose();

    // No timer should fire after disposal
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    // Just verify no crash
  });

  it('attemptReconnect error path — emits error and schedules next retry', async () => {
    // retries=2 so we get at least one retry cycle that fires error path
    const conn = new McpConnection(makeDef(), { retries: 2, retryDelayMs: 50, healthCheckIntervalMs: 0 });
    await conn.start();

    // Make transport.start fail on reconnect
    transport.start.mockRejectedValue(new Error('reconnect fail'));

    const errors: Error[] = [];
    conn.on(McpConnection.EVENTS.ERROR, (e: Error) => errors.push(e));

    // Trigger first reconnect schedule
    transport.emit('stateChange', { state: 'error' });

    // Advance timer to fire the scheduled reconnect and wait for async error propagation
    vi.advanceTimersByTime(60);
    // Need multiple microtask drains: cleanup → performConnect (rejects) → catch → handleError
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Error from reconnect attempt should have been emitted
    expect(errors.some(e => e.message.includes('Reconnection failed'))).toBe(true);
    conn.dispose();
  });

  // ── cleanup during reconnect ───────────────────────────────────────────────

  it('cleanup handles jsonRpcClient.close error gracefully', async () => {
    const conn = new McpConnection(makeDef(), { healthCheckIntervalMs: 0, retries: 1, retryDelayMs: 50 });
    await conn.start();
    jsonRpcClient.close.mockRejectedValue(new Error('close error'));

    transport.emit('stateChange', { state: 'error' });
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    conn.dispose();
  });

  it('cleanup handles transport.stop error gracefully', async () => {
    const conn = new McpConnection(makeDef(), { healthCheckIntervalMs: 0, retries: 1, retryDelayMs: 50 });
    await conn.start();
    transport.stop.mockRejectedValue(new Error('stop error'));

    transport.emit('stateChange', { state: 'error' });
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    conn.dispose();
  });
});
