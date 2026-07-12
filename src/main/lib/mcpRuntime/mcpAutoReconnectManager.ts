/**
 * Auto-reconnect scheduler for MCP servers.
 *
 * Owns the timers, attempt counters, and in-flight state so there is exactly one pending
 * recovery action per server at a time. All collaborators (clock, timer, rng, and the manager
 * callbacks) are injected, so the full state machine is unit-testable without real timers.
 *
 * See docs/mcp-connection-recovery-tech-doc.md.
 */

import {
  MAX_AUTO_RECONNECT_ATTEMPTS,
  computeReconnectDelayMs,
} from './mcpReconnectPolicy';

export interface AutoReconnectDeps {
  /** Perform one reconnect attempt for the server (manager routes this through its lock). */
  reconnect: (serverName: string) => Promise<void>;
  /** Current runtime status of the server, used to detect a successful attempt. */
  getStatus: (serverName: string) => string | undefined;
  /** Snapshot eligibility check (non-builtin, in-use, ever-connected, not awaiting interaction). */
  isEligible: (serverName: string) => boolean;
  /** Surface a human-readable recovery message (stored as the server's last-error text). */
  onStateMessage: (serverName: string, message: string) => void;
  /** Structured logging hook. */
  log: (level: 'info' | 'warning' | 'debug', message: string) => void;
  /** Injectable clock / timer / rng for tests. */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  rng?: () => number;
}

/**
 * Schedules backoff-driven reconnect attempts for servers that dropped while in use.
 */
export class McpAutoReconnectManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  /**
   * Monotonic cancellation token per server. {@link cancel} / {@link cancelAll} bump it; an
   * in-flight {@link run} captures the value at entry and aborts (no reset, no reschedule) if it
   * changed across its `await`, so a manual connect/disconnect/teardown that lands mid-attempt can
   * never be overwritten by a stale reconnect that resolves afterwards.
   */
  private readonly cancelEpoch = new Map<string, number>();

  constructor(private readonly deps: AutoReconnectDeps) {}

  /**
   * Idempotent entry point. Called whenever a server enters `error`. Schedules a reconnect if the
   * server is eligible and nothing is already pending or running for it.
   */
  onServerError(serverName: string): void {
    if (!this.deps.isEligible(serverName)) {
      this.cancel(serverName);
      return;
    }
    if (this.inFlight.has(serverName) || this.timers.has(serverName)) {
      return;
    }
    this.scheduleNextAttempt(serverName);
  }

  /** Cancel any pending attempt and clear the counter (manual op superseded, or now ineligible). */
  cancel(serverName: string): void {
    const timer = this.timers.get(serverName);
    if (timer !== undefined) {
      this.clearTimer(timer);
      this.timers.delete(serverName);
    }
    this.attempts.delete(serverName);
    this.bumpEpoch(serverName);
  }

  /** Cancel every pending attempt (profile teardown). */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      this.clearTimer(timer);
    }
    this.timers.clear();
    this.attempts.clear();
    for (const serverName of this.inFlight) {
      this.bumpEpoch(serverName);
    }
    this.inFlight.clear();
  }

  /** Clear the attempt counter after a stable connection so the next drop starts fresh. */
  reset(serverName: string): void {
    const timer = this.timers.get(serverName);
    if (timer !== undefined) {
      this.clearTimer(timer);
      this.timers.delete(serverName);
    }
    this.attempts.delete(serverName);
  }

  /** Test/inspection helper: current attempt count for a server. */
  getAttemptCount(serverName: string): number {
    return this.attempts.get(serverName) ?? 0;
  }

  private scheduleNextAttempt(serverName: string): void {
    const attempt = (this.attempts.get(serverName) ?? 0) + 1;
    if (attempt > MAX_AUTO_RECONNECT_ATTEMPTS) {
      this.deps.onStateMessage(
        serverName,
        `Reconnect failed after ${MAX_AUTO_RECONNECT_ATTEMPTS} attempts`,
      );
      this.deps.log('warning', `mcp.auto-reconnect.gave-up ${serverName}`);
      return;
    }
    this.attempts.set(serverName, attempt);
    const delay = computeReconnectDelayMs(attempt, this.deps.rng ?? Math.random);
    this.deps.onStateMessage(
      serverName,
      `auto-reconnecting (attempt ${attempt}) in ${Math.round(delay / 1000)}s`,
    );
    this.deps.log('info', `mcp.auto-reconnect.scheduled ${serverName} attempt=${attempt} delayMs=${delay}`);
    const timer = this.setTimer(() => {
      void this.run(serverName);
    }, delay);
    this.timers.set(serverName, timer);
  }

  private async run(serverName: string): Promise<void> {
    this.timers.delete(serverName);
    if (!this.deps.isEligible(serverName)) {
      this.attempts.delete(serverName);
      return;
    }
    this.inFlight.add(serverName);
    const epoch = this.cancelEpoch.get(serverName) ?? 0;
    this.deps.log('info', `mcp.auto-reconnect.started ${serverName}`);
    try {
      await this.deps.reconnect(serverName);
      if (this.isCancelled(serverName, epoch)) {
        return;
      }
      if (this.deps.getStatus(serverName) === 'connected') {
        this.reset(serverName);
        this.deps.log('info', `mcp.auto-reconnect.succeeded ${serverName}`);
      } else {
        this.deps.log('warning', `mcp.auto-reconnect.failed ${serverName}`);
        this.scheduleNextAttempt(serverName);
      }
    } catch (error) {
      if (this.isCancelled(serverName, epoch)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log('warning', `mcp.auto-reconnect.failed ${serverName} ${message}`);
      this.scheduleNextAttempt(serverName);
    } finally {
      this.inFlight.delete(serverName);
    }
  }

  /** A manual cancel/teardown that landed during this attempt invalidates its result. */
  private isCancelled(serverName: string, epoch: number): boolean {
    return (this.cancelEpoch.get(serverName) ?? 0) !== epoch;
  }

  private bumpEpoch(serverName: string): void {
    this.cancelEpoch.set(serverName, (this.cancelEpoch.get(serverName) ?? 0) + 1);
  }

  private setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    return this.deps.setTimer ? this.deps.setTimer(callback, ms) : setTimeout(callback, ms);
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>): void {
    if (this.deps.clearTimer) {
      this.deps.clearTimer(timer);
    } else {
      clearTimeout(timer);
    }
  }
}
