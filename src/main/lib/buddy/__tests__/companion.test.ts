// src/main/lib/buddy/__tests__/companion.test.ts
import {
  mulberry32, hashString, rollRarity, pick, rollStats,
  roll, generateSoul, generateSeed, clearRollCache,
} from '../companion';
import { ALL_SPECIES, ALL_EYES, ALL_HATS, ALL_STATS, RARITY_WEIGHTS } from '../types';

describe('mulberry32 PRNG', () => {
  it('produces deterministic output for the same seed', () => {
    const rand1 = mulberry32(12345);
    const rand2 = mulberry32(12345);
    const values1 = Array.from({ length: 10 }, () => rand1());
    const values2 = Array.from({ length: 10 }, () => rand2());
    expect(values1).toEqual(values2);
  });

  it('produces values in [0, 1)', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different output for different seeds', () => {
    const rand1 = mulberry32(1);
    const rand2 = mulberry32(2);
    const v1 = rand1();
    const v2 = rand2();
    expect(v1).not.toBe(v2);
  });
});

describe('hashString (FNV-1a)', () => {
  it('produces consistent hash for same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  it('produces different hash for different input', () => {
    expect(hashString('hello')).not.toBe(hashString('world'));
  });

  it('returns a positive integer', () => {
    const h = hashString('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('rollRarity', () => {
  it('returns a valid rarity', () => {
    const rand = mulberry32(99);
    const rarities = Object.keys(RARITY_WEIGHTS);
    for (let i = 0; i < 100; i++) {
      expect(rarities).toContain(rollRarity(rand));
    }
  });
});

describe('pick', () => {
  it('returns an element from the array', () => {
    const rand = mulberry32(1);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(pick(arr, rand));
    }
  });
});

describe('rollStats', () => {
  it('produces stats in range [floor, 100] for common', () => {
    const rand = mulberry32(7);
    const stats = rollStats('common', rand);
    for (const stat of ALL_STATS) {
      expect(stats[stat]).toBeGreaterThanOrEqual(5);
      expect(stats[stat]).toBeLessThanOrEqual(100);
    }
  });

  it('produces stats in range [floor, 100] for legendary', () => {
    const rand = mulberry32(77);
    const stats = rollStats('legendary', rand);
    for (const stat of ALL_STATS) {
      expect(stats[stat]).toBeGreaterThanOrEqual(50);
      expect(stats[stat]).toBeLessThanOrEqual(100);
    }
  });

  it('has all 5 stat keys', () => {
    const rand = mulberry32(3);
    const stats = rollStats('rare', rand);
    expect(Object.keys(stats)).toHaveLength(5);
    for (const stat of ALL_STATS) {
      expect(stats).toHaveProperty(stat);
    }
  });
});

describe('roll', () => {
  beforeEach(() => clearRollCache());

  it('returns deterministic result for same seed', () => {
    const r1 = roll('test-seed-123');
    clearRollCache();
    const r2 = roll('test-seed-123');
    expect(r1).toEqual(r2);
  });

  it('returns valid species', () => {
    const r = roll('species-check');
    expect(ALL_SPECIES).toContain(r.bones.species);
  });

  it('returns valid eye', () => {
    const r = roll('eye-check');
    expect(ALL_EYES).toContain(r.bones.eye);
  });

  it('common rarity forces hat=none', () => {
    for (let i = 0; i < 200; i++) {
      clearRollCache();
      const r = roll(`common-hat-test-${i}`);
      if (r.bones.rarity === 'common') {
        expect(r.bones.hat).toBe('none');
      }
    }
  });

  it('caches results', () => {
    const r1 = roll('cache-test');
    const r2 = roll('cache-test');
    expect(r1).toBe(r2); // same reference
  });

  it('clearRollCache resets cache', () => {
    const r1 = roll('clear-test');
    clearRollCache();
    const r2 = roll('clear-test');
    expect(r1).not.toBe(r2); // different reference
    expect(r1).toEqual(r2); // same values
  });

  it('shiny is a boolean', () => {
    const r = roll('shiny-check');
    expect(typeof r.bones.shiny).toBe('boolean');
  });

  it('inspirationSeed is a non-negative integer', () => {
    const r = roll('inspo-check');
    expect(r.inspirationSeed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(r.inspirationSeed)).toBe(true);
  });
});

describe('generateSoul', () => {
  it('returns a name and personality', () => {
    const soul = generateSoul(12345, 'duck');
    expect(soul.name).toBeTruthy();
    expect(soul.personality).toBeTruthy();
  });

  it('name has two capitalized words', () => {
    const soul = generateSoul(99999, 'cat');
    const parts = soul.name.split(' ');
    expect(parts).toHaveLength(2);
    expect(parts[0][0]).toBe(parts[0][0].toUpperCase());
    expect(parts[1][0]).toBe(parts[1][0].toUpperCase());
  });

  it('is deterministic for same inspirationSeed', () => {
    const s1 = generateSoul(555, 'blob');
    const s2 = generateSoul(555, 'blob');
    expect(s1).toEqual(s2);
  });
});

describe('generateSeed', () => {
  it('contains the alias', () => {
    const seed = generateSeed('testuser');
    expect(seed).toContain('testuser');
  });

  it('produces unique seeds on successive calls', () => {
    const s1 = generateSeed('user');
    const s2 = generateSeed('user');
    expect(s1).not.toBe(s2);
  });
});
