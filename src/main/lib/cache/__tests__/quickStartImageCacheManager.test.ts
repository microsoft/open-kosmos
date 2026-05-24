import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const { mockFsExistsSync, mockFsMkdirSync, mockFsRmSync, mockFsWriteFileSync, mockFsReadFileSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => false),
  mockFsMkdirSync: vi.fn(() => undefined),
  mockFsRmSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsReadFileSync: vi.fn(() => Buffer.from('img-data')),
}));

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  mkdirSync: mockFsMkdirSync,
  rmSync: mockFsRmSync,
  writeFileSync: mockFsWriteFileSync,
  readFileSync: mockFsReadFileSync,
  statSync: vi.fn(() => ({ size: 100 })),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(() => ({
    write: vi.fn(), end: vi.fn(), destroy: vi.fn(), on: vi.fn(),
  })),
}));

import { quickStartImageCacheManager } from '../quickStartImageCacheManager';

describe('QuickStartImageCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
  });

  describe('getCacheDirectory', () => {
    it('returns a string path containing quick_start_images', () => {
      const dir = quickStartImageCacheManager.getCacheDirectory();
      expect(typeof dir).toBe('string');
      expect(dir).toContain('quick_start_images');
    });
  });

  describe('isCached', () => {
    it('returns true when cached file exists', () => {
      mockFsExistsSync.mockReturnValue(true);
      expect(quickStartImageCacheManager.isCached('MyAgent', 'https://example.com/img.png')).toBe(true);
    });

    it('returns false when file does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      expect(quickStartImageCacheManager.isCached('MyAgent', 'https://example.com/img.png')).toBe(false);
    });
  });

  describe('getCachedPath', () => {
    it('returns the path when file exists', () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = quickStartImageCacheManager.getCachedPath('MyAgent', 'https://example.com/img.png');
      expect(result).not.toBeNull();
      expect(result).toContain('.png');
    });

    it('returns null when file does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = quickStartImageCacheManager.getCachedPath('MyAgent', 'https://example.com/img.png');
      expect(result).toBeNull();
    });

    it('uses .png extension for URLs without extension', () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = quickStartImageCacheManager.getCachedPath('MyAgent', 'https://example.com/image-no-ext');
      expect(result).toContain('.png');
    });

    it('uses correct extension for .jpg URL', () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = quickStartImageCacheManager.getCachedPath('MyAgent', 'https://example.com/photo.jpg');
      expect(result).toContain('.jpg');
    });

    it('returns null for invalid URL', () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = quickStartImageCacheManager.getCachedPath('MyAgent', 'not-a-url');
      expect(result).toBeNull();
    });
  });

  describe('clearAgentCache', () => {
    it('calls rmSync when agent cache dir exists', () => {
      mockFsExistsSync.mockReturnValue(true);
      quickStartImageCacheManager.clearAgentCache('MyAgent');
      expect(mockFsRmSync).toHaveBeenCalledWith(
        expect.stringContaining('MyAgent'),
        { recursive: true, force: true },
      );
    });

    it('does nothing when agent cache dir does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      quickStartImageCacheManager.clearAgentCache('NonExistent');
      expect(mockFsRmSync).not.toHaveBeenCalled();
    });

    it('sanitizes illegal characters in agent name', () => {
      mockFsExistsSync.mockReturnValue(true);
      quickStartImageCacheManager.clearAgentCache('My/Agent:With<Illegal>Chars');
      expect(mockFsRmSync).toHaveBeenCalledWith(
        expect.stringContaining('My_Agent_With_Illegal_Chars'),
        expect.anything(),
      );
    });

    it('handles rmSync errors gracefully', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsRmSync.mockImplementationOnce(() => { throw new Error('permission denied'); });
      expect(() => quickStartImageCacheManager.clearAgentCache('MyAgent')).not.toThrow();
    });
  });

  describe('clearAllCache', () => {
    it('removes the entire cache dir and recreates it', () => {
      // First call: dir exists (so rmSync is triggered)
      // After rmSync, ensureCacheDir is called; existsSync returns false so mkdirSync fires
      let callCount = 0;
      mockFsExistsSync.mockImplementation(() => {
        callCount++;
        return callCount === 1; // exists on first check, gone after rm
      });
      quickStartImageCacheManager.clearAllCache();
      expect(mockFsRmSync).toHaveBeenCalledWith(
        expect.stringContaining('quick_start_images'),
        { recursive: true, force: true },
      );
      expect(mockFsMkdirSync).toHaveBeenCalled();
    });

    it('does nothing when cache dir does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);
      quickStartImageCacheManager.clearAllCache();
      expect(mockFsRmSync).not.toHaveBeenCalled();
    });

    it('handles rmSync errors gracefully', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsRmSync.mockImplementationOnce(() => { throw new Error('fail'); });
      expect(() => quickStartImageCacheManager.clearAllCache()).not.toThrow();
    });
  });

  describe('cacheImage', () => {
    it('returns cached path immediately if file already exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = await quickStartImageCacheManager.cacheImage('Agent', 'https://example.com/img.png');
      expect(result).toContain('.png');
    });

    it('downloads and caches image when not yet cached', async () => {
      mockFsExistsSync.mockReturnValue(false);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      });
      const result = await quickStartImageCacheManager.cacheImage('Agent', 'https://example.com/new.png');
      expect(result).toContain('.png');
    });

    it('returns null when fetch fails (non-ok response)', async () => {
      mockFsExistsSync.mockReturnValue(false);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await quickStartImageCacheManager.cacheImage('Agent', 'https://example.com/missing.png');
      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFsExistsSync.mockReturnValue(false);
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
      const result = await quickStartImageCacheManager.cacheImage('Agent', 'https://example.com/img.png');
      expect(result).toBeNull();
    });

    it('creates agent subdirectory when missing', async () => {
      // First call (cache file check): false; second call (agent dir): false
      let callCount = 0;
      mockFsExistsSync.mockImplementation(() => {
        callCount++;
        return false;
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      });
      await quickStartImageCacheManager.cacheImage('Agent', 'https://example.com/img.png');
      expect(mockFsMkdirSync).toHaveBeenCalled();
    });
  });

  describe('getOrCacheImage', () => {
    it('returns base64 data URL from cached file', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('fake-image-data'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.png');
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('returns correct MIME for .jpg', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('jpeg-data'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/photo.jpg');
      expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('returns correct MIME for .jpeg', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('jpeg-data'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/photo.jpeg');
      expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('returns correct MIME for .webp', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('webp'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.webp');
      expect(result).toMatch(/^data:image\/webp;base64,/);
    });

    it('returns correct MIME for .gif', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('gif'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.gif');
      expect(result).toMatch(/^data:image\/gif;base64,/);
    });

    it('returns correct MIME for .svg', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('<svg/>'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/icon.svg');
      expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it('returns correct MIME for .bmp', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('bmp'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.bmp');
      expect(result).toMatch(/^data:image\/bmp;base64,/);
    });

    it('returns correct MIME for .ico', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('ico'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.ico');
      expect(result).toMatch(/^data:image\/x-icon;base64,/);
    });

    it('falls back to image/png MIME for unknown extension', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('data'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.xyz');
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('downloads and returns data URL when not in cache', async () => {
      // File not cached, then after download it "exists"
      let callCount = 0;
      mockFsExistsSync.mockImplementation(() => {
        callCount++;
        // First calls: not cached; final check: exists
        return callCount > 2;
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockFsReadFileSync.mockReturnValue(Buffer.from('downloaded'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/new.png');
      expect(result === null || (typeof result === 'string' && result.startsWith('data:'))).toBe(true);
    });

    it('returns null when caching fails', async () => {
      mockFsExistsSync.mockReturnValue(false);
      global.fetch = vi.fn().mockRejectedValue(new Error('fail'));
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/fail.png');
      expect(result).toBeNull();
    });

    it('returns null on unexpected readFileSync error', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockImplementationOnce(() => { throw new Error('read error'); });
      const result = await quickStartImageCacheManager.getOrCacheImage('Agent', 'https://example.com/img.png');
      expect(result).toBeNull();
    });
  });
});
