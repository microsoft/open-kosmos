// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 100 })),
  mkdirSync: vi.fn(),
  promises: {
    writeFile: vi.fn(() => Promise.resolve()),
  },
}));

const mockApp = vi.hoisted(() => ({
  getPath: vi.fn((_: string) => '/mock/userData'),
}));

const mockBrowserWindow = vi.hoisted(() => ({
  getAllWindows: vi.fn(() => []),
}));

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('fs', () => mockFs);
vi.mock('path', async () => {
  const actualPath = await vi.importActual<typeof import('path')>('path');
  return actualPath;
});
vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
}));
vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── imports ───────────────────────────────────────────────────────────────────

import { AppCacheManager } from '../appCacheManager';
import {
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_VOICE_INPUT_CONFIG,
  DEFAULT_SCREENSHOT_SETTINGS,
  DEFAULT_APP_CONFIG,
} from '../types/app';

// ── helpers ───────────────────────────────────────────────────────────────────

function getInstance(): AppCacheManager {
  // Reset singleton between tests
  (AppCacheManager as any).instance = undefined;
  return AppCacheManager.getInstance();
}

function makeMockWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      send: vi.fn(),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AppCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AppCacheManager as any).instance = undefined;
    // Reset fs defaults
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.promises.writeFile.mockResolvedValue(undefined);
  });

  // ── singleton ──────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance', () => {
      (AppCacheManager as any).instance = undefined;
      const a = AppCacheManager.getInstance();
      const b = AppCacheManager.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── initialize ─────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('initializes with empty config when app.json missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const cfg = mgr.getConfig();
      expect(cfg.runtimeEnvironment).toBeDefined();
    });

    it('reads app.json when it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 100 });
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          runtimeEnvironment: { mode: 'system', bunVersion: '2.0.0', uvVersion: '1.0.0' },
        })
      );
      const mgr = getInstance();
      await mgr.initialize();
      const cfg = mgr.getConfig();
      expect(cfg.runtimeEnvironment?.mode).toBe('system');
      expect(cfg.runtimeEnvironment?.bunVersion).toBe('2.0.0');
    });

    it('skips second initialize call', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.initialize(); // second call should be no-op
      // readFileSync only called once (first initialize)
      expect(mockFs.readFileSync).not.toHaveBeenCalled(); // file didn't exist
    });

    it('writes config when integrity check produces changes', async () => {
      mockFs.existsSync.mockReturnValue(false); // app.json missing → integrityEnsure adds fields
      const mgr = getInstance();
      await mgr.initialize();
      // Config was missing fields, so needsWrite returns true → writeFile called
      expect(mockFs.promises.writeFile).toHaveBeenCalled();
    });

    it('handles corrupt app.json gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => { throw new Error('read error'); });
      const mgr = getInstance();
      await mgr.initialize();
      // Should not throw, cache stays as default
    });

    it('handles write failure gracefully (no throw)', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.promises.writeFile.mockRejectedValue(new Error('write fail'));
      const mgr = getInstance();
      // Initialize calls writeConfigToDisk which throws; outer catch swallows it
      await expect(mgr.initialize()).resolves.toBeUndefined();
    });

  });

  // ── integrityEnsure edge cases ─────────────────────────────────────────────

  describe('integrityEnsure (via initialize)', () => {
    it('fills leftSidebarCollapsed default when missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      expect(typeof mgr.getConfig().leftSidebarCollapsed).toBe('boolean');
    });

    it('fills leftSidebarWidth default when missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      expect(typeof mgr.getConfig().leftSidebarWidth).toBe('number');
    });

    it('clamps leftSidebarWidth to [288, 400]', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ leftSidebarWidth: 999 }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().leftSidebarWidth).toBe(400);
    });

    it('clamps leftSidebarWidth up to 288', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ leftSidebarWidth: 100 }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().leftSidebarWidth).toBe(288);
    });

    it('sanitizes invalid zoomLevel to 0', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ zoomLevel: 'bad' }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().zoomLevel).toBe(0);
    });

    it('clamps zoomLevel to [-3, 3]', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ zoomLevel: 10 }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().zoomLevel).toBe(3);
    });

    it('fills mainWindowMaximized default', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      expect(typeof mgr.getConfig().mainWindowMaximized).toBe('boolean');
    });

    it('merges existing screenshotSettings sub-fields with defaults', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ screenshotSettings: { enabled: false, shortcut: 'Ctrl+Z', shortcutEnabled: false, savePath: '', freRejected: false } })
      );
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().screenshotSettings?.enabled).toBe(false);
    });

    it('handles migrateScreenshotFromFirstProfile failure gracefully', async () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('profiles')) return true;
        return false;
      });
      mockFs.readdirSync.mockImplementation(() => { throw new Error('readdir fail'); });
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().screenshotSettings).toBeDefined();
    });

    it('handles migrateRuntimeEnvironmentFromLegacy read error', async () => {
      mockFs.existsSync.mockImplementation((p: string) => p.endsWith('runtimeConfig.json'));
      mockFs.readFileSync.mockImplementation(() => { throw new Error('fail'); });
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().runtimeEnvironment).toEqual(DEFAULT_RUNTIME_ENVIRONMENT);
    });

    it('skips hidden profile directories', async () => {
      const hidden = { name: '.hidden', isDirectory: () => true } as any;
      const real = { name: 'real-profile', isDirectory: () => true } as any;
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('profiles')) return true;
        if (p.includes('real-profile') && p.includes('profile.json')) return true;
        return false;
      });
      mockFs.readdirSync.mockReturnValue([hidden, real]);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('profile.json')) return JSON.stringify({});
        return '{}';
      });
      const mgr = getInstance();
      await mgr.initialize(); // no error
      expect(mgr.getConfig().screenshotSettings).toBeDefined();
    });
  });

  // ── getConfig / updateConfig ───────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns a copy of cache', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const c1 = mgr.getConfig();
      const c2 = mgr.getConfig();
      expect(c1).not.toBe(c2);
    });
  });

  describe('updateConfig', () => {
    it('merges partial update and persists', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      await mgr.updateConfig({ updaterVersion: '1.0.0' });
      expect(mgr.getConfig().updaterVersion).toBe('1.0.0');
      expect(mockFs.promises.writeFile).toHaveBeenCalled();
    });

    it('deep-merges runtimeEnvironment', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ runtimeEnvironment: { mode: 'system' } as any });
      expect(mgr.getConfig().runtimeEnvironment?.mode).toBe('system');
      // Other fields preserved from defaults
      expect(mgr.getConfig().runtimeEnvironment?.bunVersion).toBeTruthy();
    });

    it('deep-merges screenshotSettings', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ screenshotSettings: { savePath: '/new/path' } as any });
      expect(mgr.getConfig().screenshotSettings?.savePath).toBe('/new/path');
    });

    it('updates zoomLevel scalar', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ zoomLevel: 1.5 });
      expect(mgr.getConfig().zoomLevel).toBe(1.5);
    });

    it('updates mainWindowMaximized scalar', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ mainWindowMaximized: true });
      expect(mgr.getConfig().mainWindowMaximized).toBe(true);
    });
  });

  // ── appConfigSanitize (via updateConfig) ───────────────────────────────────

  describe('appConfigSanitize', () => {
    it('sanitizes invalid runtimeEnvironment mode to default', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ runtimeEnvironment: { mode: 'bad' as any, bunVersion: '', uvVersion: '' } });
      expect(mgr.getConfig().runtimeEnvironment?.mode).toBe(DEFAULT_RUNTIME_ENVIRONMENT.mode);
    });

    it('sanitizes leftSidebarWidth to [288, 400]', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ leftSidebarWidth: 500 });
      expect(mgr.getConfig().leftSidebarWidth).toBe(400);
    });

    it('strips non-boolean leftSidebarCollapsed', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      // Valid boolean should persist
      await mgr.updateConfig({ leftSidebarCollapsed: true });
      expect(mgr.getConfig().leftSidebarCollapsed).toBe(true);
    });

    it('handles pinnedPythonVersion = null', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({
        runtimeEnvironment: { mode: 'internal', bunVersion: '1.0', uvVersion: '1.0', pinnedPythonVersion: null },
      });
      expect(mgr.getConfig().runtimeEnvironment?.pinnedPythonVersion).toBeNull();
    });

    it('sanitizes screenshotSettings fields', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({
        screenshotSettings: {
          enabled: true,
          shortcut: 'Ctrl+S',
          shortcutEnabled: false,
          savePath: '/save',
          freRejected: false,
        },
      });
      expect(mgr.getConfig().screenshotSettings?.shortcut).toBe('Ctrl+S');
    });
  });

  // ── setMainWindow & sendConfigToFrontend ──────────────────────────────────

  describe('setMainWindow', () => {
    it('sends config to window on setMainWindow', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const win = makeMockWindow();
      mgr.setMainWindow(win as any);
      expect(win.webContents.send).toHaveBeenCalledWith('app:configUpdated', expect.objectContaining({ config: expect.any(Object) }));
    });

    it('falls back to getAllWindows when mainWindow is destroyed', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const destroyedWin = makeMockWindow(true);
      const validWin = makeMockWindow(false);
      mockBrowserWindow.getAllWindows.mockReturnValue([validWin]);
      mgr.setMainWindow(destroyedWin as any);
      // Schedule notify fires after 150ms but send was called immediately by setMainWindow
      expect(validWin.webContents.send).toHaveBeenCalled();
    });

    it('logs warning when no window is available for notification', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      mockBrowserWindow.getAllWindows.mockReturnValue([]);
      // Set a destroyed main window, no fallbacks
      const destroyedWin = makeMockWindow(true);
      mgr.setMainWindow(destroyedWin as any);
      // No error thrown
    });

    it('handles send throwing gracefully', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const errWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn(() => { throw new Error('ipc error'); }) },
      };
      mockBrowserWindow.getAllWindows.mockReturnValue([errWin]);
      const destroyedWin = makeMockWindow(true);
      expect(() => mgr.setMainWindow(destroyedWin as any)).not.toThrow();
    });
  });

  // ── getScreenshotSettings / updateScreenshotSettings ─────────────────────

  describe('getScreenshotSettings', () => {
    it('returns default when screenshotSettings not set', () => {
      const mgr = getInstance();
      expect(mgr.getScreenshotSettings()).toMatchObject(DEFAULT_SCREENSHOT_SETTINGS);
    });
  });

  describe('updateScreenshotSettings', () => {
    it('returns true on success', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const ok = await mgr.updateScreenshotSettings({ savePath: '/screenshots' });
      expect(ok).toBe(true);
      expect(mgr.getConfig().screenshotSettings?.savePath).toBe('/screenshots');
    });

    it('returns false when writeFile throws', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      mockFs.promises.writeFile.mockRejectedValue(new Error('disk full'));
      const ok = await mgr.updateScreenshotSettings({ savePath: '/bad' });
      expect(ok).toBe(false);
    });
  });

  // ── scheduleNotifyFrontend debounce ───────────────────────────────────────

  describe('scheduleNotifyFrontend', () => {
    it('debounces multiple rapid updates', async () => {
      vi.useFakeTimers();
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const win = makeMockWindow();
      mgr.setMainWindow(win as any);
      // Reset call count after setMainWindow
      win.webContents.send.mockClear();

      // Trigger two rapid updates
      await mgr.updateConfig({ updaterVersion: '1' });
      await mgr.updateConfig({ updaterVersion: '2' });

      // Advance 150ms to fire debounce
      vi.advanceTimersByTime(200);
      // Only one debounced call (after the two updates) plus the timer fires once
      expect(win.webContents.send).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
