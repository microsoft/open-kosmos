// src/main/lib/buddy/BuddyManager.ts
import {
  Companion,
  BuddyXPData,
  BuddyPersistence,
  BuddyEntry,
  BuddyRosterData,
  Milestone,
  MILESTONES,
  HATCH_COST,
  MAX_ROSTER_SIZE,
  RARITY_MAX_LEVEL,
  ALL_STATS,
  StatName,
} from './types';
import { roll, generateSoul, generateSeed } from './companion';
import { xpToLevel, getStatBoost } from './leveling';
import { validateMerge, executeMerge, MergeResult } from './merging';
import { migrateV1ToV2 } from './migration';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface BuddyEventListener {
  onXPUpdated?: (data: BuddyXPData) => void;
  onLevelUp?: (data: { buddyId: string; level: number; statGained: StatName }) => void;
  onMilestone?: (data: { name: string; threshold: number }) => void;
}

export class BuddyManager {
  private static instance: BuddyManager;

  private alias: string = '';
  private roster: BuddyEntry[] = [];
  private activeBuddyId: string = '';
  private userTotalTokens: number = 0;
  private muted: boolean = false;
  private sessionXP: number = 0;
  private lastXPGain: number = 0;
  private xpHistory: BuddyXPData['xpHistory'] = [];
  private lastReactionTime: number = 0;
  private petAt: number = 0;
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;
  private dataFilePath: string | null = null;
  private eventListener: BuddyEventListener | null = null;

  private constructor() {}

  /** Register a listener for XP/level-up/milestone events (used by BuddyIPC to push to renderer) */
  setEventListener(listener: BuddyEventListener): void {
    this.eventListener = listener;
  }

  static getInstance(): BuddyManager {
    if (!BuddyManager.instance) {
      BuddyManager.instance = new BuddyManager();
    }
    return BuddyManager.instance;
  }

  /** Reset instance for testing only */
  static resetForTesting(): void {
    BuddyManager.instance = undefined as unknown as BuddyManager;
  }

  async initialize(alias: string): Promise<void> {
    this.alias = alias;
    this.sessionXP = 0;
    this.xpHistory = [];

    try {
      const userDataPath = app.getPath('userData');
      const profileDir = path.join(userDataPath, 'profiles', alias);
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }
      this.dataFilePath = path.join(profileDir, 'buddy.json');

      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const stored = JSON.parse(raw);

        if (stored.version === 2) {
          // Direct V2 load
          const data = stored as BuddyRosterData & { muted?: boolean };
          this.roster = data.buddies;
          this.activeBuddyId = data.activeBuddyId;
          this.userTotalTokens = data.userTotalTokens;
          this.muted = data.muted ?? false;
        } else {
          // V1 migration
          const v1 = stored as BuddyPersistence;
          const migrated = migrateV1ToV2(v1);
          this.roster = migrated.buddies;
          this.activeBuddyId = migrated.activeBuddyId;
          this.userTotalTokens = migrated.userTotalTokens;
          this.muted = v1.companionMuted ?? false;
          // Persist migrated data immediately
          this.persistImmediate();
        }

        const activeEntry = this.getActiveEntry();
        console.log(
          `[Buddy] Loaded roster for ${alias}: ${this.roster.length} buddies, active=${activeEntry?.soul.name ?? 'none'}`,
        );
      }
    } catch (error) {
      console.error('[Buddy] Failed to load persisted state:', error);
    }
  }

  getCompanion(): Companion | null {
    const entry = this.getActiveEntry();
    if (!entry) return null;
    return this.entryToCompanion(entry);
  }

  isMuted(): boolean {
    return this.muted;
  }

  hatch(): Companion {
    // First hatch (empty roster) is free; subsequent hatches cost HATCH_COST
    if (this.roster.length > 0) {
      const activeEntry = this.getActiveEntry();
      if (!activeEntry) {
        throw new Error('No active buddy to pay hatch cost');
      }
      if (activeEntry.xp < HATCH_COST) {
        throw new Error(`Insufficient XP to hatch. Need ${HATCH_COST}, have ${activeEntry.xp}`);
      }
      if (this.roster.length >= MAX_ROSTER_SIZE) {
        throw new Error(`Roster is full (max ${MAX_ROSTER_SIZE})`);
      }
      // Deduct hatch cost from active buddy
      activeEntry.xp -= HATCH_COST;
    }

    const seed = generateSeed(this.alias);
    const { bones, inspirationSeed } = roll(seed);
    const soul = generateSoul(inspirationSeed, bones.species);

    const emptyBonuses = {} as Record<StatName, number>;
    for (const stat of ALL_STATS) emptyBonuses[stat] = 0;

    const newEntry: BuddyEntry = {
      id: crypto.randomUUID(),
      seed,
      soul: {
        name: soul.name,
        personality: soul.personality,
        hatchedAt: Date.now(),
      },
      xp: 0,
      rarity: bones.rarity,
      statBonuses: emptyBonuses,
    };

    this.roster.push(newEntry);
    this.activeBuddyId = newEntry.id;

    this.persistImmediate();
    return this.entryToCompanion(newEntry);
  }

  rename(name: string): Companion {
    const entry = this.getActiveEntry();
    if (!entry) {
      throw new Error('No companion to rename');
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Name cannot be empty');
    }
    if (trimmed.length > 14) {
      throw new Error('Name must be 14 characters or fewer');
    }

    entry.soul.name = trimmed;
    this.persistImmediate();
    return this.entryToCompanion(entry);
  }

  pet(): number {
    this.petAt = Date.now();
    return this.petAt;
  }

  addXP(
    tokens: number,
    source: 'chat' | 'tool' | 'reaction',
  ): {
    totalXP: number;
    sessionXP: number;
    milestone: Milestone | null;
    levelUp?: { buddyId: string; level: number; statGained: StatName };
  } {
    if (tokens <= 0)
      return {
        totalXP: this.userTotalTokens,
        sessionXP: this.sessionXP,
        milestone: null,
      };

    const entry = this.getActiveEntry();

    // Always track user-level totals
    const oldUserTokens = this.userTotalTokens;
    this.userTotalTokens += tokens;
    this.sessionXP += tokens;
    this.lastXPGain = tokens;

    this.xpHistory.push({
      timestamp: Date.now(),
      tokens,
      source,
    });

    // Keep history bounded
    if (this.xpHistory.length > 100) {
      this.xpHistory = this.xpHistory.slice(-100);
    }

    const milestone = this.checkMilestoneCrossed(oldUserTokens, this.userTotalTokens);

    let levelUp: { buddyId: string; level: number; statGained: StatName } | undefined;

    if (entry) {
      const maxLevel = RARITY_MAX_LEVEL[entry.rarity];
      const oldLevel = Math.min(xpToLevel(entry.xp), maxLevel);
      entry.xp += tokens;
      const newLevel = Math.min(xpToLevel(entry.xp), maxLevel);

      // Process level-ups: apply stat boosts for each level gained
      if (newLevel > oldLevel) {
        const rolled = roll(entry.seed);
        const baseStats = rolled.bones.stats;
        let lastStatGained: StatName = ALL_STATS[0];

        for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
          const stat = getStatBoost(baseStats);
          entry.statBonuses[stat] += 1;
          lastStatGained = stat;
        }

        levelUp = {
          buddyId: entry.id,
          level: newLevel,
          statGained: lastStatGained,
        };
      }
    }

    this.debouncedPersist();

    // Emit events for renderer push
    if (this.eventListener) {
      this.eventListener.onXPUpdated?.(this.getXPData());
      if (levelUp) {
        this.eventListener.onLevelUp?.(levelUp);
      }
      if (milestone) {
        this.eventListener.onMilestone?.(milestone);
      }
    }

    return {
      totalXP: this.userTotalTokens,
      sessionXP: this.sessionXP,
      milestone,
      levelUp,
    };
  }

  getRoster(): { buddies: BuddyEntry[]; activeBuddyId: string; userTotalTokens: number } {
    return {
      buddies: [...this.roster],
      activeBuddyId: this.activeBuddyId,
      userTotalTokens: this.userTotalTokens,
    };
  }

  setActiveBuddy(buddyId: string): Companion {
    const entry = this.roster.find((b) => b.id === buddyId);
    if (!entry) {
      throw new Error('Buddy not found in roster');
    }
    this.activeBuddyId = buddyId;
    this.persistImmediate();
    return this.entryToCompanion(entry);
  }

  mergeBuddies(keepId: string, deleteId: string): MergeResult {
    const kept = this.roster.find((b) => b.id === keepId);
    const deleted = this.roster.find((b) => b.id === deleteId);
    if (!kept || !deleted) {
      throw new Error('Buddy not found in roster');
    }

    const validation = validateMerge(kept, deleted);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const result = executeMerge(this.roster, keepId, deleteId);
    this.roster = result.updatedRoster;

    // If the deleted buddy was active, switch to kept
    if (this.activeBuddyId === deleteId) {
      this.activeBuddyId = keepId;
    }

    this.persistImmediate();
    return result;
  }

  releaseBuddy(buddyId: string): void {
    if (buddyId === this.activeBuddyId) {
      throw new Error('Cannot release the active buddy');
    }
    const idx = this.roster.findIndex((b) => b.id === buddyId);
    if (idx === -1) {
      throw new Error('Buddy not found in roster');
    }
    this.roster.splice(idx, 1);
    this.persistImmediate();
  }

  getXPData(): BuddyXPData {
    return {
      totalXP: this.userTotalTokens,
      sessionXP: this.sessionXP,
      lastXPGain: this.lastXPGain,
      xpHistory: [...this.xpHistory],
    };
  }

  getMilestoneForXP(xp: number): Milestone | null {
    let current: Milestone | null = null;
    for (const m of MILESTONES) {
      if (xp >= m.threshold) {
        current = m;
      } else {
        break;
      }
    }
    return current;
  }

  checkMilestoneCrossed(oldXP: number, newXP: number): Milestone | null {
    const oldMilestone = this.getMilestoneForXP(oldXP);
    const newMilestone = this.getMilestoneForXP(newXP);

    if (!newMilestone) return null;
    if (!oldMilestone) return newMilestone;
    if (newMilestone.threshold > oldMilestone.threshold) return newMilestone;
    return null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.persistImmediate();
  }

  getLastReactionTime(): number {
    return this.lastReactionTime;
  }

  setLastReactionTime(time: number): void {
    this.lastReactionTime = time;
  }

  /** Cancel any pending debounced persist timer (useful for clean shutdown / tests). */
  dispose(): void {
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
      this.persistTimeout = null;
    }
  }

  // --- Private helpers ---

  private getActiveEntry(): BuddyEntry | undefined {
    return this.roster.find((b) => b.id === this.activeBuddyId);
  }

  private entryToCompanion(entry: BuddyEntry): Companion {
    const rolled = roll(entry.seed);
    const stats = { ...rolled.bones.stats };
    for (const stat of ALL_STATS) {
      stats[stat] = Math.min(100, stats[stat] + entry.statBonuses[stat]);
    }
    return {
      ...rolled.bones,
      rarity: entry.rarity,
      stats,
      name: entry.soul.name,
      personality: entry.soul.personality,
      hatchedAt: entry.soul.hatchedAt,
    };
  }

  private persistImmediate(): void {
    if (!this.dataFilePath) return;

    try {
      const data: BuddyRosterData & { muted?: boolean } = {
        version: 2,
        buddies: this.roster,
        activeBuddyId: this.activeBuddyId,
        userTotalTokens: this.userTotalTokens,
        muted: this.muted,
      };
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Buddy] Failed to persist state:', error);
    }
  }

  private debouncedPersist(): void {
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
    }
    this.persistTimeout = setTimeout(() => {
      this.persistImmediate();
      this.persistTimeout = null;
    }, 2000);
  }
}
