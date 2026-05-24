// @ts-nocheck
/**
 * Tests for ImageTokenCalculator
 */

import { describe, it, expect } from 'vitest';
import { ImageTokenCalculator } from '../calculators/ImageTokenCalculator';

describe('ImageTokenCalculator', () => {
  let calc: ImageTokenCalculator;

  beforeEach(() => {
    calc = new ImageTokenCalculator();
  });

  // ---- low detail ----

  describe('calculateTokens — low detail', () => {
    it('returns 85 tokens for low detail', () => {
      const result = calc.calculateTokens({ detail: 'low' });
      expect(result.tokens).toBe(85);
      expect(result.detailUsed).toBe('low');
    });

    it('includes originalSize even for low detail without dimensions', () => {
      const result = calc.calculateTokens({ detail: 'low' });
      expect(result.calculationInfo.originalSize).toEqual({ width: 0, height: 0 });
    });

    it('uses provided dimensions in originalSize for low detail', () => {
      const result = calc.calculateTokens({ detail: 'low', width: 800, height: 600 });
      expect(result.calculationInfo.originalSize).toEqual({ width: 800, height: 600 });
    });
  });

  // ---- throws when missing dimensions ----

  describe('calculateTokens — missing dimensions', () => {
    it('throws when auto detail has no width/height', () => {
      expect(() => calc.calculateTokens({ detail: 'auto' }))
        .toThrow('Width and height are required');
    });

    it('throws when high detail has no width/height', () => {
      expect(() => calc.calculateTokens({ detail: 'high' }))
        .toThrow('Width and height are required');
    });
  });

  // ---- auto detail ----

  describe('calculateTokens — auto detail', () => {
    it('uses low detail when short side <= 768', () => {
      // 400x600: shortSide = 400 <= 768 → low
      const result = calc.calculateTokens({ detail: 'auto', width: 400, height: 600 });
      expect(result.tokens).toBe(85);
      expect(result.detailUsed).toBe('low');
    });

    it('uses high detail when short side > 768', () => {
      // 1024x1024: shortSide = 1024 > 768 → high
      const result = calc.calculateTokens({ detail: 'auto', width: 1024, height: 1024 });
      expect(result.detailUsed).toBe('high');
      expect(result.tokens).toBeGreaterThan(85);
    });

    it('defaults to auto detail when detail is not specified', () => {
      // shortSide = 400 → low
      const result = calc.calculateTokens({ width: 400, height: 600 });
      expect(result.tokens).toBe(85);
      expect(result.detailUsed).toBe('low');
    });
  });

  // ---- high detail ----

  describe('calculateTokens — high detail', () => {
    it('computes correct tokens for 1024x1024 (no scaling needed for first step, short side 1024 > 768)', () => {
      // Step 1: 1024 <= 2048 → no scale; w=1024, h=1024
      // Step 2: scale = 768/1024; w=768, h=768
      // Step 3: tilesW=ceil(768/512)=2, tilesH=ceil(768/512)=2, tiles=4
      // Step 4: tokens = 4*170+85 = 765
      const result = calc.calculateTokens({ detail: 'high', width: 1024, height: 1024 });
      expect(result.tokens).toBe(765);
      expect(result.tiles).toBe(4);
      expect(result.detailUsed).toBe('high');
    });

    it('scales down large image (> 2048) before computing tiles', () => {
      // 4096x4096: scale=2048/4096=0.5 → 2048x2048
      // Step 2: scale=768/2048; w=768, h=768
      // Step 3: tilesW=ceil(768/512)=2, tilesH=2, tiles=4
      // Step 4: 4*170+85 = 765
      const result = calc.calculateTokens({ detail: 'high', width: 4096, height: 4096 });
      expect(result.tokens).toBe(765);
    });

    it('handles non-square large image', () => {
      // 3000x2000: scale = 2048/3000 → w=round(2048), h=round(1365)
      const result = calc.calculateTokens({ detail: 'high', width: 3000, height: 2000 });
      expect(result.tokens).toBeGreaterThan(85);
      expect(result.detailUsed).toBe('high');
    });

    it('returns calculationInfo with originalSize, scaledSize, tiledSize', () => {
      const result = calc.calculateTokens({ detail: 'high', width: 1024, height: 1024 });
      expect(result.calculationInfo.originalSize).toBeDefined();
      expect(result.calculationInfo.scaledSize).toBeDefined();
      expect(result.calculationInfo.tiledSize).toBeDefined();
    });
  });

  // ---- calculateFromImagePart ----

  describe('calculateFromImagePart', () => {
    it('delegates to calculateTokens using imagePart fields', () => {
      const imagePart = {
        type: 'image' as const,
        image_url: { url: 'data:image/png;base64,...', detail: 'low' as const },
        metadata: { width: 800, height: 600, mimeType: 'image/png', size: 100 },
      };
      const result = calc.calculateFromImagePart(imagePart);
      expect(result.tokens).toBe(85);
      expect(result.detailUsed).toBe('low');
    });

    it('uses high detail for large images via calculateFromImagePart', () => {
      const imagePart = {
        type: 'image' as const,
        image_url: { url: 'data:...', detail: 'high' as const },
        metadata: { width: 1024, height: 1024, mimeType: 'image/png', size: 100 },
      };
      const result = calc.calculateFromImagePart(imagePart);
      expect(result.detailUsed).toBe('high');
    });
  });
});
