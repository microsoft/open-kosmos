/**
 * Shared type definitions for built-in tools
 * Centrally manages common interfaces used by all built-in tools
 */

/**
 * Built-in tool definition interface
 * Used to describe basic tool information and parameter schemas
 */
export interface BuiltinToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * Tool execution result interface
 * Unified tool execution return format
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}