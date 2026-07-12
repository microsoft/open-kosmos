import type { BuddyPersistence, BuddyRosterData, BuddyEntry, StatName } from './types';
import { ALL_STATS } from './types';
import { roll } from './companion';

function emptyStatBonuses(): Record<StatName, number> {
  const bonuses = {} as Record<StatName, number>;
  for (const stat of ALL_STATS) bonuses[stat] = 0;
  return bonuses;
}

export function migrateV1ToV2(data: BuddyPersistence | null | undefined): BuddyRosterData {
  // Already V2
  if (data && (data as any).version === 2) {
    return data as unknown as BuddyRosterData;
  }

  // Null / corrupt
  if (!data || typeof data !== 'object') {
    return { version: 2, buddies: [], activeBuddyId: '', userTotalTokens: 0 };
  }

  const v1 = data as BuddyPersistence;

  // No seed means no companion was ever hatched
  if (!v1.companionSeed) {
    return { version: 2, buddies: [], activeBuddyId: '', userTotalTokens: v1.buddyXP?.totalXP ?? 0 };
  }

  const rolled = roll(v1.companionSeed);
  const buddyId = crypto.randomUUID();
  const totalXP = v1.buddyXP?.totalXP ?? 0;

  const entry: BuddyEntry = {
    id: buddyId,
    seed: v1.companionSeed,
    soul: v1.companion ?? {
      name: 'Unnamed',
      personality: 'A mysterious creature.',
      hatchedAt: Date.now(),
    },
    xp: totalXP,
    rarity: rolled.bones.rarity,
    statBonuses: emptyStatBonuses(),
  };

  return {
    version: 2,
    buddies: [entry],
    activeBuddyId: buddyId,
    userTotalTokens: totalXP,
  };
}
