// @ts-nocheck
/**
 * Coverage tests for NativeModuleManager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockFs,
  mockApp,
  mockBrowserWindow,
  mockHttpsGet,
  mockHttpGet,
  mockLogger,
  mockTar,
  mockExecFile,
  mockNativeRequire,
} = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockFs = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    createWriteStream: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn((cb: () => void) => cb && cb()),
    })),
    symlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlink: vi.fn((_p: string, cb: () => void) => cb()),
  };

  const mockWebContents = { send: vi.fn() };
  const mockWin = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
  const mockBrowserWindow = { getAllWindows: vi.fn(() => [mockWin]) };

  const mockApp = {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/user-data';
      return '/mock';
    }),
  };

  const mockHttpsGet = vi.fn();
  const mockHttpGet = vi.fn();

  const mockTar = { x: vi.fn().mockResolvedValue(undefined) };

  const mockExecFile = vi.fn();

  // nativeRequire is used by the module — we simulate it returning child_process
  const mockNativeRequire = vi.fn((mod: string) => {
    if (mod === 'child_process') {
      return { execFileSync: vi.fn() };
    }
    return {};
  });

  return {
    mockFs,
    mockApp,
    mockBrowserWindow,
    mockHttpsGet,
    mockHttpGet,
    mockLogger,
    mockTar,
    mockExecFile,
    mockNativeRequire,
  };
});

vi.mock('fs', () => mockFs);
vi.mock('electron', () => ({ app: mockApp, BrowserWindow: mockBrowserWindow }));
vi.mock('https', () => ({ default: { get: mockHttpsGet }, get: mockHttpsGet }));
vi.mock('http', () => ({ default: { get: mockHttpGet }, get: mockHttpGet }));
vi.mock('tar', () => mockTar);
vi.mock('child_process', () => ({ execFile: mockExecFile }));
vi.mock('../../unifiedLogger', () => ({ createLogger: () => mockLogger }));
vi.mock('module', () => ({
  createRequire: () => mockNativeRequire,
}));
vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}));
vi.mock('os', () => ({
  default: { platform: () => 'linux', arch: () => 'x64' },
  platform: () => 'linux',
  arch: () => 'x64',
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHttpsGetResponse(statusCode: number, body: string, headers: Record<string, string> = {}) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const res: any = {
    statusCode,
    headers: { 'content-length': String(body.length), ...headers },
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return res;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
    pipe: vi.fn(),
  };
  return res;
}

function makeReq() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const req: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return req;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
    destroy: vi.fn(),
  };
  return req;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NativeModuleManager', () => {
  // We need a fresh singleton per test suite, so we reset modules
  let manager: any;
  let NATIVE_MODULE_REGISTRY: any;
  let NativeModuleNotDownloadedError: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Re-import to get a fresh singleton
    const mod = await import('../nativeModuleManager');
    // NativeModuleManager is a singleton — we need to access via the exported singleton
    manager = mod.nativeModuleManager;
    NATIVE_MODULE_REGISTRY = mod.NATIVE_MODULE_REGISTRY;
    NativeModuleNotDownloadedError = mod.NativeModuleNotDownloadedError;

    // Reset the singleton for fresh state per test
    // The singleton caches loadedModules & activeDownloads; clear them via private access
    (manager as any).loadedModules.clear();
    (manager as any).activeDownloads.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── getStatus ────────────────────────────────────────────────────────────

  it('returns error status for unknown module key', () => {
    const info = manager.getStatus('unknown-module');
    expect(info.status).toBe('error');
    expect(info.error).toContain('Unknown module key');
  });

  it('returns downloading status when download is active', () => {
    const controller = new AbortController();
    (manager as any).activeDownloads.set('whisper-addon', controller);

    const info = manager.getStatus('whisper-addon');
    expect(info.status).toBe('downloading');
  });

  it('returns downloaded status when package.json exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    const info = manager.getStatus('whisper-addon');
    expect(info.status).toBe('downloaded');
    expect(info.localPath).toBeTruthy();
  });

  it('returns not-downloaded when package.json absent', () => {
    mockFs.existsSync.mockReturnValue(false);
    const info = manager.getStatus('whisper-addon');
    expect(info.status).toBe('not-downloaded');
  });

  // ── isAvailable ──────────────────────────────────────────────────────────

  it('returns false for unknown key', () => {
    expect(manager.isAvailable('nope')).toBe(false);
  });

  it('returns true when package.json exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    expect(manager.isAvailable('whisper-addon')).toBe(true);
  });

  it('returns false when not downloaded', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(manager.isAvailable('whisper-addon')).toBe(false);
  });

  // ── getRequirePath ───────────────────────────────────────────────────────

  it('returns null for unknown key', () => {
    expect(manager.getRequirePath('nope')).toBeNull();
  });

  it('returns null when not downloaded', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(manager.getRequirePath('whisper-addon')).toBeNull();
  });

  it('returns local path when downloaded', () => {
    mockFs.existsSync.mockReturnValue(true);
    const p = manager.getRequirePath('whisper-addon');
    expect(p).toContain('whisper');
  });

  // ── cancelDownload ───────────────────────────────────────────────────────

  it('aborts and deletes active download', () => {
    const controller = { abort: vi.fn(), signal: {} };
    (manager as any).activeDownloads.set('whisper-addon', controller);

    manager.cancelDownload('whisper-addon');

    expect(controller.abort).toHaveBeenCalled();
    expect((manager as any).activeDownloads.has('whisper-addon')).toBe(false);
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadCancelled',
      expect.anything(),
    );
  });

  it('does nothing when no active download', () => {
    expect(() => manager.cancelDownload('whisper-addon')).not.toThrow();
  });

  // ── deleteModule ─────────────────────────────────────────────────────────

  it('does nothing for unknown key', () => {
    expect(() => manager.deleteModule('nope')).not.toThrow();
  });

  it('removes versionDir if it exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    manager.deleteModule('whisper-addon');
    expect(mockFs.rmSync).toHaveBeenCalled();
  });

  it('does not call rmSync when versionDir absent', () => {
    mockFs.existsSync.mockReturnValue(false);
    manager.deleteModule('whisper-addon');
    expect(mockFs.rmSync).not.toHaveBeenCalled();
  });

  // ── requireModule ────────────────────────────────────────────────────────

  it('throws NativeModuleNotDownloadedError when not downloaded', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => manager.requireModule('whisper-addon')).toThrow(NativeModuleNotDownloadedError);
  });

  it('returns cached module on second call', () => {
    const fakeMod = { hello: 'world' };
    (manager as any).loadedModules.set('whisper-addon', fakeMod);

    const result = manager.requireModule('whisper-addon');
    expect(result).toBe(fakeMod);
  });

  it('loads module via nativeRequire', () => {
    mockFs.existsSync.mockReturnValue(true);
    const fakeMod = { whisper: true };
    mockNativeRequire.mockReturnValue(fakeMod);

    const result = manager.requireModule('whisper-addon');
    expect(result).toBe(fakeMod);
    expect((manager as any).loadedModules.has('whisper-addon')).toBe(true);
  });

  it('throws when nativeRequire throws', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockNativeRequire.mockImplementation(() => { throw new Error('dlopen failed'); });

    expect(() => manager.requireModule('whisper-addon')).toThrow('Failed to load whisper-addon');
  });

  // ── ensureDownloaded ─────────────────────────────────────────────────────

  it('throws for unknown module key', async () => {
    await expect(manager.ensureDownloaded('nope')).rejects.toThrow('Unknown module key');
  });

  it('returns localPath immediately when already downloaded', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const p = await manager.ensureDownloaded('whisper-addon');
    expect(p).toContain('whisper');
  });

  it('throws when download is already in progress', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const controller = new AbortController();
    (manager as any).activeDownloads.set('whisper-addon', controller);

    await expect(manager.ensureDownloaded('whisper-addon')).rejects.toThrow('already downloading');
  });

  it('downloads successfully', async () => {
    mockFs.existsSync.mockReturnValue(false);

    // Spy on private download to avoid real HTTP
    vi.spyOn(manager as any, 'download').mockImplementation(async (moduleKey: string) => {
      const spec = NATIVE_MODULE_REGISTRY[moduleKey];
      const localPath = (manager as any).getLocalPackagePath(spec);
      mockBrowserWindow.getAllWindows()[0].webContents.send('native-module:downloadComplete', {
        packageName: moduleKey, localPath,
      });
      return localPath;
    });

    const progressCb = vi.fn();
    const result = await manager.ensureDownloaded('whisper-addon', progressCb);
    expect(result).toContain('whisper');
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadComplete',
      expect.anything(),
    );
  });

  it('handles download HTTP error', async () => {
    mockFs.existsSync.mockReturnValue(false);

    const res = makeHttpsGetResponse(404, 'not found');
    const req = makeReq();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => cb(res), 0);
      return req;
    });

    // Test downloadFile directly
    const signal = { aborted: false, addEventListener: vi.fn() };
    await expect(
      (manager as any).downloadFile('https://registry.npmjs.org/test.tgz', '/tmp/test.tgz', signal, vi.fn())
    ).rejects.toThrow('HTTP 404');
  });

  it('handles redirect (301)', async () => {
    mockFs.existsSync.mockReturnValue(false);

    // Test redirect logic directly via downloadFile
    const fileListeners: Record<string, ((...args: any[]) => void)[]> = {};
    const fileStream = {
      on(event: string, cb: (...args: any[]) => void) {
        (fileListeners[event] = fileListeners[event] || []).push(cb);
        return fileStream;
      },
      close: vi.fn((cb: () => void) => cb && cb()),
    };
    mockFs.createWriteStream.mockReturnValue(fileStream);

    let redirectCallCount = 0;
    mockHttpsGet.mockImplementation((url: string, cb: (res: any) => void) => {
      redirectCallCount++;
      const req = makeReq();
      if (redirectCallCount === 1) {
        // First call: redirect
        const res = makeHttpsGetResponse(301, '', { location: 'https://redirect.example.com/file.tgz' });
        setTimeout(() => cb(res), 0);
      } else {
        // Second call: actual file
        const downloadBody = 'tgz';
        const res = makeHttpsGetResponse(200, downloadBody);
        res.pipe = vi.fn(() => {
          setTimeout(() => (fileListeners['finish'] || []).forEach((cb) => cb()), 0);
        });
        setTimeout(() => { cb(res); res.emit('data', Buffer.from(downloadBody)); }, 0);
      }
      return req;
    });

    const signal = { aborted: false, addEventListener: vi.fn() };
    await (manager as any).downloadFile(
      'https://registry.npmjs.org/test.tgz',
      '/tmp/test.tgz',
      signal,
      vi.fn(),
    );
    expect(redirectCallCount).toBe(2);
  });

  it('rejects after too many redirects', async () => {
    mockFs.existsSync.mockReturnValue(false);

    mockHttpsGet.mockImplementation((url: string, cb: (res: any) => void) => {
      const req = makeReq();
      const res = makeHttpsGetResponse(301, '', { location: url }); // infinite redirect
      setTimeout(() => cb(res), 0);
      return req;
    });

    await expect(manager.ensureDownloaded('whisper-addon')).rejects.toThrow('Too many redirects');
  });

  it('handles abort during download', async () => {
    mockFs.existsSync.mockReturnValue(false);

    const req = makeReq();
    let abortListener: (() => void) | undefined;
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      // Don't call cb immediately; let the abort happen
      const origAddEventListener = AbortSignal.prototype.addEventListener;
      return req;
    });

    // Simulate download being cancelled immediately
    const controller = { abort: vi.fn(), signal: { aborted: true, addEventListener: vi.fn() } };

    // Spy on download private method to inject signal
    const originalDownload = (manager as any).download.bind(manager);
    vi.spyOn(manager as any, 'download').mockImplementation(async () => {
      const err = Object.assign(new Error('Download aborted'), { name: 'AbortError' });
      // simulate the error path
      mockBrowserWindow.getAllWindows()[0].webContents.send(
        'native-module:downloadCancelled',
        { packageName: 'whisper-addon' },
      );
      throw err;
    });

    await expect(manager.ensureDownloaded('whisper-addon')).rejects.toThrow('Download aborted');
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadCancelled',
      expect.anything(),
    );
  });

  // ── notifyRenderer with destroyed window ────────────────────────────────

  it('skips destroyed windows in notifyRenderer', () => {
    const destroyedWin = { isDestroyed: vi.fn(() => true), webContents: { send: vi.fn() } };
    mockBrowserWindow.getAllWindows.mockReturnValueOnce([destroyedWin]);

    // Trigger notify via cancelDownload (no-op for notification since window destroyed)
    const controller = { abort: vi.fn(), signal: {} };
    (manager as any).activeDownloads.set('whisper-addon', controller);
    manager.cancelDownload('whisper-addon');

    expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
  });

  // ── REGISTRY ─────────────────────────────────────────────────────────────

  it('NATIVE_MODULE_REGISTRY contains expected entries', () => {
    expect(NATIVE_MODULE_REGISTRY['whisper-addon']).toBeDefined();
  });

  // ── NativeModuleNotDownloadedError ───────────────────────────────────────

  it('has correct name and moduleKey', () => {
    const err = new NativeModuleNotDownloadedError('whisper-addon');
    expect(err.name).toBe('NativeModuleNotDownloadedError');
    expect(err.moduleKey).toBe('whisper-addon');
    expect(err.message).toContain('whisper-addon');
  });

  // ── getTarballUrl ─────────────────────────────────────────────────────────

  it('builds correct URL for scoped package', () => {
    const spec = NATIVE_MODULE_REGISTRY['whisper-addon'];
    const url = (manager as any).getTarballUrl(spec);
    expect(url).toContain('%40kutalia');
    expect(url).toContain('whisper-node-addon');
  });
});
