/**
 * TokenCounter Main Class
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

export class TokenCounter {
  private textCalculator: TextTokenCalculator;
  private imageCalculator: ImageTokenCalculator;
  private toolsCalculator: ToolsTokenCalculator;
  
  constructor(config: TokenCounterConfig = {}) {
    // Support both defaultEncoding and encoding naming conventions
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
    
    // Message base overhead (per OpenAI specification)
    const messageOverhead = 3; // <|im_start|>role<|message|>
    totalTokens += messageOverhead;
    
    // Iterate over content parts
    for (const part of message.content) {
      if (part.type === 'text') {
        const textPart = part as TextContentPart;
        totalTokens += this.textCalculator.countTokens(textPart.text);
      } else if (part.type === 'image') {
        const imagePart = part as ImageContentPart;
        const result = this.imageCalculator.calculateFromImagePart(imagePart);
        totalTokens += result.tokens;
      }
      // Other types can be extended as needed
    }
    
    // tool_calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const toolCallJson = JSON.stringify(toolCall);
        totalTokens += this.textCalculator.countTokens(toolCallJson);
      }
    }
    
    // name field
    if (message.name) {
      totalTokens += this.textCalculator.countTokens(message.name);
      totalTokens += 1; // Extra overhead for name field
    }
    
    return totalTokens;
  }
  
  /**
   * Count tokens for multiple messages
   */
  countMessagesTokens(messages: Message[]): number {
    let totalTokens = 0;
    
    for (const message of messages) {
      totalTokens += this.countMessageTokens(message);
    }
    
    return totalTokens;
  }
  
  /**
   * Count tokens for Tools
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
   * Clear cache
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