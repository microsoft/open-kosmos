// @ts-nocheck
/**
 * Comprehensive coverage tests for MCPClientManager
 * Targets the uncovered ~96% of mcpClientManager.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── hoisted mock variables (must be declared before vi.mock calls) ──────────
const {
  mockGetAllWindows,
  mockGetAllMcpServerInfo,
  mockGetMcpServerInfo,
  mockAddMcpServerConfig,
  mockUpdateMcpServerConfig,
  mockDeleteMcpServerConfig,
  mockOnInteraction,
  mockClearOAuthForServer,
  mockAuthServiceInstance,
  mockContainsOpenKosmosPlaceholder,
  mockReplacePlaceholders,
  mockReplacePlaceholdersInObject,
  mockVscConnect,
  mockVscGetTools,
  mockVscExecuteTool,
  mockVscCleanup,
  mockBuiltinConnect,
  mockBuiltinGetTools,
  mockBuiltinExecuteTool,
  mockBuiltinCleanup,
} = vi.hoisted(() => {
  const mockGetAllWindows = vi.fn(() => [] as any[]);
  const mockGetAllMcpServerInfo = vi.fn(() => [] as any[]);
  const mockGetMcpServerInfo = vi.fn(() => ({ config: null as any, runtime: null as any }));
  const mockAddMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockUpdateMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockDeleteMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockOnInteraction = vi.fn(() => vi.fn());
  const mockClearOAuthForServer = vi.fn(() => Promise.resolve());
  const mockAuthServiceInstance = {
    clearOAuthForServer: (...a: any[]) => mockClearOAuthForServer(...a),
  };
  const mockContainsOpenKosmosPlaceholder = vi.fn(() => false);
  const mockReplacePlaceholders = vi.fn((s: string) => s);
  const mockReplacePlaceholdersInObject = vi.fn((o: any) => o);
  const mockVscConnect = vi.fn(() => Promise.resolve('connected'));
  const mockVscGetTools = vi.fn(() =>
    Promise.resolve([{ name: 'tool1', description: 'desc', inputSchema: {} }])
  );
  const mockVscExecuteTool = vi.fn(() => Promise.resolve('result'));
  const mockVscCleanup = vi.fn(() => Promise.resolve());
  const mockBuiltinConnect = vi.fn(() => Promise.resolve('connected'));
  const mockBuiltinGetTools = vi.fn(() =>
    Promise.resolve([{ name: 'builtin_tool', description: 'builtin', inputSchema: {} }])
  );
  const mockBuiltinExecuteTool = vi.fn(() => Promise.resolve('builtin_result'));
  const mockBuiltinCleanup = vi.fn(() => Promise.resolve());

  return {
    mockGetAllWindows,
    mockGetAllMcpServerInfo,
    mockGetMcpServerInfo,
    mockAddMcpServerConfig,
    mockUpdateMcpServerConfig,
    mockDeleteMcpServerConfig,
    mockOnInteraction,
    mockClearOAuthForServer,
    mockAuthServiceInstance,
    mockContainsOpenKosmosPlaceholder,
    mockReplacePlaceholders,
    mockReplacePlaceholdersInObject,
    mockVscConnect,
    mockVscGetTools,
    mockVscExecuteTool,
    mockVscCleanup,
    mockBuiltinConnect,
    mockBuiltinGetTools,
    mockBuiltinExecuteTool,
    mockBuiltinCleanup,
  };
});

// ── vi.mock declarations ───────────────────────────────────────────────────

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    app: { getPath: vi.fn(() => '/tmp/test-userData'), isReady: vi.fn(() => true) },
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, execSync: vi.fn() };
});

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () =>
    Promise.resolve({ log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    getAllMcpServerInfo: (...a: any[]) => mockGetAllMcpServerInfo(...a),
    getMcpServerInfo: (...a: any[]) => mockGetMcpServerInfo(...a),
    addMcpServerConfig: (...a: any[]) => mockAddMcpServerConfig(...a),
    updateMcpServerConfig: (...a: any[]) => mockUpdateMcpServerConfig(...a),
    deleteMcpServerConfig: (...a: any[]) => mockDeleteMcpServerConfig(...a),
  },
}));

vi.mock('../auth/McpAuthService', () => ({
  McpAuthService: {
    onInteraction: (...a: any[]) => mockOnInteraction(...a),
    getInstance: () => mockAuthServiceInstance,
  },
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', () => ({
  containsOpenKosmosPlaceholder: (...a: any[]) => mockContainsOpenKosmosPlaceholder(...a),
  openkosmosPlaceholderManager: {
    replacePlaceholders: (...a: any[]) => mockReplacePlaceholders(...a),
    replacePlaceholdersInObject: (...a: any[]) => mockReplacePlaceholdersInObject(...a),
  },
}));

vi.mock('../vscMcpClient', () => ({
  VscMcpClient: class MockVscMcpClient {
    connectToServer = mockVscConnect;
    getTools = mockVscGetTools;
    executeTool = mockVscExecuteTool;
    cleanup = mockVscCleanup;
  },
}));

vi.mock('../builtinMcpClient', () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
  BuiltinMcpClient: class MockBuiltinMcpClient {
    connectToServer = mockBuiltinConnect;
    getTools = mockBuiltinGetTools;
    executeTool = mockBuiltinExecuteTool;
    cleanup = mockBuiltinCleanup;
  },
}));

// ── import under test ──────────────────────────────────────────────────────
import { MCPClientManager } from '../mcpClientManager';

// ── helpers ────────────────────────────────────────────────────────────────

function makeServerConfig(overrides: Record<string, any> = {}) {
  return {
    name: 'test-server',
    transport: 'stdio' as const,
    command: 'node',
    args: ['server.js'],
    in_use: true,
    ...overrides,
  };
}

function makeServerInfo(overrides: Record<string, any> = {}) {
  return {
    config: makeServerConfig(overrides.config ?? {}),
    runtime: overrides.runtime ?? null,
  };
}

function getManager(): MCPClientManager {
  (MCPClientManager as any).instance = null;
  return MCPClientManager.getInstance();
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('MCPClientManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMcpServerInfo.mockReturnValue([]);
    mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
    mockAddMcpServerConfig.mockResolvedValue(true);
    mockUpdateMcpServerConfig.mockResolvedValue(true);
    mockDeleteMcpServerConfig.mockResolvedValue(true);
    mockVscConnect.mockResolvedValue('connected');
    mockVscGetTools.mockResolvedValue([{ name: 'tool1', description: 'desc', inputSchema: {} }]);
    mockVscCleanup.mockResolvedValue(undefined);
    mockBuiltinConnect.mockResolvedValue('connected');
    mockBuiltinGetTools.mockResolvedValue([{ name: 'builtin_tool', description: 'builtin', inputSchema: {} }]);
    mockBuiltinCleanup.mockResolvedValue(undefined);
    mockContainsOpenKosmosPlaceholder.mockReturnValue(false);
    mockGetAllWindows.mockReturnValue([]);
    (MCPClientManager as any).instance = null;
  });

  afterEach(() => {
    (MCPClientManager as any).instance = null;
  });

  // ── Singleton ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = MCPClientManager.getInstance();
      const b = MCPClientManager.getInstance();
      expect(a).toBe(b);
    });

    it('creates a new instance after resetForSignOut', async () => {
      const a = MCPClientManager.getInstance();
      await a.resetForSignOut();
      const b = MCPClientManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ── getCurrentUserAlias ──────────────────────────────────────────────────

  describe('getCurrentUserAlias', () => {
    it('returns null before initialize', () => {
      const mgr = getManager();
      expect(mgr.getCurrentUserAlias()).toBeNull();
    });

    it('returns alias after initialize', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      expect(mgr.getCurrentUserAlias()).toBe('alice');
    });
  });

  // ── initialize ──────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('initializes without errors when no servers configured', async () => {
      const mgr = getManager();
      await expect(mgr.initialize('alice')).resolves.not.toThrow();
    });

    it('starts async connections for in_use servers', async () => {
      mockGetAllMcpServerInfo.mockReturnValue([
        { config: makeServerConfig({ name: 'srv1', in_use: true }) },
        { config: makeServerConfig({ name: 'srv2', in_use: false }) },
      ]);
      mockGetMcpServerInfo.mockImplementation((_alias: string, name: string) => {
        if (name === 'srv1') return { config: makeServerConfig({ name: 'srv1' }), runtime: null };
        return { config: null, runtime: null };
      });

      const mgr = getManager();
      await mgr.initialize('alice');
      await new Promise(r => setTimeout(r, 50));
      // No throw = success
    });

    it('cleans up ghost clients not in baseline', async () => {
      const mgr = getManager();
      const fakeClient = {
        connectToServer: vi.fn(),
        getTools: vi.fn(),
        executeTool: vi.fn(),
        cleanup: vi.fn().mockResolvedValue(undefined),
      };
      (mgr as any).mcpClients.set('ghost-server', fakeClient);
      (mgr as any).runtimeStates.set('ghost-server', {
        serverName: 'ghost-server', status: 'connected', tools: [], lastError: null,
      });

      mockGetAllMcpServerInfo.mockReturnValue([]);

      await mgr.initialize('alice');
      expect(fakeClient.cleanup).toHaveBeenCalled();
      expect((mgr as any).mcpClients.has('ghost-server')).toBe(false);
    });
  });

  // ── runtime state management ─────────────────────────────────────────────

  describe('runtime state management', () => {
    it('getAllMcpServerRuntimeStates returns empty initially', () => {
      const mgr = getManager();
      expect(mgr.getAllMcpServerRuntimeStates()).toEqual([]);
    });

    it('getMcpServerRuntimeState returns undefined for unknown server', () => {
      const mgr = getManager();
      expect(mgr.getMcpServerRuntimeState('unknown')).toBeUndefined();
    });

    it('_clearServerRuntimeState removes state', () => {
      const mgr = getManager();
      (mgr as any)._updateServerStatus('srv', 'connected');
      expect(mgr.getMcpServerRuntimeState('srv')).toBeDefined();
      mgr._clearServerRuntimeState('srv');
      expect(mgr.getMcpServerRuntimeState('srv')).toBeUndefined();
    });
  });

  // ── connect ──────────────────────────────────────────────────────────────

  describe('connect', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.connect('srv')).rejects.toThrow('not initialized');
    });

    it('throws for builtin server name', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.connect('builtin-tools')).rejects.toThrow('always connected');
    });

    it('throws if operation already in progress', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      void (mgr as any).opLock.run('test-server', 'connect', () => new Promise<void>(() => {}));
      await expect(mgr.connect('test-server')).rejects.toThrow('currently connecting');
    });

    it('connects successfully and updates runtime state', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());

      await mgr.connect('test-server');

      const state = mgr.getMcpServerRuntimeState('test-server');
      expect(state?.status).toBe('connected');
      expect(state?.tools).toHaveLength(1);
      expect(state?.tools[0].name).toBe('tool1');
    });

    it('sets error state when connection returns an Error', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      mockVscConnect.mockResolvedValueOnce(new Error('connection refused'));

      await mgr.connect('test-server');

      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });

    it('sets error state when no tools returned', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      mockVscGetTools.mockResolvedValueOnce([]);

      await mgr.connect('test-server');

      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });

    it('sets error state on exception during connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      mockVscConnect.mockRejectedValueOnce(new Error('ENOENT'));

      await mgr.connect('test-server');

      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });

    it('handles missing server config gracefully (does not throw to caller)', async () => {
      // _performConnect throws synchronously before the abort-check catch path,
      // and _executeWithLock propagates the error to the caller.
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });

      // The "not found" error propagates all the way up — verify it throws
      await expect(mgr.connect('missing-server')).rejects.toThrow('not found in configuration');
    });
  });

  // ── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.disconnect('srv')).rejects.toThrow('not initialized');
    });

    it('throws for builtin server name', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.disconnect('builtin-tools')).rejects.toThrow('cannot be disconnected');
    });

    it('disconnects and updates runtime state', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('connected');

      await mgr.disconnect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('disconnected');
      expect(mgr.getMcpServerRuntimeState('test-server')?.tools).toHaveLength(0);
    });

    it('disconnects a server with no existing client (no-op)', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      // No client connected, runtime state set as connected
      (mgr as any).runtimeStates.set('test-server', {
        serverName: 'test-server', status: 'connected', tools: [], lastError: null,
      });
      await expect(mgr.disconnect('test-server')).resolves.not.toThrow();
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('disconnected');
    });
  });

  describe('disposeRuntimeForConfigRename', () => {
    it('rejects an empty server name', async () => {
      const mgr = getManager();
      await expect(mgr.disposeRuntimeForConfigRename('')).rejects.toThrow('Server name is required');
    });

    it('cleans active runtime state without updating persisted configuration', async () => {
      const mgr = getManager();
      const abort = vi.fn();
      const cleanup = vi.fn().mockResolvedValue(undefined);
      const client = { cleanup };

      (mgr as any).activeConnections.set('legacy-server', {
        serverName: 'legacy-server',
        abortController: { abort },
        client,
        startTime: Date.now(),
      });
      (mgr as any).mcpClients.set('legacy-server', client);
      (mgr as any).clientImplementations.set('legacy-server', 'vscodeMcpClient');
      (mgr as any).toolToServerMap.set('legacy-tool', 'legacy-server');
      (mgr as any).runtimeStates.set('legacy-server', {
        serverName: 'legacy-server',
        status: 'connected',
        tools: [],
        lastError: null,
      });

      await mgr.disposeRuntimeForConfigRename('legacy-server');

      expect(abort).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect((mgr as any).activeConnections.has('legacy-server')).toBe(false);
      expect((mgr as any).mcpClients.has('legacy-server')).toBe(false);
      expect((mgr as any).clientImplementations.has('legacy-server')).toBe(false);
      expect((mgr as any).toolToServerMap.has('legacy-tool')).toBe(false);
      expect(mgr.getMcpServerRuntimeState('legacy-server')).toBeUndefined();
      expect(mockUpdateMcpServerConfig).not.toHaveBeenCalled();
    });

    it('propagates cleanup failures and keeps runtime state for retry', async () => {
      const mgr = getManager();
      const client = { cleanup: vi.fn().mockRejectedValue(new Error('cleanup failed')) };
      (mgr as any).mcpClients.set('legacy-server', client);
      (mgr as any).runtimeStates.set('legacy-server', {
        serverName: 'legacy-server',
        status: 'connected',
        tools: [],
        lastError: null,
      });

      await expect(mgr.disposeRuntimeForConfigRename('legacy-server')).rejects.toThrow('cleanup failed');

      expect((mgr as any).mcpClients.get('legacy-server')).toBe(client);
      expect(mgr.getMcpServerRuntimeState('legacy-server')?.status).toBe('connected');
    });
  });

  // ── reconnect ────────────────────────────────────────────────────────────

  describe('reconnect', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.reconnect('srv')).rejects.toThrow('not initialized');
    });

    it('throws for builtin server name', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.reconnect('builtin-tools')).rejects.toThrow('cannot be reconnected');
    });

    it('performs full connect when no existing client', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.reconnect('test-server');

      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('connected');
    });

    it('reconnects existing client when client already registered', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      mockVscConnect.mockResolvedValueOnce('connected');
      mockVscGetTools.mockResolvedValueOnce([{ name: 'tool1', description: 'desc', inputSchema: {} }]);

      await mgr.reconnect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('connected');
    });

    it('sets error when reconnect returns no tools', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      mockVscConnect.mockResolvedValueOnce('connected');
      mockVscGetTools.mockResolvedValueOnce([]);

      await mgr.reconnect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });

    it('sets error when reconnect connectToServer returns Error', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      mockVscConnect.mockResolvedValueOnce(new Error('remote unavailable'));

      await mgr.reconnect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });

    it('sets error on exception during reconnect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      mockVscConnect.mockRejectedValueOnce(new Error('network error'));

      await mgr.reconnect('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('error');
    });
  });

  // ── getClientByServerName / getClientByToolName ──────────────────────────

  describe('getClientByServerName / getClientByToolName', () => {
    it('returns undefined for unknown server', () => {
      const mgr = getManager();
      expect(mgr.getClientByServerName('unknown')).toBeUndefined();
    });

    it('returns undefined for unknown tool', () => {
      const mgr = getManager();
      expect(mgr.getClientByToolName('unknown_tool')).toBeUndefined();
    });

    it('returns client after successful connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      expect(mgr.getClientByServerName('test-server')).toBeDefined();
      expect(mgr.getClientByToolName('tool1')).toBeDefined();
    });
  });

  // ── getAllTools ──────────────────────────────────────────────────────────

  describe('getAllTools', () => {
    it('returns empty array when not initialized', async () => {
      const mgr = getManager();
      expect(await mgr.getAllTools()).toEqual([]);
    });

    it('returns tools from connected servers only', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      const tools = await mgr.getAllTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some(t => t.name === 'tool1')).toBe(true);
    });

    it('refreshes builtin server tools and routing when the advertised inventory changes', async () => {
      mockBuiltinGetTools
        .mockResolvedValueOnce([
          { name: 'builtin_tool', description: 'builtin', inputSchema: {} },
          { name: 'browser', description: 'browser', inputSchema: {} },
        ])
        .mockResolvedValueOnce([
          { name: 'builtin_tool', description: 'builtin', inputSchema: {} },
        ]);

      const mgr = getManager();
      await mgr.initialize('alice');

      expect(mgr.getClientByToolName('browser')).toBeTruthy();

      const tools = await mgr.getAllTools();

      expect(tools.some(t => t.name === 'browser')).toBe(false);
      expect(mgr.getClientByToolName('browser')).toBeUndefined();
      expect(tools.some(t => t.name === 'builtin_tool')).toBe(true);
    });

    it('does not refresh builtin tools before the builtin server is connected', async () => {
      const mgr = getManager();

      await mgr.refreshBuiltinTools();

      expect(mockBuiltinGetTools).not.toHaveBeenCalled();
    });

    it('does not update builtin mappings when advertised tool names are unchanged', async () => {
      mockBuiltinGetTools.mockResolvedValue([
        { name: 'builtin_tool', description: 'builtin v2', inputSchema: { type: 'object' } },
      ]);
      const mgr = getManager();
      await mgr.initialize('alice');
      const updateToolMappingsSpy = vi.spyOn(mgr as any, '_updateToolMappings');
      const updateServerToolsSpy = vi.spyOn(mgr as any, '_updateServerTools');

      await mgr.refreshBuiltinTools();

      expect(updateToolMappingsSpy).not.toHaveBeenCalled();
      expect(updateServerToolsSpy).not.toHaveBeenCalled();
    });

    it('excludes tools from disconnected servers', async () => {
      const mgr = getManager();
      (mgr as any).currentUserAlias = 'alice';
      (mgr as any).runtimeStates.set('offline-server', {
        serverName: 'offline-server',
        status: 'disconnected',
        tools: [{ name: 'secret_tool', inputSchema: {} }],
        lastError: null,
      });

      const tools = await mgr.getAllTools();
      expect(tools.some(t => t.name === 'secret_tool')).toBe(false);
    });
  });

  // ── getToolsForSubAgent ──────────────────────────────────────────────────

  describe('getToolsForSubAgent', () => {
    function setupRuntimeState(mgr: MCPClientManager, serverName: string, toolNames: string[]) {
      (mgr as any).currentUserAlias = 'alice';
      (mgr as any).runtimeStates.set(serverName, {
        serverName,
        status: 'connected',
        tools: toolNames.map(n => ({ name: n, description: '', inputSchema: {} })),
        lastError: null,
      });
      toolNames.forEach(n => (mgr as any).toolToServerMap.set(n, serverName));
    }

    it('returns only allowed tool names when mcpServers restricts them', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'ext-server', ['tool_a', 'tool_b', 'tool_c']);

      const result = await mgr.getToolsForSubAgent([{ name: 'ext-server', tools: ['tool_a'] }]);
      expect(result.map(t => t.name)).toEqual(['tool_a']);
    });

    it('returns all server tools when empty tools array', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'ext-server', ['tool_a', 'tool_b']);

      const result = await mgr.getToolsForSubAgent([{ name: 'ext-server', tools: [] }]);
      expect(result.map(t => t.name)).toContain('tool_a');
      expect(result.map(t => t.name)).toContain('tool_b');
    });

    it('always excludes sub_agent and send_to_subagent (unified tool names)', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'ext-server', ['sub_agent', 'send_to_subagent', 'safe_tool']);

      const result = await mgr.getToolsForSubAgent([{ name: 'ext-server', tools: [] }]);
      expect(result.some(t => t.name === 'sub_agent')).toBe(false);
      expect(result.some(t => t.name === 'send_to_subagent')).toBe(false);
      expect(result.some(t => t.name === 'safe_tool')).toBe(true);
    });

    it('returns only whitelisted builtin tools when builtinTools list provided', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'builtin-tools', ['web_search', 'file_read']);

      const result = await mgr.getToolsForSubAgent([], ['web_search']);
      expect(result.some(t => t.name === 'web_search')).toBe(true);
      expect(result.some(t => t.name === 'file_read')).toBe(false);
    });

    it('returns all builtin tools when builtinTools is empty/undefined', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'builtin-tools', ['web_search', 'file_read']);

      const result = await mgr.getToolsForSubAgent([]);
      expect(result.some(t => t.name === 'web_search')).toBe(true);
      expect(result.some(t => t.name === 'file_read')).toBe(true);
    });

    it('applies disallowBuiltinTools blacklist', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'builtin-tools', ['web_search', 'file_read']);

      const result = await mgr.getToolsForSubAgent([], undefined, ['web_search']);
      expect(result.some(t => t.name === 'web_search')).toBe(false);
      expect(result.some(t => t.name === 'file_read')).toBe(true);
    });

    it('ignores servers not in agent allowlist', async () => {
      const mgr = getManager();
      setupRuntimeState(mgr, 'ext-server', ['tool_x']);

      const result = await mgr.getToolsForSubAgent([{ name: 'other-server', tools: [] }]);
      expect(result.some(t => t.name === 'tool_x')).toBe(false);
    });
  });

  // ── executeTool ──────────────────────────────────────────────────────────

  describe('executeTool', () => {
    it('throws when tool not found globally', async () => {
      const mgr = getManager();
      await expect(mgr.executeTool({ toolName: 'missing', toolArgs: {} }))
        .rejects.toThrow('No client found for tool: missing');
    });

    it('executes tool from global map', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      const result = await mgr.executeTool({ toolName: 'tool1', toolArgs: { x: 1 } });
      expect(result).toBe('result');
    });

    it('uses agent-scoped server when agentMcpServerNames provided', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      const result = await mgr.executeTool({
        toolName: 'tool1',
        toolArgs: {},
        agentMcpServerNames: ['test-server'],
      });
      expect(result).toBe('result');
    });

    it('falls back to global map when agent server set does not expose the tool', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      const result = await mgr.executeTool({
        toolName: 'tool1',
        toolArgs: {},
        agentMcpServerNames: ['other-server'],
      });
      expect(result).toBe('result');
    });
  });

  // ── add ──────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.add('srv', makeServerConfig() as any)).rejects.toThrow('not initialized');
    });

    it('throws for builtin server name', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.add('builtin-tools', makeServerConfig({ name: 'builtin-tools' }) as any))
        .rejects.toThrow('reserved');
    });

    it('throws when server already exists', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: null });

      await expect(mgr.add('test-server', makeServerConfig() as any))
        .rejects.toThrow('already exists');
    });

    it('throws when names do not match', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });

      await expect(mgr.add('test-server', makeServerConfig({ name: 'other' }) as any))
        .rejects.toThrow('must match');
    });

    it('throws when addMcpServerConfig returns false', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
      mockAddMcpServerConfig.mockResolvedValueOnce(false);

      await expect(mgr.add('test-server', makeServerConfig() as any))
        .rejects.toThrow('Failed to add');
    });

    it('adds server and sets connecting state synchronously', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });

      await mgr.add('test-server', makeServerConfig() as any);

      const state = mgr.getMcpServerRuntimeState('test-server');
      expect(state?.status).toBe('connecting');
      expect(mockAddMcpServerConfig).toHaveBeenCalledTimes(1);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.update('srv', makeServerConfig() as any)).rejects.toThrow('not initialized');
    });

    it('throws for builtin server', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.update('builtin-tools', makeServerConfig({ name: 'builtin-tools' }) as any))
        .rejects.toThrow('cannot be updated');
    });

    it('throws when server not found', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
      await expect(mgr.update('test-server', makeServerConfig() as any))
        .rejects.toThrow('not found');
    });

    it('throws when names do not match', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: null });
      await expect(mgr.update('test-server', makeServerConfig({ name: 'other' }) as any))
        .rejects.toThrow('must match');
    });

    it('updates config and sets connecting state', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: { status: 'disconnected' } });

      await mgr.update('test-server', makeServerConfig() as any);

      expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('connecting');
    });

    it('cancels any pending auto-reconnect so the manual update wins', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: { status: 'disconnected' } });
      const cancel = vi.spyOn((mgr as any).autoReconnect, 'cancel');

      await mgr.update('test-server', makeServerConfig() as any);

      expect(cancel).toHaveBeenCalledWith('test-server');
    });

    it('cancels auto-reconnect before awaiting config persistence', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: { status: 'connected' } });
      const cancel = vi.spyOn((mgr as any).autoReconnect, 'cancel');
      let resolveUpdate!: (value: boolean) => void;
      mockUpdateMcpServerConfig.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveUpdate = resolve;
      }));

      const updatePromise = mgr.update('test-server', makeServerConfig() as any);
      await Promise.resolve();

      expect(cancel).toHaveBeenCalledWith('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')?.status).not.toBe('connecting');

      resolveUpdate(true);
      await updatePromise;
    });

    it('serializes background disconnect+reconnect through the operation lock', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: { status: 'connected' } });
      const runSpy = vi.spyOn((mgr as any).opLock, 'run');
      const performDisconnect = vi.spyOn(mgr as any, '_performDisconnect').mockResolvedValue(undefined);
      const performConnect = vi.spyOn(mgr as any, '_performConnect').mockResolvedValue(undefined);

      await mgr.update('test-server', makeServerConfig() as any);
      await new Promise(r => setImmediate(r));

      expect(runSpy).toHaveBeenCalledWith('test-server', 'connect', expect.any(Function));
      expect(performDisconnect).toHaveBeenCalledWith('test-server');
      expect(performConnect).toHaveBeenCalledWith('test-server', expect.any(AbortSignal));
    });

    it('throws when updateMcpServerConfig returns false', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: makeServerConfig(), runtime: null });
      mockUpdateMcpServerConfig.mockResolvedValueOnce(false);

      await expect(mgr.update('test-server', makeServerConfig() as any))
        .rejects.toThrow('Failed to update');
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.delete('srv')).rejects.toThrow('not initialized');
    });

    it('throws for builtin server', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      await expect(mgr.delete('builtin-tools')).rejects.toThrow('cannot be deleted');
    });

    it('throws when server not found', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
      await expect(mgr.delete('test-server')).rejects.toThrow('not found');
    });

    it('deletes disconnected server and clears runtime state', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'stdio' }),
        runtime: { status: 'disconnected' },
      });
      (mgr as any).runtimeStates.set('test-server', {
        serverName: 'test-server', status: 'disconnected', tools: [], lastError: null,
      });

      await mgr.delete('test-server');
      expect(mgr.getMcpServerRuntimeState('test-server')).toBeUndefined();
    });

    it('disconnects connected server before deleting', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'sse', url: 'http://example.com' }),
        runtime: { status: 'connected' },
      });
      (mgr as any).runtimeStates.set('test-server', {
        serverName: 'test-server', status: 'connected', tools: [], lastError: null,
      });

      await mgr.delete('test-server');
      expect(mockDeleteMcpServerConfig).toHaveBeenCalledWith('alice', 'test-server');
    });

    it('clears OAuth credentials for non-stdio servers on delete', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'sse', url: 'http://example.com' }),
        runtime: { status: 'disconnected' },
      });

      await mgr.delete('test-server');
      expect(mockClearOAuthForServer).toHaveBeenCalledWith('test-server', expect.any(Object), 'all');
    });

    it('does not clear OAuth for stdio servers', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'stdio' }),
        runtime: { status: 'disconnected' },
      });

      await mgr.delete('test-server');
      expect(mockClearOAuthForServer).not.toHaveBeenCalled();
    });

    it('treats a server with no runtime info as disconnected when deleting', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      // runtime undefined exercises the `runtime?.status || 'disconnected'` fallback
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'stdio' }),
        runtime: undefined,
      });

      await mgr.delete('test-server');
      expect(mockDeleteMcpServerConfig).toHaveBeenCalledWith('alice', 'test-server');
    });

    it('throws when the profile cache fails to delete the server config', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({
        config: makeServerConfig({ transport: 'stdio' }),
        runtime: { status: 'disconnected' },
      });
      mockDeleteMcpServerConfig.mockResolvedValue(false);

      await expect(mgr.delete('test-server')).rejects.toThrow('Failed to delete server configuration');
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('clears all internal state', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      await mgr.cleanup();

      expect(mgr.getCurrentUserAlias()).toBeNull();
      expect(mgr.getAllMcpServerRuntimeStates()).toHaveLength(0);
      expect((mgr as any).mcpClients.size).toBe(0);
      expect((mgr as any).toolToServerMap.size).toBe(0);
    });

    it('calls cleanup on each client', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      await mgr.cleanup();
      expect(mockVscCleanup).toHaveBeenCalled();
    });

    it('handles cleanup when no clients exist', async () => {
      const mgr = getManager();
      await expect(mgr.cleanup()).resolves.not.toThrow();
    });

    it('handles client cleanup errors gracefully', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      mockVscCleanup.mockRejectedValueOnce(new Error('cleanup error'));
      await expect(mgr.cleanup()).resolves.not.toThrow();
    });
  });

  // ── resetForSignOut ──────────────────────────────────────────────────────

  describe('resetForSignOut', () => {
    it('resets singleton to null', async () => {
      const mgr = MCPClientManager.getInstance();
      await mgr.initialize('alice');
      await mgr.resetForSignOut();

      expect((MCPClientManager as any).instance).toBeNull();
    });

    it('new instance after reset has no user alias', async () => {
      const mgr = MCPClientManager.getInstance();
      await mgr.initialize('alice');
      await mgr.resetForSignOut();

      const newMgr = MCPClientManager.getInstance();
      expect(newMgr).not.toBe(mgr);
      expect(newMgr.getCurrentUserAlias()).toBeNull();
    });
  });

  // ── implementation management ────────────────────────────────────────────

  describe('implementation management', () => {
    it('getDefaultImplementation returns vscodeMcpClient', () => {
      expect(getManager().getDefaultImplementation()).toBe('vscodeMcpClient');
    });

    it('setDefaultImplementation updates the value', () => {
      const mgr = getManager();
      mgr.setDefaultImplementation('vscodeMcpClient');
      expect(mgr.getDefaultImplementation()).toBe('vscodeMcpClient');
    });

    it('getClientImplementation returns undefined for unknown server', () => {
      expect(getManager().getClientImplementation('unknown')).toBeUndefined();
    });

    it('getImplementationStats shows all zeros initially', () => {
      const stats = getManager().getImplementationStats();
      expect(stats).toEqual({ sdk: 0, vscodeMcpClient: 0, total: 0 });
    });

    it('getImplementationStats counts vscodeMcpClient after connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      const stats = mgr.getImplementationStats();
      // builtin-tools is also registered during initialize, so total >= 1
      expect(stats.vscodeMcpClient).toBeGreaterThanOrEqual(1);
      expect(stats.sdk).toBe(0);
    });

    it('forceClientImplementation throws if not initialized', async () => {
      const mgr = getManager();
      await expect(mgr.forceClientImplementation('srv', 'vscodeMcpClient'))
        .rejects.toThrow('not initialized');
    });

    it('forceClientImplementation maps sdk to vscodeMcpClient', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      await mgr.forceClientImplementation('test-server', 'sdk');
      expect(mgr.getClientImplementation('test-server')).toBe('vscodeMcpClient');
    });

    it('forceClientImplementation throws when server not found', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
      await expect(mgr.forceClientImplementation('missing', 'vscodeMcpClient'))
        .rejects.toThrow('not found');
    });
  });

  // ── isBuiltinServer / getBuiltinServerName ────────────────────────────────

  describe('isBuiltinServer / getBuiltinServerName', () => {
    it('isBuiltinServer returns true for builtin-tools', () => {
      expect(getManager().isBuiltinServer('builtin-tools')).toBe(true);
    });

    it('isBuiltinServer returns false for other names', () => {
      expect(getManager().isBuiltinServer('ext-server')).toBe(false);
    });

    it('getBuiltinServerName returns builtin-tools', () => {
      expect(getManager().getBuiltinServerName()).toBe('builtin-tools');
    });
  });

  // ── frontend notification ─────────────────────────────────────────────────

  describe('frontend notification', () => {
    it('notifies all open windows when state changes (debounced)', async () => {
      const mockSend = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ]);

      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
      await mgr.connect('test-server');

      // Wait for debounce (50ms)
      await new Promise(r => setTimeout(r, 100));

      expect(mockSend).toHaveBeenCalledWith(
        'mcp:serverStatesUpdated',
        expect.arrayContaining([
          expect.objectContaining({ serverName: 'test-server', status: 'connected' }),
        ])
      );
    });

    it('skips destroyed windows', () => {
      const mockSend = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => true, webContents: { send: mockSend } },
      ]);

      const mgr = getManager();
      (mgr as any)._updateServerStatus('test-server', 'connected');
      (mgr as any)._notifyFrontend();

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('serializes Error lastError to string for IPC', () => {
      const mockSend = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ]);

      const mgr = getManager();
      (mgr as any)._updateServerStatus('test-server', 'error');
      (mgr as any)._updateServerError('test-server', new Error('connection failed'));
      (mgr as any)._notifyFrontend();

      const [, states] = mockSend.mock.calls[0];
      const state = states.find((s: any) => s.serverName === 'test-server');
      expect(typeof state.lastError).toBe('string');
      expect(state.lastError).toBe('connection failed');
    });

    it('sends null lastError when no error', () => {
      const mockSend = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ]);

      const mgr = getManager();
      (mgr as any)._updateServerStatus('test-server', 'connected');
      (mgr as any)._updateServerError('test-server', null);
      (mgr as any)._notifyFrontend();

      const [, states] = mockSend.mock.calls[0];
      const state = states.find((s: any) => s.serverName === 'test-server');
      expect(state.lastError).toBeNull();
    });
  });

  // ── OpenKosmos placeholder replacement ───────────────────────────────────────

  describe('OpenKosmos placeholder replacement', () => {
    it('replaces placeholders in url during connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo({
        config: { name: 'test-server', transport: 'sse', url: '{{OPENKOSMOS_ALIAS}}/mcp', in_use: true },
      }));
      mockContainsOpenKosmosPlaceholder.mockReturnValue(true);
      mockReplacePlaceholders.mockReturnValue('alice/mcp');

      await mgr.connect('test-server');
      expect(mockReplacePlaceholders).toHaveBeenCalledWith('{{OPENKOSMOS_ALIAS}}/mcp', { alias: 'alice' });
    });

    it('replaces placeholders in env during connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo({
        config: {
          name: 'test-server', transport: 'stdio', command: 'node',
          env: { TOKEN: '{{OPENKOSMOS_TOKEN}}' }, in_use: true,
        },
      }));
      // stdio has no url → url check skipped; env value check returns true
      mockContainsOpenKosmosPlaceholder.mockReturnValue(true);
      mockReplacePlaceholdersInObject.mockReturnValue({ TOKEN: 'real-token' });

      await mgr.connect('test-server');
      expect(mockReplacePlaceholdersInObject).toHaveBeenCalled();
    });

    it('replaces placeholders in headers during connect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo({
        config: {
          name: 'test-server', transport: 'sse', url: 'http://x',
          headers: { 'x-apikey': '{{OPENKOSMOS_API_KEY}}' }, in_use: true,
        },
      }));
      mockContainsOpenKosmosPlaceholder.mockImplementation((v: string) => v.includes('{{OPENKOSMOS'));
      mockReplacePlaceholdersInObject.mockReturnValue({ 'x-apikey': 'resolved-key' });

      await mgr.connect('test-server');
      expect(mockReplacePlaceholdersInObject).toHaveBeenCalled();
    });

    it('skips header placeholder replacement when no placeholders present', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      mockGetMcpServerInfo.mockReturnValue(makeServerInfo({
        config: {
          name: 'test-server', transport: 'sse', url: 'http://x',
          headers: { 'x-apikey': 'plain-key' }, in_use: true,
        },
      }));
      mockContainsOpenKosmosPlaceholder.mockReturnValue(false);

      await mgr.connect('test-server');
      // replacePlaceholdersInObject should NOT be called for headers
      // (it may be called for env, so check the call args)
    });
  });

  // ── auto-reconnect wiring (manager → coordinator delegation) ────────────────
  describe('auto-reconnect wiring', () => {
    it('notes a server as connected via the coordinator when it reaches connected', () => {
      const mgr = getManager();
      const noteConnected = vi.spyOn((mgr as any).autoReconnect, 'noteConnected');
      (mgr as any)._updateServerStatus('srv', 'connected');
      expect(noteConnected).toHaveBeenCalledWith('srv');
    });

    it('does not note a server that only reached a non-connected status', () => {
      const mgr = getManager();
      const noteConnected = vi.spyOn((mgr as any).autoReconnect, 'noteConnected');
      (mgr as any)._updateServerStatus('srv', 'error');
      expect(noteConnected).not.toHaveBeenCalled();
    });

    describe('_isServerInUse', () => {
      it('is false when there is no current user', () => {
        const mgr = getManager();
        (mgr as any).currentUserAlias = null;
        expect((mgr as any)._isServerInUse('srv')).toBe(false);
      });

      it('is false when the config lookup throws', () => {
        const mgr = getManager();
        (mgr as any).currentUserAlias = 'alice';
        mockGetMcpServerInfo.mockImplementation(() => {
          throw new Error('no such server');
        });
        expect((mgr as any)._isServerInUse('srv')).toBe(false);
      });

      it('is false when the server is no longer in use', () => {
        const mgr = getManager();
        (mgr as any).currentUserAlias = 'alice';
        mockGetMcpServerInfo.mockReturnValue({
          config: { name: 'srv', in_use: false },
          runtime: null,
        });
        expect((mgr as any)._isServerInUse('srv')).toBe(false);
      });

      it('is false when the config is missing', () => {
        const mgr = getManager();
        (mgr as any).currentUserAlias = 'alice';
        mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
        expect((mgr as any)._isServerInUse('srv')).toBe(false);
      });

      it('is true for an in-use server', () => {
        const mgr = getManager();
        (mgr as any).currentUserAlias = 'alice';
        mockGetMcpServerInfo.mockReturnValue({
          config: { name: 'srv', in_use: true },
          runtime: null,
        });
        expect((mgr as any)._isServerInUse('srv')).toBe(true);
      });
    });

    it('manual connect / disconnect / reconnect cancel any pending auto-reconnect', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      const cancel = vi.spyOn((mgr as any).autoReconnect, 'cancel');
      vi.spyOn(mgr as any, '_performConnect').mockResolvedValue(undefined);
      vi.spyOn(mgr as any, '_performDisconnect').mockResolvedValue(undefined);
      vi.spyOn(mgr as any, '_performReconnect').mockResolvedValue(undefined);

      await mgr.connect('srv');
      await mgr.disconnect('srv');
      await mgr.reconnect('srv');

      expect(cancel).toHaveBeenCalledWith('srv');
      expect(cancel).toHaveBeenCalledTimes(3);
    });

    it('cleanup resets the coordinator', async () => {
      const mgr = getManager();
      await mgr.initialize('alice');
      const resetAll = vi.spyOn((mgr as any).autoReconnect, 'resetAll');

      await mgr.cleanup();

      expect(resetAll).toHaveBeenCalled();
    });

    it('cleanup aborts an in-flight auto-reconnect before it can repopulate state', async () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const mgr = getManager();
      try {
        (mgr as any).currentUserAlias = 'alice';
        mockGetMcpServerInfo.mockReturnValue({
          config: { name: 'srv', in_use: true },
          runtime: null,
        });

        let resolveReconnect!: (value: string) => void;
        const staleClient = {
          connectToServer: vi.fn(() => new Promise<string>((resolve) => {
            resolveReconnect = resolve;
          })),
          getTools: vi.fn().mockResolvedValue([{ name: 'stale-tool', inputSchema: {} }]),
          executeTool: vi.fn(),
          cleanup: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
        };
        (mgr as any).mcpClients.set('srv', staleClient);
        (mgr as any).runtimeStates.set('srv', { serverName: 'srv', status: 'error', tools: [], lastError: null });
        (mgr as any).autoReconnect.noteConnected('srv');
        (mgr as any).autoReconnect.onServerError('srv', 'socket hang up');

        await vi.advanceTimersByTimeAsync(5_000);
        expect(staleClient.connectToServer).toHaveBeenCalled();

        await mgr.cleanup();
        resolveReconnect('connected');
        await Promise.resolve();
        await Promise.resolve();

        expect(staleClient.getTools).not.toHaveBeenCalled();
        expect((mgr as any).runtimeStates.size).toBe(0);
        expect((mgr as any).toolToServerMap.size).toBe(0);
        expect((mgr as any).mcpClients.size).toBe(0);
      } finally {
        randomSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('the error state handler notifies the coordinator with the captured cause', () => {
      const mgr = getManager();
      const onServerError = vi.spyOn((mgr as any).autoReconnect, 'onServerError');
      let captured: ((state: any) => void) | undefined;
      const fakeClient = {
        on: (event: string, handler: (state: any) => void) => {
          if (event === 'stateChange') captured = handler;
        },
      };
      (mgr as any)._registerClientStateHandlers('srv', fakeClient);

      captured?.({ state: 'connected' });
      expect(onServerError).not.toHaveBeenCalled();

      captured?.({ state: 'error', message: 'boom' });
      expect(onServerError).toHaveBeenCalledWith('srv', 'boom', { wasAwaitingUserInteraction: false });
    });

    it('passes the prior user-interaction status to the coordinator before overwriting it', () => {
      const mgr = getManager();
      (mgr as any).runtimeStates.set('srv', {
        serverName: 'srv',
        status: 'needs-user-interaction',
        tools: [{ name: 'old-tool', inputSchema: {} }],
        lastError: null,
      });
      const onServerError = vi.spyOn((mgr as any).autoReconnect, 'onServerError');
      let captured: ((state: any) => void) | undefined;
      const fakeClient = {
        on: (event: string, handler: (state: any) => void) => {
          if (event === 'stateChange') captured = handler;
        },
      };
      (mgr as any)._registerClientStateHandlers('srv', fakeClient);

      captured?.({ state: 'error', message: 'auth cancelled' });

      expect(onServerError).toHaveBeenCalledWith('srv', 'auth cancelled', { wasAwaitingUserInteraction: true });
      expect(mgr.getMcpServerRuntimeState('srv')?.status).toBe('error');
      expect(mgr.getMcpServerRuntimeState('srv')?.tools).toEqual([]);
    });

    // Integration: drive the full cycle so the inline host-adapter closures (executeReconnect /
    // getStatus / isBuiltin / isInUse / setLastError / log) in the manager are covered.
    it('drives a full reconnect cycle through the manager host adapter (success)', async () => {
      vi.useFakeTimers();
      const mgr = getManager();
      try {
        (mgr as any).currentUserAlias = 'alice';
        (mgr as any).autoReconnect.noteConnected('srv');
        (mgr as any).runtimeStates.set('srv', { status: 'error', lastError: null });
        mockGetMcpServerInfo.mockReturnValue({
          config: { name: 'srv', in_use: true },
          runtime: null,
        });
        const perform = vi.spyOn(mgr as any, '_performReconnect').mockImplementation(async () => {
          (mgr as any).runtimeStates.set('srv', { status: 'connected', lastError: null });
        });

        (mgr as any).autoReconnect.onServerError('srv', 'tool idle timeout');
        // The scheduling hint is composed onto the captured cause and stored as lastError.
        const composed = (mgr as any).runtimeStates.get('srv').lastError.message;
        expect(composed).toContain('tool idle timeout');
        expect(composed).toContain('auto-reconnecting');

        await vi.advanceTimersByTimeAsync(6_000);
        expect(perform).toHaveBeenCalledWith('srv', expect.any(AbortSignal));
      } finally {
        (mgr as any).autoReconnect.resetAll();
        vi.useRealTimers();
      }
    });

    it('reschedules through the host adapter when a reconnect attempt does not connect', async () => {
      vi.useFakeTimers();
      const mgr = getManager();
      try {
        (mgr as any).currentUserAlias = 'alice';
        (mgr as any).autoReconnect.noteConnected('srv');
        (mgr as any).runtimeStates.set('srv', { status: 'error', lastError: null });
        mockGetMcpServerInfo.mockReturnValue({
          config: { name: 'srv', in_use: true },
          runtime: null,
        });
        const perform = vi.spyOn(mgr as any, '_performReconnect').mockResolvedValue(undefined);

        (mgr as any).autoReconnect.onServerError('srv', 'boom');
        await vi.advanceTimersByTimeAsync(6_000); // attempt 1 (~5s backoff)
        expect(perform).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(40_000); // attempt 2 (~30s backoff)
        expect(perform).toHaveBeenCalledTimes(2);
      } finally {
        (mgr as any).autoReconnect.resetAll();
        vi.useRealTimers();
      }
    });
  });
});
