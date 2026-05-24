// @ts-nocheck
/**
 * Coverage tests for NativeServerFetcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockFs,
  mockPath,
  mockApp,
  mockHttpsGet,
  mockHttpGet,
  mockLogger,
  MockStreamZip,
} = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  // A reusable fs mock
  const mockFs = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{"version":"1.0.0"}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 100 })),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    })),
    chmodSync: vi.fn(),
  };

  // path passthrough (just use actual node path)
  const mockPath = {
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  };

  const mockApp = {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/user-data';
      if (key === 'temp') return '/tmp';
      return '/mock-path';
    }),
  };

  // https.get / http.get will be mocked per-test via returned request object
  const mockHttpsGet = vi.fn();
  const mockHttpGet = vi.fn();

  // StreamZip.async
  const MockStreamZip = {
    async: vi.fn(() => ({
      entries: vi.fn().mockResolvedValue({}),
      extract: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return { mockFs, mockPath, mockApp, mockHttpsGet, mockHttpGet, mockLogger, MockStreamZip };
});

vi.mock('fs', () => mockFs);
vi.mock('path', () => ({ default: mockPath, ...mockPath }));
vi.mock('electron', () => ({ app: mockApp }));
vi.mock('https', () => ({ default: { get: mockHttpsGet }, get: mockHttpsGet }));
vi.mock('http', () => ({ default: { get: mockHttpGet }, get: mockHttpGet }));
vi.mock('node-stream-zip', () => ({ default: MockStreamZip }));
vi.mock('../../unifiedLogger', () => ({ createLogger: () => mockLogger }));
vi.mock('../../utils/urlUtils', () => ({
  appendCacheBustingTimestamp: (url: string) => `${url}?t=123`,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal fake Node http response.
 */
function makeFakeResponse(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const res: any = {
    statusCode,
    statusMessage: 'OK',
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

/**
 * Build a fake http.get request object.
 */
function makeFakeRequest(onReqError?: Error, onTimeout?: boolean) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const req: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return req;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
    setTimeout: vi.fn((ms: number, cb: () => void) => {
      if (onTimeout) setTimeout(cb, 0);
      return req;
    }),
    destroy: vi.fn(),
  };
  return req;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NativeServerFetcher', () => {
  let NativeServerFetcher: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Re-import after resetting modules so mocks are fresh
    const mod = await import('../nativeServerFetcher');
    NativeServerFetcher = mod.NativeServerFetcher;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── constructor ──────────────────────────────────────────────────────────

  it('uses development CDN URL when NODE_ENV=development', () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.DEVELOPMENT_BASE_CDN_URL;
    process.env.NODE_ENV = 'development';
    process.env.DEVELOPMENT_BASE_CDN_URL = 'https://dev.cdn.example.com';

    const fetcher = new NativeServerFetcher();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'NativeServerFetcher initialized',
      'NativeServerFetcher',
      expect.objectContaining({ isDevelopment: true, baseUrl: 'https://dev.cdn.example.com' }),
    );

    process.env.NODE_ENV = origEnv;
    process.env.DEVELOPMENT_BASE_CDN_URL = origUrl as string;
  });

  it('uses default development CDN URL when env var absent', () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.DEVELOPMENT_BASE_CDN_URL;
    process.env.NODE_ENV = 'development';
    delete process.env.DEVELOPMENT_BASE_CDN_URL;

    const fetcher = new NativeServerFetcher();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'NativeServerFetcher initialized',
      'NativeServerFetcher',
      expect.objectContaining({ baseUrl: 'https://cdn.kosmos-ai.com/dev' }),
    );

    process.env.NODE_ENV = origEnv;
    if (origUrl !== undefined) process.env.DEVELOPMENT_BASE_CDN_URL = origUrl;
  });

  it('uses production CDN URL when NODE_ENV is not development', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const fetcher = new NativeServerFetcher();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'NativeServerFetcher initialized',
      'NativeServerFetcher',
      expect.objectContaining({ isDevelopment: false }),
    );

    process.env.NODE_ENV = origEnv;
  });

  // ── getLocalNativeServerVersion ──────────────────────────────────────────

  it('returns version from package.json when file exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"version":"2.3.4"}');

    const fetcher = new NativeServerFetcher();
    expect(fetcher.getLocalNativeServerVersion()).toBe('2.3.4');
  });

  it('returns 0.0.0 when package.json does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const fetcher = new NativeServerFetcher();
    expect(fetcher.getLocalNativeServerVersion()).toBe('0.0.0');
  });

  it('returns 0.0.0 when package.json has no version field', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"name":"foo"}');

    const fetcher = new NativeServerFetcher();
    expect(fetcher.getLocalNativeServerVersion()).toBe('0.0.0');
  });

  it('returns 0.0.0 when readFileSync throws', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const fetcher = new NativeServerFetcher();
    expect(fetcher.getLocalNativeServerVersion()).toBe('0.0.0');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  // ── checkLocalNativeServer ───────────────────────────────────────────────

  it('returns exists=true when dir and package.json present with size > 0', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');
    mockFs.statSync.mockReturnValue({ size: 50 });

    const fetcher = new NativeServerFetcher();
    const result = fetcher.checkLocalNativeServer();
    expect(result.exists).toBe(true);
    expect(result.needsDownload).toBe(false);
  });

  it('returns needsDownload=true when package.json has size 0', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');
    mockFs.statSync.mockReturnValue({ size: 0 });

    const fetcher = new NativeServerFetcher();
    const result = fetcher.checkLocalNativeServer();
    expect(result.needsDownload).toBe(true);
    expect(result.exists).toBe(false);
  });

  it('returns needsDownload=true when dir does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const fetcher = new NativeServerFetcher();
    const result = fetcher.checkLocalNativeServer();
    expect(result.needsDownload).toBe(true);
    expect(result.exists).toBe(false);
  });

  it('returns needsDownload=true when statSync throws', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockImplementation(() => { throw new Error('stat error'); });

    const fetcher = new NativeServerFetcher();
    const result = fetcher.checkLocalNativeServer();
    expect(result.needsDownload).toBe(true);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  // ── getRemoteNativeServerVersion ─────────────────────────────────────────

  it('returns null when fetchNativeServerInfo fails (network error)', async () => {
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      // call cb is not called — we emit error on request
      setTimeout(() => req.emit('error', new Error('network fail')), 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBeNull();
  });

  it('returns latest version string on success', async () => {
    const body = JSON.stringify({ latest: '2.0.0', downloadUrls: { 'linux-x64': 'file.zip' } });
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBe('2.0.0');
  });

  it('returns null when JSON response lacks latest field', async () => {
    const body = JSON.stringify({ downloadUrls: {} });
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBeNull();
  });

  // ── checkNativeServerNeedsUpdate ─────────────────────────────────────────

  it('returns needsUpdate=false when remote version unavailable', async () => {
    // no network — httpGet will error
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      setTimeout(() => req.emit('error', new Error('offline')), 0);
      return req;
    });
    mockFs.existsSync.mockReturnValue(false);

    const fetcher = new NativeServerFetcher();
    const result = await fetcher.checkNativeServerNeedsUpdate();
    expect(result.needsUpdate).toBe(false);
    expect(result.remoteVersion).toBeNull();
  });

  it('returns needsUpdate=true when local < remote', async () => {
    const body = JSON.stringify({ latest: '2.0.0', downloadUrls: {} });
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });
    // local version 1.0.0
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');

    const fetcher = new NativeServerFetcher();
    const result = await fetcher.checkNativeServerNeedsUpdate();
    expect(result.needsUpdate).toBe(true);
    expect(result.remoteVersion).toBe('2.0.0');
  });

  it('returns needsUpdate=false when local >= remote', async () => {
    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: {} });
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');

    const fetcher = new NativeServerFetcher();
    const result = await fetcher.checkNativeServerNeedsUpdate();
    expect(result.needsUpdate).toBe(false);
  });

  // ── downloadNativeServer ─────────────────────────────────────────────────

  it('returns failure when fetchNativeServerInfo returns null', async () => {
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      setTimeout(() => req.emit('error', new Error('offline')), 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const result = await fetcher.downloadNativeServer();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to fetch latest.json');
  });

  it('returns failure for unsupported platform', async () => {
    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: { 'win32-x64': 'file.zip' } });
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });

    // Force platform key that won't match
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    const fetcher = new NativeServerFetcher();
    const result = await fetcher.downloadNativeServer();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported platform');

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('downloads and extracts successfully', async () => {
    const platformKey = `${process.platform}-${process.arch}`;
    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: { [platformKey]: 'server.zip' } });

    // First call: latest.json fetch
    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });

    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);

    const fetcher = new NativeServerFetcher();
    // Spy on private downloadFile and extractZip to avoid real HTTP/zip
    vi.spyOn(fetcher as any, 'downloadFile').mockResolvedValue(undefined);
    vi.spyOn(fetcher as any, 'extractZip').mockResolvedValue(undefined);

    const progressCb = vi.fn();
    const phaseCb = vi.fn();
    const result = await fetcher.downloadNativeServer(progressCb, phaseCb);
    expect(result.success).toBe(true);
    expect(phaseCb).toHaveBeenCalledWith('downloading');
    expect(phaseCb).toHaveBeenCalledWith('extracting');
  });

  it('cleans up old nativeServerDir if it exists before extraction', async () => {
    const platformKey = `${process.platform}-${process.arch}`;
    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: { [platformKey]: 'server.zip' } });

    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });

    // nativeServerDir exists (will be cleaned up)
    mockFs.existsSync.mockReturnValue(true);

    const fetcher = new NativeServerFetcher();
    vi.spyOn(fetcher as any, 'downloadFile').mockResolvedValue(undefined);
    vi.spyOn(fetcher as any, 'extractZip').mockResolvedValue(undefined);

    await fetcher.downloadNativeServer();
    expect(mockFs.rmSync).toHaveBeenCalled();
  });

  // ── http response error path ─────────────────────────────────────────────

  it('httpGet rejects on non-200 status', async () => {
    const res = makeFakeResponse(404, 'not found');
    res.statusMessage = 'Not Found';
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from('')); res.emit('end'); }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  // ── ensureNativeServer ───────────────────────────────────────────────────

  it('downloads when local does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);

    const fetcher = new NativeServerFetcher();
    // Spy on downloadNativeServer to avoid real download
    vi.spyOn(fetcher, 'downloadNativeServer').mockResolvedValue({
      success: true,
      nativeServerDir: '/user-data/assets/native-server',
      version: '1.0.0',
    });

    const result = await fetcher.ensureNativeServer();
    expect(result.downloaded).toBe(true);
    expect(result.success).toBe(true);
  });

  it('skips download when local is up-to-date', async () => {
    // local exists
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 50 });
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');

    const fetcher = new NativeServerFetcher();
    vi.spyOn(fetcher, 'checkNativeServerNeedsUpdate').mockResolvedValue({
      needsUpdate: false,
      localVersion: '1.0.0',
      remoteVersion: '1.0.0',
    });

    const result = await fetcher.ensureNativeServer();
    expect(result.downloaded).toBe(false);
    expect(result.success).toBe(true);
  });

  it('downloads when local is outdated', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 50 });
    mockFs.readFileSync.mockReturnValue('{"version":"1.0.0"}');

    const fetcher = new NativeServerFetcher();
    vi.spyOn(fetcher, 'checkNativeServerNeedsUpdate').mockResolvedValue({
      needsUpdate: true,
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
    });
    vi.spyOn(fetcher, 'downloadNativeServer').mockResolvedValue({
      success: true,
      nativeServerDir: '/user-data/assets/native-server',
      version: '2.0.0',
    });

    const result = await fetcher.ensureNativeServer();
    expect(result.downloaded).toBe(true);
    expect(result.version).toBe('2.0.0');
  });

  // ── macOS run_host.sh fix ────────────────────────────────────────────────

  it('fixes run_host.sh on macOS (CRLF→LF + chmod)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const platformKey = `darwin-${process.arch}`;
    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: { [platformKey]: 'server.zip' } });

    const res = makeFakeResponse(200, body);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      setTimeout(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); }, 0);
      return req;
    });

    // run_host.sh exists
    mockFs.existsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('run_host.sh')) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith('run_host.sh')) return '#!/bin/bash\r\necho hi\r\n';
      return '{"version":"1.0.0"}';
    });

    const fetcher = new NativeServerFetcher();
    vi.spyOn(fetcher as any, 'downloadFile').mockResolvedValue(undefined);
    vi.spyOn(fetcher as any, 'extractZip').mockResolvedValue(undefined);

    const result = await fetcher.downloadNativeServer();

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('run_host.sh'),
      '#!/bin/bash\necho hi\n',
      'utf8',
    );
    expect(mockFs.chmodSync).toHaveBeenCalledWith(expect.stringContaining('run_host.sh'), '755');

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});
