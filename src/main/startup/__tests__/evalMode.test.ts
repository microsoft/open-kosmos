import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any import so vi.mock hoisting can replace modules
// ---------------------------------------------------------------------------

const mockApp = {
  quit: vi.fn(),
  getPath: vi.fn(() => '/tmp/test'),
  on: vi.fn(),
};

vi.mock('electron', () => ({
  app: mockApp,
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: vi.fn(),
}));

const mockProfileCacheManager = {};
const mockGetProfileCacheManager = vi.fn().mockResolvedValue(mockProfileCacheManager);

vi.mock('../lazy', () => ({
  getProfileCacheManager: mockGetProfileCacheManager,
  getMainAuthManager: vi.fn(),
  getAppCacheManager: vi.fn(),
  getMainTokenMonitor: vi.fn(),
  getAdvancedLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
  useAdvancedLogger: vi.fn(),
  useRemoteChannelManager: vi.fn(),
  getProfileCacheManagerSync: vi.fn(() => null),
}));

const mockAgentChatManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../lib/chat/agentChatManager', () => ({
  agentChatManager: mockAgentChatManager,
}));

const mockMcpClientManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: mockMcpClientManager,
}));

// Shared mock HTTP server instance — tests can configure it per-case
const mockServer = {
  start: vi.fn().mockResolvedValue(undefined),
  getPort: vi.fn(() => 3000),
};

vi.mock('../../lib/evalHarness/evalHttpServer', () => {
  // Must use a real function (not arrow) so `new EvalHttpServer(...)` works.
  const EvalHttpServer = function (this: unknown) {
    return mockServer;
  };
  return { EvalHttpServer };
});

// fs is used by loadDotenvSync
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false), // no .env.local file by default
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthManager(opts: {
  validAuths?: object[];
  expiredAuths?: object[];
  currentAuth?: object | null;
}) {
  const {
    validAuths = [],
    expiredAuths = [],
    currentAuth = null,
  } = opts;

  return {
    getValidAuthsForSignin: vi.fn().mockResolvedValue({ validAuths, expiredAuths }),
    setCurrentAuth: vi.fn().mockResolvedValue(undefined),
    getCurrentAuth: vi.fn(() => currentAuth),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startEvalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('quits app when no valid auth sessions are found', async () => {
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({ validAuths: [], expiredAuths: [] }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockApp.quit).toHaveBeenCalledOnce();
    expect(mockAgentChatManager.initialize).not.toHaveBeenCalled();
  });

  it('mentions expired sessions in the log when no valid but expired auths exist', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({ validAuths: [], expiredAuths: [{ token: 'old' }] }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockApp.quit).toHaveBeenCalledOnce();
    const calls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('expired');
    consoleErrorSpy.mockRestore();
  });

  it('quits app when setCurrentAuth succeeds but getCurrentAuth returns null', async () => {
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: null,
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockApp.quit).toHaveBeenCalledOnce();
    expect(mockAgentChatManager.initialize).not.toHaveBeenCalled();
  });

  it('quits app when auth has no user alias', async () => {
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias: undefined } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockApp.quit).toHaveBeenCalledOnce();
  });

  it('initializes AgentChatManager and MCPClientManager on happy path, then starts HTTP server', async () => {
    const alias = 'testuser';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockAgentChatManager.initialize).toHaveBeenCalledWith(alias);
    expect(mockMcpClientManager.initialize).toHaveBeenCalledWith(alias);
    expect(mockServer.start).toHaveBeenCalledOnce();
    expect(mockApp.quit).not.toHaveBeenCalled();
  });

  it('continues without quitting even when MCPClientManager init throws', async () => {
    const alias = 'testuser';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );
    mockMcpClientManager.initialize.mockRejectedValueOnce(new Error('mcp-failure'));

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    // Should still start the HTTP server despite MCP failure
    expect(mockServer.start).toHaveBeenCalledOnce();
    expect(mockApp.quit).not.toHaveBeenCalled();
  });

  it('calls app.quit if an unexpected top-level error is thrown', async () => {
    const { getProfileCacheManager } = await import('../lazy');
    vi.mocked(getProfileCacheManager).mockRejectedValueOnce(new Error('unexpected'));

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockApp.quit).toHaveBeenCalledOnce();
  });

  it('initializes ProfileCacheManager on every call', async () => {
    const alias = 'user2';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    expect(mockGetProfileCacheManager).toHaveBeenCalled();
  });

  it('skips dotenv loading when no .env.local file exists', async () => {
    // existsSync is already mocked to return false (default)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const alias = 'user3';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    // Should not log "Loaded .env.local from:" message
    const calls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(calls).not.toContain('Loaded .env.local from:');
    consoleErrorSpy.mockRestore();
  });

  it('logs dotenv loading when a .env.local file exists', async () => {
    // Override existsSync to return true so loadDotenvSync finds the file
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const alias = 'user_env';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    const calls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Loaded .env.local from:');
    consoleErrorSpy.mockRestore();
  });

  it('logs the HTTP server port after successful startup', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const alias = 'portloguser';
    const { getMainAuthManager } = await import('../lazy');
    vi.mocked(getMainAuthManager).mockResolvedValue(
      makeAuthManager({
        validAuths: [{ token: 'tok' }],
        currentAuth: { ghcAuth: { alias } },
      }) as any,
    );

    const { startEvalMode } = await import('../evalMode');
    await startEvalMode();

    const calls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('3000');
    consoleErrorSpy.mockRestore();
  });
});
