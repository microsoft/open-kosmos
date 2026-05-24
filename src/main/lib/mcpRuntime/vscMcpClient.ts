import { VscodeMcpClient, VscodeMcpServerConfig } from "./vscodeMcpClient";
import { McpServerConfig } from "../userDataADO/types";
import { createConsoleLogger } from "../unifiedLogger";

// Initialize logger for MCP client synchronously
const advancedLogger = createConsoleLogger();

interface Tool {
  name: string;
  description?: string;
  inputSchema: any;
  annotations?: any;
  alwaysLoad?: boolean;
  searchHint?: string;
}

/** Map raw MCP tool (with _meta) to internal Tool shape */
function mapMcpTool(tool: any): Tool {
  return {
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    alwaysLoad: tool._meta?.['anthropic/alwaysLoad'] === true,
    searchHint: typeof tool._meta?.['anthropic/searchHint'] === 'string'
      ? tool._meta['anthropic/searchHint'].replace(/\s+/g, ' ').trim() || undefined
      : undefined,
  };
}

/**
 * VSCode MCP Client Adapter
 * Provides the same interface as the original MCPClient, but uses the new zero-dependency vscodeMcpClient implementation
 */
export class VscMcpClient {
  private server: McpServerConfig;
  private mcp: VscodeMcpClient;
  private tools: Tool[] = [];
  private lastError: Error | null = null;
  private isConnected: boolean = false;
  private serverId: string | null = null;

  constructor(mcpServer: McpServerConfig) {
    this.server = mcpServer;

    // Commands and environment variables are managed uniformly by TerminalInstance.
    // Pass only the raw config here; do not perform any command transformation or environment variable injection.
    // - internal mode: TerminalInstance adds the bin directory to PATH; the shim script handles command mapping.
    // - system mode: TerminalInstance uses the system PATH; commands are executed directly.

    // Convert McpServerConfig to VscodeMcpServerConfig
    // Aligned with VS Code: no initialization timeout or retry mechanism
    const vscodeMcpConfig: VscodeMcpServerConfig = {
      name: mcpServer.name,
      type: mcpServer.transport === 'stdio' ? 'stdio' :
            mcpServer.transport === 'sse' ? 'sse' : 'http',
      command: mcpServer.command,
      args: mcpServer.args || [],
      url: mcpServer.url,
      headers: mcpServer.headers,
      env: mcpServer.env as Record<string, string> | undefined,
      timeout: 3600000,
      // Forward original cfg so the HTTP transport can construct a
      // OpenKosmosOAuthProvider that knows the server's oauth.* options.
      mcpServerConfig: mcpServer,
    };

    this.mcp = new VscodeMcpClient(vscodeMcpConfig);
    this.lastError = null;


    // Log complete MCP server configuration details

    if (mcpServer.command) {
    }

    if (mcpServer.args && mcpServer.args.length > 0) {
    } else {
    }

    if (mcpServer.url) {
    }

    if (mcpServer.env && Object.keys(mcpServer.env).length > 0) {
      Object.entries(mcpServer.env).forEach(([key, value]) => {
      });
    } else {
    }

  }

  async connectToServer(): Promise<string | Error> {
    try {

      // Set up event listeners
      this.mcp.on('stateChange', (state) => {

        if (state.state === 'error') {
          const errorMsg = state.message || 'Unknown connection error';
          this.lastError = new Error(errorMsg);
          this.isConnected = false;
        } else if (state.state === 'running') {
          this.isConnected = true;
        }
      });

      // Connect to server
      await this.mcp.connect();
      this.isConnected = true;
      this.serverId = this.server.name; // Use server name as ID

      // Get available tools
      const toolsResult = this.mcp.getTools();
      this.tools = toolsResult.map(mapMcpTool);


      this.lastError = null;
      return "connected";
    } catch (e) {
      this.lastError = e instanceof Error ? e : new Error(String(e));
      this.isConnected = false;
      return this.lastError;
    }
  }

  // Get the last connection error
  getLastError(): Error | null {
    return this.lastError;
  }

  async getTools(): Promise<Tool[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      // Get tools from server
      const toolsResult = this.mcp.getTools();
      this.tools = toolsResult.map(mapMcpTool);

      return this.tools;
    } catch (error) {
      return this.tools; // Return cached tools
    }
  }

  /**
   * Execute a tool with the given name and arguments
   *
   * @param toolName - The name of the tool to execute
   * @param toolArgs - The arguments to pass to the tool
   * @returns The tool's response content as a string
   */
  async executeTool({ toolName, toolArgs, signal }: { toolName: string, toolArgs: { [key: string]: unknown }, signal?: AbortSignal }): Promise<string> {
    try {
      if (!this.isConnected) {
        throw new Error('Client is not connected to server');
      }

      const result = await this.mcp.callTool(toolName, toolArgs, { signal });

      // Return the content from the tool result - handle different response formats
      if (typeof result === 'string') {
        return result;
      } else if (result && typeof result === 'object') {
        // Try to extract content from different possible formats
        if ('content' in result) {
          if (Array.isArray(result.content)) {
            return result.content.map((item: any) =>
              typeof item === 'string' ? item :
              item.text || JSON.stringify(item)
            ).join('\n');
          }
          return String(result.content);
        } else if ('result' in result) {
          return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        } else {
          return JSON.stringify(result);
        }
      } else {
        return String(result);
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async cleanup(): Promise<void> {
    const cleanupStart = Date.now();
    const cleanupId = `cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;


    try {
      // Disconnect from server if connected
      if (this.isConnected) {
        try {
          await this.mcp.disconnect();
        } catch (error) {
        }
      }

    } finally {
      // Clear references

      this.tools = [];
      this.lastError = null;
      this.isConnected = false;
      this.serverId = null;

      const cleanupDuration = Date.now() - cleanupStart;
    }
  }

}