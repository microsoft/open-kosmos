/**
 * RuntimeManager.deep5.test.ts
 *
 * Targets remaining uncovered lines (round 5):
 * - setPinnedPythonVersion: calls ensureVenvMatchesPinnedPython when version changes (line 144)
 * - ensureVenvMatchesPinnedPython: venv dir exists + version matches (early return, line 219),
 *   pyvenv.cfg parse failure (line 219), no venv dir triggers recreateVenv (line 260)
 * - ensureShims: error catch branch (line 503)
 * - initializeInternalMode: pinnedVersion branch in .then() (lines 557-564),
 *   .catch() error path (lines 567-568)
 * - ensureRequiredToolsInstalled: both tools already installed (lines 621-626, 648-650)
 * - installRuntime: existing lock reuse (lines 719-722)
 * - doInstallRuntime: unknown tool throws (line 761)
 * - getUvPythonDir: win32 branch with APPDATA (lines 784-785)
 * - listPythonVersionsFast: error catch (lines 864-867)
 * - downloadWithRedirects: redirect without location (line 1203), non-200 status (lines 1209-1210)
 * - installBunDirectly: unsupported platform throws (line 1254)
 * - installUvDirectly: unsupported platform throws (line 1332)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Allow os and https to be mocked per-test
vi.mock('os', async (importActual) => {
  const actual = await importActual<typeof import('os')>();
  return {
    ...actual,
    platform: vi.fn(actual.platform.bind(actual)),
    arch: vi.fn(actual.arch.bind(actual)),
    tmpdir: vi.fn(actual.tmpdir.bind(actual)),
    homedir: vi.fn(actual.homedir.bind(actual)),
  };
});

vi.mock('https', async (importActual) => {
  const actual = await importActual<typeof import('https')>();
  return {
    ...actual,
    get: vi.fn(actual.get.bind(actual)),
  };
});

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn((...args: any[]) => (actual.writeFileSync as any)(...args)),
    readdirSync: vi.fn((...args: any[]) => (actual.readdirSync as any)(...args)),
    existsSync: vi.fn((...args: any[]) => (actual.existsSync as any)(...args)),
  };
});

const { testUserData, mockLogger } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  };
  return {
    testUserData: p.join(o.tmpdir(), 'kosmos-test-RuntimeManager-deep5'),
    mockLogger: logger,
  };
});

const mockIpcHandlers: Record<string, Function> = {};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    isPackaged: false,
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: {
    handle: vi.fn().mockImplementation((channel: string, handler: Function) => {
      mockIpcHandlers[channel] = handler;
    }),
    on: vi.fn(),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

const mockCacheConfig = {
  runtimeEnvironment: {
    mode: 'system' as 'system' | 'internal',
    bunVersion: '1.5.0',
    uvVersion: '0.7.0',
    pinnedPythonVersion: null as string | null,
  },
};

vi.mock('../../userDataADO/appCacheManager', () => ({
  appCacheManager: {
    getConfig: vi.fn().mockImplementation(() => ({
      ...mockCacheConfig,
      runtimeEnvironment: { ...mockCacheConfig.runtimeEnvironment },
    })),
    updateConfig: vi.fn().mockImplementation((update: any) => {
      if (update.runtimeEnvironment) {
        mockCacheConfig.runtimeEnvironment = {
          ...mockCacheConfig.runtimeEnvironment,
          ...update.runtimeEnvironment,
        };
      }
      return Promise.resolve();
    }),
  },
}));

vi.mock('../../userDataADO/types/app', () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: {
    mode: 'system',
    bunVersion: '1.5.0',
    uvVersion: '0.7.0',
    pinnedPythonVersion: null,
  },
}));

const { mockExecuteCommand } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));
vi.mock('../../terminalManager', () => ({
  getTerminalManager: vi.fn().mockReturnValue({ executeCommand: mockExecuteCommand }),
}));

vi.mock('node-stream-zip', () => ({
  default: {
    async: vi.fn().mockImplementation(() => ({
      entries: vi.fn().mockResolvedValue({}),
      extract: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('../LocalPythonMirror', () => ({
  LocalPythonMirror: {
    getInstance: vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      getBaseUrlIfRunning: vi.fn().mockReturnValue(null),
    }),
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  exec: vi.fn(),
}));

import { RuntimeManager } from '../RuntimeManager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetManager(mode: 'system' | 'internal' = 'system', pinnedPythonVersion: string | null = null) {
  (RuntimeManager as any).instance = undefined;
  mockCacheConfig.runtimeEnvironment = {
    mode,
    bunVersion: '1.5.0',
    uvVersion: '0.7.0',
    pinnedPythonVersion,
  };
}

function getInstance() {
  return RuntimeManager.getInstance();
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Restore real implementations for fs/os/https after clearAllMocks
  const realFs = await vi.importActual<typeof import('fs')>('fs');
  const realOs = await vi.importActual<typeof import('os')>('os');
  const realHttps = await vi.importActual<typeof import('https')>('https');
  vi.mocked(fs.writeFileSync).mockImplementation((...args: any[]) => (realFs.writeFileSync as any)(...args));
  vi.mocked(fs.readdirSync).mockImplementation((...args: any[]) => (realFs.readdirSync as any)(...args));
  vi.mocked(fs.existsSync).mockImplementation((...args: any[]) => (realFs.existsSync as any)(...args));
  vi.mocked(os.platform).mockImplementation(() => realOs.platform());
  vi.mocked(os.arch).mockImplementation(() => realOs.arch());
  vi.mocked(os.tmpdir).mockImplementation(() => realOs.tmpdir());
  vi.mocked(os.homedir).mockImplementation(() => realOs.homedir());
  // Restore https.get to real implementation
  const https = await import('https');
  vi.mocked(https.get).mockImplementation((...args: any[]) => (realHttps.get as any)(...args));
  resetManager();
  // Clean up any leftover test directories
  try { realFs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore */ }
  realFs.mkdirSync(testUserData, { recursive: true });
});

afterEach(async () => {
  const realFs = await vi.importActual<typeof import('fs')>('fs');
  try { realFs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ============================================================
// setPinnedPythonVersion — calls ensureVenvMatchesPinnedPython
// ============================================================

describe('setPinnedPythonVersion', () => {
  it('calls ensureVenvMatchesPinnedPython when version changes', async () => {
    resetManager('system', null);
    const manager = getInstance();
    const ensureSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await manager.setPinnedPythonVersion('3.12.9');
    expect(ensureSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('skips when version is unchanged', async () => {
    resetManager('system', '3.12.9');
    const manager = getInstance();
    const ensureSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await manager.setPinnedPythonVersion('3.12.9');
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('handles null version (sets to null) without calling ensureVenvMatchesPinnedPython', async () => {
    resetManager('system', '3.12.9');
    const manager = getInstance();
    const ensureSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await manager.setPinnedPythonVersion(null);
    // version=null → ensureVenvMatchesPinnedPython not called (only called if version is truthy)
    expect(ensureSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// ensureVenvMatchesPinnedPython — internal branch paths
// ============================================================

describe('ensureVenvMatchesPinnedPython', () => {
  it('returns early if pinnedVersion has no semver match', async () => {
    const manager = getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    await (manager as any).ensureVenvMatchesPinnedPython('invalid-version');
    expect(recreateSpy).not.toHaveBeenCalled();
  });

  it('recreates venv when venv dir does not exist', async () => {
    const manager = getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    // venvPath should not exist (testUserData/python-venv doesn't exist)
    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('returns early when venv version matches pinned version', async () => {
    const manager = getInstance();
    const venvDir = path.join(testUserData, 'python-venv');
    fs.mkdirSync(venvDir, { recursive: true });
    // Write pyvenv.cfg with matching version
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.12\n');
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).not.toHaveBeenCalled();
  });

  it('recreates venv when version mismatch', async () => {
    const manager = getInstance();
    const venvDir = path.join(testUserData, 'python-venv');
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.10\n');
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('handles pyvenv.cfg read failure gracefully', async () => {
    const manager = getInstance();
    const venvDir = path.join(testUserData, 'python-venv');
    fs.mkdirSync(venvDir, { recursive: true });
    // Write bad cfg (no version_info)
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'no-version-here\n');
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    // venvVersion will be null → different from pinnedMajorMinor → rebuild
    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).toHaveBeenCalled();
  });
});

// ============================================================
// ensureShims — error catch
// ============================================================

describe('ensureShims — error catch', () => {
  it('catches and logs errors from fs.existsSync in ensureShims', async () => {
    const manager = getInstance();
    // Create binPath with uv/bun binaries so shims will attempt to be written
    const binPath = path.join(testUserData, 'bin');
    fs.mkdirSync(binPath, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    fs.writeFileSync(path.join(binPath, uvBin), '#!/bin/sh');
    fs.writeFileSync(path.join(binPath, bunBin), '#!/bin/sh');

    const realFs = await vi.importActual<typeof import('fs')>('fs');
    let callCount = 0;
    // Make writeFileSync throw after first 2 calls (the binaries we just wrote)
    vi.mocked(fs.writeFileSync).mockImplementation((...args: any[]) => {
      callCount++;
      if (callCount > 2) {
        throw new Error('Disk full');
      }
      return (realFs.writeFileSync as any)(...args);
    });

    // This should not throw — errors are caught internally
    (manager as any).ensureShims(true);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to ensure shims',
      'RuntimeManager',
      expect.anything(),
    );

    // Restore real implementation for following tests
    vi.mocked(fs.writeFileSync).mockImplementation((...args: any[]) => (realFs.writeFileSync as any)(...args));
  });
});

// ============================================================
// initializeInternalMode — pinnedVersion branch + error catch
// ============================================================

describe('initializeInternalMode — pinnedVersion and error branches', () => {
  it('calls ensureVenvMatchesPinnedPython when pinned version is set', async () => {
    resetManager('internal', '3.12.9');
    const manager = getInstance();
    // _shimsReadyPromise was already set, but we need to spy on ensureVenvMatchesPinnedPython
    const ensureSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'ensureRequiredToolsInstalled').mockResolvedValue(undefined);

    // Reset the promise and re-trigger
    (manager as any)._shimsReadyPromise = null;
    // Create bin dir so initializeInternalMode doesn't fail
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    (manager as any).initializeInternalMode();

    // Wait for the async chain to settle
    await new Promise(r => setTimeout(r, 50));
    expect(ensureSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('logs error when ensureRequiredToolsInstalled rejects', async () => {
    resetManager('internal', null);
    const manager = getInstance();
    vi.spyOn(manager as any, 'ensureRequiredToolsInstalled').mockRejectedValue(new Error('Install failed'));

    (manager as any)._shimsReadyPromise = null;
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    (manager as any).initializeInternalMode();

    await new Promise(r => setTimeout(r, 50));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to ensure required tools/venv are ready',
      'RuntimeManager',
      expect.anything(),
    );
  });
});

// ============================================================
// ensureRequiredToolsInstalled — both tools already installed
// ============================================================

describe('ensureRequiredToolsInstalled — tools already installed', () => {
  it('logs debug when both uv and bun are already installed', async () => {
    const manager = getInstance();
    const binPath = path.join(testUserData, 'bin');
    fs.mkdirSync(binPath, { recursive: true });
    // Create fake binaries
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    fs.writeFileSync(path.join(binPath, uvBin), '#!/bin/sh\necho ok');
    fs.writeFileSync(path.join(binPath, bunBin), '#!/bin/sh\necho ok');

    await (manager as any).ensureRequiredToolsInstalled();
    expect(mockLogger.debug).toHaveBeenCalledWith('[FRE] uv already installed', 'RuntimeManager');
    expect(mockLogger.debug).toHaveBeenCalledWith('[FRE] bun already installed', 'RuntimeManager');
  });
});

// ============================================================
// installRuntime — existing lock reuse
// ============================================================

describe('installRuntime — existing lock', () => {
  it('waits for existing lock promise when same version is installing', async () => {
    const manager = getInstance();
    // Create a pending install promise
    let resolveInstall!: () => void;
    const pendingPromise = new Promise<void>(r => { resolveInstall = r; });
    (manager as any).installLocks.set('bun-1.5.0', pendingPromise);

    const logCalls: string[] = [];
    mockLogger.info.mockImplementation((msg: string) => logCalls.push(msg));

    const installPromise = manager.installRuntime('bun', '1.5.0');
    // Resolve the pending lock
    resolveInstall();
    await installPromise;

    expect(logCalls.some(m => m.includes('already in progress'))).toBe(true);
  });
});

// ============================================================
// doInstallRuntime — unknown tool throws
// ============================================================

describe('doInstallRuntime — unknown tool', () => {
  it('throws for unknown tool type', async () => {
    const manager = getInstance();
    await expect(
      (manager as any).doInstallRuntime('unknown-tool', '1.0.0')
    ).rejects.toThrow('Unknown tool: unknown-tool');
  });
});

// ============================================================
// getUvPythonDir — win32 branch
// ============================================================

describe('getUvPythonDir', () => {
  it('returns path under APPDATA on win32', () => {
    const manager = getInstance();
    // Mock platform temporarily
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const origEnv = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

    const result = (manager as any).getUvPythonDir();
    expect(result).toContain('uv');
    expect(result).toContain('python');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origEnv !== undefined) process.env.APPDATA = origEnv;
    else delete process.env.APPDATA;
  });

  it('uses homedir fallback when APPDATA is not set on win32', () => {
    const manager = getInstance();
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const origEnv = process.env.APPDATA;
    delete process.env.APPDATA;

    const result = (manager as any).getUvPythonDir();
    expect(result).toContain('uv');
    expect(result).toContain('python');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origEnv !== undefined) process.env.APPDATA = origEnv;
  });

  it('returns ~/.local/share/uv/python on non-win32', () => {
    const manager = getInstance();
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = (manager as any).getUvPythonDir();
    expect(result).toContain(os.homedir());
    expect(result).toContain('uv');
    expect(result).toContain('python');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

// ============================================================
// listPythonVersionsFast — error catch
// ============================================================

describe('listPythonVersionsFast — error catch', () => {
  it('returns [] and logs error when readdirSync throws', () => {
    const manager = getInstance();
    // Create the uv python directory then make readdirSync throw
    const uvPythonDir = path.join(os.homedir(), '.local', 'share', 'uv', 'python');
    vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
      if ((p as string) === uvPythonDir || (p as string).includes('uv')) {
        throw new Error('Permission denied');
      }
      return [];
    });
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      if ((p as string) === uvPythonDir || ((typeof p === 'string') && (p as string).includes('.local/share/uv'))) {
        return true;
      }
      return false;
    });

    const result = manager.listPythonVersionsFast();
    expect(result).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ============================================================
// downloadWithRedirects — redirect without location + non-200
// ============================================================

describe('downloadWithRedirects', () => {
  it('rejects when redirect has no location header', async () => {
    const manager = getInstance();
    const https = await import('https');
    vi.mocked(https.get).mockImplementationOnce((_url: any, cb: any) => {
      const mockReq = { on: vi.fn() };
      cb({ statusCode: 302, headers: {} });
      return mockReq as any;
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/file.zip', '/tmp/test.zip')
    ).rejects.toThrow('Redirect without location header');
  });

  it('rejects when status code is not 200 or redirect', async () => {
    const manager = getInstance();
    const https = await import('https');
    vi.mocked(https.get).mockImplementationOnce((_url: any, cb: any) => {
      const mockReq = { on: vi.fn() };
      cb({ statusCode: 404, statusMessage: 'Not Found', headers: {} });
      return mockReq as any;
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/file.zip', '/tmp/test.zip')
    ).rejects.toThrow('Failed to download: 404 Not Found');
  });
});

// ============================================================
// installBunDirectly — unsupported platform
// ============================================================

describe('installBunDirectly — unsupported platform', () => {
  it('throws for unsupported platform/arch combination', async () => {
    const manager = getInstance();
    vi.mocked(os.platform).mockReturnValueOnce('sunos' as any);
    vi.mocked(os.arch).mockReturnValueOnce('sparc' as any);

    await expect(
      (manager as any).installBunDirectly('1.5.0')
    ).rejects.toThrow('Unsupported platform/architecture');
  });
});

// ============================================================
// installUvDirectly — unsupported platform
// ============================================================

describe('installUvDirectly — unsupported platform', () => {
  it('throws for unsupported platform/arch combination', async () => {
    const manager = getInstance();
    vi.mocked(os.platform).mockReturnValueOnce('aix' as any);
    vi.mocked(os.arch).mockReturnValueOnce('ppc64' as any);

    await expect(
      (manager as any).installUvDirectly('0.7.0')
    ).rejects.toThrow('Unsupported platform/architecture');
  });
});

// ============================================================
// IPC handler: runtime:set-mode
// ============================================================

describe('IPC handler: runtime:set-mode', () => {
  it('switches mode to internal', async () => {
    resetManager('system');
    getInstance();
    const handler = mockIpcHandlers['runtime:set-mode'];
    expect(handler).toBeDefined();
    await handler({}, 'internal');
    expect(mockCacheConfig.runtimeEnvironment.mode).toBe('internal');
  });
});

// ============================================================
// getVenvPath
// ============================================================

describe('getVenvPath', () => {
  it('returns path under userData/python-venv', () => {
    const manager = getInstance();
    const venvPath = manager.getVenvPath();
    expect(venvPath).toContain('python-venv');
    expect(path.isAbsolute(venvPath)).toBe(true);
  });
});

// ============================================================
// isInstalled and getBinaryPath
// ============================================================

describe('isInstalled', () => {
  it('returns false when binary does not exist', () => {
    const manager = getInstance();
    expect(manager.isInstalled('bun')).toBe(false);
    expect(manager.isInstalled('uv')).toBe(false);
  });

  it('returns true when binary exists', () => {
    const manager = getInstance();
    const binPath = path.join(testUserData, 'bin');
    fs.mkdirSync(binPath, { recursive: true });
    const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    fs.writeFileSync(path.join(binPath, bunBin), '#!/bin/sh');
    expect(manager.isInstalled('bun')).toBe(true);
  });
});
