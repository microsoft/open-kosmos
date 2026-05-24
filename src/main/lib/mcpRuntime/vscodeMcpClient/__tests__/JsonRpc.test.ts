/**
 * Tests for vscodeMcpClient/core/JsonRpc.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  JsonRpcClient,
  createErrorResponse,
  createSuccessResponse,
  validateJsonRpcMessage,
  createBatchMessage,
  parseBatchMessage,
  type JsonRpcTransport,
} from '../core/JsonRpc';
import { JSON_RPC_ERROR_CODES } from '../types/protocolTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock transport whose onMessage callback can be triggered manually. */
function makeTransport(): {
  transport: JsonRpcTransport;
  triggerMessage: (msg: string) => void;
  triggerError: (err: Error) => void;
  triggerClose: () => void;
  sent: string[];
} {
  const sent: string[] = [];
  let messageCallback: ((msg: string) => void) | null = null;
  let errorCallback: ((err: Error) => void) | null = null;
  let closeCallback: (() => void) | null = null;

  const transport: JsonRpcTransport = {
    send: (msg) => sent.push(msg),
    onMessage: (cb) => { messageCallback = cb; return () => { messageCallback = null; }; },
    onError: (cb) => { errorCallback = cb; return () => { errorCallback = null; }; },
    onClose: (cb) => { closeCallback = cb; return () => { closeCallback = null; }; },
    close: async () => {},
  };

  return {
    transport,
    triggerMessage: (msg) => messageCallback?.(msg),
    triggerError: (err) => errorCallback?.(err),
    triggerClose: () => closeCallback?.(),
    sent,
  };
}

// ---------------------------------------------------------------------------
// JsonRpcClient — basic request/response
// ---------------------------------------------------------------------------

describe('JsonRpcClient', () => {
  describe('request / response', () => {
    it('sends a request and resolves with the result when the response arrives', async () => {
      const { transport, triggerMessage, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      const promise = client.request('ping');
      const req = JSON.parse(sent[0]);
      expect(req.method).toBe('ping');
      expect(req.jsonrpc).toBe('2.0');

      // Simulate server response
      triggerMessage(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'pong' }));
      await expect(promise).resolves.toBe('pong');

      await client.close();
    });

    it('rejects when the response contains a JSON-RPC error', async () => {
      const { transport, triggerMessage, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      const promise = client.request('boom');
      const req = JSON.parse(sent[0]);

      triggerMessage(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32600, message: 'Invalid Request' },
      }));

      await expect(promise).rejects.toThrow('Invalid Request');
      await client.close();
    });

    it('rejects after timeout', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 50 });

      await expect(client.request('slow')).rejects.toThrow(/timeout/i);
      await client.close();
    }, 5000);

    it('rejects immediately when already disposed', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport);
      await client.close();

      await expect(client.request('any')).rejects.toThrow('disposed');
    });

    it('rejects when maxPendingRequests is exceeded', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport, { maxPendingRequests: 1, timeout: 60000 });

      // First request fills the slot — catch to avoid unhandled rejection on close
      const first = client.request('method1').catch(() => {});

      await expect(client.request('method2')).rejects.toThrow('Too many pending requests');
      await client.close();
      await first;
    });

    it('passes params in the request message', async () => {
      const { transport, triggerMessage, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      const promise = client.request('tools/call', { name: 'my_tool' });
      const req = JSON.parse(sent[0]);
      expect(req.params).toEqual({ name: 'my_tool' });

      triggerMessage(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
      await promise;
      await client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // notify
  // ---------------------------------------------------------------------------

  describe('notify', () => {
    it('sends a notification without an id', () => {
      const { transport, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      client.notify('notifications/initialized', { version: '1.0' });
      const msg = JSON.parse(sent[0]);
      expect(msg.method).toBe('notifications/initialized');
      expect('id' in msg).toBe(false);
    });

    it('throws when disposed', () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport);
      client.dispose();

      // dispose() is async but the flag is set synchronously
      expect(() => client.notify('test')).toThrow('disposed');
    });
  });

  // ---------------------------------------------------------------------------
  // respond
  // ---------------------------------------------------------------------------

  describe('respond', () => {
    it('sends a success response with the supplied result', () => {
      const { transport, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      client.respond(42, { status: 'ok' });
      const msg = JSON.parse(sent[0]);
      expect(msg.id).toBe(42);
      expect(msg.result).toEqual({ status: 'ok' });
    });

    it('sends an error response when error is provided', () => {
      const { transport, sent } = makeTransport();
      const client = new JsonRpcClient(transport);

      client.respond(1, undefined, { code: -32601, message: 'Not found' });
      const msg = JSON.parse(sent[0]);
      expect(msg.error).toEqual({ code: -32601, message: 'Not found' });
    });
  });

  // ---------------------------------------------------------------------------
  // cancelRequest / cancelAllRequests
  // ---------------------------------------------------------------------------

  describe('cancelRequest', () => {
    it('returns false for an unknown request id', () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport);
      expect(client.cancelRequest(9999)).toBe(false);
    });

    it('returns true and rejects the pending promise when found', async () => {
      const { transport, sent } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 60000 });

      const promise = client.request('long_running');
      const req = JSON.parse(sent[0]);

      const cancelled = client.cancelRequest(req.id, 'manual cancel');
      expect(cancelled).toBe(true);
      await expect(promise).rejects.toThrow('manual cancel');

      await client.close();
    });
  });

  describe('cancelAllRequests', () => {
    it('rejects all pending requests', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 60000 });

      const p1 = client.request('a').catch(e => e.message);
      const p2 = client.request('b').catch(e => e.message);

      client.cancelAllRequests('shutdown');

      expect(await p1).toBe('shutdown');
      expect(await p2).toBe('shutdown');

      await client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------

  describe('getStats', () => {
    it('reports zero pending requests when none are in flight', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport);
      const stats = client.getStats();
      expect(stats.pendingRequests).toBe(0);
      expect(stats.totalRequests).toBe(0);
      await client.close();
    });

    it('counts pending requests and total requests correctly', async () => {
      const { transport, triggerMessage, sent } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 60000 });

      const p1 = client.request('method1');
      const p2 = client.request('method2');

      const stats = client.getStats();
      expect(stats.pendingRequests).toBe(2);
      expect(stats.totalRequests).toBe(2);

      // Resolve both
      const r1 = JSON.parse(sent[0]);
      const r2 = JSON.parse(sent[1]);
      triggerMessage(JSON.stringify({ jsonrpc: '2.0', id: r1.id, result: null }));
      triggerMessage(JSON.stringify({ jsonrpc: '2.0', id: r2.id, result: null }));
      await Promise.all([p1, p2]);

      expect(client.getStats().pendingRequests).toBe(0);
      await client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Transport events
  // ---------------------------------------------------------------------------

  describe('transport events', () => {
    it('emits ERROR event when transport reports an error', () => {
      const { transport, triggerError } = makeTransport();
      const client = new JsonRpcClient(transport);
      const errors: Error[] = [];
      client.on(JsonRpcClient.EVENTS.ERROR, (e) => errors.push(e));

      triggerError(new Error('network failure'));
      expect(errors[0].message).toBe('network failure');
    });

    it('emits CLOSE event and cancels pending requests when transport closes', async () => {
      const { transport, triggerClose } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 60000 });
      const closed: boolean[] = [];
      client.on(JsonRpcClient.EVENTS.CLOSE, () => closed.push(true));

      const p = client.request('slow').catch(e => e.message);
      triggerClose();

      expect(await p).toBe('Transport closed');
      expect(closed).toHaveLength(1);
    });

    it('emits NOTIFICATION event when a notification arrives', () => {
      const { transport, triggerMessage } = makeTransport();
      const client = new JsonRpcClient(transport);
      const notifications: any[] = [];
      client.on(JsonRpcClient.EVENTS.NOTIFICATION, (n) => notifications.push(n));

      triggerMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { text: 'hi' } }));
      expect(notifications[0].method).toBe('notifications/message');
    });

    it('emits REQUEST event when an incoming request arrives', () => {
      const { transport, triggerMessage } = makeTransport();
      const client = new JsonRpcClient(transport);
      const requests: any[] = [];
      client.on(JsonRpcClient.EVENTS.REQUEST, (r) => requests.push(r));

      triggerMessage(JSON.stringify({ jsonrpc: '2.0', method: 'roots/list', id: 99 }));
      expect(requests[0].id).toBe(99);
    });

    it('emits ERROR when a malformed message arrives', () => {
      const { transport, triggerMessage } = makeTransport();
      const client = new JsonRpcClient(transport);
      const errors: Error[] = [];
      client.on(JsonRpcClient.EVENTS.ERROR, (e) => errors.push(e));

      triggerMessage('{bad json}');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('emits ERROR when a well-formed but non-rpc message arrives', () => {
      const { transport, triggerMessage } = makeTransport();
      const client = new JsonRpcClient(transport);
      const errors: Error[] = [];
      client.on(JsonRpcClient.EVENTS.ERROR, (e) => errors.push(e));

      // Lacks jsonrpc field
      triggerMessage(JSON.stringify({ foo: 'bar' }));
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // AbortSignal support
  // ---------------------------------------------------------------------------

  describe('AbortSignal support', () => {
    it('rejects immediately when signal is already aborted', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport);
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.request('method', undefined, { signal: controller.signal })
      ).rejects.toThrow(/aborted/i);

      await client.close();
    });

    it('rejects when signal aborts after request is sent', async () => {
      const { transport } = makeTransport();
      const client = new JsonRpcClient(transport, { timeout: 60000 });
      const controller = new AbortController();

      const p = client.request('method', undefined, { signal: controller.signal });
      controller.abort();

      await expect(p).rejects.toThrow(/aborted/i);
      await client.close();
    });
  });
});

// ---------------------------------------------------------------------------
// createErrorResponse
// ---------------------------------------------------------------------------

describe('createErrorResponse', () => {
  it('constructs a valid error response', () => {
    const resp = createErrorResponse(1, -32600, 'Invalid Request');
    expect(resp).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request', data: undefined },
    });
  });

  it('accepts null id', () => {
    const resp = createErrorResponse(null, -32700, 'Parse Error');
    expect(resp.id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createSuccessResponse
// ---------------------------------------------------------------------------

describe('createSuccessResponse', () => {
  it('constructs a valid success response', () => {
    const resp = createSuccessResponse(7, { tools: [] });
    expect(resp).toEqual({ jsonrpc: '2.0', id: 7, result: { tools: [] } });
  });
});

// ---------------------------------------------------------------------------
// validateJsonRpcMessage
// ---------------------------------------------------------------------------

describe('validateJsonRpcMessage', () => {
  it('validates a valid request', () => {
    expect(validateJsonRpcMessage({ jsonrpc: '2.0', method: 'ping', id: 1 })).toEqual({ valid: true });
  });

  it('validates a valid response with result', () => {
    expect(validateJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: 'ok' })).toEqual({ valid: true });
  });

  it('validates a valid notification', () => {
    expect(validateJsonRpcMessage({ jsonrpc: '2.0', method: 'notify' })).toEqual({ valid: true });
  });

  it('rejects null input', () => {
    expect(validateJsonRpcMessage(null).valid).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateJsonRpcMessage('string').valid).toBe(false);
  });

  it('rejects wrong jsonrpc version', () => {
    const r = validateJsonRpcMessage({ jsonrpc: '1.0', method: 'ping', id: 1 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/jsonrpc/i);
  });

  it('rejects invalid message type (no method, no result/error)', () => {
    const r = validateJsonRpcMessage({ jsonrpc: '2.0' });
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createBatchMessage / parseBatchMessage
// ---------------------------------------------------------------------------

describe('createBatchMessage', () => {
  it('returns single JSON message for one-element array', () => {
    const msg = { jsonrpc: '2.0' as const, method: 'ping', id: 1 };
    const result = createBatchMessage([msg]);
    expect(JSON.parse(result)).toEqual(msg);
  });

  it('returns a JSON array for multiple messages', () => {
    const msgs = [
      { jsonrpc: '2.0' as const, method: 'a', id: 1 },
      { jsonrpc: '2.0' as const, method: 'b' },
    ];
    const result = createBatchMessage(msgs);
    expect(JSON.parse(result)).toEqual(msgs);
  });

  it('throws for empty array', () => {
    expect(() => createBatchMessage([])).toThrow();
  });
});

describe('parseBatchMessage', () => {
  it('returns an array when given a single JSON object', () => {
    const result = parseBatchMessage(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
    expect(result).toHaveLength(1);
  });

  it('returns the array when given a JSON array', () => {
    const msgs = [
      { jsonrpc: '2.0', method: 'a', id: 1 },
      { jsonrpc: '2.0', method: 'b', id: 2 },
    ];
    const result = parseBatchMessage(JSON.stringify(msgs));
    expect(result).toHaveLength(2);
  });
});
