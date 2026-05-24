/**
 * Unit tests for VscodeStdioTransport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => mockLogger,
}));

let mockTerminalInstance: any;
let mockTerminalManager: any;

const mockGetTerminalManager = vi.hoisted(() => vi.fn());

vi.mock('../../../terminalManager', () => ({
  getTerminalManager: mockGetTerminalManager,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeTerminalInstance() {
  const emitter = new EventEmitter();
  const inst: any = {
    id: 'fake-terminal-123',
    send: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getInfo: vi.fn().mockReturnValue({ state: 'running' }),
    on: (event: string, fn: any) => { emitter.on(event, fn); return inst; },
    off: (event: string, fn: any) => { emitter.off(event, fn); return inst; },
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  };
  return inst;
}

// ── Tests ──────────────────────────────────────────────────────────────────

import { VscodeStdioTransport } from '../transport/VscodeStdioTransport';

describe('VscodeStdioTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminalInstance = makeFakeTerminalInstance();
    mockTerminalManager = {
      createMcpTransport: vi.fn().mockResolvedValue(mockTerminalInstance),
    };
    mockGetTerminalManager.mockReturnValue(mockTerminalManager);
  });

  function makeTransport(cwd?: string) {
    return new VscodeStdioTransport({
      command: 'node',
      args: ['server.js'],
      cwd,
      env: { FOO: 'bar' },
    });
  }

  // ── state ──────────────────────────────────────────────────────────────

  it('starts in stopped state', () => {
    const t = makeTransport();
    expect(t.state.state).toBe('stopped');
  });

  // ── start ──────────────────────────────────────────────────────────────

  it('start() creates a terminal instance and transitions to running', async () => {
    const t = makeTransport();
    await t.start();
    expect(t.state.state).toBe('running');
    expect(mockTerminalManager.createMcpTransport).toHaveBeenCalledOnce();
  });

  it('start() is a no-op when already running', async () => {
    const t = makeTransport();
    await t.start();
    await t.start();
    expect(mockTerminalManager.createMcpTransport).toHaveBeenCalledOnce();
  });

  it('start() emits stateChange events', async () => {
    const t = makeTransport();
    const states: string[] = [];
    t.on('stateChange', (s: any) => states.push(s.state));
    await t.start();
    expect(states).toContain('starting');
    expect(states).toContain('running');
  });

  it('start() sets state to error and rethrows when terminal creation fails', async () => {
    mockTerminalManager.createMcpTransport.mockRejectedValue(new Error('spawn failed'));
    const t = makeTransport();
    await expect(t.start()).rejects.toThrow('spawn failed');
    expect(t.state.state).toBe('error');
  });

  // ── send ───────────────────────────────────────────────────────────────

  it('send() delegates to the terminal instance', async () => {
    const t = makeTransport();
    await t.start();
    t.send('{"jsonrpc":"2.0"}');
    expect(mockTerminalInstance.send).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');
  });

  it('send() throws when transport is not running', () => {
    const t = makeTransport();
    expect(() => t.send('msg')).toThrow(/not running/);
  });

  it('send() includes state-specific error message when in error state', async () => {
    const t = makeTransport();
    // Force error state with a message
    mockTerminalManager.createMcpTransport.mockRejectedValue(new Error('connection refused'));
    await t.start().catch(() => {});
    expect(() => t.send('msg')).toThrow('connection refused');
  });

  it('send() throws when terminal instance is unavailable', async () => {
    const t = makeTransport();
    await t.start();
    // Null out the instance without changing state (simulate race)
    (t as any).terminalInstance = null;
    expect(() => t.send('msg')).toThrow(/Terminal instance not available/);
  });

  it('send() wraps terminal.send throw with stderr context', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.send.mockImplementation(() => { throw new Error('pipe broken'); });
    expect(() => t.send('msg')).toThrow(/pipe broken/);
  });

  // ── stop ───────────────────────────────────────────────────────────────

  it('stop() stops the terminal instance and sets state to stopped', async () => {
    const t = makeTransport();
    await t.start();
    await t.stop();
    expect(mockTerminalInstance.stop).toHaveBeenCalledOnce();
    expect(t.state.state).toBe('stopped');
  });

  it('stop() is a no-op when already stopped', async () => {
    const t = makeTransport();
    await t.stop();
    expect(mockTerminalInstance.stop).not.toHaveBeenCalled();
  });

  it('stop() continues even if terminal.stop throws', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.stop.mockRejectedValue(new Error('stop fail'));
    await expect(t.stop()).resolves.toBeUndefined();
    expect(t.state.state).toBe('stopped');
  });

  // ── event forwarding ───────────────────────────────────────────────────

  it('forwards message events from the terminal instance', async () => {
    const t = makeTransport();
    await t.start();
    const listener = vi.fn();
    t.on('message', listener);
    mockTerminalInstance.emit('message', '{"jsonrpc":"2.0","id":1,"result":{}}');
    expect(listener).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"result":{}}');
  });

  it('transitions to error state on terminal error event', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('error', new Error('process crashed'));
    expect(t.state.state).toBe('error');
  });

  it('transitions to stopped state on expected exit (exit code 0)', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('exit', 0, null);
    expect(t.state.state).toBe('stopped');
  });

  it('transitions to error state on unexpected exit', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.getInfo.mockReturnValue({ state: 'running' }); // not stopping
    mockTerminalInstance.emit('exit', 1, null);
    expect(t.state.state).toBe('error');
    expect(t.state.message).toContain('Process exited with code 1');
  });

  it('collects stderr output into the buffer', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('stderr', 'Error: module not found');
    expect(t.getStderrOutput()).toContain('Error: module not found');
  });

  it('includes stderr in error messages', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('stderr', 'Fatal: out of memory');
    mockTerminalInstance.emit('error', new Error('crash'));
    expect(t.state.message).toContain('Fatal: out of memory');
  });

  // ── stderr helpers ─────────────────────────────────────────────────────

  it('clearStderrBuffer empties the buffer', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('stderr', 'some error line');
    t.clearStderrBuffer();
    expect(t.getStderrOutput()).toBe('');
  });

  it('getStderrPreview truncates long output', async () => {
    const t = makeTransport();
    await t.start();
    for (let i = 0; i < 5; i++) {
      mockTerminalInstance.emit('stderr', 'x'.repeat(1000));
    }
    const preview = t.getStderrPreview(3, 100);
    expect(preview.length).toBeLessThanOrEqual(115); // 100 + truncation marker
  });

  it('getStderrPreview strips ANSI codes', async () => {
    const t = makeTransport();
    await t.start();
    mockTerminalInstance.emit('stderr', '\x1B[31mRed error\x1B[0m');
    expect(t.getStderrOutput()).not.toContain('\x1B');
    expect(t.getStderrOutput()).toContain('Red error');
  });

  // ── cwd / path expansion ───────────────────────────────────────────────

  it('expands tilde in command path', async () => {
    const t = new VscodeStdioTransport({
      command: '~/bin/mcp-server',
      args: [],
    });
    await t.start();
    const call = mockTerminalManager.createMcpTransport.mock.calls[0][0];
    expect(call.command).not.toContain('~');
    expect(call.command).toContain('/bin/mcp-server');
  });

  it('resolves relative cwd against home directory', async () => {
    const t = new VscodeStdioTransport({
      command: 'node',
      args: [],
      cwd: 'my-project',
    });
    await t.start();
    const call = mockTerminalManager.createMcpTransport.mock.calls[0][0];
    expect(call.cwd).not.toBe('my-project');
    expect(call.cwd).toMatch(/my-project$/);
  });

  it('uses homedir when cwd is not specified', async () => {
    const { homedir } = await import('os');
    const t = new VscodeStdioTransport({ command: 'node', args: [] });
    await t.start();
    const call = mockTerminalManager.createMcpTransport.mock.calls[0][0];
    expect(call.cwd).toBe(homedir());
  });
});
