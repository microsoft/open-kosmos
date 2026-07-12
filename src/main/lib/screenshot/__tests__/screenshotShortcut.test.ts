import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRegister,
  mockUnregister,
  mockIsRegistered,
  mockCapture,
  mockIsFeatureEnabled,
  mockGetScreenshotSettings,
} = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUnregister: vi.fn(),
  mockIsRegistered: vi.fn(() => true),
  mockCapture: vi.fn(),
  mockIsFeatureEnabled: vi.fn(() => true),
  mockGetScreenshotSettings: vi.fn(() => ({
    enabled: true,
    shortcut: 'Ctrl+Shift+S',
    shortcutEnabled: true,
    savePath: '',
    freRejected: false,
  })),
}));

vi.mock('electron', () => ({
  globalShortcut: {
    register: mockRegister,
    unregister: mockUnregister,
    isRegistered: mockIsRegistered,
  },
}));

vi.mock('../ScreenshotManager', () => ({
  ScreenshotManager: {
    getInstance: () => ({
      capture: mockCapture,
    }),
  },
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('../../userDataADO', () => ({
  appCacheManager: {
    getScreenshotSettings: mockGetScreenshotSettings,
  },
}));

describe('screenshotShortcut', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
    mockGetScreenshotSettings.mockReturnValue({
      enabled: true,
      shortcut: 'Ctrl+Shift+S',
      shortcutEnabled: true,
      savePath: '',
      freRejected: false,
    });
  });

  it('does not register when the feature flag is disabled', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');
    mockIsFeatureEnabled.mockReturnValue(false);

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does not register when screenshot settings are disabled', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');
    mockGetScreenshotSettings.mockReturnValue({
      enabled: false,
      shortcut: 'Ctrl+Shift+S',
      shortcutEnabled: true,
      savePath: '',
      freRejected: false,
    });

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does not register when shortcut support is disabled in settings', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');
    mockGetScreenshotSettings.mockReturnValue({
      enabled: true,
      shortcut: 'Ctrl+Shift+S',
      shortcutEnabled: false,
      savePath: '',
      freRejected: false,
    });

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('registers the configured shortcut and captures without callback data', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockRegister).toHaveBeenCalledWith('Ctrl+Shift+S', expect.any(Function));
    const callback = mockRegister.mock.calls[0][1];
    callback();
    expect(mockCapture).toHaveBeenCalledWith(false);
    expect(mockIsRegistered).toHaveBeenCalledWith('Ctrl+Shift+S');
  });

  it('falls back to the default shortcut when the stored shortcut is empty', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');
    mockGetScreenshotSettings.mockReturnValue({
      enabled: true,
      shortcut: '',
      shortcutEnabled: true,
      savePath: '',
      freRejected: false,
    });

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockRegister).toHaveBeenCalledWith('CommandOrControl+Shift+S', expect.any(Function));
  });

  it('unregisters the previous shortcut before re-registering a new one', async () => {
    const { registerScreenshotShortcut } = await import('../screenshotShortcut');

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });
    mockGetScreenshotSettings.mockReturnValue({
      enabled: true,
      shortcut: 'Alt+Shift+S',
      shortcutEnabled: true,
      savePath: '',
      freRejected: false,
    });

    await registerScreenshotShortcut({ getCurrentUserAlias: () => 'alice' });

    expect(mockUnregister).toHaveBeenCalledWith('Ctrl+Shift+S');
    expect(mockRegister).toHaveBeenLastCalledWith('Alt+Shift+S', expect.any(Function));
  });

  it('unregisterScreenshotShortcut is a no-op when nothing is registered', async () => {
    vi.resetModules();
    const { unregisterScreenshotShortcut } = await import('../screenshotShortcut');

    unregisterScreenshotShortcut();

    expect(mockUnregister).not.toHaveBeenCalled();
  });
});
