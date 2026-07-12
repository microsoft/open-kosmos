/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the renderer AgentClientCacheManager (sidecar
 * renderer-normalization Phase 2a). Exercises the singleton, IPC pull/push
 * wiring, alias filtering, cache replacement, read accessors, and teardown,
 * driving every conditional arm to keep branch coverage above 90%.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentsChangedPayload } from '../agentClientCacheManager';

type PushCb = (data: AgentsChangedPayload) => void;

let capturedPush: PushCb | null = null;
let unsubSpy: ReturnType<typeof vi.fn>;

function setupElectronAPI(opts?: {
  getRegisteredAgents?: any;
  omitGetRegistered?: boolean;
  omitOnChanged?: boolean;
}) {
  capturedPush = null;
  unsubSpy = vi.fn();
  const profile: any = {};
  if (!opts?.omitGetRegistered) {
    profile.getRegisteredAgents = vi.fn(
      async () => opts?.getRegisteredAgents ?? { success: true, data: [] },
    );
  }
  if (!opts?.omitOnChanged) {
    profile.onAgentsChanged = vi.fn((cb: PushCb) => {
      capturedPush = cb;
      return unsubSpy;
    });
  }
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { profile },
  });
}

async function freshManager() {
  vi.resetModules();
  const mod = await import('../agentClientCacheManager');
  return mod.agentClientCacheManager;
}

const agentA = { id: 'a1', name: 'Alpha', model: 'm1' } as any;
const agentB = { id: 'b2', name: 'Beta', model: 'm2' } as any;

describe('AgentClientCacheManager', () => {
  beforeEach(() => {
    setupElectronAPI();
  });

  it('getInstance() returns the same instance', async () => {
    vi.resetModules();
    const mod = await import('../agentClientCacheManager');
    expect(mod.AgentClientCacheManager.getInstance()).toBe(
      mod.AgentClientCacheManager.getInstance(),
    );
  });

  it('registers the onAgentsChanged listener at construction', async () => {
    await freshManager();
    expect((window as any).electronAPI.profile.onAgentsChanged).toHaveBeenCalledTimes(1);
    expect(capturedPush).toBeTypeOf('function');
  });

  it('warns (no listener) when onAgentsChanged is unavailable', async () => {
    setupElectronAPI({ omitOnChanged: true });
    const mgr = await freshManager();
    // No push wired; cleanup still notifies its (empty) subscriber set and must not throw.
    expect(() => mgr.cleanup()).not.toThrow();
  });

  it('initialize() populates the cache from getRegisteredAgents', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: true, data: [agentA, agentB] } });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(true);
    expect(mgr.getAllAgents()).toHaveLength(2);
    expect(mgr.getAgent('a1')).toEqual(agentA);
  });

  it('initialize() marks initialized but keeps cache empty when success=false', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: false, data: null } });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(true);
    expect(mgr.getAllAgents()).toHaveLength(0);
  });

  it('initialize() ignores non-array data', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: true, data: { not: 'array' } } });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getAllAgents()).toHaveLength(0);
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() tolerates a missing getRegisteredAgents API', async () => {
    setupElectronAPI({ omitGetRegistered: true });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(true);
  });

  it('initialize() catches a rejected pull and leaves isInitialized false', async () => {
    setupElectronAPI();
    (window as any).electronAPI.profile.getRegisteredAgents = vi.fn(async () => {
      throw new Error('boom');
    });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getCache().isInitialized).toBe(false);
    expect(mgr.getAllAgents()).toHaveLength(0);
  });

  it('applies an agents:changed push for the initialized alias', async () => {
    const mgr = await freshManager();
    await mgr.initialize('alice');
    const listener = vi.fn();
    mgr.subscribe(listener);
    capturedPush!({ alias: 'alice', agents: [agentA], timestamp: 1 });
    expect(mgr.getAllAgents()).toEqual([agentA]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a push for a different alias', async () => {
    const mgr = await freshManager();
    await mgr.initialize('alice');
    capturedPush!({ alias: 'bob', agents: [agentA], timestamp: 1 });
    expect(mgr.getAllAgents()).toHaveLength(0);
  });

  it('ignores a push before initialize (alias unset)', async () => {
    const mgr = await freshManager();
    capturedPush!({ alias: 'whoever', agents: [agentB], timestamp: 2 });
    expect(mgr.getAgent('b2')).toBeNull();
  });

  it('ignores a push with a non-array agents field', async () => {
    const mgr = await freshManager();
    await mgr.initialize('alice');
    capturedPush!({ alias: 'alice', agents: undefined as any, timestamp: 3 });
    expect(mgr.getAllAgents()).toHaveLength(0);
  });

  it('ignores a null push payload', async () => {
    const mgr = await freshManager();
    await mgr.initialize('alice');
    capturedPush!(null as any);
    expect(mgr.getAllAgents()).toHaveLength(0);
  });

  it('drops agents without an id when replacing the cache', async () => {
    const mgr = await freshManager();
    await mgr.initialize('x');
    capturedPush!({
      alias: 'x',
      agents: [agentA, { name: 'no-id' } as any, null as any],
      timestamp: 4,
    });
    expect(mgr.getAllAgents()).toEqual([agentA]);
  });

  it('subscribe() unsubscribe removes the listener and is idempotent', async () => {
    const mgr = await freshManager();
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);
    unsub();
    unsub(); // index === -1, no splice
    capturedPush!({ alias: 'x', agents: [agentA], timestamp: 5 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifyListeners swallows a throwing listener', async () => {
    const mgr = await freshManager();
    await mgr.initialize('x');
    const bad = vi.fn(() => {
      throw new Error('listener boom');
    });
    const good = vi.fn();
    mgr.subscribe(bad);
    mgr.subscribe(good);
    expect(() =>
      capturedPush!({ alias: 'x', agents: [agentA], timestamp: 6 }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('getAgent() returns null for empty/unknown ids', async () => {
    const mgr = await freshManager();
    await mgr.initialize('x');
    capturedPush!({ alias: 'x', agents: [agentA], timestamp: 7 });
    expect(mgr.getAgent(undefined)).toBeNull();
    expect(mgr.getAgent('')).toBeNull();
    expect(mgr.getAgent('missing')).toBeNull();
  });

  it('getAgents() resolves ids in order and drops misses', async () => {
    const mgr = await freshManager();
    await mgr.initialize('x');
    capturedPush!({ alias: 'x', agents: [agentA, agentB], timestamp: 8 });
    expect(mgr.getAgents(['b2', 'missing', 'a1'])).toEqual([agentB, agentA]);
    expect(mgr.getAgents(undefined)).toEqual([]);
    expect(mgr.getAgents(null)).toEqual([]);
  });

  it('cleanup() clears cached data and notifies subscribers while preserving the IPC listener and subscribers', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: true, data: [agentA, agentB] } });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getAllAgents()).toHaveLength(2);
    const listener = vi.fn();
    mgr.subscribe(listener);

    mgr.cleanup();

    // Signed-out data dropped and subscribers notified with the empty snapshot.
    expect(mgr.getAllAgents()).toHaveLength(0);
    expect(mgr.getCache().isInitialized).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ agents: [], isInitialized: false }),
    );
    // IPC push listener and subscriber are preserved, but signed-out stale pushes
    // are ignored until initialize() binds a new alias.
    expect(unsubSpy).not.toHaveBeenCalled();
    capturedPush!({ alias: 'alice', agents: [agentA], timestamp: 9 });
    expect(mgr.getAllAgents()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('initialize() drops the previous alias agents before the async pull when the alias changes', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: true, data: [agentA] } });
    const mgr = await freshManager();
    await mgr.initialize('alice');
    expect(mgr.getAgent('a1')).toEqual(agentA);

    (window as any).electronAPI.profile.getRegisteredAgents = vi.fn(
      async () => ({ success: true, data: [agentB] }),
    );
    const pending = mgr.initialize('bob');
    // The stale alias's agents are cleared synchronously, before the pull awaits.
    expect(mgr.getAgent('a1')).toBeNull();
    await pending;
    expect(mgr.getAgent('a1')).toBeNull();
    expect(mgr.getAgent('b2')).toEqual(agentB);
  });

  it('initialize() keeps the cache on a same-alias re-init (no pre-pull flush)', async () => {
    setupElectronAPI({ getRegisteredAgents: { success: true, data: [agentA] } });
    const mgr = await freshManager();
    await mgr.initialize('alice');

    (window as any).electronAPI.profile.getRegisteredAgents = vi.fn(
      async () => ({ success: true, data: [agentA] }),
    );
    const pending = mgr.initialize('alice');
    // Same alias: the clear branch is skipped, so the agent is not flushed.
    expect(mgr.getAgent('a1')).toEqual(agentA);
    await pending;
    expect(mgr.getAgent('a1')).toEqual(agentA);
  });

  it('initialize() ignores a stale cross-alias pull that resolves after a newer alias switch', async () => {
    // Race: alice's pull is still in flight when we switch to bob. Once alice's
    // response finally resolves it must NOT clobber bob's cache — the post-await
    // alias recheck bails on the superseded pull (same guard the push handler uses).
    let resolveAlice!: (v: any) => void;
    const alicePull = new Promise((r) => { resolveAlice = r; });
    setupElectronAPI();
    const mgr = await freshManager();
    (window as any).electronAPI.profile.getRegisteredAgents = vi.fn(
      async (alias: string) => (alias === 'alice' ? alicePull : { success: true, data: [agentB] }),
    );

    const alicePending = mgr.initialize('alice'); // suspends on alicePull
    const bobPending = mgr.initialize('bob');      // switches active alias to bob
    await bobPending;
    expect(mgr.getAgent('b2')).toEqual(agentB);

    // Alice's stale pull now resolves with agentA — must be ignored.
    resolveAlice({ success: true, data: [agentA] });
    await alicePending;
    expect(mgr.getAgent('a1')).toBeNull();
    expect(mgr.getAgent('b2')).toEqual(agentB);
  });
});
