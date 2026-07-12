import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIpcHandle,
  mockIpcRemoveHandler,
  mockDialogShowOpenDialog,
  mockBindMain,
  mockSetMainWindow,
  mockCleanup,
} = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
  mockIpcRemoveHandler: vi.fn(),
  mockDialogShowOpenDialog: vi.fn(),
  mockBindMain: vi.fn(() => ({
    capture: vi.fn(),
    selectionStart: vi.fn(),
    saveToFile: vi.fn(),
    copyToClipboard: vi.fn(),
    sendToMain: vi.fn(),
    close: vi.fn(),
    getInitData: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    selectSavePath: vi.fn(),
    rejectFre: vi.fn(),
    navigateToSettings: vi.fn(),
  })),
  mockSetMainWindow: vi.fn(),
  mockCleanup: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
    removeHandler: mockIpcRemoveHandler,
  },
  dialog: {
    showOpenDialog: mockDialogShowOpenDialog,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('@shared/ipc/screenshot', () => ({
  renderToMain: {
    bindMain: mockBindMain,
  },
}));

vi.mock('../ScreenshotManager', () => ({
  ScreenshotManager: {
    getInstance: () => ({
      setMainWindow: mockSetMainWindow,
      cleanup: mockCleanup,
    }),
  },
}));

vi.mock('../screenshotShortcut', () => ({
  registerScreenshotShortcut: vi.fn(),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

vi.mock('../../userDataADO', () => ({
  appCacheManager: {
    getScreenshotSettings: vi.fn(() => ({
      enabled: true,
      shortcut: 'Ctrl+Shift+S',
      shortcutEnabled: true,
      savePath: '',
      freRejected: false,
    })),
    updateScreenshotSettings: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ScreenshotIPC extra coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('skips duplicate registration after the first call', async () => {
    const { registerScreenshotIPC } = await import('../ScreenshotIPC');
    const window = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    } as any;

    registerScreenshotIPC(window, { getCurrentUserAlias: () => 'alice' });
    registerScreenshotIPC(window, { getCurrentUserAlias: () => 'alice' });

    expect(mockBindMain).toHaveBeenCalledTimes(1);
    expect(mockSetMainWindow).toHaveBeenCalledTimes(1);
  });

  it('returns the first selected path when the dialog result is an array', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    mockBindMain.mockReturnValue({
      capture: vi.fn(),
      selectionStart: vi.fn(),
      saveToFile: vi.fn(),
      copyToClipboard: vi.fn(),
      sendToMain: vi.fn(),
      close: vi.fn(),
      getInitData: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      selectSavePath: vi.fn((fn: any) => handlers.set('selectSavePath', fn)),
      rejectFre: vi.fn(),
      navigateToSettings: vi.fn(),
    });
    mockDialogShowOpenDialog.mockResolvedValue(['/chosen/path']);

    const { registerScreenshotIPC } = await import('../ScreenshotIPC');
    registerScreenshotIPC(
      {
        isDestroyed: vi.fn(() => false),
        show: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as any,
      { getCurrentUserAlias: () => 'alice' },
    );

    const result = await handlers.get('selectSavePath')!();
    expect(result).toEqual({ success: true, data: '/chosen/path' });
  });

  it('returns null when the dialog result is an empty array', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    mockBindMain.mockReturnValue({
      capture: vi.fn(),
      selectionStart: vi.fn(),
      saveToFile: vi.fn(),
      copyToClipboard: vi.fn(),
      sendToMain: vi.fn(),
      close: vi.fn(),
      getInitData: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      selectSavePath: vi.fn((fn: any) => handlers.set('selectSavePath', fn)),
      rejectFre: vi.fn(),
      navigateToSettings: vi.fn(),
    });
    mockDialogShowOpenDialog.mockResolvedValue([]);

    const { registerScreenshotIPC } = await import('../ScreenshotIPC');
    registerScreenshotIPC(
      {
        isDestroyed: vi.fn(() => false),
        show: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as any,
      { getCurrentUserAlias: () => 'alice' },
    );

    const result = await handlers.get('selectSavePath')!();
    expect(result).toEqual({ success: true, data: null });
  });
});
