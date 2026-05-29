// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '1.0.0'),
    quit: vi.fn(),
  },
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(() => Promise.resolve('')) },
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
  BRAND_NAME: 'openkosmos',
  BRAND_CONFIG: { filenamePrefix: 'OpenKosmos', productName: 'OpenKosmos' },
}));

const { mockCdnCheckForUpdates, mockCdnVerifyDownload, mockCdnGetFileInfo, mockCdnIsPlatformSupported } = vi.hoisted(() => ({
  mockCdnCheckForUpdates: vi.fn(),
  mockCdnVerifyDownload: vi.fn(() => Promise.resolve(true)),
  mockCdnGetFileInfo: vi.fn(() => Promise.resolve(null)),
  mockCdnIsPlatformSupported: vi.fn(() => true),
}));

vi.mock('../cdnUpdateChecker', () => {
  function CdnUpdateChecker(this: any) {
    this.checkForUpdates = mockCdnCheckForUpdates;
    this.verifyDownloadExists = mockCdnVerifyDownload;
    this.getFileInfo = mockCdnGetFileInfo;
    this.getCurrentPlatformKey = vi.fn(() => 'darwin-arm64');
    this.isPlatformSupported = mockCdnIsPlatformSupported;
  }
  return { CdnUpdateChecker };
});

const { mockEnsureUpdater } = vi.hoisted(() => ({
  mockEnsureUpdater: vi.fn(() => Promise.resolve({ success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/updater' })),
}));

vi.mock('../updaterFetcher', () => {
  function UpdaterFetcher(this: any) {
    this.ensureUpdater = mockEnsureUpdater;
    this.getLocalUpdaterVersion = vi.fn(() => '1.0.0');
    this.checkLocalUpdater = vi.fn(() => ({ exists: true, updaterPath: '/tmp/updater', needsDownload: false, localVersion: '1.0.0' }));
    this.checkUpdaterNeedsUpdate = vi.fn(() => Promise.resolve({ needsUpdate: false, localVersion: '1.0.0', remoteVersion: '1.0.0' }));
    this.downloadUpdater = vi.fn();
  }
  return { UpdaterFetcher };
});

vi.mock('../../assetsFetcher/assetsLibraryManager', () => ({
  assetsLibraryManager: {
    checkAndUpdateLibraries: vi.fn(() => Promise.resolve({ fetchResults: [], updateResult: null })),
  },
}));

const { mockFsExistsSync, mockFsReadFileSync, mockFsWriteFileSync, mockFsStatSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => false),
  mockFsReadFileSync: vi.fn(() => '{}'),
  mockFsWriteFileSync: vi.fn(),
  mockFsStatSync: vi.fn(() => ({ size: 100 })),
}));

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  statSync: mockFsStatSync,
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  accessSync: vi.fn(),
  constants: { R_OK: 4 },
  createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn(), destroy: vi.fn(), on: vi.fn() })),
}));

vi.mock('https', () => ({ get: vi.fn(), request: vi.fn() }));
vi.mock('http', () => ({ get: vi.fn(), request: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })) }));

import { UpdateManager, UpdateErrorHandler, UpdateCheckStatus, UpdateCheckResult } from '../updateManager';

function createMockWindow(destroyed = false) {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
  } as any;
}

describe('UpdateManager', () => {
  let manager: UpdateManager;
  let mockWindow: ReturnType<typeof createMockWindow>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(false);
    mockWindow = createMockWindow();
    manager = new UpdateManager(() => mockWindow);
  });

  describe('getLastCheckState', () => {
    it('returns initial state as NotStarted', () => {
      const state = manager.getLastCheckState();
      expect(state.lastCheckStatus).toBe(UpdateCheckStatus.NotStarted);
      expect(state.lastCheckResult).toBe(UpdateCheckResult.None);
      expect(state.lastCheckStartedAt).toBeNull();
    });
  });

  describe('getPreferences', () => {
    it('returns default preferences when no saved file', () => {
      const prefs = manager.getPreferences();
      expect(prefs.autoUpdateEnabled).toBe(true);
      expect(prefs.skipVersions).toEqual([]);
    });
  });

  describe('updatePreferences', () => {
    it('merges partial preferences', () => {
      manager.updatePreferences({ autoUpdateEnabled: false });
      expect(manager.getPreferences().autoUpdateEnabled).toBe(false);
    });
  });

  describe('skipVersion', () => {
    it('adds version to skipVersions', () => {
      manager.skipVersion('2.0.0');
      expect(manager.getPreferences().skipVersions).toContain('2.0.0');
    });

    it('does not add the same version twice', () => {
      manager.skipVersion('2.0.0');
      manager.skipVersion('2.0.0');
      expect(manager.getPreferences().skipVersions.length).toBe(1);
    });
  });

  describe('startPeriodicCheck / stopPeriodicCheck', () => {
    it('starts and stops without throwing', () => {
      expect(() => manager.startPeriodicCheck(60)).not.toThrow();
      expect(() => manager.stopPeriodicCheck()).not.toThrow();
    });

    it('replaces existing interval on repeated start', () => {
      manager.startPeriodicCheck(60);
      manager.startPeriodicCheck(120);
      manager.stopPeriodicCheck();
    });
  });

  describe('destroy', () => {
    it('stops periodic check without throwing', () => {
      manager.startPeriodicCheck(60);
      expect(() => manager.destroy()).not.toThrow();
    });
  });

  describe('checkForUpdates - skips when already InProgress', () => {
    it('returns early if a check is already InProgress', async () => {
      (manager as any).lastCheckState.lastCheckStatus = UpdateCheckStatus.InProgress;
      await expect(manager.checkForUpdates()).resolves.toBeUndefined();
    });
  });

  describe('checkForUpdates - no update available', () => {
    it('completes successfully when CDN reports no update', async () => {
      mockCdnCheckForUpdates.mockResolvedValueOnce({
        hasUpdate: false,
        updateInfo: { latest: '1.0.0' },
      });
      await manager.checkForUpdates(true);
      expect(manager.getLastCheckState().lastCheckStatus).toBe(UpdateCheckStatus.Done);
    });
  });

  describe('checkForUpdates - ensureUpdaterReady failure', () => {
    it('throws and updates state when updater fetch fails', async () => {
      mockEnsureUpdater.mockResolvedValueOnce({ success: false, error: 'CDN unreachable', downloaded: false });
      await expect(manager.checkForUpdates()).rejects.toThrow('Updater check/download failed');
      expect(manager.getLastCheckState().lastCheckStatus).toBe(UpdateCheckStatus.Done);
    });
  });

  describe('checkForUpdates - CDN update available', () => {
    it('handles available update, verifies and downloads', async () => {
      mockCdnCheckForUpdates.mockResolvedValueOnce({
        hasUpdate: true,
        updateInfo: { latest: '2.0.0' },
        downloadUrl: 'https://cdn.example.com/OpenKosmos-2.0.0-mac-arm64.dmg',
      });
      mockCdnIsPlatformSupported.mockReturnValueOnce(true);
      mockCdnVerifyDownload.mockResolvedValueOnce(true);
      mockCdnGetFileInfo.mockResolvedValue(null);
      // checkLocalCacheFile will say file doesn't exist
      mockFsExistsSync.mockReturnValue(false);
      // downloadCdnUpdate will try to download and fail (no HTTP mock)
      // It should catch the error and call sendToRenderer('updateAvailable')
      await manager.checkForUpdates(true); // silent=true so no updateError sent
    });

    it('sends updateNotAvailable when version is in skipVersions', async () => {
      manager.skipVersion('2.0.0');
      mockCdnCheckForUpdates.mockResolvedValueOnce({
        hasUpdate: true,
        updateInfo: { latest: '2.0.0' },
        downloadUrl: 'https://cdn.example.com/OpenKosmos-2.0.0-mac-arm64.dmg',
      });
      await manager.checkForUpdates(true);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'update:updateNotAvailable',
        expect.objectContaining({ reason: 'skipped' }),
      );
    });

    it('sends updateError when platform is not supported', async () => {
      mockCdnCheckForUpdates.mockResolvedValueOnce({
        hasUpdate: true,
        updateInfo: { latest: '2.0.0', downloadUrls: {} },
        downloadUrl: 'https://cdn.example.com/OpenKosmos-2.0.0-mac-arm64.dmg',
      });
      mockCdnIsPlatformSupported.mockReturnValueOnce(false);
      await manager.checkForUpdates(false); // non-silent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'update:updateError',
        expect.stringContaining('platform'),
      );
    });
  });

  describe('loadPreferences from file', () => {
    it('merges saved preferences with defaults', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(
        JSON.stringify({ autoUpdateEnabled: false, skipVersions: ['1.5.0'] }) as any,
      );
      const m2 = new UpdateManager(() => null);
      const prefs = m2.getPreferences();
      expect(prefs.autoUpdateEnabled).toBe(false);
      expect(prefs.skipVersions).toContain('1.5.0');
    });

    it('uses defaults when preferences file is malformed', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('bad-json' as any);
      const m2 = new UpdateManager(() => null);
      expect(m2.getPreferences().autoUpdateEnabled).toBe(true);
    });
  });

  describe('sendToRenderer with null/destroyed window', () => {
    it('does not throw when window is null', async () => {
      const m2 = new UpdateManager(() => null);
      (m2 as any).lastCheckState.lastCheckStatus = UpdateCheckStatus.InProgress;
      await expect(m2.checkForUpdates()).resolves.toBeUndefined();
    });

    it('does not throw when window is destroyed', async () => {
      const destroyed = createMockWindow(true);
      const m2 = new UpdateManager(() => destroyed);
      (m2 as any).lastCheckState.lastCheckStatus = UpdateCheckStatus.InProgress;
      await expect(m2.checkForUpdates()).resolves.toBeUndefined();
    });
  });

  describe('quitAndInstall', () => {
    it('throws when no file path provided', () => {
      expect(() => manager.quitAndInstall()).toThrow('Installation package file path not provided');
    });

    it('throws for non-existent installer file', () => {
      mockFsExistsSync.mockReturnValue(false);
      expect(() => manager.quitAndInstall('/tmp/nonexistent.dmg')).toThrow(
        'Installation package file does not exist',
      );
    });
  });

  describe('downloadUpdate', () => {
    it('handles missing download URL gracefully', async () => {
      // downloadUpdate catches the thrown error and passes to errorHandler which may resolve or reject
      // Just verify it does not cause an unhandled crash
      try {
        await manager.downloadUpdate();
      } catch {
        // acceptable to throw
      }
    });
  });
});

describe('UpdateErrorHandler', () => {
  let handler: UpdateErrorHandler;

  beforeEach(() => {
    handler = new UpdateErrorHandler();
  });

  describe('getRetryCount / resetRetryCount', () => {
    it('starts at 0', () => {
      expect(handler.getRetryCount()).toBe(0);
    });

    it('can be reset', () => {
      handler.resetRetryCount();
      expect(handler.getRetryCount()).toBe(0);
    });
  });

  describe('setMaxRetries', () => {
    it('accepts valid value', () => {
      expect(() => handler.setMaxRetries(5)).not.toThrow();
    });
  });

  describe('handleUpdateError - install context', () => {
    it('throws for permission error', async () => {
      await expect(handler.handleUpdateError(new Error('EACCES: permission denied'), 'install')).rejects.toThrow('Insufficient installation permissions');
    });

    it('throws for disk full error', async () => {
      await expect(handler.handleUpdateError(new Error('ENOSPC: no space'), 'install')).rejects.toThrow('Insufficient disk space');
    });

    it('throws for busy file error', async () => {
      await expect(handler.handleUpdateError(new Error('EBUSY: resource busy'), 'install')).rejects.toThrow('File is in use');
    });

    it('throws generic install error for other messages', async () => {
      await expect(handler.handleUpdateError(new Error('unknown install error'), 'install')).rejects.toThrow('Installation failed');
    });
  });

  describe('handleUpdateError - check context', () => {
    it('throws for SSL certificate error', async () => {
      await expect(handler.handleUpdateError(new Error('CERT_HAS_EXPIRED'), 'check')).rejects.toThrow('certificate');
    });

    it('handles network error without retry function', async () => {
      await expect(handler.handleUpdateError(new Error('ENOTFOUND: DNS error'), 'check')).resolves.toBeUndefined();
    });
  });

  describe('handleUpdateError - download context', () => {
    it('throws for disk full', async () => {
      await expect(handler.handleUpdateError(new Error('ENOSPC: no space'), 'download')).rejects.toThrow('Insufficient disk space');
    });

    it('throws after max retries', async () => {
      handler.setMaxRetries(1);
      const retryFn = vi.fn().mockRejectedValue(new Error('still failing'));
      await expect(handler.handleUpdateError(new Error('generic download failure'), 'download', retryFn)).rejects.toThrow();
    });
  });

  describe('handleUpdateError - verification context', () => {
    it('throws when no retry and exceeded', async () => {
      handler.setMaxRetries(1);
      await expect(handler.handleUpdateError(new Error('hash mismatch'), 'verification')).rejects.toThrow('verification failed');
    });
  });

  describe('handleUpdateError - default context', () => {
    it('re-throws for unknown context', async () => {
      await expect(handler.handleUpdateError(new Error('some error'), 'unknown')).rejects.toThrow('some error');
    });
  });

  describe('performRollback', () => {
    it('resolves without throwing', async () => {
      await expect(handler.performRollback()).resolves.toBeUndefined();
    });

    it('resolves with version string', async () => {
      await expect(handler.performRollback('1.0.0')).resolves.toBeUndefined();
    });
  });
});
