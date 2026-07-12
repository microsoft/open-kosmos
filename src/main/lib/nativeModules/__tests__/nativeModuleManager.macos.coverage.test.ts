// @ts-nocheck
/**
 * Coverage tests for NativeModuleManager macOS-specific platform fixes.
 *
 * The `os` module is mocked to report darwin/arm64 so that
 * `applyModuleFixes` and `fixMacosRpaths` execute (these are skipped on
 * non-darwin platforms in the main coverage test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockFs,
  mockApp,
  mockBrowserWindow,
  mockLogger,
  mockExecFileSync,
  mockNativeRequire,
} = vi.hoisted(() => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const mockFs = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    createWriteStream: vi.fn(),
    symlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlink: vi.fn((_p: string, cb: () => void) => cb()),
  };

  const mockWebContents = { send: vi.fn() };
  const mockWin = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
  const mockBrowserWindow = { getAllWindows: vi.fn(() => [mockWin]) };

  const mockApp = { getPath: vi.fn(() => '/user-data') };

  const mockExecFileSync = vi.fn();
  const mockNativeRequire = vi.fn((mod: string) => {
    if (mod === 'child_process') return { execFileSync: mockExecFileSync };
    return {};
  });

  return { mockFs, mockApp, mockBrowserWindow, mockLogger, mockExecFileSync, mockNativeRequire };
});

vi.mock('fs', () => mockFs);
vi.mock('electron', () => ({ app: mockApp, BrowserWindow: mockBrowserWindow }));
vi.mock('https', () => ({ default: { get: vi.fn() }, get: vi.fn() }));
vi.mock('http', () => ({ default: { get: vi.fn() }, get: vi.fn() }));
vi.mock('tar', () => ({ x: vi.fn().mockResolvedValue(undefined) }));
vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../unifiedLogger', () => ({ createLogger: () => mockLogger }));
vi.mock('module', () => ({ createRequire: () => mockNativeRequire }));
vi.mock('util', () => ({ promisify: (fn: any) => fn }));
vi.mock('os', () => ({
  default: { platform: () => 'darwin', arch: () => 'arm64' },
  platform: () => 'darwin',
  arch: () => 'arm64',
}));

describe('NativeModuleManager macOS fixes', () => {
  let manager: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([]);
    const mod = await import('../nativeModuleManager');
    manager = mod.nativeModuleManager;
    (manager as any).loadedModules.clear();
    (manager as any).activeDownloads.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── applyModuleFixes ───────────────────────────────────────────────────────

  it('no-ops for modules other than whisper-addon', () => {
    (manager as any).applyModuleFixes('other-module', '/local/path');
    expect(mockFs.symlinkSync).not.toHaveBeenCalled();
  });

  it('creates darwin->mac symlinks when mac dir exists and darwin dir is absent', () => {
    // mac-{arch} exists, darwin-{arch} does not; distDir for rpath fix absent
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.includes('mac-') && !s.includes('darwin-')) return true; // mac dirs exist
      return false; // darwin dirs + rpath distDir absent
    });

    (manager as any).applyModuleFixes('whisper-addon', '/local/whisper');

    // Symlink created for each arch where mac exists and darwin missing
    expect(mockFs.symlinkSync).toHaveBeenCalled();
    const targets = mockFs.symlinkSync.mock.calls.map((c: any[]) => String(c[1]));
    expect(targets.some((t: string) => t.includes('darwin-'))).toBe(true);
  });

  it('logs a warning when symlink creation fails', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.includes('mac-') && !s.includes('darwin-')) return true;
      return false;
    });
    mockFs.symlinkSync.mockImplementation(() => {
      throw new Error('EPERM');
    });

    (manager as any).applyModuleFixes('whisper-addon', '/local/whisper');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('skips symlink creation when darwin dir already exists', () => {
    // Both mac and darwin dirs exist -> no symlink; distDir for rpath absent
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.includes('mac-')) return true;
      if (s.includes('darwin-')) return true;
      return false;
    });

    (manager as any).applyModuleFixes('whisper-addon', '/local/whisper');
    expect(mockFs.symlinkSync).not.toHaveBeenCalled();
  });

  // ── fixMacosRpaths ─────────────────────────────────────────────────────────

  it('returns early when dist dir does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    (manager as any).fixMacosRpaths('/local/whisper');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns early when marker file already exists', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.endsWith('.rpath-fixed')) return true; // marker present
      if (s.includes('mac-arm64')) return true; // distDir present
      return false;
    });
    (manager as any).fixMacosRpaths('/local/whisper');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('runs install_name_tool for each .node file and writes marker', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.endsWith('.rpath-fixed')) return false; // no marker yet
      if (s.includes('mac-arm64')) return true; // distDir present
      return false;
    });
    mockFs.readdirSync.mockReturnValue(['whisper.node', 'libwhisper.dylib', 'addon.node']);

    (manager as any).fixMacosRpaths('/local/whisper');

    // Only .node files are processed
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'install_name_tool',
      ['-add_rpath', '@loader_path', expect.stringContaining('whisper.node')],
      expect.anything(),
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.rpath-fixed'),
      expect.any(String),
    );
  });

  it('ignores install_name_tool "already exists" errors without warning', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.endsWith('.rpath-fixed')) return false;
      if (s.includes('mac-arm64')) return true;
      return false;
    });
    mockFs.readdirSync.mockReturnValue(['whisper.node']);
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('failed'), { stderr: Buffer.from('rpath already exists') });
    });

    (manager as any).fixMacosRpaths('/local/whisper');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('warns on unexpected install_name_tool errors', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.endsWith('.rpath-fixed')) return false;
      if (s.includes('mac-arm64')) return true;
      return false;
    });
    mockFs.readdirSync.mockReturnValue(['whisper.node']);
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('boom'), { stderr: Buffer.from('some other failure') });
    });

    (manager as any).fixMacosRpaths('/local/whisper');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('ignores marker write failures', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s.endsWith('.rpath-fixed')) return false;
      if (s.includes('mac-arm64')) return true;
      return false;
    });
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => (manager as any).fixMacosRpaths('/local/whisper')).not.toThrow();
  });

  // ── getTarballUrl non-scoped branch ────────────────────────────────────────

  it('builds correct URL for a non-scoped package', () => {
    const url = (manager as any).getTarballUrl({ packageName: 'sharp', version: '0.34.0' });
    expect(url).toBe('https://registry.npmjs.org/sharp/-/sharp-0.34.0.tgz');
  });
});
