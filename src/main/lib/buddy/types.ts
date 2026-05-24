// src/main/lib/buddy/types.ts

// --- Enums as union types ---

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type Species =
  | 'duck'
  | 'goose'
  | 'blob'
  | 'cat'
  | 'dragon'
  | 'octopus'
  | 'owl'
  | 'penguin'
  | 'turtle'
  | 'snail'
  | 'ghost'
  | 'axolotl'
  | 'capybara'
  | 'cactus'
  | 'robot'
  | 'rabbit'
  | 'mushroom'
  | 'chonk';

export type Eye = '·' | '✦' | '×' | '◉' | '@' | '°';

export type Hat = 'none' | 'crown' | 'tophat' | 'propeller' | 'halo' | 'wizard' | 'beanie' | 'tinyduck';

export type StatName = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

// --- Constants ---

export const ALL_SPECIES: Species[] = [
  'duck',
  'goose',
  'blob',
  'cat',
  'dragon',
  'octopus',
  'owl',
  'penguin',
  'turtle',
  'snail',
  'ghost',
  'axolotl',
  'capybara',
  'cactus',
  'robot',
  'rabbit',
  'mushroom',
  'chonk',
];

export const ALL_EYES: Eye[] = ['·', '✦', '×', '◉', '@', '°'];

export const ALL_HATS: Hat[] = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'];

export const ALL_STATS: StatName[] = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'];

export const RARITY_STARS: Record<Rarity, string> = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9ca3af', // gray
  uncommon: '#22c55e', // green
  rare: '#3b82f6', // blue
  epic: '#a855f7', // purple
  legendary: '#eab308', // gold
};

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};

export const STAT_FLOORS: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
};

export const SALT = 'friend-2026-401';

// --- Milestone system ---

export interface Milestone {
  name: string;
  threshold: number;
}

export const MILESTONES: Milestone[] = [
  { name: 'Novice', threshold: 1_000 },
  { name: 'Apprentice', threshold: 10_000 },
  { name: 'Journeyman', threshold: 100_000 },
  { name: 'Expert', threshold: 1_000_000 },
  { name: 'Master', threshold: 10_000_000 },
];

// --- Data structures ---

export interface CompanionBones {
  rarity: Rarity;
  species: Species;
  eye: Eye;
  hat: Hat;
  shiny: boolean;
  stats: Record<StatName, number>;
}

export interface CompanionSoul {
  name: string;
  personality: string;
}

export interface StoredCompanion extends CompanionSoul {
  hatchedAt: number;
}

export interface Companion extends CompanionBones, StoredCompanion {}

export interface Roll {
  bones: CompanionBones;
  inspirationSeed: number;
}

export interface BuddyXPData {
  totalXP: number;
  sessionXP: number;
  lastXPGain: number;
  xpHistory: Array<{
    timestamp: number;
    tokens: number;
    source: 'chat' | 'tool' | 'reaction';
  }>;
}

export interface BuddyPersistence {
  companionSeed?: string;
  companion?: StoredCompanion;
  companionMuted?: boolean;
  buddyXP?: {
    totalXP: number;
    lastXPGain: number;
    xpHistory: BuddyXPData['xpHistory'];
  };
  buddyWidgetPosition?: { x: number; y: number };
  buddyWidgetMinimized?: boolean;
}

// --- V2: Multi-buddy roster ---

/** Rarity-gated level caps */
export const RARITY_MAX_LEVEL: Record<Rarity, number> = {
  common: 20,
  uncommon: 40,
  rare: 60,
  epic: 80,
  legendary: 100,
};

/** XP cost to hatch a new buddy (deducted from active buddy's XP) */
export const HATCH_COST = 1;

/** Max buddies in a roster */
export const MAX_ROSTER_SIZE = 100;

/** Ordered rarity tiers for merge upgrades */
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Get the next rarity tier, or null if already legendary */
export function nextRarity(rarity: Rarity): Rarity | null {
  const idx = RARITY_ORDER.indexOf(rarity);
  if (idx < 0 || idx >= RARITY_ORDER.length - 1) return null;
  return RARITY_ORDER[idx + 1];
}

/** A single buddy in the roster */
export interface BuddyEntry {
  id: string;
  seed: string;
  soul: StoredCompanion;
  xp: number;
  rarity: Rarity;
  statBonuses: Record<StatName, number>;
}

/** User-level roster data, persisted to buddy.json */
export interface BuddyRosterData {
  version: 2;
  buddies: BuddyEntry[];
  activeBuddyId: string;
  userTotalTokens: number;
}
