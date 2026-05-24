/**
 * Coverage tests for ITransport.ts
 * Covers: BaseTransport, StatsTrackingTransport, TransportError hierarchy,
 *         TransportFactory interface, and default config exports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BaseTransport,
  StatsTrackingTransport,
  TransportError,
  ConnectionTimeoutError,
  MessageSendError,
  TransportClosedError,
  DEFAULT_TRANSPORT_CONFIG,
  DEFAULT_STDIO_CONFIG,
  DEFAULT_HTTP_CONFIG,
  DEFAULT_SSE_CONFIG,
  type TransportConfig,
  type TransportStats,
} from '../ITransport';
import type { ConnectionState } from '../../types/mcpTypes';

// ── Concrete BaseTransport implementation for testing ──────────────────────────

class TestTransport extends BaseTransport {
  public connectCalled = false;
  public sendMessages: string[] = [];
  public closeCalled = false;

  constructor(config?: Partial<TransportConfig>) {
    super({ ...DEFAULT_TRANSPORT_CONFIG, ...config });
  }

  async connect(): Promise<void> {
    this.connectCalled = true;
    this.setState('running');
  }

  send(message: string): void {
    this.sendMessages.push(message);
  }

  async close(): Promise<void> {
    this.closeCalled = true;
    this.setState('stopped');
  }

  // Expose protected helpers for testing
  public exposeSetState(s: ConnectionState) { this.setState(s); }
  public exposeThrowIfDisposed() { this.throwIfDisposed(); }
  public get exposeIsDisposed() { return this.isDisposed; }
}

// ── Concrete StatsTrackingTransport implementation ────────────────────────────

class TestStatsTransport extends StatsTrackingTransport {
  async connect(): Promise<void> {
    this.trackConnectionEstablished();
    this.setState('running');
  }

  send(message: string): void {
    this.trackMessageSent(message);
  }

  async close(): Promise<void> {
    this.setState('stopped');
  }

  // Expose tracking helpers
  public receiveMessage(msg: string) { this.trackMessageReceived(msg); }
  public reportError() { this.trackError(); }
  public reset() { this.resetStats(); }
  public get exposeConnectTime() { return this.connectTime; }
}

// ── BaseTransport tests ───────────────────────────────────────────────────────

describe('BaseTransport', () => {
  let transport: TestTransport;

  beforeEach(() => {
    transport = new TestTransport();
  });

  it('starts in stopped state', () => {
    expect(transport.state).toBe('stopped');
  });

  it('connect() changes state to running', async () => {
    await transport.connect();
    expect(transport.state).toBe('running');
  });

  it('setState emits stateChanged event', async () => {
    const callback = vi.fn();
    transport.onStateChanged(callback);
    await transport.connect();
    expect(callback).toHaveBeenCalledWith('running', expect.any(String));
  });

  it('setState does not emit when state unchanged', () => {
    const callback = vi.fn();
    transport.onStateChanged(callback);
    // State is already 'stopped' — setting it again should not emit
    transport.exposeSetState('stopped');
    expect(callback).not.toHaveBeenCalled();
  });

  it('onStateChanged returns unsubscribe function', async () => {
    const callback = vi.fn();
    const unsub = transport.onStateChanged(callback);
    unsub();
    await transport.connect();
    expect(callback).not.toHaveBeenCalled();
  });

  it('onMessage listener receives emitted messages', () => {
    const callback = vi.fn();
    const unsub = transport.onMessage(callback);
    transport.emit(BaseTransport.EVENTS.MESSAGE, 'hello');
    expect(callback).toHaveBeenCalledWith('hello');
    unsub();
    transport.emit(BaseTransport.EVENTS.MESSAGE, 'world');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('onError listener receives emitted errors', () => {
    const callback = vi.fn();
    const unsub = transport.onError(callback);
    const err = new Error('oops');
    transport.emit(BaseTransport.EVENTS.ERROR, err);
    expect(callback).toHaveBeenCalledWith(err);
    unsub();
  });

  it('onClose listener receives close events', () => {
    const callback = vi.fn();
    const unsub = transport.onClose(callback);
    transport.emit(BaseTransport.EVENTS.CLOSE);
    expect(callback).toHaveBeenCalled();
    unsub();
  });

  it('dispose sets isDisposed and removes all listeners', async () => {
    const stateCallback = vi.fn();
    transport.onStateChanged(stateCallback);
    transport.dispose();
    expect(transport.exposeIsDisposed).toBe(true);
    // After dispose, no listeners should fire
    await transport.connect().catch(() => {}); // may throw since disposed
    expect(stateCallback).not.toHaveBeenCalled();
  });

  it('dispose is idempotent — second call is no-op', () => {
    transport.dispose();
    expect(() => transport.dispose()).not.toThrow();
  });

  it('throwIfDisposed throws when transport is disposed', () => {
    transport.dispose();
    expect(() => transport.exposeThrowIfDisposed()).toThrow('Transport is disposed');
  });

  it('throwIfDisposed does not throw when not disposed', () => {
    expect(() => transport.exposeThrowIfDisposed()).not.toThrow();
  });

  it('EVENTS constants have expected values', () => {
    expect(BaseTransport.EVENTS.STATE_CHANGED).toBe('stateChanged');
    expect(BaseTransport.EVENTS.MESSAGE).toBe('message');
    expect(BaseTransport.EVENTS.ERROR).toBe('error');
    expect(BaseTransport.EVENTS.CLOSE).toBe('close');
  });

  it('send stores messages', async () => {
    await transport.connect();
    transport.send('msg1');
    transport.send('msg2');
    expect(transport.sendMessages).toEqual(['msg1', 'msg2']);
  });

  it('close sets state to stopped', async () => {
    await transport.connect();
    await transport.close();
    expect(transport.state).toBe('stopped');
  });
});

// ── StatsTrackingTransport tests ──────────────────────────────────────────────

describe('StatsTrackingTransport', () => {
  let transport: TestStatsTransport;

  beforeEach(() => {
    transport = new TestStatsTransport(DEFAULT_TRANSPORT_CONFIG);
  });

  it('starts with zeroed stats', () => {
    const stats = transport.getStats();
    expect(stats.messagesReceived).toBe(0);
    expect(stats.messagesSent).toBe(0);
    expect(stats.bytesReceived).toBe(0);
    expect(stats.bytesSent).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.connectionTime).toBe(0);
    expect(stats.uptime).toBe(0);
  });

  it('tracks messages sent', () => {
    transport.send('hello world');
    const stats = transport.getStats();
    expect(stats.messagesSent).toBe(1);
    expect(stats.bytesSent).toBe(Buffer.byteLength('hello world', 'utf8'));
    expect(stats.lastActivity).toBeGreaterThan(0);
  });

  it('tracks messages received', () => {
    transport.receiveMessage('incoming data');
    const stats = transport.getStats();
    expect(stats.messagesReceived).toBe(1);
    expect(stats.bytesReceived).toBe(Buffer.byteLength('incoming data', 'utf8'));
  });

  it('tracks errors', () => {
    transport.reportError();
    transport.reportError();
    expect(transport.getStats().errors).toBe(2);
  });

  it('trackConnectionEstablished records connect time', async () => {
    await transport.connect();
    const stats = transport.getStats();
    expect(stats.connectionTime).toBeGreaterThan(0);
    expect(stats.uptime).toBeGreaterThanOrEqual(0);
  });

  it('uptime is 0 before connection established', () => {
    expect(transport.getStats().uptime).toBe(0);
  });

  it('resetStats zeros all counters', async () => {
    await transport.connect();
    transport.send('msg');
    transport.receiveMessage('rcv');
    transport.reportError();
    transport.reset();
    const stats = transport.getStats();
    expect(stats.messagesReceived).toBe(0);
    expect(stats.messagesSent).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.bytesReceived).toBe(0);
    expect(stats.bytesSent).toBe(0);
    expect(transport.exposeConnectTime).toBe(0);
  });

  it('getStats returns a snapshot (not a reference)', async () => {
    await transport.connect();
    const stats1 = transport.getStats();
    transport.send('more data');
    const stats2 = transport.getStats();
    expect(stats1.messagesSent).toBe(0);
    expect(stats2.messagesSent).toBe(1);
  });
});

// ── TransportError hierarchy ──────────────────────────────────────────────────

describe('TransportError hierarchy', () => {
  describe('TransportError', () => {
    it('stores code and transport', () => {
      const err = new TransportError('something failed', 'ERR_CODE', 'stdio');
      expect(err.message).toBe('something failed');
      expect(err.code).toBe('ERR_CODE');
      expect(err.transport).toBe('stdio');
      expect(err.name).toBe('TransportError');
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('ConnectionTimeoutError', () => {
    it('formats message with timeout', () => {
      const err = new ConnectionTimeoutError('http', 5000);
      expect(err.message).toContain('5000ms');
      expect(err.code).toBe('CONNECTION_TIMEOUT');
      expect(err.transport).toBe('http');
      expect(err.name).toBe('ConnectionTimeoutError');
      expect(err instanceof TransportError).toBe(true);
    });
  });

  describe('MessageSendError', () => {
    it('wraps original error message', () => {
      const cause = new Error('underlying failure');
      const err = new MessageSendError('sse', cause);
      expect(err.message).toContain('underlying failure');
      expect(err.code).toBe('MESSAGE_SEND_ERROR');
      expect(err.name).toBe('MessageSendError');
    });

    it('uses Unknown error when no originalError', () => {
      const err = new MessageSendError('stdio');
      expect(err.message).toContain('Unknown error');
    });
  });

  describe('TransportClosedError', () => {
    it('constructs correctly', () => {
      const err = new TransportClosedError('sse');
      expect(err.message).toBe('Transport is closed');
      expect(err.code).toBe('TRANSPORT_CLOSED');
      expect(err.name).toBe('TransportClosedError');
      expect(err instanceof TransportError).toBe(true);
    });
  });
});

// ── Default configs ───────────────────────────────────────────────────────────

describe('Default transport configs', () => {
  it('DEFAULT_TRANSPORT_CONFIG has expected shape', () => {
    expect(DEFAULT_TRANSPORT_CONFIG.timeout).toBe(30000);
    expect(DEFAULT_TRANSPORT_CONFIG.retries).toBe(3);
    expect(DEFAULT_TRANSPORT_CONFIG.retryDelayMs).toBe(1000);
    expect(DEFAULT_TRANSPORT_CONFIG.gracefulShutdownTimeoutMs).toBe(5000);
  });

  it('DEFAULT_STDIO_CONFIG inherits base config fields', () => {
    expect(DEFAULT_STDIO_CONFIG.timeout).toBe(DEFAULT_TRANSPORT_CONFIG.timeout);
    expect(DEFAULT_STDIO_CONFIG.env).toEqual({});
  });

  it('DEFAULT_HTTP_CONFIG has correct headers and method', () => {
    expect(DEFAULT_HTTP_CONFIG.method).toBe('POST');
    expect(DEFAULT_HTTP_CONFIG.headers?.['Content-Type']).toBe('application/json');
    expect(DEFAULT_HTTP_CONFIG.headers?.['Accept']).toBe('application/json');
  });

  it('DEFAULT_SSE_CONFIG has reconnect settings', () => {
    expect(DEFAULT_SSE_CONFIG.reconnectIntervalMs).toBe(1000);
    expect(DEFAULT_SSE_CONFIG.maxReconnectAttempts).toBe(5);
    expect(DEFAULT_SSE_CONFIG.headers?.['Accept']).toBe('text/event-stream');
  });
});
