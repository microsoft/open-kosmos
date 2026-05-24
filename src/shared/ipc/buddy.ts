import { connectRenderToMain, connectMainToRender } from './base';
import type { Companion, BuddyXPData, BuddyEntry, Rarity, StatName } from '../../main/lib/buddy/types';

// ──────────────────────────────────────────────
// Renderer → Main (invoke/handle)
// ──────────────────────────────────────────────

type BuddyRenderToMain = {
  getCompanion: {
    call: [];
    return: { success: boolean; data?: Companion | null; error?: string };
  };
  hatchCompanion: {
    call: [];
    return: { success: boolean; data?: Companion; error?: string };
  };
  renameCompanion: {
    call: [name: string];
    return: { success: boolean; data?: Companion; error?: string };
  };
  petCompanion: {
    call: [];
    return: { success: boolean; data?: { petAt: number }; error?: string };
  };
  getXPData: {
    call: [];
    return: { success: boolean; data?: BuddyXPData; error?: string };
  };
  setMuted: {
    call: [muted: boolean];
    return: { success: boolean; error?: string };
  };
  triggerReaction: {
    call: [lastUserMsg: string, lastAssistantMsg: string];
    return: { success: boolean; data?: { text: string } | null; error?: string };
  };
  getRoster: {
    call: [];
    return: {
      success: boolean;
      data?: { buddies: BuddyEntry[]; activeBuddyId: string; userTotalTokens: number };
      error?: string;
    };
  };
  setActiveBuddy: {
    call: [buddyId: string];
    return: { success: boolean; data?: Companion; error?: string };
  };
  mergeBuddies: {
    call: [keepId: string, deleteId: string];
    return: { success: boolean; data?: { buddy: BuddyEntry; newRarity: Rarity }; error?: string };
  };
  releaseBuddy: {
    call: [buddyId: string];
    return: { success: boolean; error?: string };
  };
};

// ──────────────────────────────────────────────
// Main → Renderer (send/on)
// ──────────────────────────────────────────────

type BuddyMainToRender = {
  'companion-updated': Companion;
  'xp-updated': BuddyXPData;
  reaction: { text: string };
  milestone: { name: string; threshold: number };
  'level-up': { buddyId: string; level: number; statGained: StatName };
  'rarity-upgraded': { buddyId: string; newRarity: Rarity };
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<BuddyRenderToMain>('buddy');
export const mainToRender = connectMainToRender<BuddyMainToRender>('buddy');
