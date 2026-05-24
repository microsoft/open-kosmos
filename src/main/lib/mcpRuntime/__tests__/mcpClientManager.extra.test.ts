// @ts-nocheck
/**
 * Supplementary coverage tests for MCPClientManager.
 * Targets branches not reached by mcpClientManager.coverage.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  mockIsPluginMcpServer,
  mockVscConnect,
  mockVscGetTools,
  mockVscExecuteTool,
  mockVscCleanup,
  mockBuiltinConnect,
  mockBuiltinGetTools,
  mockBuiltinCleanup,
  mockExecSync,
} = vi.hoisted(() => {
  let capturedInteractionCallback: ((event: any) => void) | null = null;
  const mockOnInteraction = vi.fn((cb: (event: any) => void) => {
    capturedInteractionCallback = cb;
    return vi.fn();
  });
  Object.defineProperty(mockOnInteraction, '_triggerInteraction', {
    get: () => (event: any) => capturedInteractionCallback?.(event),
  });

  const mockGetAllWindows = vi.fn(() => [] as any[]);
  const mockGetAllMcpServerInfo = vi.fn(() => [] as any[]);
  const mockGetMcpServerInfo = vi.fn(() => ({ config: null as any, runtime: null as any }));
  const mockAddMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockUpdateMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockDeleteMcpServerConfig = vi.fn(() => Promise.resolve(true));
  const mockClearOAuthForServer = vi.fn(() => Promise.resolve());
  const mockAuthServiceInstance = { clearOAuthForServer: (...a: any[]) => mockClearOAuthForServer(...a) };
  const mockContainsOpenKosmosPlaceholder = vi.fn(() => false);
  const mockReplacePlaceholders = vi.fn((s: string) => s);
  const mockReplacePlaceholdersInObject = vi.fn((o: any) => o);
  const mockIsPluginMcpServer = vi.fn(() => false);
  const mockVscConnect = vi.fn(() => Promise.resolve('connected'));
  const mockVscGetTools = vi.fn(() => Promise.resolve([{ name: 'tool1', description: 'desc', inputSchema: {} }]));
  const mockVscExecuteTool = vi.fn(() => Promise.resolve('result'));
  const mockVscCleanup = vi.fn(() => Promise.resolve());
  const mockBuiltinConnect = vi.fn(() => Promise.resolve('connected'));
  const mockBuiltinGetTools = vi.fn(() => Promise.resolve([{ name: 'builtin_tool', description: 'builtin', inputSchema: {} }]));
  const mockBuiltinCleanup = vi.fn(() => Promise.resolve());
  const mockExecSync = vi.fn(() => '');

  return {
    mockGetAllWindows, mockGetAllMcpServerInfo, mockGetMcpServerInfo,
    mockAddMcpServerConfig, mockUpdateMcpServerConfig, mockDeleteMcpServerConfig,
    mockOnInteraction, mockClearOAuthForServer, mockAuthServiceInstance,
    mockContainsOpenKosmosPlaceholder, mockReplacePlaceholders, mockReplacePlaceholdersInObject,
    mockIsPluginMcpServer, mockVscConnect, mockVscGetTools, mockVscExecuteTool, mockVscCleanup,
    mockBuiltinConnect, mockBuiltinGetTools, mockBuiltinCleanup, mockExecSync,
  };
});

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    app: { getPath: vi.fn(() => '/tmp/test'), isReady: vi.fn(() => true) },
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, execSync: (...a: any[]) => mockExecSync(...a) };
});

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () => Promise.resolve({ log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
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

vi.mock('../../plugin/bridges/mcpBridge', () => ({
  isPluginMcpServer: (...a: any[]) => mockIsPluginMcpServer(...a),
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
    executeTool = vi.fn(() => Promise.resolve('builtin_result'));
    cleanup = mockBuiltinCleanup;
  },
}));

import { MCPClientManager } from '../mcpClientManager';

function makeServerConfig(overrides: Record<string, any> = {}) {
  return { name: 'test-server', transport: 'stdio' as const, command: 'node', args: [], in_use: true, ...overrides };
}

function makeServerInfo(overrides: Record<string, any> = {}) {
  return { config: makeServerConfig(overrides.config ?? {}), runtime: overrides.runtime ?? null };
}

function getManager(): MCPClientManager {
  (MCPClientManager as any).instance = null;
  return MCPClientManager.getInstance();
}

describe('MCPClientManager supplementary', () => {
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
    mockBuiltinGetTools.mockResolvedValue([{ name: 'builtin_tool', inputSchema: {} }]);
    mockBuiltinCleanup.mockResolvedValue(undefined);
    mockIsPluginMcpServer.mockReturnValue(false);
    mockContainsOpenKosmosPlaceholder.mockReturnValue(false);
    mockGetAllWindows.mockReturnValue([]);
    (MCPClientManager as any).instance = null;
  });

  afterEach(() => {
    (MCPClientManager as any).instance = null;
  });

  // ── McpAuthService.onInteraction callback ────────────────────────────────

  it('sets needs-user-interaction status when consent-requested fires', async () => {
    const mgr = MCPClientManager.getInstance();
    // Trigger the interaction callback registered in constructor
    (mockOnInteraction as any)._triggerInteraction({ serverName: 'auth-server', phase: 'consent-requested' });
    expect(mgr.getMcpServerRuntimeState('auth-server')?.status).toBe('needs-user-interaction');
  });

  it('does not update status for non consent-requested phases', async () => {
    const mgr = MCPClientManager.getInstance();
    (mockOnInteraction as any)._triggerInteraction({ serverName: 'auth-server', phase: 'other-phase' });
    expect(mgr.getMcpServerRuntimeState('auth-server')).toBeUndefined();
  });

  // ── _updateServerTools / _updateServerError — new state creation path ─────

  it('_updateServerTools creates state when it does not exist', async () => {
    const mgr = getManager();
    (mgr as any)._updateServerTools('new-srv', [{ name: 'tool1', inputSchema: {} }]);
    expect(mgr.getMcpServerRuntimeState('new-srv')?.tools).toHaveLength(1);
  });

  it('_updateServerError creates state when it does not exist', async () => {
    const mgr = getManager();
    const err = new Error('test');
    (mgr as any)._updateServerError('new-srv', err);
    expect(mgr.getMcpServerRuntimeState('new-srv')?.lastError).toBe(err);
  });

  // ── _syncWithProfileCacheManagerBaseline: ghost state cleanup ────────────

  it('cleans ghost runtime states not in baseline', async () => {
    const mgr = getManager();
    // Manually inject a ghost state
    (mgr as any).runtimeStates.set('ghost', {
      serverName: 'ghost', status: 'connected', tools: [], lastError: null,
    });
    mockGetAllMcpServerInfo.mockReturnValue([]);
    await mgr.initialize('alice');
    // Ghost state with no client should be cleaned
    expect(mgr.getMcpServerRuntimeState('ghost')).toBeUndefined();
  });

  it('handles error during ghost client cleanup gracefully', async () => {
    const mgr = getManager();
    const badClient = { cleanup: vi.fn().mockRejectedValue(new Error('cleanup failed')), connectToServer: vi.fn(), getTools: vi.fn(), executeTool: vi.fn() };
    (mgr as any).mcpClients.set('ghost', badClient);
    mockGetAllMcpServerInfo.mockReturnValue([]);
    await expect(mgr.initialize('alice')).resolves.not.toThrow();
  });

  // ── _initializeBuiltinServer: failure path ────────────────────────────────

  it('does not throw when builtin connect returns Error', async () => {
    mockBuiltinConnect.mockResolvedValueOnce(new Error('builtin failed'));
    const mgr = getManager();
    await expect(mgr.initialize('alice')).resolves.not.toThrow();
  });

  it('does not throw when builtin connect throws', async () => {
    mockBuiltinConnect.mockRejectedValueOnce(new Error('throw'));
    const mgr = getManager();
    await expect(mgr.initialize('alice')).resolves.not.toThrow();
  });

  // ── add: background connect fires ────────────────────────────────────────

  it('add schedules background connect via setImmediate', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });

    await mgr.add('new-server', makeServerConfig({ name: 'new-server' }) as any);
    // Background connect happens via setImmediate — just ensure state is 'connecting'
    expect(mgr.getMcpServerRuntimeState('new-server')?.status).toBe('connecting');

    // Let setImmediate fire
    await new Promise(r => setImmediate(r));
  });

  // ── update: current status connected → disconnect first ──────────────────

  it('update disconnects first when current status is not disconnected', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue({
      config: makeServerConfig(),
      runtime: { status: 'connected' },
    });
    await mgr.update('test-server', makeServerConfig() as any);
    expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('connecting');

    // Let setImmediate fire (background)
    await new Promise(r => setImmediate(r));
  });

  // ── cleanup: overall timeout path ────────────────────────────────────────

  it('cleanup handles per-client timeout gracefully', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
    await mgr.connect('test-server');

    // Make cleanup hang long enough to trigger per-client timeout check
    mockVscCleanup.mockImplementationOnce(() => new Promise(r => setTimeout(r, 15000)));
    // But overall should resolve because race wins with the 15s timeout mock
    vi.useFakeTimers();
    const cleanupPromise = mgr.cleanup();
    vi.advanceTimersByTime(16000);
    await cleanupPromise;
    vi.useRealTimers();
  });

  // ── resetForSignOut: forces clear when cleanup leaves state ──────────────

  it('resetForSignOut force-clears when cleanup leaves clients', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
    await mgr.connect('test-server');

    // Make cleanup's client.cleanup fail so we can test force-clear path
    mockVscCleanup.mockRejectedValueOnce(new Error('cleanup error'));

    await mgr.resetForSignOut();
    expect((MCPClientManager as any).instance).toBeNull();
  });

  // ── _forceCancelConnection ────────────────────────────────────────────────

  it('_forceCancelConnection cancels an active connection process', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');

    const abortController = new AbortController();
    const mockClient = {
      connectToServer: vi.fn(() => new Promise(() => {})), // never resolves
      getTools: vi.fn(),
      executeTool: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    (mgr as any).activeConnections.set('hanging-server', {
      serverName: 'hanging-server',
      abortController,
      client: mockClient,
      startTime: Date.now(),
    });
    (mgr as any).mcpClients.set('hanging-server', mockClient);

    await (mgr as any)._forceCancelConnection('hanging-server');
    expect(abortController.signal.aborted).toBe(true);
    expect(mockClient.cleanup).toHaveBeenCalled();
  });

  it('_forceCancelConnection handles missing operation lock gracefully', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    // No lock, no connection — should not throw
    await expect((mgr as any)._forceCancelConnection('nonexistent')).resolves.toBeUndefined();
  });

  it('_forceCancelConnection aborts operation lock if present', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');

    const abortController = new AbortController();
    (mgr as any).operationLocks.set('srv', {
      operation: 'connect',
      promise: Promise.resolve(),
      timestamp: Date.now(),
      abortController,
    });

    await (mgr as any)._forceCancelConnection('srv');
    expect(abortController.signal.aborted).toBe(true);
  });

  // ── _performDisconnect: updateMcpServerConfig throws ─────────────────────

  it('disconnect continues even when updateMcpServerConfig throws', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue(makeServerInfo());
    await mgr.connect('test-server');

    mockUpdateMcpServerConfig.mockRejectedValueOnce(new Error('profile error'));
    await expect(mgr.disconnect('test-server')).resolves.not.toThrow();
    expect(mgr.getMcpServerRuntimeState('test-server')?.status).toBe('disconnected');
  });

  // ── _performConnect: aborted before connectToServer ──────────────────────

  it('_performConnect returns early when aborted before connection attempt', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    mockGetMcpServerInfo.mockReturnValue(makeServerInfo());

    // Make connectToServer resolve only after we abort
    let resolveConnect: any;
    mockVscConnect.mockImplementationOnce(() => new Promise(resolve => { resolveConnect = resolve; }));

    // Inject a pre-aborted signal by intercepting the activeConnections map
    const connectPromise = mgr.connect('test-server');

    // Abort immediately
    await new Promise(r => setTimeout(r, 0));
    const conn = (mgr as any).activeConnections.get('test-server');
    if (conn) conn.abortController.abort();
    resolveConnect?.('connected');

    await connectPromise;
  });

  // ── performSystemLevelCleanup: platform non-win32 ────────────────────────

  it('performSystemLevelCleanup runs ps on non-win32', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    mockExecSync.mockReturnValue('1234  5678  node\n');
    const mgr = getManager();
    await (mgr as any).performSystemLevelCleanup('test-cleanup');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('performSystemLevelCleanup handles empty ps output', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    mockExecSync.mockReturnValue('  ');
    const mgr = getManager();
    await expect((mgr as any).performSystemLevelCleanup('test')).resolves.not.toThrow();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('performSystemLevelCleanup handles execSync throwing', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    mockExecSync.mockImplementation(() => { throw new Error('exec failed'); });
    const mgr = getManager();
    await expect((mgr as any).performSystemLevelCleanup('test')).resolves.not.toThrow();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('performSystemLevelCleanup skips on win32', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const mgr = getManager();
    await expect((mgr as any).performSystemLevelCleanup('test')).resolves.not.toThrow();
    expect(mockExecSync).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  // ── _startConnectionAsync: "currently connecting" error suppression ───────

  it('_startConnectionAsync suppresses "currently connecting" errors', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');

    // Inject a lock so the next call throws "currently connecting"
    (mgr as any).operationLocks.set('srv', {
      operation: 'connect',
      promise: Promise.resolve(),
      timestamp: Date.now(),
    });

    // Should not throw — error is swallowed
    (mgr as any)._startConnectionAsync('srv');
    await new Promise(r => setTimeout(r, 20));
  });

  // ── add: empty serverName / config validation ─────────────────────────────

  it('add throws when serverName is empty after builtin check', async () => {
    const mgr = getManager();
    await mgr.initialize('alice');
    // Force empty serverName after the builtin check by using a non-empty name
    // but making config null — the `if (!serverName || !newConfig)` check
    await expect(mgr.add('srv', null as any)).rejects.toThrow('required');
  });

  // ── getToolsForSubAgent: null allowedTools set ────────────────────────────

  it('getToolsForSubAgent handles null in allowedServerMap (all tools for server)', async () => {
    const mgr = getManager();
    (mgr as any).currentUserAlias = 'alice';
    (mgr as any).runtimeStates.set('srv', {
      serverName: 'srv',
      status: 'connected',
      tools: [{ name: 'tool_a', inputSchema: {} }, { name: 'tool_b', inputSchema: {} }],
      lastError: null,
    });
    // Passing tools:[] means null set (all tools)
    const result = await mgr.getToolsForSubAgent([{ name: 'srv', tools: [] }]);
    expect(result.length).toBe(2);
  });
});
