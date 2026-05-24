import { validateMerge, executeMerge } from '../merging';
import { levelToXP } from '../leveling';
import type { BuddyEntry } from '../types';

function makeEntry(overrides: Partial<BuddyEntry> & { id: string; seed: string }): BuddyEntry {
  return {
    soul: { name: 'Test', personality: 'A test buddy.', hatchedAt: 1000 },
    xp: 0,
    rarity: 'common',
    statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
    ...overrides,
  };
}

// XP needed to reach level 20 (common max level)
const COMMON_MAX_XP = levelToXP(20);

// Mock roll() to control species output for testing merge rules
vi.mock('../companion', async () => ({
  roll: (seed: string) => {
    const speciesMap: Record<string, string> = {
      'seed-duck-1': 'duck',
      'seed-duck-2': 'duck',
      'seed-cat-1': 'cat',
    };
    return {
      bones: {
        species: speciesMap[seed] ?? 'blob',
        rarity: 'common',
        eye: '·',
        hat: 'none',
        shiny: false,
        stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
      },
      inspirationSeed: 12345,
    };
  },
}));

describe('validateMerge', () => {
  it('returns valid for two same-species same-rarity buddies where kept is at max level', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const result = validateMerge(kept, deleted);
    expect(result.valid).toBe(true);
  });

  it('rejects different species', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-cat-1', rarity: 'common', xp: 100_000 });
    const result = validateMerge(kept, deleted);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('same species');
  });

  it('rejects different rarities', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'uncommon', xp: 100_000 });
    const result = validateMerge(kept, deleted);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('same rarity');
  });

  it('rejects when kept buddy is not at max level', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: 500_000 });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const result = validateMerge(kept, deleted);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Lv.20');
  });

  it('rejects legendary merges', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'legendary', xp: 999_999_999 });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'legendary', xp: 999_999_999 });
    const result = validateMerge(kept, deleted);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maximum rarity');
  });

  it('rejects merging a buddy with itself', () => {
    const buddy = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const result = validateMerge(buddy, buddy);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('itself');
  });
});

describe('executeMerge', () => {
  it('upgrades kept buddy rarity to next tier', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const result = executeMerge([kept, deleted], 'a', 'b');
    expect(result.updatedBuddy.rarity).toBe('uncommon');
    expect(result.newRarity).toBe('uncommon');
  });

  it('removes deleted buddy from roster', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const result = executeMerge([kept, deleted], 'a', 'b');
    expect(result.updatedRoster).toHaveLength(1);
    expect(result.updatedRoster[0].id).toBe('a');
  });

  it('preserves kept buddy XP, seed, soul, and statBonuses', () => {
    const kept = makeEntry({
      id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP,
      statBonuses: { DEBUGGING: 5, PATIENCE: 3, CHAOS: 2, WISDOM: 1, SNARK: 0 },
    });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const result = executeMerge([kept, deleted], 'a', 'b');
    expect(result.updatedBuddy.xp).toBe(COMMON_MAX_XP);
    expect(result.updatedBuddy.seed).toBe('seed-duck-1');
    expect(result.updatedBuddy.soul.name).toBe('Test');
    expect(result.updatedBuddy.statBonuses.DEBUGGING).toBe(5);
  });

  it('throws when buddy not found in roster', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    expect(() => executeMerge([kept], 'a', 'nonexistent')).toThrow('Buddy not found in roster');
  });

  it('throws when trying to upgrade past legendary', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'legendary', xp: 999_999_999 });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'legendary', xp: 999_999_999 });
    expect(() => executeMerge([kept, deleted], 'a', 'b')).toThrow('Cannot upgrade past legendary');
  });

  it('preserves other buddies in roster unchanged', () => {
    const kept = makeEntry({ id: 'a', seed: 'seed-duck-1', rarity: 'common', xp: COMMON_MAX_XP });
    const deleted = makeEntry({ id: 'b', seed: 'seed-duck-2', rarity: 'common', xp: 100_000 });
    const bystander = makeEntry({ id: 'c', seed: 'seed-cat-1', rarity: 'rare', xp: 200_000 });
    const result = executeMerge([kept, deleted, bystander], 'a', 'b');
    expect(result.updatedRoster).toHaveLength(2);
    const bystanderResult = result.updatedRoster.find((b) => b.id === 'c');
    expect(bystanderResult).toEqual(bystander);
  });
});
