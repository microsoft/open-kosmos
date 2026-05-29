import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockProfileCacheManager = vi.hoisted(() => ({
  executeToolCall: vi.fn().mockResolvedValue({ result: 'ok' }),
  getMcpServerInfo: vi.fn().mockReturnValue({ config: { url: 'http://test' } }),
}));

const mockMcpClientManager = vi.hoisted(() => ({
  getAllMcpServerRuntimeStates: vi.fn().mockReturnValue([
    { serverName: 'server1', status: 'connected', tools: [], lastError: null },
  ]),
  getCurrentUserAlias: vi.fn().mockReturnValue('user@example.com'),
  disconnect: vi.fn().mockResolvedValue(undefined),
}));

const mockLibraryFetcher = vi.hoisted(() => ({
  getLibraryData: vi.fn().mockImplementation(async () => ({ success: true, data: { mcp_servers: [] } })),
  fetchAndUpdate: vi.fn().mockImplementation(async () => ({ success: true, data: { mcp_servers: [] } })),
}));

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn().mockReturnValue(false));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
}));

vi.mock('../../lazy', () => ({
  getProfileCacheManager: vi.fn().mockResolvedValue(mockProfileCacheManager),
  getAdvancedLogger: () => mockLogger,
}));

vi.mock('../../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: mockMcpClientManager,
}));

vi.mock('../../../lib/assetsFetcher/mcpLibraryFetcher', () => ({
  McpLibraryFetcher: {
    getInstance: () => mockLibraryFetcher,
  },
}));

vi.mock('../../../lib/featureFlags', () => ({
  isFeatureEnabled: (...args: any[]) => mockIsFeatureEnabled(...args),
}));

// ── helpers ────────────────────────────────────────────────────────────────────
function getHandler(channel: string): (...args: any[]) => Promise<any> {
  const call = mockHandle.mock.calls.find(([name]: any[]) => name === channel);
  if (!call) throw new Error(`Handler not registered for channel: ${channel}`);
  return call[1];
}

const mockEvent = {
  sender: { getURL: vi.fn().mockReturnValue('http://localhost') },
};

// ── tests ──────────────────────────────────────────────────────────────────────
describe('startup/ipc/mcp', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(false);
    const { default: registerMcpIPC } = await import('../mcp');
    registerMcpIPC({} as any);
  });

  // ── mcp:getServerStatus ──────────────────────────────────────────────────────
  describe('mcp:getServerStatus', () => {
    it('returns serialized runtime states', async () => {
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result).toEqual({
        success: true,
        data: [{ serverName: 'server1', status: 'connected', tools: [], lastError: null }],
      });
    });

    it('serializes lastError.message', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockReturnValueOnce([
        { serverName: 's', status: 'error', tools: [], lastError: new Error('oops') },
      ]);
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result.data[0].lastError).toBe('oops');
    });

    it('returns error on exception', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockImplementationOnce(() => {
        throw new Error('crash');
      });
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'crash' });
    });

    it('returns unknown error string for non-Error throws', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockImplementationOnce(() => {
        throw 'string error';
      });
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── mcp:executeTool ──────────────────────────────────────────────────────────
  describe('mcp:executeTool', () => {
    it('returns tool result on success', async () => {
      const handler = getHandler('mcp:executeTool');
      const result = await handler(mockEvent, 'myTool', { arg: 1 });
      expect(result).toEqual({ success: true, data: { result: 'ok' } });
    });

    it('returns error on failure', async () => {
      mockProfileCacheManager.executeToolCall.mockRejectedValueOnce(new Error('tool failed'));
      const handler = getHandler('mcp:executeTool');
      const result = await handler(mockEvent, 'myTool', {});
      expect(result).toEqual({ success: false, error: 'tool failed' });
    });
  });

  // ── mcpLibrary:getLibraryData ────────────────────────────────────────────────
  describe('mcpLibrary:getLibraryData', () => {
    it('returns library data', async () => {
      const handler = getHandler('mcpLibrary:getLibraryData');
      const result = await handler();
      expect(result.success).toBe(true);
      expect(result.data.mcp_servers).toEqual([]);
    });

    it('returns error on fetcher failure', async () => {
      mockLibraryFetcher.getLibraryData.mockRejectedValueOnce(new Error('fetch error'));
      const handler = getHandler('mcpLibrary:getLibraryData');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'fetch error' });
    });
  });

  // ── mcpLibrary:fetchAndUpdate ────────────────────────────────────────────────
  describe('mcpLibrary:fetchAndUpdate', () => {
    it('returns updated library data', async () => {
      const handler = getHandler('mcpLibrary:fetchAndUpdate');
      const result = await handler();
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockLibraryFetcher.fetchAndUpdate.mockRejectedValueOnce(new Error('update error'));
      const handler = getHandler('mcpLibrary:fetchAndUpdate');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'update error' });
    });
  });

});
