// @ts-nocheck
/**
 * Unit tests for VscodeTransportFactory and helper functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks so they are available inside vi.mock factories
const mockStdioTransport = vi.hoisted(() => vi.fn());
const mockHttpTransport = vi.hoisted(() => vi.fn());

vi.mock('../transport/VscodeStdioTransport', () => ({
  VscodeStdioTransport: mockStdioTransport,
}));

vi.mock('../transport/VscodeHttpTransport', () => ({
  VscodeHttpTransport: mockHttpTransport,
}));

import {
  VscodeTransportFactory,
  createVscodeTransport,
  isSSEUrl,
  isStdioConfig,
  isHttpConfig,
} from '../transport/VscodeTransportFactory';

describe('VscodeTransportFactory', () => {

  // ── detectTransportType ────────────────────────────────────────────────────

  describe('detectTransportType', () => {
    it('returns "stdio" for explicit type "stdio"', () => {
      expect(VscodeTransportFactory.detectTransportType({ type: 'stdio' })).toBe('stdio');
    });

    it('returns "http" for explicit type "http"', () => {
      expect(VscodeTransportFactory.detectTransportType({ type: 'http' })).toBe('http');
    });

    it('returns "http" for explicit type "streamablehttp" (case-insensitive)', () => {
      expect(VscodeTransportFactory.detectTransportType({ type: 'StreamableHTTP' })).toBe('http');
    });

    it('returns "sse" for explicit type "sse"', () => {
      expect(VscodeTransportFactory.detectTransportType({ type: 'sse' })).toBe('sse');
    });

    it('auto-detects "stdio" when command is present', () => {
      expect(VscodeTransportFactory.detectTransportType({ command: 'node' })).toBe('stdio');
    });

    it('auto-detects "stdio" when args is present', () => {
      expect(VscodeTransportFactory.detectTransportType({ args: ['server.js'] })).toBe('stdio');
    });

    it('auto-detects "sse" for SSE-pattern URLs', () => {
      expect(VscodeTransportFactory.detectTransportType({ url: 'http://host/sse' })).toBe('sse');
    });

    it('auto-detects "http" for non-SSE URLs', () => {
      expect(VscodeTransportFactory.detectTransportType({ url: 'http://host/api' })).toBe('http');
    });

    it('defaults to "stdio" when nothing matches', () => {
      expect(VscodeTransportFactory.detectTransportType({})).toBe('stdio');
    });

    it('falls through unknown explicit type to auto-detection', () => {
      // Unknown type, but has command → auto-detects stdio
      expect(VscodeTransportFactory.detectTransportType({ type: 'grpc', command: 'srv' })).toBe('stdio');
    });
  });

  // ── validateConfig ─────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    it('passes for valid stdio config', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'stdio', command: 'node', args: [] })).not.toThrow();
    });

    it('throws when stdio config is missing command', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'stdio', command: '', args: [] })).toThrow(/command/);
    });

    it('throws when stdio config has non-array args', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'stdio', command: 'node', args: null as any })).toThrow(/args/);
    });

    it('passes for valid http config', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'http', url: 'https://host/api', headers: {}, serverName: 's', method: 'POST' })).not.toThrow();
    });

    it('passes for valid sse config', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'sse', url: 'https://host/sse', headers: {}, serverName: 's', method: 'POST' })).not.toThrow();
    });

    it('throws when http/sse config is missing url', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'http', url: '', headers: {}, serverName: 's', method: 'POST' })).toThrow(/URL/);
    });

    it('throws when http url does not start with http(s)://', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'http', url: 'ftp://host/api', headers: {}, serverName: 's', method: 'POST' })).toThrow(/http/i);
    });

    it('throws for unknown transport type', () => {
      expect(() => VscodeTransportFactory.validateConfig({ type: 'grpc' } as any)).toThrow(/Unknown/);
    });
  });

  // ── normalizeVscodeConfig ──────────────────────────────────────────────────

  describe('normalizeVscodeConfig', () => {
    it('normalizes a stdio config', () => {
      const result = VscodeTransportFactory.normalizeVscodeConfig('srv', {
        command: 'node',
        args: ['server.js'],
        cwd: '/tmp',
        env: { FOO: 'bar' },
      });
      expect(result.type).toBe('stdio');
      if (result.type === 'stdio') {
        expect(result.command).toBe('node');
        expect(result.args).toEqual(['server.js']);
        expect(result.cwd).toBe('/tmp');
      }
    });

    it('throws when stdio is missing command', () => {
      expect(() => VscodeTransportFactory.normalizeVscodeConfig('srv', { type: 'stdio' })).toThrow(/command/);
    });

    it('normalizes an http config', () => {
      const result = VscodeTransportFactory.normalizeVscodeConfig('srv', {
        url: 'https://host/api',
      });
      expect(result.type).toBe('http');
      if (result.type === 'http') {
        expect(result.url).toBe('https://host/api');
        expect((result.headers as any)['Content-Type']).toBe('application/json');
      }
    });

    it('normalizes a sse config', () => {
      const result = VscodeTransportFactory.normalizeVscodeConfig('srv', {
        url: 'https://host/sse',
      });
      expect(result.type).toBe('sse');
      if (result.type === 'sse') {
        expect((result.headers as any)['Accept']).toContain('text/event-stream');
      }
    });

    it('throws when http/sse is missing url', () => {
      expect(() => VscodeTransportFactory.normalizeVscodeConfig('srv', { type: 'http' })).toThrow(/url/i);
    });

    it('merges extra headers from vscodeConfig', () => {
      const result = VscodeTransportFactory.normalizeVscodeConfig('srv', {
        url: 'https://host/api',
        headers: { Authorization: 'Bearer token' },
      });
      if (result.type === 'http') {
        expect((result.headers as any)['Authorization']).toBe('Bearer token');
      }
    });
  });

  // ── createTransport ────────────────────────────────────────────────────────

  describe('createTransport', () => {
    beforeEach(() => {
      mockStdioTransport.mockClear();
      mockHttpTransport.mockClear();
    });

    it('creates VscodeStdioTransport for stdio type', () => {
      mockStdioTransport.mockImplementation(class { state = { state: 'stopped' }; });
      const result = VscodeTransportFactory.createTransport({ type: 'stdio', command: 'node', args: [] });
      expect(mockStdioTransport).toHaveBeenCalledOnce();
      expect((result as any).state.state).toBe('stopped');
    });

    it('creates VscodeHttpTransport for http type', () => {
      mockHttpTransport.mockImplementation(class { state = { state: 'stopped' }; });
      const result = VscodeTransportFactory.createTransport({ type: 'http', url: 'https://host/api', headers: {}, serverName: 'srv', method: 'POST' });
      expect(mockHttpTransport).toHaveBeenCalledOnce();
      expect((result as any).state.state).toBe('stopped');
    });

    it('creates VscodeHttpTransport for sse type', () => {
      mockHttpTransport.mockImplementation(class { state = { state: 'stopped' }; });
      const result = VscodeTransportFactory.createTransport({ type: 'sse', url: 'https://host/sse', headers: {}, serverName: 'srv', method: 'POST' });
      expect(mockHttpTransport).toHaveBeenCalledOnce();
      expect((result as any).state.state).toBe('stopped');
    });

    it('throws for unsupported transport type', () => {
      expect(() => VscodeTransportFactory.createTransport({ type: 'grpc' } as any)).toThrow(/Unsupported/);
    });
  });

  // ── createFromVscodeConfig ─────────────────────────────────────────────────

  describe('createFromVscodeConfig', () => {
    it('delegates through normalizeVscodeConfig and createTransport', () => {
      mockStdioTransport.mockImplementation(class { state = { state: 'stopped' }; });
      const result = VscodeTransportFactory.createFromVscodeConfig('srv', { command: 'node', args: [] });
      expect((result as any).state.state).toBe('stopped');
    });
  });

  // ── getSupportedTypes ──────────────────────────────────────────────────────

  describe('getSupportedTypes', () => {
    it('includes stdio, http, and sse', () => {
      const types = VscodeTransportFactory.getSupportedTypes();
      expect(types).toContain('stdio');
      expect(types).toContain('http');
      expect(types).toContain('sse');
    });
  });
});

// ── Helper function tests ────────────────────────────────────────────────────

describe('isSSEUrl', () => {
  it('returns true for URLs containing /sse', () => {
    expect(isSSEUrl('http://host/sse')).toBe(true);
  });

  it('returns true for URLs containing text/event-stream', () => {
    expect(isSSEUrl('http://host/api?type=text/event-stream')).toBe(true);
  });

  it('returns true for URLs containing server-sent-events', () => {
    expect(isSSEUrl('http://host/server-sent-events')).toBe(true);
  });

  it('returns false for regular HTTP URLs', () => {
    expect(isSSEUrl('http://host/api')).toBe(false);
  });
});

describe('isStdioConfig', () => {
  it('returns true when command is present', () => {
    expect(isStdioConfig({ command: 'node' })).toBe(true);
  });

  it('returns true when args is present', () => {
    expect(isStdioConfig({ args: [] })).toBe(true);
  });

  it('returns true for explicit type stdio', () => {
    expect(isStdioConfig({ type: 'stdio' })).toBe(true);
  });

  it('returns false for URL config', () => {
    expect(isStdioConfig({ url: 'http://host' })).toBe(false);
  });
});

describe('isHttpConfig', () => {
  it('returns true when url is present', () => {
    expect(isHttpConfig({ url: 'http://host' })).toBe(true);
  });

  it('returns true for type http', () => {
    expect(isHttpConfig({ type: 'http' })).toBe(true);
  });

  it('returns true for type sse', () => {
    expect(isHttpConfig({ type: 'sse' })).toBe(true);
  });

  it('returns true for type streamablehttp', () => {
    expect(isHttpConfig({ type: 'streamablehttp' })).toBe(true);
  });

  it('returns false for stdio config', () => {
    expect(isHttpConfig({ command: 'node' })).toBe(false);
  });
});

describe('createVscodeTransport helper', () => {
  it('creates a transport using the factory', () => {
    mockStdioTransport.mockImplementation(class { state = { state: 'stopped' }; });
    const result = createVscodeTransport('srv', { command: 'node', args: [] });
    expect((result as any).state.state).toBe('stopped');
  });
});
