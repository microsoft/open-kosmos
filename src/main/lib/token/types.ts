/**
 * TokenCounter Type Definitions
 * Defines all types and interfaces used by the token counting system
 */

import { Message, TextContentPart, ImageContentPart, ToolCall } from '../types/chatTypes';

// Re-export types from chatTypes for convenience
export type { Message, TextContentPart, ImageContentPart, ToolCall };

/**
 * Token counting configuration
 */
export interface TokenCounterConfig {
  /** TikToken encoder type (defaultEncoding is the common name) */
  defaultEncoding?: 'cl100k_base' | 'o200k_base';
  /** TikToken encoder type (encoding is an alias, for backward compatibility) */
  encoding?: 'cl100k_base' | 'o200k_base';
  /** Whether to enable caching */
  enableCache?: boolean;
  /** Cache size limit */
  cacheSize?: number;
}

/**
 * Text token calculation options
 */
export interface TextTokenOptions {
  /** Encoder type */
  encoding?: 'cl100k_base' | 'o200k_base';
  /** Allowed special tokens */
  allowedSpecial?: Array<string> | 'all';
  /** Disallowed special tokens */
  disallowedSpecial?: Array<string> | 'all';
}

/**
 * Image token calculation options
 */
export interface ImageTokenOptions {
  /** Image quality */
  detail?: 'low' | 'high' | 'auto';
  /** Image width (pixels) */
  width?: number;
  /** Image height (pixels) */
  height?: number;
}

/**
 * Image token calculation result
 */
export interface ImageTokenResult {
  /** Total token count */
  tokens: number;
  /** Quality level used */
  detailUsed: 'low' | 'high';
  /** Number of tiles (for high detail) */
  tiles?: number;
  /** Calculation process information */
  calculationInfo: {
    originalSize: { width: number; height: number };
    scaledSize?: { width: number; height: number };
    tiledSize?: { width: number; height: number };
  };
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tools token calculation result
 */
export interface ToolsTokenResult {
  /** Total token count */
  totalTokens: number;
  /** Token count per tool */
  toolTokens: Array<{
    name: string;
    tokens: number;
  }>;
  /** System prompt base tokens */
  basePromptTokens: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Current cache entry count */
  size: number;
  /** Maximum cache capacity */
  maxSize: number;
  /** Cache hit count */
  hits: number;
  /** Cache miss count */
  misses: number;
  /** Cache hit rate (optional) */
  hitRate?: number;
}