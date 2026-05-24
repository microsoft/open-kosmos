/**
 * BuiltinMcpClient - Built-in virtual MCP client
 * Implements the IUnifiedMcpClient interface, wrapping built-in tools as an MCP server
 *
 * Features:
 * - No external process required; built-in tools are called directly
 * - connectToServer returns "connected" immediately
 * - Tool list comes from BuiltinToolsManager
 * - Tool execution is delegated to BuiltinToolsManager
 *
 * 🚀 Performance optimization: BuiltinToolsManager is loaded lazily
 */

import { createConsoleLogger } from '../unifiedLogger';

// 🚀 Lazy load: BuiltinToolsManager type is used for type declarations only
import { BuiltinToolsManager } from './builtinTools/builtinToolsManager';

// Fixed name for the built-in server
export const BUILTIN_SERVER_NAME = 'builtin-tools';

// Initialize logger
let advancedLogger: any;
(async () => {
  advancedLogger = await createConsoleLogger();
})();

/**
 * Built-in MCP client class
 * Implements the same interface as an external MCP server, but uses built-in tools
 *
 * 🚀 Performance optimization: BuiltinToolsManager is loaded only when connectToServer is called
 */
export class BuiltinMcpClient {
  private builtinToolsManager: BuiltinToolsManager | null = null;
  private isConnected: boolean = false;
  private serverName: string = BUILTIN_SERVER_NAME;

  constructor() {
    // 🚀 Deferred initialization: BuiltinToolsManager is not loaded in the constructor
  }

  /**
   * Get the BuiltinToolsManager instance (lazy-loaded)
   */
  private async getToolsManager(): Promise<BuiltinToolsManager> {
    if (!this.builtinToolsManager) {
      this.builtinToolsManager = BuiltinToolsManager.getInstance();
    }
    return this.builtinToolsManager;
  }

  /**
   * Connect to the built-in server
   * Returns "connected" directly without an actual connection process
   */
  async connectToServer(): Promise<string | Error> {
    try {
      console.time('[BuiltinMcpClient] connectToServer');

      // 🚀 Lazy-load BuiltinToolsManager
      const toolsManager = await this.getToolsManager();

      // Initialize the built-in tools manager (if not already initialized)
      if (!toolsManager.getStats().isInitialized) {
        await toolsManager.initialize();
      }

      this.isConnected = true;
      console.timeEnd('[BuiltinMcpClient] connectToServer');

      return 'connected';
    } catch (error) {
      console.timeEnd('[BuiltinMcpClient] connectToServer');
      const err = error instanceof Error ? error : new Error('Failed to connect to builtin server');
      return err;
    }
  }

  /**
   * Get all available built-in tools
   * Returns a tool list compatible with MCP tool format
   */
  async getTools(): Promise<{ name: string; description?: string; inputSchema: any }[]> {
    try {

      if (!this.isConnected) {
        return [];
      }

      // Get tool definitions from BuiltinToolsManager
      const toolsManager = await this.getToolsManager();
      const builtinTools = toolsManager.getAllTools();

      // Convert to MCP tool format
      const tools = builtinTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));


      return tools;
    } catch (error) {
      return [];
    }
  }

  /**
   * Execute a built-in tool
   * Delegates execution to BuiltinToolsManager
   */
  async executeTool({ toolName, toolArgs, signal }: { toolName: string; toolArgs: { [key: string]: unknown }; signal?: AbortSignal }): Promise<string> {
    try {

      if (!this.isConnected) {
        throw new Error('Not connected to builtin server');
      }

      if (signal?.aborted) {
        throw new Error(`Builtin tool execution aborted: ${toolName}`);
      }

      // Capture chatSessionId BEFORE any await — after an async boundary,
      // currentExecutionContext may have been overwritten by a concurrent session.
      const chatSessionId = BuiltinToolsManager.getExecutionContext()?.chatSessionId;

      const toolsManager = await this.getToolsManager();

      // Check whether the tool exists
      if (!toolsManager.hasTool(toolName)) {
        throw new Error(`Builtin tool not found: ${toolName}`);
      }

      // Execute the tool
      const result = await toolsManager.executeTool(toolName, toolArgs, signal, chatSessionId);

      if (result.success) {
        return result.data || '';
      } else {
        const error = result.error || 'Unknown error';
        throw new Error(`Tool execution failed: ${error}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Tool execution failed');
      throw err;
    }
  }

  /**
   * Clean up resources
   * No external process cleanup is needed for the built-in server; just reset state
   */
  async cleanup(): Promise<void> {
    try {

      this.isConnected = false;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get server name
   */
  getServerName(): string {
    return this.serverName;
  }
}