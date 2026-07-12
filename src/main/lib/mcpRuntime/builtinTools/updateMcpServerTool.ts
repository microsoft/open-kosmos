/**
 * UpdateMcpServerTool
 * Updates an installed MCP server via MCP configuration
 *
 * Process flow:
 * 1. Receive an MCP configuration object
 * 2. Validate whether the MCP is installed (checked by name)
 * 3. Apply the local configuration update
 * 4. Call mcpClientManager to update the configuration
 *
 * Existing remote metadata is accepted for compatibility but never consulted.
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { McpServerConfig } from '../../userDataADO/types';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";
import { mcpClientManager } from "../mcpClientManager";

/**
 * Tool input arguments interface
 */
interface UpdateMcpServerArgs {
  /** MCP server configuration update */
  mcp_config: {
    /** MCP server name (required, used to look up the installed MCP) */
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
    /** Legacy metadata accepted but ignored. */
    version?: string;
    /** Legacy metadata accepted but ignored. */
    source?: 'IN-LIBRARY' | 'ON-DEVICE';
    /** Legacy metadata accepted but ignored. */
    remoteVersion?: string;
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
  old_source?: string;
  new_source?: string;
  error?: string;
}

/**
 * Auto-increment patch version
 * Example: "1.0.0" -> "1.0.1", "2.3.5" -> "2.3.6"
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    // If the version format is incorrect, just append ".1"
    return version + '.1';
  }

  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Update MCP by Config Tool Implementation
 * @deprecated Use manage_mcp instead.
 */
export class UpdateMcpServerTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'update_mcp_server',
      description: 'Update an existing locally configured MCP server.',
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
  static async execute(args: UpdateMcpServerArgs): Promise<UpdateMcpResult> {
    try {
      // Validate input arguments
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

      // Use profileCacheManager to check if already installed

      // Get the active signed-in user (not cache insertion order)
      const currentUserAlias = (profileCacheManager as any).currentUserAlias as string | null;
      if (!currentUserAlias) {
        return {
          success: false,
          message: 'No user profile loaded. Please sign in first.',
          error: 'NO_USER'
        };
      }

      // Check if MCP is installed
      const existingServerInfo = profileCacheManager.getMcpServerInfo(currentUserAlias, serverName);
      if (!existingServerInfo.config) {
        return {
          success: false,
          message: `MCP server "${serverName}" is not installed. Use create_mcp_server_from_config to install it first.`,
          error: 'NOT_INSTALLED'
        };
      }

      const existingConfig = existingServerInfo.config;
      const oldVersion = existingConfig.version || '1.0.0';
      const finalVersion = incrementPatchVersion(oldVersion);

      // Build the updated McpServerConfig
      const finalEnv = config.env && typeof config.env === 'object'
        ? config.env
        : existingConfig.env || {};

      const updatedConfig: McpServerConfig = {
        name: serverName,
        transport: config.transport || existingConfig.transport,
        in_use: existingConfig.in_use,
        command: config.command?.trim() || existingConfig.command,
        args: Array.isArray(config.args) ? config.args : existingConfig.args,
        env: finalEnv,
        url: config.url?.trim() || existingConfig.url,
        version: finalVersion,
        source: 'ON-DEVICE',
        remoteVersion: existingConfig.remoteVersion
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
        message: `Successfully updated MCP server "${serverName}". The server is now reconnecting...`,
        server_name: serverName,
        old_version: oldVersion,
        new_version: finalVersion,
        old_source: existingConfig.source,
        new_source: 'ON-DEVICE'
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
