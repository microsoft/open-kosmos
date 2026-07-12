const {
  mockExposeInMainWorld,
  mockInvoke,
  mockOn,
  mockOff,
  mockRemoveListener,
  mockScreenshotInvoke,
} = vi.hoisted(() => ({
  mockExposeInMainWorld: vi.fn(),
  mockInvoke: vi.fn(),
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockRemoveListener: vi.fn(),
  mockScreenshotInvoke: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    off: mockOff,
    removeListener: mockRemoveListener,
  },
}));

vi.mock('../screenshot/invoke', () => ({
  default: mockScreenshotInvoke,
}));

describe('screenshot preload', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ success: true, data: { uiLanguage: 'zh-CN' }, revision: 3 });
  });

  async function importPreload() {
    await import('../screenshot');
    const exposed = Object.fromEntries(mockExposeInMainWorld.mock.calls.map(([name, api]) => [name, api]));
    return exposed as any;
  }

  it('exposes screenshot and app config APIs', async () => {
    const exposed = await importPreload();

    expect(exposed.electronScreenshot.invoke).toBe(mockScreenshotInvoke);
    exposed.electronScreenshot.on('event-name', vi.fn());
    exposed.electronScreenshot.off('event-name', vi.fn());
    expect(mockOn).toHaveBeenCalledWith('event-name', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('event-name', expect.any(Function));

    await exposed.electronAPI.appConfig.getAppConfig();
    await expect(exposed.electronAPI.appConfig.updateAppConfig()).resolves.toEqual({
      success: false,
      error: 'App config updates are not available in screenshot overlay',
    });
    expect(mockInvoke).toHaveBeenCalledWith('app:getAppConfig');
  });

  it('subscribes to app config updates and replays the current config', async () => {
    const exposed = await importPreload();
    const callback = vi.fn();

    const unsubscribe = exposed.electronAPI.appConfig.onConfigUpdated(callback);
    await Promise.resolve();

    expect(mockOn).toHaveBeenCalledWith('app:configUpdated', expect.any(Function));
    expect(callback).toHaveBeenCalledWith({
      config: { uiLanguage: 'zh-CN' },
      timestamp: expect.any(Number),
      revision: 3,
    });

    const listener = mockOn.mock.calls.find(([channel]) => channel === 'app:configUpdated')![1];
    listener({}, { config: { uiLanguage: 'en' }, timestamp: 123 });
    expect(callback).toHaveBeenCalledWith({ config: { uiLanguage: 'en' }, timestamp: 123 });

    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith('app:configUpdated', listener);
  });

  it('ignores initial app config replay failures', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('unavailable'));
    const exposed = await importPreload();
    const callback = vi.fn();

    exposed.electronAPI.appConfig.onConfigUpdated(callback);
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not replay app config when the initial result has no data', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false });
    const exposed = await importPreload();
    const callback = vi.fn();

    exposed.electronAPI.appConfig.onConfigUpdated(callback);
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
  });
});
