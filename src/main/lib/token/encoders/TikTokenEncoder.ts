/**
 * TikToken Encoder Wrapper Class
 * Provides token encoding and counting functionality
 */

import { getEncoding, Tiktoken } from 'js-tiktoken';

export class TikTokenEncoder {
  private encoder: Tiktoken | null = null;
  private encoding: 'cl100k_base' | 'o200k_base';
  
  constructor(encoding: 'cl100k_base' | 'o200k_base' = 'cl100k_base') {
    this.encoding = encoding;
  }
  
  /**
   * Initialize encoder (lazy loading)
   */
  private initialize(): void {
    if (this.encoder) return;
    
    this.encoder = getEncoding(this.encoding);
  }
  
  /**
   * Encode text into a token array
   */
  encode(
    text: string,
    allowedSpecial?: Array<string> | 'all'
  ): number[] {
    this.initialize();
    
    if (!this.encoder) {
      throw new Error('Failed to initialize TikToken encoder');
    }
    
    return this.encoder.encode(text, allowedSpecial);
  }
  
  /**
   * Count the number of tokens in text
   */
  countTokens(
    text: string,
    allowedSpecial?: Array<string> | 'all'
  ): number {
    const tokens = this.encode(text, allowedSpecial);
    return tokens.length;
  }
  
  /**
   * Decode a token array into text
   */
  decode(tokens: number[]): string {
    this.initialize();
    
    if (!this.encoder) {
      throw new Error('Failed to initialize TikToken encoder');
    }
    
    return this.encoder.decode(tokens);
  }
  
  /**
   * Get current encoder type
   */
  getEncoding(): 'cl100k_base' | 'o200k_base' {
    return this.encoding;
  }
}