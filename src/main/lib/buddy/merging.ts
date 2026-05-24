import type { BuddyEntry, Rarity } from './types';
import { RARITY_MAX_LEVEL, nextRarity } from './types';
import { roll } from './companion';
import { xpToLevel } from './leveling';

export interface MergeValidation {
  valid: boolean;
  error?: string;
}

export interface MergeResult {
  updatedRoster: BuddyEntry[];
  updatedBuddy: BuddyEntry;
  newRarity: Rarity;
}

export function validateMerge(kept: BuddyEntry, deleted: BuddyEntry): MergeValidation {
  if (kept.id === deleted.id) {
    return { valid: false, error: 'Cannot merge a buddy with itself' };
  }

  if (kept.rarity === 'legendary') {
    return { valid: false, error: 'Legendary buddies are already at maximum rarity' };
  }

  if (kept.rarity !== deleted.rarity) {
    return { valid: false, error: 'Must be same species and same rarity' };
  }

  const keptSpecies = roll(kept.seed).bones.species;
  const deletedSpecies = roll(deleted.seed).bones.species;
  if (keptSpecies !== deletedSpecies) {
    return { valid: false, error: 'Must be same species and same rarity' };
  }

  const maxLevel = RARITY_MAX_LEVEL[kept.rarity];
  const currentLevel = xpToLevel(kept.xp);
  if (currentLevel < maxLevel) {
    return { valid: false, error: `Must reach Lv.${maxLevel} before merging` };
  }

  return { valid: true };
}

export function executeMerge(
  roster: BuddyEntry[],
  keepId: string,
  deleteId: string,
): MergeResult {
  const kept = roster.find((b) => b.id === keepId);
  const deleted = roster.find((b) => b.id === deleteId);
  if (!kept || !deleted) throw new Error('Buddy not found in roster');

  const newRarityValue = nextRarity(kept.rarity);
  if (!newRarityValue) throw new Error('Cannot upgrade past legendary');

  const updatedBuddy: BuddyEntry = {
    ...kept,
    rarity: newRarityValue,
  };

  const updatedRoster = roster
    .filter((b) => b.id !== deleteId)
    .map((b) => (b.id === keepId ? updatedBuddy : b));

  return { updatedRoster, updatedBuddy, newRarity: newRarityValue };
}
