/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the generic SidecarListCacheManager (sidecar
 * renderer-normalization Phase 2b). Direct instantiation with fake options
 * drives every conditional arm of the shared full-list-replace plumbing.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  SidecarListCacheManager,
  type ListPullResult,
  type SidecarListCacheOptions,
} from '../sidecarListCacheManager';

type Item = { id: string };

let capturedHandler: ((payload: any) => void) | null;
let unsubSpy: ReturnType<typeof vi.fn>;

function makeOptions(overrides?: Partial<SidecarListCacheOptions<Item>>): SidecarListCacheOptions<Item> {
  capturedHandler = null;
  unsubSpy = vi.fn();
  return {
    label: 'Test',
    pull: vi.fn(async () => ({ success: true, data: [] as Item[] })),
    subscribeRaw: vi.fn((handler: (p: any) => void) => {
      capturedHandler = handler;
      return unsubSpy as unknown as () => void;
    }),
    extractItems: (payload: any) => payload?.items ?? payload?.data,
    ...overrides,
  };
}

const a = { id: 'a' };
const b = { id: 'b' };

describe('SidecarListCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the change listener at construction', () => {
    const opts = makeOptions();
    new SidecarListCacheManager(opts);
    expect(opts.subscribeRaw).toHaveBeenCalledTimes(1);
    expect(capturedHandler).toBeTypeOf('function');
  });

  it('warns (no cleanup) when subscribeRaw returns undefined', () => {
    const opts = makeOptions({ subscribeRaw: vi.fn(() => undefined) });
    const mgr = new SidecarListCacheManager(opts);
    expect(() => mgr.cleanup()).not.toThrow();
  });

  it('initialize() replaces items from a successful pull', async () => {
    const opts = makeOptions({ pull: vi.fn(async () => ({ success: true, data: [a, b] })) });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    expect(mgr.getItems()).toEqual([a, b]);
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() skips a success=false pull but marks initialized', async () => {
    const opts = makeOptions({ pull: vi.fn(async () => ({ success: false })) });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    expect(mgr.getItems()).toEqual([]);
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() skips when extractItems yields a non-array', async () => {
    const opts = makeOptions({
      pull: vi.fn(async () => ({ success: true, data: undefined })),
      extractItems: () => 'nope' as any,
    });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    expect(mgr.getItems()).toEqual([]);
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() tolerates a pull returning undefined', async () => {
    const opts = makeOptions({ pull: vi.fn(() => undefined) });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() catches a rejected pull, leaving isInitialized false', async () => {
    const opts = makeOptions({
      pull: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(false);
  });

  it('applies a change push for the initialized alias', async () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    const listener = vi.fn();
    mgr.subscribe(listener);
    capturedHandler!({ alias: 'alice', items: [a] });
    expect(mgr.getItems()).toEqual([a]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a push for a different alias', async () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    capturedHandler!({ alias: 'bob', items: [a] });
    expect(mgr.getItems()).toEqual([]);
  });

  it('ignores a push before initialize (alias unset)', () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    capturedHandler!({ alias: 'whoever', items: [b] });
    expect(mgr.getItems()).toEqual([]);
  });

  it('ignores a push whose extracted items is not an array', () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    capturedHandler!({ alias: 'x', items: 'nope' });
    expect(mgr.getItems()).toEqual([]);
  });

  it('subscribe() unsubscribe removes the listener and is idempotent', () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);
    unsub();
    unsub();
    capturedHandler!({ alias: 'x', items: [a] });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifyListeners swallows a throwing listener', async () => {
    const opts = makeOptions();
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('x');
    const bad = vi.fn(() => {
      throw new Error('listener boom');
    });
    const good = vi.fn();
    mgr.subscribe(bad);
    mgr.subscribe(good);
    expect(() => capturedHandler!({ alias: 'x', items: [a] })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('cleanup() clears cached data and notifies subscribers while preserving the listener and subscribers', async () => {
    const opts = makeOptions({ pull: vi.fn(async () => ({ success: true, data: [a] })) });
    const mgr = new SidecarListCacheManager(opts);
    await mgr.initialize('alice');
    const listener = vi.fn();
    mgr.subscribe(listener);

    mgr.cleanup();

    expect(mgr.getItems()).toEqual([]);
    expect(mgr.getCache().isInitialized).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(unsubSpy).not.toHaveBeenCalled();
    // The IPC handler is still installed, but stale pushes for the signed-out
    // alias are ignored until initialize() binds a new alias.
    capturedHandler!({ alias: 'alice', items: [a] });
    expect(mgr.getItems()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('initialize() drops previous alias items and ignores stale pulls', async () => {
    let resolveAlice!: (value: ListPullResult<Item>) => void;
    const alicePull = new Promise<ListPullResult<Item>>((resolve) => { resolveAlice = resolve; });
    const opts = makeOptions({
      pull: vi.fn(async (alias: string) => (alias === 'alice' ? alicePull : { success: true, data: [b] })),
    });
    const mgr = new SidecarListCacheManager(opts);

    const alicePending = mgr.initialize('alice');
    const bobPending = mgr.initialize('bob');
    await bobPending;
    expect(mgr.getItems()).toEqual([b]);
    resolveAlice({ success: true, data: [a] });
    await alicePending;
    expect(mgr.getItems()).toEqual([b]);
  });

  it('cleanup() does not tear down a throwing unsubscribe function', () => {
    const throwingUnsub = vi.fn(() => {
      throw new Error('unsub boom');
    });
    const opts = makeOptions({
      subscribeRaw: vi.fn(() => throwingUnsub),
    });
    const mgr = new SidecarListCacheManager(opts);
    expect(() => mgr.cleanup()).not.toThrow();
    expect(throwingUnsub).not.toHaveBeenCalled();
  });
});
