import { atom, type Change } from '@/atom';
import type { Companion, BuddyXPData, Milestone, BuddyEntry, Rarity, StatName } from '../../../main/lib/buddy/types';

export interface BuddyState {
  companion: Companion | null;
  xpData: BuddyXPData | null;
  reaction: { text: string } | null;
  milestone: Milestone | null;
  petAt: number;
  muted: boolean;
  minimized: boolean;
  hidden: boolean;
  loading: boolean;
  // V2 roster state
  roster: BuddyEntry[];
  activeBuddyId: string;
  userTotalTokens: number;
  levelUp: { buddyId: string; level: number; statGained: StatName } | null;
  rarityUpgrade: { buddyId: string; newRarity: Rarity } | null;
  showMainPanel: boolean;
}

export interface BuddyActions {
  set: Change<BuddyState>;
  hatch: () => Promise<Companion | undefined>;
  rename: (name: string) => Promise<Companion | undefined>;
  pet: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setMinimized: (minimized: boolean) => void;
  setHidden: (hidden: boolean) => void;
  dismissReaction: () => void;
  dismissMilestone: () => void;
  refresh: () => Promise<void>;
  // V2 actions
  setActiveBuddy: (buddyId: string) => Promise<void>;
  mergeBuddies: (keepId: string, deleteId: string) => Promise<void>;
  releaseBuddy: (buddyId: string) => Promise<void>;
  refreshRoster: () => Promise<void>;
  dismissLevelUp: () => void;
  dismissRarityUpgrade: () => void;
  setShowMainPanel: (show: boolean) => void;
}

export const BuddyAtom = atom<BuddyState, BuddyActions>({
  companion: null,
  xpData: null,
  reaction: null,
  milestone: null,
  petAt: 0,
  muted: false,
  minimized: false,
  hidden: false,
  loading: true,
  roster: [],
  activeBuddyId: '',
  userTotalTokens: 0,
  levelUp: null,
  rarityUpgrade: null,
  showMainPanel: false,
}, (get, set) => {
  const api = window.electronAPI?.buddy;
  const invoke = api?.invoke;

  async function refreshRoster() {
    if (!invoke) return;
    const res = await invoke('buddy:getRoster');
    if (res?.success && res.data) {
      set({
        ...get(),
        roster: res.data.buddies ?? [],
        activeBuddyId: res.data.activeBuddyId ?? '',
        userTotalTokens: res.data.userTotalTokens ?? 0,
      });
    }
  }

  // Initial load
  async function refresh() {
    if (!invoke) return;
    set({ ...get(), loading: true });
    try {
      const companionRes = await invoke('buddy:getCompanion');
      const xpRes = await invoke('buddy:getXPData');
      if (companionRes?.success) set({ ...get(), companion: companionRes.data ?? null });
      if (xpRes?.success && xpRes.data) set({ ...get(), xpData: xpRes.data });
      await refreshRoster();
    } finally {
      set({ ...get(), loading: false });
    }
  }

  // Actions
  async function hatch() {
    if (!invoke) return;
    const res = await invoke('buddy:hatchCompanion');
    if (res?.success && res.data) {
      set({ ...get(), companion: res.data });
      await refreshRoster();
      return res.data;
    }
  }

  async function rename(name: string) {
    if (!invoke) return;
    const res = await invoke('buddy:renameCompanion', name);
    if (res?.success && res.data) {
      set({ ...get(), companion: res.data });
      await refreshRoster();
      return res.data;
    }
  }

  async function pet() {
    if (!invoke) return;
    const res = await invoke('buddy:petCompanion');
    if (res?.success && res.data) {
      set({ ...get(), petAt: res.data.petAt });
    }
  }

  async function setMuted(m: boolean) {
    if (!invoke) return;
    const res = await invoke('buddy:setMuted', m);
    if (res?.success) {
      set({ ...get(), muted: m });
    }
  }

  // V2 actions
  const setActiveBuddy = async (buddyId: string) => {
    if (!invoke) return;
    const res = await invoke('buddy:setActiveBuddy', buddyId);
    if (res?.success && res.data) {
      set({ ...get(), companion: res.data, activeBuddyId: buddyId });
    }
  };

  const mergeBuddies = async (keepId: string, deleteId: string) => {
    if (!invoke) return;
    const res = await invoke('buddy:mergeBuddies', keepId, deleteId);
    if (res?.success) {
      await refreshRoster();
    }
  };

  const releaseBuddy = async (buddyId: string) => {
    if (!invoke) return;
    const res = await invoke('buddy:releaseBuddy', buddyId);
    if (res?.success) {
      await refreshRoster();
    }
  };

  return {
    set,
    hatch,
    refreshRoster,
    rename,
    pet,
    setMuted,
    setActiveBuddy,
    mergeBuddies,
    releaseBuddy,
    refresh,
    setMinimized: (minimized: boolean) => set({ ...get(), minimized }),
    setShowMainPanel: (showMainPanel: boolean) => set({ ...get(), showMainPanel }),
    setHidden: (hidden: boolean) => set({ ...get(), hidden }),
    dismissReaction: () => set({ ...get(), reaction: null }),
    dismissMilestone: () => set({ ...get(), milestone: null }),
    dismissLevelUp: () => set({ ...get(), levelUp: null }),
    dismissRarityUpgrade: () => set({ ...get(), rarityUpgrade: null }),
  };
});

export const HatchingCeremonyAtom = atom(false);
