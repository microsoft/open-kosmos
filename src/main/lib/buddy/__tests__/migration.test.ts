import { migrateV1ToV2 } from '../migration';
import type { BuddyPersistence, BuddyRosterData } from '../types';
import { roll } from '../companion';

describe('migrateV1ToV2', () => {
  const v1Data: BuddyPersistence = {
    companionSeed: 'abcdef1234567890abcdef1234567890',
    companion: {
      name: 'Quack',
      personality: 'A mischievous duck that enjoys thunder and noodles.',
      hatchedAt: 1711929600000,
    },
    companionMuted: false,
    buddyXP: {
      totalXP: 250_000,
      lastXPGain: 1711929600000,
      xpHistory: [{ timestamp: 1711929600000, tokens: 500, source: 'chat' as const }],
    },
    buddyWidgetPosition: { x: 100, y: 200 },
    buddyWidgetMinimized: false,
  };

  it('creates a single-entry roster from V1 data', () => {
    const result = migrateV1ToV2(v1Data);
    expect(result.version).toBe(2);
    expect(result.buddies).toHaveLength(1);
    expect(result.activeBuddyId).toBe(result.buddies[0].id);
    expect(result.userTotalTokens).toBe(250_000);
  });

  it('preserves the seed and soul', () => {
    const result = migrateV1ToV2(v1Data);
    const buddy = result.buddies[0];
    expect(buddy.seed).toBe('abcdef1234567890abcdef1234567890');
    expect(buddy.soul.name).toBe('Quack');
    expect(buddy.soul.personality).toBe('A mischievous duck that enjoys thunder and noodles.');
    expect(buddy.soul.hatchedAt).toBe(1711929600000);
  });

  it('sets rarity from roll(seed)', () => {
    const result = migrateV1ToV2(v1Data);
    const rolled = roll(v1Data.companionSeed!);
    expect(result.buddies[0].rarity).toBe(rolled.bones.rarity);
  });

  it('initializes statBonuses to all zeros', () => {
    const result = migrateV1ToV2(v1Data);
    expect(result.buddies[0].statBonuses).toEqual({
      DEBUGGING: 0,
      PATIENCE: 0,
      CHAOS: 0,
      WISDOM: 0,
      SNARK: 0,
    });
  });

  it('sets buddy XP from V1 totalXP', () => {
    const result = migrateV1ToV2(v1Data);
    expect(result.buddies[0].xp).toBe(250_000);
  });

  it('generates a UUID for the buddy id', () => {
    const result = migrateV1ToV2(v1Data);
    expect(result.buddies[0].id).toBeTruthy();
    expect(typeof result.buddies[0].id).toBe('string');
    expect(result.buddies[0].id.length).toBeGreaterThan(0);
  });

  it('handles V1 data with no companion (no seed)', () => {
    const emptyV1: BuddyPersistence = {};
    const result = migrateV1ToV2(emptyV1);
    expect(result.version).toBe(2);
    expect(result.buddies).toHaveLength(0);
    expect(result.activeBuddyId).toBe('');
    expect(result.userTotalTokens).toBe(0);
  });

  it('handles V1 data with seed but no soul', () => {
    const partialV1: BuddyPersistence = {
      companionSeed: 'abcdef1234567890abcdef1234567890',
      buddyXP: { totalXP: 1000, lastXPGain: 0, xpHistory: [] },
    };
    const result = migrateV1ToV2(partialV1);
    expect(result.buddies).toHaveLength(1);
    expect(result.buddies[0].xp).toBe(1000);
  });

  it('handles V1 data with seed but no buddyXP (totalXP defaults to 0)', () => {
    const noXP: BuddyPersistence = {
      companionSeed: 'abcdef1234567890abcdef1234567890',
      // buddyXP intentionally omitted
    };
    const result = migrateV1ToV2(noXP);
    expect(result.buddies).toHaveLength(1);
    expect(result.buddies[0].xp).toBe(0);
    expect(result.userTotalTokens).toBe(0);
  });

  it('handles corrupt V1 data (null) gracefully', () => {
    const result = migrateV1ToV2(null as any);
    expect(result.version).toBe(2);
    expect(result.buddies).toHaveLength(0);
    expect(result.activeBuddyId).toBe('');
    expect(result.userTotalTokens).toBe(0);
  });

  it('does not modify data that already has version: 2', () => {
    const v2Data: BuddyRosterData = {
      version: 2,
      buddies: [],
      activeBuddyId: '',
      userTotalTokens: 500,
    };
    const result = migrateV1ToV2(v2Data as any);
    expect(result).toEqual(v2Data);
  });
});
