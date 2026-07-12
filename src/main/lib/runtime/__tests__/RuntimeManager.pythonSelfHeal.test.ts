import * as fs from 'fs';
import * as path from 'path';

const { testUserData, mockLogger, mockExecuteCommand } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return {
    testUserData: p.join(o.tmpdir(), 'openkosmos-test-pythonSelfHeal'),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockExecuteCommand: vi.fn(),
  };
});

vi.mock('electron', async () => ({
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

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

vi.mock('../../userDataADO/appCacheManager', async () => ({
  appCacheManager: {
    getConfig: vi.fn().mockReturnValue({
      runtimeEnvironment: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: '3.10.12' },
    }),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/types/app', async () => ({
  DEFAULT_RUNTIME_ENVIRONMENT: { mode: 'internal', bunVersion: '1.3.6', uvVersion: '0.6.17', pinnedPythonVersion: null },
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: () => ({ executeCommand: mockExecuteCommand }),
}));

vi.mock('node-stream-zip', async () => ({}));

vi.mock('../LocalPythonMirror', async () => ({
  LocalPythonMirror: {
    getInstance: () => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      getBaseUrlIfRunning: vi.fn().mockReturnValue(null),
    }),
  },
}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

import { RuntimeManager } from '../RuntimeManager';

beforeEach(() => {
  (RuntimeManager as any).instance = undefined;
  mockExecuteCommand.mockReset();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
});

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ensurePinnedPythonInstalled
// ---------------------------------------------------------------------------

describe('RuntimeManager.ensurePinnedPythonInstalled', () => {
  it('is a no-op when a matching major.minor interpreter is already installed', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi
      .spyOn(manager as any, 'installPythonVersion')
      .mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([
      { version: 'cpython-3.10.12-macos-aarch64-none', path: '/x/python', status: 'installed', impl: 'cpython', semver: '3.10.12' },
    ]);

    await (manager as any).ensurePinnedPythonInstalled('3.10.12');

    expect(installSpy).not.toHaveBeenCalled();
  });

  it('matches on major.minor even when patch differs (no reinstall)', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi
      .spyOn(manager as any, 'installPythonVersion')
      .mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([
      { version: 'cpython-3.10.99-macos-aarch64-none', path: '/x/python', status: 'installed', impl: 'cpython', semver: '3.10.99' },
    ]);

    await (manager as any).ensurePinnedPythonInstalled('3.10.12');

    expect(installSpy).not.toHaveBeenCalled();
  });

  it('installs the pinned interpreter when none match', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi
      .spyOn(manager as any, 'installPythonVersion')
      .mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([
      { version: 'cpython-3.12.0-macos-aarch64-none', path: '/x/python', status: 'installed', impl: 'cpython', semver: '3.12.0' },
    ]);

    await (manager as any).ensurePinnedPythonInstalled('3.10.12');

    expect(installSpy).toHaveBeenCalledWith('3.10.12');
  });

  it('installs when nothing is installed at all', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi
      .spyOn(manager as any, 'installPythonVersion')
      .mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([]);

    await (manager as any).ensurePinnedPythonInstalled('3.10.12');

    expect(installSpy).toHaveBeenCalledWith('3.10.12');
  });

  it('swallows install errors (non-fatal)', async () => {
    const manager = RuntimeManager.getInstance();
    vi.spyOn(manager as any, 'listPythonVersionsFast').mockReturnValue([]);
    vi.spyOn(manager as any, 'installPythonVersion').mockRejectedValue(new Error('network down'));

    // Must resolve, not throw.
    await expect((manager as any).ensurePinnedPythonInstalled('3.10.12')).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to ensure pinned Python interpreter'),
      'RuntimeManager',
      expect.anything(),
    );
  });

  it('skips when pinned version has no parseable semver', async () => {
    const manager = RuntimeManager.getInstance();
    const installSpy = vi
      .spyOn(manager as any, 'installPythonVersion')
      .mockResolvedValue(undefined);
    const listSpy = vi.spyOn(manager as any, 'listPythonVersionsFast');

    await (manager as any).ensurePinnedPythonInstalled('latest');

    expect(installSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installPythonVersion concurrency de-duplication
// ---------------------------------------------------------------------------

describe('RuntimeManager.installPythonVersion (in-flight de-duplication)', () => {
  it('spawns only one install when called concurrently for the same version', async () => {
    const manager = RuntimeManager.getInstance() as any;

    // Block the actual install on a manually-resolved deferred so both callers
    // overlap in flight. Before the race fix, each caller yielded at
    // `await mirror.start()` before the lock was set, so both reached
    // doInstallPythonVersion. With the lock registered synchronously, the second
    // caller joins the first caller's promise instead.
    let resolveInstall!: () => void;
    const installGate = new Promise<void>((res) => { resolveInstall = res; });
    const doInstallSpy = vi
      .spyOn(manager, 'doInstallPythonVersion')
      .mockReturnValue(installGate);

    const p1 = manager.installPythonVersion('3.10.12');
    const p2 = manager.installPythonVersion('3.10.12');

    // Let microtasks flush so both callers pass the lock check / mirror.start().
    await Promise.resolve();
    await Promise.resolve();

    resolveInstall();
    await Promise.all([p1, p2]);

    expect(doInstallSpy).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh install after the previous one completes (lock released)', async () => {
    const manager = RuntimeManager.getInstance() as any;
    const doInstallSpy = vi
      .spyOn(manager, 'doInstallPythonVersion')
      .mockResolvedValue(undefined);

    await manager.installPythonVersion('3.10.12');
    await manager.installPythonVersion('3.10.12');

    // Sequential (non-overlapping) calls each run because the lock is deleted
    // in the finally block once the install settles.
    expect(doInstallSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// venvBaseInterpreterResolves + ensureVenvMatchesPinnedPython dangling rebuild
// ---------------------------------------------------------------------------

describe('RuntimeManager.ensureVenvMatchesPinnedPython (base interpreter validation)', () => {
  function setupVenv(manager: any, versionInfo: string) {
    const venvDir = manager.venvPath as string;
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(
      path.join(venvDir, 'pyvenv.cfg'),
      `home = ${path.join(venvDir, 'base-home')}\nversion_info = ${versionInfo}\n`,
    );
    return venvDir;
  }

  it('early-returns when version matches AND base interpreter resolves', async () => {
    const manager = RuntimeManager.getInstance() as any;
    setupVenv(manager, '3.10.12');
    vi.spyOn(manager, 'venvBaseInterpreterResolves').mockReturnValue(true);
    const recreateSpy = vi.spyOn(manager, 'recreateVenv').mockResolvedValue(undefined);
    const pipSpy = vi.spyOn(manager, 'ensureVenvPipAvailable').mockResolvedValue(true);

    await manager.ensureVenvMatchesPinnedPython('3.10.12');

    expect(recreateSpy).not.toHaveBeenCalled();
    expect(pipSpy).toHaveBeenCalled();

    fs.rmSync(manager.venvPath, { recursive: true, force: true });
  });

  it('rebuilds when version matches but base interpreter is dangling', async () => {
    const manager = RuntimeManager.getInstance() as any;
    setupVenv(manager, '3.10.12');
    vi.spyOn(manager, 'venvBaseInterpreterResolves').mockReturnValue(false);
    const recreateSpy = vi.spyOn(manager, 'recreateVenv').mockResolvedValue(undefined);

    await manager.ensureVenvMatchesPinnedPython('3.10.12');

    expect(recreateSpy).toHaveBeenCalledWith('3.10.12');

    fs.rmSync(manager.venvPath, { recursive: true, force: true });
  });

  it('rebuilds when version_info does not match pinned', async () => {
    const manager = RuntimeManager.getInstance() as any;
    setupVenv(manager, '3.12');
    const baseSpy = vi.spyOn(manager, 'venvBaseInterpreterResolves');
    const recreateSpy = vi.spyOn(manager, 'recreateVenv').mockResolvedValue(undefined);

    await manager.ensureVenvMatchesPinnedPython('3.10.12');

    expect(recreateSpy).toHaveBeenCalledWith('3.10.12');
    // Version-mismatch path rebuilds without needing the base-resolves check.
    expect(baseSpy).not.toHaveBeenCalled();

    fs.rmSync(manager.venvPath, { recursive: true, force: true });
  });

  it('creates venv proactively when no venv directory exists', async () => {
    const manager = RuntimeManager.getInstance() as any;
    // Ensure no venv dir.
    fs.rmSync(manager.venvPath, { recursive: true, force: true });
    const recreateSpy = vi.spyOn(manager, 'recreateVenv').mockResolvedValue(undefined);

    await manager.ensureVenvMatchesPinnedPython('3.10.12');

    expect(recreateSpy).toHaveBeenCalledWith('3.10.12');
  });
});

describe('RuntimeManager app-managed venv pip repair', () => {
  function setupVenvPython(manager: any) {
    const venvDir = manager.venvPath as string;
    const launcherDir = process.platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    const pythonPath = path.join(launcherDir, process.platform === 'win32' ? 'python.exe' : 'python');
    fs.writeFileSync(pythonPath, '');
    return { venvDir, pythonPath };
  }

  function setupUv(manager: any) {
    const uvPath = manager.getBinaryPath('uv') as string;
    fs.mkdirSync(path.dirname(uvPath), { recursive: true });
    fs.writeFileSync(uvPath, '');
    return uvPath;
  }

  it('creates new app-managed venvs with seeded pip', async () => {
    const manager = RuntimeManager.getInstance() as any;
    const uvPath = setupUv(manager);
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    await manager.doRecreateVenv('3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: uvPath,
      args: ['venv', '--seed', '--python', '3.10.12', manager.venvPath],
      cwd: path.dirname(manager.venvPath),
      type: 'command',
    }));
  });

  it('repairs missing pip in an existing venv without deleting installed packages', async () => {
    const manager = RuntimeManager.getInstance() as any;
    const { venvDir, pythonPath } = setupVenvPython(manager);
    const markerPath = path.join(venvDir, 'existing-package-marker.txt');
    fs.writeFileSync(markerPath, 'keep');
    const uvPath = setupUv(manager);
    mockExecuteCommand.mockReset();
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named pip' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'installed', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'pip 25.0', stderr: '' });

    await expect(manager.ensurePythonPipAvailable()).resolves.toBe(true);

    expect(fs.existsSync(markerPath)).toBe(true);
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: pythonPath,
      args: ['-m', 'pip', '--version'],
    }));
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: uvPath,
      args: ['pip', 'install', 'pip', 'setuptools', 'wheel', '--python', pythonPath],
    }));
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(3, expect.objectContaining({
      command: pythonPath,
      args: ['-m', 'pip', '--version'],
    }));

    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('returns false when the existing venv does not contain a Python entrypoint', async () => {
    const manager = RuntimeManager.getInstance() as any;
    fs.rmSync(manager.venvPath, { recursive: true, force: true });
    mockExecuteCommand.mockReset();

    await expect(manager.ensurePythonPipAvailable()).resolves.toBe(false);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

});

describe('RuntimeManager.venvBaseInterpreterResolves', () => {
  function setupHealthyVenv(manager: any) {
    const venvDir = manager.venvPath as string;
    const isWin = process.platform === 'win32';
    const homeDir = isWin
      ? path.join(venvDir, 'base-home')
      : path.join(venvDir, 'base-home', 'bin');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, isWin ? 'python.exe' : 'python'), '');
    fs.writeFileSync(
      path.join(venvDir, 'pyvenv.cfg'),
      `home = ${homeDir}\nversion_info = 3.10.12\n`,
    );
    const launcherDir = isWin ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.writeFileSync(path.join(launcherDir, isWin ? 'python.exe' : 'python'), '');
    if (!isWin) {
      fs.writeFileSync(path.join(launcherDir, 'python3'), '');
    }
    return venvDir;
  }

  it('returns true when venv entrypoints and the base interpreter exist', () => {
    const manager = RuntimeManager.getInstance() as any;
    const venvDir = setupHealthyVenv(manager);

    expect(manager.venvBaseInterpreterResolves()).toBe(true);

    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('returns false when launcher missing and no pyvenv.cfg', () => {
    const manager = RuntimeManager.getInstance() as any;
    fs.rmSync(manager.venvPath, { recursive: true, force: true });

    expect(manager.venvBaseInterpreterResolves()).toBe(false);
  });

  it('returns false when pyvenv.cfg home points at a missing interpreter', () => {
    const manager = RuntimeManager.getInstance() as any;
    const venvDir = manager.venvPath as string;
    const launcherDir = process.platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.writeFileSync(path.join(launcherDir, process.platform === 'win32' ? 'python.exe' : 'python'), '');
    if (process.platform !== 'win32') {
      fs.writeFileSync(path.join(launcherDir, 'python3'), '');
    }
    fs.writeFileSync(
      path.join(venvDir, 'pyvenv.cfg'),
      `home = ${path.join(venvDir, 'does-not-exist', 'bin')}\nversion_info = 3.10.12\n`,
    );

    expect(manager.venvBaseInterpreterResolves()).toBe(false);

    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('returns false when the unix python3 venv entrypoint is missing', () => {
    if (process.platform === 'win32') return;
    const manager = RuntimeManager.getInstance() as any;
    const venvDir = manager.venvPath as string;
    const homeDir = path.join(venvDir, 'base-home', 'bin');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'python'), '');
    const launcherDir = path.join(venvDir, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.writeFileSync(path.join(launcherDir, 'python'), '');
    fs.writeFileSync(
      path.join(venvDir, 'pyvenv.cfg'),
      `home = ${homeDir}\nversion_info = 3.10.12\n`,
    );

    expect(manager.venvBaseInterpreterResolves()).toBe(false);

    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('returns false when pyvenv.cfg exists but has no home line', () => {
    const manager = RuntimeManager.getInstance() as any;
    const venvDir = manager.venvPath as string;
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'version_info = 3.10.12\n');

    expect(manager.venvBaseInterpreterResolves()).toBe(false);

    fs.rmSync(venvDir, { recursive: true, force: true });
  });

  it('returns false (and warns) when reading pyvenv.cfg throws', () => {
    const manager = RuntimeManager.getInstance() as any;
    const venvDir = manager.venvPath as string;
    const launcherDir = process.platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.writeFileSync(path.join(launcherDir, process.platform === 'win32' ? 'python.exe' : 'python'), '');
    if (process.platform !== 'win32') {
      fs.writeFileSync(path.join(launcherDir, 'python3'), '');
    }
    // Make pyvenv.cfg a directory so existsSync passes but readFileSync throws EISDIR,
    // exercising the catch branch without spying on the (non-configurable ESM) fs module.
    fs.mkdirSync(path.join(venvDir, 'pyvenv.cfg'), { recursive: true });

    expect(manager.venvBaseInterpreterResolves()).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to verify venv base interpreter'),
      'RuntimeManager',
    );

    fs.rmSync(venvDir, { recursive: true, force: true });
  });
});
