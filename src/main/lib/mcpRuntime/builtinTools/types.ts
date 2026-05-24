/**
 * Shared type definitions for built-in tools
 * Centrally manages common interfaces used by all built-in tools
 */

/**
 * Built-in tool definition interface
 * Describes the basic information and parameter schema of a tool
 */
export interface BuiltinToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * Tool execution result interface
 * Unified return format for tool execution
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}