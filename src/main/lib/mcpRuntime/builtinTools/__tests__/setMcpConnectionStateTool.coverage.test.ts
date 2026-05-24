/**
 * Coverage tests for SetMcpConnectionStateTool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────

const {
  mockConnect,
  mockDisconnect,
  mockReconnect,
  mockGetMcpServerInfo,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockReconnect: vi.fn().mockResolvedValue(undefined),
  mockGetMcpServerInfo: vi.fn().mockReturnValue({
    config: { name: 'myServer', command: 'npx', args: [] },
    runtime: { status: 'connected' },
  }),
}));

vi.mock('../../mcpClientManager', () => ({
  mcpClientManager: {
    get currentUserAlias() { return 'alice'; },
    connect: mockConnect,
    disconnect: mockDisconnect,
    reconnect: mockReconnect,
  },
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    getMcpServerInfo: mockGetMcpServerInfo,
  },
}));

import { SetMcpConnectionStateTool } from '../setMcpConnectionStateTool';

describe('SetMcpConnectionStateTool.getDefinition', () => {
  it('returns correct definition', () => {
    const def = SetMcpConnectionStateTool.getDefinition();
    expect(def.name).toBe('set_mcp_connection_state');
    expect(def.inputSchema.required).toContain('name');
    expect(def.inputSchema.required).toContain('action');
  });
});

describe('SetMcpConnectionStateTool.execute - aborted signal', () => {
  it('returns ABORTED when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await SetMcpConnectionStateTool.execute(
      { name: 'myServer', action: 'connect' },
      { signal: controller.signal }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('ABORTED');
  });
});

describe('SetMcpConnectionStateTool.execute - validation', () => {
  it('returns INVALID_NAME for empty name', async () => {
    const result = await SetMcpConnectionStateTool.execute({ name: '', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_NAME');
  });

  it('returns INVALID_NAME for whitespace name', async () => {
    const result = await SetMcpConnectionStateTool.execute({ name: '   ', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_NAME');
  });

  it('returns INVALID_ACTION for invalid action', async () => {
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'noop' as any });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_ACTION');
  });
});

describe('SetMcpConnectionStateTool.execute - builtin server guard', () => {
  it('returns BUILTIN_SERVER_PROTECTED for builtin-tools server', async () => {
    const result = await SetMcpConnectionStateTool.execute({ name: 'builtin-tools', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('BUILTIN_SERVER_PROTECTED');
  });
});

describe('SetMcpConnectionStateTool.execute - no user session', () => {
  it('returns NO_USER_SESSION when currentUserAlias is null', async () => {
    const { mcpClientManager } = await import('../../mcpClientManager');
    const orig = Object.getOwnPropertyDescriptor(mcpClientManager, 'currentUserAlias');
    Object.defineProperty(mcpClientManager, 'currentUserAlias', { get: () => null, configurable: true });

    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');

    if (orig) Object.defineProperty(mcpClientManager, 'currentUserAlias', orig);
  });
});

describe('SetMcpConnectionStateTool.execute - server not found', () => {
  it('returns SERVER_NOT_FOUND when config is null', async () => {
    mockGetMcpServerInfo.mockReturnValueOnce({ config: null, runtime: null });
    const result = await SetMcpConnectionStateTool.execute({ name: 'nonexistent', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('SERVER_NOT_FOUND');
  });
});

describe('SetMcpConnectionStateTool.execute - connect action', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connected' } });
  });

  it('connects successfully', async () => {
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'connect' });
    expect(result.success).toBe(true);
    expect(mockConnect).toHaveBeenCalledWith('myServer');
    expect(result.current_status).toBe('connected');
    expect(result.message).toMatch(/Successfully connected/);
  });
});

describe('SetMcpConnectionStateTool.execute - connect action - not yet connected', () => {
  it('returns message with current status when not yet connected', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connecting' } });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'connect' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Connection initiated/);
  });
});

describe('SetMcpConnectionStateTool.execute - disconnect action', () => {
  it('disconnects successfully', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'disconnect' });
    expect(result.success).toBe(true);
    expect(mockDisconnect).toHaveBeenCalledWith('myServer');
    expect(result.message).toMatch(/Successfully disconnected/);
  });

  it('returns message with current status when not yet disconnected', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'stopping' } });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'disconnect' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Disconnection initiated/);
  });
});

describe('SetMcpConnectionStateTool.execute - reconnect action', () => {
  it('reconnects successfully', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connected' } });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'reconnect' });
    expect(result.success).toBe(true);
    expect(mockReconnect).toHaveBeenCalledWith('myServer');
    expect(result.message).toMatch(/Successfully reconnected/);
  });

  it('returns message with current status when not yet reconnected', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: { status: 'connecting' } });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'reconnect' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Reconnection initiated/);
  });
});

describe('SetMcpConnectionStateTool.execute - operation error', () => {
  it('returns failure when connect throws', async () => {
    mockGetMcpServerInfo.mockReturnValue({ config: { name: 'myServer' }, runtime: { status: 'disconnected' } });
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'connect' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
    expect(result.message).toMatch(/Failed to connect/);
  });
});

describe('SetMcpConnectionStateTool.execute - missing runtime', () => {
  it('uses "disconnected" as default previousStatus', async () => {
    mockGetMcpServerInfo
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: null })
      .mockReturnValueOnce({ config: { name: 'myServer' }, runtime: null });
    const result = await SetMcpConnectionStateTool.execute({ name: 'myServer', action: 'connect' });
    expect(result.previous_status).toBe('disconnected');
  });
});
