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

vi.mock('../../../shared/constants/branding', () => ({
  BRAND_NAME: 'kosmos',
}));

vi.mock('../../utils/urlUtils', () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => `${url}?t=12345`),
}));

// Use vi.hoisted so mock functions are available before vi.mock factories run
const { mockHttpsGetFn, mockHttpsRequestFn, mockHttpGetFn } = vi.hoisted(() => ({
  mockHttpsGetFn: vi.fn(),
  mockHttpsRequestFn: vi.fn(),
  mockHttpGetFn: vi.fn(),
}));

vi.mock('https', () => ({
  get: mockHttpsGetFn,
  request: mockHttpsRequestFn,
}));

vi.mock('http', () => ({
  get: mockHttpGetFn,
  request: vi.fn(),
}));

import { CdnUpdateChecker } from '../cdnUpdateChecker';

// Helper to emit a successful HTTP GET response
function setupHttpsGetSuccess(statusCode: number, data: string, headers: Record<string, string> = {}) {
  mockHttpsGetFn.mockImplementationOnce((_url: any, cb: any) => {
    const events: Record<string, Function[]> = {};
    const res = {
      statusCode,
      statusMessage: statusCode === 200 ? 'OK' : 'Error',
      headers,
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

function setupHttpsGetError(error: Error, code?: string) {
  if (code) (error as any).code = code;
  mockHttpsGetFn.mockImplementationOnce((_url: any, _cb: any) => {
    const eventHandlers: Record<string, Function> = {};
    const req = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      }),
    };
    process.nextTick(() => eventHandlers['error']?.(error));
    return req;
  });
}

function setupHttpsHeadSuccess(statusCode: number, headers: Record<string, string> = {}) {
  mockHttpsRequestFn.mockImplementationOnce((_url: any, _opts: any, cb: any) => {
    const res = { statusCode, headers, on: vi.fn() };
    cb(res);
    return { on: vi.fn(), end: vi.fn() };
  });
}

function setupHttpsHeadError(statusCode: number) {
  mockHttpsRequestFn.mockImplementationOnce((_url: any, _opts: any, cb: any) => {
    const res = { statusCode, headers: {}, on: vi.fn(), statusMessage: 'Error' };
    cb(res);
    return { on: vi.fn(), end: vi.fn() };
  });
}

describe('CdnUpdateChecker', () => {
  let checker: CdnUpdateChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    checker = new CdnUpdateChecker('https://cdn.example.com/');
  });

  describe('constructor', () => {
    it('strips trailing slash from CDN base URL', () => {
      expect(checker.getCdnBaseUrl()).toBe('https://cdn.example.com');
    });

    it('accepts URL without trailing slash', () => {
      const c = new CdnUpdateChecker('https://cdn.example.com');
      expect(c.getCdnBaseUrl()).toBe('https://cdn.example.com');
    });
  });

  describe('setCdnBaseUrl / getCdnBaseUrl', () => {
    it('updates CDN URL and strips trailing slash', () => {
      checker.setCdnBaseUrl('https://new-cdn.example.com/');
      expect(checker.getCdnBaseUrl()).toBe('https://new-cdn.example.com');
    });
  });

  describe('getCurrentPlatformKey', () => {
    it('returns platform-arch string', () => {
      const key = checker.getCurrentPlatformKey();
      expect(key).toBe(`${process.platform}-${process.arch}`);
    });
  });

  describe('isPlatformSupported', () => {
    it('returns true when current platform is in downloadUrls', () => {
      const platformKey = checker.getCurrentPlatformKey();
      const info = { latest: '2.0.0', downloadUrls: { [platformKey]: 'file.dmg' } };
      expect(checker.isPlatformSupported(info)).toBe(true);
    });

    it('returns false when current platform is not in downloadUrls', () => {
      const info = { latest: '2.0.0', downloadUrls: { 'other-platform-x64': 'file.dmg' } };
      expect(checker.isPlatformSupported(info)).toBe(false);
    });

    it('returns false when downloadUrls is missing', () => {
      expect(checker.isPlatformSupported({ latest: '2.0.0' } as any)).toBe(false);
    });
  });

  describe('checkForUpdates', () => {
    it('returns hasUpdate=false when current version equals latest', async () => {
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '1.0.0' }));
      const result = await checker.checkForUpdates();
      expect(result.hasUpdate).toBe(false);
      expect(result.updateInfo?.latest).toBe('1.0.0');
    });

    it('returns hasUpdate=false when current version is newer', async () => {
      setupHttpsGetSuccess(200, JSON.stringify({ latest: '0.9.0' }));
      const result = await checker.checkForUpdates();
      expect(result.hasUpdate).toBe(false);
    });

    it('returns hasUpdate=true with download URL when update is available', async () => {
      const platformKey = checker.getCurrentPlatformKey();
      const updateInfo = {
        latest: '2.0.0',
        downloadUrls: { [platformKey]: 'OpenKosmos-2.0.0-mac-arm64.dmg' },
      };
      setupHttpsGetSuccess(200, JSON.stringify(updateInfo));
      const result = await checker.checkForUpdates();
      expect(result.hasUpdate).toBe(true);
      expect(result.updateInfo?.latest).toBe('2.0.0');
      expect(result.downloadUrl).toContain('OpenKosmos-2.0.0-mac-arm64.dmg');
    });

    it('throws when server returns HTTP error', async () => {
      setupHttpsGetSuccess(404, '');
      await expect(checker.checkForUpdates()).rejects.toThrow('HTTP 404');
    });

    it('throws enhanced network error for ENOTFOUND', async () => {
      setupHttpsGetError(new Error('getaddrinfo ENOTFOUND'), 'ENOTFOUND');
      await expect(checker.checkForUpdates()).rejects.toThrow('Unable to connect');
    });

    it('throws enhanced SSL error for SSL messages', async () => {
      setupHttpsGetError(new Error('SSL certificate problem'));
      await expect(checker.checkForUpdates()).rejects.toThrow('SSL');
    });

    it('throws enhanced error for EAI_AGAIN', async () => {
      setupHttpsGetError(new Error('EAI_AGAIN'), 'EAI_AGAIN');
      await expect(checker.checkForUpdates()).rejects.toThrow('DNS');
    });

    it('throws enhanced error for ECONNREFUSED', async () => {
      setupHttpsGetError(new Error('connect ECONNREFUSED'), 'ECONNREFUSED');
      await expect(checker.checkForUpdates()).rejects.toThrow('Unable to connect');
    });

    it('throws plain error for non-network errors', async () => {
      setupHttpsGetError(new Error('some other error'));
      await expect(checker.checkForUpdates()).rejects.toThrow('some other error');
    });

    it('throws when download URL unavailable for platform', async () => {
      setupHttpsGetSuccess(200, JSON.stringify({
        latest: '2.0.0',
        downloadUrls: { 'other-platform-x64': 'file.dmg' },
      }));
      await expect(checker.checkForUpdates()).rejects.toThrow('Unsupported platform');
    });
  });

  describe('verifyDownloadExists', () => {
    it('returns true when HEAD request succeeds with 200', async () => {
      setupHttpsHeadSuccess(200);
      const result = await checker.verifyDownloadExists('https://cdn.example.com/file.dmg');
      expect(result).toBe(true);
    });

    it('returns false when HEAD request returns non-200', async () => {
      setupHttpsHeadError(404);
      const result = await checker.verifyDownloadExists('https://cdn.example.com/missing.dmg');
      expect(result).toBe(false);
    });

    it('returns false when HEAD request throws', async () => {
      mockHttpsRequestFn.mockImplementationOnce((_url: any, _opts: any, _cb: any) => {
        const eventHandlers: Record<string, Function> = {};
        const req = {
          on: vi.fn((e: string, h: Function) => { eventHandlers[e] = h; }),
          end: vi.fn(() => {
            process.nextTick(() => eventHandlers['error']?.(new Error('network error')));
          }),
        };
        return req;
      });
      const result = await checker.verifyDownloadExists('https://cdn.example.com/file.dmg');
      expect(result).toBe(false);
    });
  });

  describe('getFileInfo', () => {
    it('returns null when HEAD request fails', async () => {
      setupHttpsHeadError(500);
      const info = await checker.getFileInfo('https://cdn.example.com/OpenKosmos-2.0.0-mac-arm64.dmg');
      expect(info).toBeNull();
    });

    it('parses file info from successful HEAD response', async () => {
      setupHttpsHeadSuccess(200, { 'content-length': '1024000' });
      const info = await checker.getFileInfo('https://cdn.example.com/OpenKosmos-2.0.0-mac-arm64.dmg');
      expect(info).not.toBeNull();
      expect(info?.version).toBe('2.0.0');
      expect(info?.size).toBe(1024000);
      expect(info?.platform).toBe('darwin');
    });

    it('returns null for filename with too few parts', async () => {
      setupHttpsHeadSuccess(200, {});
      const info = await checker.getFileInfo('https://cdn.example.com/short.dmg');
      expect(info).toBeNull();
    });

    it('handles windows platform name mapping', async () => {
      setupHttpsHeadSuccess(200, { 'content-length': '2048' });
      const info = await checker.getFileInfo('https://cdn.example.com/OpenKosmos-2.0.0-win-x64.exe');
      expect(info?.platform).toBe('win32');
    });

    it('handles linux platform name mapping', async () => {
      setupHttpsHeadSuccess(200, { 'content-length': '2048' });
      const info = await checker.getFileInfo('https://cdn.example.com/OpenKosmos-2.0.0-linux-x64.AppImage');
      expect(info?.platform).toBe('linux');
    });
  });

  describe('HTTP fallback (http:// URLs)', () => {
    it('uses http module for http:// URLs', async () => {
      const httpChecker = new CdnUpdateChecker('http://cdn.example.com');
      mockHttpGetFn.mockImplementationOnce((_url: any, cb: any) => {
        const data = JSON.stringify({ latest: '1.0.0' });
        const events: Record<string, Function[]> = {};
        const res = {
          statusCode: 200, statusMessage: 'OK', headers: {},
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
      await httpChecker.checkForUpdates();
      expect(mockHttpGetFn).toHaveBeenCalled();
    });
  });
});
