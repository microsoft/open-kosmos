/**
 * Get MCP Template from Library Tool
 * Retrieves an MCP server template configuration from the MCP Library by name
 *
 * Process flow:
 * 1. Call McpLibraryFetcher to fetch the MCP library list
 * 2. Find the MCP configuration matching the given name
 * 3. 🆕 Check if there is a locally installed version with the same name, and merge ENV
 *    - ENV variables with the same name use the local value
 *    - ENV variables with different names are added directly to the new version
 * 4. Return the corresponding configuration JSON (with ENV merged)
 */

import { BuiltinToolDefinition } from './types';
import { McpLibraryFetcher } from '../../assetsFetcher/mcpLibraryFetcher';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { createLogger } from '../../unifiedLogger';
const logger = createLogger();

/**
 * Tool input arguments interface
 */
interface GetMcpTemplateFromLibraryArgs {
  /** MCP server name (the name field in the library) */
  mcp_name: string;
}

/**
 * Full MCP Server configuration (from mcp_lib.json)
 */
interface McpServerLibraryConfig {
  name: string;
  description: string;
  contact?: string;
  version?: string;
  source?: 'IN-LIBRARY' | 'ON-DEVICE';
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  requirements?: Record<string, string>;
}

/**
 * Tool execution result interface
 */
interface GetMcpTemplateFromLibraryResult {
  success: boolean;
  message: string;
  config?: McpServerLibraryConfig;
  error?: string;
}

/**
 * Get MCP Template from Library Tool Implementation
 * @deprecated Use search_mcp instead.
 */
export class GetMcpTemplateFromLibraryTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'get_mcp_template_from_library',
      description: 'Get an MCP server template from the MCP Library by name. This tool fetches the latest MCP library, finds the server configuration by name, automatically merges ENV with the local installed version when applicable, and returns the template JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          mcp_name: {
            type: 'string',
            description: 'The name of the MCP server to get config from the library (e.g., "filesystem", "github", "brave-search")'
          }
        },
        required: ['mcp_name']
      }
    };
  }

  /**
   * Execute the tool
   *
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: GetMcpTemplateFromLibraryArgs): Promise<GetMcpTemplateFromLibraryResult> {
    try {
      // Validate input parameters
      if (!args.mcp_name || typeof args.mcp_name !== 'string' || !args.mcp_name.trim()) {
        return {
          success: false,
          message: 'Invalid input: mcp_name is required and must be a non-empty string',
          error: 'INVALID_INPUT'
        };
      }

      const mcpName = args.mcp_name.trim();

      // Step 1: Fetch MCP Library data
      const fetcher = McpLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return {
          success: false,
          message: `Failed to fetch MCP library: ${libraryResult.error || 'Unknown error'}`,
          error: 'LIBRARY_FETCH_FAILED'
        };
      }

      // Step 2: Find the MCP server with the specified name in the library
      const mcpServers = libraryResult.data.mcp_servers;
      const foundServer = mcpServers.find(server => server.name === mcpName);

      if (!foundServer) {
        // Provide a list of available servers as suggestions
        const availableServers = mcpServers.map(s => s.name).slice(0, 10); // Show only the first 10
        return {
          success: false,
          message: `MCP server "${mcpName}" not found in library. Available servers include: ${availableServers.join(', ')}${mcpServers.length > 10 ? ', ...' : ''}`,
          error: 'SERVER_NOT_FOUND'
        };
      }

      // Step 3: Build the full configuration from mcp_lib
      let mcpConfig: McpServerLibraryConfig = {
        name: foundServer.name,
        description: foundServer.description || '',
        contact: foundServer.contact,
        version: foundServer.version,
        source: (foundServer as any).source,
        transport: foundServer.transport as 'stdio' | 'sse' | 'StreamableHttp',
        command: foundServer.command,
        args: foundServer.args,
        env: foundServer.env,
        url: foundServer.url,
        requirements: (foundServer as any).requirements
      };

      // Step 4: 🆕 Check if there is a locally installed version with the same name, and merge ENV
      // Note: This step is performed before handling OpenKosmos and USER-INPUT placeholders
      // Automatically get the current user's alias (from the profileCacheManager cache)
      const cachedAliases = profileCacheManager.getCachedAliases();
      if (cachedAliases.length > 0) {
        // Use the first cached alias (normally only the currently logged-in user)
        const currentAlias = cachedAliases[0];
        const mergeResult = this.mergeWithLocalEnv(currentAlias, mcpName, mcpConfig.env);
        if (mergeResult.merged) {
          mcpConfig.env = mergeResult.env;
        }
      }

      // Successfully return the full configuration (ENV merged from local version if applicable)
      return {
        success: true,
        message: `Successfully retrieved MCP server config for "${mcpName}" from library.`,
        config: mcpConfig
      };

    } catch (error) {
      return {
        success: false,
        message: `Error getting MCP server template: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * 🆕 Merge ENV from the locally installed version into the new version configuration
   *
   * Merge rules:
   * - ENV variables with the same name use the local value (preserve user configuration)
   * - ENV variables present in the new version but not locally retain the new version value (may contain placeholders for later processing)
   * - ENV variables present locally but not in the new version are added to the new version (preserve extra user configuration)
   *
   * @param alias User alias
   * @param mcpName MCP server name
   * @param newEnv New version ENV configuration
   * @returns Merge result
   */
  private static mergeWithLocalEnv(
    alias: string,
    mcpName: string,
    newEnv?: Record<string, string>
  ): { merged: boolean; env?: Record<string, string> } {
    try {
      // Fetch the locally cached profile
      const profile = profileCacheManager.getCachedProfile(alias);
      if (!profile) {
        return { merged: false };
      }

      // Find a server with the same name in the local MCP server list
      const localServer = profile.mcp_servers.find(server => server.name === mcpName);
      if (!localServer) {
        // The MCP is not installed locally — no merge needed
        return { merged: false };
      }

      const localEnv = localServer.env;

      // If the local version has no ENV configuration
      if (!localEnv || Object.keys(localEnv).length === 0) {
        // No local ENV — no merge needed
        return { merged: false };
      }

      // If the new version has no ENV configuration
      if (!newEnv || Object.keys(newEnv).length === 0) {
        // New version has no ENV — use local ENV directly
        return { merged: true, env: { ...localEnv } };
      }

      // 🔥 Perform merge:
      // 1. Copy all ENV from the new version (may include newly added placeholder variables)
      // 2. For same-name variables, overwrite with the local value (preserve user-configured values)
      // 3. For variables present locally but not in the new version, add them (preserve extra user config)
      const mergedEnv: Record<string, string> = { ...newEnv };

      for (const [key, value] of Object.entries(localEnv)) {
        if (key in newEnv) {
          // Same-name ENV variable: use the local value
          mergedEnv[key] = value;
        } else {
          // Present locally but not in new version: add to new version
          mergedEnv[key] = value;
        }
      }

      return { merged: true, env: mergedEnv };
    } catch (error) {
      logger.error(`[GetMcpTemplateFromLibraryTool] Error merging with local ENV: ${error instanceof Error ? error.message : String(error)}`)
      return { merged: false };
    }
  }

  /**
   * Get available MCP servers from library (helper method)
   *
   * @returns List of available MCP server names
   */
  static async getAvailableMcpServers(): Promise<string[]> {
    try {
      const fetcher = McpLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return [];
      }

      return libraryResult.data.mcp_servers.map(server => server.name);
    } catch (error) {
      return [];
    }
  }
}