/**
 * Per-server operation serialization for MCP connect / disconnect / reconnect.
 *
 * One lock per server guarantees those three operations never run concurrently for the same server.
 * A background auto-reconnect attempt tags its lock (`isAutoReconnect: true`); a manual operation
 * supersedes an in-flight auto attempt — it waits for that attempt to settle and then takes the
 * lock, so the manual action always wins instead of being rejected with "please wait". Any other
 * collision (manual-vs-manual) is rejected fast as double-action protection.
 */
export interface OperationLock {
  operation: 'connect' | 'disconnect' | 'reconnect';
  promise: Promise<void>;
  timestamp: number;
  abortController?: AbortController;
  /** True when held by a background auto-reconnect attempt (superseded by manual ops). */
  isAutoReconnect?: boolean;
}

export class OperationLockManager {
  private readonly locks = new Map<string, OperationLock>();

  get size(): number {
    return this.locks.size;
  }

  get(serverName: string): OperationLock | undefined {
    return this.locks.get(serverName);
  }

  delete(serverName: string): void {
    this.locks.delete(serverName);
  }

  clear(): void {
    for (const lock of this.locks.values()) {
      lock.abortController?.abort();
    }
    this.locks.clear();
  }

  /**
   * Run `action` while holding the per-server lock. Throws if a conflicting operation is already in
   * progress, except that a manual operation waits out an in-flight auto-reconnect attempt and then
   * proceeds (so the manual action wins).
   */
  async run(
    serverName: string,
    operation: OperationLock['operation'],
    action: (signal: AbortSignal) => Promise<void>,
    options?: { isAutoReconnect?: boolean }
  ): Promise<void> {
    const isAutoReconnect = options?.isAutoReconnect === true;

    // Wait out an in-flight auto-reconnect attempt when a manual op arrives; any other collision is
    // rejected immediately. The caller is expected to have already cancelled the auto-reconnect
    // schedule (epoch bump) so the settling attempt will not reschedule itself.
    for (;;) {
      const existingLock = this.locks.get(serverName);
      if (!existingLock) break;
      const manualSupersedingAuto = existingLock.isAutoReconnect === true && !isAutoReconnect;
      if (!manualSupersedingAuto) {
        throw new Error(`Server "${serverName}" is currently ${existingLock.operation}ing, please wait`);
      }
      try {
        await existingLock.promise;
      } catch {
        // The auto-reconnect attempt's own outcome is irrelevant to the superseding manual op.
      }
      if (this.locks.get(serverName) === existingLock) {
        // Its finally has not cleared the lock yet; clear it so the manual op can proceed.
        this.locks.delete(serverName);
      }
    }

    const abortController = new AbortController();
    const lockPromise = Promise.resolve().then(() => action(abortController.signal));
    const lock: OperationLock = {
      operation,
      promise: lockPromise,
      timestamp: Date.now(),
      abortController,
      isAutoReconnect,
    };
    this.locks.set(serverName, lock);

    try {
      await lockPromise;
    } finally {
      // Only clear our own lock — a superseding manual op (or clear()) may have replaced it.
      if (this.locks.get(serverName) === lock) {
        this.locks.delete(serverName);
      }
    }
  }
}
