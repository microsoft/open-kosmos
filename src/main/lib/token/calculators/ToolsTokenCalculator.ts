/**
 * Tools Token Calculator
 * Calculates tokens for System Prompt and Tools descriptions
 */

import { TextTokenCalculator } from './TextTokenCalculator';
import { ToolDefinition, ToolsTokenResult } from '../types';

export class ToolsTokenCalculator {
  private textCalculator: TextTokenCalculator;
  
  constructor(textCalculator: TextTokenCalculator) {
    this.textCalculator = textCalculator;
  }
  
  /**
   * Calculate tokens for a single tool
   */
  calculateToolTokens(tool: ToolDefinition): number {
    // Convert tool definition to JSON string
    const toolJson = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    });
    
    return this.textCalculator.countTokens(toolJson);
  }
  
  /**
   * Calculate tokens for all tools
   */
  calculateAllToolsTokens(
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    const toolTokens: Array<{ name: string; tokens: number }> = [];
    
    for (const tool of tools) {
      const tokens = this.calculateToolTokens(tool);
      toolTokens.push({
        name: tool.name,
        tokens
      });
    }
    
    const totalTokens = toolTokens.reduce((sum, t) => sum + t.tokens, 0);
    
    return {
      totalTokens,
      toolTokens,
      basePromptTokens: 0 // If there is a base prompt, calculate here
    };
  }
  
  /**
   * Calculate total tokens for System Prompt + Tools
   */
  calculateSystemPromptWithTools(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    // Calculate system prompt tokens
    const basePromptTokens = this.textCalculator.countTokens(systemPrompt);
    
    // Calculate tools tokens
    const toolsResult = this.calculateAllToolsTokens(tools);
    
    return {
      totalTokens: basePromptTokens + toolsResult.totalTokens,
      toolTokens: toolsResult.toolTokens,
      basePromptTokens
    };
  }
}