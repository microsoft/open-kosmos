/**
 * TokenCounter Module Unified Export
 * Provides a concise API interface
 */

// Main class
export { TokenCounter } from './TokenCounter';

// Calculators
export { TextTokenCalculator } from './calculators/TextTokenCalculator';
export { ImageTokenCalculator } from './calculators/ImageTokenCalculator';
export { ToolsTokenCalculator } from './calculators/ToolsTokenCalculator';

// Encoders
export { TikTokenEncoder } from './encoders/TikTokenEncoder';
export { EncoderCache } from './encoders/EncoderCache';

// Types
export type {
  TokenCounterConfig,
  TextTokenOptions,
  ImageTokenOptions,
  ImageTokenResult,
  ToolDefinition,
  ToolsTokenResult,
  CacheStats,
  Message,
  TextContentPart,
  ImageContentPart,
  ToolCall
} from './types';

/**
 * Factory function: create a TokenCounter instance
 */
import { TokenCounter } from './TokenCounter';
import { TokenCounterConfig } from './types';

export function createTokenCounter(config?: TokenCounterConfig): TokenCounter {
  return new TokenCounter(config);
}