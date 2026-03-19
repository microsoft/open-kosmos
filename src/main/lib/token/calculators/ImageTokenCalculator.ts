/**
 * Image Token Calculator
 * Implements the official OpenAI Vision API algorithm
 */

import { ImageTokenOptions, ImageTokenResult, ImageContentPart } from '../types';

export class ImageTokenCalculator {
  
  /**
   * Calculate image tokens (Low detail)
   */
  private calculateLowDetailTokens(): number {
    return 85;
  }
  
  /**
   * Calculate image tokens (High detail)
   * Based on the official OpenAI algorithm
   */
  private calculateHighDetailTokens(
    width: number,
    height: number
  ): ImageTokenResult {
    let w = width;
    let h = height;
    
    const originalSize = { width, height };
    
    // Step 1: Scale to fit within 2048x2048
    if (w > 2048 || h > 2048) {
      const scale = 2048 / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    
    const scaledSize = { width: w, height: h };
    
    // Step 2: Scale the short side to 768
    const scale = 768 / Math.min(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    
    const tiledSize = { width: w, height: h };
    
    // Step 3: Calculate the number of 512x512 tiles
    const tilesW = Math.ceil(w / 512);
    const tilesH = Math.ceil(h / 512);
    const tiles = tilesW * tilesH;
    
    // Step 4: Final token calculation
    const tokens = tiles * 170 + 85;
    
    return {
      tokens,
      detailUsed: 'high',
      tiles,
      calculationInfo: {
        originalSize,
        scaledSize,
        tiledSize
      }
    };
  }
  
  /**
   * Calculate image tokens
   */
  calculateTokens(options: ImageTokenOptions): ImageTokenResult {
    const { detail = 'auto', width, height } = options;
    
    // Low detail directly returns a fixed value
    if (detail === 'low') {
      return {
        tokens: 85,
        detailUsed: 'low',
        calculationInfo: {
          originalSize: { width: width || 0, height: height || 0 }
        }
      };
    }
    
    // Auto or High detail requires size information
    if (!width || !height) {
      throw new Error('Width and height are required for auto/high detail calculation');
    }
    
    // Auto mode: determine based on short side
    if (detail === 'auto') {
      const shortSide = Math.min(width, height);
      if (shortSide <= 768) {
        // Use low detail
        return {
          tokens: 85,
          detailUsed: 'low',
          calculationInfo: {
            originalSize: { width, height }
          }
        };
      }
      // Otherwise use high detail
    }
    
    // High detail calculation
    return this.calculateHighDetailTokens(width, height);
  }
  
  /**
   * Calculate tokens from ImageContentPart
   */
  calculateFromImagePart(imagePart: ImageContentPart): ImageTokenResult {
    return this.calculateTokens({
      detail: imagePart.image_url.detail,
      width: imagePart.metadata.width,
      height: imagePart.metadata.height
    });
  }
}