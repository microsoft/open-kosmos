// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../utils/urlUtils', () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => `${url}?t=12345`),
}));

const { mockFsExistsSync, mockFsReadFileSync, mockFsWriteFileSync, mockFsStatSync, mockFsUnlinkSync, mockFsMkdirSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => false),
  mockFsReadFileSync: vi.fn(() => JSON.stringify({})),
  mockFsWriteFileSync: vi.fn(),
  mockFsStatSync: vi.fn(() => ({ size: 1024 })),
  mockFsUnlinkSync: vi.fn(),
  mockFsMkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  statSync: mockFsStatSync,
  unlinkSync: mockFsUnlinkSync,
  mkdirSync: mockFsMkdirSync,
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  })),
  chmodSync: vi.fn(),
}));

const { mockHttpsGetFn, mockHttpGetFn } = vi.hoisted(() => ({
  mockHttpsGetFn: vi.fn(),
  mockHttpGetFn: vi.fn(),
}));

vi.mock('https', () => ({
  get: mockHttpsGetFn,
  request: vi.fn(),
}));

vi.mock('http', () => ({
  get: mockHttpGetFn,
  request: vi.fn(),
}));

import { UpdaterFetcher } from '../updaterFetcher';

function setupHttpsGetSuccess(statusCode: number, data: string) {
  mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
    const events: Record<string, Function[]> = {};
    const res = {
      statusCode,
      statusMessage: statusCode === 200 ? 'OK' : 'Error',
      headers: {},
      on: vi.fn((event: string, fn: Function) => {
        events[event] = events[event] || [];
        events[event].push(fn);
        return res;
      }),
    };
    cb(res);
    process.nextTick(() => {
      (events['data'] || []).forEach((fn) => fn(Buffer.from(data)));
      (events['end'] || []).forEach((fn) => fn());
    });
    return { on: vi.fn() };
  });
}

function setupHttpsGetError() {
  mockHttpsGetFn.mockImplementationOnce((_url: any, _cb: any) => {
    const eventHandlers: Record<string, Function> = {};
    const req = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      }),
    };
    process.nextTick(() => eventHandlers['error']?.(new Error('network error')));
    return req;
  });
}

describe('UpdaterFetcher', () => {
  let fetcher: UpdaterFetcher;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    // CDN has no built-in default; provide one so HTTP-path tests have a base URL.
    process.env.PRODUCTION_BASE_CDN_URL = 'https://cdn.test.example.com';
    mockFsExistsSync.mockReturnValue(false);
    fetcher = new UpdaterFetcher();
  });

  describe('getLocalUpdaterVersion', () => {
    it('returns "0.0.0" when app.json does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      expect(fetcher.getLocalUpdaterVersion()).toBe('0.0.0');
    });

    it('returns the version from app.json when present', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ updaterVersion: '1.2.3' }) as any);
      expect(fetcher.getLocalUpdaterVersion()).toBe('1.2.3');
    });

    it('returns "0.0.0" when app.json has no updaterVersion field', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);
      expect(fetcher.getLocalUpdaterVersion()).toBe('0.0.0');
    });

    it('returns "0.0.0" when app.json JSON is invalid', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('not-json' as any);
      expect(fetcher.getLocalUpdaterVersion()).toBe('0.0.0');
    });
  });

  describe('setLocalUpdaterVersion', () => {
    it('writes the version to app.json', () => {
      mockFsExistsSync.mockReturnValue(false);
      fetcher.setLocalUpdaterVersion('2.0.0');
      expect(mockFsWriteFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(mockFsWriteFileSync.mock.calls[0][1] as string);
      expect(written.updaterVersion).toBe('2.0.0');
    });

    it('merges with existing app.json content', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ someOtherField: 'keep-me' }) as any);
      fetcher.setLocalUpdaterVersion('3.0.0');
      const written = JSON.parse(mockFsWriteFileSync.mock.calls[0][1] as string);
      expect(written.updaterVersion).toBe('3.0.0');
      expect(written.someOtherField).toBe('keep-me');
    });
  });

  describe('checkLocalUpdater', () => {
    it('returns exists=false when updater file does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = fetcher.checkLocalUpdater();
      expect(result.exists).toBe(false);
      expect(result.needsDownload).toBe(true);
    });

    it('returns exists=true when updater file exists and is non-empty', () => {
      mockFsExistsSync.mockImplementation((p: any) => String(p).includes('updater'));
      mockFsStatSync.mockReturnValue({ size: 1024 } as any);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);
      const result = fetcher.checkLocalUpdater();
      expect(result.exists).toBe(true);
      expect(result.needsDownload).toBe(false);
    });

    it('deletes empty updater file and returns exists=false', () => {
      mockFsExistsSync.mockImplementation((p: any) => String(p).includes('updater'));
      mockFsStatSync.mockReturnValue({ size: 0 } as any);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);
      const result = fetcher.checkLocalUpdater();
      expect(mockFsUnlinkSync).toHaveBeenCalled();
      expect(result.exists).toBe(false);
    });

    it('returns exists=false on stat error', () => {
      mockFsExistsSync.mockImplementation((p: any) => String(p).includes('updater'));
      mockFsStatSync.mockImplementation(() => { throw new Error('permission denied'); });
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);
      const result = fetcher.checkLocalUpdater();
      expect(result.exists).toBe(false);
      expect(result.needsDownload).toBe(true);
    });
  });

  describe('getRemoteUpdaterVersion', () => {
    it('returns null when CDN fetch fails (no response)', async () => {
      setupHttpsGetError();
      const version = await fetcher.getRemoteUpdaterVersion();
      expect(version).toBeNull();
    });

    it('returns version string when CDN responds correctly', async () => {
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '1.5.0',
        downloadUrls: { [`${process.platform}-${process.arch}`]: 'updater-mac-arm64' },
      }));
      const version = await fetcher.getRemoteUpdaterVersion();
      expect(version).toBe('1.5.0');
    });
  });

  describe('checkUpdaterNeedsUpdate', () => {
    it('returns needsUpdate=false when remote fetch fails', async () => {
      mockFsExistsSync.mockReturnValue(false);
      setupHttpsGetError();
      const result = await fetcher.checkUpdaterNeedsUpdate();
      expect(result.needsUpdate).toBe(false);
      expect(result.remoteVersion).toBeNull();
    });

    it('returns needsUpdate=true when local is older than remote', async () => {
      mockFsExistsSync.mockReturnValue(false);
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '1.0.0', downloadUrls: {} }));
      const result = await fetcher.checkUpdaterNeedsUpdate();
      expect(result.needsUpdate).toBe(true);
      expect(result.localVersion).toBe('0.0.0');
      expect(result.remoteVersion).toBe('1.0.0');
    });

    it('returns needsUpdate=false when versions are equal', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ updaterVersion: '1.0.0' }) as any);
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '1.0.0', downloadUrls: {} }));
      const result = await fetcher.checkUpdaterNeedsUpdate();
      expect(result.needsUpdate).toBe(false);
    });

    it('returns needsUpdate=false when local is newer than remote', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ updaterVersion: '2.0.0' }) as any);
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '1.0.0', downloadUrls: {} }));
      const result = await fetcher.checkUpdaterNeedsUpdate();
      expect(result.needsUpdate).toBe(false);
    });
  });

  describe('downloadUpdater', () => {
    it('returns error when CDN info fetch fails', async () => {
      setupHttpsGetError();
      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch updaters.json');
    });

    it('returns error for unsupported platform', async () => {
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '1.0.0',
        downloadUrls: { 'other-platform-x64': 'updater-other' },
      }));
      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported platform');
    });
  });

  describe('ensureUpdater', () => {
    it('downloads if local updater does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      setupHttpsGetError();
      const result = await fetcher.ensureUpdater();
      expect(result.success).toBe(false);
      expect(result.downloaded).toBe(false);
    });

    it('returns success without download when local is up to date', async () => {
      // existsSync: true for updater file, true for app.json
      mockFsExistsSync.mockReturnValue(true);
      // statSync: non-empty file
      mockFsStatSync.mockReturnValue({ size: 1024 } as any);
      // readFileSync: returns updaterVersion 1.0.0
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ updaterVersion: '1.0.0' }) as any);
      // Remote version also 1.0.0
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '1.0.0', downloadUrls: {} }));
      const result = await fetcher.ensureUpdater();
      expect(result.success).toBe(true);
      expect(result.downloaded).toBe(false);
    });

    it('downloads when local is outdated', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsStatSync.mockReturnValue({ size: 1024 } as any);
      // Local version 0.0.0
      mockFsReadFileSync.mockReturnValue(JSON.stringify({ updaterVersion: '0.0.0' }) as any);
      // First CDN call (checkUpdaterNeedsUpdate): remote is 2.0.0
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '2.0.0', downloadUrls: {} }));
      // Second CDN call (downloadUpdater) fails
      setupHttpsGetError();
      const result = await fetcher.ensureUpdater();
      expect(result.success).toBe(false);
    });
  });

  describe('downloadUpdater – success path', () => {
    function setupHttpsDownloadSuccess(data: string, statusCode = 200) {
      mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const events: Record<string, Function[]> = {};
        const res = {
          statusCode,
          statusMessage: statusCode === 200 ? 'OK' : 'Error',
          headers: { 'content-length': String(data.length) },
          on: vi.fn((event: string, fn: Function) => {
            events[event] = events[event] || [];
            events[event].push(fn);
            return res;
          }),
        };
        cb(res);
        process.nextTick(() => {
          (events['data'] || []).forEach(fn => fn(Buffer.from(data)));
          (events['end'] || []).forEach(fn => fn());
        });
        const req = { on: vi.fn(), setTimeout: vi.fn() };
        return req;
      });
    }

    it('succeeds end-to-end with progress callback on darwin', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const platformKey = `${process.platform}-${process.arch}`;
      const updatersInfo = JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'updater-mac-arm64' },
      });

      // First call: fetches updaters.json
      setupHttpsGetSuccess(200, updatersInfo);
      // Second call: downloads the binary
      setupHttpsDownloadSuccess('binary-data');
      // Third call for writing app.json (synchronous, no extra mock needed)

      mockFsExistsSync.mockReturnValue(false); // directory doesn't exist
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);

      const progressCalls: any[] = [];
      const result = await fetcher.downloadUpdater(p => progressCalls.push(p));

      expect(result.success).toBe(true);
      expect(result.version).toBe('2.0.0');
      // Final progress should have been called
      expect(progressCalls.some(p => p.percent === 100)).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns error when download response is non-200', async () => {
      const platformKey = `${process.platform}-${process.arch}`;
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'updater-file' },
      }));

      // Second call returns 404
      mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const res = {
          statusCode: 404,
          statusMessage: 'Not Found',
          headers: {},
          on: vi.fn(),
        };
        cb(res);
        return { on: vi.fn(), setTimeout: vi.fn() };
      });

      mockFsExistsSync.mockReturnValue(true); // dir exists
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);

      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });
  });

  describe('setLocalUpdaterVersion – write error', () => {
    it('handles writeFileSync error gracefully', () => {
      mockFsExistsSync.mockReturnValue(false);
      const { writeFileSync } = require('fs');
      // The mock is already set up; override for one call to throw
      mockFsWriteFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
      // Should not throw
      expect(() => fetcher.setLocalUpdaterVersion('1.0.0')).not.toThrow();
    });
  });

  describe('constructor environment detection', () => {
    it('uses development CDN URL when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      process.env.DEVELOPMENT_BASE_CDN_URL = 'https://custom-dev.example.com';
      const devFetcher = new UpdaterFetcher();
      expect((devFetcher as any).baseUrl).toBe('https://custom-dev.example.com');
      delete process.env.DEVELOPMENT_BASE_CDN_URL;
    });

    it('uses no CDN URL when env var not set (auto-update disabled)', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEVELOPMENT_BASE_CDN_URL;
      const devFetcher = new UpdaterFetcher();
      expect((devFetcher as any).baseUrl).toBe('');
    });

    it('uses production CDN URL when NODE_ENV is not development', () => {
      process.env.NODE_ENV = 'production';
      process.env.PRODUCTION_BASE_CDN_URL = 'https://prod.cdn.example.com';
      const prodFetcher = new UpdaterFetcher();
      expect((prodFetcher as any).baseUrl).toBe('https://prod.cdn.example.com');
      delete process.env.PRODUCTION_BASE_CDN_URL;
    });
  });

  describe('httpGet – HTTP (non-HTTPS)', () => {
    it('calls http.get for http:// URLs', async () => {
      mockHttpGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const events: Record<string, Function[]> = {};
        const res = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: {},
          on: vi.fn((event: string, fn: Function) => {
            events[event] = events[event] || [];
            events[event].push(fn);
            return res;
          }),
        };
        cb(res);
        process.nextTick(() => {
          (events['data'] || []).forEach(fn => fn(Buffer.from('{"latest":"1.0.0","downloadUrls":{}}')));
          (events['end'] || []).forEach(fn => fn());
        });
        return { on: vi.fn() };
      });

      // Temporarily use http baseUrl
      (fetcher as any).baseUrl = 'http://localhost:3000';
      const version = await fetcher.getRemoteUpdaterVersion();
      expect(version).toBe('1.0.0');
    });

    it('rejects when HTTP response is non-200', async () => {
      mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const events: Record<string, Function[]> = {};
        const res = {
          statusCode: 500,
          statusMessage: 'Server Error',
          headers: {},
          on: vi.fn((event: string, fn: Function) => {
            events[event] = events[event] || [];
            events[event].push(fn);
            return res;
          }),
        };
        cb(res);
        process.nextTick(() => {
          (events['data'] || []).forEach(fn => fn(Buffer.from('')));
          (events['end'] || []).forEach(fn => fn());
        });
        return { on: vi.fn() };
      });

      const version = await fetcher.getRemoteUpdaterVersion();
      expect(version).toBeNull();
    });
  });

  describe('getUpdaterDir / getUpdaterLocalPath – win32', () => {
    it('uses .exe extension on win32', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      const localPath = (fetcher as any).getUpdaterLocalPath();
      expect(localPath).toContain('.exe');
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('uses no extension on darwin', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      const localPath = (fetcher as any).getUpdaterLocalPath();
      expect(localPath).not.toContain('.exe');
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('downloadFile internals – response error', () => {
    it('rejects and cleans up file on response error event', async () => {
      const platformKey = `${process.platform}-${process.arch}`;
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'updater-file' },
      }));

      // Second request: response emits error
      mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const events: Record<string, Function[]> = {};
        const res = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'content-length': '100' },
          on: vi.fn((event: string, fn: Function) => {
            events[event] = events[event] || [];
            events[event].push(fn);
            return res;
          }),
        };
        cb(res);
        process.nextTick(() => {
          (events['error'] || []).forEach(fn => fn(new Error('response stream error')));
        });
        return { on: vi.fn(), setTimeout: vi.fn() };
      });

      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);

      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('response stream error');
    });

    it('rejects and cleans up file on request error event', async () => {
      const platformKey = `${process.platform}-${process.arch}`;
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'updater-file' },
      }));

      // Second request: request-level error
      mockHttpsGetFn.mockImplementationOnce((_url: any, _cb: any) => {
        const reqEvents: Record<string, Function> = {};
        const req = {
          on: vi.fn((event: string, fn: Function) => { reqEvents[event] = fn; }),
          setTimeout: vi.fn(),
        };
        process.nextTick(() => reqEvents['error']?.(new Error('request error')));
        return req;
      });

      mockFsExistsSync.mockReturnValue(false);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);

      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('request error');
    });

    it('rejects on timeout', async () => {
      const platformKey = `${process.platform}-${process.arch}`;
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'updater-file' },
      }));

      // Second request: timeout fires
      mockHttpsGetFn.mockImplementationOnce((_url: any, _cb: any) => {
        const reqEvents: Record<string, Function> = {};
        let timeoutCb: Function | null = null;
        const req = {
          on: vi.fn((event: string, fn: Function) => { reqEvents[event] = fn; }),
          setTimeout: vi.fn((_ms: number, cb: Function) => { timeoutCb = cb; }),
          destroy: vi.fn(),
        };
        process.nextTick(() => timeoutCb?.());
        return req;
      });

      mockFsExistsSync.mockReturnValue(false);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}) as any);

      const result = await fetcher.downloadUpdater();
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });
});
