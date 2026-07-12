import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  McpAutoReconnectCoordinator,
  AutoReconnectHost,
} from '../mcpAutoReconnectCoordinator';
import { RECONNECT_BACKOFF_SCHEDULE_MS } from '../mcpReconnectPolicy';

function makeHost(overrides: Partial<AutoReconnectHost> = {}): AutoReconnectHost {
  return {
    executeReconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => 'error'),
    isBuiltin: vi.fn(() => false),
    isInUse: vi.fn(() => true),
    setLastError: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

/** Last-error texts emitted synchronously while scheduling a (re)connect. */
function schedulingMessages(host: AutoReconnectHost): string[] {
  return (host.setLastError as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
}

describe('McpAutoReconnectCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── eligibility (decided synchronously inside onServerError) ────────────────

  it('schedules and composes the cause for a previously-connected, in-use server', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'Session not found');

    const messages = schedulingMessages(host);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('Session not found; auto-reconnecting (attempt 1) in 5s');

    coord.resetAll();
    randomSpy.mockRestore();
  });

  it('does not schedule for the builtin server', () => {
    const host = makeHost({ isBuiltin: vi.fn(() => true) });
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('builtin');
    coord.onServerError('builtin', 'boom');

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('does not schedule for a server that is no longer in use', () => {
    const host = makeHost({ isInUse: vi.fn(() => false) });
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('does not schedule for a server that never connected', () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.onServerError('srv', 'boom'); // no noteConnected

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('does not schedule while the server is awaiting user interaction', () => {
    const host = makeHost({ getStatus: vi.fn(() => 'needs-user-interaction') });
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('does not schedule when the error overwrote a prior user-interaction state', () => {
    const host = makeHost({ getStatus: vi.fn(() => 'error') });
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'Authentication was canceled', { wasAwaitingUserInteraction: true });

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('does not schedule for deterministic auth or configuration failures', () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('auth-server');
    coord.noteConnected('bad-config');
    coord.onServerError('auth-server', '[MCP_DCR_REQUIRES_USER_CLIENT_ID] needs client_id');
    coord.onServerError('bad-config', "Stdio transport requires 'command' field for server bad-config");

    expect(host.setLastError).not.toHaveBeenCalled();
  });

  it('cancels a pending attempt if a later failure requires user or config changes', async () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'socket hang up');
    expect(schedulingMessages(host)).toHaveLength(1);

    coord.onServerError('srv', '[MCP_AUTH_CANCELLED] user closed sign-in');
    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 2);

    expect(host.executeReconnect).not.toHaveBeenCalled();
  });

  it('falls back to the bare hint when no failure cause was captured', () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    // Directly exercise the no-base composition arm (unreachable via the public flow because
    // onServerError always records a cause before any scheduling message).
    (coord as unknown as { setReconnectStatus: (s: string, m: string) => void }).setReconnectStatus(
      'srv',
      'auto-reconnecting (attempt 1) in 5s',
    );

    expect(host.setLastError).toHaveBeenCalledWith('srv', 'auto-reconnecting (attempt 1) in 5s');
  });

  // ── full cycle through the internally-constructed manager ───────────────────

  it('runs the reconnect and stops once the server is connected', async () => {
    const getStatus = vi.fn(() => 'error');
    const host = makeHost({ getStatus });
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');

    // The reconnect "succeeds": status flips to connected before the attempt resolves.
    getStatus.mockReturnValue('connected');
    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 1.5);

    expect(host.executeReconnect).toHaveBeenCalledWith('srv');
    // No second scheduling message (only the initial attempt-1 hint).
    expect(schedulingMessages(host).filter((m) => m.includes('attempt'))).toHaveLength(1);
  });

  it('reschedules with a longer backoff when the reconnect does not connect', async () => {
    const host = makeHost(); // getStatus stays 'error'
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');
    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 1.5);

    expect(host.executeReconnect).toHaveBeenCalledTimes(1);
    expect(schedulingMessages(host).some((m) => /attempt 2/.test(m))).toBe(true);

    coord.resetAll();
  });

  it('cancel stops a pending attempt from firing', async () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');
    coord.cancel('srv');

    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 2);
    expect(host.executeReconnect).not.toHaveBeenCalled();
  });

  it('resetAll cancels schedules and forgets the ever-connected set', async () => {
    const host = makeHost();
    const coord = new McpAutoReconnectCoordinator(host);

    coord.noteConnected('srv');
    coord.onServerError('srv', 'boom');
    coord.resetAll();

    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 2);
    expect(host.executeReconnect).not.toHaveBeenCalled();

    // After resetAll the server is no longer remembered as ever-connected, so it will not schedule.
    (host.setLastError as ReturnType<typeof vi.fn>).mockClear();
    coord.onServerError('srv', 'boom again');
    expect(host.setLastError).not.toHaveBeenCalled();
  });
});
