/**
 * TerminalInstance — supplemental coverage tests.
 *
 * Covers branches NOT exercised by TerminalInstance.test.ts:
 * - isInternalMode() — RuntimeManager throws
 * - shouldBypassInternalNodeShims() — win32/arm64 conditions, node command detection
 * - prepareEnvironment() — envFile success/failure, null env values, internal mode
 * - prepareCommand() — PowerShell path, -i flag path, args-with-spaces quoting
 * - createShellWrapper() — zsh / bash / other shells, internal mode path override
 * - StreamSplitter.write() — delimiter split and buffering
 * - setupMcpTransportHandlers() — message and stderr events
 * - setupEventHandlers() — error and exit handlers
 * - execute() — timeout path, handleExit fallback, handleError
 * - send() — stateHandler.stopped guard
 * - getInfo() — error field present
 * - stop() — stateHandler branch
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockRuntimeMode, mockWaitForShimsReady } = vi.hoisted(() => ({
  mockRuntimeMode: vi.fn().mockReturnValue({ mode: 'system' }),
  mockWaitForShimsReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getName: vi.fn().mockReturnValue('test-app'),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('../../runtime/RuntimeManager', () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: mockRuntimeMode,
      getBinPath: vi.fn().mockReturnValue('/mock/bin'),
      waitForShimsReady: mockWaitForShimsReady,
    }),
  },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

// PlatformConfigManager — provide a minimal working stub
vi.mock('../PlatformConfigManager', () => ({
  PlatformConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunnableShellProfile: vi.fn().mockResolvedValue({
        shellType: 'bash',
        profile: { command: '/bin/bash', args: ['-c'] },
        fallbackReason: undefined,
      }),
      getShellProfile: vi.fn().mockReturnValue({ command: '/bin/bash', args: ['-c'] }),
      getDefaultShell: vi.fn().mockReturnValue('bash'),
      getEnhancedEnvironment: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
      parseEnvFile: vi.fn().mockReturnValue([['KEY', 'val']]),
      untildify: vi.fn((p: string) => p),
    }),
  },
}));

// fs/promises — mock for envFile loading
const { mockReadFile, mockStat } = vi.hoisted(() => ({
  mockReadFile: vi.fn().mockResolvedValue('KEY=value\nSECRET=abc'),
  mockStat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  stat: (...args: any[]) => mockStat(...args),
}));

// child_process spawn mock
const { mockSpawn, mockExec } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  exec: (...args: any[]) => mockExec(...args),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TerminalInstance } from '../TerminalInstance';
import type { TerminalConfig } from '../types';
import { RuntimeManager } from '../../runtime/RuntimeManager';
import { PlatformConfigManager } from '../PlatformConfigManager';

// ─── Helpers ────────────────────────────────────────────────────────────────

class MockChildProcess extends EventEmitter {
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = { end: vi.fn(), write: vi.fn() };
  public pid = 9999;
  public kill = vi.fn((_signal?: string) => { this.killed = true; return true; });
}

class TestableTI extends TerminalInstance {
  attachProc(proc: MockChildProcess, state: 'running' | 'idle' | 'stopping' | 'stopped' = 'running') {
    (this as any)._process = proc;
    (this as any)._state = state;
  }
  attachStateHandler(sh: any) {
    (this as any).stateHandler = sh;
  }
  callIsInternalMode() { return (this as any).isInternalMode(); }
  callShouldBypass() { return (this as any).shouldBypassInternalNodeShims(); }
  callPrepareEnv() { return (this as any).prepareEnvironment(); }
  callPrepareCmd(prefix = '', profileOverride?: any, typeOverride?: string) {
    return (this as any).prepareCommand(prefix, profileOverride, typeOverride);
  }
  callCreateWrapper(cmd: string, shellType?: string) {
    return (this as any).createShellWrapper(cmd, shellType);
  }
  callSetupMcpHandlers() { return (this as any).setupMcpTransportHandlers(); }
  callSetupEventHandlers() { return (this as any).setupEventHandlers(); }
  setError(msg: string) { (this as any).error = msg; }
}

function cfg(overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return { command: 'node', args: [], cwd: '/tmp', type: 'command', ...overrides } as TerminalConfig;
}

function mcpCfg(overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return { command: 'node', args: [], cwd: '/tmp', type: 'mcp_transport', persistent: true, ...overrides } as TerminalConfig;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

afterEach(() => vi.clearAllMocks());

// ── isInternalMode ──────────────────────────────────────────────────────────

describe('isInternalMode()', () => {
  it('returns true when RuntimeManager returns internal mode', () => {
    mockRuntimeMode.mockReturnValueOnce({ mode: 'internal' });
    const ti = new TestableTI(cfg());
    expect(ti.callIsInternalMode()).toBe(true);
  });

  it('returns false when RuntimeManager throws', () => {
    vi.mocked(RuntimeManager.getInstance).mockImplementationOnce(() => { throw new Error('not ready'); });
    const ti = new TestableTI(cfg());
    expect(ti.callIsInternalMode()).toBe(false);
  });
});

// ── shouldBypassInternalNodeShims ──────────────────────────────────────────

describe('shouldBypassInternalNodeShims()', () => {
  it('returns false when not in internal mode', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'system' });
    const ti = new TestableTI(mcpCfg({ command: 'node' }));
    expect(ti.callShouldBypass()).toBe(false);
  });

  it('returns false when internal but not win32/arm64', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const ti = new TestableTI(mcpCfg({ command: 'node' }));
    expect(ti.callShouldBypass()).toBe(false);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('returns false when win32/arm64 but type is command', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    const ti = new TestableTI(cfg({ command: 'node' })); // type=command
    expect(ti.callShouldBypass()).toBe(false);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
  });

  it('returns true when win32/arm64, mcp_transport, command is node', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    const ti = new TestableTI(mcpCfg({ command: 'node' }));
    expect(ti.callShouldBypass()).toBe(true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
  });

  it('returns true when command is npx on win32/arm64', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    const ti = new TestableTI(mcpCfg({ command: 'npx' }));
    expect(ti.callShouldBypass()).toBe(true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
  });

  it('returns true when cmd.exe /c node on win32/arm64', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    const ti = new TestableTI(mcpCfg({ command: 'cmd', args: ['/c', 'node', 'server.js'] }));
    expect(ti.callShouldBypass()).toBe(true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
  });
});

// ── prepareEnvironment ──────────────────────────────────────────────────────

describe('prepareEnvironment()', () => {
  it('loads and applies envFile successfully', async () => {
    mockStat.mockResolvedValueOnce({}); // cwd stat
    vi.mocked(PlatformConfigManager.getInstance().parseEnvFile).mockReturnValueOnce([['LOADED_KEY', 'loaded_val']]);

    const ti = new TestableTI(cfg({ envFile: '/tmp/test.env' }));
    const env = await ti.callPrepareEnv();
    expect(env).toMatchObject({ LOADED_KEY: 'loaded_val' });
  });

  it('throws when envFile cannot be read', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('permission denied'));
    const ti = new TestableTI(cfg({ envFile: '/bad/path.env' }));
    await expect(ti.callPrepareEnv()).rejects.toThrow("Failed to read envFile");
  });

  it('deletes keys when env value is null', async () => {
    vi.mocked(PlatformConfigManager.getInstance().getEnhancedEnvironment).mockReturnValueOnce({ REMOVE_ME: 'old', OTHER: 'keep' });

    const ti = new TestableTI(cfg({ env: { REMOVE_ME: null } }));
    const env = await ti.callPrepareEnv();
    expect(env.REMOVE_ME).toBeUndefined();
    expect(env.OTHER).toBe('keep');
  });

  it('skips undefined env values', async () => {
    vi.mocked(PlatformConfigManager.getInstance().getEnhancedEnvironment).mockReturnValueOnce({ EXISTING: 'yes' });

    const ti = new TestableTI(cfg({ env: { UNDEFINED_KEY: undefined } }));
    const env = await ti.callPrepareEnv();
    expect(env.UNDEFINED_KEY).toBeUndefined();
  });

  it('waits for shims when internal mode + mcp_transport', async () => {
    mockRuntimeMode.mockReturnValue({ mode: 'internal' });
    const ti = new TestableTI(mcpCfg());
    await ti.callPrepareEnv();
    expect(mockWaitForShimsReady).toHaveBeenCalled();
    mockRuntimeMode.mockReturnValue({ mode: 'system' });
  });
});

// ── prepareCommand ──────────────────────────────────────────────────────────

describe('prepareCommand()', () => {
  it('uses -Command for PowerShell profile', async () => {
    const psProfile = { command: 'powershell.exe', args: [] };
    const ti = new TestableTI(cfg({ command: 'Get-ChildItem' }));
    const result = await ti.callPrepareCmd('', psProfile);
    expect(result.executable).toBe('powershell.exe');
    expect(result.args).toContain('-Command');
    expect(result.shell).toBe(false);
  });

  it('uses -Command for pwsh profile', async () => {
    const pwshProfile = { command: '/usr/local/bin/pwsh', args: [] };
    const ti = new TestableTI(cfg({ command: 'ls' }));
    const result = await ti.callPrepareCmd('', pwshProfile);
    expect(result.args).toContain('-Command');
  });

  it('removes -i and uses wrapper script when -i flag present', async () => {
    const bashProfile = { command: '/bin/bash', args: ['-i'] };
    const ti = new TestableTI(cfg({ command: 'echo hello', shell: 'bash' }));
    const result = await ti.callPrepareCmd('', bashProfile, 'bash');
    expect(result.args).not.toContain('-i');
    expect(result.args).toContain('-c');
    expect(result.shell).toBe(false);
  });

  it('quotes args with spaces', async () => {
    const bashProfile = { command: '/bin/bash', args: ['-c'] };
    const ti = new TestableTI(cfg({ command: 'node', args: ['path with spaces/file.js', '--flag'] }));
    const result = await ti.callPrepareCmd('', bashProfile);
    const fullCmd = result.args.join(' ');
    expect(fullCmd).toContain('"path with spaces/file.js"');
  });

  it('does not double-quote args that are already quoted', async () => {
    const bashProfile = { command: '/bin/bash', args: ['-c'] };
    const ti = new TestableTI(cfg({ command: 'node', args: ['"already quoted"'] }));
    const result = await ti.callPrepareCmd('', bashProfile);
    const fullCmd = result.args.join(' ');
    expect(fullCmd).not.toContain('""already quoted""');
  });

  it('prepends prefix to full command', async () => {
    const bashProfile = { command: '/bin/bash', args: ['-c'] };
    const ti = new TestableTI(cfg({ command: 'ls' }));
    const result = await ti.callPrepareCmd('cd /tmp && ', bashProfile);
    const cmdArg = result.args[result.args.length - 1];
    expect(cmdArg).toContain('cd /tmp && ');
  });

  it('uses & call operator for quoted executable on windows+powershell', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const psProfile = { command: 'powershell.exe', args: [] };
    const ti = new TestableTI(cfg({ command: '"C:\\Program Files\\app.exe"', args: [] }));
    const result = await ti.callPrepareCmd('', psProfile);
    const cmdArg = result.args[result.args.length - 1];
    expect(cmdArg).toMatch(/^& /);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

// ── createShellWrapper ──────────────────────────────────────────────────────

describe('createShellWrapper()', () => {
  it('generates zsh wrapper with zshenv/zprofile/zshrc sources', () => {
    const ti = new TestableTI(cfg({ shell: 'zsh' }));
    const wrapper = ti.callCreateWrapper('echo hello', 'zsh');
    expect(wrapper).toContain('.zshenv');
    expect(wrapper).toContain('.zprofile');
    expect(wrapper).toContain('.zshrc');
    expect(wrapper).toContain('echo hello');
  });

  it('generates bash wrapper with bash_profile/bashrc sources', () => {
    const ti = new TestableTI(cfg({ shell: 'bash' }));
    const wrapper = ti.callCreateWrapper('npm test', 'bash');
    expect(wrapper).toContain('.bash_profile');
    expect(wrapper).toContain('.bashrc');
    expect(wrapper).toContain('npm test');
  });

  it('generates generic wrapper for unknown shell', () => {
    const ti = new TestableTI(cfg({ shell: 'sh' }));
    const wrapper = ti.callCreateWrapper('python main.py', 'sh');
    expect(wrapper).toContain('.profile');
    expect(wrapper).toContain('python main.py');
  });

  it('injects PATH override in internal mode', () => {
    mockRuntimeMode.mockReturnValueOnce({ mode: 'internal' });
    const ti = new TestableTI(cfg({ shell: 'zsh' }));
    const wrapper = ti.callCreateWrapper('run', 'zsh');
    expect(wrapper).toContain('export PATH=');
    mockRuntimeMode.mockReturnValue({ mode: 'system' });
  });

  it('does not inject PATH override in system mode', () => {
    mockRuntimeMode.mockReturnValue({ mode: 'system' });
    const ti = new TestableTI(cfg({ shell: 'zsh' }));
    const wrapper = ti.callCreateWrapper('run', 'zsh');
    // pathOverride is empty string when system mode, so it won't contain the export
    expect(wrapper).not.toContain('/mock/userData/bin');
  });
});

// ── StreamSplitter (via setupMcpTransportHandlers) ─────────────────────────

describe('setupMcpTransportHandlers()', () => {
  it('emits message events for newline-delimited stdout data', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupMcpHandlers();

    const messages: string[] = [];
    ti.on('message', (m: string) => messages.push(m));

    // Simulate two JSON-RPC messages split across chunks
    proc.stdout.emit('data', Buffer.from('{"id":1}\n{"id":'));
    proc.stdout.emit('data', Buffer.from('2}\n'));

    expect(messages).toContain('{"id":1}');
    expect(messages).toContain('{"id":2}');
  });

  it('ignores empty lines in stdout', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupMcpHandlers();

    const messages: string[] = [];
    ti.on('message', (m: string) => messages.push(m));

    proc.stdout.emit('data', Buffer.from('\n\n{"id":3}\n'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('{"id":3}');
  });

  it('emits stderr events for stderr data', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupMcpHandlers();

    const stderrLines: string[] = [];
    ti.on('stderr', (m: string) => stderrLines.push(m));

    proc.stderr.emit('data', Buffer.from('Error: something failed\n'));
    expect(stderrLines).toContain('Error: something failed');
  });

  it('ignores empty stderr lines', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupMcpHandlers();

    const stderrLines: string[] = [];
    ti.on('stderr', (m: string) => stderrLines.push(m));

    proc.stderr.emit('data', Buffer.from('\n\n'));
    expect(stderrLines).toHaveLength(0);
  });
});

// ── setupEventHandlers — error and exit ────────────────────────────────────

describe('setupEventHandlers()', () => {
  it('emits error and sets state to error on process error', () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupEventHandlers();

    const errors: Error[] = [];
    ti.on('error', (e: Error) => errors.push(e));

    proc.emit('error', new Error('spawn failed'));
    expect(ti.state).toBe('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('spawn failed');
  });

  it('sets state to stopped when process exits with code 0', () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupEventHandlers();

    proc.emit('exit', 0, null);
    expect(ti.state).toBe('stopped');
  });

  it('sets state to error when process exits with non-zero code', () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);
    ti.callSetupEventHandlers();

    proc.emit('exit', 1, null);
    expect(ti.state).toBe('error');
  });

  it('sets state to stopped when state is stopping (expected exit)', () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc, 'stopping');
    ti.callSetupEventHandlers();

    proc.emit('exit', 1, 'SIGTERM'); // non-zero but expected
    expect(ti.state).toBe('stopped');
  });
});

// ── execute() — timeout and fallback ───────────────────────────────────────

describe('execute() — timeout and error', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with timedOut=true after timeout', async () => {
    const ti = new TestableTI(cfg({ timeoutMs: 100 }));
    const proc = new MockChildProcess();
    ti.attachProc(proc);

    const promise = ti.execute();

    // Advance time to trigger timeout
    vi.advanceTimersByTime(200);
    // After SIGTERM, simulate process close
    proc.emit('close', null);

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects with error when process emits error event', async () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);

    const promise = ti.execute();
    proc.emit('error', new Error('spawn error'));

    await expect(promise).rejects.toThrow('spawn error');
  });

  it('handleExit fallback resolves after 50ms if close not received', async () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);

    const promise = ti.execute();
    proc.emit('exit', 0, null);

    // Advance timer to trigger the 50ms fallback
    vi.advanceTimersByTime(60);

    const result = await promise;
    expect(result.exitCode).toBe(0);
  });

  it('ignores duplicate handleClose after handleExit resolved', async () => {
    const ti = new TestableTI(cfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc);

    const promise = ti.execute();
    proc.emit('exit', 0, null);
    vi.advanceTimersByTime(60);
    const result1 = await promise;

    // Second close should be a no-op (settled guard)
    proc.emit('close', 0);
    expect(result1.exitCode).toBe(0);
  });
});

// ── send() — stateHandler.stopped guard ────────────────────────────────────

describe('send() — stateHandler.stopped guard', () => {
  it('throws when stateHandler.stopped is true', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc, 'running');
    // Inject a stopped stateHandler
    ti.attachStateHandler({ stopped: true, write: vi.fn(), stop: vi.fn(), dispose: vi.fn() });
    expect(() => ti.send('message')).toThrow('Process has been stopped');
  });

  it('throws when stateHandler is null', () => {
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc, 'running');
    ti.attachStateHandler(null);
    expect(() => ti.send('message')).toThrow('State handler not available');
  });

  it('writes to stateHandler when not stopped', () => {
    const writeFn = vi.fn();
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc, 'running');
    ti.attachStateHandler({ stopped: false, write: writeFn, stop: vi.fn(), dispose: vi.fn() });
    ti.send('hello');
    expect(writeFn).toHaveBeenCalledWith('hello');
  });
});

// ── getInfo() with error field ──────────────────────────────────────────────

describe('getInfo() with error field', () => {
  it('includes error in info when error is set', () => {
    const ti = new TestableTI(cfg({ instanceId: 'err-id' }));
    ti.setError('Something went wrong');
    const info = ti.getInfo();
    expect(info.error).toBe('Something went wrong');
  });
});

// ── stop() with stateHandler ────────────────────────────────────────────────

describe('stop() with stateHandler', () => {
  it('calls stateHandler.stop() when stateHandler is present', async () => {
    const stopFn = vi.fn();
    const ti = new TestableTI(mcpCfg());
    const proc = new MockChildProcess();
    ti.attachProc(proc, 'running');
    ti.attachStateHandler({ stopped: false, write: vi.fn(), stop: stopFn, dispose: vi.fn() });

    // Process is "killed" so wait resolves immediately
    proc.killed = true;
    await ti.stop();
    expect(stopFn).toHaveBeenCalled();
  });
});
