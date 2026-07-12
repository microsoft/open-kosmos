import * as path from 'path';
import { EventEmitter } from 'events';

const { mockLogger, mockSpawn, spawnState, fsState } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockSpawn: vi.fn(),
  spawnState: { exitCode: 0 as number | null, stdout: '', stderr: '', error: null as Error | null, hang: false },
  fsState: { existsSync: (_p: string) => true as boolean },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: (p: string) => fsState.existsSync(p) };
});

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => mockLogger,
  getUnifiedLogger: () => mockLogger,
  createConsoleLogger: () => mockLogger,
}));

vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => mockSpawn(...a) }));

function makeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();
  setImmediate(() => {
    if (spawnState.hang) return;
    if (spawnState.error) { child.emit('error', spawnState.error); return; }
    if (spawnState.stdout) stdout.emit('data', spawnState.stdout);
    if (spawnState.stderr) stderr.emit('data', spawnState.stderr);
    child.emit('close', spawnState.exitCode);
  });
  return child;
}

function makeManualChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();
  return child;
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

import {
  listPythonPackages,
  installPythonPackages,
  uninstallPythonPackage,
  withVenvMutationLock,
  isValidPackageSpec,
  parsePackageSpecs,
  type PythonPackagesCtx,
} from '../pythonPackages';

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeCtx(overrides: Partial<PythonPackagesCtx> = {}): PythonPackagesCtx {
  return {
    venvPath: '/fake/python-venv',
    getBinaryPath: vi.fn(() => '/fake/uv'),
    getEnvWithInternalPath: vi.fn(() => ({ PATH: '/fake' }) as unknown as NodeJS.ProcessEnv),
    ensureVenvReady: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsState.existsSync = () => true;
  setPlatform('linux');
  spawnState.exitCode = 0;
  spawnState.stdout = '';
  spawnState.stderr = '';
  spawnState.error = null;
  spawnState.hang = false;
  mockSpawn.mockImplementation(() => makeChild());
});

afterEach(() => setPlatform(originalPlatform));

describe('isValidPackageSpec', () => {
  it.each(['requests', 'mcp[cli]', 'httpx>=0.27,<1', 'ruff==0.4.2'])('accepts %s', (s) => {
    expect(isValidPackageSpec(s)).toBe(true);
  });
  it.each(['', '-flag', '--upgrade', 'a;b', 'rm -rf', 'pkg`x`'])('rejects %s', (s) => {
    expect(isValidPackageSpec(s)).toBe(false);
  });
});

describe('parsePackageSpecs', () => {
  it('splits on whitespace and comma-separated names', () => {
    expect(parsePackageSpecs(' mcp, httpx  ruff ')).toEqual(['mcp', 'httpx', 'ruff']);
    expect(parsePackageSpecs('mcp,httpx')).toEqual(['mcp', 'httpx']);
    expect(parsePackageSpecs('mcp,2to3')).toEqual(['mcp', '2to3']);
  });
  it('preserves comma version ranges with no surrounding space', () => {
    expect(parsePackageSpecs('mcp httpx>=0.27,<1')).toEqual(['mcp', 'httpx>=0.27,<1']);
  });
  it('keeps multi-extra specs intact', () => {
    expect(parsePackageSpecs('requests[security,socks] mcp')).toEqual(['requests[security,socks]', 'mcp']);
  });
  it('returns empty for blank', () => {
    expect(parsePackageSpecs('   ')).toEqual([]);
  });
});

describe('listPythonPackages', () => {
  it('returns [] when the venv interpreter is missing', async () => {
    fsState.existsSync = () => false;
    expect(await listPythonPackages(makeCtx())).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('parses and sorts uv pip list json', async () => {
    spawnState.stdout = '[{"name":"requests","version":"2.0"},{"name":"mcp","version":"1.0"},{"name":""}]';
    const out = await listPythonPackages(makeCtx());
    expect(out).toEqual([{ name: 'mcp', version: '1.0' }, { name: 'requests', version: '2.0' }]);
  });

  it('defaults missing version to empty string', async () => {
    spawnState.stdout = '[{"name":"x"}]';
    expect(await listPythonPackages(makeCtx())).toEqual([{ name: 'x', version: '' }]);
  });

  it('returns [] on nonzero exit', async () => {
    spawnState.exitCode = 1; spawnState.stderr = 'boom';
    expect(await listPythonPackages(makeCtx())).toEqual([]);
  });

  it('returns [] on bad json', async () => {
    spawnState.stdout = 'not json';
    expect(await listPythonPackages(makeCtx())).toEqual([]);
  });

  it('kills uv and returns [] when it times out', async () => {
    vi.useFakeTimers();
    spawnState.hang = true;
    try {
      const p = listPythonPackages(makeCtx());
      await vi.advanceTimersByTimeAsync(30_001);
      expect(await p).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('installPythonPackages', () => {
  it('throws on empty list', async () => {
    await expect(installPythonPackages(makeCtx(), ['  '])).rejects.toThrow('No packages');
  });
  it('throws on invalid spec', async () => {
    await expect(installPythonPackages(makeCtx(), ['ok', '-bad'])).rejects.toThrow('Invalid package');
  });
  it('runs uv pip install with shell:false on success', async () => {
    await installPythonPackages(makeCtx(), ['mcp', 'httpx>=0.27,<1']);
    const [cmd, argv, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('/fake/uv');
    expect(argv).toEqual(['pip', 'install', 'mcp', 'httpx>=0.27,<1', '--python', path.join('/fake/python-venv', 'bin', 'python')]);
    expect(opts.shell).toBe(false);
  });
  it('throws when uv binary missing', async () => {
    fsState.existsSync = () => false;
    await expect(installPythonPackages(makeCtx(), ['mcp'])).rejects.toThrow('uv is not installed');
  });
  it('throws on uv failure', async () => {
    spawnState.exitCode = 1; spawnState.stderr = 'nope';
    await expect(installPythonPackages(makeCtx(), ['mcp'])).rejects.toThrow('Failed to install');
  });
  it('throws when spawn errors', async () => {
    spawnState.error = new Error('ENOENT');
    await expect(installPythonPackages(makeCtx(), ['mcp'])).rejects.toThrow('Failed to install');
  });
  it('ensures the venv is ready before installing', async () => {
    const ctx = makeCtx();
    await installPythonPackages(ctx, ['mcp']);
    expect(ctx.ensureVenvReady).toHaveBeenCalledTimes(1);
  });
  it('works when ctx provides no ensureVenvReady', async () => {
    await expect(installPythonPackages(makeCtx({ ensureVenvReady: undefined }), ['mcp'])).resolves.toBeUndefined();
  });
  it('throws when packages is not an array', async () => {
    await expect(installPythonPackages(makeCtx(), null as unknown as string[])).rejects.toThrow('No packages');
  });
  it('ignores non-string entries', async () => {
    await installPythonPackages(makeCtx(), ['mcp', 5 as unknown as string]);
    expect(mockSpawn.mock.calls[0][1]).toContain('mcp');
  });
});

describe('uninstallPythonPackage', () => {
  it('throws on invalid name', async () => {
    await expect(uninstallPythonPackage(makeCtx(), '-x')).rejects.toThrow('Invalid package');
  });
  it('throws when name is not a string', async () => {
    await expect(uninstallPythonPackage(makeCtx(), 123 as unknown as string)).rejects.toThrow('Invalid package');
  });
  it('runs uv pip uninstall on success', async () => {
    await uninstallPythonPackage(makeCtx(), 'mcp');
    expect(mockSpawn.mock.calls[0][1]).toEqual(['pip', 'uninstall', 'mcp', '--python', path.join('/fake/python-venv', 'bin', 'python')]);
  });
  it('throws on uv failure', async () => {
    spawnState.exitCode = 1; spawnState.stderr = 'err';
    await expect(uninstallPythonPackage(makeCtx(), 'mcp')).rejects.toThrow('Failed to uninstall');
  });
  it('ensures the venv is ready before uninstalling', async () => {
    const ctx = makeCtx();
    await uninstallPythonPackage(ctx, 'mcp');
    expect(ctx.ensureVenvReady).toHaveBeenCalledTimes(1);
  });
});

describe('mutation serialization', () => {
  it('runs install and uninstall sequentially, not concurrently', async () => {
    await Promise.all([
      installPythonPackages(makeCtx(), ['mcp']),
      uninstallPythonPackage(makeCtx(), 'httpx'),
    ]);
    // Two separate uv invocations, never overlapping mid-flight.
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('lets nested venv mutation lock calls run reentrantly', async () => {
    await expect(withVenvMutationLock(() => withVenvMutationLock(async () => 'ok'))).resolves.toBe('ok');
  });

  it('blocks direct venv mutations while package install is active', async () => {
    const child = makeManualChild();
    mockSpawn.mockReturnValueOnce(child);
    const install = installPythonPackages(makeCtx(), ['mcp']);
    await tick();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    let entered = false;
    const directMutation = withVenvMutationLock(async () => {
      entered = true;
    });
    await tick();
    expect(entered).toBe(false);

    child.emit('close', 0);
    await install;
    await directMutation;
    expect(entered).toBe(true);
  });
});

describe('platform', () => {
  it('uses Scripts/python.exe on win32 and passes uv path unquoted', async () => {
    setPlatform('win32');
    await installPythonPackages(makeCtx({ getBinaryPath: vi.fn(() => 'C:/Program Files/uv.exe') }), ['mcp']);
    const [cmd, argv] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('C:/Program Files/uv.exe');
    expect(argv).toContain(path.join('/fake/python-venv', 'Scripts', 'python.exe'));
  });
});
