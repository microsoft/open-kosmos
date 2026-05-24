// @ts-nocheck
/**
 * Tests for TokenCounter additional public methods
 * Covers: countTextTokens, countImageTokens, countToolsTokens,
 *         countSystemPromptWithTools, clearCache, getCacheStats, getEncoding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockTextCountTokens = vi.fn((text: string) => text.length);
const mockTextClearCache = vi.fn();
const mockTextGetCacheStats = vi.fn(() => ({ size: 5, maxSize: 1000, hits: 3, misses: 2, hitRate: 0.6 }));
const mockTextGetEncoding = vi.fn(() => 'o200k_base' as const);

vi.mock('../calculators/TextTokenCalculator', () => {
  class TextTokenCalculator {
    countTokens(text: string) { return mockTextCountTokens(text); }
    clearCache() { return mockTextClearCache(); }
    getCacheStats() { return mockTextGetCacheStats(); }
    getEncoding() { return mockTextGetEncoding(); }
  }
  return { TextTokenCalculator };
});

const mockImageCalcTokens = vi.fn(() => ({ tokens: 255, detailUsed: 'high' as const, tiles: 2, calculationInfo: { originalSize: { width: 512, height: 512 } } }));

vi.mock('../calculators/ImageTokenCalculator', () => {
  class ImageTokenCalculator {
    calculateTokens(opts: any) { return mockImageCalcTokens(opts); }
    calculateFromImagePart() { return { tokens: 100, detailUsed: 'low' as const, calculationInfo: { originalSize: { width: 0, height: 0 } } }; }
  }
  return { ImageTokenCalculator };
});

const mockToolsAllTokens = vi.fn(() => ({ totalTokens: 42, toolTokens: [], basePromptTokens: 0 }));
const mockToolsSystemWithTools = vi.fn(() => ({ totalTokens: 100, toolTokens: [], basePromptTokens: 50 }));

vi.mock('../calculators/ToolsTokenCalculator', () => {
  class ToolsTokenCalculator {
    calculateAllToolsTokens(tools: any) { return mockToolsAllTokens(tools); }
    calculateSystemPromptWithTools(prompt: string, tools: any) { return mockToolsSystemWithTools(prompt, tools); }
  }
  return { ToolsTokenCalculator };
});

import { TokenCounter } from '../TokenCounter';

describe('TokenCounter — additional methods', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    vi.clearAllMocks();
    counter = new TokenCounter({ defaultEncoding: 'o200k_base' });
  });

  describe('countTextTokens', () => {
    it('delegates to textCalculator.countTokens', () => {
      mockTextCountTokens.mockReturnValue(7);
      expect(counter.countTextTokens('test text')).toBe(7);
      expect(mockTextCountTokens).toHaveBeenCalledWith('test text');
    });
  });

  describe('countImageTokens', () => {
    it('delegates to imageCalculator.calculateTokens', () => {
      const opts = { detail: 'high' as const, width: 512, height: 512 };
      const result = counter.countImageTokens(opts);
      expect(result.tokens).toBe(255);
      expect(mockImageCalcTokens).toHaveBeenCalledWith(opts);
    });
  });

  describe('countToolsTokens', () => {
    it('delegates to toolsCalculator.calculateAllToolsTokens', () => {
      const tools = [{ name: 'search', description: 'Search the web' }];
      const result = counter.countToolsTokens(tools);
      expect(result.totalTokens).toBe(42);
      expect(mockToolsAllTokens).toHaveBeenCalledWith(tools);
    });
  });

  describe('countSystemPromptWithTools', () => {
    it('delegates to toolsCalculator.calculateSystemPromptWithTools', () => {
      const tools = [{ name: 'read', description: 'Read files' }];
      const result = counter.countSystemPromptWithTools('You are a helpful assistant.', tools);
      expect(result.totalTokens).toBe(100);
      expect(result.basePromptTokens).toBe(50);
      expect(mockToolsSystemWithTools).toHaveBeenCalledWith('You are a helpful assistant.', tools);
    });
  });

  describe('clearCache', () => {
    it('delegates to textCalculator.clearCache', () => {
      counter.clearCache();
      expect(mockTextClearCache).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCacheStats', () => {
    it('delegates to textCalculator.getCacheStats', () => {
      const stats = counter.getCacheStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
      expect(mockTextGetCacheStats).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEncoding', () => {
    it('delegates to textCalculator.getEncoding', () => {
      expect(counter.getEncoding()).toBe('o200k_base');
    });
  });

  describe('constructor with encoding alias', () => {
    it('accepts encoding alias (same as defaultEncoding)', () => {
      const c = new TokenCounter({ encoding: 'cl100k_base' });
      expect(c).toBeInstanceOf(TokenCounter);
    });
  });

  describe('countMessageTokens — image content', () => {
    it('counts image content parts via imageCalculator.calculateFromImagePart', () => {
      // imageCalculator.calculateFromImagePart returns { tokens: 255, ... }
      const imagePart = {
        type: 'image' as const,
        image_url: { url: 'data:...', detail: 'high' as const },
        metadata: { width: 1024, height: 1024, mimeType: 'image/png', size: 1000 },
      };
      const message = {
        id: 'msg-img',
        role: 'user' as const,
        timestamp: Date.now(),
        content: [imagePart],
      } as any;

      // BASE_TOKENS_PER_MESSAGE (3) + imageCalculator.calculateFromImagePart result (100)
      const result = counter.countMessageTokens(message);
      expect(result).toBe(3 + 100);
    });
  });
});
