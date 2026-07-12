import type { Milestone, Rarity, Species, StatName } from '../../../main/lib/buddy/types';
import type { TranslationKey, TranslationParams } from '../../lib/i18n';

type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

const rarityKeys: Record<Rarity, TranslationKey> = {
  common: 'buddy.rarity.common',
  uncommon: 'buddy.rarity.uncommon',
  rare: 'buddy.rarity.rare',
  epic: 'buddy.rarity.epic',
  legendary: 'buddy.rarity.legendary',
};

const speciesKeys: Record<Species, TranslationKey> = {
  duck: 'buddy.species.duck',
  goose: 'buddy.species.goose',
  blob: 'buddy.species.blob',
  cat: 'buddy.species.cat',
  dragon: 'buddy.species.dragon',
  octopus: 'buddy.species.octopus',
  owl: 'buddy.species.owl',
  penguin: 'buddy.species.penguin',
  turtle: 'buddy.species.turtle',
  snail: 'buddy.species.snail',
  ghost: 'buddy.species.ghost',
  axolotl: 'buddy.species.axolotl',
  capybara: 'buddy.species.capybara',
  cactus: 'buddy.species.cactus',
  robot: 'buddy.species.robot',
  rabbit: 'buddy.species.rabbit',
  mushroom: 'buddy.species.mushroom',
  chonk: 'buddy.species.chonk',
};

const statKeys: Record<StatName, TranslationKey> = {
  DEBUGGING: 'buddy.stat.debugging',
  PATIENCE: 'buddy.stat.patience',
  CHAOS: 'buddy.stat.chaos',
  WISDOM: 'buddy.stat.wisdom',
  SNARK: 'buddy.stat.snark',
};

const milestoneKeys: Record<string, TranslationKey> = {
  Novice: 'buddy.milestone.novice',
  Apprentice: 'buddy.milestone.apprentice',
  Journeyman: 'buddy.milestone.journeyman',
  Expert: 'buddy.milestone.expert',
  Master: 'buddy.milestone.master',
};

const mergeErrorMaxLevelPattern = /^Must reach Lv\.(\d+) before merging$/;

export function getBuddyRarityLabel(t: TranslateFn, rarity: Rarity): string {
  const key = rarityKeys[rarity];
  return key ? t(key) : rarity;
}

export function getBuddySpeciesLabel(t: TranslateFn, species: Species): string {
  const key = speciesKeys[species];
  return key ? t(key) : species;
}

export function getBuddyStatLabel(t: TranslateFn, stat: StatName): string {
  const key = statKeys[stat];
  return key ? t(key) : stat;
}

export function getBuddyMilestoneLabel(t: TranslateFn, milestone: Milestone | null | undefined): string | null {
  if (!milestone) return null;
  const key = milestoneKeys[milestone.name];
  return key ? t(key) : milestone.name;
}

export function getBuddyMergeErrorMessage(t: TranslateFn, error: string): string {
  if (error === 'Cannot merge a buddy with itself') {
    return t('buddy.mergeError.sameBuddy');
  }
  if (error === 'Legendary buddies are already at maximum rarity') {
    return t('buddy.mergeError.legendaryMax');
  }
  if (error === 'Must be same species and same rarity') {
    return t('buddy.mergeError.sameSpeciesAndRarity');
  }

  const maxLevelMatch = error.match(mergeErrorMaxLevelPattern);
  if (maxLevelMatch) {
    return t('buddy.mergeError.mustReachLevel', { level: maxLevelMatch[1] });
  }

  return error;
}
