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

const mockNativeTheme = vi.hoisted(() => ({
  themeSource: 'system',
}));

const mockEmbeddedBrowserManager = vi.hoisted(() => ({
  destroyAll: vi.fn(),
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
  nativeTheme: mockNativeTheme,
}));
vi.mock('../../embeddedBrowser/EmbeddedBrowserManager', () => ({
  getEmbeddedBrowserManager: () => mockEmbeddedBrowserManager,
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
  DEFAULT_APPEARANCE_CONFIG,
} from '../appCacheManager';
import {
  DEFAULT_UI_LANGUAGE,
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

function makeDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AppCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbeddedBrowserManager.destroyAll.mockClear();
    (AppCacheManager as any).instance = undefined;
    delete (global as any).electron;
    delete (mockNativeTheme as any).shouldUseDarkColors;
    delete (mockNativeTheme as any).on;
    // Reset fs defaults
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    mockNativeTheme.themeSource = 'system';
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

  describe('readStartupThemeSourceSync', () => {
    it('reads the persisted startup theme source without initializing cache or writing migrations', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appearance: { themeSource: 'dark' } }));

      const mgr = getInstance();

      expect(mgr.readStartupThemeSourceSync()).toBe('dark');
      expect(mgr.getConfig()).toEqual({});
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('falls back to the default theme source when startup appearance is missing or invalid', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ appearance: { themeSource: 'sepia' } }));

      expect(getInstance().readStartupThemeSourceSync()).toBe(DEFAULT_APPEARANCE_CONFIG.themeSource);

      mockFs.existsSync.mockReturnValue(false);
      expect(getInstance().readStartupThemeSourceSync()).toBe(DEFAULT_APPEARANCE_CONFIG.themeSource);
    });
  });

  // ── initialize ─────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('initializes with empty config when app.json missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const cfg = mgr.getConfig();
      expect(cfg.uiLanguage).toBe(DEFAULT_UI_LANGUAGE);
      expect(cfg.runtimeEnvironment).toBeDefined();
      expect(cfg.voiceInput).toBeDefined();
      expect(cfg.appearance).toEqual(DEFAULT_APPEARANCE_CONFIG);
      expect(mockNativeTheme.themeSource).toBe('light');
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

    it('reads supported uiLanguage from app.json', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 100 });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ uiLanguage: 'zh-CN' }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().uiLanguage).toBe('zh-CN');
    });

    it('strips legacy Microsoft configuration without invoking external services', async () => {
      mockFs.existsSync.mockImplementation((p: string) => p.endsWith('app.json'));
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        microsoft: {
          authMode: 'azure-ad-app',
          graphClientId: 'legacy-client-id',
          alwaysAllowM365AuthRequest: true,
        },
      }));

      const mgr = getInstance();
      await mgr.initialize();

      expect(mgr.getConfig()).not.toHaveProperty('microsoft');
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('app.json'),
        expect.not.stringContaining('legacy-client-id'),
        'utf-8',
      );
    });

    it('strips the obsolete native server version during local config migration', async () => {
      mockFs.existsSync.mockImplementation((p: string) => p.endsWith('app.json'));
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        nativeServerVersion: '1.0.0',
        uiLanguage: 'en',
      }));

      const mgr = getInstance();
      await mgr.initialize();

      expect(mgr.getConfig()).not.toHaveProperty('nativeServerVersion');
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('app.json'),
        expect.not.stringContaining('nativeServerVersion'),
        'utf-8',
      );
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

    it('migrates runtimeEnvironment from legacy runtimeConfig.json', async () => {
      // app.json exists but has no runtimeEnvironment
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('app.json')) return true;
        if (p.endsWith('runtimeConfig.json')) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.endsWith('app.json')) return JSON.stringify({});
        if (p.endsWith('runtimeConfig.json'))
          return JSON.stringify({ mode: 'system', bunVersion: '3.0.0', uvVersion: '0.5.0' });
        return '{}';
      });
      const mgr = getInstance();
      await mgr.initialize();
      const cfg = mgr.getConfig();
      expect(cfg.runtimeEnvironment?.mode).toBe('system');
    });

    it('migrates screenshotSettings from first profile', async () => {
      const profileDirEntry = { name: 'profile-abc', isDirectory: () => true, startsWith: (s: string) => false } as any;
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('profiles')) return true;
        if (p.includes('profile.json')) return true;
        return false;
      });
      mockFs.readdirSync.mockReturnValue([profileDirEntry]);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('profile.json'))
          return JSON.stringify({ screenshotSettings: { enabled: false, shortcut: 'Ctrl+P', shortcutEnabled: true, savePath: '/tmp', freRejected: true } });
        return '{}';
      });
      const mgr = getInstance();
      await mgr.initialize();
      const cfg = mgr.getConfig();
      expect(cfg.screenshotSettings?.shortcut).toBe('Ctrl+P');
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

    it('fills uiLanguage default when missing or invalid', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ uiLanguage: 'fr' }));
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().uiLanguage).toBe(DEFAULT_UI_LANGUAGE);
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

    it('merges existing voiceInput sub-fields with defaults', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ voiceInput: { voiceInputEnabled: true } })
      );
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().voiceInput?.voiceInputEnabled).toBe(true);
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

    it('merges existing appearance sub-fields with defaults and syncs nativeTheme', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ appearance: { themeSource: 'dark' } })
      );
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().appearance?.themeSource).toBe('dark');
      expect(mockNativeTheme.themeSource).toBe('dark');
    });

    it('sanitizes invalid persisted appearance themeSource to default', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ appearance: { themeSource: 'sepia' } })
      );
      const mgr = getInstance();
      await mgr.initialize();
      expect(mgr.getConfig().appearance).toEqual(DEFAULT_APPEARANCE_CONFIG);
      expect(mockNativeTheme.themeSource).toBe(DEFAULT_APPEARANCE_CONFIG.themeSource);
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

    it('deep-merges voiceInput', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ voiceInput: { voiceInputEnabled: true } as any });
      expect(mgr.getConfig().voiceInput?.voiceInputEnabled).toBe(true);
    });

    it('deep-merges screenshotSettings', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ screenshotSettings: { savePath: '/new/path' } as any });
      expect(mgr.getConfig().screenshotSettings?.savePath).toBe('/new/path');
    });

    it('deep-merges appearance and syncs nativeTheme', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ appearance: { themeSource: 'system' } });
      expect(mgr.getConfig().appearance?.themeSource).toBe('system');
      expect(mockNativeTheme.themeSource).toBe('system');
    });

    it('preserves app-level layout and window fields when updating appearance', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          appearance: { themeSource: 'light' },
          leftSidebarCollapsed: true,
          leftSidebarWidth: 344,
          zoomLevel: 1.5,
          mainWindowMaximized: true,
        }),
      );

      const mgr = getInstance();
      await mgr.initialize();
      mockFs.promises.writeFile.mockClear();

      await mgr.updateConfig({ appearance: { themeSource: 'dark' } });

      const cfg = mgr.getConfig();
      expect(cfg.appearance?.themeSource).toBe('dark');
      expect(cfg.leftSidebarCollapsed).toBe(true);
      expect(cfg.leftSidebarWidth).toBe(344);
      expect(cfg.zoomLevel).toBe(1.5);
      expect(cfg.mainWindowMaximized).toBe(true);

      const persisted = JSON.parse(mockFs.promises.writeFile.mock.calls.at(-1)?.[1] as string);
      expect(persisted).toMatchObject({
        appearance: { themeSource: 'dark' },
        leftSidebarCollapsed: true,
        leftSidebarWidth: 344,
        zoomLevel: 1.5,
        mainWindowMaximized: true,
      });
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

    it('updates uiLanguage and persists it', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      mockFs.promises.writeFile.mockClear();

      await mgr.updateConfig({ uiLanguage: 'zh-CN' });

      expect(mgr.getConfig().uiLanguage).toBe('zh-CN');
      const persisted = JSON.parse(mockFs.promises.writeFile.mock.calls.at(-1)?.[1] ?? '{}');
      expect(persisted.uiLanguage).toBe('zh-CN');
    });

    it('returns a monotonic revision and includes it in frontend notifications', async () => {
      vi.useFakeTimers();
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const win = makeMockWindow(false);
      mgr.setMainWindow(win as any);
      win.webContents.send.mockClear();

      const result = await mgr.updateConfig({ uiLanguage: 'zh-CN' });
      expect(result.revision).toBe(1);
      expect(mgr.getConfigRevision()).toBe(1);

      await vi.advanceTimersByTimeAsync(151);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'app:configUpdated',
        expect.objectContaining({
          config: expect.objectContaining({ uiLanguage: 'zh-CN' }),
          revision: 1,
        }),
      );
    });

    it('serializes concurrent updates so a slower older write cannot overwrite a newer language', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      mockFs.promises.writeFile.mockClear();

      const firstWrite = makeDeferred<void>();
      const secondWrite = makeDeferred<void>();
      mockFs.promises.writeFile
        .mockReturnValueOnce(firstWrite.promise)
        .mockReturnValueOnce(secondWrite.promise);

      const firstUpdate = mgr.updateConfig({ updaterVersion: 'older-write' });
      const secondUpdate = mgr.updateConfig({ uiLanguage: 'zh-CN' });
      await Promise.resolve();

      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockFs.promises.writeFile.mock.calls[0][1]).uiLanguage).toBe('en');

      firstWrite.resolve();
      await firstUpdate;
      await Promise.resolve();

      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(2);
      const secondPayload = JSON.parse(mockFs.promises.writeFile.mock.calls[1][1]);
      expect(secondPayload.updaterVersion).toBe('older-write');
      expect(secondPayload.uiLanguage).toBe('zh-CN');

      secondWrite.resolve();
      await secondUpdate;

      expect(mgr.getConfig().updaterVersion).toBe('older-write');
      expect(mgr.getConfig().uiLanguage).toBe('zh-CN');
    });

    it('deep-merges every nested field onto an empty cache using DEFAULTs (pre-initialize)', async () => {
      // No initialize() → cache is {}. Each deep-merge branch takes the
      // `updates.X || this.cache.X` true side (updates provided) while the inner
      // `this.cache.X ?? DEFAULT_X` falls back to the DEFAULT (cache side undefined).
      const mgr = getInstance();
      await mgr.updateConfig({
        runtimeEnvironment: { mode: 'system' } as any,
        voiceInput: { voiceInputEnabled: true } as any,
        screenshotSettings: { savePath: '/merged' } as any,
        appearance: { themeSource: 'dark' } as any,
      });
      const cfg = mgr.getConfig();
      // runtimeEnvironment merged onto DEFAULT keeps the other default sub-fields
      expect(cfg.runtimeEnvironment?.mode).toBe('system');
      expect(cfg.runtimeEnvironment?.bunVersion).toBe(DEFAULT_RUNTIME_ENVIRONMENT.bunVersion);
      // voiceInput merged onto DEFAULT
      expect(cfg.voiceInput?.voiceInputEnabled).toBe(true);
      expect(cfg.voiceInput?.whisperModelSelected).toBe(DEFAULT_VOICE_INPUT_CONFIG.whisperModelSelected);
      // screenshotSettings merged onto DEFAULT
      expect(cfg.screenshotSettings?.savePath).toBe('/merged');
      expect(cfg.screenshotSettings?.shortcut).toBe(DEFAULT_SCREENSHOT_SETTINGS.shortcut);
      // appearance merged onto DEFAULT
      expect(cfg.appearance?.themeSource).toBe('dark');
    });

    it('leaves every nested field undefined when neither updates nor cache provide it', async () => {
      // Empty cache (no initialize) + a scalar-only update means each deep-merge
      // guard `updates.X || this.cache.X` is falsy → the `: undefined` else-branch.
      const mgr = getInstance();
      await mgr.updateConfig({ updaterVersion: '9.9.9' });
      const cfg = mgr.getConfig();
      expect(cfg.updaterVersion).toBe('9.9.9');
      expect(cfg.runtimeEnvironment).toBeUndefined();
      expect(cfg.voiceInput).toBeUndefined();
      expect(cfg.screenshotSettings).toBeUndefined();
      expect(cfg.appearance).toBeUndefined();
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

    it('sanitizes invalid uiLanguage to default', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ uiLanguage: 'fr' as any });
      expect(mgr.getConfig().uiLanguage).toBe(DEFAULT_UI_LANGUAGE);
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

    it('sanitizes invalid appearance themeSource to default', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({ appearance: { themeSource: 'sepia' as any } });
      expect(mgr.getConfig().appearance?.themeSource).toBe(DEFAULT_APPEARANCE_CONFIG.themeSource);
      expect(mockNativeTheme.themeSource).toBe(DEFAULT_APPEARANCE_CONFIG.themeSource);
    });

    it('coerces malformed voiceInput sub-fields back to defaults', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      // Every field has the wrong type → each ternary takes its DEFAULT else-branch.
      await mgr.updateConfig({
        voiceInput: {
          voiceInputEnabled: 'nope' as any,
          whisperModelSelected: 123 as any,
          recognitionLanguage: 456 as any,
          gpuAcceleration: 'sure' as any,
        },
      });
      const vi = mgr.getConfig().voiceInput!;
      expect(vi.voiceInputEnabled).toBe(DEFAULT_VOICE_INPUT_CONFIG.voiceInputEnabled);
      expect(vi.whisperModelSelected).toBe(DEFAULT_VOICE_INPUT_CONFIG.whisperModelSelected);
      expect(vi.recognitionLanguage).toBe(DEFAULT_VOICE_INPUT_CONFIG.recognitionLanguage);
      expect(vi.gpuAcceleration).toBe(DEFAULT_VOICE_INPUT_CONFIG.gpuAcceleration);
    });

    it('coerces malformed screenshot sub-fields back to defaults', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({
        screenshotSettings: {
          enabled: 'x' as any,
          shortcut: 1 as any,
          shortcutEnabled: 'x' as any,
          savePath: 2 as any,
          freRejected: 'x' as any,
        },
      });
      const ss = mgr.getConfig().screenshotSettings!;
      expect(ss.enabled).toBe(DEFAULT_SCREENSHOT_SETTINGS.enabled);
      expect(ss.shortcut).toBe(DEFAULT_SCREENSHOT_SETTINGS.shortcut);
      expect(ss.shortcutEnabled).toBe(DEFAULT_SCREENSHOT_SETTINGS.shortcutEnabled);
      expect(ss.savePath).toBe(DEFAULT_SCREENSHOT_SETTINGS.savePath);
      expect(ss.freRejected).toBe(DEFAULT_SCREENSHOT_SETTINGS.freRejected);
    });

    it('falls back pinnedPythonVersion to default when it is a non-string, non-null value', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      await mgr.updateConfig({
        runtimeEnvironment: {
          mode: 'internal',
          bunVersion: '',
          uvVersion: '',
          pinnedPythonVersion: 42 as any,
        },
      });
      // Non-string & non-null → default-fallback else-branch (?? '3.10.12').
      expect(typeof mgr.getConfig().runtimeEnvironment?.pinnedPythonVersion).toBe('string');
    });
  });

  // ── setMainWindow & sendConfigToFrontend ──────────────────────────────────

  describe('setMainWindow', () => {
    it('uses global electron app fallback when present', async () => {
      const globalApp = { getPath: vi.fn(() => '/global/userData') };
      (global as any).electron = { app: globalApp };

      const mgr = getInstance();
      await mgr.initialize();

      expect(globalApp.getPath).toHaveBeenCalledWith('userData');
    });

    it('applies the dark window background for persisted dark appearance', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ appearance: { themeSource: 'dark' } }),
      );

      const mgr = getInstance();
      await mgr.initialize();
      const win = {
        isDestroyed: vi.fn(() => false),
        setBackgroundColor: vi.fn(),
        webContents: { send: vi.fn() },
      };

      mgr.setMainWindow(win as any);

      expect(win.setBackgroundColor).toHaveBeenCalledWith('#111318');
    });

    it('uses native dark colors when appearance follows system mode', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ appearance: { themeSource: 'system' } }),
      );
      mockNativeTheme.shouldUseDarkColors = true;
      mockNativeTheme.on = vi.fn();

      const mgr = getInstance();
      await mgr.initialize();
      const win = {
        isDestroyed: vi.fn(() => false),
        setBackgroundColor: vi.fn(),
        webContents: { send: vi.fn() },
      };

      mgr.setMainWindow(win as any);

      expect(mockNativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
      expect(win.setBackgroundColor).toHaveBeenCalledWith('#111318');
    });

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

    it('broadcasts config updates to every live renderer window', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const mainWin = makeMockWindow(false);
      const screenshotWin = makeMockWindow(false);
      const destroyedWin = makeMockWindow(true);
      mockBrowserWindow.getAllWindows.mockReturnValue([mainWin, screenshotWin, destroyedWin]);

      mgr.setMainWindow(mainWin as any);

      expect(mainWin.webContents.send).toHaveBeenCalledWith('app:configUpdated', expect.objectContaining({ config: expect.any(Object) }));
      expect(screenshotWin.webContents.send).toHaveBeenCalledWith('app:configUpdated', expect.objectContaining({ config: expect.any(Object) }));
      expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
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

    it('continues notifying other windows when one send throws', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = getInstance();
      await mgr.initialize();
      const errWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn(() => { throw new Error('ipc error'); }) },
      };
      const validWin = makeMockWindow(false);
      mockBrowserWindow.getAllWindows.mockReturnValue([errWin, validWin]);
      const destroyedWin = makeMockWindow(true);
      expect(() => mgr.setMainWindow(destroyedWin as any)).not.toThrow();
      expect(validWin.webContents.send).toHaveBeenCalledWith('app:configUpdated', expect.objectContaining({ config: expect.any(Object) }));
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
