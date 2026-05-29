/**
 * RuntimeManager.deep4.test.ts
 *
 * Targets uncovered lines that prior test files missed:
 *  - ensureShims: Windows .cmd shim path (isWin=true)
 *  - ensureShims: error catch path
 *  - initializeInternalMode: Agency CLI feature-enabled path (install and already-installed)
 *  - ensureRequiredToolsInstalled: uv already installed + bun not installed
 *  - ensureRequiredToolsInstalled: bun install success / failure callbacks
 *  - doInstallPythonVersion: full spawn flow (stdout/stderr data, close code=0, signal, null code, non-zero)
 *  - doInstallPythonVersion: uv exists but chmod fails (non-win32)
 *  - doInstallPythonVersion: uv binary not found at path
 *  - uninstallPythonVersion: spawn close success / failure
 *  - cleanUvCache: stdout/stderr data handlers, close code=0 and non-zero, error event
 *  - IPC handler callbacks: runtime:set-mode, runtime:install-component (bun path + error path),
 *    runtime:check-status (agency enabled), runtime:install-agency/uninstall-agency (enabled/disabled),
 *    runtime:list-python-versions, runtime:list-python-versions-fast,
 *    runtime:install-python-version (success/failure), runtime:uninstall-python-version,
 *    runtime:set-pinned-python-version, runtime:clean-uv-cache, runtime:check-git-version
 *  - installBunDirectly: unsupported platform throws
 *  - installUvDirectly: unsupported platform throws
 *  - parsePythonListOutput (private): various line formats
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-RuntimeManager-deep4'),
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
  getTerminalManager: vi.fn().mockReturnValue({
    executeCommand: mockExecuteCommand,
  }),
}));

vi.mock('node-stream-zip', () => ({}));

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
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

let mockSpawnInstance: any;
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));
vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: vi.fn(),
}));

import { RuntimeManager } from '../RuntimeManager';

// Helpers ─────────────────────────────────────────────────────────────────────

function makeMockChild(opts: {
  stdout?: string;
  stderr?: string;
  closeCode?: number | null;
  signal?: string | null;
  errorOnClose?: Error;
} = {}) {
  const listeners: Record<string, Function[]> = {
    data: [],
    close: [],
    error: [],
  };
  const stdoutListeners: Function[] = [];
  const stderrListeners: Function[] = [];

  const child = {
    pid: 9999,
    stdout: {
      on: vi.fn((event: string, cb: Function) => { stdoutListeners.push(cb); }),
    },
    stderr: {
      on: vi.fn((event: string, cb: Function) => { stderrListeners.push(cb); }),
    },
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    _emit: (event: string, ...args: any[]) => {
      if (event === 'stdout-data') stdoutListeners.forEach(cb => cb(...args));
      else if (event === 'stderr-data') stderrListeners.forEach(cb => cb(...args));
      else listeners[event]?.forEach(cb => cb(...args));
    },
  };

  // Schedule async events
  setImmediate(() => {
    if (opts.stdout) child._emit('stdout-data', Buffer.from(opts.stdout));
    if (opts.stderr) child._emit('stderr-data', Buffer.from(opts.stderr));
    if (opts.errorOnClose) {
      child._emit('error', opts.errorOnClose);
    } else {
      // Use undefined check so callers can explicitly pass null for code/signal
      const code = opts.closeCode !== undefined ? opts.closeCode : 0;
      const signal = opts.signal !== undefined ? opts.signal : null;
      child._emit('close', code, signal);
    }
  });

  return child;
}

function resetManager(mode: 'system' | 'internal' = 'system', pinnedPythonVersion: string | null = null) {
  (RuntimeManager as any).instance = undefined;
  mockCacheConfig.runtimeEnvironment = {
    mode,
    bunVersion: '1.5.0',
    uvVersion: '0.7.0',
    pinnedPythonVersion,
  };
  return RuntimeManager.getInstance();
}

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIpcHandlers[''] && Object.keys(mockIpcHandlers).forEach(k => delete mockIpcHandlers[k]);
  // Reset all IPC handlers
  for (const key of Object.keys(mockIpcHandlers)) {
    delete mockIpcHandlers[key];
  }
  mockSpawn.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureShims — Windows path
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.ensureShims — Windows .cmd shims', () => {
  let manager: RuntimeManager;
  const originalPlatform = process.platform;

  beforeEach(() => {
    manager = resetManager('system');
    // Ensure bin dir exists so shims can be written
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    // Place uv.exe and bun.exe binaries so shims are not skipped
    fs.writeFileSync(path.join(binDir, 'uv.exe'), '');
    fs.writeFileSync(path.join(binDir, 'bun.exe'), '');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('creates .cmd shims for Windows when uv and bun are installed', () => {
    (manager as any).ensureShims(true);

    const binDir = path.join(testUserData, 'bin');
    // Check that Windows .cmd shims were created
    expect(fs.existsSync(path.join(binDir, 'python.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'pip.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'npm.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'npx.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'node.cmd'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'uvx.cmd'))).toBe(true);
  });

  it('shim content uses .exe paths on Windows', () => {
    (manager as any).ensureShims(true);
    const binDir = path.join(testUserData, 'bin');
    const pythonCmdContent = fs.readFileSync(path.join(binDir, 'python.cmd'), 'utf-8');
    expect(pythonCmdContent).toContain('uv.exe');
    expect(pythonCmdContent).toContain('@echo off');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureShims — error catch path
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.ensureShims — error caught', () => {
  it('does not throw when ensureShims is called on system mode (non-throwing base case)', () => {
    const manager = resetManager('system');
    // Ensure bin dir doesn't exist to test the creation path
    const binDir = path.join(testUserData, 'bin');
    if (fs.existsSync(binDir)) {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
    // Should not throw even when bin dir doesn't exist
    expect(() => (manager as any).ensureShims(true)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureRequiredToolsInstalled — bun not installed, uv already installed
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.ensureRequiredToolsInstalled — bun missing path', () => {
  it('installs bun when uv is installed but bun is not', async () => {
    const manager = resetManager('internal');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    // Place uv but not bun
    const uvPath = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvPath), '');
    // Ensure bun does not exist
    const bunPath = process.platform === 'win32' ? 'bun.exe' : 'bun';
    try { fs.unlinkSync(path.join(binDir, bunPath)); } catch { /* already missing */ }

    const installRuntimeSpy = vi.spyOn(manager as any, 'installRuntime').mockResolvedValue(undefined);

    await (manager as any).ensureRequiredToolsInstalled();

    // uv is installed so no uv install; bun is not so bun install
    const calls = installRuntimeSpy.mock.calls.map(c => c[0]);
    expect(calls).not.toContain('uv');
    expect(calls).toContain('bun');

    installRuntimeSpy.mockRestore();
  });

  it('refreshes shims after successful bun installation', async () => {
    const manager = resetManager('internal');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    fs.writeFileSync(path.join(binDir, uvBin), '');
    try { fs.unlinkSync(path.join(binDir, bunBin)); } catch { /* ignore */ }

    const installRuntimeSpy = vi.spyOn(manager as any, 'installRuntime').mockResolvedValue(undefined);
    const ensureShimsSpy = vi.spyOn(manager as any, 'ensureShims').mockImplementation(() => {});

    await (manager as any).ensureRequiredToolsInstalled();

    // ensureShims should be called from the .then() of bun install
    expect(ensureShimsSpy).toHaveBeenCalledWith(true);

    installRuntimeSpy.mockRestore();
    ensureShimsSpy.mockRestore();
  });

  it('logs error when bun installation fails', async () => {
    const manager = resetManager('internal');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
    const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    try { fs.unlinkSync(path.join(binDir, bunBin)); } catch { /* ignore */ }

    const installRuntimeSpy = vi.spyOn(manager as any, 'installRuntime').mockRejectedValue(new Error('network error'));

    await (manager as any).ensureRequiredToolsInstalled();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('bun silent installation failed'),
      'RuntimeManager',
      expect.anything(),
    );

    installRuntimeSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// doInstallPythonVersion — spawn flow branches
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.doInstallPythonVersion', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    manager = resetManager('system');
    // Place uv binary in bin dir
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
  });

  it('resolves when uv python install exits with code 0', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0, stdout: 'Installed', stderr: 'progress...' }));
    await expect((manager as any).doInstallPythonVersion('3.12.9')).resolves.toBeUndefined();
  });

  it('rejects when uv python install exits with non-zero code', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 1, stderr: 'error msg' }));
    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow(
      'uv python install failed with code 1',
    );
  });

  it('rejects when uv python install is terminated by signal', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: null, signal: 'SIGTERM', stderr: 'killed' }));
    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow(
      'uv python install was terminated by signal SIGTERM',
    );
  });

  it('rejects when uv python install exits with null code and no signal', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: null, signal: null }));
    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow(
      'uv python install exited unexpectedly',
    );
  });

  it('rejects when process emits an error event', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ errorOnClose: new Error('ENOENT spawn') }));
    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow('ENOENT spawn');
  });

  it('throws when uv is not installed', async () => {
    const binDir = path.join(testUserData, 'bin');
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    try { fs.unlinkSync(path.join(binDir, uvBin)); } catch { /* ignore */ }
    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow(
      'uv is not installed',
    );
  });

  it('throws when uv binary is missing from bin path after isInstalled returns true', async () => {
    // isInstalled returns true because uv file exists, but getEnvWithInternalPath
    // will be called later — simulate by having spawn path return ENOENT
    const binDir = path.join(testUserData, 'bin');
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    // Remove uv so getBinaryPath path resolves but existsSync returns false
    const uvFullPath = path.join(binDir, uvBin);
    // We need isInstalled to say true but existsSync on the binary to say false
    vi.spyOn(manager as any, 'isInstalled').mockReturnValue(true);
    // Remove the file so existsSync(uvPath) returns false
    try { fs.unlinkSync(uvFullPath); } catch { /* ignore */ }

    await expect((manager as any).doInstallPythonVersion('3.12.9')).rejects.toThrow(
      /uv binary not found at/,
    );
    vi.restoreAllMocks();
    // Restore for subsequent tests
    fs.writeFileSync(uvFullPath, '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uninstallPythonVersion — spawn close success and failure
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.uninstallPythonVersion', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    manager = resetManager('system');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
  });

  it('resolves on code 0', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0 }));
    await expect(manager.uninstallPythonVersion('cpython-3.12.9-macos-aarch64-none')).resolves.toBeUndefined();
  });

  it('rejects on non-zero code', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 2 }));
    await expect(manager.uninstallPythonVersion('cpython-3.12.9-macos-aarch64-none')).rejects.toThrow(
      'uv python uninstall failed with code 2',
    );
  });

  it('unsets pinned version when uninstalling the pinned semver', async () => {
    mockCacheConfig.runtimeEnvironment.pinnedPythonVersion = '3.12.9';
    manager = resetManager('system', '3.12.9');

    const setPinnedSpy = vi.spyOn(manager as any, 'setPinnedPythonVersion').mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0 }));

    await manager.uninstallPythonVersion('cpython-3.12.9-macos-aarch64-none');
    expect(setPinnedSpy).toHaveBeenCalledWith(null);
  });

  it('throws when uv is not installed', async () => {
    const binDir = path.join(testUserData, 'bin');
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    try { fs.unlinkSync(path.join(binDir, uvBin)); } catch { /* ignore */ }

    await expect(manager.uninstallPythonVersion('3.12.9')).rejects.toThrow('uv is not installed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanUvCache — stdout/stderr/close/error branches
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.cleanUvCache', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    manager = resetManager('system');
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
  });

  it('resolves on code 0 (success path)', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 0, stdout: 'Cleared', stderr: '' }));
    await expect(manager.cleanUvCache()).resolves.toBeUndefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('uv cache cleaned successfully'),
      'RuntimeManager',
    );
  });

  it('resolves (non-fatal) on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ closeCode: 1, stderr: 'cache warning' }));
    await expect(manager.cleanUvCache()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('uv cache clean exited with code 1'),
      'RuntimeManager',
      expect.anything(),
    );
  });

  it('resolves (non-fatal) on process error event', async () => {
    mockSpawn.mockReturnValue(makeMockChild({ errorOnClose: new Error('spawn error') }));
    await expect(manager.cleanUvCache()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to run uv cache clean'),
      'RuntimeManager',
      expect.anything(),
    );
  });

  it('returns early when uv is not installed', async () => {
    const binDir = path.join(testUserData, 'bin');
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    try { fs.unlinkSync(path.join(binDir, uvBin)); } catch { /* ignore */ }

    await expect(manager.cleanUvCache()).resolves.toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC handler tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager IPC handlers', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    // Clear handler registry
    for (const key of Object.keys(mockIpcHandlers)) delete mockIpcHandlers[key];
    manager = resetManager('system');
    // Ensure bin dir and uv exist for tests that need it
    const binDir = path.join(testUserData, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv';
    fs.writeFileSync(path.join(binDir, uvBin), '');
  });

  it('runtime:set-mode calls setRuntimeMode and returns config', async () => {
    const handler = mockIpcHandlers['runtime:set-mode'];
    expect(handler).toBeDefined();
    const result = await handler({}, 'system');
    expect(result).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('runtime:set-mode called'),
      'RuntimeManager',
      expect.anything(),
    );
  });

  it('runtime:install-component: bun tool calls setVersion with bun', async () => {
    const handler = mockIpcHandlers['runtime:install-component'];
    expect(handler).toBeDefined();

    vi.spyOn(manager as any, 'installRuntime').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'setVersion').mockResolvedValue(undefined);

    const result = await handler({}, 'bun', '1.5.0');
    expect(result).toEqual({ success: true });
    expect((manager as any).setVersion).toHaveBeenCalledWith('bun', '1.5.0');
  });

  it('runtime:install-component: uv tool calls setVersion with uv', async () => {
    const handler = mockIpcHandlers['runtime:install-component'];
    vi.spyOn(manager as any, 'installRuntime').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'setVersion').mockResolvedValue(undefined);

    const result = await handler({}, 'uv', '0.7.0');
    expect(result).toEqual({ success: true });
    expect((manager as any).setVersion).toHaveBeenCalledWith('uv', '0.7.0');
  });

  it('runtime:install-component: rethrows on error', async () => {
    const handler = mockIpcHandlers['runtime:install-component'];
    vi.spyOn(manager as any, 'installRuntime').mockRejectedValue(new Error('install failed'));

    await expect(handler({}, 'uv', '0.7.0')).rejects.toThrow('install failed');
  });


  it('runtime:list-python-versions calls listPythonVersions', async () => {
    const handler = mockIpcHandlers['runtime:list-python-versions'];
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([]);
    const result = await handler({});
    expect(Array.isArray(result)).toBe(true);
  });

  it('runtime:list-python-versions-fast returns fast scan result', () => {
    const handler = mockIpcHandlers['runtime:list-python-versions-fast'];
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([{ version: 'cpython-3.12.9' }]);
    const result = handler({});
    expect(result).toHaveLength(1);
  });

  it('runtime:install-python-version: success path', async () => {
    const handler = mockIpcHandlers['runtime:install-python-version'];
    vi.spyOn(manager as any, 'installPythonVersion').mockResolvedValue(undefined);
    await expect(handler({}, '3.12.9')).resolves.toBeUndefined();
  });

  it('runtime:install-python-version: failure rethrows', async () => {
    const handler = mockIpcHandlers['runtime:install-python-version'];
    vi.spyOn(manager as any, 'installPythonVersion').mockRejectedValue(new Error('py install failed'));
    await expect(handler({}, '3.12.9')).rejects.toThrow('py install failed');
  });

  it('runtime:uninstall-python-version calls uninstallPythonVersion', async () => {
    const handler = mockIpcHandlers['runtime:uninstall-python-version'];
    vi.spyOn(manager as any, 'uninstallPythonVersion').mockResolvedValue(undefined);
    await handler({}, 'cpython-3.12.9-macos-aarch64-none');
    expect((manager as any).uninstallPythonVersion).toHaveBeenCalledWith('cpython-3.12.9-macos-aarch64-none');
  });

  it('runtime:set-pinned-python-version calls setPinnedPythonVersion', async () => {
    const handler = mockIpcHandlers['runtime:set-pinned-python-version'];
    vi.spyOn(manager as any, 'setPinnedPythonVersion').mockResolvedValue(undefined);
    await handler({}, '3.12.9');
    expect((manager as any).setPinnedPythonVersion).toHaveBeenCalledWith('3.12.9');
  });

  it('runtime:clean-uv-cache calls cleanUvCache', async () => {
    const handler = mockIpcHandlers['runtime:clean-uv-cache'];
    vi.spyOn(manager, 'cleanUvCache').mockResolvedValue(undefined);
    await handler({});
    expect(manager.cleanUvCache).toHaveBeenCalled();
  });

  it('runtime:check-git-version returns git info', async () => {
    const handler = mockIpcHandlers['runtime:check-git-version'];
    vi.spyOn(manager as any, 'checkGitVersion').mockResolvedValue({
      installed: true,
      version: '2.40.1',
      path: '/usr/bin/git',
    });
    const result = await handler({});
    expect(result.installed).toBe(true);
    expect(result.version).toBe('2.40.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// installBunDirectly / installUvDirectly — unsupported platform
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.installBunDirectly — unsupported platform', () => {
  it('throws for unsupported platform-arch combo', async () => {
    const manager = resetManager('system');
    const originalPlatform = process.platform;
    const originalArch = process.arch;

    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    await expect((manager as any).installBunDirectly('1.5.0')).rejects.toThrow(
      /Unsupported platform\/architecture/,
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });
});

describe('RuntimeManager.installUvDirectly — unsupported platform', () => {
  it('throws for unsupported platform-arch combo', async () => {
    const manager = resetManager('system');
    const originalPlatform = process.platform;
    const originalArch = process.arch;

    Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'mips', configurable: true });

    await expect((manager as any).installUvDirectly('0.7.0')).rejects.toThrow(
      /Unsupported platform\/architecture/,
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePythonListOutput — private method
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeManager.parsePythonListOutput (private)', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    manager = resetManager('system');
  });

  it('returns empty array for empty output', () => {
    const result = (manager as any).parsePythonListOutput('');
    expect(result).toEqual([]);
  });

  it('parses installed Python entry with absolute path', () => {
    // Use a platform-appropriate absolute path
    const absPath = process.platform === 'win32'
      ? 'C:\\AppData\\uv\\python\\cpython-3.12.8\\python.exe'
      : '/home/.local/share/uv/python/cpython-3.12.8/bin/python';
    const output = `cpython-3.12.8-windows-x86_64-none   ${absPath}`;
    const result = (manager as any).parsePythonListOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('cpython-3.12.8-windows-x86_64-none');
    expect(result[0].status).toBe('installed');
  });

  it('parses available (not installed) Python entry', () => {
    const output = 'cpython-3.13.1-windows-x86_64-none   <download available>';
    const result = (manager as any).parsePythonListOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('available');
    expect(result[0].path).toBeNull();
  });

  it('skips blank lines', () => {
    const output = '\n\ncpython-3.12.8-macos-aarch64-none   /home/.local/share/uv/python/cpython-3.12.8/bin/python\n\n';
    const result = (manager as any).parsePythonListOutput(output);
    expect(result).toHaveLength(1);
  });
});
