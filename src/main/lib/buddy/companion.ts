// src/main/lib/buddy/companion.ts
import {
  Rarity, Species, Eye, Hat, StatName, CompanionBones, CompanionSoul,
  Roll, ALL_SPECIES, ALL_EYES, ALL_HATS, ALL_STATS,
  RARITY_WEIGHTS, STAT_FLOORS, SALT,
} from './types';

// --- Mulberry32 PRNG ---
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- FNV-1a hash ---
export function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// --- Roll helpers ---
export function rollRarity(rand: () => number): Rarity {
  const rarities: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (const r of rarities) {
    roll -= RARITY_WEIGHTS[r];
    if (roll <= 0) return r;
  }
  return 'common';
}

export function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function rollStats(rarity: Rarity, rand: () => number): Record<StatName, number> {
  const floor = STAT_FLOORS[rarity];
  const result = {} as Record<StatName, number>;
  for (const stat of ALL_STATS) {
    result[stat] = floor + Math.floor(rand() * (100 - floor + 1));
  }
  return result;
}

// --- Word list for soul generation (~200 words) ---
const ADJECTIVES = [
  'sleepy', 'brave', 'tiny', 'cosmic', 'wobbly', 'fuzzy', 'grumpy', 'sparkly',
  'sneaky', 'dizzy', 'fluffy', 'rusty', 'clever', 'lazy', 'mighty', 'silly',
  'spooky', 'ancient', 'bubbly', 'calm', 'daring', 'eager', 'fancy', 'gentle',
  'happy', 'icy', 'jolly', 'keen', 'lively', 'mellow', 'noble', 'odd',
  'peppy', 'quiet', 'rowdy', 'swift', 'tough', 'vivid', 'warm', 'zesty',
  'bouncy', 'crispy', 'dreamy', 'electric', 'frosty', 'goofy', 'hasty', 'itchy',
  'jittery', 'knightly', 'lumpy', 'misty', 'nerdy', 'plucky', 'quirky', 'rascal',
  'salty', 'toasty', 'upbeat', 'wacky', 'zippy', 'bold', 'chunky', 'dusty',
  'feisty', 'gleeful', 'heroic', 'inky', 'jumpy', 'kooky', 'lunar', 'moody',
  'nifty', 'perky', 'radiant', 'stormy', 'turbo', 'ultra', 'witty', 'yappy',
];

const NOUNS = [
  'noodle', 'pixel', 'waffle', 'sprout', 'pickle', 'muffin', 'nugget', 'pebble',
  'biscuit', 'doodle', 'button', 'crumble', 'fidget', 'glimmer', 'hiccup', 'jingle',
  'kernel', 'lemon', 'marble', 'napkin', 'orbit', 'puddle', 'quartz', 'ripple',
  'socket', 'trinket', 'urchin', 'vertex', 'widget', 'zephyr', 'acorn', 'bobbin',
  'clover', 'dimple', 'ember', 'freckle', 'goblet', 'harbor', 'icicle', 'jasper',
  'kettle', 'lantern', 'mitten', 'nectar', 'olive', 'parsnip', 'quill', 'raisin',
  'satchel', 'thimble', 'umbrella', 'velvet', 'whisker', 'yarnball', 'zigzag', 'anchor',
  'bramble', 'cobalt', 'dewdrop', 'fossil', 'gizmo', 'hazelnut', 'inkwell', 'juniper',
  'kibble', 'locket', 'morsel', 'nimbus', 'opal', 'parchment', 'riddle', 'starlet',
  'toadstool', 'updraft', 'vortex', 'wombat', 'zenith', 'badge', 'cipher', 'flicker',
];

const PERSONALITIES = [
  'cheerfully unhelpful', 'aggressively supportive', 'suspiciously optimistic',
  'passively chaotic', 'dramatically bored', 'enthusiastically confused',
  'quietly menacing', 'relentlessly wholesome', 'casually omniscient',
  'perpetually startled', 'serenely unhinged', 'professionally silly',
  'accidentally wise', 'determinedly lost', 'blissfully unaware',
  'intensely chill', 'chronically early', 'elegantly clumsy',
  'mysteriously obvious', 'proudly mediocre',
];

// --- Roll cache ---
const rollCache = new Map<string, Roll>();

export function clearRollCache(): void {
  rollCache.clear();
}

// --- Main roll function ---
export function roll(seed: string): Roll {
  const cached = rollCache.get(seed);
  if (cached) return cached;

  const hash = hashString(seed + SALT);
  const rand = mulberry32(hash);

  const rarity = rollRarity(rand);
  const species = pick(ALL_SPECIES, rand);
  const eye = pick(ALL_EYES, rand);

  // common forces hat=none; others roll normally
  const hat: Hat = rarity === 'common' ? 'none' : pick(ALL_HATS, rand);

  // 5% shiny chance (legendary bumps to 20%)
  const shinyThreshold = rarity === 'legendary' ? 0.20 : 0.05;
  const shiny = rand() < shinyThreshold;

  const stats = rollStats(rarity, rand);

  // inspirationSeed for soul generation
  const inspirationSeed = Math.floor(rand() * 0xFFFFFFFF);

  const result: Roll = {
    bones: { rarity, species, eye, hat, shiny, stats },
    inspirationSeed,
  };

  rollCache.set(seed, result);
  return result;
}

// --- Soul generation ---
export function generateSoul(inspirationSeed: number, species: Species): CompanionSoul {
  const rand = mulberry32(inspirationSeed);

  const adj = pick(ADJECTIVES, rand);
  const noun = pick(NOUNS, rand);
  const name =
    `${adj.charAt(0).toUpperCase() + adj.slice(1)} ${noun.charAt(0).toUpperCase() + noun.slice(1)}`;

  const personality = pick(PERSONALITIES, rand);

  return { name, personality };
}

// --- Seed generation ---
export function generateSeed(alias: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${alias}-${timestamp}-${random}`;
}
