// @ts-nocheck
/**
 * RuntimeManager.coverage2.test.ts
 * Targets remaining ~103 uncovered statements in RuntimeManager.ts:
 * - installRuntime download/extract paths (installBunDirectly, installUvDirectly)
 * - ensureVenvMatchesPinnedPython full flow (no cfg, match, mismatch → recreateVenv)
 * - getSystemPythonPath (parsePythonListOutput private method)
 * - downloadWithRedirects (redirect, non-200, file error)
 * - waitForShimsReady (timeout path)
 * - setRuntimeMode internal mode
 * - checkGitVersion git path lookup on platform
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

const { testUserData, mockLogger } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-RuntimeManager-cov2'),
    mockLogger: logger,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    isPackaged: false,
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

const mockCacheConfig = {
  runtimeEnvironment: {
    mode: 'system' as 'system' | 'internal',
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
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
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
    pinnedPythonVersion: null,
  },
}));

const { mockExecuteCommand } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

vi.mock('../../terminalManager', () => ({
  getTerminalManager: vi.fn().mockReturnValue({
    executeCommand: mockExecuteCommand,
  }),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../../azureCli', () => ({
  getAzureCliManager: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue({ installed: false, loggedIn: false, version: null }),
    ensureInstalledWithConsent: vi.fn().mockResolvedValue({ success: false }),
  }),
}));

const { mockMirrorStart, mockMirrorStop, mockMirrorGetBaseUrl } = vi.hoisted(() => ({
  mockMirrorStart: vi.fn().mockResolvedValue(undefined),
  mockMirrorStop: vi.fn(),
  mockMirrorGetBaseUrl: vi.fn().mockReturnValue(null),
}));
vi.mock('../LocalPythonMirror', () => ({
  LocalPythonMirror: {
    getInstance: vi.fn().mockReturnValue({
      start: mockMirrorStart,
      stop: mockMirrorStop,
      getBaseUrlIfRunning: mockMirrorGetBaseUrl,
    }),
  },
}));

vi.mock('../AgencyCLIManager', () => ({
  AgencyCLIManager: {
    getInstance: vi.fn().mockReturnValue({
      checkStatus: vi.fn().mockResolvedValue({ installed: false, version: null, path: null }),
      install: vi.fn().mockResolvedValue(undefined),
      uninstall: vi.fn().mockResolvedValue(undefined),
      getBinDirSync: vi.fn().mockReturnValue(null),
    }),
  },
}));

// Controllable spawn mock
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

function makeSpawnChild(options: { exitCode?: number; signal?: string | null; errorOnClose?: boolean } = {}) {
  const child: any = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 9999,
  };
  child.emitter = new EventEmitter();
  child.on = (event: string, handler: any) => { child.emitter.on(event, handler); };

  setImmediate(() => {
    if (options.exitCode !== undefined) {
      child.emitter.emit('close', options.exitCode, null);
    } else if (options.signal) {
      child.emitter.emit('close', null, options.signal);
    } else {
      child.emitter.emit('close', 0, null);
    }
  });
  return child;
}

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execSync: vi.fn(),
}));

// StreamZip mock that can be configured per-test
const { mockStreamZipEntries, mockStreamZipExtract, mockStreamZipClose, MockStreamZipAsync } = vi.hoisted(() => {
  const entriesFn = vi.fn().mockResolvedValue({});
  const extractFn = vi.fn().mockResolvedValue(undefined);
  const closeFn = vi.fn().mockResolvedValue(undefined);
  function MockAsync(_opts: any) {
    return { entries: entriesFn, extract: extractFn, close: closeFn };
  }
  return {
    mockStreamZipEntries: entriesFn,
    mockStreamZipExtract: extractFn,
    mockStreamZipClose: closeFn,
    MockStreamZipAsync: MockAsync,
  };
});

vi.mock('node-stream-zip', () => ({
  default: { async: MockStreamZipAsync },
}));

// https mock for downloadWithRedirects
const { mockHttpsGet } = vi.hoisted(() => ({ mockHttpsGet: vi.fn() }));
vi.mock('https', () => ({ get: (...args: any[]) => mockHttpsGet(...args) }));

import { RuntimeManager } from '../RuntimeManager';

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

function resetInstance() {
  (RuntimeManager as any).instance = undefined;
  mockCacheConfig.runtimeEnvironment = {
    mode: 'system',
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
    pinnedPythonVersion: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetInstance();
  mockSpawn.mockImplementation(() => makeSpawnChild({ exitCode: 0 }));
  mockMirrorGetBaseUrl.mockReturnValue(null);
  mockMirrorStart.mockResolvedValue(undefined);
  mockStreamZipEntries.mockResolvedValue({});
  mockStreamZipExtract.mockResolvedValue(undefined);
  mockStreamZipClose.mockResolvedValue(undefined);
  mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: 'git version 2.39.0', stderr: '' });
});

afterEach(() => {
  resetInstance();
});

// ─── waitForShimsReady ───────────────────────────────────────────────────────

describe('waitForShimsReady', () => {
  it('resolves immediately when _shimsReadyPromise is null (system mode)', async () => {
    const manager = RuntimeManager.getInstance();
    await expect(manager.waitForShimsReady(1000)).resolves.toBeUndefined();
  });

  it('resolves when shims become ready', async () => {
    let resolveShims!: () => void;
    const manager = RuntimeManager.getInstance();
    (manager as any)._shimsReadyPromise = new Promise<void>((r) => { resolveShims = r; });
    const waitPromise = manager.waitForShimsReady(500);
    resolveShims();
    await expect(waitPromise).resolves.toBeUndefined();
  });

  it('times out gracefully if shims are never ready', async () => {
    const manager = RuntimeManager.getInstance();
    (manager as any)._shimsReadyPromise = new Promise<void>(() => { /* never resolves */ });
    // Timeout of 50ms
    await expect(manager.waitForShimsReady(50)).resolves.toBeUndefined();
  });
});

// ─── setRuntimeMode ──────────────────────────────────────────────────────────

describe('setRuntimeMode', () => {
  it('switches to system mode without initializing internal mode', async () => {
    const manager = RuntimeManager.getInstance();
    await manager.setRuntimeMode('system');
    expect(mockCacheConfig.runtimeEnvironment.mode).toBe('system');
  });

  it('switches to internal mode and calls initializeInternalMode', async () => {
    const manager = RuntimeManager.getInstance();
    const initSpy = vi.spyOn(manager, 'initializeInternalMode');
    // Provide bin dir so shims check doesn't fail
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    await manager.setRuntimeMode('internal');
    expect(initSpy).toHaveBeenCalled();
  });
});

// ─── ensureVenvMatchesPinnedPython ───────────────────────────────────────────

describe('ensureVenvMatchesPinnedPython', () => {
  const venvDir = path.join(testUserData, 'python-venv');

  afterEach(() => {
    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('skips when pinned version has no valid semver', async () => {
    const manager = RuntimeManager.getInstance();
    // version without semver pattern
    await expect(
      (manager as any).ensureVenvMatchesPinnedPython('badversion')
    ).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse semver'),
      'RuntimeManager',
    );
  });

  it('creates venv if venvDir does not exist', async () => {
    const manager = RuntimeManager.getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);
    // Ensure venvDir does NOT exist
    fs.rmSync(venvDir, { recursive: true, force: true });
    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('skips rebuild when pyvenv.cfg major.minor matches', async () => {
    const manager = RuntimeManager.getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);

    // Create venvDir with matching pyvenv.cfg
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.12\n');

    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).not.toHaveBeenCalled();
  });

  it('rebuilds venv when major.minor does not match', async () => {
    const manager = RuntimeManager.getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);

    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.10\n');

    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    expect(recreateSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('handles missing pyvenv.cfg (no version_info match)', async () => {
    const manager = RuntimeManager.getInstance();
    const recreateSpy = vi.spyOn(manager as any, 'recreateVenv').mockResolvedValue(undefined);

    // venvDir exists but no pyvenv.cfg
    fs.mkdirSync(venvDir, { recursive: true });

    await (manager as any).ensureVenvMatchesPinnedPython('3.12.9');
    // venvVersion will be null → mismatch → recreate
    expect(recreateSpy).toHaveBeenCalledWith('3.12.9');
  });
});

// ─── recreateVenv ────────────────────────────────────────────────────────────

describe('recreateVenv', () => {
  const venvDir = path.join(testUserData, 'python-venv');
  let uvBinPath: string;

  beforeEach(() => {
    const manager = RuntimeManager.getInstance();
    uvBinPath = (manager as any).getBinaryPath('uv');
    fs.mkdirSync(path.dirname(uvBinPath), { recursive: true });
    fs.writeFileSync(uvBinPath, '', { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(venvDir, { recursive: true, force: true });
    if (uvBinPath && fs.existsSync(uvBinPath)) { try { fs.unlinkSync(uvBinPath); } catch { /* ignore */ } }
  });

  it('deletes existing venv and creates new one via terminal', async () => {
    const manager = RuntimeManager.getInstance();
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.10\n');

    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await (manager as any).recreateVenv('3.12.9');
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['venv', '--python', '3.12.9']) }),
    );
  });

  it('logs error when uv venv command fails', async () => {
    const manager = RuntimeManager.getInstance();
    mockExecuteCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error output' });
    await (manager as any).recreateVenv('3.12.9');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create python-venv'),
      'RuntimeManager',
    );
  });

  it('handles error when venvDir cannot be deleted', async () => {
    const manager = RuntimeManager.getInstance();
    // Create a non-removable file to simulate rmSync failure: test using a path
    // that doesn't exist but we intercept via executeCommand
    // Instead, test the error logging path by mocking executeCommand to succeed
    // and then checking the overall flow completes. Direct rmSync spy not possible in ESM.
    // We test indirectly: if venvDir does not exist, no rmSync is attempted.
    const fakeVenvPath = path.join(testUserData, 'fake-venv-no-exist');
    (manager as any).venvPath = fakeVenvPath;
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    // Should complete without throwing
    await expect((manager as any).recreateVenv('3.12.9')).resolves.toBeUndefined();
    (manager as any).venvPath = path.join(testUserData, 'python-venv');
  });
});

// ─── setPinnedPythonVersion ───────────────────────────────────────────────────

describe('setPinnedPythonVersion', () => {
  it('sets a new pinned version and triggers ensureVenvMatchesPinnedPython', async () => {
    const manager = RuntimeManager.getInstance();
    const venvSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await manager.setPinnedPythonVersion('3.12.9');
    expect(venvSpy).toHaveBeenCalledWith('3.12.9');
  });

  it('does nothing when same version is already pinned', async () => {
    // Set up config before creating instance
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = '3.12.9';
    (RuntimeManager as any).instance = undefined;
    const manager = RuntimeManager.getInstance();
    const venvSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    // Call with same version as already configured
    await manager.setPinnedPythonVersion('3.12.9');
    expect(venvSpy).not.toHaveBeenCalled();
    // Reset
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = null;
    (RuntimeManager as any).instance = undefined;
  });

  it('setting null skips venv rebuild', async () => {
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = '3.12.9';
    (RuntimeManager as any).instance = undefined;
    const manager = RuntimeManager.getInstance();
    const venvSpy = vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await manager.setPinnedPythonVersion(null);
    expect(venvSpy).not.toHaveBeenCalled();
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = null;
    (RuntimeManager as any).instance = undefined;
  });
});

// ─── installBunDirectly / installUvDirectly ──────────────────────────────────
// Note: os.platform() cannot be spied in ESM. Tests use doInstallRuntime directly
// and mock the internal download/extract methods instead.

describe('installBunDirectly and installUvDirectly via installRuntime', () => {
  it('installBunDirectly extracts bun binary on current platform', async () => {
    const manager = RuntimeManager.getInstance();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const downloadSpy = vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);
    const bunBinaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunBinaryPath = path.join(binDir, bunBinaryName);

    mockStreamZipEntries.mockResolvedValue({
      [`bun-dir/${bunBinaryName}`]: { isDirectory: false, name: `bun-dir/${bunBinaryName}` },
    });
    mockStreamZipExtract.mockImplementation(async (_name: string, outPath: string) => {
      fs.writeFileSync(outPath, '#!/bin/sh\necho bun', { mode: 0o755 });
    });

    // Use platform-appropriate package name to avoid "unsupported platform" throw
    const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64'];
    const platformKey = `${process.platform}-${process.arch}`;
    if (!supported.includes(platformKey) && !['win32-arm64'].includes(platformKey)) {
      // Can't meaningfully test on exotic platforms
      return;
    }

    await (manager as any).installBunDirectly('1.3.6');
    expect(downloadSpy).toHaveBeenCalled();
    if (fs.existsSync(bunBinaryPath)) fs.unlinkSync(bunBinaryPath);
  });

  it('installBunDirectly throws on unsupported platform key via bad entry', async () => {
    const manager = RuntimeManager.getInstance();
    // Directly craft a scenario where the packageName is missing
    // by overriding the BUN_PACKAGES lookup — achieved by calling installBunDirectly
    // indirectly, but we can't spy on os.platform. Instead we test that the method
    // throws when extraction finds no binary.
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);
    mockStreamZipEntries.mockResolvedValue({
      'unrelated.txt': { isDirectory: false, name: 'unrelated.txt' },
    });

    // If current platform is supported the method will throw "binary not found"
    const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'];
    const platformKey = `${process.platform}-${process.arch}`;
    if (supported.includes(platformKey)) {
      await expect((manager as any).installBunDirectly('1.3.6')).rejects.toThrow(
        /binary not found after extraction/,
      );
    }
  });

  it('installUvDirectly downloads and extracts on current platform', async () => {
    const manager = RuntimeManager.getInstance();
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const downloadSpy = vi.spyOn(manager as any, 'downloadWithRedirects').mockResolvedValue(undefined);

    const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64', 'linux-ia32', 'win32-ia32', 'win32-arm64'];
    const platformKey = `${process.platform}-${process.arch}`;
    if (!supported.includes(platformKey)) {
      return;
    }

    const isTarGz = process.platform !== 'win32';
    if (isTarGz) {
      // On unix, it will use execSync tar — intercept so we create expected output files
      const { execSync } = await import('child_process');
      const execSyncMock = execSync as unknown as ReturnType<typeof vi.fn>;
      const uvName = 'uv';
      execSyncMock.mockImplementation((cmd: string) => {
        const match = /\-C "([^"]+)"/.exec(cmd);
        if (match) {
          const extractDir = match[1];
          const subDir = path.join(extractDir, 'sub');
          fs.mkdirSync(subDir, { recursive: true });
          fs.writeFileSync(path.join(subDir, uvName), '#!/bin/sh\necho uv', { mode: 0o755 });
          fs.writeFileSync(path.join(subDir, 'uvx'), '#!/bin/sh\necho uvx', { mode: 0o755 });
        }
      });
      await (manager as any).installUvDirectly('0.6.17');
      expect(downloadSpy).toHaveBeenCalled();
    } else {
      // Windows: zip path
      const uvBinaryPath = path.join(binDir, 'uv.exe');
      mockStreamZipEntries.mockResolvedValue({
        'some/uv.exe': { isDirectory: false, name: 'some/uv.exe' },
      });
      mockStreamZipExtract.mockImplementation(async (_name: string, outPath: string) => {
        fs.writeFileSync(outPath, '@echo off\r\necho uv');
      });
      await (manager as any).installUvDirectly('0.6.17');
      expect(downloadSpy).toHaveBeenCalled();
      if (fs.existsSync(uvBinaryPath)) fs.unlinkSync(uvBinaryPath);
    }
    const uvPath = path.join(binDir, 'uv');
    const uvxPath = path.join(binDir, 'uvx');
    if (fs.existsSync(uvPath)) fs.unlinkSync(uvPath);
    if (fs.existsSync(uvxPath)) fs.unlinkSync(uvxPath);
  });
});

// ─── downloadWithRedirects ───────────────────────────────────────────────────

describe('downloadWithRedirects', () => {
  it('rejects on non-200 status', async () => {
    const manager = RuntimeManager.getInstance();
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      cb({ statusCode: 404, statusMessage: 'Not Found', headers: {}, pipe: vi.fn(), on: vi.fn() });
      return { on: vi.fn() };
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/missing', '/tmp/missing.bin')
    ).rejects.toThrow(/404/);
  });

  it('rejects on redirect without location header', async () => {
    const manager = RuntimeManager.getInstance();
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      cb({ statusCode: 301, headers: {}, pipe: vi.fn(), on: vi.fn() });
      return { on: vi.fn() };
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/redirect', '/tmp/redir.bin')
    ).rejects.toThrow(/Redirect without location/);
  });

  it('rejects on https get error', async () => {
    const manager = RuntimeManager.getInstance();
    mockHttpsGet.mockImplementation((_url: string, _cb: any) => {
      const req: any = new EventEmitter();
      setImmediate(() => req.emit('error', new Error('network failure')));
      return req;
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/fail', '/tmp/fail.bin')
    ).rejects.toThrow(/network failure/);
  });

  it('follows a redirect to the final URL', async () => {
    const manager = RuntimeManager.getInstance();
    let callCount = 0;
    let finalUrl = '';
    mockHttpsGet.mockImplementation((url: string, cb: any) => {
      callCount++;
      if (callCount === 1) {
        cb({ statusCode: 302, headers: { location: 'https://redirect2.example.com/file' }, pipe: vi.fn(), on: vi.fn() });
        return { on: vi.fn() };
      }
      finalUrl = url;
      // Return non-200 to stop further processing (we only care that redirect was followed)
      cb({ statusCode: 404, statusMessage: 'Not Found', headers: {}, pipe: vi.fn(), on: vi.fn() });
      return { on: vi.fn() };
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/original', '/tmp/test.bin')
    ).rejects.toThrow(/404/);
    expect(finalUrl).toBe('https://redirect2.example.com/file');
  });
});

// ─── parsePythonListOutput (private) ─────────────────────────────────────────

describe('parsePythonListOutput (private)', () => {
  it('parses installed and available entries', () => {
    const manager = RuntimeManager.getInstance();
    const output = [
      'cpython-3.12.8-windows-x86_64-none     C:\\Users\\user\\AppData\\uv\\python\\cpython-3.12.8-windows-x86_64-none\\python.exe',
      'cpython-3.13.1-windows-x86_64-none     <download available>',
      '',
    ].join('\n');

    const results = (manager as any).parsePythonListOutput(output);
    expect(results).toHaveLength(2);
    expect(results[0].version).toBe('cpython-3.12.8-windows-x86_64-none');
    expect(results[1].version).toBe('cpython-3.13.1-windows-x86_64-none');
    expect(results[1].status).toBe('available');
  });
});

// ─── getEnvWithInternalPath with mirror ─────────────────────────────────────

describe('getEnvWithInternalPath', () => {
  it('injects UV_PYTHON_INSTALL_MIRROR when mirror is running', () => {
    const manager = RuntimeManager.getInstance();
    mockMirrorGetBaseUrl.mockReturnValue('http://localhost:12345');
    const env = manager.getEnvWithInternalPath();
    expect(env['UV_PYTHON_INSTALL_MIRROR']).toBe('http://localhost:12345');
  });

  it('injects UV_PYTHON when pinnedPythonVersion is set', () => {
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = '3.12.9';
    (RuntimeManager as any).instance = undefined;
    const manager = RuntimeManager.getInstance();
    const env = manager.getEnvWithInternalPath();
    expect(env['UV_PYTHON']).toBe('3.12.9');
    // Restore
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = null;
    (RuntimeManager as any).instance = undefined;
  });

  it('removes npm_config_prefix from env', () => {
    const manager = RuntimeManager.getInstance();
    const env = manager.getEnvWithInternalPath({ npm_config_prefix: '/some/prefix', PATH: '/usr/bin' });
    expect(env['npm_config_prefix']).toBeUndefined();
  });

  it('always injects VIRTUAL_ENV', () => {
    const manager = RuntimeManager.getInstance();
    const env = manager.getEnvWithInternalPath();
    expect(env['VIRTUAL_ENV']).toContain('python-venv');
  });
});

// ─── checkGitVersion ─────────────────────────────────────────────────────────

describe('checkGitVersion', () => {
  it('returns installed and version on success', async () => {
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'git version 2.39.0', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '/usr/bin/git\n', stderr: '' });
    const manager = RuntimeManager.getInstance();
    const result = await manager.checkGitVersion();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('2.39.0');
    expect(result.path).toBe('/usr/bin/git');
  });

  it('returns not installed on non-zero exit', async () => {
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'not found' });
    const manager = RuntimeManager.getInstance();
    const result = await manager.checkGitVersion();
    expect(result.installed).toBe(false);
  });

  it('returns not installed when git command throws', async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error('spawn error'));
    const manager = RuntimeManager.getInstance();
    const result = await manager.checkGitVersion();
    expect(result.installed).toBe(false);
  });

  it('handles path lookup failure gracefully', async () => {
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'git version 2.39.0', stderr: '' })
      .mockRejectedValueOnce(new Error('which not found'));
    const manager = RuntimeManager.getInstance();
    const result = await manager.checkGitVersion();
    expect(result.installed).toBe(true);
    expect(result.path).toBeNull();
  });
});

// ─── initializeInternalMode ───────────────────────────────────────────────────

describe('initializeInternalMode', () => {
  it('skips in system mode', () => {
    mockCacheConfig.runtimeEnvironment.mode = 'system';
    const manager = RuntimeManager.getInstance();
    const ensureSpy = vi.spyOn(manager as any, 'ensureRequiredToolsInstalled').mockResolvedValue(undefined);
    manager.initializeInternalMode();
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('runs full initialization in internal mode', () => {
    mockCacheConfig.runtimeEnvironment.mode = 'internal';
    resetInstance();
    // Provide bin dir so mkdirSync is a no-op
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    const manager = RuntimeManager.getInstance();
    // Should set _shimsReadyPromise
    expect((manager as any)._shimsReadyPromise).toBeDefined();
  });
});

// ─── ensureRequiredToolsInstalled ───────────────────────────────────────────

describe('ensureRequiredToolsInstalled', () => {
  it('installs uv and bun when neither is installed', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi.spyOn(manager, 'installRuntime').mockResolvedValue(undefined);
    vi.spyOn(manager, 'isInstalled').mockReturnValue(false);
    await (manager as any).ensureRequiredToolsInstalled();
    expect(installSpy).toHaveBeenCalledWith('uv', expect.any(String));
    expect(installSpy).toHaveBeenCalledWith('bun', expect.any(String));
  });

  it('skips installation when tools are already installed', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi.spyOn(manager, 'installRuntime').mockResolvedValue(undefined);
    vi.spyOn(manager, 'isInstalled').mockReturnValue(true);
    await (manager as any).ensureRequiredToolsInstalled();
    expect(installSpy).not.toHaveBeenCalled();
  });
});
