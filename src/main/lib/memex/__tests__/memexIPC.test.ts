const mockEnableHandler = vi.fn();
const mockDisableHandler = vi.fn();
const mockGetStatusHandler = vi.fn();
const mockIsFeatureEnabled = vi.fn();

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/tmp/userData'),
  },
  ipcMain: {},
}));

vi.mock('@shared/ipc/memex', async () => ({
  renderToMain: {
    bindMain: vi.fn(() => ({
      enable: mockEnableHandler,
      disable: mockDisableHandler,
      getStatus: mockGetStatusHandler,
    })),
  },
}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('../MemexManager', async () => ({ MemexManager: vi.fn() }));
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({ mcpClientManager: {} }));

describe('memexIPC feature gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not initialize memex when the feature flag is disabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);

    const { setupMemex } = await import('../memexIPC');

    const manager = setupMemex(
      { currentUserAlias: 'alice', mainWindow: null },
      async () => ({})
    );

    expect(manager).toBeUndefined();
    expect(mockEnableHandler).not.toHaveBeenCalled();
    expect(mockDisableHandler).not.toHaveBeenCalled();
    expect(mockGetStatusHandler).not.toHaveBeenCalled();
  });

  it('returns disabled responses from registered handlers when the feature flag is off', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);

    const { registerMemexIPC } = await import('../memexIPC');
    const manager = {
      enable: vi.fn(),
      disable: vi.fn(),
      getStatus: vi.fn(),
    } as any;

    registerMemexIPC(manager);

    expect(mockEnableHandler).toHaveBeenCalledTimes(1);
    expect(mockDisableHandler).toHaveBeenCalledTimes(1);
    expect(mockGetStatusHandler).toHaveBeenCalledTimes(1);

    const enable = mockEnableHandler.mock.calls[0][0];
    const disable = mockDisableHandler.mock.calls[0][0];
    const getStatus = mockGetStatusHandler.mock.calls[0][0];

    await expect(enable()).resolves.toEqual({
      success: false,
      error: 'Memex Memory feature is disabled',
    });
    await expect(disable()).resolves.toEqual({
      success: false,
      error: 'Memex Memory feature is disabled',
    });
    await expect(getStatus()).resolves.toEqual({
      success: true,
      data: { enabled: false },
    });

    expect(manager.enable).not.toHaveBeenCalled();
    expect(manager.disable).not.toHaveBeenCalled();
    expect(manager.getStatus).not.toHaveBeenCalled();
  });

  it('delegates to the manager when the feature flag is enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    const { registerMemexIPC } = await import('../memexIPC');
    const manager = {
      enable: vi.fn().mockResolvedValue({ success: true }),
      disable: vi.fn().mockResolvedValue({ success: true }),
      getStatus: vi.fn().mockResolvedValue({ success: true, data: { enabled: true } }),
    } as any;

    registerMemexIPC(manager);

    const enable = mockEnableHandler.mock.calls[0][0];
    const disable = mockDisableHandler.mock.calls[0][0];
    const getStatus = mockGetStatusHandler.mock.calls[0][0];

    await expect(enable()).resolves.toEqual({ success: true });
    await expect(disable()).resolves.toEqual({ success: true });
    await expect(getStatus()).resolves.toEqual({ success: true, data: { enabled: true } });

    expect(manager.enable).toHaveBeenCalledTimes(1);
    expect(manager.disable).toHaveBeenCalledTimes(1);
    expect(manager.getStatus).toHaveBeenCalledTimes(1);
  });
});

describe('setupMemex feature-enabled path', () => {
  const MockMemexManager = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    MockMemexManager.mockClear();
  });

  it('creates MemexManager, registers IPC, and returns the instance when flag is on', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    vi.doMock('../MemexManager', () => ({ MemexManager: MockMemexManager }));

    const { setupMemex } = await import('../memexIPC');

    const ctx = { currentUserAlias: 'alice', mainWindow: null };
    const getPCManager = async () => ({});

    const result = setupMemex(ctx, getPCManager);

    // MemexManager constructor should have been called
    expect(MockMemexManager).toHaveBeenCalledTimes(1);
    // The returned instance is the MockMemexManager instance
    expect(result).toBeInstanceOf(MockMemexManager);
    // IPC handlers should have been registered
    expect(mockEnableHandler).toHaveBeenCalledTimes(1);
    expect(mockDisableHandler).toHaveBeenCalledTimes(1);
    expect(mockGetStatusHandler).toHaveBeenCalledTimes(1);
  });

  it('returns undefined and logs error when MemexManager constructor throws', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    const throwingManager = vi.fn().mockImplementation(() => {
      throw new Error('constructor failed');
    });
    vi.doMock('../MemexManager', () => ({ MemexManager: throwingManager }));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { setupMemex } = await import('../memexIPC');

    const result = setupMemex({ currentUserAlias: 'alice', mainWindow: null }, async () => ({}));

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[MemexManager] Failed to initialize:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('passes correct deps to MemexManager constructor', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    vi.doMock('../MemexManager', () => ({ MemexManager: MockMemexManager }));

    const { setupMemex } = await import('../memexIPC');

    const ctx = { currentUserAlias: 'bob', mainWindow: { webContents: {} } as any };
    const getPCManager = async () => ({});

    setupMemex(ctx, getPCManager);

    expect(MockMemexManager).toHaveBeenCalledTimes(1);
    const [deps] = MockMemexManager.mock.calls[0];

    // getAlias should return the current alias
    expect(deps.getAlias()).toBe('bob');
    // getUserDataDir returns mocked app.getPath('userData')
    expect(deps.getUserDataDir()).toBe('/tmp/userData');
    // getMainWindow returns the mainWindow from ctx
    expect(deps.getMainWindow()).toBe(ctx.mainWindow);
    // getMcpClientManager resolves to the mcpClientManager mock
    await expect(deps.getMcpClientManager()).resolves.toEqual({});
  });

  it('returns empty string from getAlias when currentUserAlias is null', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    vi.doMock('../MemexManager', () => ({ MemexManager: MockMemexManager }));

    const { setupMemex } = await import('../memexIPC');

    const ctx = { currentUserAlias: null, mainWindow: null };
    setupMemex(ctx, async () => ({}));

    const [deps] = MockMemexManager.mock.calls[0];
    expect(deps.getAlias()).toBe('');
  });
});