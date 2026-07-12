import { describe, it, expect, vi } from 'vitest';
import { McpAutoReconnectManager, AutoReconnectDeps } from '../mcpAutoReconnectManager';
import { MAX_AUTO_RECONNECT_ATTEMPTS, RECONNECT_BACKOFF_SCHEDULE_MS } from '../mcpReconnectPolicy';

const tick = () => new Promise((resolve) => setImmediate(resolve));

interface PendingTimer {
  id: number;
  cb: () => void;
  ms: number;
}

/** Deterministic timer queue: timers only fire when the test explicitly fires them. */
class TimerHarness {
  private seq = 0;
  readonly pending = new Map<number, PendingTimer>();

  setTimer = (cb: () => void, ms: number): any => {
    const id = ++this.seq;
    this.pending.set(id, { id, cb, ms });
    return id;
  };

  clearTimer = (id: any): void => {
    this.pending.delete(id);
  };

  /** Fire and remove every currently-queued timer. */
  async fireAll(): Promise<void> {
    const timers = [...this.pending.values()];
    this.pending.clear();
    for (const t of timers) {
      t.cb();
    }
    await tick();
  }

  lastDelay(): number | undefined {
    const timers = [...this.pending.values()];
    return timers.length ? timers[timers.length - 1].ms : undefined;
  }
}

function makeDeps(overrides: Partial<AutoReconnectDeps> = {}): {
  deps: AutoReconnectDeps;
  harness: TimerHarness;
  reconnect: ReturnType<typeof vi.fn>;
  messages: Array<{ serverName: string; message: string }>;
  status: { value: string };
} {
  const harness = new TimerHarness();
  const reconnect = vi.fn().mockResolvedValue(undefined);
  const messages: Array<{ serverName: string; message: string }> = [];
  const status = { value: 'error' };
  const deps: AutoReconnectDeps = {
    reconnect,
    getStatus: () => status.value,
    isEligible: () => true,
    onStateMessage: (serverName, message) => messages.push({ serverName, message }),
    log: () => {},
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
    rng: () => 0,
    ...overrides,
  };
  return { deps, harness, reconnect, messages, status };
}

describe('McpAutoReconnectManager', () => {
  it('schedules a first attempt and resets after a successful reconnect', async () => {
    const { deps, harness, reconnect, status } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    expect(harness.pending.size).toBe(1);
    expect(harness.lastDelay()).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[0]);
    expect(mgr.getAttemptCount('teams')).toBe(1);

    status.value = 'connected';
    await harness.fireAll();

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith('teams');
    expect(mgr.getAttemptCount('teams')).toBe(0);
    expect(harness.pending.size).toBe(0);
  });

  it('chains the next attempt with a longer backoff when the reconnect did not connect', async () => {
    const { deps, harness, reconnect } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps); // status stays 'error'

    mgr.onServerError('teams');
    expect(harness.lastDelay()).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[0]);

    await harness.fireAll();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(mgr.getAttemptCount('teams')).toBe(2);
    expect(harness.lastDelay()).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[1]);
  });

  it('chains the next attempt when the reconnect throws', async () => {
    const reconnect = vi.fn().mockRejectedValue(new Error('locked'));
    const { deps, harness } = makeDeps({ reconnect });
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    await harness.fireAll();

    expect(mgr.getAttemptCount('teams')).toBe(2);
    expect(harness.pending.size).toBe(1);
  });

  it('gives up after the maximum number of attempts', async () => {
    const { deps, harness, messages } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps); // always 'error'

    mgr.onServerError('teams');
    // Drive attempts until the scheduler stops queueing a new timer.
    for (let i = 0; i < MAX_AUTO_RECONNECT_ATTEMPTS + 2 && harness.pending.size > 0; i++) {
      await harness.fireAll();
    }

    expect(harness.pending.size).toBe(0);
    expect(messages.some((m) => /Reconnect failed after \d+ attempts/.test(m.message))).toBe(true);
  });

  it('cancels the schedule when the server is no longer eligible at error time', () => {
    const { deps, harness } = makeDeps({ isEligible: () => false });
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('teams')).toBe(0);
  });

  it('does not reconnect when eligibility flips off before the timer fires', async () => {
    let eligible = true;
    const { deps, harness, reconnect } = makeDeps({ isEligible: () => eligible });
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    expect(harness.pending.size).toBe(1);
    eligible = false;
    await harness.fireAll();

    expect(reconnect).not.toHaveBeenCalled();
    expect(mgr.getAttemptCount('teams')).toBe(0);
  });

  it('is idempotent while a timer is already pending', () => {
    const { deps, harness } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    mgr.onServerError('teams');
    mgr.onServerError('teams');

    expect(harness.pending.size).toBe(1);
    expect(mgr.getAttemptCount('teams')).toBe(1);
  });

  it('cancel clears the pending timer and attempt count', () => {
    const { deps, harness } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    expect(harness.pending.size).toBe(1);

    mgr.cancel('teams');
    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('teams')).toBe(0);
    // Cancelling an unknown server is a no-op.
    expect(() => mgr.cancel('unknown')).not.toThrow();
  });

  it('cancelAll clears every pending server', () => {
    const { deps, harness } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('a');
    mgr.onServerError('b');
    expect(harness.pending.size).toBe(2);

    mgr.cancelAll();
    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('a')).toBe(0);
    expect(mgr.getAttemptCount('b')).toBe(0);
  });

  it('cancel during an in-flight attempt suppresses the stale reschedule', async () => {
    let releaseReconnect: () => void = () => {};
    const reconnect = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { releaseReconnect = resolve; }),
    );
    const { deps, harness } = makeDeps({ reconnect }); // status stays 'error'
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    // Fire the scheduled timer so run() starts and parks on the reconnect promise.
    await harness.fireAll();
    expect(reconnect).toHaveBeenCalledTimes(1);

    // A manual op lands while the attempt is still in flight.
    mgr.cancel('teams');

    // The reconnect resolves AFTER the cancel; a non-connected result would normally chain a new
    // attempt, but the cancellation epoch must suppress it.
    releaseReconnect();
    await tick();

    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('teams')).toBe(0);
  });

  it('cancelAll during an in-flight attempt suppresses a rejected stale reschedule', async () => {
    let rejectReconnect: (e: Error) => void = () => {};
    const reconnect = vi.fn().mockImplementation(
      () => new Promise<void>((_resolve, reject) => { rejectReconnect = reject; }),
    );
    const { deps, harness } = makeDeps({ reconnect });
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    await harness.fireAll();
    expect(reconnect).toHaveBeenCalledTimes(1);

    // Teardown lands mid-attempt and bumps the epoch for the in-flight server.
    mgr.cancelAll();
    rejectReconnect(new Error('boom'));
    await tick();

    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('teams')).toBe(0);
  });

  it('reset clears a pending timer and the attempt count', () => {
    const { deps, harness } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    mgr.reset('teams');
    expect(harness.pending.size).toBe(0);
    expect(mgr.getAttemptCount('teams')).toBe(0);
  });

  it('emits a human-readable scheduling message with the attempt number and delay', () => {
    const { deps, messages } = makeDeps();
    const mgr = new McpAutoReconnectManager(deps);

    mgr.onServerError('teams');
    expect(messages[0].serverName).toBe('teams');
    expect(messages[0].message).toMatch(/auto-reconnecting \(attempt 1\) in \d+s/);
  });

  it('falls back to real timers and Math.random when none are injected', async () => {
    vi.useFakeTimers();
    try {
      const reconnect = vi.fn().mockResolvedValue(undefined);
      const status = { value: 'connected' };
      const mgr = new McpAutoReconnectManager({
        reconnect,
        getStatus: () => status.value,
        isEligible: () => true,
        onStateMessage: () => {},
        log: () => {},
      });

      mgr.onServerError('teams');
      expect(mgr.getAttemptCount('teams')).toBe(1);
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_SCHEDULE_MS[0] * 1.5);
      expect(reconnect).toHaveBeenCalledWith('teams');
      expect(mgr.getAttemptCount('teams')).toBe(0);

      // Exercise the default clearTimer branch too.
      status.value = 'error';
      mgr.onServerError('teams');
      mgr.cancel('teams');
      expect(mgr.getAttemptCount('teams')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
