import { describe, it, expect } from 'vitest';
import { OperationLock, OperationLockManager } from '../mcpOperationLock';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('OperationLockManager', () => {
  it('runs an action and clears its own lock on completion', async () => {
    const mgr = new OperationLockManager();
    let ran = false;
    await mgr.run('s', 'connect', async (signal) => {
      expect(signal.aborted).toBe(false);
      ran = true;
    });
    expect(ran).toBe(true);
    expect(mgr.size).toBe(0);
  });

  it('rejects a colliding manual operation while a non-auto lock is held', async () => {
    const mgr = new OperationLockManager();
    // A held non-auto lock (isAutoReconnect undefined) must reject a second manual op.
    (mgr as any).locks.set('s', {
      operation: 'connect',
      promise: new Promise<void>(() => {}),
      timestamp: Date.now(),
    } as OperationLock);
    await expect(mgr.run('s', 'connect', async () => {})).rejects.toThrow(
      'currently connecting'
    );
  });

  it('rejects an auto op colliding with another in-flight auto attempt', async () => {
    const mgr = new OperationLockManager();
    (mgr as any).locks.set('s', {
      operation: 'reconnect',
      promise: new Promise<void>(() => {}),
      timestamp: Date.now(),
      isAutoReconnect: true,
    } as OperationLock);
    await expect(
      mgr.run('s', 'reconnect', async () => {}, { isAutoReconnect: true })
    ).rejects.toThrow('currently reconnecting');
  });

  it('lets a manual op supersede a real in-flight auto attempt (skip branch)', async () => {
    const mgr = new OperationLockManager();
    let resolveAuto!: () => void;
    const autoP = mgr.run(
      's',
      'reconnect',
      () => new Promise<void>((res) => (resolveAuto = res)),
      { isAutoReconnect: true }
    );
    expect(mgr.size).toBe(1);

    let manualRan = false;
    const manualP = mgr.run('s', 'connect', async () => {
      manualRan = true;
    });
    // The manual op is now parked behind the auto attempt and has not run yet.
    await tick();
    expect(manualRan).toBe(false);

    // The auto attempt settles first and clears its own lock; the manual op then sees no lock,
    // so the in-loop delete is skipped and it proceeds to run.
    resolveAuto();
    await autoP;
    await manualP;
    expect(manualRan).toBe(true);
    expect(mgr.size).toBe(0);
  });

  it('clears an orphaned auto lock whose promise resolves (delete branch)', async () => {
    const mgr = new OperationLockManager();
    (mgr as any).locks.set('s', {
      operation: 'reconnect',
      promise: Promise.resolve(),
      timestamp: Date.now(),
      isAutoReconnect: true,
    } as OperationLock);

    let manualRan = false;
    await mgr.run('s', 'connect', async () => {
      manualRan = true;
    });
    expect(manualRan).toBe(true);
    expect(mgr.size).toBe(0);
  });

  it('clears an orphaned auto lock whose promise rejects (catch branch)', async () => {
    const mgr = new OperationLockManager();
    (mgr as any).locks.set('s', {
      operation: 'reconnect',
      promise: Promise.reject(new Error('auto failed')),
      timestamp: Date.now(),
      isAutoReconnect: true,
    } as OperationLock);

    let manualRan = false;
    await mgr.run('s', 'connect', async () => {
      manualRan = true;
    });
    expect(manualRan).toBe(true);
    expect(mgr.size).toBe(0);
  });

  it('does not delete a replaced lock when clear() races an in-flight run (finally skip)', async () => {
    const mgr = new OperationLockManager();
    let resolveAction!: () => void;
    const p = mgr.run(
      's',
      'connect',
      () => new Promise<void>((res) => (resolveAction = res))
    );
    expect(mgr.size).toBe(1);
    await tick();

    mgr.clear();
    expect(mgr.size).toBe(0);

    resolveAction();
    await p;
    expect(mgr.size).toBe(0);
  });

  it('aborts in-flight operation signals when clear() is called', async () => {
    const mgr = new OperationLockManager();
    let capturedSignal!: AbortSignal;
    let resolveAction!: () => void;
    const p = mgr.run(
      's',
      'reconnect',
      (signal) => {
        capturedSignal = signal;
        return new Promise<void>((res) => (resolveAction = res));
      },
      { isAutoReconnect: true }
    );
    await tick();

    mgr.clear();

    expect(capturedSignal.aborted).toBe(true);
    resolveAction();
    await p;
    expect(mgr.size).toBe(0);
  });

  it('exposes size/get/delete/clear accessors', () => {
    const mgr = new OperationLockManager();
    expect(mgr.size).toBe(0);
    expect(mgr.get('s')).toBeUndefined();

    const lock: OperationLock = {
      operation: 'connect',
      promise: Promise.resolve(),
      timestamp: Date.now(),
    };
    (mgr as any).locks.set('s', lock);
    expect(mgr.get('s')).toBe(lock);
    expect(mgr.size).toBe(1);

    mgr.delete('s');
    expect(mgr.get('s')).toBeUndefined();

    (mgr as any).locks.set('x', lock);
    mgr.clear();
    expect(mgr.size).toBe(0);
  });
});
