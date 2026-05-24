/**
 * Unit tests for VscodeToJsonRpcTransportAdapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { VscodeToJsonRpcTransportAdapter } from '../adapters/VscodeToJsonRpcTransportAdapter';

/**
 * Create a minimal VscodeTransport-compatible fake.
 */
function makeTransport(initialState: 'stopped' | 'running' | 'error' = 'running') {
  const emitter = new EventEmitter();
  const transport: any = {
    state: { state: initialState },
    send: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return transport;
    },
    off: (event: string, listener: (...args: any[]) => void) => {
      emitter.off(event, listener);
      return transport;
    },
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  };
  return transport;
}

describe('VscodeToJsonRpcTransportAdapter', () => {
  let transport: ReturnType<typeof makeTransport>;
  let adapter: VscodeToJsonRpcTransportAdapter;

  beforeEach(() => {
    transport = makeTransport('running');
    adapter = new VscodeToJsonRpcTransportAdapter(transport);
  });

  // ── state proxy ────────────────────────────────────────────────────────────

  it('exposes the underlying transport state', () => {
    expect(adapter.state.state).toBe('running');
  });

  it('isReady() returns true when state is running', () => {
    expect(adapter.isReady()).toBe(true);
  });

  it('isReady() returns false when state is stopped', () => {
    transport.state = { state: 'stopped' };
    expect(adapter.isReady()).toBe(false);
  });

  it('getVscodeTransport() returns the wrapped transport', () => {
    expect(adapter.getVscodeTransport()).toBe(transport);
  });

  // ── send ───────────────────────────────────────────────────────────────────

  it('send() delegates to the vscode transport when running', () => {
    adapter.send('hello');
    expect(transport.send).toHaveBeenCalledWith('hello');
  });

  it('send() throws when transport is not running', () => {
    transport.state = { state: 'stopped' };
    expect(() => adapter.send('hello')).toThrow(/transport state is stopped/);
  });

  it('send() forwards async rejection to error listeners', async () => {
    const rejection = Promise.reject(new Error('async fail'));
    transport.send.mockReturnValue(rejection);
    const errorCb = vi.fn();
    adapter.onError(errorCb);
    adapter.send('msg');
    // Let the microtask queue drain
    await new Promise(r => setImmediate(r));
    expect(errorCb).toHaveBeenCalledOnce();
    expect(errorCb.mock.calls[0][0].message).toBe('async fail');
  });

  // ── onMessage ──────────────────────────────────────────────────────────────

  it('onMessage listener receives messages emitted by transport', () => {
    const cb = vi.fn();
    adapter.onMessage(cb);
    transport.emit('message', 'ping');
    expect(cb).toHaveBeenCalledWith('ping');
  });

  it('onMessage unsubscribe removes the listener', () => {
    const cb = vi.fn();
    const unsub = adapter.onMessage(cb);
    unsub();
    transport.emit('message', 'ping');
    expect(cb).not.toHaveBeenCalled();
  });

  it('handles multiple onMessage listeners', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    adapter.onMessage(cb1);
    adapter.onMessage(cb2);
    transport.emit('message', 'test');
    expect(cb1).toHaveBeenCalledWith('test');
    expect(cb2).toHaveBeenCalledWith('test');
  });

  it('does not crash when a message listener throws', () => {
    adapter.onMessage(() => { throw new Error('boom'); });
    expect(() => transport.emit('message', 'data')).not.toThrow();
  });

  // ── onError ────────────────────────────────────────────────────────────────

  it('onError listener is called when stateChange becomes error', () => {
    const cb = vi.fn();
    adapter.onError(cb);
    transport.emit('stateChange', { state: 'error', message: 'oops' });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].message).toBe('oops');
  });

  it('onError listener uses default message when stateChange has no message', () => {
    const cb = vi.fn();
    adapter.onError(cb);
    transport.emit('stateChange', { state: 'error' });
    expect(cb.mock.calls[0][0].message).toBe('Transport error');
  });

  it('onError listener is called when error-level log is emitted', () => {
    const cb = vi.fn();
    adapter.onError(cb);
    transport.emit('log', 'error', 'something went wrong');
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].message).toContain('something went wrong');
  });

  it('onError listener is NOT called for non-error log levels', () => {
    const cb = vi.fn();
    adapter.onError(cb);
    transport.emit('log', 'info', 'all good');
    expect(cb).not.toHaveBeenCalled();
  });

  it('onError unsubscribe removes the listener', () => {
    const cb = vi.fn();
    const unsub = adapter.onError(cb);
    unsub();
    transport.emit('stateChange', { state: 'error' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not crash when an error listener throws', () => {
    adapter.onError(() => { throw new Error('loud listener'); });
    expect(() => transport.emit('stateChange', { state: 'error' })).not.toThrow();
  });

  // ── onClose ────────────────────────────────────────────────────────────────

  it('onClose listener is called when stateChange becomes stopped', () => {
    const cb = vi.fn();
    adapter.onClose(cb);
    transport.emit('stateChange', { state: 'stopped' });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('onClose listener is NOT called for non-stopped stateChanges', () => {
    const cb = vi.fn();
    adapter.onClose(cb);
    transport.emit('stateChange', { state: 'running' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('onClose unsubscribe removes the listener', () => {
    const cb = vi.fn();
    const unsub = adapter.onClose(cb);
    unsub();
    transport.emit('stateChange', { state: 'stopped' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not crash when a close listener throws', () => {
    adapter.onClose(() => { throw new Error('close error'); });
    expect(() => transport.emit('stateChange', { state: 'stopped' })).not.toThrow();
  });

  // ── close ──────────────────────────────────────────────────────────────────

  it('close() calls stop on the underlying transport', async () => {
    await adapter.close();
    expect(transport.stop).toHaveBeenCalledOnce();
  });

  it('close() clears all listeners so they no longer fire', async () => {
    const msgCb = vi.fn();
    const errCb = vi.fn();
    const closeCb = vi.fn();
    adapter.onMessage(msgCb);
    adapter.onError(errCb);
    adapter.onClose(closeCb);

    await adapter.close();

    // Emitting after close should not trigger any callbacks
    transport.emit('message', 'post-close');
    transport.emit('stateChange', { state: 'error' });
    transport.emit('stateChange', { state: 'stopped' });

    expect(msgCb).not.toHaveBeenCalled();
    expect(errCb).not.toHaveBeenCalled();
    expect(closeCb).not.toHaveBeenCalled();
  });
});
