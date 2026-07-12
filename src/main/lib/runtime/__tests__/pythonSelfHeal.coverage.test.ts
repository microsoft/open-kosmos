import * as path from 'path';

const { mockLogger, mockExecuteCommand, fsState } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockExecuteCommand: vi.fn(),
  // Mutable knobs the fs mock reads, so each test can steer existsSync / throws.
  fsState: {
    existsSync: (_p: string) => true as boolean,
    readFileSyncThrows: false,
    // When set, the readFileSync mock throws this exact value (used to force a
    // non-Error throw so the `err instanceof Error ? ... : String(err)` ternary
    // takes its String(err) branch). Defaults to an Error when unset.
    readFileSyncThrowValue: undefined as unknown,
    readFileSyncValue: '' as string,
    rmSyncThrows: false,
    rmSyncThrowValue: undefined as unknown,
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (p: string) => fsState.existsSync(p),
    readFileSync: (..._args: any[]) => {
      if (fsState.readFileSyncThrows) {
        throw fsState.readFileSyncThrowValue !== undefined
          ? fsState.readFileSyncThrowValue
          : new Error('EACCES reading pyvenv.cfg');
      }
      return fsState.readFileSyncValue;
    },
    rmSync: (..._args: any[]) => {
      if (fsState.rmSyncThrows) {
        throw fsState.rmSyncThrowValue !== undefined
          ? fsState.rmSyncThrowValue
          : new Error('EBUSY deleting venv');
      }
    },
  };
});

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: () => ({ executeCommand: mockExecuteCommand }),
}));

import {
  ensureVenvMatchesPinnedPython,
  ensurePinnedPythonInstalled,
  venvBaseInterpreterResolves,
  doRecreateVenv,
  ensureVenvPipAvailable,
  type PythonSelfHealCtx,
} from '../pythonSelfHeal';

/**
 * pythonSelfHeal — error-path + branch coverage.
 *
 * Targets the defensive catch blocks and platform/ternary branches the happy-path
 * RuntimeManager tests do not reach:
 *  - ensureVenvMatchesPinnedPython: pyvenv.cfg read throws (line 56), incl. non-Error
 *  - venvBaseInterpreterResolves: win32 launcher + home= fallback (lines 102/120),
 *    read-error catch with a non-Error throw (line 124)
 *  - ensurePinnedPythonInstalled: catch with a non-Error throw (line 162)
 *  - doRecreateVenv: rmSync throws (lines 183-184), executeCommand throws (line 217)
 *
 * `fs` is mocked module-wide (ESM exports can't be spied) with mutable knobs in
 * `fsState` so each test steers existsSync and forces the targeted throw.
 */
const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeCtx(overrides: Partial<PythonSelfHealCtx> = {}): PythonSelfHealCtx {
  return {
    venvPath: '/fake/python-venv',
    getBinaryPath: vi.fn(() => '/fake/uv'),
    listPythonVersionsFast: vi.fn(() => []),
    installPythonVersion: vi.fn().mockResolvedValue(undefined),
    recreateVenv: vi.fn().mockResolvedValue(undefined),
    venvBaseInterpreterResolves: vi.fn(() => true),
    ensureVenvPipAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
  mockExecuteCommand.mockReset();
  fsState.existsSync = () => true;
  fsState.readFileSyncThrows = false;
  fsState.readFileSyncThrowValue = undefined;
  fsState.readFileSyncValue = '';
  fsState.rmSyncThrows = false;
  fsState.rmSyncThrowValue = undefined;
  setPlatform(originalPlatform);
});

describe('pythonSelfHeal error paths', () => {
  it('warns and continues when reading pyvenv.cfg throws (line 56)', async () => {
    const ctx = makeCtx();
    // venvDir + pyvenvCfg both "exist", but the read throws -> caught, venvVersion stays null.
    fsState.readFileSyncThrows = true;

    await ensureVenvMatchesPinnedPython(ctx, '3.12.8');

    // The read error was logged as a warning...
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read pyvenv.cfg'),
      'RuntimeManager',
    );
    // ...and with venvVersion null !== pinned major.minor -> rebuild triggered.
    expect(ctx.recreateVenv).toHaveBeenCalledWith('3.12.8');
  });

  it('stringifies a non-Error pyvenv.cfg read failure (line 56 String(err) branch)', async () => {
    const ctx = makeCtx();
    fsState.readFileSyncThrows = true;
    fsState.readFileSyncThrowValue = 'permission-denied-string'; // non-Error -> String(err)

    await ensureVenvMatchesPinnedPython(ctx, '3.12.8');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('permission-denied-string'),
      'RuntimeManager',
    );
  });

  it('logs an error and returns early when deleting the stale venv throws (lines 183-184)', async () => {
    const ctx = makeCtx();
    // venvDir exists so the rmSync branch is taken; rmSync throws -> error logged, early return.
    fsState.rmSyncThrows = true;

    await doRecreateVenv(ctx, '3.10.12');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete python-venv'),
      'RuntimeManager',
    );
    // Early return means uv venv creation never runs.
    expect(mockExecuteCommand).not.toHaveBeenCalled();
    expect(ctx.getBinaryPath).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error rmSync failure (line 183 String(err) branch)', async () => {
    const ctx = makeCtx();
    fsState.rmSyncThrows = true;
    fsState.rmSyncThrowValue = 'busy-string'; // non-Error -> String(err)

    await doRecreateVenv(ctx, '3.10.12');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('busy-string'),
      'RuntimeManager',
    );
  });

  it('logs an error when the uv venv command itself throws (line 217)', async () => {
    const ctx = makeCtx();
    // venvDir + uvBin both exist so we reach executeCommand, which rejects with a non-Error.
    mockExecuteCommand.mockRejectedValue('spawn-failed-string');

    await doRecreateVenv(ctx, '3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('spawn-failed-string'),
      'RuntimeManager',
    );
  });

  it('clears any active VIRTUAL_ENV while recreating the managed venv', async () => {
    const ctx = makeCtx();
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    await doRecreateVenv(ctx, '3.10.12');

    expect(mockExecuteCommand).toHaveBeenCalledWith(expect.objectContaining({
      env: { VIRTUAL_ENV: null },
    }));
  });
});

describe('venvBaseInterpreterResolves platform + fallback branches', () => {
  it('resolves via the Windows launcher path (line 102 win32 branch)', () => {
    setPlatform('win32');
    const ctx = makeCtx();
    // Scripts\python.exe, pyvenv.cfg, and base interpreter exist.
    fsState.existsSync = (p) => p.includes('Scripts') || p.endsWith('pyvenv.cfg') || p.includes('Python312');
    fsState.readFileSyncValue = 'home = C:\\Python312\nversion_info = 3.12.8\n';

    expect(venvBaseInterpreterResolves(ctx)).toBe(true);
  });

  it('returns false when the Windows launcher is missing even if pyvenv.cfg has home', () => {
    setPlatform('win32');
    const ctx = makeCtx();
    // Missing Scripts\python.exe makes the active venv unusable even if home exists.
    fsState.existsSync = (p) => !p.includes('Scripts');
    fsState.readFileSyncValue = 'home = C:\\Python312\nversion_info = 3.12.8\n';

    expect(venvBaseInterpreterResolves(ctx)).toBe(false);
  });

  it('returns false when pyvenv.cfg is missing after launcher validation passes', () => {
    const ctx = makeCtx();
    fsState.existsSync = (p) =>
      p.endsWith(path.join('bin', 'python')) ||
      p.endsWith(path.join('bin', 'python3'));

    expect(venvBaseInterpreterResolves(ctx)).toBe(false);
  });

  it('returns false when pyvenv.cfg has no home line', () => {
    const ctx = makeCtx();
    fsState.existsSync = (p) =>
      p.endsWith(path.join('bin', 'python')) ||
      p.endsWith(path.join('bin', 'python3')) ||
      p.endsWith('pyvenv.cfg');
    fsState.readFileSyncValue = 'version_info = 3.12.8\n';

    expect(venvBaseInterpreterResolves(ctx)).toBe(false);
  });

  it('stringifies a non-Error failure while verifying the base interpreter (line 124 String(err) branch)', () => {
    const ctx = makeCtx();
    // Venv entrypoints exist -> read pyvenv.cfg, which throws a non-Error.
    fsState.existsSync = (p) =>
      p.endsWith(path.join('bin', 'python')) ||
      p.endsWith(path.join('bin', 'python3')) ||
      p.endsWith('pyvenv.cfg');
    fsState.readFileSyncThrows = true;
    fsState.readFileSyncThrowValue = 'cfg-read-string';

    expect(venvBaseInterpreterResolves(ctx)).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cfg-read-string'),
      'RuntimeManager',
    );
  });
});

describe('ensurePinnedPythonInstalled error path', () => {
  it('logs (non-fatal) and stringifies a non-Error failure (line 162 String(err) branch)', async () => {
    const ctx = makeCtx({
      listPythonVersionsFast: vi.fn(() => {
        throw 'listing-failed-string'; // non-Error -> String(err)
      }),
    });

    await ensurePinnedPythonInstalled(ctx, '3.10.12');

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[FRE][python] Failed to ensure pinned Python interpreter (non-fatal)',
      'RuntimeManager',
      { error: 'listing-failed-string' },
    );
  });
});

describe('ensureVenvPipAvailable branch coverage', () => {
  it('checks pip through the Windows venv interpreter path and quotes paths with spaces', async () => {
    setPlatform('win32');
    const ctx = makeCtx({ venvPath: 'C:\\fake path\\python-venv' });
    fsState.existsSync = () => true;
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 0, stdout: 'pip 25.0', stderr: '' });

    await expect(ensureVenvPipAvailable(ctx)).resolves.toBe(true);

    expect(mockExecuteCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringMatching(/^".*Scripts[\\/]python\.exe"$/),
      args: ['-m', 'pip', '--version'],
    }));
  });

  it('returns false when pip is missing and uv is unavailable for repair', async () => {
    const ctx = makeCtx();
    fsState.existsSync = (p) => p.endsWith(path.join('bin', 'python'));
    mockExecuteCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named pip' });

    await expect(ensureVenvPipAvailable(ctx)).resolves.toBe(false);

    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('uv binary not found'),
      'RuntimeManager',
    );
  });

  it('returns false when uv pip repair fails', async () => {
    const ctx = makeCtx();
    fsState.existsSync = () => true;
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named pip' })
      .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'network down' });

    await expect(ensureVenvPipAvailable(ctx)).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[FRE][python] Failed to repair python-venv pip',
      'RuntimeManager',
      expect.objectContaining({ stderr: 'network down' }),
    );
  });

  it('returns false when repair succeeds but pip still cannot be imported', async () => {
    const ctx = makeCtx();
    fsState.existsSync = () => true;
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named pip' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'installed', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named pip' });

    await expect(ensureVenvPipAvailable(ctx)).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[FRE][python] python-venv pip repair did not make pip importable',
      'RuntimeManager',
      expect.objectContaining({ stderr: 'No module named pip' }),
    );
  });

  it('stringifies non-Error failures while verifying pip', async () => {
    const ctx = makeCtx();
    fsState.existsSync = () => true;
    mockExecuteCommand.mockRejectedValueOnce('pip-check-crashed');

    await expect(ensureVenvPipAvailable(ctx)).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[FRE][python] Failed to verify or repair python-venv pip',
      'RuntimeManager',
      { error: 'pip-check-crashed' },
    );
  });
});
