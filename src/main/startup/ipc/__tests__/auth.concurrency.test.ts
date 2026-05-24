/**
 * Tests for the scheduler init/dispose concurrency contract.
 *
 * These tests verify the promise-chaining pattern used in auth IPC to ensure:
 * 1. Sign-out waits for background init to complete before disposing
 * 2. Rapid sign-in/sign-out cycles chain correctly (no lost promises)
 * 3. Init failure does not block sign-out
 *
 * We test the contract directly rather than through the full auth IPC handler
 * to avoid mocking the entire Electron/analytics/auth stack.
 */

interface MockContext {
  _schedulerInitPromise?: Promise<void>;
  currentUserAlias: string | null;
}

/**
 * Simulates the fire-and-forget init pattern from auth:setCurrentSession.
 * This mirrors the exact logic in auth.ts lines 59-82.
 */
function simulateSetCurrentSession(
  ctx: MockContext,
  userLogin: string,
  initializeFn: (alias: string) => Promise<void>,
): void {
  const previousInit = ctx._schedulerInitPromise ?? Promise.resolve();
  ctx._schedulerInitPromise = previousInit.then(() =>
    initializeFn(userLogin).catch(() => {
      // Mirrors .catch() in auth.ts — swallows init errors
    }),
  );
  ctx.currentUserAlias = userLogin;
}

/**
 * Simulates the dispose pattern from auth:destroyCurrentSession.
 * Mirrors auth.ts: captures targetAlias, awaits init, checks alias before destroying.
 */
async function simulateDestroyCurrentSession(
  ctx: MockContext,
  disposeFn: () => Promise<void>,
): Promise<{ aborted: boolean }> {
  const targetAlias = ctx.currentUserAlias;

  const capturedInitPromise = ctx._schedulerInitPromise;
  if (capturedInitPromise) {
    await capturedInitPromise;
    if (ctx._schedulerInitPromise === capturedInitPromise) {
      ctx._schedulerInitPromise = undefined;
    }
  }

  if (ctx.currentUserAlias !== targetAlias) {
    return { aborted: true };
  }

  await disposeFn();
  ctx.currentUserAlias = null;
  return { aborted: false };
}

describe('scheduler init/dispose concurrency contract', () => {
  let ctx: MockContext;
  let initOrder: string[];
  let disposeOrder: string[];

  beforeEach(() => {
    ctx = { _schedulerInitPromise: undefined, currentUserAlias: null };
    initOrder = [];
    disposeOrder = [];
  });

  it('setCurrentSession does not block — returns before init completes', () => {
    let initResolved = false;
    const initFn = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          initResolved = true;
          resolve();
        }, 100),
      );

    simulateSetCurrentSession(ctx, 'userA', initFn);

    // Init has not completed yet
    expect(initResolved).toBe(false);
    expect(ctx._schedulerInitPromise).toBeDefined();
    expect(ctx.currentUserAlias).toBe('userA');
  });

  it('destroyCurrentSession waits for init to complete before disposing', async () => {
    let initResolve: () => void;
    const initFn = () => new Promise<void>((r) => { initResolve = r; });
    const disposeFn = vi.fn().mockResolvedValue(undefined);

    simulateSetCurrentSession(ctx, 'userA', initFn);

    // Start destroy — should block
    let destroyDone = false;
    const destroyPromise = simulateDestroyCurrentSession(ctx, disposeFn).then(() => {
      destroyDone = true;
    });

    // Let microtasks run
    await new Promise((r) => setImmediate(r));
    expect(destroyDone).toBe(false);
    expect(disposeFn).not.toHaveBeenCalled();

    // Complete init
    initResolve!();
    await destroyPromise;

    expect(destroyDone).toBe(true);
    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(ctx.currentUserAlias).toBeNull();
    expect(ctx._schedulerInitPromise).toBeUndefined();
  });

  it('rapid login A → logout → login B: logout aborts because B already took over', async () => {
    let initAResolve: () => void;
    let initBResolve: () => void;

    const initA = () => new Promise<void>((r) => {
      initAResolve = r;
    });
    const initB = () => new Promise<void>((r) => {
      initBResolve = r;
    });

    const disposeFn = vi.fn().mockResolvedValue(undefined);

    // Login A
    simulateSetCurrentSession(ctx, 'userA', (alias) => {
      initOrder.push(`init-${alias}-start`);
      return initA().then(() => { initOrder.push(`init-${alias}-end`); });
    });

    // Let A's init callback start
    await new Promise((r) => setImmediate(r));

    // Logout (waits for A's init)
    const logoutPromise = simulateDestroyCurrentSession(ctx, async () => {
      disposeOrder.push('dispose-A');
      await disposeFn();
    });

    // Login B immediately (before logout finishes) — changes currentUserAlias
    simulateSetCurrentSession(ctx, 'userB', (alias) => {
      initOrder.push(`init-${alias}-start`);
      return initB().then(() => { initOrder.push(`init-${alias}-end`); });
    });
    expect(ctx.currentUserAlias).toBe('userB');

    // A's init hasn't completed yet — logout is blocked
    await new Promise((r) => setImmediate(r));
    expect(disposeOrder).toEqual([]);

    // Complete A's init → logout detects alias changed, aborts without disposing
    initAResolve!();
    const result = await logoutPromise;
    expect(result.aborted).toBe(true);
    expect(disposeOrder).toEqual([]);
    expect(disposeFn).not.toHaveBeenCalled();
    expect(ctx.currentUserAlias).toBe('userB');

    // B's init is chained after A's, should now be running
    await new Promise((r) => setImmediate(r));
    expect(initOrder).toContain('init-userA-start');
    expect(initOrder).toContain('init-userA-end');

    // Complete B's init
    initBResolve!();
    await ctx._schedulerInitPromise;
    expect(initOrder).toContain('init-userB-start');
    expect(initOrder).toContain('init-userB-end');
  });

  it('init failure does not block sign-out', async () => {
    const initFn = () => Promise.reject(new Error('init boom'));
    const disposeFn = vi.fn().mockResolvedValue(undefined);

    simulateSetCurrentSession(ctx, 'userA', initFn);

    // Even though init failed, destroy should succeed
    await simulateDestroyCurrentSession(ctx, disposeFn);
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('multiple rapid sign-ins chain and all complete in order', async () => {
    const resolvers: (() => void)[] = [];
    const makeInit = (alias: string) => () => {
      initOrder.push(`${alias}-start`);
      return new Promise<void>((r) => {
        resolvers.push(() => {
          initOrder.push(`${alias}-end`);
          r();
        });
      });
    };

    simulateSetCurrentSession(ctx, 'A', makeInit('A'));
    simulateSetCurrentSession(ctx, 'B', makeInit('B'));
    simulateSetCurrentSession(ctx, 'C', makeInit('C'));

    // Nothing started yet except A (B and C are chained)
    await new Promise((r) => setImmediate(r));
    expect(initOrder).toEqual(['A-start']);

    // Resolve A → B starts
    resolvers[0]();
    await new Promise((r) => setImmediate(r));
    expect(initOrder).toEqual(['A-start', 'A-end', 'B-start']);

    // Resolve B → C starts
    resolvers[1]();
    await new Promise((r) => setImmediate(r));
    expect(initOrder).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start']);

    // Resolve C
    resolvers[2]();
    await ctx._schedulerInitPromise;
    expect(initOrder).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end']);
  });

  it('stale logout does not destroy new user session (login A → logout A → login B during wait)', async () => {
    let initAResolve: () => void;
    const initA = () => new Promise<void>((r) => { initAResolve = r; });
    const disposeFn = vi.fn().mockResolvedValue(undefined);

    // Login A
    simulateSetCurrentSession(ctx, 'userA', initA);
    expect(ctx.currentUserAlias).toBe('userA');

    // Let the chained promise start (initA callback needs a microtick to fire)
    await new Promise((r) => setImmediate(r));

    // Start logout for A — will block waiting for A's init
    const logoutPromise = simulateDestroyCurrentSession(ctx, disposeFn);

    // While logout waits, login B succeeds (setCurrentSession is sync for alias)
    simulateSetCurrentSession(ctx, 'userB', () => Promise.resolve());
    expect(ctx.currentUserAlias).toBe('userB');

    // Now resolve A's init — logout should detect alias changed and abort
    initAResolve!();
    const result = await logoutPromise;

    expect(result.aborted).toBe(true);
    expect(disposeFn).not.toHaveBeenCalled();
    expect(ctx.currentUserAlias).toBe('userB');
  });

  it('stale logout preserves B init promise so subsequent logout B still waits', async () => {
    let initAResolve: () => void;
    let initBResolve: () => void;

    const initA = () => new Promise<void>((r) => { initAResolve = r; });
    const initB = () => new Promise<void>((r) => { initBResolve = r; });
    const disposeFn = vi.fn().mockResolvedValue(undefined);

    // Login A (slow init)
    simulateSetCurrentSession(ctx, 'userA', initA);
    await new Promise((r) => setImmediate(r));

    // Start logout A — blocks on A's init
    const logoutAPromise = simulateDestroyCurrentSession(ctx, disposeFn);

    // Login B while logout A is waiting — B chains onto A
    simulateSetCurrentSession(ctx, 'userB', initB);
    expect(ctx.currentUserAlias).toBe('userB');

    // Resolve A's init → logout A aborts (alias changed)
    initAResolve!();
    const resultA = await logoutAPromise;
    expect(resultA.aborted).toBe(true);

    // Key assertion: B's init promise is still tracked, NOT cleared by stale logout
    expect(ctx._schedulerInitPromise).toBeDefined();

    // Now logout B — should wait for B's init
    let logoutBDone = false;
    const logoutBPromise = simulateDestroyCurrentSession(ctx, disposeFn).then((r) => {
      logoutBDone = true;
      return r;
    });

    await new Promise((r) => setImmediate(r));
    expect(logoutBDone).toBe(false); // still waiting for B's init

    // Resolve B's init → logout B proceeds
    initBResolve!();
    const resultB = await logoutBPromise;

    expect(resultB.aborted).toBe(false);
    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(ctx.currentUserAlias).toBeNull();
  });
});
