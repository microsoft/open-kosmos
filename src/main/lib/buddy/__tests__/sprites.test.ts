// src/main/lib/buddy/__tests__/sprites.test.ts
import { renderSprite, renderFace, spriteFrameCount } from '../sprites';
import { ALL_SPECIES, CompanionBones } from '../types';

function makeBones(overrides: Partial<CompanionBones> = {}): CompanionBones {
  return {
    rarity: 'common',
    species: 'duck',
    eye: '·',
    hat: 'none',
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    ...overrides,
  };
}

describe('spriteFrameCount', () => {
  it('returns 3 for all 18 species', () => {
    for (const species of ALL_SPECIES) {
      expect(spriteFrameCount(species)).toBe(3);
    }
  });
});

describe('renderSprite', () => {
  it('returns 5 lines', () => {
    const lines = renderSprite(makeBones(), 0);
    expect(lines).toHaveLength(5);
  });

  it('substitutes eye character', () => {
    const bones = makeBones({ eye: '✦' });
    const lines = renderSprite(bones, 0);
    const joined = lines.join('\n');
    expect(joined).toContain('✦');
    expect(joined).not.toContain('{E}');
  });

  it('applies hat overlay on first line for non-none hat', () => {
    const bones = makeBones({ rarity: 'rare', hat: 'crown' });
    const lines = renderSprite(bones, 0);
    expect(lines[0]).toContain('♛');
  });

  it('keeps first line blank for hat=none', () => {
    const bones = makeBones({ hat: 'none' });
    const lines = renderSprite(bones, 0);
    expect(lines[0].trim()).toBe('');
  });

  it('wraps frame index safely', () => {
    const bones = makeBones();
    const lines0 = renderSprite(bones, 0);
    const lines3 = renderSprite(bones, 3);
    expect(lines0).toEqual(lines3);
  });

  it('renders all species without throwing', () => {
    for (const species of ALL_SPECIES) {
      const bones = makeBones({ species });
      for (let f = 0; f < 3; f++) {
        expect(() => renderSprite(bones, f)).not.toThrow();
      }
    }
  });
});

describe('renderFace', () => {
  it('returns non-empty string', () => {
    const face = renderFace(makeBones());
    expect(face.length).toBeGreaterThan(0);
  });

  it('contains the eye character', () => {
    const face = renderFace(makeBones({ eye: '@' }));
    expect(face).toContain('@');
  });

  it('is wrapped in parentheses', () => {
    const face = renderFace(makeBones());
    expect(face.startsWith('(')).toBe(true);
    expect(face.endsWith(')')).toBe(true);
  });
});
