/**
 * @vitest-environment happy-dom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ─────────────────────────────────────────────────────────
const mockInvoke = vi.hoisted(() => vi.fn());

// ── module mocks ──────────────────────────────────────────────────────────────
// No module-level imports to mock; the atom reads window.electronAPI directly.

// ── imports after mocks ───────────────────────────────────────────────────────
import { BuddyAtom, HatchingCeremonyAtom } from '../buddy.atom';

// ── store builder (same pattern as doctor.atom.coverage.test.ts) ──────────────
function buildStore() {
  const map: Record<string, any> = {};
  function query(atomObj: any): any {
    const key: string = atomObj.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atomObj));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find BUILD symbol on atom');
    map[key] = (atomObj as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

function setupElectronAPI() {
  (window as any).electronAPI = {
    buddy: { invoke: mockInvoke },
  };
}

function teardownElectronAPI() {
  delete (window as any).electronAPI;
}

describe('BuddyAtom', () => {
  let query: ReturnType<typeof buildStore>;
  let buddyStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
  });

  afterEach(() => {
    teardownElectronAPI();
  });

  // ── initial state ──────────────────────────────────────────────────────────
  it('initialises with correct default state', () => {
    const state = buddyStore.get();
    expect(state.companion).toBeNull();
    expect(state.xpData).toBeNull();
    expect(state.reaction).toBeNull();
    expect(state.milestone).toBeNull();
    expect(state.petAt).toBe(0);
    expect(state.muted).toBe(false);
    expect(state.minimized).toBe(false);
    expect(state.hidden).toBe(false);
    expect(state.loading).toBe(true);
    expect(state.roster).toEqual([]);
    expect(state.activeBuddyId).toBe('');
    expect(state.userTotalTokens).toBe(0);
    expect(state.levelUp).toBeNull();
    expect(state.rarityUpgrade).toBeNull();
    expect(state.showMainPanel).toBe(false);
  });

  // ── synchronous actions ────────────────────────────────────────────────────
  it('setMinimized sets minimized field', () => {
    buddyStore.actions.setMinimized(true);
    expect(buddyStore.get().minimized).toBe(true);
    buddyStore.actions.setMinimized(false);
    expect(buddyStore.get().minimized).toBe(false);
  });

  it('setHidden sets hidden field', () => {
    buddyStore.actions.setHidden(true);
    expect(buddyStore.get().hidden).toBe(true);
    buddyStore.actions.setHidden(false);
    expect(buddyStore.get().hidden).toBe(false);
  });

  it('setShowMainPanel sets showMainPanel field', () => {
    buddyStore.actions.setShowMainPanel(true);
    expect(buddyStore.get().showMainPanel).toBe(true);
    buddyStore.actions.setShowMainPanel(false);
    expect(buddyStore.get().showMainPanel).toBe(false);
  });

  it('dismissReaction clears reaction', () => {
    // Put a reaction in state via set
    buddyStore.actions.set({ ...buddyStore.get(), reaction: { text: 'hi' } });
    expect(buddyStore.get().reaction).toEqual({ text: 'hi' });
    buddyStore.actions.dismissReaction();
    expect(buddyStore.get().reaction).toBeNull();
  });

  it('dismissMilestone clears milestone', () => {
    buddyStore.actions.set({ ...buddyStore.get(), milestone: { id: 'm1' } as any });
    buddyStore.actions.dismissMilestone();
    expect(buddyStore.get().milestone).toBeNull();
  });

  it('dismissLevelUp clears levelUp', () => {
    buddyStore.actions.set({ ...buddyStore.get(), levelUp: { buddyId: 'b1', level: 2, statGained: 'strength' as any } });
    buddyStore.actions.dismissLevelUp();
    expect(buddyStore.get().levelUp).toBeNull();
  });

  it('dismissRarityUpgrade clears rarityUpgrade', () => {
    buddyStore.actions.set({ ...buddyStore.get(), rarityUpgrade: { buddyId: 'b1', newRarity: 'rare' as any } });
    buddyStore.actions.dismissRarityUpgrade();
    expect(buddyStore.get().rarityUpgrade).toBeNull();
  });

  // ── async: refresh ─────────────────────────────────────────────────────────
  it('refresh sets loading then loads companion, xpData and roster', async () => {
    const companion = { id: 'c1', name: 'Cosmo' };
    const xpData = { level: 3 };
    const rosterData = { buddies: [{ id: 'b1' }], activeBuddyId: 'b1', userTotalTokens: 100 };

    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:getCompanion') return { success: true, data: companion };
      if (channel === 'buddy:getXPData') return { success: true, data: xpData };
      if (channel === 'buddy:getRoster') return { success: true, data: rosterData };
      return { success: false };
    });

    await buddyStore.actions.refresh();

    const state = buddyStore.get();
    expect(state.loading).toBe(false);
    expect(state.companion).toEqual(companion);
    expect(state.xpData).toEqual(xpData);
    expect(state.roster).toEqual(rosterData.buddies);
    expect(state.activeBuddyId).toBe('b1');
    expect(state.userTotalTokens).toBe(100);
  });

  it('refresh handles failed companion/xp responses gracefully', async () => {
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:getRoster') return { success: true, data: { buddies: [], activeBuddyId: '', userTotalTokens: 0 } };
      return { success: false };
    });

    await buddyStore.actions.refresh();
    expect(buddyStore.get().loading).toBe(false);
  });

  it('refresh does nothing when invoke is unavailable', async () => {
    teardownElectronAPI();
    // Rebuild store without electronAPI
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.refresh();
    // loading starts as true and should remain unchanged (no invoke call)
    expect(buddyStore.get().loading).toBe(true);
  });

  // ── async: refreshRoster ───────────────────────────────────────────────────
  it('refreshRoster updates roster state', async () => {
    const rosterData = { buddies: [{ id: 'b2' }], activeBuddyId: 'b2', userTotalTokens: 50 };
    mockInvoke.mockResolvedValue({ success: true, data: rosterData });

    await buddyStore.actions.refreshRoster();

    const state = buddyStore.get();
    expect(state.roster).toEqual(rosterData.buddies);
    expect(state.activeBuddyId).toBe('b2');
    expect(state.userTotalTokens).toBe(50);
  });

  it('refreshRoster does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    const before = buddyStore.get().roster;
    await buddyStore.actions.refreshRoster();
    expect(buddyStore.get().roster).toEqual(before);
  });

  it('refreshRoster does nothing when response is unsuccessful', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.refreshRoster();
    expect(buddyStore.get().roster).toEqual([]);
  });

  // ── async: hatch ──────────────────────────────────────────────────────────
  it('hatch updates companion and returns data', async () => {
    const newCompanion = { id: 'c2', name: 'Nova' };
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:hatchCompanion') return { success: true, data: newCompanion };
      if (channel === 'buddy:getRoster') return { success: true, data: { buddies: [], activeBuddyId: '', userTotalTokens: 0 } };
      return { success: false };
    });

    const result = await buddyStore.actions.hatch();
    expect(result).toEqual(newCompanion);
    expect(buddyStore.get().companion).toEqual(newCompanion);
  });

  it('hatch returns undefined on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    const result = await buddyStore.actions.hatch();
    expect(result).toBeUndefined();
  });

  it('hatch returns undefined when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    const result = await buddyStore.actions.hatch();
    expect(result).toBeUndefined();
  });

  // ── async: rename ─────────────────────────────────────────────────────────
  it('rename updates companion and returns data', async () => {
    const renamed = { id: 'c1', name: 'Sparky' };
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:renameCompanion') return { success: true, data: renamed };
      if (channel === 'buddy:getRoster') return { success: true, data: { buddies: [], activeBuddyId: '', userTotalTokens: 0 } };
      return { success: false };
    });

    const result = await buddyStore.actions.rename('Sparky');
    expect(result).toEqual(renamed);
    expect(buddyStore.get().companion).toEqual(renamed);
  });

  it('rename returns undefined when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    const result = await buddyStore.actions.rename('x');
    expect(result).toBeUndefined();
  });

  it('rename returns undefined on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    const result = await buddyStore.actions.rename('x');
    expect(result).toBeUndefined();
  });

  // ── async: pet ────────────────────────────────────────────────────────────
  it('pet updates petAt when successful', async () => {
    mockInvoke.mockResolvedValue({ success: true, data: { petAt: 9999 } });
    await buddyStore.actions.pet();
    expect(buddyStore.get().petAt).toBe(9999);
  });

  it('pet does nothing on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.pet();
    expect(buddyStore.get().petAt).toBe(0);
  });

  it('pet does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.pet();
    expect(buddyStore.get().petAt).toBe(0);
  });

  // ── async: setMuted ───────────────────────────────────────────────────────
  it('setMuted updates muted state when successful', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    await buddyStore.actions.setMuted(true);
    expect(buddyStore.get().muted).toBe(true);
    await buddyStore.actions.setMuted(false);
    expect(buddyStore.get().muted).toBe(false);
  });

  it('setMuted does nothing on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.setMuted(true);
    expect(buddyStore.get().muted).toBe(false);
  });

  it('setMuted does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.setMuted(true);
    expect(buddyStore.get().muted).toBe(false);
  });

  // ── async: setActiveBuddy ─────────────────────────────────────────────────
  it('setActiveBuddy updates companion and activeBuddyId', async () => {
    const companion = { id: 'b3', name: 'Titan' };
    mockInvoke.mockResolvedValue({ success: true, data: companion });
    await buddyStore.actions.setActiveBuddy('b3');
    expect(buddyStore.get().companion).toEqual(companion);
    expect(buddyStore.get().activeBuddyId).toBe('b3');
  });

  it('setActiveBuddy does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.setActiveBuddy('b3');
    expect(buddyStore.get().activeBuddyId).toBe('');
  });

  it('setActiveBuddy does nothing on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.setActiveBuddy('b3');
    expect(buddyStore.get().activeBuddyId).toBe('');
  });

  // ── async: mergeBuddies ───────────────────────────────────────────────────
  it('mergeBuddies refreshes roster on success', async () => {
    const rosterData = { buddies: [{ id: 'keep' }], activeBuddyId: 'keep', userTotalTokens: 0 };
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:mergeBuddies') return { success: true };
      if (channel === 'buddy:getRoster') return { success: true, data: rosterData };
      return { success: false };
    });

    await buddyStore.actions.mergeBuddies('keep', 'del');
    expect(buddyStore.get().roster).toEqual(rosterData.buddies);
  });

  it('mergeBuddies does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.mergeBuddies('a', 'b');
    expect(buddyStore.get().roster).toEqual([]);
  });

  it('mergeBuddies does nothing on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.mergeBuddies('a', 'b');
    // roster not changed; no roster call made
    expect(mockInvoke).toHaveBeenCalledWith('buddy:mergeBuddies', 'a', 'b');
  });

  // ── async: releaseBuddy ───────────────────────────────────────────────────
  it('releaseBuddy refreshes roster on success', async () => {
    const rosterData = { buddies: [], activeBuddyId: '', userTotalTokens: 0 };
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'buddy:releaseBuddy') return { success: true };
      if (channel === 'buddy:getRoster') return { success: true, data: rosterData };
      return { success: false };
    });

    await buddyStore.actions.releaseBuddy('b1');
    expect(buddyStore.get().roster).toEqual([]);
  });

  it('releaseBuddy does nothing when invoke unavailable', async () => {
    teardownElectronAPI();
    query = buildStore();
    buddyStore = query(BuddyAtom);
    await buddyStore.actions.releaseBuddy('b1');
    expect(buddyStore.get().roster).toEqual([]);
  });

  it('releaseBuddy does nothing on failure', async () => {
    mockInvoke.mockResolvedValue({ success: false });
    await buddyStore.actions.releaseBuddy('b1');
    expect(mockInvoke).toHaveBeenCalledWith('buddy:releaseBuddy', 'b1');
  });
});

describe('HatchingCeremonyAtom', () => {
  it('initialises as false', () => {
    const query = buildStore();
    const store = query(HatchingCeremonyAtom);
    expect(store.get()).toBe(false);
  });

  it('can be changed to true', () => {
    const query = buildStore();
    const store = query(HatchingCeremonyAtom);
    store.change(true);
    expect(store.get()).toBe(true);
  });
});
