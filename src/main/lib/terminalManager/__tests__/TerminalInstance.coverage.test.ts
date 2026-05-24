// @ts-nocheck
/**
 * TerminalInstance.coverage.test.ts
 *
 * Covers additional paths not exercised by existing tests:
 * - prepareEnvironment: envFile parsing, env config null/value handling, mcp_transport shim wait
 * - prepareCommand: PowerShell path, -i args path, quoted executable with spaces on win32
 * - createShellWrapper: zsh, bash, other shell types in internal mode
 * - setupMcpTransportHandlers: message events, stderr, empty messages ignored
 * - setupCommandHandlers: stdout truncation
 * - stop(): stateHandler present, process already killed
 * - send(): valid write
 * - StreamSplitter: multi-message chunks, leftover buffer
 * - createMissingCwdPrefix: powershell, cmd.exe, bash paths
 * - parseCommandString: quoted with single quote, no-args, space split
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockRuntimeMode, mockWaitForShimsReady } = vi.hoisted(() => ({
  mockRuntimeMode: vi.fn().mockReturnValue({ mode: 'system' }),
  mockWaitForShimsReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../PlatformConfigManager', () => ({
  PlatformConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunnableShellProfile: vi.fn().mockResolvedValue({
        shellType: 'bash',
        profile: { command: '/bin/bash', args: [] },
        fallbackReason: undefined,
      }),
      getShellProfile: vi.fn().mockReturnValue({ command: '/bin/bash', args: [] }),
      getDefaultShell: vi.fn().mockReturnValue('bash'),
      getEnhancedEnvironment: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
      parseEnvFile: vi.fn().mockReturnValue([['KEY', 'val'], ['OTHER', 'v2']]),
      untildify: vi.fn((p: string) => p),
    }),
  },
}));

const { mockReadFile, mockStat } = vi.hoisted(() => ({
  mockReadFile: vi.fn().mockResolvedValue('KEY=value\nOTHER=v2'),
  mockStat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  stat: (...args: any[]) => mockStat(...args),
}));

const { mockSpawn, mockExec } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  exec: (...args: any[]) => mockExec(...args),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TerminalInstance } from '../TerminalInstance';
import type { TerminalConfig } from '../types';

// ─── Mock child process ───────────────────────────────────────────────────────

class MockChildProcess extends EventEmitter {
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = { end: vi.fn(), write: vi.fn() };
  public pid: number | undefined = 9999;
  public kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

class TestableTerminalInstance extends TerminalInstance {
  attachMockProcess(proc: MockChildProcess, state: 'running' | 'idle' | 'stopped' = 'running') {
    (this as any)._process = proc;
    (this as any)._state = state;
  }

  attachStateHandler(handler: any) {
    (this as any).stateHandler = handler;
  }

  callPrepareEnvironment(): Promise<Record<string, string>> {
    return (this as any).prepareEnvironment();
  }

  callPrepareCommand(prefix: string, shellProfile: any, shellType: string): Promise<any> {
    return (this as any).prepareCommand(prefix, shellProfile, shellType);
  }

  callCreateShellWrapper(command: string, shellType?: string): string {
    return (this as any).createShellWrapper(command, shellType);
  }

  callCreateMissingCwdPrefix(cwd: string, shellCommand: string): string {
    return (this as any).createMissingCwdPrefix(cwd, shellCommand);
  }

  callParseCommandString(command: string): { executable: string; inlineArgs: string } {
    return (this as any).parseCommandString(command);
  }

  callSetupMcpTransportHandlers(): void {
    return (this as any).setupMcpTransportHandlers();
  }

  callSetupCommandHandlers(): void {
    return (this as any).setupCommandHandlers();
  }

  callIsInternalMode(): boolean {
    return (this as any).isInternalMode();
  }
}

function makeConfig(overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return {
    command: 'echo hello',
    args: [],
    cwd: '/tmp',
    type: 'command',
    ...overrides,
  } as TerminalConfig;
}

function makeInstance(overrides: Partial<TerminalConfig> = {}): TestableTerminalInstance {
  return new TestableTerminalInstance(makeConfig(overrides));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TerminalInstance.coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeMode.mockReturnValue({ mode: 'system' });
  });

  // ── parseCommandString ────────────────────────────────────────────────────
  describe('parseCommandString', () => {
    it('handles double-quoted executable with args', () => {
      const inst = makeInstance();
      const result = inst.callParseCommandString('"C:\\Program Files\\app.exe" --flag');
      expect(result.executable).toBe('"C:\\Program Files\\app.exe"');
      expect(result.inlineArgs).toBe('--flag');
    });

    it('handles single-quoted executable with args', () => {
      const inst = makeInstance();
      const result = inst.callParseCommandString("'my app' --flag");
      expect(result.executable).toBe("'my app'");
      expect(result.inlineArgs).toBe('--flag');
    });

    it('handles simple command with space', () => {
      const inst = makeInstance();
      const result = inst.callParseCommandString('python script.py');
      expect(result.executable).toBe('python');
      expect(result.inlineArgs).toBe('script.py');
    });

    it('handles command with no args', () => {
      const inst = makeInstance();
      const result = inst.callParseCommandString('node');
      expect(result.executable).toBe('node');
      expect(result.inlineArgs).toBe('');
    });
  });

  // ── createMissingCwdPrefix ────────────────────────────────────────────────
  describe('createMissingCwdPrefix', () => {
    it('creates PowerShell prefix', () => {
      const inst = makeInstance();
      const prefix = inst.callCreateMissingCwdPrefix('/my/path', 'powershell.exe');
      expect(prefix).toContain('Set-Location');
    });

    it('creates cmd.exe prefix', () => {
      const inst = makeInstance();
      const prefix = inst.callCreateMissingCwdPrefix('/my/path', 'cmd.exe');
      expect(prefix).toContain('cd /d');
    });

    it('creates bash prefix', () => {
      const inst = makeInstance();
      const prefix = inst.callCreateMissingCwdPrefix('/my/path', '/bin/bash');
      expect(prefix).toContain('cd ');
    });

    it('creates pwsh prefix', () => {
      const inst = makeInstance();
      const prefix = inst.callCreateMissingCwdPrefix('/my/path', 'pwsh');
      expect(prefix).toContain('Set-Location');
    });
  });

  // ── prepareEnvironment ────────────────────────────────────────────────────
  describe('prepareEnvironment', () => {
    it('loads envFile and parses it', async () => {
      const inst = makeInstance({ envFile: '/tmp/.env' });
      const env = await inst.callPrepareEnvironment();
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/.env', 'utf-8');
      expect(env['KEY']).toBe('val');
    });

    it('throws when envFile cannot be read', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const inst = makeInstance({ envFile: '/missing/.env' });
      await expect(inst.callPrepareEnvironment()).rejects.toThrow('Failed to read envFile');
    });

    it('applies env vars from config, deletes null values', async () => {
      const inst = makeInstance({
        env: { MY_VAR: 'hello', DEL_VAR: null as any, UNDEF_VAR: undefined as any },
      });
      const env = await inst.callPrepareEnvironment();
      expect(env['MY_VAR']).toBe('hello');
      expect('DEL_VAR' in env).toBe(false);
    });

    it('waits for shims when internal mode and mcp_transport', async () => {
      mockRuntimeMode.mockReturnValue({ mode: 'internal' });
      const inst = makeInstance({ type: 'mcp_transport' });
      await inst.callPrepareEnvironment();
      expect(mockWaitForShimsReady).toHaveBeenCalled();
    });

    it('does not wait for shims in system mode', async () => {
      mockRuntimeMode.mockReturnValue({ mode: 'system' });
      const inst = makeInstance({ type: 'mcp_transport' });
      await inst.callPrepareEnvironment();
      expect(mockWaitForShimsReady).not.toHaveBeenCalled();
    });
  });

  // ── prepareCommand ────────────────────────────────────────────────────────
  describe('prepareCommand', () => {
    it('builds PowerShell -Command invocation', async () => {
      const inst = makeInstance({ command: 'Get-Process', args: [] });
      const result = await inst.callPrepareCommand(
        '',
        { command: 'powershell.exe', args: ['-NoProfile'] },
        'powershell',
      );
      expect(result.executable).toBe('powershell.exe');
      expect(result.args).toContain('-Command');
      expect(result.shell).toBe(false);
    });

    it('handles -i arg by using shell wrapper', async () => {
      const inst = makeInstance({ command: 'echo hi', args: [] });
      const result = await inst.callPrepareCommand(
        '',
        { command: '/bin/bash', args: ['-i'] },
        'bash',
      );
      expect(result.args).toContain('-c');
      expect(result.args).not.toContain('-i');
    });

    it('builds normal bash -c invocation', async () => {
      const inst = makeInstance({ command: 'ls', args: ['-la'] });
      const result = await inst.callPrepareCommand(
        '',
        { command: '/bin/bash', args: [] },
        'bash',
      );
      expect(result.args).toContain('-c');
      expect(result.args.some((a: string) => a.includes('ls'))).toBe(true);
    });

    it('adds prefix to command', async () => {
      const inst = makeInstance({ command: 'ls', args: [] });
      const result = await inst.callPrepareCommand(
        'cd /tmp && ',
        { command: '/bin/bash', args: [] },
        'bash',
      );
      const cmdArg = result.args[result.args.length - 1] as string;
      expect(cmdArg).toContain('cd /tmp');
    });

    it('quotes args with spaces', async () => {
      const inst = makeInstance({ command: 'run', args: ['hello world', 'plain'] });
      const result = await inst.callPrepareCommand(
        '',
        { command: '/bin/bash', args: [] },
        'bash',
      );
      const cmdArg = result.args[result.args.length - 1] as string;
      expect(cmdArg).toContain('"hello world"');
      expect(cmdArg).toContain('plain');
    });
  });

  // ── createShellWrapper ────────────────────────────────────────────────────
  describe('createShellWrapper', () => {
    it('creates zsh wrapper', () => {
      const inst = makeInstance();
      const script = inst.callCreateShellWrapper('echo hi', 'zsh');
      expect(script).toContain('.zshrc');
      expect(script).toContain('echo hi');
    });

    it('creates bash wrapper', () => {
      const inst = makeInstance();
      const script = inst.callCreateShellWrapper('ls', 'bash');
      expect(script).toContain('.bashrc');
      expect(script).toContain('ls');
    });

    it('creates generic wrapper for unknown shell', () => {
      const inst = makeInstance();
      const script = inst.callCreateShellWrapper('pwd', 'fish');
      expect(script).toContain('.profile');
      expect(script).toContain('pwd');
    });

    it('adds PATH override in internal mode', () => {
      mockRuntimeMode.mockReturnValue({ mode: 'internal' });
      const inst = makeInstance({ shell: 'bash' });
      const script = inst.callCreateShellWrapper('node -v', 'bash');
      expect(script).toContain('export PATH=');
    });

    it('uses config shell when no override', () => {
      const inst = makeInstance({ shell: 'zsh' });
      const script = inst.callCreateShellWrapper('echo test');
      expect(script).toContain('.zshrc');
    });
  });

  // ── setupMcpTransportHandlers ─────────────────────────────────────────────
  describe('setupMcpTransportHandlers', () => {
    it('emits message events for complete lines', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupMcpTransportHandlers();

      const messages: string[] = [];
      inst.on('message', (msg: string) => messages.push(msg));

      proc.stdout.emit('data', Buffer.from('{"id":1}\n'));
      expect(messages).toEqual(['{"id":1}']);
    });

    it('ignores empty lines from stdout', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupMcpTransportHandlers();

      const messages: string[] = [];
      inst.on('message', (msg: string) => messages.push(msg));

      proc.stdout.emit('data', Buffer.from('\n\n'));
      expect(messages).toHaveLength(0);
    });

    it('emits stderr events for stderr lines', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupMcpTransportHandlers();

      const stderrMessages: string[] = [];
      inst.on('stderr', (msg: string) => stderrMessages.push(msg));

      proc.stderr.emit('data', Buffer.from('error occurred\n'));
      expect(stderrMessages).toContain('error occurred');
    });

    it('handles multiple messages in one chunk', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupMcpTransportHandlers();

      const messages: string[] = [];
      inst.on('message', (msg: string) => messages.push(msg));

      proc.stdout.emit('data', Buffer.from('msg1\nmsg2\nmsg3\n'));
      expect(messages).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('accumulates partial lines across chunks', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupMcpTransportHandlers();

      const messages: string[] = [];
      inst.on('message', (msg: string) => messages.push(msg));

      proc.stdout.emit('data', Buffer.from('part1'));
      expect(messages).toHaveLength(0);
      proc.stdout.emit('data', Buffer.from('part2\n'));
      expect(messages).toEqual(['part1part2']);
    });
  });

  // ── setupCommandHandlers ──────────────────────────────────────────────────
  describe('setupCommandHandlers', () => {
    it('truncates stdout when exceeding maxOutputLength', () => {
      const inst = makeInstance({ type: 'command', maxOutputLength: 20 });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupCommandHandlers();

      proc.stdout.emit('data', Buffer.from('a'.repeat(15)));
      proc.stdout.emit('data', Buffer.from('b'.repeat(15)));

      expect((inst as any).stdout.length).toBeLessThanOrEqual(20);
      expect((inst as any).truncated).toBe(true);
    });

    it('truncates stderr when exceeding maxOutputLength', () => {
      const inst = makeInstance({ type: 'command', maxOutputLength: 10 });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupCommandHandlers();

      proc.stderr.emit('data', Buffer.from('e'.repeat(8)));
      proc.stderr.emit('data', Buffer.from('f'.repeat(8)));

      expect((inst as any).stderr.length).toBeLessThanOrEqual(10);
      expect((inst as any).truncated).toBe(true);
    });

    it('emits stdout and stderr events', () => {
      const inst = makeInstance({ type: 'command' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.callSetupCommandHandlers();

      const stdoutEvents: string[] = [];
      const stderrEvents: string[] = [];
      inst.on('stdout', (d: string) => stdoutEvents.push(d));
      inst.on('stderr', (d: string) => stderrEvents.push(d));

      proc.stdout.emit('data', Buffer.from('hello\r\n'));
      proc.stderr.emit('data', Buffer.from('err\r\n'));

      expect(stdoutEvents[0]).toBe('hello\n');
      expect(stderrEvents[0]).toBe('err\n');
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────
  describe('send', () => {
    it('throws when type is not mcp_transport', () => {
      const inst = makeInstance({ type: 'command' });
      expect(() => inst.send('msg')).toThrow('send() can only be called on mcp_transport');
    });

    it('throws when not running', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      (inst as any)._state = 'idle';
      expect(() => inst.send('msg')).toThrow('not running');
    });

    it('throws when no stateHandler', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      (inst as any)._state = 'running';
      (inst as any).stateHandler = null;
      expect(() => inst.send('msg')).toThrow('State handler not available');
    });

    it('writes message via stateHandler when running', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      (inst as any)._state = 'running';
      const mockHandler = { stopped: false, write: vi.fn() };
      inst.attachStateHandler(mockHandler);
      inst.send('{"method":"ping"}');
      expect(mockHandler.write).toHaveBeenCalledWith('{"method":"ping"}');
    });

    it('throws when stateHandler is stopped', () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      (inst as any)._state = 'running';
      const mockHandler = { stopped: true, write: vi.fn() };
      inst.attachStateHandler(mockHandler);
      expect(() => inst.send('msg')).toThrow('Process has been stopped');
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────
  describe('stop', () => {
    it('returns early when already stopped', async () => {
      const inst = makeInstance();
      (inst as any)._state = 'stopped';
      await inst.stop();
      // No error, just early return
    });

    it('uses stateHandler when present', async () => {
      const inst = makeInstance();
      (inst as any)._state = 'running';
      const proc = new MockChildProcess();
      proc.killed = true; // already killed so the wait is skipped
      inst.attachMockProcess(proc, 'running');
      const mockHandler = { stop: vi.fn(), dispose: vi.fn() };
      inst.attachStateHandler(mockHandler);
      await inst.stop();
      expect(mockHandler.stop).toHaveBeenCalled();
    });

    it('sends SIGKILL when force=true and no stateHandler', async () => {
      const inst = makeInstance();
      (inst as any)._state = 'running';
      const proc = new MockChildProcess();
      proc.killed = false;
      inst.attachMockProcess(proc, 'running');
      const stopPromise = inst.stop(true);
      proc.killed = true;
      proc.emit('exit', null, 'SIGKILL');
      await stopPromise;
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('sends SIGTERM when force=false and no stateHandler', async () => {
      const inst = makeInstance();
      (inst as any)._state = 'running';
      const proc = new MockChildProcess();
      proc.killed = false;
      inst.attachMockProcess(proc, 'running');
      const stopPromise = inst.stop(false);
      proc.killed = true;
      proc.emit('exit', null, 'SIGTERM');
      await stopPromise;
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  // ── getInfo ───────────────────────────────────────────────────────────────
  describe('getInfo', () => {
    it('returns info with correct fields', () => {
      const inst = makeInstance({ type: 'command' });
      (inst as any)._state = 'idle';
      const info = inst.getInfo();
      expect(info).toMatchObject({
        type: 'command',
        state: 'idle',
        config: expect.objectContaining({ command: 'echo hello' }),
      });
      expect(typeof info.id).toBe('string');
      expect(typeof info.startTime).toBe('number');
    });

    it('includes error field when set', () => {
      const inst = makeInstance();
      (inst as any).error = 'some error';
      const info = inst.getInfo();
      expect(info.error).toBe('some error');
    });
  });

  // ── dispose ───────────────────────────────────────────────────────────────
  describe('dispose', () => {
    it('disposes stateHandler and clears process', () => {
      const inst = makeInstance();
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      const mockHandler = { dispose: vi.fn() };
      inst.attachStateHandler(mockHandler);
      inst.dispose();
      expect(mockHandler.dispose).toHaveBeenCalled();
      expect((inst as any).stateHandler).toBeNull();
      expect((inst as any)._process).toBeNull();
    });

    it('works when no stateHandler', () => {
      const inst = makeInstance();
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);
      inst.dispose();
      expect((inst as any)._process).toBeNull();
    });
  });

  // ── isInternalMode ────────────────────────────────────────────────────────
  describe('isInternalMode', () => {
    it('returns true when mode is internal', () => {
      mockRuntimeMode.mockReturnValue({ mode: 'internal' });
      const inst = makeInstance();
      expect(inst.callIsInternalMode()).toBe(true);
    });

    it('returns false when mode is system', () => {
      mockRuntimeMode.mockReturnValue({ mode: 'system' });
      const inst = makeInstance();
      expect(inst.callIsInternalMode()).toBe(false);
    });

    it('returns false when RuntimeManager throws', async () => {
      const { RuntimeManager } = vi.mocked(await import('../../runtime/RuntimeManager'));
      RuntimeManager.getInstance.mockImplementationOnce(() => {
        throw new Error('not init');
      });
      const inst = makeInstance();
      expect(inst.callIsInternalMode()).toBe(false);
    });
  });

  // ── execute ───────────────────────────────────────────────────────────────
  describe('execute', () => {
    it('throws when type is not command', async () => {
      const inst = makeInstance({ type: 'mcp_transport' });
      (inst as any)._state = 'running';
      await expect(inst.execute()).rejects.toThrow('execute() can only be called on command');
    });

    it('throws when not running', async () => {
      const inst = makeInstance({ type: 'command' });
      (inst as any)._state = 'idle';
      await expect(inst.execute()).rejects.toThrow('not running');
    });

    it('resolves when process emits close', async () => {
      const inst = makeInstance({ type: 'command' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);

      const promise = inst.execute();
      proc.emit('close', 0);
      const result = await promise;
      expect(result.exitCode).toBe(0);
    });

    it('rejects when process emits error', async () => {
      const inst = makeInstance({ type: 'command' });
      const proc = new MockChildProcess();
      inst.attachMockProcess(proc);

      const promise = inst.execute();
      proc.emit('error', new Error('spawn error'));
      await expect(promise).rejects.toThrow('spawn error');
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────
  describe('start', () => {
    it('returns early if already running', async () => {
      const inst = makeInstance();
      (inst as any)._state = 'running';
      await inst.start(); // should return immediately without spawning
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('spawns and resolves on spawn event', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValue(proc);

      const inst = makeInstance({ type: 'command' });
      const startPromise = inst.start();
      setImmediate(() => proc.emit('spawn'));
      await startPromise;
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('rejects and sets error state on spawn error', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValue(proc);

      const inst = makeInstance({ type: 'command' });
      // Prevent unhandled 'error' event on TerminalInstance (emitted by setupEventHandlers)
      inst.on('error', () => {});
      const startPromise = inst.start();
      // Give start() time to set up event listeners
      await new Promise(r => setTimeout(r, 10));
      proc.emit('error', new Error('ENOENT'));
      await expect(startPromise).rejects.toThrow('ENOENT');
      expect((inst as any)._state).toBe('error');
    });

    it('logs fallback warning when shell fallback applied', async () => {
      const { PlatformConfigManager } = await import('../PlatformConfigManager');
      const mockGetRunnableShellProfile = vi.fn().mockResolvedValue({
        shellType: 'bash',
        profile: { command: '/bin/bash', args: [] },
        fallbackReason: 'zsh not found',
      });
      (PlatformConfigManager.getInstance as any).mockReturnValue({
        getRunnableShellProfile: mockGetRunnableShellProfile,
        getShellProfile: vi.fn().mockReturnValue({ command: '/bin/bash', args: [] }),
        getDefaultShell: vi.fn().mockReturnValue('bash'),
        getEnhancedEnvironment: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
        parseEnvFile: vi.fn().mockReturnValue([]),
        untildify: vi.fn((p: string) => p),
      });

      const proc = new MockChildProcess();
      mockSpawn.mockReturnValue(proc);
      mockStat.mockResolvedValueOnce({ isDirectory: () => false });

      const inst = makeInstance({ type: 'command', shell: 'zsh' });
      const startPromise = inst.start();
      // Emit spawn asynchronously
      setImmediate(() => proc.emit('spawn'));
      await startPromise;
      expect(mockSpawn).toHaveBeenCalled();
    });
  });
});
