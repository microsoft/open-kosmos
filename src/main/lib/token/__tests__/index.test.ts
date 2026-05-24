/**
 * Tests for token/index.ts — createTokenCounter factory and re-exports
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../calculators/TextTokenCalculator', () => {
  class TextTokenCalculator {
    countTokens(text: string) { return text.length; }
    countTokensBatch(texts: string[]) { return texts.map(t => t.length); }
    clearCache() {}
    getCacheStats() { return { size: 0, maxSize: 0, hits: 0, misses: 0, hitRate: 0 }; }
    getEncoding() { return 'cl100k_base'; }
  }
  return { TextTokenCalculator };
});

vi.mock('../calculators/ImageTokenCalculator', () => {
  class ImageTokenCalculator {
    calculateTokens() { return { tokens: 100, detailUsed: 'low', calculationInfo: { originalSize: { width: 0, height: 0 } } }; }
    calculateFromImagePart() { return { tokens: 100, detailUsed: 'low', calculationInfo: { originalSize: { width: 0, height: 0 } } }; }
  }
  return { ImageTokenCalculator };
});

vi.mock('../calculators/ToolsTokenCalculator', () => {
  class ToolsTokenCalculator {
    calculateAllToolsTokens() { return { totalTokens: 0, toolTokens: [], basePromptTokens: 0 }; }
    calculateSystemPromptWithTools(prompt: string) { return { totalTokens: prompt.length, toolTokens: [], basePromptTokens: prompt.length }; }
  }
  return { ToolsTokenCalculator };
});

import {
  createTokenCounter,
  TokenCounter,
  TextTokenCalculator,
  ImageTokenCalculator,
  ToolsTokenCalculator,
  TikTokenEncoder,
  EncoderCache,
} from '../index';

describe('token/index — createTokenCounter', () => {
  it('creates a TokenCounter with no config', () => {
    const counter = createTokenCounter();
    expect(counter).toBeInstanceOf(TokenCounter);
  });

  it('creates a TokenCounter with config', () => {
    const counter = createTokenCounter({ defaultEncoding: 'o200k_base' });
    expect(counter).toBeInstanceOf(TokenCounter);
  });

  it('returned counter can count text tokens', () => {
    const counter = createTokenCounter();
    expect(counter.countTextTokens('hello')).toBe(5); // mocked: text.length
  });
});

describe('token/index — re-exports', () => {
  it('exports TokenCounter class', () => {
    expect(TokenCounter).toBeDefined();
  });

  it('exports TextTokenCalculator class', () => {
    expect(TextTokenCalculator).toBeDefined();
  });

  it('exports ImageTokenCalculator class', () => {
    expect(ImageTokenCalculator).toBeDefined();
  });

  it('exports ToolsTokenCalculator class', () => {
    expect(ToolsTokenCalculator).toBeDefined();
  });
});
