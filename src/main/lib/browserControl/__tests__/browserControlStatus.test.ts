import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    getMcpServerInfo: vi.fn(() => ({ config: null })),
  },
}));

const { mockNativeServerCheckFn } = vi.hoisted(() => ({
  mockNativeServerCheckFn: vi.fn(() => ({ exists: true, nativeServerDir: '/tmp/ns', needsDownload: false })),
}));

vi.mock('../nativeServerFetcher', () => {
  function NativeServerFetcher(this: any) {
    this.checkLocalNativeServer = mockNativeServerCheckFn;
  }
  return { NativeServerFetcher };
});

const { mockFsExistsSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => true),
}));

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({})),
  statSync: vi.fn(() => ({ size: 100 })),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn(), destroy: vi.fn(), on: vi.fn() })),
}));

const { mockExecFn } = vi.hoisted(() => ({
  mockExecFn: vi.fn((_cmd: string, cb: any) => { cb(null, ''); }),
}));

vi.mock('child_process', () => ({
  exec: mockExecFn,
}));

import { checkBrowserInstalled, checkBrowserControlEnabled, checkBrowserControlStatus } from '../browserControlStatus';

// Helper to temporarily override process.platform
function withPlatform(platform: string, fn: () => Promise<any>) {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return fn().finally(() => {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  });
}

describe('checkBrowserInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on macOS (darwin)', () => {
    it('returns true when the Chrome .app bundle exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserInstalled('chrome');
        expect(result).toBe(true);
      });
    });

    it('returns false when the Chrome .app bundle does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserInstalled('chrome');
        expect(result).toBe(false);
      });
    });

    it('returns true when Edge .app bundle exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserInstalled('edge');
        expect(result).toBe(true);
      });
    });
  });

  describe('on Windows (win32)', () => {
    it('returns true when reg query succeeds', async () => {
      mockExecFn.mockImplementationOnce((_cmd: string, cb: any) => { cb(null, 'some output'); });
      await withPlatform('win32', async () => {
        const result = await checkBrowserInstalled('chrome');
        expect(result).toBe(true);
      });
    });

    it('returns false when reg query fails', async () => {
      mockExecFn.mockImplementationOnce((_cmd: string, cb: any) => { cb(new Error('not found'), ''); });
      await withPlatform('win32', async () => {
        const result = await checkBrowserInstalled('chrome');
        expect(result).toBe(false);
      });
    });
  });
});

describe('checkBrowserControlEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on macOS (darwin)', () => {
    it('returns true when Chrome NativeMessagingHost manifest exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserControlEnabled('chrome');
        expect(result).toBe(true);
      });
    });

    it('returns false when Chrome manifest does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserControlEnabled('chrome');
        expect(result).toBe(false);
      });
    });

    it('returns true when Edge NativeMessagingHost manifest exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      await withPlatform('darwin', async () => {
        const result = await checkBrowserControlEnabled('edge');
        expect(result).toBe(true);
      });
    });
  });

  describe('on Windows (win32)', () => {
    it('returns true when registry contains native host name', async () => {
      mockExecFn.mockImplementationOnce((_cmd: string, cb: any) => {
        cb(null, 'com.chromemcp.nativehost');
      });
      await withPlatform('win32', async () => {
        const result = await checkBrowserControlEnabled('chrome');
        expect(result).toBe(true);
      });
    });

    it('returns false when registry query fails', async () => {
      mockExecFn.mockImplementationOnce((_cmd: string, cb: any) => { cb(new Error('not found'), ''); });
      await withPlatform('win32', async () => {
        const result = await checkBrowserControlEnabled('edge');
        expect(result).toBe(false);
      });
    });

    it('returns false when stdout does not include native host name', async () => {
      mockExecFn.mockImplementationOnce((_cmd: string, cb: any) => { cb(null, 'unrelated output'); });
      await withPlatform('win32', async () => {
        const result = await checkBrowserControlEnabled('chrome');
        expect(result).toBe(false);
      });
    });
  });
});

describe('checkBrowserControlStatus', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    mockNativeServerCheckFn.mockReturnValue({ exists: true, nativeServerDir: '/tmp/ns', needsDownload: false });
    // Reset profileCacheManager to default (config: null)
    const { profileCacheManager } = await import('../../userDataADO');
    (profileCacheManager.getMcpServerInfo as any).mockReturnValue({ config: null });
  });

  it('returns false when userAlias is null', async () => {
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', null);
      expect(result).toBe(false);
    });
  });

  it('returns false when browser is not installed', async () => {
    mockFsExistsSync.mockReturnValue(false);
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(false);
    });
  });

  it('returns false when native messaging host is not configured', async () => {
    // Chrome app exists, NMH manifest does not
    let callCount = 0;
    mockFsExistsSync.mockImplementation(() => {
      callCount++;
      return callCount === 1; // app exists on first check, manifest doesn't
    });
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(false);
    });
  });

  it('returns false when MCP profile config is missing', async () => {
    const { profileCacheManager } = await import('../../userDataADO');
    (profileCacheManager.getMcpServerInfo as any).mockReturnValue({ config: null });
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(false);
    });
  });

  it('returns true when all conditions are met', async () => {
    const { profileCacheManager } = await import('../../userDataADO');
    (profileCacheManager.getMcpServerInfo as any).mockReturnValue({ config: { some: 'config' } });
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(true);
    });
  });

  it('returns false when native server does not exist', async () => {
    const { profileCacheManager } = await import('../../userDataADO');
    (profileCacheManager.getMcpServerInfo as any).mockReturnValue({ config: { some: 'config' } });
    mockNativeServerCheckFn.mockReturnValueOnce({ exists: false, nativeServerDir: '/tmp/ns', needsDownload: true });
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(false);
    });
  });

  it('returns false and does not throw on unexpected error', async () => {
    mockFsExistsSync.mockImplementationOnce(() => { throw new Error('unexpected'); });
    await withPlatform('darwin', async () => {
      const result = await checkBrowserControlStatus('chrome', 'user1');
      expect(result).toBe(false);
    });
  });
});
