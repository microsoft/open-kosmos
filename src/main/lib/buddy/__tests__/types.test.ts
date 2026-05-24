// src/main/lib/buddy/__tests__/types.test.ts
import {
  ALL_SPECIES,
  ALL_EYES,
  ALL_HATS,
  ALL_STATS,
  RARITY_WEIGHTS,
  RARITY_STARS,
  RARITY_COLORS,
  STAT_FLOORS,
  MILESTONES,
  RARITY_MAX_LEVEL,
  RARITY_ORDER,
  nextRarity,
  HATCH_COST,
  MAX_ROSTER_SIZE,
} from '../types';

describe('buddy types constants', () => {
  it('has 18 species', () => {
    expect(ALL_SPECIES).toHaveLength(18);
    expect(new Set(ALL_SPECIES).size).toBe(18); // no duplicates
  });

  it('has 6 eye styles', () => {
    expect(ALL_EYES).toHaveLength(6);
  });

  it('has 8 hat styles including none', () => {
    expect(ALL_HATS).toHaveLength(8);
    expect(ALL_HATS[0]).toBe('none');
  });

  it('has 5 stats', () => {
    expect(ALL_STATS).toHaveLength(5);
  });

  it('rarity weights sum to 100', () => {
    const sum = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('every rarity has stars, color, weight, and stat floor', () => {
    const rarities = Object.keys(RARITY_WEIGHTS);
    for (const r of rarities) {
      expect(RARITY_STARS).toHaveProperty(r);
      expect(RARITY_COLORS).toHaveProperty(r);
      expect(STAT_FLOORS).toHaveProperty(r);
    }
  });

  it('milestones are in ascending order', () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].threshold).toBeGreaterThan(MILESTONES[i - 1].threshold);
    }
  });

  it('has 5 milestones', () => {
    expect(MILESTONES).toHaveLength(5);
  });
});

describe('V2 constants', () => {
  it('RARITY_MAX_LEVEL has entries for all 5 rarities', () => {
    expect(Object.keys(RARITY_MAX_LEVEL)).toHaveLength(5);
    expect(RARITY_MAX_LEVEL.common).toBe(20);
    expect(RARITY_MAX_LEVEL.legendary).toBe(100);
  });

  it('RARITY_ORDER is ascending', () => {
    expect(RARITY_ORDER).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
  });

  it('nextRarity returns the next tier', () => {
    expect(nextRarity('common')).toBe('uncommon');
    expect(nextRarity('uncommon')).toBe('rare');
    expect(nextRarity('rare')).toBe('epic');
    expect(nextRarity('epic')).toBe('legendary');
  });

  it('nextRarity returns null for legendary', () => {
    expect(nextRarity('legendary')).toBeNull();
  });

  it('HATCH_COST is defined', () => {
    expect(HATCH_COST).toBe(1);
  });

  it('MAX_ROSTER_SIZE is 100', () => {
    expect(MAX_ROSTER_SIZE).toBe(100);
  });
});
