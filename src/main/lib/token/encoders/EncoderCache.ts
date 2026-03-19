/**
 * Encoder Cache Management
 * Singleton pattern to avoid redundant encoder creation
 */

import { TikTokenEncoder } from './TikTokenEncoder';

export class EncoderCache {
  private static instance: EncoderCache;
  private encoders: Map<string, TikTokenEncoder> = new Map();
  
  private constructor() {}
  
  static getInstance(): EncoderCache {
    if (!EncoderCache.instance) {
      EncoderCache.instance = new EncoderCache();
    }
    return EncoderCache.instance;
  }
  
  /**
   * Get or create an encoder
   */
  getEncoder(encoding: 'cl100k_base' | 'o200k_base' = 'cl100k_base'): TikTokenEncoder {
    if (!this.encoders.has(encoding)) {
      this.encoders.set(encoding, new TikTokenEncoder(encoding));
    }
    return this.encoders.get(encoding)!;
  }
  
  /**
   * Clear all encoders
   */
  clearAll(): void {
    this.encoders.clear();
  }
  
  /**
   * Get the number of cached encoders
   */
  size(): number {
    return this.encoders.size;
  }
}