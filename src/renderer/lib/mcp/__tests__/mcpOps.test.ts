// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { McpOps } from '../mcpOps';
import type { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes';

function makeApi(overrides: Record<string, any> = {}) {
  return {
    profile: {
      connectMcpServer: vi.fn(async () => ({ success: true })),
      disconnectMcpServer: vi.fn(async () => ({ success: true })),
      reconnectMcpServer: vi.fn(async () => ({ success: true })),
      addMcpServer: vi.fn(async () => ({ success: true, data: 'server-id' })),
      updateMcpServer: vi.fn(async () => ({ success: true, data: 'server-id' })),
      deleteMcpServer: vi.fn(async () => ({ success: true })),
      ...overrides.profile,
    },
    mcp: {
      getServerStatus: vi.fn(async () => ({ success: true, data: [] })),
      getAllTools: vi.fn(async () => ({ success: true, data: [] })),
      executeTool: vi.fn(async () => ({ success: true, data: 'result' })),
      ...overrides.mcp,
    },
  };
}

function setupWindow(overrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: makeApi(overrides),
  });
}

const validStdioConfig: OpenKosmosAppMCPServerConfig = {
  name: 'my-server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: {},
  url: '',
  in_use: true,
};

describe('McpOps.connect', () => {
  beforeEach(() => setupWindow());

  it('connects successfully', async () => {
    const result = await McpOps.connect('my-server');
    expect(result.success).toBe(true);
  });

  it('returns error for empty server name', async () => {
    const result = await McpOps.connect('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns error when IPC throws', async () => {
    setupWindow({ profile: { connectMcpServer: vi.fn(async () => { throw new Error('IPC crash'); }) } });
    const result = await McpOps.connect('srv');
    expect(result.success).toBe(false);
    expect(result.error).toContain('IPC crash');
  });
});

describe('McpOps.disconnect', () => {
  beforeEach(() => setupWindow());

  it('disconnects successfully', async () => {
    expect((await McpOps.disconnect('my-server')).success).toBe(true);
  });

  it('returns error for empty name', async () => {
    expect((await McpOps.disconnect('   ')).success).toBe(false);
  });

  it('handles thrown exception', async () => {
    setupWindow({ profile: { disconnectMcpServer: vi.fn(async () => { throw new Error('disc fail'); }) } });
    const result = await McpOps.disconnect('srv');
    expect(result.success).toBe(false);
  });
});

describe('McpOps.reconnect', () => {
  beforeEach(() => setupWindow());

  it('reconnects successfully', async () => {
    expect((await McpOps.reconnect('my-server')).success).toBe(true);
  });

  it('returns error for empty name', async () => {
    expect((await McpOps.reconnect('')).success).toBe(false);
  });

  it('handles thrown exception', async () => {
    setupWindow({ profile: { reconnectMcpServer: vi.fn(async () => { throw new Error('recon fail'); }) } });
    const result = await McpOps.reconnect('srv');
    expect(result.success).toBe(false);
  });
});

describe('McpOps.add', () => {
  beforeEach(() => setupWindow());

  it('adds a valid server', async () => {
    const result = await McpOps.add(validStdioConfig);
    expect(result.success).toBe(true);
  });

  it('returns validation error for invalid config', async () => {
    const invalid = { ...validStdioConfig, name: '', command: '' };
    const result = await McpOps.add(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
  });

  it('handles thrown exception', async () => {
    setupWindow({ profile: { addMcpServer: vi.fn(async () => { throw new Error('add fail'); }) } });
    const result = await McpOps.add(validStdioConfig);
    expect(result.success).toBe(false);
  });
});

describe('McpOps.update', () => {
  beforeEach(() => setupWindow());

  it('updates with a partial config (no name/transport)', async () => {
    const result = await McpOps.update('my-server', { args: ['new.js'] });
    expect(result.success).toBe(true);
  });

  it('validates a complete config update', async () => {
    const result = await McpOps.update('my-server', validStdioConfig);
    expect(result.success).toBe(true);
  });

  it('returns error for invalid complete config', async () => {
    const invalid = { ...validStdioConfig, command: '' };
    const result = await McpOps.update('my-server', invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
  });

  it('returns error for empty server name', async () => {
    const result = await McpOps.update('', { args: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('handles thrown exception', async () => {
    setupWindow({ profile: { updateMcpServer: vi.fn(async () => { throw new Error('upd fail'); }) } });
    const result = await McpOps.update('srv', { args: [] });
    expect(result.success).toBe(false);
  });
});

describe('McpOps.delete', () => {
  beforeEach(() => setupWindow());

  it('deletes successfully', async () => {
    expect((await McpOps.delete('my-server')).success).toBe(true);
  });

  it('returns error for empty name', async () => {
    expect((await McpOps.delete('')).success).toBe(false);
  });

  it('handles thrown exception', async () => {
    setupWindow({ profile: { deleteMcpServer: vi.fn(async () => { throw new Error('del fail'); }) } });
    const result = await McpOps.delete('srv');
    expect(result.success).toBe(false);
  });
});

describe('McpOps.getServerStatus', () => {
  beforeEach(() => setupWindow());

  it('returns server status', async () => {
    const result = await McpOps.getServerStatus();
    expect(result.success).toBe(true);
  });

  it('handles thrown exception', async () => {
    setupWindow({ mcp: { getServerStatus: vi.fn(async () => { throw new Error('status fail'); }) } });
    const result = await McpOps.getServerStatus();
    expect(result.success).toBe(false);
  });
});

describe('McpOps.getAllTools', () => {
  beforeEach(() => setupWindow());

  it('returns tools list', async () => {
    const result = await McpOps.getAllTools();
    expect(result.success).toBe(true);
  });

  it('handles thrown exception', async () => {
    setupWindow({ mcp: { getAllTools: vi.fn(async () => { throw new Error('tools fail'); }) } });
    const result = await McpOps.getAllTools();
    expect(result.success).toBe(false);
  });
});

describe('McpOps.executeTool', () => {
  beforeEach(() => setupWindow());

  it('executes a tool successfully', async () => {
    const result = await McpOps.executeTool('my_tool', { arg: 1 });
    expect(result.success).toBe(true);
  });

  it('returns error for empty tool name', async () => {
    const result = await McpOps.executeTool('', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('handles thrown exception', async () => {
    setupWindow({ mcp: { executeTool: vi.fn(async () => { throw new Error('exec fail'); }) } });
    const result = await McpOps.executeTool('tool', {});
    expect(result.success).toBe(false);
  });
});

describe('McpOps.validate', () => {
  it('returns valid for a well-formed server name and config', () => {
    const result = McpOps.validate('my-server', validStdioConfig);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for empty server name', () => {
    const result = McpOps.validate('', validStdioConfig);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('required'))).toBe(true);
  });

  it('returns errors for invalid server name format', () => {
    const result = McpOps.validate('my server!', validStdioConfig);
    expect(result.errors.some(e => e.includes('alphanumeric'))).toBe(true);
  });

  it('generates suggestions based on errors', () => {
    const result = McpOps.validate('', { ...validStdioConfig, command: '' });
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('handles validation exception gracefully', () => {
    // Pass null to trigger an exception
    const result = McpOps.validate('srv', null as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('McpOps.validateServerName', () => {
  it('returns valid for a good server name', () => {
    expect(McpOps.validateServerName('my-server').isValid).toBe(true);
  });

  it('returns invalid for empty name', () => {
    expect(McpOps.validateServerName('').isValid).toBe(false);
  });

  it('returns invalid for name with spaces', () => {
    expect(McpOps.validateServerName('my server').isValid).toBe(false);
  });

  it('returns invalid for name exceeding 50 chars', () => {
    expect(McpOps.validateServerName('a'.repeat(51)).isValid).toBe(false);
  });

  it('returns valid for single char name', () => {
    expect(McpOps.validateServerName('a').isValid).toBe(true);
  });
});

describe('McpOps.validateTransportConfig', () => {
  it('validates stdio transport with command', () => {
    const result = McpOps.validateTransportConfig('stdio', { command: 'node' });
    expect(result.isValid).toBe(true);
  });

  it('fails stdio transport without command', () => {
    const result = McpOps.validateTransportConfig('stdio', {});
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('stdio transport requires command');
  });

  it('validates SSE transport with URL', () => {
    const result = McpOps.validateTransportConfig('sse', { url: 'http://localhost:8080' });
    expect(result.isValid).toBe(true);
  });

  it('fails SSE transport without URL', () => {
    const result = McpOps.validateTransportConfig('sse', {});
    expect(result.isValid).toBe(false);
  });

  it('fails SSE transport with invalid URL', () => {
    const result = McpOps.validateTransportConfig('sse', { url: 'not-a-url' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Invalid URL format');
  });

  it('validates StreamableHttp transport with URL', () => {
    const result = McpOps.validateTransportConfig('StreamableHttp', { url: 'http://localhost:8080' });
    expect(result.isValid).toBe(true);
  });

  it('returns invalid for unknown transport type', () => {
    const result = McpOps.validateTransportConfig('unknown' as any, {});
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Invalid transport type');
  });
});

describe('McpOps.validate suggestion coverage', () => {
  it('generates suggestion for missing URL error (validates transport config)', () => {
    const result = McpOps.validateTransportConfig('sse', {});
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('URL'))).toBe(true);
  });

  it('generates suggestion for SSE URL not containing "sse" warning', () => {
    const result = McpOps.validate('srv', {
      name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'http://localhost:8080/api', in_use: true
    });
    expect(result.suggestions.some(s => s.includes('SSE'))).toBe(true);
  });

  it('generates suggestion for Invalid URL format warning (sse with bad URL)', () => {
    const result = McpOps.validate('srv', {
      name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'not-a-url', in_use: true
    });
    expect(result.suggestions.some(s => s.includes('http://'))).toBe(true);
  });

  it('generates suggestion for Command may not be a valid warning', () => {
    const result = McpOps.validate('srv', {
      name: 'srv', transport: 'stdio', command: 'my-unknown-cmd', args: [], env: {}, url: '', in_use: true
    });
    // warnings include "Command may not be a valid executable path"
    expect(result.suggestions.some(s => s.includes('PATH') || s.toLowerCase().includes('command'))).toBe(true);
  });
});

describe('McpOps.isAvailable', () => {
  it('returns true when electronAPI.mcp is present', () => {
    setupWindow();
    expect(McpOps.isAvailable()).toBe(true);
  });

  it('returns false when electronAPI is absent', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: null });
    expect(McpOps.isAvailable()).toBe(false);
  });
});
