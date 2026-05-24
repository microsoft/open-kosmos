/**
 * Tests for TextTokenCalculator (with mocked EncoderCache/TikTokenEncoder)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock EncoderCache so we don't need js-tiktoken loaded
const mockCountTokens = vi.fn((text: string) => text.length);

vi.mock('../encoders/EncoderCache', () => ({
  EncoderCache: {
    getInstance: () => ({
      getEncoder: () => ({
        countTokens: (text: string, _allowedSpecial?: any) => mockCountTokens(text),
      }),
    }),
  },
}));

import { TextTokenCalculator } from '../calculators/TextTokenCalculator';

describe('TextTokenCalculator', () => {
  let calc: TextTokenCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new TextTokenCalculator();
  });

  // ---- countTokens basic ----

  describe('countTokens', () => {
    it('returns 0 for empty string', () => {
      expect(calc.countTokens('')).toBe(0);
    });

    it('returns 0 for falsy input', () => {
      expect(calc.countTokens(null as any)).toBe(0);
    });

    it('delegates to encoder and returns token count', () => {
      mockCountTokens.mockReturnValue(5);
      expect(calc.countTokens('hello')).toBe(5);
    });

    it('uses per-call encoding override when provided', () => {
      calc.countTokens('hello', { encoding: 'o200k_base' });
      // encoder was requested (we don't verify the encoding key here, but no throw)
      expect(mockCountTokens).toHaveBeenCalledTimes(1);
    });
  });

  // ---- caching ----

  describe('caching', () => {
    it('hits cache on second identical call', () => {
      mockCountTokens.mockReturnValue(3);
      calc.countTokens('abc');
      calc.countTokens('abc');
      expect(mockCountTokens).toHaveBeenCalledTimes(1); // second was cache hit
    });

    it('misses cache for different text', () => {
      mockCountTokens.mockReturnValue(3);
      calc.countTokens('abc');
      calc.countTokens('xyz');
      expect(mockCountTokens).toHaveBeenCalledTimes(2);
    });

    it('does not use cache when enableCache=false', () => {
      const noCache = new TextTokenCalculator({ enableCache: false });
      mockCountTokens.mockReturnValue(3);
      noCache.countTokens('abc');
      noCache.countTokens('abc');
      expect(mockCountTokens).toHaveBeenCalledTimes(2);
    });

    it('evicts oldest entry when cache exceeds maxSize', () => {
      const smallCache = new TextTokenCalculator({ cacheSize: 2 });
      mockCountTokens.mockReturnValue(1);
      smallCache.countTokens('a');
      smallCache.countTokens('b');
      smallCache.countTokens('c'); // should evict 'a'
      // Now if we call 'a' again it should be a cache miss
      smallCache.countTokens('a');
      // 4 unique calls + 1 repeated 'a' = 4 encoder calls (a evicted, recalculated)
      expect(mockCountTokens).toHaveBeenCalledTimes(4);
    });
  });

  // ---- getCacheStats ----

  describe('getCacheStats', () => {
    it('reports 0 hits/misses initially', () => {
      const stats = calc.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('tracks hits and misses correctly', () => {
      mockCountTokens.mockReturnValue(2);
      calc.countTokens('hello');  // miss
      calc.countTokens('hello');  // hit
      calc.countTokens('world');  // miss

      const stats = calc.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(1 / 3);
    });
  });

  // ---- clearCache ----

  describe('clearCache', () => {
    it('resets cache and stats', () => {
      mockCountTokens.mockReturnValue(2);
      calc.countTokens('a');
      calc.clearCache();

      const stats = calc.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // After clear, 'a' should be a cache miss again
      calc.countTokens('a');
      expect(mockCountTokens).toHaveBeenCalledTimes(2);
    });
  });

  // ---- countTokensBatch ----

  describe('countTokensBatch', () => {
    it('returns array of token counts for each text', () => {
      mockCountTokens.mockReturnValueOnce(3).mockReturnValueOnce(5);
      const results = calc.countTokensBatch(['abc', 'hello']);
      expect(results).toEqual([3, 5]);
    });

    it('returns empty array for empty input', () => {
      expect(calc.countTokensBatch([])).toEqual([]);
    });
  });

  // ---- getEncoding ----

  describe('getEncoding', () => {
    it('returns cl100k_base by default', () => {
      expect(calc.getEncoding()).toBe('cl100k_base');
    });

    it('returns o200k_base when configured', () => {
      const calc2 = new TextTokenCalculator({ encoding: 'o200k_base' });
      expect(calc2.getEncoding()).toBe('o200k_base');
    });
  });
});
