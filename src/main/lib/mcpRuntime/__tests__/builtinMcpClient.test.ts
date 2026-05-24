/**
 * Unit tests for BuiltinMcpClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────────────

const mockGetStats = vi.hoisted(() => vi.fn());
const mockInitialize = vi.hoisted(() => vi.fn());
const mockGetAllTools = vi.hoisted(() => vi.fn());
const mockHasTool = vi.hoisted(() => vi.fn());
const mockExecuteTool = vi.hoisted(() => vi.fn());
const mockGetExecutionContext = vi.hoisted(() => vi.fn());
const mockGetInstance = vi.hoisted(() => vi.fn());

vi.mock('../builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: class MockBuiltinToolsManager {
    static getInstance = mockGetInstance;
    static getExecutionContext = mockGetExecutionContext;
    getStats = mockGetStats;
    initialize = mockInitialize;
    getAllTools = mockGetAllTools;
    hasTool = mockHasTool;
    executeTool = mockExecuteTool;
  },
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => Promise.resolve({
    log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  })),
}));

import { BuiltinMcpClient, BUILTIN_SERVER_NAME } from '../builtinMcpClient';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeToolsManagerInstance() {
  return {
    getStats: mockGetStats,
    initialize: mockInitialize,
    getAllTools: mockGetAllTools,
    hasTool: mockHasTool,
    executeTool: mockExecuteTool,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BuiltinMcpClient', () => {
  let client: BuiltinMcpClient;
  let toolsManagerInstance: ReturnType<typeof makeToolsManagerInstance>;

  beforeEach(() => {
    vi.clearAllMocks();

    toolsManagerInstance = makeToolsManagerInstance();
    mockGetInstance.mockReturnValue(toolsManagerInstance);
    mockGetExecutionContext.mockReturnValue(null);

    client = new BuiltinMcpClient();
  });

  // ── BUILTIN_SERVER_NAME ───────────────────────────────────────────────────

  it('exports BUILTIN_SERVER_NAME as "builtin-tools"', () => {
    expect(BUILTIN_SERVER_NAME).toBe('builtin-tools');
  });

  // ── getServerName ─────────────────────────────────────────────────────────

  it('getServerName returns BUILTIN_SERVER_NAME', () => {
    expect(client.getServerName()).toBe(BUILTIN_SERVER_NAME);
  });

  // ── getConnectionStatus ───────────────────────────────────────────────────

  it('getConnectionStatus is false before connecting', () => {
    expect(client.getConnectionStatus()).toBe(false);
  });

  // ── connectToServer ───────────────────────────────────────────────────────

  it('connectToServer returns "connected" and sets isConnected', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });

    const result = await client.connectToServer();
    expect(result).toBe('connected');
    expect(client.getConnectionStatus()).toBe(true);
  });

  it('connectToServer calls initialize when not yet initialized', async () => {
    mockGetStats.mockReturnValue({ isInitialized: false });
    mockInitialize.mockResolvedValue(undefined);

    await client.connectToServer();

    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it('connectToServer skips initialize when already initialized', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });

    await client.connectToServer();

    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('connectToServer returns an Error instance on failure', async () => {
    mockGetStats.mockImplementation(() => { throw new Error('load failed'); });

    const result = await client.connectToServer();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('load failed');
  });

  it('connectToServer returns an Error wrapping non-Error throws', async () => {
    mockGetStats.mockImplementation(() => { throw 'string error'; });

    const result = await client.connectToServer();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('Failed to connect to builtin server');
  });

  // ── getTools ──────────────────────────────────────────────────────────────

  it('getTools returns empty array when not connected', async () => {
    const tools = await client.getTools();
    expect(tools).toEqual([]);
  });

  it('getTools returns formatted tools when connected', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockGetAllTools.mockReturnValue([
      { name: 'search', description: 'Web search', inputSchema: { type: 'object' } },
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    ]);

    await client.connectToServer();
    const tools = await client.getTools();

    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ name: 'search', description: 'Web search', inputSchema: { type: 'object' } });
    expect(tools[1].name).toBe('read_file');
  });

  it('getTools returns empty array on error', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockGetAllTools.mockImplementation(() => { throw new Error('tools error'); });

    await client.connectToServer();
    const tools = await client.getTools();
    expect(tools).toEqual([]);
  });

  // ── executeTool ───────────────────────────────────────────────────────────

  it('executeTool throws when not connected', async () => {
    await expect(client.executeTool({ toolName: 'search', toolArgs: {} })).rejects.toThrow('Not connected');
  });

  it('executeTool throws when signal is already aborted', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    await client.connectToServer();

    const controller = new AbortController();
    controller.abort();

    await expect(
      client.executeTool({ toolName: 'search', toolArgs: {}, signal: controller.signal })
    ).rejects.toThrow(/aborted/);
  });

  it('executeTool throws when tool is not found', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(false);
    await client.connectToServer();

    await expect(client.executeTool({ toolName: 'nonexistent', toolArgs: {} })).rejects.toThrow('Builtin tool not found');
  });

  it('executeTool returns result.data on success', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: true, data: 'search results' });
    mockGetExecutionContext.mockReturnValue({ chatSessionId: 'session-1' });

    await client.connectToServer();
    const result = await client.executeTool({ toolName: 'search', toolArgs: { query: 'test' } });

    expect(result).toBe('search results');
    expect(mockExecuteTool).toHaveBeenCalledWith('search', { query: 'test' }, undefined, 'session-1');
  });

  it('executeTool returns empty string when data is falsy', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: true, data: '' });

    await client.connectToServer();
    const result = await client.executeTool({ toolName: 'search', toolArgs: {} });
    expect(result).toBe('');
  });

  it('executeTool throws with error message when result.success is false', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: false, error: 'Tool failed with reason X' });

    await client.connectToServer();
    await expect(client.executeTool({ toolName: 'search', toolArgs: {} })).rejects.toThrow('Tool failed with reason X');
  });

  it('executeTool throws with "Unknown error" when result.success=false and no error field', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: false });

    await client.connectToServer();
    await expect(client.executeTool({ toolName: 'search', toolArgs: {} })).rejects.toThrow('Unknown error');
  });

  it('executeTool passes signal through to executeTool', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: true, data: 'ok' });

    await client.connectToServer();
    const controller = new AbortController();
    await client.executeTool({ toolName: 'search', toolArgs: {}, signal: controller.signal });

    expect(mockExecuteTool).toHaveBeenCalledWith('search', {}, controller.signal, undefined);
  });

  it('executeTool uses null chatSessionId when no execution context', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: true, data: 'result' });
    mockGetExecutionContext.mockReturnValue(null);

    await client.connectToServer();
    await client.executeTool({ toolName: 'search', toolArgs: {} });

    expect(mockExecuteTool).toHaveBeenCalledWith('search', {}, undefined, undefined);
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  it('cleanup sets isConnected to false', async () => {
    mockGetStats.mockReturnValue({ isInitialized: true });
    await client.connectToServer();
    expect(client.getConnectionStatus()).toBe(true);

    await client.cleanup();
    expect(client.getConnectionStatus()).toBe(false);
  });

  it('cleanup can be called even when not connected', async () => {
    await expect(client.cleanup()).resolves.toBeUndefined();
    expect(client.getConnectionStatus()).toBe(false);
  });
});
