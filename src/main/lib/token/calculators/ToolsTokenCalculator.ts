/**
 * Tools token calculator
 * Aligned with VS Code Copilot tool token calculation logic
 */

import { TextTokenCalculator } from './TextTokenCalculator';
import { ToolDefinition, ToolsTokenResult } from '../types';

// VS Code Copilot alignment constants
const BASE_TOOL_TOKENS = 16;       // One-time overhead when tools is non-empty
const BASE_TOKENS_PER_TOOL = 8;    // Base overhead per tool
const TOOL_SAFETY_MARGIN = 1.1;    // 10% safety factor

export class ToolsTokenCalculator {
  private textCalculator: TextTokenCalculator;

  constructor(textCalculator: TextTokenCalculator) {
    this.textCalculator = textCalculator;
  }

  /**
   * Recursively count tokens for an object (both keys and values)
   * Aligned with VS Code Copilot's countMessageObjectTokens
   */
  private countObjectTokens(obj: any): number {
    if (obj === null || obj === undefined) return 0;

    let numTokens = 0;

    if (typeof obj === 'string') {
      return this.textCalculator.countTokens(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return this.textCalculator.countTokens(String(obj));
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        numTokens += this.countObjectTokens(item);
      }
      return numTokens;
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) continue;
        numTokens += this.textCalculator.countTokens(key); // keys are also counted
        numTokens += this.countObjectTokens(value);
      }
    }

    return numTokens;
  }

  /**
   * Count tokens for a single tool (excluding base overhead)
   */
  calculateToolTokens(tool: ToolDefinition): number {
    return this.countObjectTokens({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    });
  }

  /**
   * Count tokens for all tools
   * Aligned with VS Code Copilot: +16 one-time overhead, +8 per tool, ×1.1 safety factor
   */
  calculateAllToolsTokens(
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    const toolTokens: Array<{ name: string; tokens: number }> = [];
    let numTokens = 0;

    if (tools.length > 0) {
      numTokens += BASE_TOOL_TOKENS;
    }

    for (const tool of tools) {
      numTokens += BASE_TOKENS_PER_TOOL;
      const tokens = this.calculateToolTokens(tool);
      numTokens += tokens;
      toolTokens.push({
        name: tool.name,
        tokens: tokens + BASE_TOKENS_PER_TOOL
      });
    }

    const totalTokens = Math.ceil(numTokens * TOOL_SAFETY_MARGIN);

    return {
      totalTokens,
      toolTokens,
      basePromptTokens: 0
    };
  }

  /**
   * Count total tokens for System Prompt + Tools
   */
  calculateSystemPromptWithTools(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    const basePromptTokens = this.textCalculator.countTokens(systemPrompt);
    const toolsResult = this.calculateAllToolsTokens(tools);

    return {
      totalTokens: basePromptTokens + toolsResult.totalTokens,
      toolTokens: toolsResult.toolTokens,
      basePromptTokens
    };
  }
}
