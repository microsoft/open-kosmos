import { describe, expect, it } from 'vitest';
import { ALL_SPECIES, ALL_STATS, MILESTONES, RARITY_ORDER } from '../../../../main/lib/buddy/types';
import { translate, type TranslationKey, type TranslationParams } from '../../../lib/i18n';
import {
  getBuddyMergeErrorMessage,
  getBuddyMilestoneLabel,
  getBuddyRarityLabel,
  getBuddySpeciesLabel,
  getBuddyStatLabel,
} from '../buddyLabels';

const t = (key: TranslationKey, params?: TranslationParams) => translate('en', key, params);

describe('buddyLabels', () => {
  it('translates all rarity labels', () => {
    expect(RARITY_ORDER.map((rarity) => getBuddyRarityLabel(t, rarity))).toEqual([
      'Common',
      'Uncommon',
      'Rare',
      'Epic',
      'Legendary',
    ]);
  });

  it('translates all species labels', () => {
    expect(ALL_SPECIES.map((species) => getBuddySpeciesLabel(t, species))).toContain('Axolotl');
    expect(ALL_SPECIES.map((species) => getBuddySpeciesLabel(t, species))).toContain('Chonk');
  });

  it('translates all stat labels', () => {
    expect(ALL_STATS.map((stat) => getBuddyStatLabel(t, stat))).toEqual([
      'Debugging',
      'Patience',
      'Chaos',
      'Wisdom',
      'Snark',
    ]);
  });

  it('preserves unknown rarity, species, and stat values', () => {
    expect(getBuddyRarityLabel(t, 'mythic' as any)).toBe('mythic');
    expect(getBuddySpeciesLabel(t, 'phoenix' as any)).toBe('phoenix');
    expect(getBuddyStatLabel(t, 'LUCK' as any)).toBe('LUCK');
  });

  it('translates known milestones and preserves unknown milestones', () => {
    expect(MILESTONES.map((milestone) => getBuddyMilestoneLabel(t, milestone))).toEqual([
      'Novice',
      'Apprentice',
      'Journeyman',
      'Expert',
      'Master',
    ]);
    expect(getBuddyMilestoneLabel(t, null)).toBeNull();
    expect(getBuddyMilestoneLabel(t, { name: 'Custom', threshold: 123 })).toBe('Custom');
  });

  it('translates known merge errors and preserves unknown errors', () => {
    expect(getBuddyMergeErrorMessage(t, 'Cannot merge a buddy with itself')).toBe('Cannot merge a buddy with itself');
    expect(getBuddyMergeErrorMessage(t, 'Legendary buddies are already at maximum rarity')).toBe(
      'Legendary buddies are already at maximum rarity',
    );
    expect(getBuddyMergeErrorMessage(t, 'Must be same species and same rarity')).toBe(
      'Must be same species and same rarity',
    );
    expect(getBuddyMergeErrorMessage(t, 'Must reach Lv.40 before merging')).toBe(
      'Must reach Lv.40 before merging',
    );
    expect(getBuddyMergeErrorMessage(t, 'Unexpected merge error')).toBe('Unexpected merge error');
  });
});
