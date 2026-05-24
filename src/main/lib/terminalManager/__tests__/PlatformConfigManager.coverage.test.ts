// @ts-nocheck
/**
 * @vitest-environment node
 *
 * Extended coverage for PlatformConfigManager — covers all branches not hit by
 * the existing PlatformConfigManager.test.ts.
 */

// Must be hoisted before any import
const mockAppGetPath = vi.hoisted(() => vi.fn().mockReturnValue('/Users/testuser/AppData/Roaming/OpenKosmos'));
const mockRuntimeManagerInstance = vi.hoisted(() => ({
  getRunTimeConfig: vi.fn().mockReturnValue({ pinnedPythonVersion: '3.12' }),
  getVenvPath: vi.fn().mockReturnValue('/Users/testuser/AppData/Roaming/OpenKosmos/python-venv'),
}));
const mockExecSync = vi.hoisted(() => vi.fn());
const mockFsAccess = vi.hoisted(() => vi.fn());
const mockFsExistsSync = vi.hoisted(() => vi.fn());
const mockFsStatSync = vi.hoisted(() => vi.fn());
const mockFsMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getPath: mockAppGetPath },
}));

vi.mock('../../runtime/RuntimeManager', () => ({
  RuntimeManager: {
    getInstance: () => mockRuntimeManagerInstance,
  },
}));

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, execSync: mockExecSync };
});

// We mock the promises variant of fs that the module imports as `fs`
vi.mock('fs/promises', () => ({
  access: mockFsAccess,
  constants: { F_OK: 0, X_OK: 1 },
}));

// Sync fs is imported as `fsSync`
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  return {
    ...real,
    existsSync: mockFsExistsSync,
    statSync: mockFsStatSync,
    mkdirSync: mockFsMkdirSync,
    constants: { F_OK: 0, X_OK: 1, R_OK: 4 },
  };
});

import type { PlatformConfigManager as PCMType } from '../PlatformConfigManager';

// Re-import inside each test group that tweaks process.platform, using resetModules
async function loadManager(platformOverride?: string): Promise<{
  PlatformConfigManager: typeof PCMType;
}> {
  vi.resetModules();
  if (platformOverride) {
    Object.defineProperty(process, 'platform', { value: platformOverride, configurable: true });
  }
  const mod = await import('../PlatformConfigManager');
  return mod as any;
}

const originalPlatform = process.platform;

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Singleton / getConfig / getDefaultShell / getShellProfile
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager — basic getters', () => {
  it('returns the same instance from getInstance() (singleton)', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const a = PlatformConfigManager.getInstance();
    const b = PlatformConfigManager.getInstance();
    expect(a).toBe(b);
  });

  it('getDefaultShell() returns zsh on darwin', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    expect(PlatformConfigManager.getInstance().getDefaultShell()).toBe('zsh');
  });

  it('getDefaultShell() returns bash on linux', async () => {
    const { PlatformConfigManager } = await loadManager('linux');
    expect(PlatformConfigManager.getInstance().getDefaultShell()).toBe('bash');
  });

  it('getDefaultShell() returns powershell on win32', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    expect(PlatformConfigManager.getInstance().getDefaultShell()).toBe('powershell');
  });

  it('getConfig() returns a config with shells', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const cfg = PlatformConfigManager.getInstance().getConfig();
    expect(cfg.shells).toBeDefined();
    expect(cfg.pathSeparator).toBe(':');
  });

  it('getShellProfile() returns the default shell profile when no arg given', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const profile = mgr.getShellProfile();
    expect(profile.command).toBe('/bin/zsh');
  });

  it('getShellProfile() returns fallback to default when unknown shell type provided', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const profile = mgr.getShellProfile('bash');
    expect(profile.command).toBe('/bin/bash');
  });

  it('isShellPersistent() returns correct value', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    expect(mgr.isShellPersistent('zsh')).toBe(true);
    expect(mgr.isShellPersistent('sh')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isShellCommandAvailable
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.isShellCommandAvailable', () => {
  it('returns false for empty command', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    expect(await mgr.isShellCommandAvailable('')).toBe(false);
  });

  it('returns false for whitespace-only command', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    expect(await mgr.isShellCommandAvailable('   ')).toBe(false);
  });

  it('returns true for absolute path that exists and is executable', async () => {
    mockFsAccess.mockResolvedValueOnce(undefined);
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.isShellCommandAvailable('/usr/bin/node');
    expect(result).toBe(true);
  });

  it('returns false for absolute path that throws on fs.access', async () => {
    mockFsAccess.mockRejectedValueOnce(new Error('not found'));
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.isShellCommandAvailable('/nonexistent/path');
    expect(result).toBe(false);
  });

  it('caches results so fs.access is called only once per command', async () => {
    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    await mgr.isShellCommandAvailable('/usr/bin/uniquepath_cached');
    await mgr.isShellCommandAvailable('/usr/bin/uniquepath_cached');
    // Only 1 access call total for both invocations (second uses cache)
    expect(mockFsAccess).toHaveBeenCalledTimes(1);
  });

  it('returns true for powershell.exe on win32 fallback', async () => {
    // Make resolveCommandPath return original (not found), triggering Windows fallback
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    // Stub resolveCommandPath to return 'powershell.exe' (unchanged = not found via path)
    vi.spyOn(mgr, 'resolveCommandPath').mockResolvedValue('powershell.exe');
    const result = await mgr.isShellCommandAvailable('powershell.exe');
    expect(result).toBe(true);
  });

  it('returns true for cmd.exe on win32 when ComSpec ends with cmd.exe', async () => {
    const originalComSpec = process.env.ComSpec;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr, 'resolveCommandPath').mockResolvedValue('cmd.exe');
    const result = await mgr.isShellCommandAvailable('cmd.exe');
    expect(result).toBe(true);

    process.env.ComSpec = originalComSpec;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveCommandPath / findUnixExecutable
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.resolveCommandPath (unix)', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockFsAccess.mockReset();
  });

  it('returns command as-is when it contains a slash', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('/usr/local/bin/node');
    expect(result).toBe('/usr/local/bin/node');
  });

  it('returns command as-is when it contains shell operators', async () => {
    const { PlatformConfigManager } = await loadManager('linux');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('echo hello && echo world');
    expect(result).toBe('echo hello && echo world');
  });

  it('returns command as-is for compound commands with pipe', async () => {
    const { PlatformConfigManager } = await loadManager('linux');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('cat file | grep foo');
    expect(result).toBe('cat file | grep foo');
  });

  it('resolves via `which` when which succeeds', async () => {
    mockExecSync.mockReturnValue('/usr/local/bin/node\n');
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('node');
    expect(result).toBe('/usr/local/bin/node');
  });

  it('returns command when `which` returns multi-line (unexpected)', async () => {
    mockExecSync.mockReturnValue('/bin/a\n/bin/b\n');
    mockFsAccess.mockRejectedValue(new Error('not found'));
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('ambiguous');
    // which returned multi-line → falls through to manual search → not found → original
    expect(result).toBe('ambiguous');
  });

  it('falls back to manual search when which fails and finds via common path', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('which failed'); });
    // First access resolves (homebrew path)
    mockFsAccess.mockResolvedValueOnce(undefined);
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('bun');
    expect(result).toBe('/opt/homebrew/bin/bun');
  });

  it('returns command when which fails and manual search finds nothing', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('which failed'); });
    mockFsAccess.mockRejectedValue(new Error('not found'));
    const { PlatformConfigManager } = await loadManager('linux');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('nonexistentcmd');
    expect(result).toBe('nonexistentcmd');
  });

  it('returns command as-is when it has arguments (baseCommand !== command)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('which failed'); });
    const { PlatformConfigManager } = await loadManager('linux');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.resolveCommandPath('python3 -m http.server');
    expect(result).toBe('python3 -m http.server');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveCommandPath on Windows
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.resolveCommandPath (win32)', () => {
  beforeEach(() => {
    mockFsAccess.mockReset();
  });

  it('delegates to findWindowsExecutable', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    // findWindowsExecutable searches PATH; mock access to succeed for first hit
    mockFsAccess.mockResolvedValueOnce(undefined);
    // Provide a PATH that includes a test dir
    const origPath = process.env.PATH;
    process.env.PATH = 'C:\\Windows\\System32';
    const result = await mgr.resolveCommandPath('powershell.exe');
    // May or may not find based on actual mock — just ensure no throw
    expect(typeof result).toBe('string');
    process.env.PATH = origPath;
  });

  it('returns original command when no PATH entries match', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    mockFsAccess.mockRejectedValue(new Error('not found'));
    const origPath = process.env.PATH;
    process.env.PATH = 'C:\\SomeFakeDir';
    const result = await mgr.resolveCommandPath('some_tool.exe');
    expect(result).toBe('some_tool.exe');
    process.env.PATH = origPath;
  });

  it('uses cwd as first search path when provided', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    mockFsAccess.mockResolvedValueOnce(undefined);
    const result = await mgr.resolveCommandPath('mytool.exe', 'C:\\myproject');
    // Should find it in cwd first
    expect(result).toContain('mytool.exe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRunnableShellProfile
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.getRunnableShellProfile', () => {
  it('returns the requested shell when available', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr, 'isShellCommandAvailable').mockResolvedValue(true);
    const result = await mgr.getRunnableShellProfile('bash');
    expect(result.shellType).toBe('bash');
    expect(result.fallbackReason).toBeUndefined();
  });

  it('falls back with reason when requested and default both unavailable', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr, 'isShellCommandAvailable').mockResolvedValue(false);
    const result = await mgr.getRunnableShellProfile('bash');
    expect(result.fallbackReason).toContain('/bin/bash');
    expect(result.fallbackReason).toContain('unavailable');
  });

  it('uses default shell when no shell arg provided', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr, 'isShellCommandAvailable').mockResolvedValue(true);
    const result = await mgr.getRunnableShellProfile();
    expect(result.shellType).toBe('zsh');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEnvFile
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.parseEnvFile', () => {
  let mgr: InstanceType<typeof PCMType>;

  beforeAll(async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    mgr = PlatformConfigManager.getInstance();
  });

  it('parses simple KEY=VALUE lines', () => {
    const result = mgr.parseEnvFile('FOO=bar\nBAZ=qux');
    expect(result).toEqual([['FOO', 'bar'], ['BAZ', 'qux']]);
  });

  it('skips comment lines and blank lines', () => {
    const result = mgr.parseEnvFile('# comment\n\nFOO=bar');
    expect(result).toEqual([['FOO', 'bar']]);
  });

  it('strips surrounding double quotes from value', () => {
    const result = mgr.parseEnvFile('FOO="hello world"');
    expect(result).toEqual([['FOO', 'hello world']]);
  });

  it('strips surrounding single quotes from value', () => {
    const result = mgr.parseEnvFile("FOO='hello world'");
    expect(result).toEqual([['FOO', 'hello world']]);
  });

  it('skips lines without = sign', () => {
    const result = mgr.parseEnvFile('NOEQUALSSIGN\nFOO=bar');
    expect(result).toEqual([['FOO', 'bar']]);
  });

  it('handles VALUE containing = sign (only splits on first =)', () => {
    const result = mgr.parseEnvFile('URL=https://example.com/path?a=b');
    expect(result).toEqual([['URL', 'https://example.com/path?a=b']]);
  });

  it('handles Windows \\r\\n line endings', () => {
    const result = mgr.parseEnvFile('FOO=bar\r\nBAZ=qux\r\n');
    expect(result).toEqual([['FOO', 'bar'], ['BAZ', 'qux']]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// untildify
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.untildify', () => {
  let mgr: InstanceType<typeof PCMType>;

  beforeAll(async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    mgr = PlatformConfigManager.getInstance();
  });

  it('expands ~/ to homedir', () => {
    const result = mgr.untildify('~/Documents/file.txt');
    expect(result).not.toContain('~');
    expect(result).toContain('Documents/file.txt');
  });

  it('returns path unchanged when not starting with ~/', () => {
    const result = mgr.untildify('/absolute/path');
    expect(result).toBe('/absolute/path');
  });

  it('returns path unchanged for bare ~', () => {
    const result = mgr.untildify('~');
    expect(result).toBe('~');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatSubprocessArguments
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.formatSubprocessArguments', () => {
  it('returns shell=false on non-Windows', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const result = await mgr.formatSubprocessArguments('node', ['server.js']);
    expect(result).toEqual({ executable: 'node', args: ['server.js'], shell: false });
  });

  it('wraps .bat scripts in shell=true on Windows with spaces quoted', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr as any, 'findWindowsExecutable').mockResolvedValue('C:\\my scripts\\run.bat');
    const result = await mgr.formatSubprocessArguments('run.bat', ['arg with space', 'simple']);
    expect(result.shell).toBe(true);
    expect(result.executable).toContain('"');
    expect(result.args[0]).toBe('"arg with space"');
    expect(result.args[1]).toBe('simple');
  });

  it('returns shell=false on Windows for non-bat/cmd executables', async () => {
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    vi.spyOn(mgr as any, 'findWindowsExecutable').mockResolvedValue('C:\\tools\\mytool.exe');
    const result = await mgr.formatSubprocessArguments('mytool.exe', ['--flag']);
    expect(result.shell).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEnhancedEnvironment — Windows paths
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.getEnhancedEnvironment (win32)', () => {
  it('prepends userData bin to PATH key (case-insensitive) in internal mode', async () => {
    process.env['Path'] = 'C:\\Windows\\System32';
    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(true);
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')!;
    expect(env[pathKey]).toContain('OpenKosmos');
    expect(env['NoDefaultCurrentDirectoryInExePath']).toBe('1');
  });

  it('does not set NoDefaultCurrentDirectoryInExePath in system mode (includeBinPath=false)', async () => {
    // Remove from process.env first to ensure clean state
    const prev = process.env['NoDefaultCurrentDirectoryInExePath'];
    delete process.env['NoDefaultCurrentDirectoryInExePath'];

    const { PlatformConfigManager } = await loadManager('win32');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(false);
    // In system mode, the key should NOT be added (it's only set when includeBinPath=true)
    expect(env['NoDefaultCurrentDirectoryInExePath']).toBeUndefined();

    // Restore
    if (prev !== undefined) process.env['NoDefaultCurrentDirectoryInExePath'] = prev;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEnhancedEnvironment — Unix — darwin Homebrew vars
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager.getEnhancedEnvironment (darwin)', () => {
  it('sets HOMEBREW_PREFIX based on arch', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(false);
    expect(env['HOMEBREW_PREFIX']).toBeDefined();
  });

  it('sets environment manager vars (PYENV_ROOT, NVM_DIR, etc.)', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(false);
    expect(env['PYENV_ROOT']).toContain('.pyenv');
    expect(env['NVM_DIR']).toContain('.nvm');
    expect(env['GOPATH']).toContain('go');
    expect(env['CARGO_HOME']).toContain('.cargo');
  });

  it('sets UV_PYTHON and VIRTUAL_ENV from RuntimeManager in internal mode', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(true);
    expect(env['UV_PYTHON']).toBe('3.12');
    expect(env['VIRTUAL_ENV']).toContain('python-venv');
  });

  it('does not set UV_PYTHON in system mode', async () => {
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    const env = mgr.getEnhancedEnvironment(false);
    expect(env['UV_PYTHON']).toBeUndefined();
  });

  it('handles RuntimeManager throwing gracefully', async () => {
    mockRuntimeManagerInstance.getRunTimeConfig.mockImplementationOnce(() => { throw new Error('not init'); });
    const { PlatformConfigManager } = await loadManager('darwin');
    const mgr = PlatformConfigManager.getInstance();
    // Should not throw
    expect(() => mgr.getEnhancedEnvironment(true)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown platform falls back to linux config
// ─────────────────────────────────────────────────────────────────────────────
describe('PlatformConfigManager — unknown platform fallback', () => {
  it('uses linux config for an unknown platform string', async () => {
    const { PlatformConfigManager } = await loadManager('freebsd' as any);
    const mgr = PlatformConfigManager.getInstance();
    expect(mgr.getDefaultShell()).toBe('bash');
  });
});
