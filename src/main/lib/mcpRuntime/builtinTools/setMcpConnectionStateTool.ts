/**
 * SetMcpConnectionStateTool
 * Sets the connection state of an MCP server by name
 *
 * Supported actions:
 * - connect: Connect to the MCP server
 * - disconnect: Disconnect from the MCP server
 * - reconnect: Reconnect to the MCP server
 *
 * 🚀 Performance optimization: Uses lazy loading to avoid importing heavy modules at startup
 */

import { BuiltinToolDefinition } from './types';
import { mcpClientManager } from "../mcpClientManager";
import { profileCacheManager } from "../../userDataADO";

// 🚀 Builtin server name constant - avoids importing builtinMcpClient
const BUILTIN_SERVER_NAME = 'builtin-tools';

/**
 * Operation type
 */
export type McpConnectionAction = 'connect' | 'disconnect' | 'reconnect';

/**
 * Tool input arguments interface
 */
interface SetMcpConnectionStateArgs {
  /** MCP server name */
  name: string;
  /** Action type: connect, disconnect, reconnect */
  action: McpConnectionAction;
}

/**
 * Tool execution result interface
 */
interface SetMcpConnectionStateResult {
  success: boolean;
  mcp_name: string;
  action: McpConnectionAction;
  message: string;
  previous_status?: string;
  current_status?: string;
  error?: string;
}

/**
 * Set MCP Connection State Tool Implementation
 * @deprecated Use manage_mcp instead.
 */
export class SetMcpConnectionStateTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'set_mcp_connection_state',
      description: 'Set the connection state of an MCP server by its name. Supports three actions: "connect" (establish connection), "disconnect" (close connection), and "reconnect" (disconnect then connect again). Note: The builtin server cannot be toggled.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the MCP server to update connection state for (e.g., "filesystem", "github", "brave-search")'
          },
          action: {
            type: 'string',
            enum: ['connect', 'disconnect', 'reconnect'],
            description: 'The action to perform: "connect" to establish connection, "disconnect" to close connection, or "reconnect" to restart connection'
          }
        },
        required: ['name', 'action']
      }
    };
  }

  /**
   * Execute the tool
   *
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: SetMcpConnectionStateArgs, options?: { signal?: AbortSignal }): Promise<SetMcpConnectionStateResult> {
    try {
      if (options?.signal?.aborted) {
        return {
          success: false,
          mcp_name: args.name || '',
          action: args.action,
          message: 'Tool execution aborted',
          error: 'ABORTED'
        };
      }
      // Validate input argument - name
      if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
        return {
          success: false,
          mcp_name: args.name || '',
          action: args.action,
          message: 'Invalid input: name is required and must be a non-empty string',
          error: 'INVALID_NAME'
        };
      }

      // Validate input argument - action
      const validActions: McpConnectionAction[] = ['connect', 'disconnect', 'reconnect'];
      if (!args.action || !validActions.includes(args.action)) {
        return {
          success: false,
          mcp_name: args.name,
          action: args.action,
          message: `Invalid input: action must be one of: ${validActions.join(', ')}`,
          error: 'INVALID_ACTION'
        };
      }

      const mcpName = args.name.trim();
      const action = args.action;

      // Check if this is a builtin server
      if (mcpName === BUILTIN_SERVER_NAME) {
        return {
          success: false,
          mcp_name: mcpName,
          action: action,
          message: `Cannot toggle builtin server "${BUILTIN_SERVER_NAME}". It is always connected and managed automatically.`,
          error: 'BUILTIN_SERVER_PROTECTED'
        };
      }

      // 🚀 Lazy-load mcpClientManager and profileCacheManager

      // Get the current user
      const currentUser = (mcpClientManager as any).currentUserAlias;

      if (!currentUser) {
        return {
          success: false,
          mcp_name: mcpName,
          action: action,
          message: 'No active user session found. Please sign in first.',
          error: 'NO_USER_SESSION'
        };
      }

      // Get server information
      const serverInfo = profileCacheManager.getMcpServerInfo(currentUser, mcpName);

      // Check if the server exists in configuration
      if (!serverInfo.config) {
        return {
          success: false,
          mcp_name: mcpName,
          action: action,
          message: `MCP server "${mcpName}" is not found in configuration. Please add it first.`,
          error: 'SERVER_NOT_FOUND'
        };
      }

      // Get the current status
      const previousStatus = serverInfo.runtime?.status || 'disconnected';

      // Execute the action
      try {
        switch (action) {
          case 'connect':
            await mcpClientManager.connect(mcpName);
            break;
          case 'disconnect':
            await mcpClientManager.disconnect(mcpName);
            break;
          case 'reconnect':
            await mcpClientManager.reconnect(mcpName);
            break;
        }

        // Get the status after the action
        const updatedServerInfo = profileCacheManager.getMcpServerInfo(currentUser, mcpName);
        const currentStatus = updatedServerInfo.runtime?.status || 'unknown';

        // Build the success message
        let successMessage = '';
        switch (action) {
          case 'connect':
            successMessage = currentStatus === 'connected'
              ? `Successfully connected to MCP server "${mcpName}".`
              : `Connection initiated for MCP server "${mcpName}". Current status: ${currentStatus}.`;
            break;
          case 'disconnect':
            successMessage = currentStatus === 'disconnected'
              ? `Successfully disconnected from MCP server "${mcpName}".`
              : `Disconnection initiated for MCP server "${mcpName}". Current status: ${currentStatus}.`;
            break;
          case 'reconnect':
            successMessage = currentStatus === 'connected'
              ? `Successfully reconnected to MCP server "${mcpName}".`
              : `Reconnection initiated for MCP server "${mcpName}". Current status: ${currentStatus}.`;
            break;
        }

        return {
          success: true,
          mcp_name: mcpName,
          action: action,
          message: successMessage,
          previous_status: previousStatus,
          current_status: currentStatus
        };

      } catch (operationError) {
        // Get the status after the action (attempt even on error)
        let currentStatus = 'unknown';
        try {
          const updatedServerInfo = profileCacheManager.getMcpServerInfo(currentUser, mcpName);
          currentStatus = updatedServerInfo.runtime?.status || 'unknown';
        } catch {
          // Ignore errors when fetching status
        }

        const errorMessage = operationError instanceof Error ? operationError.message : String(operationError);

        return {
          success: false,
          mcp_name: mcpName,
          action: action,
          message: `Failed to ${action} MCP server "${mcpName}": ${errorMessage}`,
          previous_status: previousStatus,
          current_status: currentStatus,
          error: errorMessage
        };
      }

    } catch (error) {
      return {
        success: false,
        mcp_name: args.name || '',
        action: args.action,
        message: `Error executing set_mcp_connection_state: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}