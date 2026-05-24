/**
 * TokenCounter main class
 * Unified token calculation interface
 */

import { TextTokenCalculator } from './calculators/TextTokenCalculator';
import { ImageTokenCalculator } from './calculators/ImageTokenCalculator';
import { ToolsTokenCalculator } from './calculators/ToolsTokenCalculator';
import { Message, TextContentPart, ImageContentPart } from './types';
import {
  TokenCounterConfig,
  ImageTokenResult,
  ImageTokenOptions,
  ToolDefinition,
  ToolsTokenResult,
  CacheStats
} from './types';

// VS Code Copilot alignment constants
const BASE_TOKENS_PER_MESSAGE = 3;     // Base overhead per message
const BASE_TOKENS_PER_NAME = 1;        // Extra overhead for the name field
const BASE_TOKENS_PER_COMPLETION = 3;  // Completion overhead (once per conversation)
const TOOL_CALLS_SAFETY_MARGIN = 1.5;  // tool_calls safety factor

export class TokenCounter {
  private textCalculator: TextTokenCalculator;
  private imageCalculator: ImageTokenCalculator;
  private toolsCalculator: ToolsTokenCalculator;

  constructor(config: TokenCounterConfig = {}) {
    // Support both defaultEncoding and encoding naming
    const encoding = config.defaultEncoding || config.encoding;

    this.textCalculator = new TextTokenCalculator({
      encoding: encoding,
      enableCache: config.enableCache,
      cacheSize: config.cacheSize
    });

    this.imageCalculator = new ImageTokenCalculator();
    this.toolsCalculator = new ToolsTokenCalculator(this.textCalculator);
  }

  /**
   * Count text tokens
   */
  countTextTokens(text: string): number {
    return this.textCalculator.countTokens(text);
  }

  /**
   * Count image tokens
   */
  countImageTokens(options: ImageTokenOptions): ImageTokenResult {
    return this.imageCalculator.calculateTokens(options);
  }

  /**
   * Count tokens for a Message
   */
  countMessageTokens(message: Message): number {
    let totalTokens = 0;

    // Message base overhead (aligned with VS Code Copilot BaseTokensPerMessage)
    totalTokens += BASE_TOKENS_PER_MESSAGE;

    // Iterate over content parts
    for (const part of message.content) {
      if (part.type === 'text') {
        totalTokens += this.textCalculator.countTokens(part.text);
      } else if (part.type === 'image') {
        const result = this.imageCalculator.calculateFromImagePart(part);
        totalTokens += result.tokens;
      }
    }

    // tool_calls — apply ×1.5 safety factor (aligned with VS Code Copilot)
    if (message.role === 'assistant' && message.tool_calls) {
      let toolCallTokens = 0;
      for (const toolCall of message.tool_calls) {
        const toolCallJson = JSON.stringify(toolCall);
        toolCallTokens += this.textCalculator.countTokens(toolCallJson);
      }
      totalTokens += Math.ceil(toolCallTokens * TOOL_CALLS_SAFETY_MARGIN);
    }

    // name field (aligned with VS Code Copilot BaseTokensPerName)
    if ('name' in message && (message as any).name) {
      totalTokens += this.textCalculator.countTokens((message as any).name);
      totalTokens += BASE_TOKENS_PER_NAME;
    }

    return totalTokens;
  }

  /**
   * Count tokens for multiple messages
   */
  countMessagesTokens(messages: Message[]): number {
    // Aligned with VS Code Copilot: initialize to BaseTokensPerCompletion
    let totalTokens = BASE_TOKENS_PER_COMPLETION;

    for (const message of messages) {
      totalTokens += this.countMessageTokens(message);
    }

    return totalTokens;
  }

  /**
   * Count tokens for tools
   */
  countToolsTokens(tools: ToolDefinition[]): ToolsTokenResult {
    return this.toolsCalculator.calculateAllToolsTokens(tools);
  }

  /**
   * Count tokens for System Prompt + Tools
   */
  countSystemPromptWithTools(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    return this.toolsCalculator.calculateSystemPromptWithTools(systemPrompt, tools);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.textCalculator.clearCache();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.textCalculator.getCacheStats();
  }

  /**
   * Get current encoder type
   */
  getEncoding(): 'cl100k_base' | 'o200k_base' {
    return this.textCalculator.getEncoding();
  }
}