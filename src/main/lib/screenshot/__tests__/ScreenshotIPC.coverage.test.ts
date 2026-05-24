import { vi, describe, it, expect, beforeAll } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockIpcHandle = vi.hoisted(() => vi.fn());
const mockIpcRemoveHandler = vi.hoisted(() => vi.fn());

const mockScreenshotManager = vi.hoisted(() => ({
  setMainWindow: vi.fn(),
  capture: vi.fn().mockResolvedValue({ type: 'success', data: Buffer.from('img') }),
  onSelectionStart: vi.fn(),
  saveToFile: vi.fn().mockResolvedValue({ type: 'success', filePath: '/tmp/shot.png' }),
  copyToClipboard: vi.fn().mockResolvedValue({ success: true }),
  sendToMain: vi.fn().mockReturnValue(undefined),
  cleanup: vi.fn(),
  getInitData: vi.fn().mockReturnValue({ id: 1, bounds: {}, frames: [] }),
}));

const mockAppCacheManager = vi.hoisted(() => ({
  getScreenshotSettings: vi.fn().mockReturnValue({
    enabled: true,
    shortcut: 'Ctrl+Shift+S',
    shortcutEnabled: true,
    savePath: '',
    freRejected: false,
  }),
  updateScreenshotSettings: vi.fn().mockResolvedValue(true),
}));

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockRegisterScreenshotShortcut = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => mockIpcHandle(...args),
    removeHandler: (...args: any[]) => mockIpcRemoveHandler(...args),
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/tmp/screenshots'] }),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../ScreenshotManager', () => ({
  ScreenshotManager: {
    getInstance: () => mockScreenshotManager,
  },
}));

vi.mock('../screenshotShortcut', () => ({
  registerScreenshotShortcut: (...args: any[]) => mockRegisterScreenshotShortcut(...args),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: (...args: any[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('../../userDataADO', () => ({
  appCacheManager: mockAppCacheManager,
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── helpers ────────────────────────────────────────────────────────────────────
// Capture handlers at registration time instead of searching mock.calls later
// This avoids issues with clearAllMocks wiping the call history.
const handlers: Map<string, (...args: any[]) => any> = new Map();

function getHandler(channel: string): (...args: any[]) => any {
  const h = handlers.get(channel);
  if (!h) throw new Error(`Handler not registered for channel: ${channel}`);
  return h;
}

function makeBrowserWindow(overrides: Record<string, any> = {}) {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
    ...overrides,
  };
}

const mockEvent = {};
const rect = { startX: 0, startY: 0, endX: 100, endY: 100, width: 100, height: 100 };

// ── register once ─────────────────────────────────────────────────────────────
let mainWindow: ReturnType<typeof makeBrowserWindow>;

beforeAll(async () => {
  mainWindow = makeBrowserWindow();
  // Intercept ipcMain.handle to capture handlers
  mockIpcHandle.mockImplementation((channel: string, fn: any) => {
    handlers.set(channel, fn);
  });
  const { registerScreenshotIPC } = await import('../ScreenshotIPC');
  registerScreenshotIPC(mainWindow as any, { getCurrentUserAlias: () => 'user@test.com' });
});

// ── tests ──────────────────────────────────────────────────────────────────────
describe('ScreenshotIPC', () => {
  // ── screenshot:capture ───────────────────────────────────────────────────────
  describe('screenshot:capture', () => {
    it('calls screenshotManager.capture and returns result', async () => {
      const handler = getHandler('screenshot:capture');
      const result = await handler(mockEvent, true);
      expect(mockScreenshotManager.capture).toHaveBeenCalledWith(true);
      expect(result).toEqual({ type: 'success', data: expect.any(Buffer) });
    });

    it('uses default callback=true when not supplied', async () => {
      const handler = getHandler('screenshot:capture');
      await handler(mockEvent);
      expect(mockScreenshotManager.capture).toHaveBeenCalledWith(true);
    });
  });

  // ── screenshot:selectionStart ────────────────────────────────────────────────
  describe('screenshot:selectionStart', () => {
    it('calls onSelectionStart with displayId', async () => {
      const handler = getHandler('screenshot:selectionStart');
      await handler(mockEvent, 42);
      expect(mockScreenshotManager.onSelectionStart).toHaveBeenCalledWith(42);
    });
  });

  // ── screenshot:saveToFile ────────────────────────────────────────────────────
  describe('screenshot:saveToFile', () => {
    it('saves to file with savePath from settings', async () => {
      mockAppCacheManager.getScreenshotSettings.mockReturnValueOnce({
        enabled: true,
        shortcut: 'Ctrl+Shift+S',
        shortcutEnabled: true,
        savePath: '/custom/path',
        freRejected: false,
      });
      const handler = getHandler('screenshot:saveToFile');
      const result = await handler(mockEvent, 1, rect, Buffer.from('img'));
      expect(mockScreenshotManager.saveToFile).toHaveBeenCalledWith(
        1, rect, Buffer.from('img'), '/custom/path',
      );
      expect(result).toEqual({ type: 'success', filePath: '/tmp/shot.png' });
    });

    it('passes undefined savePath when savePath is empty', async () => {
      const handler = getHandler('screenshot:saveToFile');
      await handler(mockEvent, 1, rect, Buffer.from('img'));
      expect(mockScreenshotManager.saveToFile).toHaveBeenCalledWith(
        1, rect, Buffer.from('img'), undefined,
      );
    });
  });

  // ── screenshot:copyToClipboard ───────────────────────────────────────────────
  describe('screenshot:copyToClipboard', () => {
    it('copies to clipboard and returns result', async () => {
      const handler = getHandler('screenshot:copyToClipboard');
      const result = await handler(mockEvent, 1, rect);
      expect(mockScreenshotManager.copyToClipboard).toHaveBeenCalledWith(1, rect);
      expect(result).toEqual({ success: true });
    });
  });

  // ── screenshot:sendToMain ────────────────────────────────────────────────────
  describe('screenshot:sendToMain', () => {
    it('calls sendToMain and returns its result', () => {
      const handler = getHandler('screenshot:sendToMain');
      handler(mockEvent, 1, rect, Buffer.from('img'));
      expect(mockScreenshotManager.sendToMain).toHaveBeenCalledWith(1, rect, Buffer.from('img'));
    });
  });

  // ── screenshot:close ─────────────────────────────────────────────────────────
  describe('screenshot:close', () => {
    it('calls cleanup', async () => {
      const handler = getHandler('screenshot:close');
      await handler();
      expect(mockScreenshotManager.cleanup).toHaveBeenCalled();
    });
  });

  // ── screenshot:getInitData ───────────────────────────────────────────────────
  describe('screenshot:getInitData', () => {
    it('returns init data for displayId', async () => {
      const handler = getHandler('screenshot:getInitData');
      const result = await handler(mockEvent, 99);
      expect(mockScreenshotManager.getInitData).toHaveBeenCalledWith(99);
      expect(result).toEqual({ id: 1, bounds: {}, frames: [] });
    });
  });

  // ── screenshot:getSettings ───────────────────────────────────────────────────
  describe('screenshot:getSettings', () => {
    it('returns settings with feature enabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(true);
      const handler = getHandler('screenshot:getSettings');
      const result = await handler();
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(true);
    });

    it('forces enabled=false when feature flag disabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const handler = getHandler('screenshot:getSettings');
      const result = await handler();
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(false);
      // restore
      mockIsFeatureEnabled.mockReturnValue(true);
    });
  });

  // ── screenshot:updateSettings ────────────────────────────────────────────────
  describe('screenshot:updateSettings', () => {
    it('updates settings and re-registers shortcut', async () => {
      const handler = getHandler('screenshot:updateSettings');
      const result = await handler(mockEvent, { enabled: false });
      expect(mockAppCacheManager.updateScreenshotSettings).toHaveBeenCalledWith({ enabled: false });
      expect(mockRegisterScreenshotShortcut).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('returns error when update fails', async () => {
      mockAppCacheManager.updateScreenshotSettings.mockResolvedValueOnce(false);
      const handler = getHandler('screenshot:updateSettings');
      const result = await handler(mockEvent, { enabled: false });
      expect(result).toEqual({ success: false, error: 'Failed to update screenshot settings' });
    });
  });

  // ── screenshot:selectSavePath ────────────────────────────────────────────────
  describe('screenshot:selectSavePath', () => {
    it('returns selected path from dialog', async () => {
      const { dialog } = await import('electron');
      (dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/path'],
      });
      const handler = getHandler('screenshot:selectSavePath');
      const result = await handler();
      expect(result).toEqual({ success: true, data: '/my/path' });
    });

    it('returns null when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      (dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      });
      const handler = getHandler('screenshot:selectSavePath');
      const result = await handler();
      expect(result).toEqual({ success: true, data: null });
    });

    it('returns null when filePaths is empty', async () => {
      const { dialog } = await import('electron');
      (dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: false,
        filePaths: [],
      });
      const handler = getHandler('screenshot:selectSavePath');
      const result = await handler();
      expect(result).toEqual({ success: true, data: null });
    });
  });

  // ── screenshot:rejectFre ─────────────────────────────────────────────────────
  describe('screenshot:rejectFre', () => {
    it('sets freRejected=true and returns success', async () => {
      const handler = getHandler('screenshot:rejectFre');
      const result = await handler();
      expect(mockAppCacheManager.updateScreenshotSettings).toHaveBeenCalledWith({ freRejected: true });
      expect(result).toEqual({ success: true });
    });

    it('returns error when update fails', async () => {
      mockAppCacheManager.updateScreenshotSettings.mockResolvedValueOnce(false);
      const handler = getHandler('screenshot:rejectFre');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Failed to update settings' });
    });
  });

  // ── screenshot:navigateToSettings ───────────────────────────────────────────
  describe('screenshot:navigateToSettings', () => {
    it('cleans up and navigates main window', async () => {
      const handler = getHandler('screenshot:navigateToSettings');
      const result = await handler();
      expect(mockScreenshotManager.cleanup).toHaveBeenCalled();
      expect(mainWindow.show).toHaveBeenCalled();
      expect(mainWindow.focus).toHaveBeenCalled();
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('navigate:to', {
        route: '/settings/screenshot',
      });
      expect(result).toEqual({ success: true });
    });

    it('skips navigation when mainWindow is destroyed', async () => {
      mainWindow.isDestroyed.mockReturnValueOnce(true);
      const handler = getHandler('screenshot:navigateToSettings');
      const result = await handler();
      // cleanup still called, no show/focus
      expect(mockScreenshotManager.cleanup).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});
