import { shouldThrottle, buildReactionPrompt, generateReaction } from '../reactionEngine';
import { Companion } from '../types';

function makeCompanion(overrides: Partial<Companion> = {}): Companion {
  return {
    rarity: 'common',
    species: 'duck',
    eye: '·',
    hat: 'none',
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    name: 'Test Duck',
    personality: 'cheerfully unhelpful',
    hatchedAt: Date.now(),
    ...overrides,
  };
}

describe('shouldThrottle', () => {
  it('returns true when called within 60s', () => {
    const recent = Date.now() - 30_000;
    expect(shouldThrottle(recent)).toBe(true);
  });

  it('returns false when called after 60s', () => {
    const old = Date.now() - 61_000;
    expect(shouldThrottle(old)).toBe(false);
  });

  it('returns false when lastReactionTime is 0 (never reacted)', () => {
    expect(shouldThrottle(0)).toBe(false);
  });
});

describe('buildReactionPrompt', () => {
  it('includes companion name and personality', () => {
    const companion = makeCompanion({ name: 'Pip', personality: 'aggressively supportive' });
    const prompt = buildReactionPrompt(companion, 'hello', 'hi there');
    expect(prompt).toContain('Pip');
    expect(prompt).toContain('aggressively supportive');
  });

  it('includes companion species', () => {
    const companion = makeCompanion({ species: 'cat' });
    const prompt = buildReactionPrompt(companion, 'hello', 'hi');
    expect(prompt).toContain('cat');
  });

  it('truncates long user messages to 200 chars', () => {
    const companion = makeCompanion();
    const longMsg = 'x'.repeat(500);
    const prompt = buildReactionPrompt(companion, longMsg, 'reply');
    expect(prompt).not.toContain('x'.repeat(500));
    expect(prompt).toContain('x'.repeat(200));
  });

  it('truncates long assistant messages to 300 chars', () => {
    const companion = makeCompanion();
    const longMsg = 'y'.repeat(600);
    const prompt = buildReactionPrompt(companion, 'hi', longMsg);
    expect(prompt).not.toContain('y'.repeat(600));
    expect(prompt).toContain('y'.repeat(300));
  });
});

describe('generateReaction', () => {
  it('returns undefined when throttled', async () => {
    const companion = makeCompanion();
    const recentTime = Date.now() - 10_000;
    const mockLLM = vi.fn().mockResolvedValue('quack!');

    const result = await generateReaction(companion, 'hi', 'hello', recentTime, mockLLM);
    expect(result).toBeUndefined();
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('calls LLM and returns reaction text when not throttled', async () => {
    const companion = makeCompanion();
    const oldTime = Date.now() - 120_000;
    const mockLLM = vi.fn().mockResolvedValue('quack quack!');

    const result = await generateReaction(companion, 'hi', 'hello', oldTime, mockLLM);
    expect(result).toEqual({ text: 'quack quack!' });
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it('returns undefined on LLM error', async () => {
    const companion = makeCompanion();
    const oldTime = 0;
    const mockLLM = vi.fn().mockRejectedValue(new Error('API down'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await generateReaction(companion, 'hi', 'hello', oldTime, mockLLM);
    expect(result).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('caps reaction text at 80 chars', async () => {
    const companion = makeCompanion();
    const oldTime = 0;
    const mockLLM = vi.fn().mockResolvedValue('a'.repeat(200));

    const result = await generateReaction(companion, 'hi', 'hello', oldTime, mockLLM);
    expect(result).toBeTruthy();
    expect(result!.text.length).toBeLessThanOrEqual(80);
  });

  it('returns undefined for empty LLM response', async () => {
    const companion = makeCompanion();
    const oldTime = 0;
    const mockLLM = vi.fn().mockResolvedValue('   ');

    const result = await generateReaction(companion, 'hi', 'hello', oldTime, mockLLM);
    expect(result).toBeUndefined();
  });
});
