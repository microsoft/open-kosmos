import { useEffect, useRef } from 'react';
import type { Companion, BuddyXPData, Milestone, Rarity, StatName } from '../../../main/lib/buddy/types';
import { BuddyAtom } from './buddy.atom';

export function useBuddyIPC() {
  const [state, actions] = BuddyAtom.use();
  const { activeBuddyId } = state;
  const { refresh, set } = actions;

  const activeBuddyIdRef = useRef('');

  // Keep ref in sync with state (so event handlers in closures have current value)
  useEffect(() => {
    activeBuddyIdRef.current = activeBuddyId;
  }, [activeBuddyId]);

  const api = window.electronAPI?.buddy;
  const on = api?.on;
  const off = api?.off;

  // Subscribe to main→render events
  useEffect(() => {
    if (!on || !off) return;

    const handleCompanionUpdated = (_event: unknown, data: Companion) => {
      set(s => ({ ...s, companion: data }));
    };
    const handleXPUpdated = (_event: unknown, data: BuddyXPData) => {
      set((prev) => ({
        ...prev,
        xpData: data,
        // Also update the active buddy's XP in the local roster so stats modal reflects it
        roster: prev.roster.map((b) => (b.id === activeBuddyIdRef.current ? { ...b, xp: data.totalXP } : b)),
      }));
    };
    const handleReaction = (_event: unknown, data: { text: string }) => {
      set(s => ({ ...s, reaction: data }));
    };
    const handleMilestone = (_event: unknown, data: Milestone) => {
      set(s => ({ ...s, milestone: data }));
    };
    const handleLevelUp = (_event: unknown, data: { buddyId: string; level: number; statGained: StatName }) => {
      set(s => ({ ...s, levelUp: data }));
    };
    const handleRarityUpgraded = (_event: unknown, data: { buddyId: string; newRarity: Rarity }) => {
      set(s => ({ ...s, rarityUpgrade: data }));
    };

    on('buddy:companion-updated', handleCompanionUpdated);
    on('buddy:xp-updated', handleXPUpdated);
    on('buddy:reaction', handleReaction);
    on('buddy:milestone', handleMilestone);
    on('buddy:level-up', handleLevelUp);
    on('buddy:rarity-upgraded', handleRarityUpgraded);

    return () => {
      off('buddy:companion-updated', handleCompanionUpdated);
      off('buddy:xp-updated', handleXPUpdated);
      off('buddy:reaction', handleReaction);
      off('buddy:milestone', handleMilestone);
      off('buddy:level-up', handleLevelUp);
      off('buddy:rarity-upgraded', handleRarityUpgraded);
    };
  }, [on, off]);

  useEffect(() => { refresh(); }, []);

  return { state, actions };
}
