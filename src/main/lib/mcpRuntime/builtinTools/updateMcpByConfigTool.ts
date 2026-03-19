/**
 * Update MCP by Config Tool
 * Update installed MCP servers via MCP configuration
 *
 * Workflow:
 * 1. Receive MCP configuration object
 * 2. Verify the MCP is already installed (check by name)
 * 3. Auto-increment patch version on update
 * 4. Call mcpClientManager to update configuration
 *
 * Version Rules:
 * - On update, auto-increment patch version from existing version
 *
 * ENV Update Rules:
 * - Full replacement — if new ENV provided => use new ENV entirely; if not provided => clear ENV
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { McpServerConfig } from '../../userDataADO/types';

/**
 * Tool input arguments interface
 */
interface UpdateMcpByConfigArgs {
  /** MCP server configuration update */
  mcp_config: {
    /** MCP server name (required, used to find the installed MCP) */
    name: string;
    /** Transport type: 'stdio', 'sse', or 'StreamableHttp' */
    transport?: 'stdio' | 'sse' | 'StreamableHttp';
    /** Command (for stdio transport) */
    command?: string;
    /** Command line arguments */
    args?: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Server URL (for sse/http transport) */
    url?: string;
    /** MCP server version */
    version?: string;
  };
}

/**
 * Tool execution result interface
 */
interface UpdateMcpResult {
  success: boolean;
  message: string;
  server_name?: string;
  old_version?: string;
  new_version?: string;
  error?: string;
}

/**
 * Auto-increment the patch version number
 * e.g.: "1.0.0" -> "1.0.1", "2.3.5" -> "2.3.6"
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    // If version format is invalid, just append ".1"
    return version + '.1';
  }
  
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Update MCP by Config Tool Implementation
 */
export class UpdateMcpByConfigTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'update_mcp_by_config',
      description: 'Update an existing MCP server configuration. The MCP server must be already installed (checked by name). Version is auto-incremented on update.',
      inputSchema: {
        type: 'object',
        properties: {
          mcp_config: {
            type: 'object',
            description: 'MCP server configuration update',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the MCP server to update (must match an existing server)'
              },
              transport: {
                type: 'string',
                enum: ['stdio', 'sse', 'StreamableHttp'],
                description: 'Transport type for the MCP server (optional, keeps existing if not provided)'
              },
              command: {
                type: 'string',
                description: 'Command to execute (for stdio transport)'
              },
              args: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Command line arguments (for stdio transport)'
              },
              env: {
                type: 'object',
                additionalProperties: {
                  type: 'string'
                },
                description: 'Environment variables to pass to the server'
              },
              url: {
                type: 'string',
                description: 'Server URL (for sse/StreamableHttp transport)'
              },
              version: {
                type: 'string',
                description: 'MCP server version (optional, auto-incremented if not provided)'
              }
            },
            required: ['name']
          }
        },
        required: ['mcp_config']
      }
    };
  }

  /**
   * Execute the tool
   * 
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: UpdateMcpByConfigArgs): Promise<UpdateMcpResult> {
    try {
      // Validate input parameters
      if (!args.mcp_config || typeof args.mcp_config !== 'object') {
        return {
          success: false,
          message: 'Invalid input: mcp_config is required and must be an object',
          error: 'INVALID_INPUT'
        };
      }

      const config = args.mcp_config;

      // Validate required fields
      if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
        return {
          success: false,
          message: 'Invalid input: mcp_config.name is required and must be a non-empty string',
          error: 'INVALID_INPUT'
        };
      }

      const serverName = config.name.trim();

      // Get profileCacheManager to check if already installed
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      const { mcpClientManager } = await import('../mcpClientManager');
      
      // Get current user
      const cachedAliases = profileCacheManager.getCachedAliases();
      if (cachedAliases.length === 0) {
        return {
          success: false,
          message: 'No user profile loaded. Please sign in first.',
          error: 'NO_USER'
        };
      }
      const currentUserAlias = cachedAliases[0];

      // Check if MCP is already installed
      const existingServerInfo = profileCacheManager.getMcpServerInfo(currentUserAlias, serverName);
      if (!existingServerInfo.config) {
        return {
          success: false,
          message: `MCP server "${serverName}" is not installed. Use add_mcp_by_config to install it first.`,
          error: 'NOT_INSTALLED'
        };
      }

      const existingConfig = existingServerInfo.config;
      const oldVersion = existingConfig.version || '1.0.0';

      // Auto-increment patch version on update
      const finalVersion = incrementPatchVersion(oldVersion);

      // ENV update: full replacement
      let finalEnv: Record<string, string>;
      if (config.env && typeof config.env === 'object') {
        finalEnv = config.env;
      } else {
        finalEnv = {};
      }

      const updatedConfig: McpServerConfig = {
        name: serverName,
        transport: config.transport || existingConfig.transport,
        in_use: existingConfig.in_use,
        command: config.command?.trim() || existingConfig.command,
        args: Array.isArray(config.args) ? config.args : existingConfig.args,
        env: finalEnv,
        url: config.url?.trim() || existingConfig.url,
        version: finalVersion,
        source: 'ON-DEVICE'
      };

      // Validate transport-related fields
      if (updatedConfig.transport === 'stdio') {
        if (!updatedConfig.command || !updatedConfig.command.trim()) {
          return {
            success: false,
            message: 'stdio transport requires a command',
            error: 'INVALID_CONFIG'
          };
        }
      }

      if (updatedConfig.transport === 'sse' || updatedConfig.transport === 'StreamableHttp') {
        if (!updatedConfig.url || !updatedConfig.url.trim()) {
          return {
            success: false,
            message: `${updatedConfig.transport} transport requires a url`,
            error: 'INVALID_CONFIG'
          };
        }
      }

      // Call mcpClientManager to update the MCP server
      await mcpClientManager.update(serverName, updatedConfig);

      // Successfully updated
      return {
        success: true,
        message: `Successfully updated MCP server "${serverName}". Version: ${oldVersion} -> ${finalVersion}. The server is now reconnecting...`,
        server_name: serverName,
        old_version: oldVersion,
        new_version: finalVersion
      };

    } catch (error) {
      return {
        success: false,
        message: `Error updating MCP server: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * Validate MCP config for update (helper method)
   * 
   * @param config MCP configuration to validate
   * @param existingConfig Existing MCP configuration
   * @returns Validation result with error message if invalid
   */
  static validateConfigForUpdate(config: any, existingConfig: McpServerConfig): { valid: boolean; error?: string } {
    if (!config || typeof config !== 'object') {
      return { valid: false, error: 'Config must be an object' };
    }

    if (!config.name || typeof config.name !== 'string') {
      return { valid: false, error: 'Config must have a valid name' };
    }

    if (config.name !== existingConfig.name) {
      return { valid: false, error: 'Cannot change server name during update' };
    }

    // Validate transport if provided
    if (config.transport && !['stdio', 'sse', 'StreamableHttp'].includes(config.transport)) {
      return { valid: false, error: 'Transport must be stdio, sse, or StreamableHttp' };
    }

    return { valid: true };
  }
}
