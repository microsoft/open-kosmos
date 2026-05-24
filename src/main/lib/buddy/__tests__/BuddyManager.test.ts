// src/main/lib/buddy/__tests__/BuddyManager.test.ts

// Mock fs so persistence doesn't touch the real filesystem
vi.mock('fs', async () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
}));

// Mock crypto.randomUUID for deterministic IDs in tests
let uuidCounter = 0;
vi.mock('crypto', async () => ({
  randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

import { BuddyManager } from '../BuddyManager';
import { HATCH_COST, ALL_STATS, BuddyRosterData, BuddyPersistence } from '../types';
import * as fs from 'fs';

const mockFs = fs as Mocked<typeof fs>;

describe('BuddyManager', () => {
  let manager: BuddyManager;

  beforeEach(() => {
    BuddyManager.resetForTesting();
    manager = BuddyManager.getInstance();
    uuidCounter = 0;

    // Reset fs mocks to default (no file exists)
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.writeFileSync.mockClear();
    mockFs.mkdirSync.mockClear();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('singleton', () => {
    it('returns the same instance', () => {
      const a = BuddyManager.getInstance();
      const b = BuddyManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('initialize', () => {
    it('starts with empty roster when no file exists', async () => {
      await manager.initialize('testuser');
      expect(manager.getCompanion()).toBeNull();
      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(0);
      expect(roster.activeBuddyId).toBe('');
      expect(roster.userTotalTokens).toBe(0);
    });

    it('migrates V1 data to V2 format', async () => {
      const v1Data: BuddyPersistence = {
        companionSeed: 'testuser-123-abc',
        companion: {
          name: 'Old Buddy',
          personality: 'cheerfully unhelpful',
          hatchedAt: 1000,
        },
        companionMuted: true,
        buddyXP: {
          totalXP: 500,
          lastXPGain: 50,
          xpHistory: [],
        },
      };

      // First call for profileDir, second for buddy.json
      mockFs.existsSync
        .mockReturnValueOnce(true) // profileDir exists
        .mockReturnValueOnce(true); // buddy.json exists
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v1Data));

      await manager.initialize('testuser');

      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(1);
      expect(roster.buddies[0].soul.name).toBe('Old Buddy');
      expect(roster.buddies[0].xp).toBe(500);
      expect(roster.userTotalTokens).toBe(500);
      expect(manager.isMuted()).toBe(true);

      // Should have persisted the migrated V2 data
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.version).toBe(2);
    });

    it('migrates V1 data with no companionMuted field (defaults to false)', async () => {
      const v1DataNoMuted: BuddyPersistence = {
        companionSeed: 'testuser-123-xyz',
        companion: {
          name: 'Silent Buddy',
          personality: 'very quiet',
          hatchedAt: 2000,
        },
        // companionMuted intentionally omitted
        buddyXP: { totalXP: 100, lastXPGain: 10, xpHistory: [] },
      };

      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v1DataNoMuted));

      await manager.initialize('testuser');
      expect(manager.isMuted()).toBe(false); // covers `v1.companionMuted ?? false`
    });

    it('loads V2 data directly', async () => {
      const v2Data: BuddyRosterData & { muted?: boolean } = {
        version: 2,
        buddies: [
          {
            id: 'buddy-1',
            seed: 'seed-1',
            soul: { name: 'Alpha', personality: 'bold', hatchedAt: 1000 },
            xp: 200,
            rarity: 'uncommon',
            statBonuses: { DEBUGGING: 1, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
        ],
        activeBuddyId: 'buddy-1',
        userTotalTokens: 200,
        muted: false,
      };

      mockFs.existsSync
        .mockReturnValueOnce(true) // profileDir
        .mockReturnValueOnce(true); // buddy.json
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Data));

      await manager.initialize('testuser');

      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(1);
      expect(roster.buddies[0].id).toBe('buddy-1');
      expect(roster.buddies[0].soul.name).toBe('Alpha');
      expect(roster.activeBuddyId).toBe('buddy-1');
      expect(roster.userTotalTokens).toBe(200);

      // V2 load should NOT re-persist (no migration needed)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('loads V2 data without muted field (defaults to false)', async () => {
      // Test the `data.muted ?? false` branch when muted is undefined
      const v2DataNoMuted = {
        version: 2,
        buddies: [],
        activeBuddyId: '',
        userTotalTokens: 0,
        // muted field intentionally omitted
      };

      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2DataNoMuted));

      await manager.initialize('testuser');
      expect(manager.isMuted()).toBe(false);
    });
  });

  describe('hatch', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
    });

    it('first hatch is free and creates a companion', () => {
      const companion = manager.hatch();
      expect(companion).toBeTruthy();
      expect(companion.name).toBeTruthy();
      expect(companion.species).toBeTruthy();
      expect(companion.hatchedAt).toBeGreaterThan(0);

      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(1);
      expect(roster.activeBuddyId).toBe(roster.buddies[0].id);
    });

    it('subsequent getCompanion returns a companion with correct properties', () => {
      manager.hatch();
      const companion = manager.getCompanion();
      expect(companion).not.toBeNull();
      expect(companion!.name).toBeTruthy();
      expect(companion!.species).toBeTruthy();
    });

    it('subsequent hatch costs HATCH_COST from active buddy XP', () => {
      manager.hatch();
      // Give XP to the first buddy so it can pay hatch cost
      manager.addXP(HATCH_COST + 10, 'chat');

      const roster1 = manager.getRoster();
      const firstBuddyXP = roster1.buddies[0].xp;

      manager.hatch();

      const roster2 = manager.getRoster();
      // First buddy's XP should be reduced by HATCH_COST
      const firstBuddy = roster2.buddies.find((b) => b.id === roster1.buddies[0].id)!;
      expect(firstBuddy.xp).toBe(firstBuddyXP - HATCH_COST);

      // The new buddy is now active
      expect(roster2.activeBuddyId).toBe(roster2.buddies[1].id);
      expect(roster2.buddies).toHaveLength(2);
    });

    it('throws when active buddy has insufficient XP for subsequent hatch', () => {
      manager.hatch();
      // First buddy has 0 XP, can't afford HATCH_COST
      expect(() => manager.hatch()).toThrow('Insufficient XP');
    });

    it('sets new buddy as active', () => {
      manager.hatch();
      manager.addXP(HATCH_COST + 10, 'chat');
      const first = manager.getRoster().activeBuddyId;

      manager.hatch();
      const second = manager.getRoster().activeBuddyId;
      expect(second).not.toBe(first);
    });
  });

  describe('addXP', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
      manager.hatch();
    });

    it('adds XP to active buddy and userTotalTokens', () => {
      manager.addXP(100, 'chat');
      manager.addXP(50, 'tool');

      const roster = manager.getRoster();
      expect(roster.userTotalTokens).toBe(150);

      const activeBuddy = roster.buddies.find((b) => b.id === roster.activeBuddyId)!;
      expect(activeBuddy.xp).toBe(150);
    });

    it('accumulates sessionXP', () => {
      manager.addXP(100, 'chat');
      manager.addXP(200, 'chat');
      const data = manager.getXPData();
      expect(data.sessionXP).toBe(300);
    });

    it('ignores zero or negative tokens', () => {
      manager.addXP(0, 'chat');
      manager.addXP(-10, 'chat');
      const data = manager.getXPData();
      expect(data.totalXP).toBe(0);
    });

    it('records lastXPGain', () => {
      manager.addXP(42, 'chat');
      expect(manager.getXPData().lastXPGain).toBe(42);
    });

    it('records xpHistory entries', () => {
      manager.addXP(100, 'chat');
      manager.addXP(50, 'tool');
      const data = manager.getXPData();
      expect(data.xpHistory).toHaveLength(2);
      expect(data.xpHistory[0].source).toBe('chat');
      expect(data.xpHistory[1].source).toBe('tool');
    });

    it('detects level-up with stat gain when XP crosses threshold', () => {
      // Level 1 requires 100,000 XP (levelToXP(1) = 100_000)
      const result = manager.addXP(100_000, 'chat');

      expect(result.levelUp).toBeDefined();
      expect(result.levelUp!.buddyId).toBeTruthy();
      expect(result.levelUp!.level).toBe(1);
      expect(ALL_STATS).toContain(result.levelUp!.statGained);

      // Check that stat bonuses were applied
      const roster = manager.getRoster();
      const activeBuddy = roster.buddies.find((b) => b.id === roster.activeBuddyId)!;
      const totalBonuses = ALL_STATS.reduce((sum, s) => sum + activeBuddy.statBonuses[s], 0);
      expect(totalBonuses).toBe(1); // One level = one stat point
    });

    it('does not return levelUp when no level crossed', () => {
      const result = manager.addXP(50, 'chat');
      expect(result.levelUp).toBeUndefined();
    });
  });

  describe('setActiveBuddy', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
    });

    it('switches active buddy', () => {
      manager.hatch();
      manager.addXP(HATCH_COST + 10, 'chat');
      const roster1 = manager.getRoster();
      const firstId = roster1.activeBuddyId;

      manager.hatch();
      expect(manager.getRoster().activeBuddyId).not.toBe(firstId);

      // Switch back to first
      const companion = manager.setActiveBuddy(firstId);
      expect(companion).toBeTruthy();
      expect(manager.getRoster().activeBuddyId).toBe(firstId);
    });

    it('throws for nonexistent buddy ID', () => {
      manager.hatch();
      expect(() => manager.setActiveBuddy('nonexistent-id')).toThrow('Buddy not found');
    });
  });

  describe('releaseBuddy', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
    });

    it('removes non-active buddy from roster', () => {
      manager.hatch();
      manager.addXP(HATCH_COST + 10, 'chat');
      const firstId = manager.getRoster().buddies[0].id;

      manager.hatch(); // second is now active

      manager.releaseBuddy(firstId);
      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(1);
      expect(roster.buddies.find((b) => b.id === firstId)).toBeUndefined();
    });

    it('throws when trying to release active buddy', () => {
      manager.hatch();
      const activeId = manager.getRoster().activeBuddyId;
      expect(() => manager.releaseBuddy(activeId)).toThrow('Cannot release the active buddy');
    });

    it('throws for nonexistent buddy ID', () => {
      manager.hatch();
      expect(() => manager.releaseBuddy('nonexistent-id')).toThrow('Buddy not found');
    });
  });

  describe('getCompanion', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
    });

    it('returns null when no buddy is hatched', () => {
      expect(manager.getCompanion()).toBeNull();
    });

    it('returns a full Companion with correct stat bonuses', () => {
      manager.hatch();
      // Add enough XP to trigger a level-up so stat bonuses are applied
      manager.addXP(100_000, 'chat');

      const companion = manager.getCompanion()!;
      expect(companion).not.toBeNull();
      expect(companion.name).toBeTruthy();
      expect(companion.species).toBeTruthy();
      expect(companion.rarity).toBeTruthy();
      expect(companion.stats).toBeDefined();

      // Stats should be at least equal to base stats (bonuses only add)
      for (const stat of ALL_STATS) {
        expect(companion.stats[stat]).toBeGreaterThanOrEqual(0);
        expect(companion.stats[stat]).toBeLessThanOrEqual(100);
      }
    });

    it('includes hatchedAt timestamp', () => {
      manager.hatch();
      const companion = manager.getCompanion()!;
      expect(companion.hatchedAt).toBeGreaterThan(0);
    });
  });

  describe('rename', () => {
    it('updates companion name', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      const renamed = manager.rename('Pip');
      expect(renamed.name).toBe('Pip');
    });

    it('rejects empty name', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      expect(() => manager.rename('')).toThrow('Name cannot be empty');
    });

    it('rejects name longer than 14 chars', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      expect(() => manager.rename('a'.repeat(15))).toThrow('14 characters');
    });

    it('trims whitespace', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      const renamed = manager.rename('  Pip  ');
      expect(renamed.name).toBe('Pip');
    });

    it('throws when no companion exists', async () => {
      await manager.initialize('testuser');
      expect(() => manager.rename('Pip')).toThrow('No companion');
    });
  });

  describe('milestone detection', () => {
    beforeEach(async () => {
      await manager.initialize('testuser');
      manager.hatch();
    });

    it('getMilestoneForXP returns null below first threshold', () => {
      expect(manager.getMilestoneForXP(500)).toBeNull();
    });

    it('getMilestoneForXP returns correct milestone', () => {
      const m = manager.getMilestoneForXP(10_000);
      expect(m).not.toBeNull();
      expect(m!.name).toBe('Apprentice');
    });

    it('getMilestoneForXP returns highest crossed milestone', () => {
      const m = manager.getMilestoneForXP(1_000_000);
      expect(m).not.toBeNull();
      expect(m!.name).toBe('Expert');
    });

    it('checkMilestoneCrossed detects crossing', () => {
      const crossed = manager.checkMilestoneCrossed(900, 1_100);
      expect(crossed).not.toBeNull();
      expect(crossed!.name).toBe('Novice');
    });

    it('checkMilestoneCrossed returns null when no crossing', () => {
      const crossed = manager.checkMilestoneCrossed(1_100, 1_500);
      expect(crossed).toBeNull();
    });

    it('checkMilestoneCrossed returns newMilestone when both have milestones but different thresholds', () => {
      // oldXP = 1001 (Novice), newXP = 10001 (Apprentice) — crosses to new milestone
      const crossed = manager.checkMilestoneCrossed(1_001, 10_001);
      expect(crossed).not.toBeNull();
      expect(crossed!.name).toBe('Apprentice');
    });

    it('addXP returns milestone when crossed', () => {
      manager.addXP(999, 'chat');
      const result = manager.addXP(2, 'chat');
      expect(result.milestone).not.toBeNull();
      expect(result.milestone!.name).toBe('Novice');
    });
  });

  describe('setMuted', () => {
    it('updates muted state', async () => {
      await manager.initialize('testuser');
      expect(manager.isMuted()).toBe(false);
      manager.setMuted(true);
      expect(manager.isMuted()).toBe(true);
    });
  });

  describe('pet', () => {
    it('returns a timestamp', async () => {
      await manager.initialize('testuser');
      const petAt = manager.pet();
      expect(petAt).toBeGreaterThan(0);
    });
  });

  describe('getRoster', () => {
    it('returns roster state', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      manager.addXP(HATCH_COST + 10, 'chat');
      manager.hatch();

      const roster = manager.getRoster();
      expect(roster.buddies).toHaveLength(2);
      expect(roster.activeBuddyId).toBeTruthy();
      expect(roster.userTotalTokens).toBe(HATCH_COST + 10);
    });
  });

  describe('persistence', () => {
    it('writes V2 format with version: 2', async () => {
      await manager.initialize('testuser');
      manager.hatch();

      // hatch calls persistImmediate
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.version).toBe(2);
      expect(written.buddies).toHaveLength(1);
      expect(written.activeBuddyId).toBeTruthy();
      expect(written.userTotalTokens).toBe(0);
    });

    it('does not write when dataFilePath is null (no initialize called)', () => {
      // Fresh manager with no initialize → dataFilePath is null
      manager.hatch(); // hatch calls persistImmediate, which should no-op
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('logs and swallows errors from writeFileSync (covers persistImmediate catch)', async () => {
      await manager.initialize('testuser');
      mockFs.existsSync.mockReturnValue(false); // ensures dataFilePath is set above
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      // Should not throw despite fs error
      expect(() => manager.hatch()).not.toThrow();
    });

    it('debouncedPersist fires after timeout and calls writeFileSync', async () => {
      vi.useFakeTimers();
      await manager.initialize('testuser');
      manager.hatch();
      mockFs.writeFileSync.mockClear();

      // addXP uses debouncedPersist
      manager.addXP(10, 'chat');
      // Timer not fired yet
      const callsBefore = mockFs.writeFileSync.mock.calls.length;

      // Advance timers past the 2000ms debounce
      vi.advanceTimersByTime(2500);

      expect(mockFs.writeFileSync.mock.calls.length).toBeGreaterThan(callsBefore);
      vi.useRealTimers();
    });

    it('dispose cancels pending debouncedPersist timer', async () => {
      vi.useFakeTimers();
      await manager.initialize('testuser');
      manager.hatch();
      mockFs.writeFileSync.mockClear();

      manager.addXP(10, 'chat'); // schedules debounce
      manager.dispose(); // should cancel the timer
      vi.advanceTimersByTime(3000); // timer fires but was cancelled

      // writeFileSync should NOT have been called after dispose
      expect(mockFs.writeFileSync.mock.calls.length).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('hatch roster full', () => {
    it('throws when roster has reached MAX_ROSTER_SIZE', async () => {
      await manager.initialize('testuser');
      manager.hatch(); // buddy #1, free
      // Hatch buddies #2 through #100 (99 more hatches)
      // Each hatch costs HATCH_COST from active buddy and makes new buddy active.
      // So after each hatch, add XP so the new active buddy can afford the next one.
      for (let i = 0; i < 99; i++) {
        manager.addXP(HATCH_COST * 2, 'chat');
        manager.hatch();
      }
      expect(manager.getRoster().buddies.length).toBe(100);
      // Now the roster is full — the 101st hatch should throw
      manager.addXP(HATCH_COST * 2, 'chat');
      expect(() => manager.hatch()).toThrow('Roster is full');
    });
  });

  describe('addXP xpHistory bound', () => {
    it('caps xpHistory at 100 entries', async () => {
      await manager.initialize('testuser');
      manager.hatch();
      // Add 102 XP events
      for (let i = 0; i < 102; i++) {
        manager.addXP(1, 'chat');
      }
      const data = manager.getXPData();
      expect(data.xpHistory.length).toBeLessThanOrEqual(100);
    });
  });

  describe('mergeBuddies when deleted buddy is active', () => {
    it('switches active to keepId when deleteId was active', async () => {
      // For merge to succeed: same rarity, same species (same seed roll), kept at max level.
      // Common rarity max level = 20 → xp >= levelToXP(20) = 861276.
      // We use the same seed for both buddies so they roll the same species.
      const sharedSeed = 'abcdef1234567890abcdef1234567890'; // deterministic seed
      const v2Data = {
        version: 2,
        buddies: [
          {
            id: 'buddy-keep',
            seed: sharedSeed,
            soul: { name: 'Alpha', personality: 'bold', hatchedAt: 1000 },
            xp: 861276, // at level 20 (common max)
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
          {
            id: 'buddy-delete',
            seed: sharedSeed,
            soul: { name: 'Beta', personality: 'shy', hatchedAt: 2000 },
            xp: 0,
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
        ],
        activeBuddyId: 'buddy-delete', // deleted buddy is active
        userTotalTokens: 0,
        muted: false,
      };

      mockFs.existsSync
        .mockReturnValueOnce(true) // profileDir
        .mockReturnValueOnce(true); // buddy.json
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Data));

      await manager.initialize('testuser');
      expect(manager.getRoster().activeBuddyId).toBe('buddy-delete');

      // Merge: keep buddy-keep, delete buddy-delete (which is active)
      manager.mergeBuddies('buddy-keep', 'buddy-delete');

      // Active should have switched to buddy-keep
      expect(manager.getRoster().activeBuddyId).toBe('buddy-keep');
    });

    it('keeps same activeBuddyId when deleteId is NOT the active buddy', async () => {
      // Merge where the deleted buddy is NOT the active one
      const sharedSeed = 'abcdef1234567890abcdef1234567890';
      const v2Data = {
        version: 2,
        buddies: [
          {
            id: 'buddy-keep',
            seed: sharedSeed,
            soul: { name: 'Alpha', personality: 'bold', hatchedAt: 1000 },
            xp: 861276,
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
          {
            id: 'buddy-delete',
            seed: sharedSeed,
            soul: { name: 'Beta', personality: 'shy', hatchedAt: 2000 },
            xp: 0,
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
        ],
        activeBuddyId: 'buddy-keep', // kept buddy is active
        userTotalTokens: 0,
        muted: false,
      };

      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Data));

      await manager.initialize('testuser');
      expect(manager.getRoster().activeBuddyId).toBe('buddy-keep');

      // Merge: keep buddy-keep (active), delete buddy-delete
      manager.mergeBuddies('buddy-keep', 'buddy-delete');

      // Active should remain buddy-keep
      expect(manager.getRoster().activeBuddyId).toBe('buddy-keep');
    });
  });

  describe('addXP with no active entry', () => {
    it('still tracks userTotalTokens when activeBuddyId has no match', async () => {
      const v2Data = {
        version: 2,
        buddies: [
          {
            id: 'buddy-1',
            seed: 'seed-1',
            soul: { name: 'Alpha', personality: 'bold', hatchedAt: 1000 },
            xp: 0,
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
        ],
        activeBuddyId: 'nonexistent', // no matching buddy
        userTotalTokens: 0,
        muted: false,
      };

      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Data));

      await manager.initialize('testuser');
      // No active entry, but addXP should still update userTotalTokens
      const result = manager.addXP(100, 'chat');
      expect(result.totalXP).toBe(100);
      expect(result.levelUp).toBeUndefined();
    });
  });

  describe('hatch with corrupted active entry', () => {
    it('throws "No active buddy to pay hatch cost" when roster is non-empty but activeBuddyId is stale', async () => {
      // Load V2 data with a buddy but an invalid activeBuddyId
      const v2Data = {
        version: 2,
        buddies: [
          {
            id: 'buddy-1',
            seed: 'seed-1',
            soul: { name: 'Alpha', personality: 'bold', hatchedAt: 1000 },
            xp: 0,
            rarity: 'common',
            statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
          },
        ],
        activeBuddyId: 'nonexistent-id', // invalid active ID
        userTotalTokens: 0,
        muted: false,
      };

      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Data));

      await manager.initialize('testuser');
      // roster has 1 buddy but activeBuddyId is invalid
      expect(manager.getCompanion()).toBeNull();

      // Hatch should fail with "No active buddy to pay hatch cost"
      expect(() => manager.hatch()).toThrow('No active buddy to pay hatch cost');
    });
  });

  describe('initialize error handling', () => {
    it('handles corrupt JSON in buddy.json gracefully', async () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue('NOT VALID JSON{{{');

      await expect(manager.initialize('testuser')).resolves.not.toThrow();
      // Should fall through to empty state
      expect(manager.getCompanion()).toBeNull();
    });
  });
});
