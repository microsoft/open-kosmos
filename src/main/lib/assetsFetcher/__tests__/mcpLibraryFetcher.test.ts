/**
 * McpLibraryFetcher unit tests
 *
 * Covers:
 * - getInstance() singleton pattern
 * - fetchAndUpdate() remote fetch + local save
 * - getLibraryData() remote-first + local fallback paths
 * - loadFromLocal() invalid format and read error paths
 * - ensureDirectories() creation and error paths
 * - hasLocalCache() / getLibraryFilePath()
 * - HTTP vs HTTPS protocol selection
 * - Timeout and request error handling
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../utils/urlUtils', async () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => url + '?ts=mock'),
}));

vi.mock('https', async () => ({
  default: { get: vi.fn() },
  get: vi.fn(),
}));

vi.mock('http', async () => ({
  default: { get: vi.fn() },
  get: vi.fn(),
}));

import * as fs from 'fs';
import https from 'https';
import http from 'http';
import { McpLibraryFetcher } from '../mcpLibraryFetcher';

// ─── Helpers ───

const SAMPLE_DATA = {
  mcp_servers: [
    { name: 'server-1', description: 'First server', version: '1.0.0', transport: 'stdio' as const },
    { name: 'server-2', description: 'Second server', version: '2.0.0', transport: 'sse' as const },
  ],
};

function buildMockResponse(body: string, statusCode = 200) {
  const mockResponse: Record<string, any> = {
    statusCode,
    statusMessage: statusCode === 200 ? 'OK' : 'Not Found',
    on: vi.fn((event: string, cb: Function): Record<string, any> => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') cb();
      return mockResponse;
    }),
  };
  return mockResponse;
}

function buildMockRequest(overrides: Partial<Record<string, any>> = {}) {
  const req: Record<string, any> = {
    on: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
    ...overrides,
  };
  return req;
}

function mockSuccessHttps(data: object) {
  const res = buildMockResponse(JSON.stringify(data));
  const req = buildMockRequest();
  (https.get as Mock).mockImplementation((_url: string, cb: Function) => {
    cb(res);
    return req;
  });
  return req;
}

function mockHttpError(message: string) {
  const req = buildMockRequest({
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'error') cb(new Error(message));
      return req;
    }),
  });
  (https.get as Mock).mockImplementation((_url: string, _cb: Function) => req);
  return req;
}

// ─── Suite ───

describe('McpLibraryFetcher', () => {
  let fetcher: McpLibraryFetcher;

  beforeEach(() => {
    (McpLibraryFetcher as any).instance = undefined;
    // CDN has no built-in default; provide one so remote-fetch tests have a base URL.
    process.env.PRODUCTION_BASE_CDN_URL = 'https://cdn.test.example.com';
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.mkdirSync as Mock).mockReset();
    (fs.writeFileSync as Mock).mockReset();
    (fs.readFileSync as Mock).mockReset();
    fetcher = McpLibraryFetcher.getInstance();
  });

  afterEach(() => {
    (McpLibraryFetcher as any).instance = undefined;
    vi.clearAllMocks();
  });

  // ─── Singleton ───
  describe('Singleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = McpLibraryFetcher.getInstance();
      const b = McpLibraryFetcher.getInstance();
      expect(a).toBe(b);
    });
  });

  // ─── ensureDirectories ───
  describe('ensureDirectories()', () => {
    it('creates assetsDir and mcpDir when they do not exist', () => {
      (McpLibraryFetcher as any).instance = undefined;
      (fs.existsSync as Mock).mockReturnValue(false);

      McpLibraryFetcher.getInstance();

      expect(fs.mkdirSync).toHaveBeenCalledTimes(2);
    });

    it('skips creation when directories already exist', () => {
      (McpLibraryFetcher as any).instance = undefined;
      (fs.existsSync as Mock).mockReturnValue(true);

      McpLibraryFetcher.getInstance();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('propagates errors from mkdirSync', () => {
      (McpLibraryFetcher as any).instance = undefined;
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.mkdirSync as Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => McpLibraryFetcher.getInstance()).toThrow('Permission denied');
    });
  });

  // ─── fetchAndUpdate ───
  describe('fetchAndUpdate()', () => {
    it('fetches remote data and writes to local file', async () => {
      mockSuccessHttps(SAMPLE_DATA);

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(true);
      expect(result.data!.mcp_servers).toHaveLength(2);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('returns error when network request fails', async () => {
      mockHttpError('ECONNREFUSED');

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('returns error when HTTP status is not 200', async () => {
      const res = buildMockResponse('Not Found', 404);
      const req = buildMockRequest();
      (https.get as Mock).mockImplementation((_url: string, cb: Function) => {
        cb(res);
        return req;
      });

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
    });

    it('returns error when response JSON is invalid', async () => {
      const res = buildMockResponse('not-json');
      const req = buildMockRequest();
      (https.get as Mock).mockImplementation((_url: string, cb: Function) => {
        cb(res);
        return req;
      });

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse JSON');
    });

    it('returns error when mcp_servers array is missing from response', async () => {
      const res = buildMockResponse(JSON.stringify({ other_field: [] }));
      const req = buildMockRequest();
      (https.get as Mock).mockImplementation((_url: string, cb: Function) => {
        cb(res);
        return req;
      });

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid data format');
    });

    it('returns error on request timeout', async () => {
      const req: Record<string, any> = {
        on: vi.fn().mockReturnThis(),
        setTimeout: vi.fn((ms: number, cb: Function) => {
          cb(); // immediately trigger timeout
          return req;
        }),
        destroy: vi.fn(),
      };
      (https.get as Mock).mockImplementation((_url: string, _cb: Function) => req);

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      expect(req.destroy).toHaveBeenCalled();
    });

    it('returns error when writeFileSync throws', async () => {
      mockSuccessHttps(SAMPLE_DATA);
      (fs.writeFileSync as Mock).mockImplementation(() => {
        throw new Error('Disk full');
      });

      const result = await fetcher.fetchAndUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
    });
  });

  // ─── getLibraryData ───
  describe('getLibraryData()', () => {
    it('returns remote data when fetch succeeds', async () => {
      mockSuccessHttps(SAMPLE_DATA);

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(true);
      expect(result.data!.mcp_servers).toHaveLength(2);
    });

    it('falls back to local cache when remote fails', async () => {
      mockHttpError('Network error');
      const localData = { mcp_servers: [{ name: 'cached', description: 'old', transport: 'stdio' as const }] };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(localData));

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(true);
      expect(result.data!.mcp_servers[0].name).toBe('cached');
    });

    it('returns error when both remote and local fail', async () => {
      mockHttpError('Network error');
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns null-servers error when local cache has invalid format', async () => {
      mockHttpError('Network error');
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({ mcp_servers: 'not-an-array' }));

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(false);
    });

    it('uses local cache as fallback after exception in fetchFromRemote', async () => {
      (https.get as Mock).mockImplementation(() => {
        throw new Error('Unexpected crash');
      });
      const localData = { mcp_servers: [{ name: 'fallback', description: 'cached', transport: 'stdio' as const }] };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(localData));

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(true);
      expect(result.data!.mcp_servers[0].name).toBe('fallback');
    });

    it('returns error when exception thrown and local fallback also fails', async () => {
      (https.get as Mock).mockImplementation(() => {
        throw new Error('Unexpected crash');
      });
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected crash');
    });

    it('handles local cache read error gracefully', async () => {
      mockHttpError('Network error');
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = await fetcher.getLibraryData();

      expect(result.success).toBe(false);
    });
  });

  // ─── HTTP protocol selection ───
  describe('HTTP protocol selection', () => {
    it('uses http module for http:// URLs', async () => {
      (McpLibraryFetcher as any).instance = undefined;
      const origEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      process.env.PRODUCTION_BASE_CDN_URL = 'http://cdn.example.com';

      const httpFetcher = McpLibraryFetcher.getInstance();

      const res = buildMockResponse(JSON.stringify(SAMPLE_DATA));
      const req = buildMockRequest();
      (http.get as Mock).mockImplementation((_url: string, cb: Function) => {
        cb(res);
        return req;
      });

      const result = await httpFetcher.fetchAndUpdate();

      expect(http.get).toHaveBeenCalled();
      expect(result.success).toBe(true);

      process.env.NODE_ENV = origEnv;
      delete process.env.PRODUCTION_BASE_CDN_URL;
    });
  });

  // ─── Utility accessors ───
  describe('Utility accessors', () => {
    it('getLibraryFilePath() contains mcp and filename', () => {
      const p = fetcher.getLibraryFilePath();
      expect(p).toContain('mcp');
      expect(p).toContain('mcp_lib.json');
    });

    it('hasLocalCache() reflects fs.existsSync', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      expect(fetcher.hasLocalCache()).toBe(true);

      (fs.existsSync as Mock).mockReturnValue(false);
      expect(fetcher.hasLocalCache()).toBe(false);
    });
  });
});
