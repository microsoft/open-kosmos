import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock state ──────────────────────────────────────────────────────────
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

// ── helpers ─────────────────────────────────────────────────────────────────────

function makeToolsManagerInstance() {
  return {
    getStats: mockGetStats,
    initialize: mockInitialize,
    getAllTools: mockGetAllTools,
    hasTool: mockHasTool,
    executeTool: mockExecuteTool,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────────

describe('BuiltinMcpClient (coverage)', () => {
  let client: BuiltinMcpClient;
  let toolsManagerInstance: ReturnType<typeof makeToolsManagerInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    toolsManagerInstance = makeToolsManagerInstance();
    mockGetInstance.mockReturnValue(toolsManagerInstance);
    mockGetExecutionContext.mockReturnValue(null);
    mockGetStats.mockReturnValue({ isInitialized: true });
    mockGetAllTools.mockReturnValue([]);
    mockHasTool.mockReturnValue(true);
    mockExecuteTool.mockResolvedValue({ success: true, data: 'result' });
    client = new BuiltinMcpClient();
  });

  // ── constants ────────────────────────────────────────────────────────────────
  it('exports correct BUILTIN_SERVER_NAME', () => {
    expect(BUILTIN_SERVER_NAME).toBe('builtin-tools');
  });

  // ── getServerName / getConnectionStatus before connect ──────────────────────
  it('getServerName returns builtin-tools', () => {
    expect(client.getServerName()).toBe('builtin-tools');
  });

  it('getConnectionStatus is false initially', () => {
    expect(client.getConnectionStatus()).toBe(false);
  });

  // ── connectToServer ──────────────────────────────────────────────────────────
  describe('connectToServer', () => {
    it('returns "connected" when already initialized', async () => {
      mockGetStats.mockReturnValue({ isInitialized: true });
      const result = await client.connectToServer();
      expect(result).toBe('connected');
      expect(client.getConnectionStatus()).toBe(true);
      expect(mockInitialize).not.toHaveBeenCalled();
    });

    it('calls initialize when not yet initialized', async () => {
      mockGetStats.mockReturnValue({ isInitialized: false });
      mockInitialize.mockResolvedValue(undefined);
      const result = await client.connectToServer();
      expect(result).toBe('connected');
      expect(mockInitialize).toHaveBeenCalled();
    });

    it('returns Error when getToolsManager throws', async () => {
      mockGetInstance.mockImplementation(() => { throw new Error('getInstance failed'); });
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('getInstance failed');
    });

    it('returns Error (default message) for non-Error throw', async () => {
      mockGetInstance.mockImplementation(() => { throw 'unknown'; });
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Failed to connect to builtin server');
    });
  });

  // ── getTools ─────────────────────────────────────────────────────────────────
  describe('getTools', () => {
    it('returns empty array when not connected', async () => {
      const tools = await client.getTools();
      expect(tools).toEqual([]);
    });

    it('returns mapped tools when connected', async () => {
      await client.connectToServer();
      mockGetAllTools.mockReturnValue([
        { name: 'tool1', description: 'desc1', inputSchema: { type: 'object' } },
        { name: 'tool2', description: undefined, inputSchema: {} },
      ]);
      const tools = await client.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({ name: 'tool1', description: 'desc1', inputSchema: { type: 'object' } });
    });

    it('returns empty array on exception', async () => {
      await client.connectToServer();
      mockGetAllTools.mockImplementation(() => { throw new Error('getAllTools failed'); });
      const tools = await client.getTools();
      expect(tools).toEqual([]);
    });
  });

  // ── executeTool ──────────────────────────────────────────────────────────────
  describe('executeTool', () => {
    it('throws when not connected', async () => {
      await expect(client.executeTool({ toolName: 'foo', toolArgs: {} }))
        .rejects.toThrow('Not connected to builtin server');
    });

    it('throws when signal is already aborted', async () => {
      await client.connectToServer();
      const controller = new AbortController();
      controller.abort();
      await expect(client.executeTool({ toolName: 'foo', toolArgs: {}, signal: controller.signal }))
        .rejects.toThrow('Builtin tool execution aborted: foo');
    });

    it('throws when tool not found', async () => {
      await client.connectToServer();
      mockHasTool.mockReturnValue(false);
      await expect(client.executeTool({ toolName: 'missing', toolArgs: {} }))
        .rejects.toThrow('Builtin tool not found: missing');
    });

    it('returns data on success', async () => {
      await client.connectToServer();
      mockExecuteTool.mockResolvedValue({ success: true, data: 'tool output' });
      const result = await client.executeTool({ toolName: 'tool1', toolArgs: { x: 1 } });
      expect(result).toBe('tool output');
    });

    it('returns empty string when data is falsy', async () => {
      await client.connectToServer();
      mockExecuteTool.mockResolvedValue({ success: true, data: '' });
      const result = await client.executeTool({ toolName: 'tool1', toolArgs: {} });
      expect(result).toBe('');
    });

    it('throws on tool execution failure', async () => {
      await client.connectToServer();
      mockExecuteTool.mockResolvedValue({ success: false, error: 'tool error' });
      await expect(client.executeTool({ toolName: 'tool1', toolArgs: {} }))
        .rejects.toThrow('Tool execution failed: tool error');
    });

    it('throws with default error message when error field is absent', async () => {
      await client.connectToServer();
      mockExecuteTool.mockResolvedValue({ success: false });
      await expect(client.executeTool({ toolName: 'tool1', toolArgs: {} }))
        .rejects.toThrow('Tool execution failed: Unknown error');
    });

    it('wraps non-Error thrown value', async () => {
      await client.connectToServer();
      mockExecuteTool.mockRejectedValue('raw error');
      await expect(client.executeTool({ toolName: 'tool1', toolArgs: {} }))
        .rejects.toThrow('Tool execution failed');
    });

    it('uses chatSessionId from execution context', async () => {
      await client.connectToServer();
      mockGetExecutionContext.mockReturnValue({ chatSessionId: 'session-42' });
      mockExecuteTool.mockResolvedValue({ success: true, data: 'ok' });
      const result = await client.executeTool({ toolName: 'tool1', toolArgs: {} });
      expect(result).toBe('ok');
      expect(mockExecuteTool).toHaveBeenCalledWith('tool1', {}, undefined, 'session-42');
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────────
  describe('cleanup', () => {
    it('resets connection state', async () => {
      await client.connectToServer();
      expect(client.getConnectionStatus()).toBe(true);
      await client.cleanup();
      expect(client.getConnectionStatus()).toBe(false);
    });

    it('does not throw when not connected', async () => {
      await expect(client.cleanup()).resolves.toBeUndefined();
    });
  });
});
