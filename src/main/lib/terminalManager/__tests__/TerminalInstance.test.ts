/**
 * Tests for TerminalInstance — covering uncovered paths
 */

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('../../runtime/RuntimeManager', async () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: vi.fn().mockReturnValue({ mode: 'system' }),
      getBinPath: vi.fn().mockReturnValue('/mock/bin'),
      resolveCommand: vi.fn((cmd: string) => cmd),
      waitForShimsReady: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TerminalInstance } from '../TerminalInstance';
import type { TerminalConfig } from '../types';

// ---- helpers ----

class MockChildProcess extends EventEmitter {
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = { end: vi.fn(), write: vi.fn() };
  public pid = 9999;
  public kill = vi.fn((signal?: string) => {
    this.killed = true;
    return true;
  });
}

class TestableTerminalInstance extends TerminalInstance {
  attachMockProcess(proc: MockChildProcess, state: 'running' | 'idle' = 'running') {
    (this as any)._process = proc;
    (this as any)._state = state;
  }

  setBufferedOutput(stdout: string, stderr: string) {
    (this as any).stdout = stdout;
    (this as any).stderr = stderr;
  }

  callSetState(state: string) {
    (this as any).setState(state);
  }

  callCreateMissingCwdPrefix(cwd: string, shellCommand: string) {
    return (this as any).createMissingCwdPrefix(cwd, shellCommand);
  }

  callParseCommandString(command: string) {
    return (this as any).parseCommandString(command);
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

describe('TerminalInstance', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---- constructor / id generation ----

  it('generates an id matching terminal_<timestamp>_<rand> when no instanceId provided', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    expect(inst.id).toMatch(/^terminal_\d+_[a-z0-9]+$/);
  });

  it('uses config.instanceId when provided', () => {
    const inst = new TestableTerminalInstance(makeConfig({ instanceId: 'my-id' }));
    expect(inst.id).toBe('my-id');
  });

  it('type reflects config.type', () => {
    const inst = new TestableTerminalInstance(makeConfig({ type: 'mcp_transport' }));
    expect(inst.type).toBe('mcp_transport');
  });

  // ---- state / stateChange event ----

  it('setState emits stateChange event', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const listener = vi.fn();
    inst.on('stateChange', listener);
    inst.callSetState('running');
    expect(listener).toHaveBeenCalledWith('running');
  });

  it('initial state is idle', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    expect(inst.state).toBe('idle');
  });

  // ---- getInfo ----

  it('getInfo returns correct shape', () => {
    const inst = new TestableTerminalInstance(makeConfig({ instanceId: 'test-id' }));
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);

    const info = inst.getInfo();
    expect(info.id).toBe('test-id');
    expect(info.type).toBe('command');
    expect(info.state).toBe('running');
    expect(info.pid).toBe(9999);
    expect(typeof info.startTime).toBe('number');
    expect(typeof info.lastActivity).toBe('number');
  });

  it('getInfo returns undefined pid when no process', () => {
    const inst = new TestableTerminalInstance(makeConfig({ instanceId: 'no-proc' }));
    expect(inst.getInfo().pid).toBeUndefined();
  });

  // ---- process getter ----

  it('process getter returns the attached process', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);
    expect(inst.process).toBe(proc);
  });

  // ---- execute() guard conditions ----

  it('execute() throws when type is not command', async () => {
    const inst = new TestableTerminalInstance(makeConfig({ type: 'mcp_transport' }));
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc, 'running');
    await expect(inst.execute()).rejects.toThrow('execute() can only be called on command type instances');
  });

  it('execute() throws when not in running state', async () => {
    const inst = new TestableTerminalInstance(makeConfig());
    // state is 'idle' by default
    await expect(inst.execute()).rejects.toThrow('Terminal instance is not running');
  });

  // ---- send() guard conditions ----

  it('send() throws when type is not mcp_transport', () => {
    const inst = new TestableTerminalInstance(makeConfig({ type: 'command' }));
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc, 'running');
    expect(() => inst.send('hello')).toThrow('send() can only be called on mcp_transport type instances');
  });

  it('send() throws when not in running state', () => {
    const inst = new TestableTerminalInstance(makeConfig({ type: 'mcp_transport' }));
    // state is idle, no process
    expect(() => inst.send('hello')).toThrow('Terminal instance is not running');
  });

  // ---- stop() ----

  it('stop() is a no-op when already stopped', async () => {
    const inst = new TestableTerminalInstance(makeConfig());
    inst.callSetState('stopped');
    // Should not throw
    await expect(inst.stop()).resolves.toBeUndefined();
  });

  it('stop() sends SIGTERM to process when no stateHandler', async () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc, 'running');

    const stopPromise = inst.stop();
    // emit exit so the await resolves
    proc.emit('exit', 0, null);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stop(true) sends SIGKILL to process', async () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc, 'running');

    const stopPromise = inst.stop(true);
    proc.emit('exit', 0, null);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  // ---- dispose() ----

  it('dispose() clears the process reference and removes all listeners', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);

    inst.on('test', vi.fn());
    inst.dispose();

    expect((inst as any)._process).toBeNull();
    expect(inst.listenerCount('test')).toBe(0);
  });

  // ---- parseCommandString ----

  it('parseCommandString handles double-quoted executable', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const result = inst.callParseCommandString('"C:\\Program Files\\app.exe" --flag');
    expect(result.executable).toBe('"C:\\Program Files\\app.exe"');
    expect(result.inlineArgs).toBe('--flag');
  });

  it('parseCommandString handles single-quoted executable', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const result = inst.callParseCommandString("'my app' arg1");
    expect(result.executable).toBe("'my app'");
    expect(result.inlineArgs).toBe('arg1');
  });

  it('parseCommandString handles simple command with space', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const result = inst.callParseCommandString('python script.py --arg');
    expect(result.executable).toBe('python');
    expect(result.inlineArgs).toBe('script.py --arg');
  });

  it('parseCommandString handles no-argument command', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const result = inst.callParseCommandString('node');
    expect(result.executable).toBe('node');
    expect(result.inlineArgs).toBe('');
  });

  // ---- createMissingCwdPrefix ----

  it('createMissingCwdPrefix returns Set-Location for powershell', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const prefix = inst.callCreateMissingCwdPrefix('C:\\my dir', 'powershell.exe');
    expect(prefix).toContain('Set-Location');
    expect(prefix).toContain('C:\\my dir');
  });

  it('createMissingCwdPrefix returns cd /d for cmd.exe', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const prefix = inst.callCreateMissingCwdPrefix('C:\\my dir', 'cmd.exe');
    expect(prefix).toContain('cd /d');
  });

  it('createMissingCwdPrefix returns POSIX cd for other shells', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const prefix = inst.callCreateMissingCwdPrefix('/home/user/my dir', '/bin/bash');
    expect(prefix).toContain('cd ');
    expect(prefix).toContain('/home/user/my dir');
  });

  // ---- setupCommandHandlers output truncation ----

  it('setupCommandHandlers truncates stdout when exceeding maxOutputLength', () => {
    const inst = new TestableTerminalInstance(makeConfig({ maxOutputLength: 10 }));
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);
    (inst as any).setupCommandHandlers();

    proc.stdout.emit('data', Buffer.from('hello world extra text'));

    expect((inst as any).stdout.length).toBeLessThanOrEqual(10);
    expect((inst as any).truncated).toBe(true);
  });

  it('setupCommandHandlers truncates stderr when exceeding maxOutputLength', () => {
    const inst = new TestableTerminalInstance(makeConfig({ maxOutputLength: 5 }));
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);
    (inst as any).setupCommandHandlers();

    proc.stderr.emit('data', Buffer.from('error message longer than 5'));

    expect((inst as any).stderr.length).toBeLessThanOrEqual(5);
    expect((inst as any).truncated).toBe(true);
  });

  it('setupCommandHandlers emits stdout event', () => {
    const inst = new TestableTerminalInstance(makeConfig());
    const proc = new MockChildProcess();
    inst.attachMockProcess(proc);
    (inst as any).setupCommandHandlers();

    const listener = vi.fn();
    inst.on('stdout', listener);
    proc.stdout.emit('data', Buffer.from('output'));

    expect(listener).toHaveBeenCalledWith('output');
  });
});
