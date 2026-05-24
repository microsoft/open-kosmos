/**
 * nativeServerFetcher.coverage2.test.ts
 *
 * Targets uncovered branches in nativeServerFetcher.ts:
 * - downloadFile: response.on('error'), request.on('error') with file cleanup,
 *   request.setTimeout (timeout path), progress throttle / final 100% progress
 * - extractZip: directory entries skipped, progress callback, error re-throw
 * - httpGet: http (non-https) protocol branch, multi-chunk accumulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockFs,
  mockPath,
  mockApp,
  mockHttpsGet,
  mockHttpGet,
  mockLogger,
  MockStreamZip,
} = vi.hoisted(() => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const mockFs = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{"version":"1.0.0"}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 100 })),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(),
    chmodSync: vi.fn(),
  };

  const mockPath = {
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
    basename: (p: string) => p.split('/').pop() || p,
  };

  const mockApp = {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/user-data';
      if (key === 'temp') return '/tmp';
      return '/mock-path';
    }),
  };

  const mockHttpsGet = vi.fn();
  const mockHttpGet = vi.fn();

  const MockStreamZip = {
    async: vi.fn(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeResponse(statusCode: number, headers: Record<string, string> = {}) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const res: any = {
    statusCode,
    statusMessage: 'OK',
    headers: { 'content-length': '1000', ...headers },
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

function makeFakeRequest(opts?: { onTimeout?: boolean }) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  let timeoutCb: (() => void) | null = null;
  const req: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return req;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
    setTimeout: vi.fn((ms: number, cb: () => void) => {
      timeoutCb = cb;
      if (opts?.onTimeout) {
        setTimeout(() => cb(), 0);
      }
      return req;
    }),
    destroy: vi.fn(() => {
      // After destroy, trigger timeout cb to simulate timeout flow
    }),
    _triggerTimeout() {
      timeoutCb?.();
    },
  };
  return req;
}

function makeWriteStream() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const ws: any = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    close: vi.fn(),
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return ws;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
  };
  return ws;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NativeServerFetcher — downloadFile branches', () => {
  let NativeServerFetcher: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../nativeServerFetcher');
    NativeServerFetcher = mod.NativeServerFetcher;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses http module when URL is http://', async () => {
    // We test via getRemoteNativeServerVersion (uses httpGet internally)
    // but let's make the baseUrl use http by env var
    const origEnv = process.env.PRODUCTION_BASE_CDN_URL;
    process.env.PRODUCTION_BASE_CDN_URL = 'http://cdn.example.com';
    process.env.NODE_ENV = 'production';

    const body = JSON.stringify({ latest: '1.0.0', downloadUrls: {} });
    const res = makeFakeResponse(200);
    const req = makeFakeRequest();

    mockHttpGet.mockImplementation((_url: string, cb: (r: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBe('1.0.0');
    expect(mockHttpGet).toHaveBeenCalled();

    if (origEnv === undefined) {
      delete process.env.PRODUCTION_BASE_CDN_URL;
    } else {
      process.env.PRODUCTION_BASE_CDN_URL = origEnv;
    }
    delete process.env.NODE_ENV;
  });

  it('response.on(error) rejects downloadFile and cleans up file', async () => {
    const ws = makeWriteStream();
    mockFs.createWriteStream.mockReturnValue(ws);
    mockFs.existsSync.mockReturnValue(true);

    const res = makeFakeResponse(200);
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (r: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('error', new Error('response stream error'));
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    await expect(
      (fetcher as any).downloadFile('https://cdn.example.com/server.zip', '/tmp/server.zip')
    ).rejects.toThrow('response stream error');
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('request.on(error) rejects downloadFile and cleans up file', async () => {
    mockFs.createWriteStream.mockReturnValue(makeWriteStream());
    mockFs.existsSync.mockReturnValue(true);

    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      setTimeout(() => {
        req.emit('error', new Error('connection refused'));
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    await expect(
      (fetcher as any).downloadFile('https://cdn.example.com/server.zip', '/tmp/server.zip')
    ).rejects.toThrow('connection refused');
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('request.setTimeout timeout destroys request and rejects', async () => {
    mockFs.createWriteStream.mockReturnValue(makeWriteStream());
    mockFs.existsSync.mockReturnValue(true);

    const req = makeFakeRequest({ onTimeout: true });
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => req);

    const fetcher = new NativeServerFetcher();
    await expect(
      (fetcher as any).downloadFile('https://cdn.example.com/server.zip', '/tmp/server.zip')
    ).rejects.toThrow('timeout');
    expect(req.destroy).toHaveBeenCalled();
  });

  it('progress callback called with final 100% update', async () => {
    const ws = makeWriteStream();
    mockFs.createWriteStream.mockReturnValue(ws);
    mockFs.existsSync.mockReturnValue(false);

    const res = makeFakeResponse(200, { 'content-length': '200' });
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (r: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.alloc(100));
        res.emit('data', Buffer.alloc(100));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const progressCalls: any[] = [];
    await (fetcher as any).downloadFile(
      'https://cdn.example.com/server.zip',
      '/tmp/server.zip',
      (p: any) => progressCalls.push(p)
    );
    // Final progress (percent=100) should always be called
    const final = progressCalls[progressCalls.length - 1];
    expect(final.percent).toBe(100);
  });

  it('progress callback with unknown total size (totalSize=0)', async () => {
    const ws = makeWriteStream();
    mockFs.createWriteStream.mockReturnValue(ws);
    mockFs.existsSync.mockReturnValue(false);

    const res = makeFakeResponse(200, { 'content-length': '0' });
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (r: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.alloc(50));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const progressCalls: any[] = [];
    await (fetcher as any).downloadFile(
      'https://cdn.example.com/server.zip',
      '/tmp/server.zip',
      (p: any) => progressCalls.push(p)
    );
    // percent should be 0 for data events (totalSize=0), 100 for final
    const final = progressCalls[progressCalls.length - 1];
    expect(final.percent).toBe(100);
  });

  it('httpGet: non-200 status rejects with message', async () => {
    const res = makeFakeResponse(500);
    res.statusMessage = 'Internal Server Error';
    const req = makeFakeRequest();
    mockHttpsGet.mockImplementation((_url: string, cb: (r: any) => void) => {
      setTimeout(() => {
        cb(res);
        res.emit('data', Buffer.from(''));
        res.emit('end');
      }, 0);
      return req;
    });

    const fetcher = new NativeServerFetcher();
    const version = await fetcher.getRemoteNativeServerVersion();
    expect(version).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('NativeServerFetcher — extractZip branches', () => {
  let NativeServerFetcher: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../nativeServerFetcher');
    NativeServerFetcher = mod.NativeServerFetcher;
  });

  it('skips directory entries and reports progress for file entries', async () => {
    const fileEntry = { isDirectory: false, name: 'server/index.js' };
    const dirEntry = { isDirectory: true, name: 'server/' };

    const zipInstance = {
      entries: vi.fn().mockResolvedValue({ 'server/': dirEntry, 'server/index.js': fileEntry }),
      extract: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    MockStreamZip.async.mockImplementation(function() { return zipInstance; });
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);

    const fetcher = new NativeServerFetcher();
    const progressCb = vi.fn();
    await (fetcher as any).extractZip('/tmp/test.zip', '/dest', progressCb);

    // directory entry skipped, file entry extracted
    expect(zipInstance.extract).toHaveBeenCalledWith('server/index.js', '/dest/server/index.js');
    expect(progressCb).toHaveBeenCalledWith(expect.objectContaining({ percent: 100 }));
    expect(zipInstance.close).toHaveBeenCalled();
  });

  it('calls close even when extraction throws, then re-throws', async () => {
    const zipInstance = {
      entries: vi.fn().mockRejectedValue(new Error('zip corrupt')),
      extract: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    MockStreamZip.async.mockImplementation(function() { return zipInstance; });
    mockFs.existsSync.mockReturnValue(true);

    const fetcher = new NativeServerFetcher();
    await expect((fetcher as any).extractZip('/tmp/bad.zip', '/dest')).rejects.toThrow('zip corrupt');
    expect(zipInstance.close).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('calls extractZip without progress callback (no crash)', async () => {
    const fileEntry = { isDirectory: false, name: 'file.txt' };
    const zipInstance = {
      entries: vi.fn().mockResolvedValue({ 'file.txt': fileEntry }),
      extract: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    MockStreamZip.async.mockImplementation(function() { return zipInstance; });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);

    const fetcher = new NativeServerFetcher();
    // No progress callback — should not throw
    await expect((fetcher as any).extractZip('/tmp/test.zip', '/dest')).resolves.toBeUndefined();
  });
});
