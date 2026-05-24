/**
 * Tests for vscodeMcpClient/types/protocolTypes.ts helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  JSON_RPC_ERROR_CODES,
  MCP_METHODS,
  createJsonRpcError,
  createMethodNotFoundError,
  createInvalidParamsError,
  createInternalError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  isJsonRpcMessage,
  isMcpMethod,
} from '../types/protocolTypes';

// ---------------------------------------------------------------------------
// createJsonRpcError
// ---------------------------------------------------------------------------
describe('createJsonRpcError', () => {
  it('returns an object with the supplied code, message and data', () => {
    const err = createJsonRpcError(-32600, 'Invalid Request', { extra: true });
    expect(err).toEqual({ code: -32600, message: 'Invalid Request', data: { extra: true } });
  });

  it('omits data when not provided', () => {
    const err = createJsonRpcError(-32700, 'Parse Error');
    expect(err.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createMethodNotFoundError
// ---------------------------------------------------------------------------
describe('createMethodNotFoundError', () => {
  it('uses METHOD_NOT_FOUND code', () => {
    const err = createMethodNotFoundError('foo/bar');
    expect(err.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
  });

  it('includes the method name in the message', () => {
    const err = createMethodNotFoundError('tools/call');
    expect(err.message).toContain('tools/call');
  });
});

// ---------------------------------------------------------------------------
// createInvalidParamsError
// ---------------------------------------------------------------------------
describe('createInvalidParamsError', () => {
  it('uses INVALID_PARAMS code', () => {
    const err = createInvalidParamsError();
    expect(err.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it('includes details when provided', () => {
    const err = createInvalidParamsError('missing required field');
    expect(err.message).toContain('missing required field');
  });

  it('does not include colon suffix when details is omitted', () => {
    const err = createInvalidParamsError();
    expect(err.message).toBe('Invalid params');
  });
});

// ---------------------------------------------------------------------------
// createInternalError
// ---------------------------------------------------------------------------
describe('createInternalError', () => {
  it('uses INTERNAL_ERROR code', () => {
    const err = createInternalError();
    expect(err.code).toBe(JSON_RPC_ERROR_CODES.INTERNAL_ERROR);
  });

  it('includes details when provided', () => {
    const err = createInternalError('unexpected failure');
    expect(err.message).toContain('unexpected failure');
  });
});

// ---------------------------------------------------------------------------
// isJsonRpcRequest
// ---------------------------------------------------------------------------
describe('isJsonRpcRequest', () => {
  it('returns true for a valid request with id', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ping', id: 1 })).toBe(true);
  });

  it('returns false when id is absent (notification)', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' })).toBe(false);
  });

  it('returns false when method is absent', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('returns falsy for null/undefined', () => {
    expect(isJsonRpcRequest(null)).toBeFalsy();
    expect(isJsonRpcRequest(undefined)).toBeFalsy();
  });

  it('returns false when jsonrpc version is wrong', () => {
    expect(isJsonRpcRequest({ jsonrpc: '1.0', method: 'ping', id: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isJsonRpcResponse
// ---------------------------------------------------------------------------
describe('isJsonRpcResponse', () => {
  it('returns true for a result response', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
  });

  it('returns true for an error response', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } })).toBe(true);
  });

  it('returns false when both result and error are absent', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('returns false when id is absent', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isJsonRpcNotification
// ---------------------------------------------------------------------------
describe('isJsonRpcNotification', () => {
  it('returns true for a message with method but no id', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true);
  });

  it('returns false when id is present', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'ping', id: 0 })).toBe(false);
  });

  it('returns false when method is absent', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isJsonRpcMessage
// ---------------------------------------------------------------------------
describe('isJsonRpcMessage', () => {
  it('returns true for a request', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'ping', id: 1 })).toBe(true);
  });

  it('returns true for a response', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: 'ok' })).toBe(true);
  });

  it('returns true for a notification', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'notify' })).toBe(true);
  });

  it('returns false for an empty object', () => {
    expect(isJsonRpcMessage({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMcpMethod
// ---------------------------------------------------------------------------
describe('isMcpMethod', () => {
  it('returns true for a known MCP method', () => {
    expect(isMcpMethod(MCP_METHODS.PING)).toBe(true);
    expect(isMcpMethod(MCP_METHODS.TOOLS_LIST)).toBe(true);
    expect(isMcpMethod(MCP_METHODS.INITIALIZE)).toBe(true);
  });

  it('returns false for an unknown method', () => {
    expect(isMcpMethod('unknown/method')).toBe(false);
    expect(isMcpMethod('')).toBe(false);
  });
});
