/**
 * UpdateMcpServerTool
 * Updates an installed MCP server via MCP configuration
 *
 * Process flow:
 * 1. Receive an MCP configuration object
 * 2. Validate whether the MCP is installed (checked by name)
 * 3. Process the update according to source and version rules
 * 4. Call mcpClientManager to update the configuration
 *
 * Source and Version update rules:
 * 2.1. If the original source is ON-DEVICE
 *      2.1.1. If the new source is ON-DEVICE => ignore new version, use original source, auto-increment patch version
 *      2.1.2. If the new source is IN-LIBRARY => new version must not be empty && new version must be greater than original, use new source and version
 *      2.1.3. If no new source is specified => ignore new version, use original source, auto-increment patch version
 *
 * 2.2. If the original source is IN-LIBRARY
 *      2.2.1. If the new source is ON-DEVICE => not allowed to override IN-LIBRARY config with ON-DEVICE config
 *      2.2.2. If the new source is IN-LIBRARY => new version must not be empty && new version must be greater than original, use new source and version
 *      2.2.3. If no new source is specified => both source and version must be specified
 *
 * ENV update rules:
 * - IN-LIBRARY update: merge strategy — preserve locally configured values, add new remote keys, keep local-only keys
 * - ON-DEVICE update: full replacement — if new ENV is provided => use new ENV entirely; if not provided => clear ENV
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { McpServerConfig } from '../../userDataADO/types';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";
import { mcpClientManager } from "../mcpClientManager";
import { mergeEnv } from "../../startupUpdate/startupUpdateService";

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
    /** MCP server version */
    version?: string;
    /** MCP server source */
    source?: 'IN-LIBRARY' | 'ON-DEVICE';
    /** 🆕 Remote CDN version number (only for IN-LIBRARY; should be empty string for ON-DEVICE) */
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
 * Compare two semantic version numbers
 * @param newVersion New version
 * @param oldVersion Original version
 * @returns 1 if newVersion > oldVersion, -1 if newVersion < oldVersion, 0 if equal
 */
function compareVersions(newVersion: string, oldVersion: string): number {
  const parseVersion = (version: string): number[] => {
    const parts = version.split('.');
    return [
      parseInt(parts[0], 10) || 0,
      parseInt(parts[1], 10) || 0,
      parseInt(parts[2], 10) || 0
    ];
  };

  const newParts = parseVersion(newVersion);
  const oldParts = parseVersion(oldVersion);

  for (let i = 0; i < 3; i++) {
    if (newParts[i] > oldParts[i]) return 1;
    if (newParts[i] < oldParts[i]) return -1;
  }

  return 0;
}

/**
 * Check whether the new version is greater than the original
 * @param newVersion New version
 * @param oldVersion Original version
 * @returns true if newVersion > oldVersion
 */
function isVersionGreater(newVersion: string, oldVersion: string): boolean {
  return compareVersions(newVersion, oldVersion) > 0;
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
      description: 'Update an existing MCP server configuration. The MCP server must be already installed (checked by name). Follows specific rules for source and version updates.',
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
                description: 'MCP server version (required when source is IN-LIBRARY)'
              },
              source: {
                type: 'string',
                enum: ['IN-LIBRARY', 'ON-DEVICE'],
                description: 'MCP server source'
              },
              remoteVersion: {
                type: 'string',
                description: 'Remote CDN version (only for IN-LIBRARY sources, should be empty string for ON-DEVICE)'
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
      const oldSource = existingConfig.source || 'ON-DEVICE';
      const oldVersion = existingConfig.version || '1.0.0';
      const newSource = config.source;
      const newVersion = config.version;

      // Apply source and version update rules
      let finalSource: 'IN-LIBRARY' | 'ON-DEVICE' = oldSource as 'IN-LIBRARY' | 'ON-DEVICE';
      let finalVersion: string = oldVersion;

      // 2.1. If the original source is ON-DEVICE
      if (oldSource === 'ON-DEVICE') {
        if (newSource === 'ON-DEVICE' || newSource === undefined) {
          // 2.1.1 or 2.1.3: ignore new version, use original source, auto-increment patch
          finalSource = 'ON-DEVICE';
          finalVersion = incrementPatchVersion(oldVersion);
        } else if (newSource === 'IN-LIBRARY') {
          // 2.1.2: new version must not be empty && must be greater than original; use new source and version
          if (!newVersion || typeof newVersion !== 'string' || !newVersion.trim()) {
            return {
              success: false,
              message: 'When changing source from ON-DEVICE to IN-LIBRARY, version must be provided',
              error: 'VERSION_REQUIRED'
            };
          }
          const trimmedNewVersion = newVersion.trim();
          if (!isVersionGreater(trimmedNewVersion, oldVersion)) {
            return {
              success: false,
              message: `New version (${trimmedNewVersion}) must be greater than old version (${oldVersion}) when updating to IN-LIBRARY`,
              error: 'VERSION_NOT_GREATER'
            };
          }
          finalSource = 'IN-LIBRARY';
          finalVersion = trimmedNewVersion;
        }
      }
      // 2.2. If the original source is IN-LIBRARY
      else if (oldSource === 'IN-LIBRARY') {
        if (newSource === 'ON-DEVICE') {
          // 2.2.1: not allowed to override IN-LIBRARY config with ON-DEVICE config
          return {
            success: false,
            message: 'Cannot override IN-LIBRARY configuration with ON-DEVICE configuration. IN-LIBRARY MCPs must be updated from the library.',
            error: 'SOURCE_OVERRIDE_NOT_ALLOWED'
          };
        } else if (newSource === 'IN-LIBRARY') {
          // 2.2.2: new version must not be empty && must be greater than original; use new source and version
          if (!newVersion || typeof newVersion !== 'string' || !newVersion.trim()) {
            return {
              success: false,
              message: 'When updating IN-LIBRARY MCP, version must be provided',
              error: 'VERSION_REQUIRED'
            };
          }
          const trimmedNewVersion = newVersion.trim();
          if (!isVersionGreater(trimmedNewVersion, oldVersion)) {
            return {
              success: false,
              message: `New version (${trimmedNewVersion}) must be greater than old version (${oldVersion}) when updating IN-LIBRARY MCP`,
              error: 'VERSION_NOT_GREATER'
            };
          }
          finalSource = 'IN-LIBRARY';
          finalVersion = trimmedNewVersion;
        } else {
          // 2.2.3: if no new source is specified => both source and version must be provided
          return {
            success: false,
            message: 'When updating IN-LIBRARY MCP without specifying source, both source and version must be provided',
            error: 'SOURCE_AND_VERSION_REQUIRED'
          };
        }
      }

      // Build the updated McpServerConfig
      // ENV rules:
      // - IN-LIBRARY update: merge strategy (preserve locally configured values, add new remote keys)
      // - ON-DEVICE update: full replacement
      // 🆕 remoteVersion rule: use provided remoteVersion for IN-LIBRARY updates, clear for ON-DEVICE
      let finalEnv: Record<string, string>;
      if (finalSource === 'IN-LIBRARY' && config.env && typeof config.env === 'object') {
        // IN-LIBRARY: merge ENV — preserve local values, add new remote keys
        finalEnv = mergeEnv(existingConfig.env || {}, config.env);
      } else if (config.env && typeof config.env === 'object') {
        // ON-DEVICE: complete replacement
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
        source: finalSource,
        // 🆕 remoteVersion: use provided value or keep original for IN-LIBRARY; clear for ON-DEVICE
        remoteVersion: finalSource === 'IN-LIBRARY'
          ? (config.remoteVersion || existingConfig.remoteVersion || '')
          : ''
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
        message: `Successfully updated MCP server "${serverName}". Version: ${oldVersion} -> ${finalVersion}, Source: ${oldSource} -> ${finalSource}. The server is now reconnecting...`,
        server_name: serverName,
        old_version: oldVersion,
        new_version: finalVersion,
        old_source: oldSource,
        new_source: finalSource
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
