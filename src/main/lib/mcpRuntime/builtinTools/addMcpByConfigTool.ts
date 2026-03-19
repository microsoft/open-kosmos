/**
 * Add MCP by Config Tool
 * Add an MCP server directly using a complete MCP configuration
 *
 * Workflow:
 * 1. Receive the complete MCP configuration object
 * 2. Validate the configuration
 * 3. 🆕 Refactored: Call mcpClientManager to add the configuration (mcpClientManager internally handles updating ProfileCacheManager)
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { McpServerConfig } from '../../userDataADO/types';

/**
 * Tool input arguments interface
 */
interface AddMcpByConfigArgs {
  /** Complete MCP server configuration */
  mcp_config: {
    /** MCP server name */
    name: string;
    /** Transport type: 'stdio', 'sse', or 'StreamableHttp' */
    transport: 'stdio' | 'sse' | 'StreamableHttp';
    /** Command (for stdio transport) */
    command?: string;
    /** Command line arguments */
    args?: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Server URL (for sse/http transport) */
    url?: string;
    /** MCP server version (optional, defaults to 1.0.0) */
    version?: string;
  };
}

/**
 * Tool execution result interface
 */
interface AddMcpResult {
  success: boolean;
  message: string;
  server_name?: string;
  error?: string;
}

/**
 * Add MCP by Config Tool Implementation
 */
export class AddMcpByConfigTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'add_mcp_by_config',
      description: 'Add an MCP server by providing a complete configuration object. This tool allows you to add any MCP server with custom configuration, not limited to the MCP Library.',
      inputSchema: {
        type: 'object',
        properties: {
          mcp_config: {
            type: 'object',
            description: 'Complete MCP server configuration',
            properties: {
              name: {
                type: 'string',
                description: 'The unique name for this MCP server'
              },
              transport: {
                type: 'string',
                enum: ['stdio', 'sse', 'StreamableHttp'],
                description: 'Transport type for the MCP server'
              },
              command: {
                type: 'string',
                description: 'Command to execute (required for stdio transport)'
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
                description: 'Server URL (required for sse/StreamableHttp transport)'
              },
              version: {
                type: 'string',
                description: 'MCP server version (optional, defaults to 1.0.0)'
              }
            },
            required: ['name', 'transport']
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
  static async execute(args: AddMcpByConfigArgs): Promise<AddMcpResult> {
    try {
      // Validate input parameters
      if (!args.mcp_config|| typeof args.mcp_config !== 'object') {
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

      if (!config.transport || !['stdio', 'sse', 'StreamableHttp'].includes(config.transport)) {
        return {
          success: false,
          message: 'Invalid input: mcp_config.transport must be one of: stdio, sse, StreamableHttp',
          error: 'INVALID_INPUT'
        };
      }

      // Validate required fields for stdio transport
      if (config.transport === 'stdio') {
        if (!config.command || typeof config.command !== 'string' || !config.command.trim()) {
          return {
            success: false,
            message: 'Invalid input: mcp_config.command is required for stdio transport',
            error: 'INVALID_INPUT'
          };
        }
      }

      // Validate required fields for sse/http transport
      if (config.transport === 'sse' || config.transport === 'StreamableHttp') {
        if (!config.url || typeof config.url !== 'string' || !config.url.trim()) {
          return {
            success: false,
            message: `Invalid input: mcp_config.url is required for ${config.transport} transport`,
            error: 'INVALID_INPUT'
          };
        }
      }

      // Build the complete McpServerConfig
      const finalVersion = config.version || '1.0.0';
      const mcpConfig: McpServerConfig = {
        name: config.name.trim(),
        transport: config.transport,
        in_use: true, // Enabled by default
        command: config.command?.trim() || '',
        args: Array.isArray(config.args) ? config.args : [],
        env: (config.env && typeof config.env === 'object') ? config.env : {},
        url: config.url?.trim() || '',
        version: finalVersion,
        source: 'ON-DEVICE'
      };

      // 🆕 Refactored: Call mcpClientManager to add the MCP server (mcpClientManager internally handles updating ProfileCacheManager)
      const { mcpClientManager } = await import('../mcpClientManager');
      await mcpClientManager.add(mcpConfig.name, mcpConfig);

      // Successfully added
      return {
        success: true,
        message: `Successfully added MCP server "${mcpConfig.name}". The server is now connecting...`,
        server_name: mcpConfig.name
      };

    } catch (error) {
      return {
        success: false,
        message: `Error adding MCP server: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * Validate MCP config (helper method)
   * 
   * @param config MCP configuration to validate
   * @returns Validation result with error message if invalid
   */
  static validateConfig(config: any): { valid: boolean; error?: string } {
    if (!config || typeof config !== 'object') {
      return { valid: false, error: 'Config must be an object' };
    }

    if (!config.name || typeof config.name !== 'string') {
      return { valid: false, error: 'Config must have a valid name' };
    }

    if (!['stdio', 'sse', 'StreamableHttp'].includes(config.transport)) {
      return { valid: false, error: 'Transport must be stdio, sse, or StreamableHttp' };
    }

    if (config.transport === 'stdio' && !config.command) {
      return { valid: false, error: 'stdio transport requires a command' };
    }

    if ((config.transport === 'sse' || config.transport === 'StreamableHttp') && !config.url) {
      return { valid: false, error: `${config.transport} transport requires a url` };
    }

    return { valid: true };
  }
}