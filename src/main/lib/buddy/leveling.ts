// src/main/lib/buddy/leveling.ts
// Pure leveling functions for the V2 buddy system.

import type { StatName } from './types';
import { ALL_STATS } from './types';

/**
 * XP threshold to reach a given level.
 * Formula: floor(100,000 × 1.12^(level - 1))
 * Level 0 returns 0 (no XP needed).
 */
export function levelToXP(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(100_000 * Math.pow(1.12, level - 1));
}

/**
 * Highest level achievable with the given XP.
 * Returns 0 if xp < 100,000.
 * Max level is 100 (spec cap).
 */
export function xpToLevel(xp: number): number {
  if (xp < 100_000) return 0;
  let level = Math.floor(1 + Math.log(xp / 100_000) / Math.log(1.12));
  level = Math.min(level, 100);
  // Correct for floating-point: if the next level is also reachable, bump up.
  while (level < 100 && levelToXP(level + 1) <= xp) level++;
  // Guard against overshoot from floating-point rounding up.
  if (levelToXP(level) > xp) return level - 1;
  return level;
}

/**
 * Pick one stat to boost on level-up, weighted by base stat values.
 * Uses Math.random() (not deterministic PRNG) since level-ups happen
 * at unpredictable times based on usage.
 */
export function getStatBoost(baseStats: Record<StatName, number>): StatName {
  const totalWeight = ALL_STATS.reduce((sum, s) => sum + baseStats[s], 0);
  let roll = Math.random() * totalWeight;
  for (const stat of ALL_STATS) {
    roll -= baseStats[stat];
    if (roll <= 0) return stat;
  }
  return ALL_STATS[ALL_STATS.length - 1];
}
