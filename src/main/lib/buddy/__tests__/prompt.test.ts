import { getBuddySystemPrompt } from '../prompt';
import { Companion } from '../types';

function makeCompanion(overrides: Partial<Companion> = {}): Companion {
  return {
    rarity: 'rare',
    species: 'duck',
    eye: '·',
    hat: 'crown',
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    name: 'Sparkle Noodle',
    personality: 'suspiciously optimistic',
    hatchedAt: Date.now(),
    ...overrides,
  };
}

describe('getBuddySystemPrompt', () => {
  it('returns empty string when companion is null', () => {
    expect(getBuddySystemPrompt(null)).toBe('');
  });

  it('includes companion name', () => {
    const prompt = getBuddySystemPrompt(makeCompanion({ name: 'Pip' }));
    expect(prompt).toContain('Pip');
  });

  it('includes species', () => {
    const prompt = getBuddySystemPrompt(makeCompanion({ species: 'cat' }));
    expect(prompt).toContain('cat');
  });

  it('includes personality', () => {
    const prompt = getBuddySystemPrompt(makeCompanion({ personality: 'casually omniscient' }));
    expect(prompt).toContain('casually omniscient');
  });

  it('includes rarity stars', () => {
    const prompt = getBuddySystemPrompt(makeCompanion({ rarity: 'rare' }));
    expect(prompt).toContain('★★★');
  });

  it('includes rarity text', () => {
    const prompt = getBuddySystemPrompt(makeCompanion({ rarity: 'epic' }));
    expect(prompt).toContain('epic');
  });
});
