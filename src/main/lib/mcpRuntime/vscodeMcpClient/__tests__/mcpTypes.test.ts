/**
 * Tests for vscodeMcpClient/types/mcpTypes.ts type guards, error classes,
 * and exported defaults.
 */

import { describe, it, expect } from 'vitest';
import {
  isMcpTool,
  isMcpResource,
  isMcpPrompt,
  isConnectionState,
  isTransportType,
  McpError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  TransportError,
  ProtocolError,
  DEFAULT_CONNECTION_CONFIG,
  DEFAULT_SERVER_START_OPTIONS,
} from '../types/mcpTypes';

// ---------------------------------------------------------------------------
// isMcpTool
// ---------------------------------------------------------------------------
describe('isMcpTool', () => {
  it('returns true for a valid tool', () => {
    expect(isMcpTool({ name: 'foo', inputSchema: {} })).toBe(true);
  });

  it('returns true even when inputSchema is null (as long as it is defined)', () => {
    expect(isMcpTool({ name: 'foo', inputSchema: null })).toBe(true);
  });

  it('returns false when name is missing', () => {
    expect(isMcpTool({ inputSchema: {} })).toBe(false);
  });

  it('returns false when name is not a string', () => {
    expect(isMcpTool({ name: 42, inputSchema: {} })).toBe(false);
  });

  it('returns false when inputSchema is missing/undefined', () => {
    expect(isMcpTool({ name: 'foo' })).toBe(false);
    expect(isMcpTool({ name: 'foo', inputSchema: undefined })).toBe(false);
  });

  it('returns falsy for null/undefined inputs', () => {
    expect(isMcpTool(null)).toBeFalsy();
    expect(isMcpTool(undefined)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// isMcpResource
// ---------------------------------------------------------------------------
describe('isMcpResource', () => {
  it('returns true for a valid resource', () => {
    expect(isMcpResource({ uri: 'file://foo', name: 'foo' })).toBe(true);
  });

  it('returns false when uri is missing or not a string', () => {
    expect(isMcpResource({ name: 'foo' })).toBe(false);
    expect(isMcpResource({ uri: 42, name: 'foo' })).toBe(false);
  });

  it('returns false when name is missing or not a string', () => {
    expect(isMcpResource({ uri: 'file://foo' })).toBe(false);
    expect(isMcpResource({ uri: 'file://foo', name: 42 })).toBe(false);
  });

  it('returns falsy for null/undefined', () => {
    expect(isMcpResource(null)).toBeFalsy();
    expect(isMcpResource(undefined)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// isMcpPrompt
// ---------------------------------------------------------------------------
describe('isMcpPrompt', () => {
  it('returns true for a valid prompt with just a name', () => {
    expect(isMcpPrompt({ name: 'greet' })).toBe(true);
  });

  it('returns false when name is missing', () => {
    expect(isMcpPrompt({})).toBe(false);
  });

  it('returns false when name is not a string', () => {
    expect(isMcpPrompt({ name: 123 })).toBe(false);
  });

  it('returns falsy for null/undefined', () => {
    expect(isMcpPrompt(null)).toBeFalsy();
    expect(isMcpPrompt(undefined)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// isConnectionState
// ---------------------------------------------------------------------------
describe('isConnectionState', () => {
  it.each(['stopped', 'starting', 'running', 'error', 'disconnecting'])(
    'returns true for valid state %s',
    (state) => {
      expect(isConnectionState(state)).toBe(true);
    },
  );

  it('returns false for an unknown state', () => {
    expect(isConnectionState('paused')).toBe(false);
    expect(isConnectionState('')).toBe(false);
    expect(isConnectionState('STOPPED')).toBe(false); // case-sensitive
  });
});

// ---------------------------------------------------------------------------
// isTransportType
// ---------------------------------------------------------------------------
describe('isTransportType', () => {
  it.each(['stdio', 'http', 'sse'])('returns true for valid transport %s', (type) => {
    expect(isTransportType(type)).toBe(true);
  });

  it('returns false for an unknown transport', () => {
    expect(isTransportType('ws')).toBe(false);
    expect(isTransportType('HTTP')).toBe(false); // case-sensitive
    expect(isTransportType('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error class hierarchy
// ---------------------------------------------------------------------------
describe('McpError', () => {
  it('stores message, code and data', () => {
    const err = new McpError('boom', -32000, { details: 'oops' });
    expect(err.message).toBe('boom');
    expect(err.code).toBe(-32000);
    expect(err.data).toEqual({ details: 'oops' });
    expect(err.name).toBe('McpError');
    expect(err).toBeInstanceOf(Error);
  });

  it('allows data to be omitted', () => {
    const err = new McpError('boom', -32000);
    expect(err.data).toBeUndefined();
  });
});

describe('ConnectionError', () => {
  it('extends McpError with code -32000 and proper name', () => {
    const err = new ConnectionError('cannot connect');
    expect(err).toBeInstanceOf(McpError);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe(-32000);
    expect(err.name).toBe('ConnectionError');
    expect(err.message).toBe('cannot connect');
  });

  it('passes data through to McpError', () => {
    const err = new ConnectionError('cannot connect', { url: 'http://x' });
    expect(err.data).toEqual({ url: 'http://x' });
  });
});

describe('TimeoutError', () => {
  it('extends McpError with code -32001 and proper name', () => {
    const err = new TimeoutError('too slow');
    expect(err).toBeInstanceOf(McpError);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.code).toBe(-32001);
    expect(err.name).toBe('TimeoutError');
  });

  it('passes data through', () => {
    const err = new TimeoutError('too slow', { timeoutMs: 5000 });
    expect(err.data).toEqual({ timeoutMs: 5000 });
  });
});

describe('ValidationError', () => {
  it('extends McpError with code -32002 and proper name', () => {
    const err = new ValidationError('bad input');
    expect(err).toBeInstanceOf(McpError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe(-32002);
    expect(err.name).toBe('ValidationError');
  });

  it('passes data through', () => {
    const err = new ValidationError('bad input', { field: 'name' });
    expect(err.data).toEqual({ field: 'name' });
  });
});

describe('TransportError', () => {
  it('extends McpError with code -32003 and proper name', () => {
    const err = new TransportError('transport down');
    expect(err).toBeInstanceOf(McpError);
    expect(err).toBeInstanceOf(TransportError);
    expect(err.code).toBe(-32003);
    expect(err.name).toBe('TransportError');
  });

  it('passes data through', () => {
    const err = new TransportError('transport down', { reason: 'reset' });
    expect(err.data).toEqual({ reason: 'reset' });
  });
});

describe('ProtocolError', () => {
  it('extends McpError with code -32004 and proper name', () => {
    const err = new ProtocolError('bad message');
    expect(err).toBeInstanceOf(McpError);
    expect(err).toBeInstanceOf(ProtocolError);
    expect(err.code).toBe(-32004);
    expect(err.name).toBe('ProtocolError');
  });

  it('passes data through', () => {
    const err = new ProtocolError('bad message', { method: 'tools/call' });
    expect(err.data).toEqual({ method: 'tools/call' });
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
describe('DEFAULT_CONNECTION_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONNECTION_CONFIG).toEqual({
      timeout: 30000,
      retries: 3,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 30000,
      gracefulShutdownTimeoutMs: 5000,
    });
  });
});

describe('DEFAULT_SERVER_START_OPTIONS', () => {
  it('has expected default values', () => {
    expect(DEFAULT_SERVER_START_OPTIONS).toEqual({
      timeout: 10000,
      retries: 3,
      backoffMs: 1000,
    });
  });
});
