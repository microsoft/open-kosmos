// @ts-nocheck
/**
 * updateManager.deep2.test.ts
 *
 * Targets remaining uncovered lines in updateManager.ts (round 2):
 * - Constructor CDN checker init failure (lines 116-121)
 * - setupAutoUpdater warn when CDN not used (line 130)
 * - checkForUpdates CDN-not-enabled throw path (line 180)
 * - ensureUpdaterReady download progress callback (lines 245-253)
 * - checkCdnUpdates: checker-not-initialized (lines 294-296)
 * - checkCdnUpdates: no downloadUrl (lines 342-344)
 * - checkCdnUpdates: file does not exist (lines 353-357)
 * - checkCdnUpdates: cache hit + valid → immediate notify (lines 376-390)
 * - checkCdnUpdates: cache hit + invalid → cleanup and re-download (lines 391-398)
 * - checkCdnUpdates: download error fallback (lines 406-426)
 * - checkCdnUpdates: error path + silent check (lines 441-463)
 * - downloadUpdate URL provided (line 477)
 * - downloadUpdate retry + rethrow (lines 490, 495)
 * - extractVersionFromFileName error catch (lines 594-600)
 * - downloadCdnUpdate: mkdir when dir missing (line 691); valid cache hit (lines 736-755); re-download after invalid (lines 740-742)
 * - downloadCdnUpdate: verify fail after download (lines 770-772)
 * - checkCdnUpdates: platform not supported path (lines 326-338)
 * - checkCdnUpdates: skipped version path (lines 308-317)
 * - UpdateErrorHandler: install context (EACCES, ENOSPC, EBUSY) + generic (lines 1505-1527)
 * - UpdateErrorHandler: performRollback (lines 1569-1590)
 * - UpdateManager.destroy, savePreferences error, loadPreferences success
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-um-deep2'),
    getVersion: vi.fn(() => '1.0.0'),
    quit: vi.fn(),
  },
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(() => Promise.resolve('')) },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('../../../shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
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

const { mockCdnConstructorThrow } = vi.hoisted(() => ({
  mockCdnConstructorThrow: { shouldThrow: false },
}));

vi.mock('../cdnUpdateChecker', () => {
  function CdnUpdateChecker(this: any, url: string) {
    if (mockCdnConstructorThrow.shouldThrow) {
      throw new Error('CDN init failed');
    }
    this.checkForUpdates = mockCdnCheckForUpdates;
    this.verifyDownloadExists = mockCdnVerifyDownload;
    this.getFileInfo = mockCdnGetFileInfo;
    this.getCurrentPlatformKey = mockGetCurrentPlatformKey;
    this.isPlatformSupported = mockCdnIsPlatformSupported;
  }
  return { CdnUpdateChecker };
});

const { mockEnsureUpdater } = vi.hoisted(() => ({
  mockEnsureUpdater: vi.fn(() => Promise.resolve({
    success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/updater',
  })),
}));

vi.mock('../updaterFetcher', () => {
  function UpdaterFetcher(this: any) {
    this.ensureUpdater = mockEnsureUpdater;
  }
  return { UpdaterFetcher };
});

vi.mock('../../assetsFetcher/assetsLibraryManager', () => ({
  assetsLibraryManager: {
    checkAndUpdateLibraries: vi.fn(() => Promise.resolve({
      fetchResults: [],
      updateResult: null,
    })),
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
    write: vi.fn(), end: vi.fn(), destroy: vi.fn(), on: vi.fn(),
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

const { mockHttpsGet } = vi.hoisted(() => ({ mockHttpsGet: vi.fn() }));
vi.mock('https', () => ({ get: mockHttpsGet, request: vi.fn() }));
vi.mock('http', () => ({ get: vi.fn(), request: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })) }));

import { UpdateManager, UpdateErrorHandler, UpdateCheckStatus } from '../updateManager';

function createMockWindow(destroyed = false) {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
  } as any;
}

function makeManager(windowFactory?: () => any) {
  mockFsExistsSync.mockReturnValue(false);
  mockCdnConstructorThrow.shouldThrow = false;
  return new UpdateManager(windowFactory ?? (() => createMockWindow()));
}

// ─────────────────────────────────────────────────────────────
// CDN checker init failure (constructor catch)
// ─────────────────────────────────────────────────────────────
describe('UpdateManager constructor - CDN checker init failure', () => {
  afterEach(() => { mockCdnConstructorThrow.shouldThrow = false; });

  it('sets useCdnUpdates=false when CdnUpdateChecker constructor throws', () => {
    mockCdnConstructorThrow.shouldThrow = true;
    const manager = new UpdateManager(() => createMockWindow());
    expect((manager as any).useCdnUpdates).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// setupAutoUpdater - CDN not enabled path
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.setupAutoUpdater - CDN not used', () => {
  it('logs warn when CDN updates are not enabled', () => {
    mockCdnConstructorThrow.shouldThrow = true;
    const manager = new UpdateManager(() => createMockWindow());
    // setupAutoUpdater is called during construction; verify logger was called
    // (logger is mocked; we just check no throw)
    expect(() => (manager as any).setupAutoUpdater()).not.toThrow();
    mockCdnConstructorThrow.shouldThrow = false;
  });
});

// ─────────────────────────────────────────────────────────────
// checkForUpdates - CDN not enabled throw
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkForUpdates - CDN not enabled', () => {
  it('throws when useCdnUpdates is false', async () => {
    const manager = makeManager();
    (manager as any).useCdnUpdates = false;
    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    await expect(manager.checkForUpdates()).rejects.toThrow('CDN update mode is not enabled');
  });
});

// ─────────────────────────────────────────────────────────────
// ensureUpdaterReady - download progress callback
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.ensureUpdaterReady - progress callback', () => {
  it('sends downloadingUpdater phase when progress callback fires', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockEnsureUpdater.mockImplementationOnce(async (progressCb: any) => {
      // Invoke the progress callback
      progressCb({ percent: 50, transferred: 1024, total: 2048 });
      progressCb({ percent: 100, transferred: 2048, total: 2048 });
      return { success: true, downloaded: true, version: '2.0.0', updaterPath: '/tmp/u' };
    });

    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: false,
      updateInfo: { latest: '1.0.0' },
    });

    await manager.checkForUpdates(true);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:checkPhaseChanged',
      { phase: 'downloadingUpdater' },
    );
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updaterDownloadProgress',
      expect.objectContaining({ percent: 50 }),
    );
  });

  it('throws when ensureUpdater returns success=false', async () => {
    const manager = makeManager();
    mockEnsureUpdater.mockResolvedValueOnce({
      success: false, error: 'network error',
    });
    await expect(manager.checkForUpdates()).rejects.toThrow('Updater check/download failed');
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - checker not initialized
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - checker not initialized', () => {
  it('throws when cdnUpdateChecker is null (called directly)', async () => {
    const manager = makeManager();
    (manager as any).cdnUpdateChecker = null;
    await expect((manager as any).checkCdnUpdates()).rejects.toThrow('CDN update checker not initialized');
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - skipped version
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - skipped version', () => {
  it('sends updateNotAvailable with reason skipped when version is in skipVersions', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);
    manager.updatePreferences({ skipVersions: ['2.0.0'] });

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0', releaseNotes: '', releaseDate: '' },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    await manager.checkForUpdates(true);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateNotAvailable',
      expect.objectContaining({ reason: 'skipped' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - platform not supported
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - platform not supported', () => {
  it('sends updateError when platform is not supported', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);
    mockCdnIsPlatformSupported.mockReturnValueOnce(false);

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0', downloadUrls: {} },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    await manager.checkForUpdates(true);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateError',
      expect.stringContaining('does not support'),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - no downloadUrl
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - no downloadUrl', () => {
  it('throws when downloadUrl is empty', async () => {
    const manager = makeManager();

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0' },
      downloadUrl: '',
    });

    await expect(manager.checkForUpdates(true)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - verifyDownloadExists returns false
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - file does not exist on CDN', () => {
  it('throws when verifyDownloadExists returns false', async () => {
    const manager = makeManager();
    mockCdnVerifyDownload.mockResolvedValueOnce(false);

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0' },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    await expect(manager.checkForUpdates(true)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - cache hit + valid file → immediate updateDownloaded
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - cache hit valid', () => {
  it('sends updateDownloaded immediately when valid local cache exists', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    // Make verifyDownloadExists pass
    mockCdnVerifyDownload.mockResolvedValue(true);

    // Local file exists and is valid
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ size: 10240 });

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0', releaseNotes: 'notes', releaseDate: '2026-01-01' },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    await manager.checkForUpdates(true);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateDownloaded',
      expect.objectContaining({ fromCache: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - cache hit + invalid → cleanup and re-download
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - cache hit but invalid', () => {
  it('cleans up and re-downloads when local cache fails verification', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockCdnVerifyDownload.mockResolvedValue(true);

    // File exists but is "empty" (invalid)
    mockFsExistsSync.mockImplementation((p: string) => {
      // First call (cache dir) => true, second (filePath) => true, cleanup exist => true
      return true;
    });
    mockFsStatSync.mockImplementation(() => ({ size: 0 })); // empty = invalid

    // downloadFile needs to succeed — mock createWriteStream + https.get
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-length': '1024' },
      on: vi.fn((event: string, cb: any) => {
        if (event === 'end') setTimeout(cb, 0);
      }),
    };
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      cb(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn() };
    });

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0' },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    // Since download will fail (no real file), just confirm it proceeds beyond cleanup
    await manager.checkForUpdates(true).catch(() => {/* expected */});

    // At minimum the unlink (cleanup) should have been called for the empty file
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - download fails → fallback updateAvailable
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - download error fallback', () => {
  it('sends updateAvailable when silent download fails', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockCdnVerifyDownload.mockResolvedValue(true);
    mockFsExistsSync.mockReturnValue(false); // no cache file

    // Spy downloadCdnUpdate to throw
    vi.spyOn(manager as any, 'downloadCdnUpdate').mockRejectedValueOnce(
      new Error('network error'),
    );

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      updateInfo: { latest: '2.0.0', releaseNotes: '', releaseDate: '' },
      downloadUrl: 'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
    });

    await manager.checkForUpdates(true);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateAvailable',
      expect.objectContaining({ version: '2.0.0' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// checkCdnUpdates - error path: non-silent check sends updateError
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.checkCdnUpdates - error in non-silent check', () => {
  it('sends updateError to renderer for non-silent checks', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockRejectedValueOnce(new Error('check failed'));

    await expect(manager.checkForUpdates(false)).rejects.toThrow();

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateError',
      expect.any(String),
    );
  });

  it('does NOT send updateError for silent checks', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockEnsureUpdater.mockResolvedValueOnce({
      success: true, downloaded: false, version: '1.0.0', updaterPath: '/tmp/u',
    });
    mockCdnCheckForUpdates.mockRejectedValueOnce(new Error('silent check failed'));

    await expect(manager.checkForUpdates(true)).rejects.toThrow();

    const calls = (mockWindow.webContents.send as any).mock.calls;
    const updateErrorCalls = calls.filter((c: any[]) => c[0] === 'update:updateError');
    expect(updateErrorCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// downloadUpdate - URL provided path
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.downloadUpdate - URL provided', () => {
  it('calls downloadCdnUpdate with the provided URL', async () => {
    const manager = makeManager();
    const spy = vi.spyOn(manager as any, 'downloadCdnUpdate').mockResolvedValueOnce(undefined);

    await manager.downloadUpdate('https://cdn/OpenKosmos-2.0.0-arm64.dmg', {
      latest: '2.0.0',
    });

    expect(spy).toHaveBeenCalledWith(
      'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
      { latest: '2.0.0' },
    );
  });

  it('throws when no URL provided', async () => {
    const manager = makeManager();
    // downloadUpdate will call errorHandler.handleUpdateError which will rethrow
    const spy = vi.spyOn((manager as any).errorHandler, 'handleUpdateError')
      .mockRejectedValueOnce(new Error('Download URL not provided'));
    await expect(manager.downloadUpdate()).rejects.toThrow();
  });

  it('retries via errorHandler when downloadCdnUpdate fails', async () => {
    const manager = makeManager();
    const downloadSpy = vi.spyOn(manager as any, 'downloadCdnUpdate')
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined);

    const handlerSpy = vi.spyOn((manager as any).errorHandler, 'handleUpdateError')
      .mockResolvedValueOnce(undefined);

    await manager.downloadUpdate('https://cdn/OpenKosmos-2.0.0-arm64.dmg');
    expect(handlerSpy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// extractVersionFromFileName - error catch
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.extractVersionFromFileName - error catch', () => {
  it('returns null and logs error when an exception is thrown', () => {
    const manager = makeManager();
    // Pass a non-string to trigger an error inside
    const result = (manager as any).extractVersionFromFileName(null);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// downloadCdnUpdate - mkdir when dir missing
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.downloadCdnUpdate - mkdir when dir missing', () => {
  it('creates cache directory if it does not exist', async () => {
    const manager = makeManager();
    let mkdirCalled = false;
    mockFsExistsSync.mockReturnValue(false);
    mockFsMkdirSync.mockImplementationOnce(() => { mkdirCalled = true; });

    // Make downloadFile throw quickly to short-circuit
    vi.spyOn(manager as any, 'downloadFile').mockRejectedValueOnce(new Error('dl fail'));

    await expect(
      (manager as any).downloadCdnUpdate('https://cdn/OpenKosmos-2.0.0-arm64.dmg', { latest: '2.0.0' }),
    ).rejects.toThrow();

    expect(mkdirCalled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// downloadCdnUpdate - valid cache hit
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.downloadCdnUpdate - valid cache hit', () => {
  it('sends updateDownloaded from cache when file is valid', async () => {
    const mockWindow = createMockWindow();
    const manager = makeManager(() => mockWindow);

    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ size: 10240 });

    await (manager as any).downloadCdnUpdate(
      'https://cdn/OpenKosmos-2.0.0-arm64.dmg',
      { latest: '2.0.0', releaseNotes: 'notes', releaseDate: '2026-01-01' },
    );

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'update:updateDownloaded',
      expect.objectContaining({ fromCache: true, version: '2.0.0' }),
    );
  });

  it('re-downloads when local cache fails verification', async () => {
    const manager = makeManager();
    mockFsExistsSync.mockReturnValue(true);
    // Make verifyDownloadedFile return false by using empty file
    mockFsStatSync.mockReturnValue({ size: 0 });

    const downloadFileSpy = vi.spyOn(manager as any, 'downloadFile')
      .mockRejectedValueOnce(new Error('download fail'));

    await expect(
      (manager as any).downloadCdnUpdate('https://cdn/OpenKosmos-2.0.0-arm64.dmg', { latest: '2.0.0' }),
    ).rejects.toThrow();

    expect(downloadFileSpy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// downloadCdnUpdate - verify fails after download
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.downloadCdnUpdate - verify fails after download', () => {
  it('throws when downloaded file fails verification', async () => {
    const manager = makeManager();
    // Cache miss
    mockFsExistsSync.mockReturnValueOnce(false); // dir missing check
    mockFsExistsSync.mockReturnValueOnce(false); // file missing (cache miss)

    vi.spyOn(manager as any, 'downloadFile').mockResolvedValueOnce(undefined);
    vi.spyOn(manager as any, 'verifyDownloadedFile').mockResolvedValueOnce(false);

    await expect(
      (manager as any).downloadCdnUpdate('https://cdn/OpenKosmos-2.0.0-arm64.dmg'),
    ).rejects.toThrow('verification failed');
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateManager.destroy
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.destroy', () => {
  it('calls stopPeriodicCheck', () => {
    const manager = makeManager();
    const stopSpy = vi.spyOn(manager, 'stopPeriodicCheck');
    manager.destroy();
    expect(stopSpy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// savePreferences - error path
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.savePreferences - error path', () => {
  it('does not throw when writeFileSync fails', () => {
    const manager = makeManager();
    mockFsWriteFileSync.mockImplementationOnce(() => { throw new Error('write error'); });
    expect(() => (manager as any).savePreferences()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// loadPreferences - saved file exists
// ─────────────────────────────────────────────────────────────
describe('UpdateManager.loadPreferences - saved file exists', () => {
  it('merges saved preferences with defaults', () => {
    const manager = makeManager();
    mockFsExistsSync.mockReturnValueOnce(true);
    mockFsReadFileSync.mockReturnValueOnce(JSON.stringify({ autoUpdateEnabled: false }));
    const prefs = (manager as any).loadPreferences();
    expect(prefs.autoUpdateEnabled).toBe(false);
    expect(Array.isArray(prefs.skipVersions)).toBe(true);
  });

  it('returns defaults when readFileSync throws', () => {
    const manager = makeManager();
    mockFsExistsSync.mockReturnValueOnce(true);
    mockFsReadFileSync.mockImplementationOnce(() => { throw new Error('parse error'); });
    const prefs = (manager as any).loadPreferences();
    expect(prefs.autoUpdateEnabled).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - install context errors
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler - install context', () => {
  let handler: UpdateErrorHandler;
  beforeEach(() => { handler = new UpdateErrorHandler(); });

  it('throws "Insufficient installation permissions" for EACCES', async () => {
    await expect(
      handler.handleUpdateError(new Error('EACCES permission denied'), 'install'),
    ).rejects.toThrow('Insufficient installation permissions');
  });

  it('throws "Insufficient disk space" for ENOSPC', async () => {
    await expect(
      handler.handleUpdateError(new Error('ENOSPC no space left'), 'install'),
    ).rejects.toThrow('Insufficient disk space');
  });

  it('throws "File is in use" for EBUSY', async () => {
    await expect(
      handler.handleUpdateError(new Error('EBUSY resource busy'), 'install'),
    ).rejects.toThrow('File is in use');
  });

  it('throws generic install error for unknown error', async () => {
    await expect(
      handler.handleUpdateError(new Error('something broke'), 'install'),
    ).rejects.toThrow('Installation failed:');
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - check context SSL error
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler - check context SSL', () => {
  it('throws certificate error for SSL errors', async () => {
    const handler = new UpdateErrorHandler();
    await expect(
      handler.handleUpdateError(new Error('CERT_UNTRUSTED'), 'check'),
    ).rejects.toThrow('certificate');
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - download context ENOSPC
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler - download context ENOSPC', () => {
  it('throws "Insufficient disk space" for ENOSPC download', async () => {
    const handler = new UpdateErrorHandler();
    await expect(
      handler.handleUpdateError(new Error('ENOSPC disk full'), 'download'),
    ).rejects.toThrow('Insufficient disk space');
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - generic context
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler - generic context', () => {
  it('retries on generic context with retry function', async () => {
    const handler = new UpdateErrorHandler();
    (handler as any).retryDelay = 0;
    handler.setMaxRetries(1);
    const retryFn = vi.fn().mockResolvedValue(undefined);
    await handler.handleUpdateError(new Error('generic error'), 'other', retryFn);
    expect(retryFn).toHaveBeenCalled();
  });

  it('throws on generic context when no retry function and at max retries', async () => {
    const handler = new UpdateErrorHandler();
    (handler as any).currentRetryCount = 10;
    await expect(
      handler.handleUpdateError(new Error('generic error'), 'other'),
    ).rejects.toThrow('generic error');
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - performRollback
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler.performRollback', () => {
  it('completes without error when no previousVersion given', async () => {
    const handler = new UpdateErrorHandler();
    await expect(handler.performRollback()).resolves.toBeUndefined();
  });

  it('completes without error when previousVersion is given', async () => {
    const handler = new UpdateErrorHandler();
    await expect(handler.performRollback('1.9.0')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// UpdateErrorHandler - resetRetryCount / getRetryCount
// ─────────────────────────────────────────────────────────────
describe('UpdateErrorHandler - retry count management', () => {
  it('resetRetryCount sets count to 0', () => {
    const handler = new UpdateErrorHandler();
    (handler as any).currentRetryCount = 3;
    handler.resetRetryCount();
    expect(handler.getRetryCount()).toBe(0);
  });
});
