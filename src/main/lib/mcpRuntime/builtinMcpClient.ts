/**
 * BuiltinMcpClient - Built-in virtual MCP client
 * Implements the IUnifiedMcpClient interface, wrapping built-in tools as an MCP server
 *
 * Features:
 * - No external process needed, directly calls built-in tools
 * - connectToServer directly returns "connected"
 * - Tool list comes from BuiltinToolsManager
 * - Tool execution is delegated to BuiltinToolsManager
 *
 * 🚀 Performance optimization: BuiltinToolsManager lazy loading
 */

import { createConsoleLogger } from '../unifiedLogger';

// 🚀 Lazy loading: BuiltinToolsManager type is only used for type declarations
import type { BuiltinToolsManager } from './builtinTools/builtinToolsManager';

// Fixed name for the built-in server
export const BUILTIN_SERVER_NAME = 'builtin-tools';

// Initialize logger
let advancedLogger: any;
(async () => {
  advancedLogger = await createConsoleLogger();
})();

/**
 * Built-in MCP client class
 * Implements the same interface as external MCP servers, but uses built-in tools
 *
 * 🚀 Performance optimization: BuiltinToolsManager is loaded only when connectToServer is called
 */
export class BuiltinMcpClient {
  private builtinToolsManager: BuiltinToolsManager | null = null;
  private isConnected: boolean = false;
  private serverName: string = BUILTIN_SERVER_NAME;

  constructor() {
    // 🚀 Lazy initialization: do not load BuiltinToolsManager in the constructor
  }

  /**
   * Get BuiltinToolsManager instance (lazy loading)
   */
  private async getToolsManager(): Promise<BuiltinToolsManager> {
    if (!this.builtinToolsManager) {
      const { BuiltinToolsManager } = await import('./builtinTools/builtinToolsManager');
      this.builtinToolsManager = BuiltinToolsManager.getInstance();
    }
    return this.builtinToolsManager;
  }

  /**
   * Connect to the built-in server
   * Directly returns "connected", no actual connection process needed
   */
  async connectToServer(): Promise<string | Error> {
    try {
      console.time('[BuiltinMcpClient] connectToServer');
      
      // 🚀 Lazy load BuiltinToolsManager
      const toolsManager = await this.getToolsManager();
      
      // Initialize the built-in tools manager (if not yet initialized)
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
   * Returns a tool list compatible with the MCP tool format
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
   * Delegated to BuiltinToolsManager for execution
   */
  async executeTool({ toolName, toolArgs }: { toolName: string; toolArgs: { [key: string]: unknown } }): Promise<string> {
    try {
      
      if (!this.isConnected) {
        throw new Error('Not connected to builtin server');
      }

      const toolsManager = await this.getToolsManager();

      // Check if the tool exists
      if (!toolsManager.hasTool(toolName)) {
        throw new Error(`Builtin tool not found: ${toolName}`);
      }

      // Execute the tool
      const result = await toolsManager.executeTool(toolName, toolArgs);
      
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
   * The built-in server does not need to clean up external processes, only reset state
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