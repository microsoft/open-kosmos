/**
 * LocalPythonMirror unit tests
 *
 * Covers:
 * - start() — creates HTTP server and returns base URL
 * - getBaseUrl() / getBaseUrlIfRunning()
 * - stop() — closes server and resets state
 * - handleRequest() — local file serving, redirect to GitHub, error paths
 */

// ─── Mocks ───

vi.mock('electron', async () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  },
}));

vi.mock('../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { LocalPythonMirror } from '../LocalPythonMirror';

describe('LocalPythonMirror', () => {
  let mirror: LocalPythonMirror;

  beforeEach(() => {
    (LocalPythonMirror as any).instance = undefined;
    mirror = LocalPythonMirror.getInstance();
  });

  afterEach(() => {
    mirror.stop();
    (LocalPythonMirror as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('returns the same instance', () => {
      const a = LocalPythonMirror.getInstance();
      const b = LocalPythonMirror.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('getBaseUrlIfRunning', () => {
    it('returns null when server is not running', () => {
      expect(mirror.getBaseUrlIfRunning()).toBeNull();
    });
  });

  describe('start / stop', () => {
    it('starts the server and returns a URL', async () => {
      const url = await mirror.start();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(mirror.getBaseUrlIfRunning()).toBe(url);
    });

    it('returns same URL on second start call (idempotent)', async () => {
      const url1 = await mirror.start();
      const url2 = await mirror.start();
      expect(url1).toBe(url2);
    });

    it('stop() closes the server and resets getBaseUrlIfRunning', async () => {
      await mirror.start();
      mirror.stop();
      expect(mirror.getBaseUrlIfRunning()).toBeNull();
    });

    it('stop() is safe to call when not running', () => {
      expect(() => mirror.stop()).not.toThrow();
    });
  });

  describe('handleRequest', () => {
    let port: number;

    beforeEach(async () => {
      const url = await mirror.start();
      port = parseInt(url.split(':')[2]);
    });

    function makeRequest(
      urlPath: string,
    ): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }> {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk.toString(); });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode || 0, headers: res.headers as any, body });
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    it('returns 400 for invalid URL format (less than 2 path segments)', async () => {
      const res = await makeRequest('/singlepart');
      expect(res.statusCode).toBe(400);
    });

    it('redirects to GitHub for files not found locally', async () => {
      const res = await makeRequest('/20240106/cpython-3.12.1-linux-x86_64.tar.gz');
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('github.com');
      expect(res.headers.location).toContain('20240106');
      expect(res.headers.location).toContain('cpython-3.12.1-linux-x86_64.tar.gz');
    });

    it('serves local file when it exists', async () => {
      const resourcesPath = path.join(process.cwd(), 'resources', 'python');
      const tag = 'test-tag';
      const filename = 'test-file.tar.gz';
      const localDir = path.join(resourcesPath, tag);
      const localFile = path.join(localDir, filename);

      let created = false;
      try {
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(localFile, 'fake archive content', 'utf-8');
        created = true;

        const res = await makeRequest(`/${tag}/${filename}`);
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('fake archive content');
      } finally {
        if (created) {
          try {
            fs.unlinkSync(localFile);
            fs.rmdirSync(localDir);
          } catch { /* ignore */ }
        }
      }
    });

    it('returns 400 for root URL path (/)', async () => {
      const res = await makeRequest('/');
      expect(res.statusCode).toBe(400);
    });
  });
});
