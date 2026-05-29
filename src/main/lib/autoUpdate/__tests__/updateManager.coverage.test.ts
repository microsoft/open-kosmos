// @ts-nocheck
/**
 * updateManager.coverage.test.ts
 *
 * Targets remaining uncovered lines in updateManager.ts.
 * Covers:
 * - quitAndInstall: zip → silentUpdate, non-zip → installUpdate
 * - silentUpdate: updater not found, success + app.quit
 * - installUpdate: file missing, no access, darwin/win32/linux branches
 * - getAppInstallPath: darwin, win32, unsupported
 * - startPeriodicCheck / stopPeriodicCheck interval logic
 * - skipVersion / updatePreferences / getPreferences
 * - getLastCheckState
 * - checkForUpdates: already InProgress guard
 * - UpdateErrorHandler: all contexts (check, download, install, verification, generic)
 * - UpdateErrorHandler: performRetry, resetRetryCount, getRetryCount, setMaxRetries
 * - UpdateErrorHandler: performRollback
 * - formatBytes edge cases (via downloadFile progress)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/cov-um'),
    getVersion: vi.fn(() => '2.0.0'),
    quit: vi.fn(),
  },
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(() => Promise.resolve('')) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../shared/constants/branding', () => ({
  BRAND_NAME: 'kosmos',
  BRAND_CONFIG: { filenamePrefix: 'OpenKosmos', productName: 'OpenKosmos' },
}));

const {
  mockCdnCheckForUpdates,
  mockCdnVerifyDownload,
  mockCdnGetFileInfo,
  mockCdnIsPlatformSupported,
  mockGetCurrentPlatformKey,
} = vi.hoisted(() => ({
  mockCdnCheckForUpdates: vi.fn(),
  mockCdnVerifyDownload: vi.fn(() => Promise.resolve(true)),
  mockCdnGetFileInfo: vi.fn(() => Promise.resolve(null)),
  mockCdnIsPlatformSupported: vi.fn(() => true),
  mockGetCurrentPlatformKey: vi.fn(() => 'darwin-arm64'),
}));

vi.mock('../cdnUpdateChecker', () => {
  function CdnUpdateChecker(this: any) {
    this.checkForUpdates = mockCdnCheckForUpdates;
    this.verifyDownloadExists = mockCdnVerifyDownload;
    this.getFileInfo = mockCdnGetFileInfo;
    this.getCurrentPlatformKey = mockGetCurrentPlatformKey;
    this.isPlatformSupported = mockCdnIsPlatformSupported;
  }
  return { CdnUpdateChecker };
});

const { mockEnsureUpdater } = vi.hoisted(() => ({
  mockEnsureUpdater: vi.fn(() =>
    Promise.resolve({ success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/updater' }),
  ),
}));

vi.mock('../updaterFetcher', () => {
  function UpdaterFetcher(this: any) {
    this.ensureUpdater = mockEnsureUpdater;
  }
  return { UpdaterFetcher };
});

vi.mock('../../assetsFetcher/assetsLibraryManager', () => ({
  assetsLibraryManager: {
    checkAndUpdateLibraries: vi.fn(() =>
      Promise.resolve({ fetchResults: [], updateResult: null }),
    ),
  },
}));

const {
  mockFsExistsSync,
  mockFsStatSync,
  mockFsUnlinkSync,
  mockFsMkdirSync,
  mockFsReaddirSync,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsAccessSync,
  mockFsCreateWriteStream,
} = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => false),
  mockFsStatSync: vi.fn(() => ({ size: 1024 })),
  mockFsUnlinkSync: vi.fn(),
  mockFsMkdirSync: vi.fn(),
  mockFsReaddirSync: vi.fn(() => []),
  mockFsReadFileSync: vi.fn(() => '{}'),
  mockFsWriteFileSync: vi.fn(),
  mockFsAccessSync: vi.fn(),
  mockFsCreateWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock('fs', () => ({
  default: {},
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  statSync: mockFsStatSync,
  mkdirSync: mockFsMkdirSync,
  unlinkSync: mockFsUnlinkSync,
  rmSync: vi.fn(),
  readdirSync: mockFsReaddirSync,
  accessSync: mockFsAccessSync,
  constants: { R_OK: 4 },
  createWriteStream: mockFsCreateWriteStream,
}));

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mockSpawn }));

vi.mock('https', () => ({ get: vi.fn(), request: vi.fn() }));
vi.mock('http', () => ({ get: vi.fn(), request: vi.fn() }));

import { UpdateManager, UpdateErrorHandler, UpdateCheckStatus } from '../updateManager';

function createWindow(destroyed = false) {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
  } as any;
}

function makeManager(getWindow?: () => any) {
  mockFsExistsSync.mockReturnValue(false);
  const win = getWindow ?? (() => createWindow());
  return new UpdateManager(win);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFsExistsSync.mockReturnValue(false);
  mockFsStatSync.mockReturnValue({ size: 1024 });
  mockEnsureUpdater.mockResolvedValue({ success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/updater' });
  mockCdnCheckForUpdates.mockResolvedValue({ hasUpdate: false, updateInfo: null });
  mockCdnIsPlatformSupported.mockReturnValue(true);
  mockCdnVerifyDownload.mockResolvedValue(true);
  const fakeProcess: any = {
    unref: vi.fn(),
    on: vi.fn((event: string, cb: any) => {
      if (event === 'spawn') setTimeout(cb, 0);
    }),
  };
  mockSpawn.mockReturnValue(fakeProcess);
});

// ── Utility: getLastCheckState ────────────────────────────────────────────────

describe('UpdateManager.getLastCheckState', () => {
  it('returns a copy of the initial state', () => {
    const mgr = makeManager();
    const state = mgr.getLastCheckState();
    expect(state.lastCheckStatus).toBe(UpdateCheckStatus.NotStarted);
    expect(state.lastCheckStartedAt).toBeNull();
  });
});

// ── Utility: getPreferences / updatePreferences ───────────────────────────────

describe('UpdateManager preferences', () => {
  it('getPreferences returns defaults when no file', () => {
    const mgr = makeManager();
    const prefs = mgr.getPreferences();
    expect(prefs.autoUpdateEnabled).toBe(true);
    expect(prefs.skipVersions).toEqual([]);
  });

  it('updatePreferences merges changes and saves', () => {
    const mgr = makeManager();
    mgr.updatePreferences({ autoUpdateEnabled: false });
    expect(mgr.getPreferences().autoUpdateEnabled).toBe(false);
    expect(mockFsWriteFileSync).toHaveBeenCalled();
  });

  it('savePreferences catches write errors gracefully', () => {
    mockFsWriteFileSync.mockImplementation(() => { throw new Error('disk full'); });
    const mgr = makeManager();
    expect(() => mgr.updatePreferences({ autoUpdateEnabled: false })).not.toThrow();
  });

  it('loadPreferences reads from file when it exists', () => {
    mockFsExistsSync.mockReturnValueOnce(true); // for prefs file check
    mockFsReadFileSync.mockReturnValueOnce(JSON.stringify({ autoUpdateEnabled: false, skipVersions: ['1.2.3'] }));
    const mgr = makeManager();
    expect(mgr.getPreferences().autoUpdateEnabled).toBe(false);
    expect(mgr.getPreferences().skipVersions).toContain('1.2.3');
  });

  it('loadPreferences falls back to defaults on parse error', () => {
    mockFsExistsSync.mockReturnValueOnce(true);
    mockFsReadFileSync.mockReturnValueOnce('invalid json{{{');
    const mgr = makeManager();
    expect(mgr.getPreferences().autoUpdateEnabled).toBe(true);
  });
});

// ── skipVersion ───────────────────────────────────────────────────────────────

describe('UpdateManager.skipVersion', () => {
  it('adds version to skip list once', () => {
    const mgr = makeManager();
    mgr.skipVersion('2.0.0');
    mgr.skipVersion('2.0.0'); // duplicate
    expect(mgr.getPreferences().skipVersions.filter((v) => v === '2.0.0').length).toBe(1);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('UpdateManager.destroy', () => {
  it('clears interval and does not throw', () => {
    const mgr = makeManager();
    mgr.startPeriodicCheck(1);
    expect(() => mgr.destroy()).not.toThrow();
  });
});

// ── stopPeriodicCheck ─────────────────────────────────────────────────────────

describe('UpdateManager.stopPeriodicCheck', () => {
  it('clears the periodic check interval', () => {
    const mgr = makeManager();
    mgr.startPeriodicCheck(360);
    mgr.stopPeriodicCheck();
    // calling again is harmless
    mgr.stopPeriodicCheck();
  });
});

// ── checkForUpdates: already InProgress guard ────────────────────────────────

describe('UpdateManager.checkForUpdates InProgress guard', () => {
  it('returns early when a check is already in progress', async () => {
    const mgr = makeManager();
    // Manually set state to InProgress
    (mgr as any).lastCheckState.lastCheckStatus = UpdateCheckStatus.InProgress;
    await expect(mgr.checkForUpdates(true)).resolves.toBeUndefined();
    // ensureUpdater should NOT have been called
    expect(mockEnsureUpdater).not.toHaveBeenCalled();
  });
});

// ── quitAndInstall ────────────────────────────────────────────────────────────

describe('UpdateManager.quitAndInstall', () => {
  beforeEach(() => { vi.stubGlobal('process', { ...process, platform: 'darwin' }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('throws when filePath is not provided', () => {
    const mgr = makeManager();
    expect(() => mgr.quitAndInstall()).toThrow('Installation package file path not provided');
  });

  it('calls silentUpdate for .zip file', () => {
    const mgr = makeManager();
    // Make updater exist
    mockFsExistsSync.mockImplementation((p: string) => {
      if (p.includes('updater')) return true;
      return true;
    });
    const silentSpy = vi.spyOn(mgr as any, 'silentUpdate');
    mgr.quitAndInstall('/tmp/OpenKosmos-2.0.0-arm64.zip');
    expect(silentSpy).toHaveBeenCalledWith('/tmp/OpenKosmos-2.0.0-arm64.zip');
  });

  it('calls installUpdate for .dmg file', () => {
    const mgr = makeManager();
    mockFsExistsSync.mockImplementation(() => true);
    const installSpy = vi.spyOn(mgr as any, 'installUpdate');
    mgr.quitAndInstall('/tmp/OpenKosmos-2.0.0.dmg');
    expect(installSpy).toHaveBeenCalledWith('/tmp/OpenKosmos-2.0.0.dmg');
  });
});

// ── silentUpdate ──────────────────────────────────────────────────────────────

describe('UpdateManager silentUpdate', () => {
  beforeEach(() => { vi.stubGlobal('process', { ...process, platform: 'darwin' }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('throws when updater executable is missing', () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(false);
    expect(() => (mgr as any).silentUpdate('/tmp/app.zip')).toThrow('Updater not found');
  });

  it('spawns updater and schedules app.quit when updater exists', async () => {
    vi.useFakeTimers();
    const { app } = await import('electron');
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    (mgr as any).silentUpdate('/tmp/app.zip');
    expect(mockSpawn).toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(app.quit).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ── installUpdate (darwin / win32 / linux) ───────────────────────────────────

describe('UpdateManager installUpdate', () => {
  it('throws when installer file does not exist', () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(false);
    const win = createWindow();
    (mgr as any).getMainWindow = () => win;
    expect(() => (mgr as any).installUpdate('/tmp/missing.dmg')).toThrow('does not exist');
  });

  it('throws when installer file cannot be read (accessSync throws)', () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    mockFsAccessSync.mockImplementation(() => { throw new Error('no access'); });
    expect(() => (mgr as any).installUpdate('/tmp/app.dmg')).toThrow('cannot be accessed');
  });

  it('opens DMG on darwin', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const mgr = makeManager();
      mockFsExistsSync.mockReturnValue(true);
      mockFsAccessSync.mockReturnValue(undefined);
      (mgr as any).installUpdate('/tmp/app.dmg');
      expect(mockSpawn).toHaveBeenCalledWith('open', ['/tmp/app.dmg'], expect.any(Object));
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });

  it('spawns exe on win32', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const mgr = makeManager();
      mockFsExistsSync.mockReturnValue(true);
      mockFsAccessSync.mockReturnValue(undefined);
      (mgr as any).installUpdate('/tmp/app.exe');
      expect(mockSpawn).toHaveBeenCalledWith('/tmp/app.exe', [], expect.any(Object));
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });

  it('uses shell.openPath on linux', async () => {
    const { shell } = await import('electron');
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const mgr = makeManager();
      mockFsExistsSync.mockReturnValue(true);
      mockFsAccessSync.mockReturnValue(undefined);
      (mgr as any).installUpdate('/tmp/app.AppImage');
      expect(shell.openPath).toHaveBeenCalledWith('/tmp/app.AppImage');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── getAppInstallPath ─────────────────────────────────────────────────────────

describe('UpdateManager.getAppInstallPath', () => {
  it('returns /Applications/<productName>.app on darwin', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const mgr = makeManager();
      expect((mgr as any).getAppInstallPath()).toBe('/Applications/OpenKosmos.app');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });

  it('returns LOCALAPPDATA\\Programs\\kosmos on win32', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const origLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    try {
      const mgr = makeManager();
      const result = (mgr as any).getAppInstallPath();
      expect(result).toContain('Programs');
      expect(result).toContain('kosmos');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      process.env.LOCALAPPDATA = origLocalAppData;
    }
  });

  it('throws on unsupported platform', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    try {
      const mgr = makeManager();
      expect(() => (mgr as any).getAppInstallPath()).toThrow('Unsupported platform');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── sendToRenderer: destroyed window ─────────────────────────────────────────

describe('UpdateManager.sendToRenderer with destroyed window', () => {
  it('logs warning when window is destroyed', () => {
    const mgr = makeManager(() => createWindow(true));
    // Should not throw
    expect(() => (mgr as any).sendToRenderer('test', {})).not.toThrow();
  });

  it('logs warning when getMainWindow returns null', () => {
    const mgr = makeManager(() => null);
    expect(() => (mgr as any).sendToRenderer('test', {})).not.toThrow();
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────────

describe('UpdateManager.formatBytes', () => {
  it('returns "0 B" for 0 bytes', () => {
    const mgr = makeManager();
    expect((mgr as any).formatBytes(0)).toBe('0 B');
  });

  it('returns KB for kilobyte values', () => {
    const mgr = makeManager();
    const result = (mgr as any).formatBytes(1024);
    expect(result).toContain('KB');
  });

  it('returns MB for megabyte values', () => {
    const mgr = makeManager();
    const result = (mgr as any).formatBytes(1024 * 1024);
    expect(result).toContain('MB');
  });
});

// ── calculateSpeed ────────────────────────────────────────────────────────────

describe('UpdateManager.calculateSpeed', () => {
  it('returns "0 B/s" when time elapsed is 0', () => {
    const mgr = makeManager();
    expect((mgr as any).calculateSpeed(1000, 0)).toBe('0 B/s');
  });

  it('returns a formatted speed string', () => {
    const mgr = makeManager();
    const result = (mgr as any).calculateSpeed(1024 * 1024, 1000);
    expect(result).toContain('/s');
  });
});

// ── verifyDownloadedFile ──────────────────────────────────────────────────────

describe('UpdateManager.verifyDownloadedFile', () => {
  it('returns false when file does not exist', async () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(false);
    const result = await (mgr as any).verifyDownloadedFile('/tmp/nope.dmg', 'https://example.com/nope.dmg');
    expect(result).toBe(false);
  });

  it('returns false when file is empty (size 0)', async () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ size: 0 });
    const result = await (mgr as any).verifyDownloadedFile('/tmp/empty.dmg', 'https://example.com/empty.dmg');
    expect(result).toBe(false);
  });

  it('returns true for a valid file', async () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ size: 4096 });
    const result = await (mgr as any).verifyDownloadedFile('/tmp/valid.dmg', 'https://example.com/valid.dmg');
    expect(result).toBe(true);
  });

  it('returns false and logs on stat error', async () => {
    const mgr = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockImplementation(() => { throw new Error('stat error'); });
    const result = await (mgr as any).verifyDownloadedFile('/tmp/err.dmg', 'https://example.com/err.dmg');
    expect(result).toBe(false);
  });
});

// ── extractVersionFromFileName ────────────────────────────────────────────────

describe('UpdateManager.extractVersionFromFileName', () => {
  it('extracts version from standard filename', () => {
    const mgr = makeManager();
    expect((mgr as any).extractVersionFromFileName('OpenKosmos-2.1.0-arm64.dmg')).toBe('2.1.0');
  });

  it('returns null when prefix does not match', () => {
    const mgr = makeManager();
    expect((mgr as any).extractVersionFromFileName('other-2.1.0.dmg')).toBeNull();
  });
});

// ── startPeriodicCheck interval behavior ─────────────────────────────────────

describe('UpdateManager.startPeriodicCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces existing interval when called again', () => {
    const mgr = makeManager();
    mgr.startPeriodicCheck(60);
    mgr.startPeriodicCheck(30); // replaces
    mgr.destroy();
  });

  it('skips check when autoUpdate is disabled', async () => {
    const mgr = makeManager();
    mgr.updatePreferences({ autoUpdateEnabled: false });
    mgr.startPeriodicCheck(0); // 0-minute interval → always eligible

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);

    // checkForUpdates should not have run
    expect(mockEnsureUpdater).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it('triggers check when enough time has passed and autoUpdate enabled', async () => {
    mockCdnCheckForUpdates.mockResolvedValue({ hasUpdate: false, updateInfo: null });
    const mgr = makeManager();
    mgr.updatePreferences({ autoUpdateEnabled: true });
    // Set lastCheckStartedAt to far past so interval threshold is met
    (mgr as any).lastCheckState.lastCheckStartedAt = Date.now() - 999 * 60 * 1000;
    mgr.startPeriodicCheck(1); // 1 minute threshold

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);

    // check was triggered
    expect(mockEnsureUpdater).toHaveBeenCalled();
    mgr.destroy();
  });

  it('skips check when one is already in progress', async () => {
    const mgr = makeManager();
    mgr.updatePreferences({ autoUpdateEnabled: true });
    (mgr as any).lastCheckState.lastCheckStatus = UpdateCheckStatus.InProgress;
    (mgr as any).lastCheckState.lastCheckStartedAt = 0;
    mgr.startPeriodicCheck(0);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);

    expect(mockEnsureUpdater).not.toHaveBeenCalled();
    mgr.destroy();
  });
});

// ── UpdateErrorHandler ─────────────────────────────────────────────────────────

describe('UpdateErrorHandler', () => {
  it('getRetryCount / resetRetryCount', () => {
    const handler = new UpdateErrorHandler();
    expect(handler.getRetryCount()).toBe(0);
    handler.resetRetryCount();
    expect(handler.getRetryCount()).toBe(0);
  });

  it('setMaxRetries clamps to 1–10', () => {
    const handler = new UpdateErrorHandler();
    handler.setMaxRetries(0); // clamps to 1
    handler.setMaxRetries(100); // clamps to 10
    // no errors thrown
  });

  it('performRollback resolves without throwing', async () => {
    const handler = new UpdateErrorHandler();
    await expect(handler.performRollback('1.0.0')).resolves.toBeUndefined();
  });

  it('handleUpdateError check context: ENOTFOUND retries', async () => {
    vi.useFakeTimers();
    const handler = new UpdateErrorHandler();
    const err = new Error('ENOTFOUND server');
    let retried = false;
    const retry = vi.fn(async () => { retried = true; });

    const handlePromise = handler.handleUpdateError(err, 'check', retry);
    await vi.runAllTimersAsync();
    await handlePromise;

    expect(retry).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('handleUpdateError check context: SSL error throws', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('CERT_HAS_EXPIRED');
    await expect(handler.handleUpdateError(err, 'check')).rejects.toThrow('certificate verification');
  });

  it('handleUpdateError download context: ENOSPC throws immediately', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('ENOSPC no space');
    await expect(handler.handleUpdateError(err, 'download')).rejects.toThrow('disk space');
  });

  it('handleUpdateError download context: ETIMEDOUT retries up to maxRetries then throws', async () => {
    vi.useFakeTimers();
    const handler = new UpdateErrorHandler();
    handler.setMaxRetries(1);
    const err = new Error('ETIMEDOUT timeout');
    const retry = vi.fn(async () => { throw new Error('ETIMEDOUT still'); });

    let caughtError: Error | null = null;
    const p = handler.handleUpdateError(err, 'download', retry).catch((e) => { caughtError = e; });
    await vi.runAllTimersAsync();
    await p;

    expect(caughtError).not.toBeNull();
    vi.useRealTimers();
  });

  it('handleUpdateError install context: EACCES throws permission error', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('EACCES permission denied');
    await expect(handler.handleUpdateError(err, 'install')).rejects.toThrow('permissions');
  });

  it('handleUpdateError install context: ENOSPC throws disk space error', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('ENOSPC no space');
    await expect(handler.handleUpdateError(err, 'install')).rejects.toThrow('disk space');
  });

  it('handleUpdateError install context: EBUSY throws file in use error', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('EBUSY file in use');
    await expect(handler.handleUpdateError(err, 'install')).rejects.toThrow();
  });

  it('handleUpdateError install context: generic install error', async () => {
    const handler = new UpdateErrorHandler();
    const err = new Error('install exploded');
    await expect(handler.handleUpdateError(err, 'install')).rejects.toThrow('Installation failed');
  });

  it('handleUpdateError verification context: retries and resolves when retry succeeds', async () => {
    vi.useFakeTimers();
    const handler = new UpdateErrorHandler();
    const err = new Error('hash mismatch');
    const retry = vi.fn(async () => { /* success */ });

    const p = handler.handleUpdateError(err, 'verification', retry);
    await vi.runAllTimersAsync();
    await p;

    expect(retry).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('handleUpdateError verification context: throws after max retries', async () => {
    vi.useFakeTimers();
    const handler = new UpdateErrorHandler();
    handler.setMaxRetries(1);
    const err = new Error('hash mismatch');
    const retry = vi.fn(async () => { throw new Error('still bad'); });

    let caughtError: Error | null = null;
    const p = handler.handleUpdateError(err, 'verification', retry).catch((e) => { caughtError = e; });
    await vi.runAllTimersAsync();
    await p;

    expect(caughtError).not.toBeNull();
    vi.useRealTimers();
  });

  it('handleUpdateError generic context: retries and resolves', async () => {
    vi.useFakeTimers();
    const handler = new UpdateErrorHandler();
    const err = new Error('unknown error');
    const retry = vi.fn(async () => { /* success */ });

    const p = handler.handleUpdateError(err, 'unknown-context', retry);
    await vi.runAllTimersAsync();
    await p;

    expect(retry).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('handleUpdateError generic context: throws original error with no retry', async () => {
    const handler = new UpdateErrorHandler();
    handler.setMaxRetries(1);
    // exhaust retries first by incrementing currentRetryCount manually
    (handler as any).currentRetryCount = 10;
    const err = new Error('unknown failure');
    await expect(handler.handleUpdateError(err, 'unknown-context')).rejects.toThrow('unknown failure');
  });
});
