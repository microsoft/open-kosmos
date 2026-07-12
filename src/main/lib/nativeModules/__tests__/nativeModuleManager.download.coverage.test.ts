// @ts-nocheck
/**
 * nativeModuleManager.download.coverage.test.ts
 *
 * Covers the download() private method and extractTarball() paths:
 *  - Successful download with progress callback
 *  - AbortError path (downloadCancelled event)
 *  - Non-abort error path (downloadError event)
 *  - extractTarball win32 path (uses node tar)
 *  - extractTarball non-win32 tar fallback path
 *  - downloadFile signal.aborted check
 *  - downloadFile file stream error path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  const fileListeners: Record<string, ((...args: any[]) => void)[]> = {};
  const mockFileStream: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (fileListeners[event] = fileListeners[event] || []).push(cb);
      return mockFileStream;
    },
    close: vi.fn((cb?: () => void) => cb && cb()),
    _emitFinish() { (fileListeners['finish'] || []).forEach(cb => cb()); },
    _emitError(e: Error) { (fileListeners['error'] || []).forEach(cb => cb(e)); },
  };

  const mockFs = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    createWriteStream: vi.fn(() => mockFileStream),
    symlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlink: vi.fn((_p: string, cb: () => void) => cb()),
  };

  const mockWebContents = { send: vi.fn() };
  const mockWin = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
  const mockBrowserWindow = { getAllWindows: vi.fn(() => [mockWin]) };

  const mockApp = {
    getPath: vi.fn((key: string) => (key === 'userData' ? '/user-data' : '/mock')),
  };

  const mockHttpsGet = vi.fn();
  const mockHttpGet = vi.fn();
  const mockTar = { x: vi.fn().mockResolvedValue(undefined) };
  const mockExecFile = vi.fn();
  const mockNativeRequire = vi.fn((mod: string) => {
    if (mod === 'child_process') return { execFileSync: vi.fn() };
    return {};
  });

  return { mockFs, mockApp, mockBrowserWindow, mockHttpsGet, mockHttpGet, mockLogger, mockTar, mockExecFile, mockNativeRequire };
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

// We test win32 and non-win32 paths via parameterized os mock
let osPlatformValue = 'linux';
vi.mock('os', () => ({
  default: { platform: () => osPlatformValue, arch: () => 'x64' },
  platform: () => osPlatformValue,
  arch: () => 'x64',
}));

function makeHttpRes(statusCode: number, body: string, headers: Record<string, string> = {}) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const res: any = {
    statusCode,
    headers: { 'content-length': String(body.length), ...headers },
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return res;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach(cb => cb(...args));
    },
    pipe: vi.fn((dest: any) => {
      // Trigger finish on the file stream after pipe is called
      setTimeout(() => {
        dest._emitFinish?.();
      }, 0);
    }),
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
      (listeners[event] || []).forEach(cb => cb(...args));
    },
    destroy: vi.fn(),
  };
  return req;
}

describe('NativeModuleManager — download() and extractTarball() coverage', () => {
  let manager: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    osPlatformValue = 'linux';

    const mod = await import('../nativeModuleManager');
    manager = mod.nativeModuleManager;
    (manager as any).loadedModules.clear();
    (manager as any).activeDownloads.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('download() succeeds: notifies downloadStarted, progress, complete', async () => {
    mockFs.existsSync.mockReturnValue(false);

    // Spy on private downloadFile and extractTarball
    const downloadFileSpy = vi.spyOn(manager as any, 'downloadFile').mockResolvedValue(undefined);
    const extractSpy = vi.spyOn(manager as any, 'extractTarball').mockResolvedValue(undefined);

    const progressCb = vi.fn();
    const result = await manager.ensureDownloaded('whisper-addon', progressCb);

    expect(result).toContain('whisper');
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadStarted',
      expect.objectContaining({ packageName: 'whisper-addon' }),
    );
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadComplete',
      expect.objectContaining({ packageName: 'whisper-addon' }),
    );
    expect(downloadFileSpy).toHaveBeenCalled();
    expect(extractSpy).toHaveBeenCalled();
  });

  it('download() cleans up temp file if it exists on success', async () => {
    // Package.json does NOT exist (so download triggers), but tmp file does exist (so it gets cleaned up)
    mockFs.existsSync.mockImplementation((p: string) => {
      // The tmp file path ends with '__download.tmp.tgz'
      return String(p).endsWith('__download.tmp.tgz');
    });
    vi.spyOn(manager as any, 'downloadFile').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'extractTarball').mockResolvedValue(undefined);

    await manager.ensureDownloaded('whisper-addon');
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('download() on abort error: notifies downloadCancelled and rethrows', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const abortErr = Object.assign(new Error('Download aborted'), { name: 'AbortError' });
    vi.spyOn(manager as any, 'downloadFile').mockRejectedValue(abortErr);

    await expect(manager.ensureDownloaded('whisper-addon')).rejects.toThrow('Download aborted');
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadCancelled',
      expect.objectContaining({ packageName: 'whisper-addon' }),
    );
    // Ensure activeDownloads cleaned up
    expect((manager as any).activeDownloads.has('whisper-addon')).toBe(false);
  });

  it('download() on non-abort error: notifies downloadError and rethrows', async () => {
    mockFs.existsSync.mockReturnValue(false);
    vi.spyOn(manager as any, 'downloadFile').mockRejectedValue(new Error('network error'));

    await expect(manager.ensureDownloaded('whisper-addon')).rejects.toThrow('network error');
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadError',
      expect.objectContaining({ packageName: 'whisper-addon' }),
    );
  });

  it('download() calls progress callback with NativeModuleDownloadProgress', async () => {
    mockFs.existsSync.mockReturnValue(false);

    let capturedProgressCb: any;
    vi.spyOn(manager as any, 'downloadFile').mockImplementation(
      async (_url: string, _dest: string, _signal: any, cb: any) => {
        capturedProgressCb = cb;
        cb({ bytesDownloaded: 50, bytesTotal: 100, percent: 50 });
      }
    );
    vi.spyOn(manager as any, 'extractTarball').mockResolvedValue(undefined);

    const progressCb = vi.fn();
    await manager.ensureDownloaded('whisper-addon', progressCb);

    expect(progressCb).toHaveBeenCalledWith(expect.objectContaining({
      packageName: 'whisper-addon',
      bytesDownloaded: 50,
      bytesTotal: 100,
      percent: 50,
    }));
    expect(mockBrowserWindow.getAllWindows()[0].webContents.send).toHaveBeenCalledWith(
      'native-module:downloadProgress',
      expect.objectContaining({ packageName: 'whisper-addon' }),
    );
  });

  it('extractTarball() uses node tar on win32', async () => {
    osPlatformValue = 'win32';
    vi.resetModules();

    // Re-import with win32 platform
    const mod = await import('../nativeModuleManager');
    const mgr = mod.nativeModuleManager as any;
    mgr.loadedModules.clear();
    mgr.activeDownloads.clear();

    await mgr.extractTarball('/tmp/test.tgz', '/tmp/dest');
    expect(mockTar.x).toHaveBeenCalledWith({ file: '/tmp/test.tgz', cwd: '/tmp/dest' });
  });

  it('extractTarball() on non-win32 falls back to node tar when exec fails', async () => {
    osPlatformValue = 'linux';

    // execFile (promisified) should reject to trigger fallback
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb?: Function) => {
      if (cb) cb(new Error('tar not found'), '', '');
    });

    await (manager as any).extractTarball('/tmp/test.tgz', '/tmp/dest');
    expect(mockTar.x).toHaveBeenCalledWith({ file: '/tmp/test.tgz', cwd: '/tmp/dest' });
  });

  it('downloadFile() rejects immediately when signal is already aborted', async () => {
    const signal = { aborted: true, addEventListener: vi.fn() };
    await expect(
      (manager as any).downloadFile('https://example.com/test.tgz', '/tmp/out.tgz', signal, vi.fn())
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('downloadFile() handles file stream error', async () => {
    const fileListeners: Record<string, ((...args: any[]) => void)[]> = {};
    const fileStream: any = {
      on(event: string, cb: (...args: any[]) => void) {
        (fileListeners[event] = fileListeners[event] || []).push(cb);
        return fileStream;
      },
      close: vi.fn(),
    };
    mockFs.createWriteStream.mockReturnValue(fileStream);

    const res = makeHttpRes(200, 'data');
    const req = makeReq();
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      setTimeout(() => {
        cb(res);
        // Trigger file stream error
        setTimeout(() => {
          (fileListeners['error'] || []).forEach(fn => fn(new Error('write error')));
        }, 0);
      }, 0);
      return req;
    });

    const signal = { aborted: false, addEventListener: vi.fn() };
    await expect(
      (manager as any).downloadFile('https://example.com/test.tgz', '/tmp/out.tgz', signal, vi.fn())
    ).rejects.toThrow('write error');
  });

  it('downloadFile() abort listener destroys request and rejects', async () => {
    const abortListeners: Array<() => void> = [];
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_event: string, cb: () => void) => { abortListeners.push(cb); }),
    };

    const req = makeReq();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      // Don't call cb — simulate pending request
      return req;
    });

    const promise = (manager as any).downloadFile(
      'https://example.com/test.tgz', '/tmp/out.tgz', signal, vi.fn()
    );

    // Trigger abort
    abortListeners.forEach(fn => fn());

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(req.destroy).toHaveBeenCalled();
  });
});
