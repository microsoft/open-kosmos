import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MCP_CONNECT_TIMEOUT_MS,
  TOOL_IDLE_TIMEOUT_MS,
  IDLE_TIMEOUT_ESCALATION_THRESHOLD,
  IDLE_TIMEOUT_ESCALATION_WINDOW_MS,
  SELF_MANAGED_IDLE_TOOLS,
  ConnectionTimeoutError,
  ToolIdleTimeoutError,
  McpProtocolConnectionError,
  InactivityTimer,
} from '../toolTimeoutPolicy';

describe('toolTimeoutPolicy constants', () => {
  it('exposes a 5-minute connection budget', () => {
    expect(MCP_CONNECT_TIMEOUT_MS).toBe(300_000);
  });

  it('exposes a 10-minute idle budget', () => {
    expect(TOOL_IDLE_TIMEOUT_MS).toBe(600_000);
  });

  it('exposes the idle-timeout escalation threshold and window', () => {
    expect(IDLE_TIMEOUT_ESCALATION_THRESHOLD).toBe(3);
    expect(IDLE_TIMEOUT_ESCALATION_WINDOW_MS).toBe(1_800_000);
  });

  it('marks coding_agent as self-managed so the central watchdog skips it', () => {
    expect(SELF_MANAGED_IDLE_TOOLS.has('coding_agent')).toBe(true);
    expect(SELF_MANAGED_IDLE_TOOLS.has('execute_command')).toBe(false);
  });
});

describe('McpProtocolConnectionError', () => {
  it('carries the message and an optional JSON-RPC code', () => {
    const err = new McpProtocolConnectionError('Session not found', -32001);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('McpProtocolConnectionError');
    expect(err.message).toBe('Session not found');
    expect(err.code).toBe(-32001);
  });

  it('allows omitting the code', () => {
    const err = new McpProtocolConnectionError('connection lost');
    expect(err.code).toBeUndefined();
  });
});

describe('ConnectionTimeoutError', () => {
  it('carries server name, timeout and a descriptive message', () => {
    const err = new ConnectionTimeoutError('my-server', 300_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConnectionTimeoutError');
    expect(err.serverName).toBe('my-server');
    expect(err.timeoutMs).toBe(300_000);
    expect(err.message).toContain('my-server');
    expect(err.message).toContain('300000');
  });
});

describe('ToolIdleTimeoutError', () => {
  it('carries tool name, idle duration and a descriptive message', () => {
    const err = new ToolIdleTimeoutError('execute_command', 600_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ToolIdleTimeoutError');
    expect(err.toolName).toBe('execute_command');
    expect(err.idleMs).toBe(600_000);
    expect(err.message).toContain('execute_command');
    expect(err.message).toContain('600000');
  });
});

describe('InactivityTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onIdle once after idleMs of no activity', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);

    timer.dispose();
  });

  it('does not fire again after the first idle fire', () => {
    const onIdle = vi.fn();
    new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('resets the countdown on touch', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(900);
    timer.touch();
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('ignores touch after it has fired (does not re-arm)', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    timer.touch();
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire after dispose', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(500);
    timer.dispose();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('ignores touch after dispose', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    timer.dispose();
    timer.touch();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('tolerates dispose being called multiple times', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    expect(() => {
      timer.dispose();
      timer.dispose();
    }).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('tolerates dispose after it has already fired', () => {
    const onIdle = vi.fn();
    const timer = new InactivityTimer(1000, onIdle);

    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(() => timer.dispose()).not.toThrow();
  });
});
