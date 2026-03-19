/**
 * Text Token Calculator
 * Uses TikToken for precise calculation
 */

import { EncoderCache } from '../encoders/EncoderCache';
import { TextTokenOptions, CacheStats } from '../types';

export class TextTokenCalculator {
  private encoding: 'cl100k_base' | 'o200k_base';
  private cache: Map<string, number>;
  private cacheEnabled: boolean;
  private maxCacheSize: number;
  private cacheHits: number;
  private cacheMisses: number;
  
  constructor(config: {
    encoding?: 'cl100k_base' | 'o200k_base';
    enableCache?: boolean;
    cacheSize?: number;
  } = {}) {
    this.encoding = config.encoding || 'cl100k_base';
    this.cacheEnabled = config.enableCache !== false;
    this.maxCacheSize = config.cacheSize || 10000;
    this.cache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
  
  /**
   * Count the number of tokens in text
   */
  countTokens(
    text: string,
    options: TextTokenOptions = {}
  ): number {
    if (!text) return 0;
    
    // Use the specified encoder or default encoder
    const encoding = options.encoding || this.encoding;
    
    // Check cache
    const cacheKey = `${text}:${encoding}`;
    if (this.cacheEnabled && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey)!;
    }
    
    // Cache miss
    if (this.cacheEnabled) {
      this.cacheMisses++;
    }
    
    // Get encoder
    const encoder = EncoderCache.getInstance().getEncoder(encoding);
    
    // Calculate tokens
    const tokenCount = encoder.countTokens(text, options.allowedSpecial);
    
    // Store in cache
    if (this.cacheEnabled) {
      // LRU policy: delete the oldest when limit is exceeded
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
      this.cache.set(cacheKey, tokenCount);
    }
    
    return tokenCount;
  }
  
  /**
   * Batch calculate tokens for multiple texts
   */
  countTokensBatch(texts: string[]): number[] {
    return texts.map(text => this.countTokens(text));
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheHits + this.cacheMisses > 0
        ? this.cacheHits / (this.cacheHits + this.cacheMisses)
        : 0
    };
  }
  
  /**
   * Get current encoder type
   */
  getEncoding(): 'cl100k_base' | 'o200k_base' {
    return this.encoding;
  }
}