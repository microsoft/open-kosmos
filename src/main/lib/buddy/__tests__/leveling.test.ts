import { levelToXP, xpToLevel, getStatBoost } from '../leveling';
import { RARITY_MAX_LEVEL } from '../types';
import type { StatName } from '../types';

describe('levelToXP', () => {
  it('returns 100,000 for level 1', () => {
    expect(levelToXP(1)).toBe(100_000);
  });

  it('follows the 1.12^(L-1) curve', () => {
    expect(levelToXP(10)).toBe(Math.floor(100_000 * Math.pow(1.12, 9)));
  });

  it('matches spec table values', () => {
    expect(levelToXP(1)).toBe(100_000);
    expect(levelToXP(20)).toBe(Math.floor(100_000 * Math.pow(1.12, 19)));
    expect(levelToXP(50)).toBe(Math.floor(100_000 * Math.pow(1.12, 49)));
    expect(levelToXP(100)).toBe(Math.floor(100_000 * Math.pow(1.12, 99)));
  });

  it('returns 0 for level 0', () => {
    expect(levelToXP(0)).toBe(0);
  });
});

describe('xpToLevel', () => {
  it('returns 0 for XP below 100,000', () => {
    expect(xpToLevel(0)).toBe(0);
    expect(xpToLevel(50_000)).toBe(0);
    expect(xpToLevel(99_999)).toBe(0);
  });

  it('returns 1 at exactly 100,000 XP', () => {
    expect(xpToLevel(100_000)).toBe(1);
  });

  it('returns the correct level for XP between thresholds', () => {
    const level2XP = levelToXP(2);
    expect(xpToLevel(level2XP - 1)).toBe(1);
    expect(xpToLevel(level2XP)).toBe(2);
  });

  it('handles large XP values at level 100', () => {
    const level100XP = levelToXP(100);
    expect(xpToLevel(level100XP)).toBe(100);
    expect(xpToLevel(level100XP + 1_000_000)).toBe(100);
  });

  it('is the inverse of levelToXP', () => {
    for (let level = 1; level <= 100; level++) {
      expect(xpToLevel(levelToXP(level))).toBe(level);
    }
  });
});

describe('RARITY_MAX_LEVEL', () => {
  it('defines caps for all 5 rarities', () => {
    expect(RARITY_MAX_LEVEL.common).toBe(20);
    expect(RARITY_MAX_LEVEL.uncommon).toBe(40);
    expect(RARITY_MAX_LEVEL.rare).toBe(60);
    expect(RARITY_MAX_LEVEL.epic).toBe(80);
    expect(RARITY_MAX_LEVEL.legendary).toBe(100);
  });
});

describe('getStatBoost', () => {
  it('returns a valid stat name', () => {
    const baseStats: Record<StatName, number> = {
      DEBUGGING: 50,
      PATIENCE: 20,
      CHAOS: 10,
      WISDOM: 10,
      SNARK: 10,
    };
    const stat = getStatBoost(baseStats);
    expect(['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK']).toContain(stat);
  });

  it('is weighted toward higher base stats over many calls', () => {
    const baseStats: Record<StatName, number> = {
      DEBUGGING: 90,
      PATIENCE: 1,
      CHAOS: 1,
      WISDOM: 1,
      SNARK: 1,
    };
    const counts: Record<string, number> = { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[getStatBoost(baseStats)]++;
    }
    expect(counts.DEBUGGING).toBeGreaterThan(800);
  });

  it('handles equal weights', () => {
    const baseStats: Record<StatName, number> = {
      DEBUGGING: 20,
      PATIENCE: 20,
      CHAOS: 20,
      WISDOM: 20,
      SNARK: 20,
    };
    const counts: Record<string, number> = { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[getStatBoost(baseStats)]++;
    }
    for (const stat of Object.keys(counts)) {
      expect(counts[stat]).toBeGreaterThan(100);
      expect(counts[stat]).toBeLessThan(350);
    }
  });
});
