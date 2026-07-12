// @ts-nocheck
/**
 * RuntimeManager.coverage3.test.ts
 *
 * Final branch/function coverage sweep for RuntimeManager.ts. Targets gaps the
 * deep/deep4/deep5/coverage/coverage2 suites leave behind:
 *  - Granular IPC handlers: runtime:check-core and install-component non-Error
 *    error branch.
 *  - downloadWithRedirects success (file 'finish') + write-stream 'error' paths.
 *  - uninstallPythonVersion stdout/stderr data handlers.
 *  - win32 platform branches: getBinaryPath, getUvPythonDir (APPDATA set + homedir
 *    fallback), listPythonVersionsFast python.exe path, checkGitVersion where.exe.
 *  - Nullish-coalescing fallbacks: getRunTimeConfig / setRuntimeMode / setVersion /
 *    setPinnedPythonVersion when config.runtimeEnvironment is undefined.
 *  - waitForShimsReady non-Error rejection (String(e)).
 *  - getEnvWithInternalPath PATH-key fallback when no PATH key exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';

const { testUserData, mockLogger } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-RuntimeManager-cov3'),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

// A mutable config whose runtimeEnvironment can be set to undefined to exercise the
// `?? DEFAULT_RUNTIME_ENVIRONMENT` fallbacks.
const mockCacheConfig: { runtimeEnvironment: any } = {
  runtimeEnvironment: {
    mode: 'system',
    bunVersion: '1.5.0',
    uvVersion: '0.7.0',
    pinnedPythonVersion: null,
  },
};

vi.mock('../../userDataADO/appCacheManager', () => ({
  appCacheManager: {
    getConfig: vi.fn().mockImplementation(() => ({
      runtimeEnvironment: mockCacheConfig.runtimeEnvironment
        ? { ...mockCacheConfig.runtimeEnvironment }
        : undefined,
    })),
    updateConfig: vi.fn().mockImplementation((update: any) => {
      if (update.runtimeEnvironment) {
        mockCacheConfig.runtimeEnvironment = {
          ...(mockCacheConfig.runtimeEnvironment ?? {}),
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

vi.mock('node-stream-zip', () => ({}));

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../featureFlags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }));

const { mockAzureCliManager } = vi.hoisted(() => ({
  mockAzureCliManager: {
    initialize: vi.fn().mockResolvedValue({
      installed: false, loggedIn: false, version: null, path: null,
    }),
    ensureInstalledWithConsent: vi.fn().mockResolvedValue({ success: true }),
    uninstall: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../azureCli', () => ({
  getAzureCliManager: vi.fn().mockReturnValue(mockAzureCliManager),
}));

const { mockMirrorGetBaseUrl } = vi.hoisted(() => ({
  mockMirrorGetBaseUrl: vi.fn().mockReturnValue(null),
}));
vi.mock('../LocalPythonMirror', () => ({
  LocalPythonMirror: {
    getInstance: vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      getBaseUrlIfRunning: mockMirrorGetBaseUrl,
    }),
  },
}));

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mockSpawn, execSync: vi.fn() }));

const { mockHttpsGet } = vi.hoisted(() => ({ mockHttpsGet: vi.fn() }));
vi.mock('https', () => ({ get: (...args: any[]) => mockHttpsGet(...args) }));

import { RuntimeManager } from '../RuntimeManager';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockChild(opts: { stdout?: string; stderr?: string; closeCode?: number | null } = {}) {
  const stdoutListeners: Function[] = [];
  const stderrListeners: Function[] = [];
  const listeners: Record<string, Function[]> = { close: [], error: [] };
  const child = {
    pid: 4242,
    stdout: { on: vi.fn((_e: string, cb: Function) => { stdoutListeners.push(cb); }) },
    stderr: { on: vi.fn((_e: string, cb: Function) => { stderrListeners.push(cb); }) },
    on: vi.fn((e: string, cb: Function) => { (listeners[e] ||= []).push(cb); }),
  };
  setImmediate(() => {
    if (opts.stdout) stdoutListeners.forEach((cb) => cb(Buffer.from(opts.stdout)));
    if (opts.stderr) stderrListeners.forEach((cb) => cb(Buffer.from(opts.stderr)));
    const code = opts.closeCode !== undefined ? opts.closeCode : 0;
    listeners.close.forEach((cb) => cb(code, null));
  });
  return child;
}

function resetManager(mode: 'system' | 'internal' = 'system', pinnedPythonVersion: string | null = null) {
  (RuntimeManager as any).instance = undefined;
  mockCacheConfig.runtimeEnvironment = { mode, bunVersion: '1.5.0', uvVersion: '0.7.0', pinnedPythonVersion };
  return RuntimeManager.getInstance();
}

const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockIpcHandlers)) delete mockIpcHandlers[key];
  mockSpawn.mockReset();
  mockIsFeatureEnabled.mockReturnValue(false);
  mockMirrorGetBaseUrl.mockReturnValue(null);
  setPlatform(originalPlatform);
});

afterEach(() => {
  setPlatform(originalPlatform);
});

// ── Granular IPC status handlers ─────────────────────────────────────────────

describe('granular runtime status IPC handlers', () => {
  let manager: RuntimeManager;
  beforeEach(() => {
    manager = resetManager('system');
  });

  it('runtime:check-core returns bun/uv install state + paths (synchronous)', () => {
    const handler = mockIpcHandlers['runtime:check-core'];
    const result = handler();
    expect(result).toHaveProperty('bun');
    expect(result).toHaveProperty('uv');
    expect(result).toHaveProperty('bunPath');
    expect(result).toHaveProperty('uvPath');
  });

  it('runtime:install-component rethrows and stringifies a non-Error rejection', async () => {
    const handler = mockIpcHandlers['runtime:install-component'];
    vi.spyOn(manager as any, 'installRuntime').mockRejectedValue('boom-string');
    await expect(handler({}, 'uv', '0.7.0')).rejects.toBe('boom-string');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('install-component failed'),
      'RuntimeManager',
      expect.objectContaining({ error: 'boom-string' }),
    );
  });
});

// ── downloadWithRedirects success + write-stream error ───────────────────────

describe('downloadWithRedirects', () => {
  it('resolves once the file stream finishes', async () => {
    const manager = resetManager('system');
    const dest = path.join(testUserData, 'download-ok.bin');
    fs.mkdirSync(testUserData, { recursive: true });
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      const body = Readable.from([Buffer.from('payload')]);
      cb(Object.assign(body, { statusCode: 200, headers: {} }));
      return { on: vi.fn() };
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/file.bin', dest),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(dest)).toBe(true);
    fs.unlinkSync(dest);
  });

  it('rejects when the destination write stream errors', async () => {
    const manager = resetManager('system');
    // Destination inside a non-existent directory -> createWriteStream emits ENOENT 'error'.
    const dest = path.join(testUserData, 'no-such-dir-cov3', 'fail.bin');
    mockHttpsGet.mockImplementation((_url: string, cb: any) => {
      const body = Readable.from([Buffer.from('payload')]);
      cb(Object.assign(body, { statusCode: 200, headers: {} }));
      return { on: vi.fn() };
    });

    await expect(
      (manager as any).downloadWithRedirects('https://example.com/file.bin', dest),
    ).rejects.toBeTruthy();
  });
});

// ── uninstallPythonVersion stdout/stderr handlers ────────────────────────────

describe('uninstallPythonVersion stdout/stderr handlers', () => {
  it('drains stdout and stderr data while uninstalling', async () => {
    const manager = resetManager('system');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');

    mockSpawn.mockReturnValue(makeMockChild({ stdout: 'removing...', stderr: 'progress', closeCode: 0 }));
    await expect(
      manager.uninstallPythonVersion('cpython-3.12.9-macos-aarch64-none'),
    ).resolves.toBeUndefined();
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[uv python uninstall] removing...'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[uv python uninstall] progress'));
  });
});

// ── win32 platform branches ──────────────────────────────────────────────────

describe('win32 platform branches', () => {
  it('getBinaryPath returns .exe names on win32', () => {
    setPlatform('win32');
    const manager = resetManager('system');
    expect(manager.getBinaryPath('bun').endsWith('bun.exe')).toBe(true);
    expect(manager.getBinaryPath('uv').endsWith('uv.exe')).toBe(true);
  });

  it('getUvPythonDir uses %APPDATA% when set on win32', () => {
    setPlatform('win32');
    const prev = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const manager = resetManager('system');
    const dir = (manager as any).getUvPythonDir();
    expect(dir).toContain('Roaming');
    expect(dir).toContain('uv');
    if (prev === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev;
  });

  it('getUvPythonDir falls back to homedir Roaming when APPDATA is unset on win32', () => {
    setPlatform('win32');
    const prev = process.env.APPDATA;
    delete process.env.APPDATA;
    const manager = resetManager('system');
    const dir = (manager as any).getUvPythonDir();
    expect(dir).toContain('Roaming');
    if (prev !== undefined) process.env.APPDATA = prev;
  });

  it('listPythonVersionsFast resolves python.exe under the version dir on win32', () => {
    setPlatform('win32');
    const prev = process.env.APPDATA;
    // Point the uv python dir at a temp location we control.
    const uvRoot = path.join(testUserData, 'win-appdata');
    process.env.APPDATA = uvRoot;
    const versionDir = path.join(uvRoot, 'uv', 'python', 'cpython-3.12.8-windows-x86_64-none');
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, 'python.exe'), '');

    const manager = resetManager('system');
    const results = manager.listPythonVersionsFast();
    expect(results.some((r) => r.semver === '3.12.8')).toBe(true);

    fs.rmSync(uvRoot, { recursive: true, force: true });
    if (prev === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev;
  });

  it('checkGitVersion uses where.exe for path lookup on win32', async () => {
    setPlatform('win32');
    const manager = resetManager('system');
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'git version 2.41.0', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'C:\\Program Files\\Git\\bin\\git.exe', stderr: '' });
    const result = await manager.checkGitVersion();
    expect(result.installed).toBe(true);
    expect(result.path).toContain('git.exe');
    const whereCall = mockExecuteCommand.mock.calls.find((c) => c[0].command === 'where.exe');
    expect(whereCall).toBeDefined();
  });
});

// ── Nullish-coalescing fallbacks when runtimeEnvironment is undefined ─────────

describe('config fallbacks when runtimeEnvironment is undefined', () => {
  beforeEach(() => {
    resetManager('system');
    mockCacheConfig.runtimeEnvironment = undefined;
  });

  it('getRunTimeConfig returns DEFAULT_RUNTIME_ENVIRONMENT', () => {
    const manager = RuntimeManager.getInstance();
    const cfg = manager.getRunTimeConfig();
    expect(cfg.mode).toBe('system');
  });

  it('setRuntimeMode tolerates undefined runtimeEnvironment', async () => {
    const manager = RuntimeManager.getInstance();
    await expect(manager.setRuntimeMode('system')).resolves.toBeUndefined();
  });

  it('setVersion tolerates undefined runtimeEnvironment', async () => {
    const manager = RuntimeManager.getInstance();
    await expect(manager.setVersion('bun', '1.9.9')).resolves.toBeUndefined();
  });

  it('setPinnedPythonVersion tolerates undefined runtimeEnvironment', async () => {
    const manager = RuntimeManager.getInstance();
    vi.spyOn(manager as any, 'ensureVenvMatchesPinnedPython').mockResolvedValue(undefined);
    await expect(manager.setPinnedPythonVersion(null)).resolves.toBeUndefined();
  });
});

// ── waitForShimsReady non-Error rejection ────────────────────────────────────

describe('waitForShimsReady', () => {
  it('logs String(e) when the shims promise rejects with a non-Error', async () => {
    const manager = resetManager('internal');
    (manager as any)._shimsReadyPromise = Promise.reject('shim-failure-string');
    await expect(manager.waitForShimsReady(1000)).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('did not complete in time'),
      'RuntimeManager',
      expect.objectContaining({ error: 'shim-failure-string' }),
    );
  });
});

// ── getEnvWithInternalPath PATH-key fallback ─────────────────────────────────

describe('getEnvWithInternalPath', () => {
  it('uses the PATH fallback key when the base env has no path key', () => {
    const manager = resetManager('system');
    const env = manager.getEnvWithInternalPath({}); // no PATH/Path key
    expect(env['PATH']).toContain(path.delimiter);
  });
});

// ── installRuntime success tail (logs duration + refreshes shims) ─────────────

describe('installRuntime success tail', () => {
  it('logs duration and refreshes shims after a successful bun install', async () => {
    const manager = resetManager('system');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    vi.spyOn(manager as any, 'installBunDirectly').mockResolvedValue(undefined);
    const shimSpy = vi.spyOn(manager as any, 'ensureShims').mockImplementation(() => {});

    await expect(manager.installRuntime('bun', '1.5.0')).resolves.toBeUndefined();
    expect(shimSpy).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Successfully installed bun'),
      'RuntimeManager',
      expect.objectContaining({ tool: 'bun', version: '1.5.0' }),
    );
  });

  it('routes uv installs through installUvDirectly', async () => {
    const manager = resetManager('system');
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    const uvSpy = vi.spyOn(manager as any, 'installUvDirectly').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'ensureShims').mockImplementation(() => {});
    await manager.installRuntime('uv', '0.7.0');
    expect(uvSpy).toHaveBeenCalledWith('0.7.0');
  });

  it('throws for an unknown tool', async () => {
    const manager = resetManager('system');
    fs.mkdirSync(path.join(testUserData, 'bin'), { recursive: true });
    await expect(manager.installRuntime('python' as any, '3.12')).rejects.toThrow(/Unknown tool/);
  });
});

// ── install-python-version IPC: non-Error rejection stringified ──────────────

describe('runtime:install-python-version IPC error branch', () => {
  it('rethrows and stringifies a non-Error rejection', async () => {
    const manager = resetManager('system');
    const handler = mockIpcHandlers['runtime:install-python-version'];
    vi.spyOn(manager as any, 'installPythonVersion').mockRejectedValue('py-boom-string');
    await expect(handler({}, '3.12.9')).rejects.toBe('py-boom-string');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('install-python-version failed'),
      'RuntimeManager',
      expect.objectContaining({ error: 'py-boom-string' }),
    );
  });
});

// ── uninstallPythonVersion unpins a plain-semver pinned version ───────────────

describe('uninstallPythonVersion unpin (plain semver match)', () => {
  it('unpins when the pinned value is a bare semver matching the version dir', async () => {
    const manager = resetManager('system', '3.10.12');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');

    const unpinSpy = vi.spyOn(manager as any, 'setPinnedPythonVersion').mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0 }));

    await manager.uninstallPythonVersion('cpython-3.10.12-macos-aarch64-none');
    expect(unpinSpy).toHaveBeenCalledWith(null);
  });

  it('unpins when the pinned value exactly equals the full version dir name', async () => {
    const full = 'cpython-3.10.12-macos-aarch64-none';
    const manager = resetManager('system', full);
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');

    const unpinSpy = vi.spyOn(manager as any, 'setPinnedPythonVersion').mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0 }));

    await manager.uninstallPythonVersion(full);
    expect(unpinSpy).toHaveBeenCalledWith(null);
  });

  it('handles a version name that does not match the cpython/pypy semver regex (versionSemver null branch)', async () => {
    // pinned is a bare semver; version is a non-matching name -> semverMatch null,
    // exercising the `: null` operand of `semverMatch ? semverMatch[1] : null`.
    const manager = resetManager('system', '3.10.12');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');

    const unpinSpy = vi.spyOn(manager as any, 'setPinnedPythonVersion').mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0 }));

    await manager.uninstallPythonVersion('graalpy-24.0.0-macos');
    // pinned ('3.10.12') !== version and versionSemver is null -> no unpin.
    expect(unpinSpy).not.toHaveBeenCalled();
  });
});

// ── doInstallPythonVersion hasExited guards (error then close, close then error) ──

describe('doInstallPythonVersion hasExited guards', () => {
  function makeManualChild() {
    const listeners: Record<string, Function[]> = { close: [], error: [] };
    const child = {
      pid: 7,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((e: string, cb: Function) => { (listeners[e] ||= []).push(cb); }),
      _emit: (e: string, ...args: any[]) => listeners[e]?.forEach((cb) => cb(...args)),
    };
    return child;
  }

  function withUv() {
    const manager = resetManager('system');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
    return manager;
  }

  it('ignores a second close event after an error already settled the promise', async () => {
    const manager = withUv();
    const child = makeManualChild();
    mockSpawn.mockReturnValue(child);

    const p = (manager as any).doInstallPythonVersion('3.12.9');
    child._emit('error', new Error('spawn failed'));
    // Second event must hit the `if (hasExited) return;` guard (line 1050).
    child._emit('close', 0, null);

    await expect(p).rejects.toThrow('spawn failed');
  });

  it('ignores a second error event after close already settled the promise', async () => {
    const manager = withUv();
    const child = makeManualChild();
    mockSpawn.mockReturnValue(child);

    const p = (manager as any).doInstallPythonVersion('3.12.9');
    child._emit('close', 0, null);
    // Second event must hit the `if (hasExited) return;` guard (line 1037).
    child._emit('error', new Error('late error'));

    await expect(p).resolves.toBeUndefined();
  });
});
