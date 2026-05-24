/**
 * GetMcpStatusTool
 * Check the status of an MCP server by its name
 *
 * Status types:
 * - NotAdded: server not added to configuration
 * - Disconnected: server is configured but not connected
 * - Connected: server is connected and running normally
 * - Error: server connection failed or encountered an error
 * - Disconnecting: server is in the process of disconnecting
 * - Connecting: server is in the process of connecting
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';
import { mcpClientManager } from "../mcpClientManager";

/**
 * MCP server status type
 */
export type McpStatus = 'NotAdded' | 'Disconnected' | 'Connected' | 'Error' | 'Disconnecting' | 'Connecting' | 'NeedsUserInteraction';

/**
 * Tool input arguments interface
 */
interface GetMcpStatusArgs {
  /** MCP server name */
  mcp_name: string;
}

/**
 * Tool execution result interface
 */
interface GetMcpStatusResult {
  success: boolean;
  mcp_name: string;
  status: McpStatus;
  message: string;
  details?: {
    /** Whether the server is in use */
    in_use?: boolean;
    /** Number of available tools */
    tools_count?: number;
    /** Error message (if any) */
    error_message?: string;
    /** Transport type */
    transport?: string;
  };
}

/**
 * Get MCP Status Tool Implementation
 * @deprecated Use manage_mcp or search_mcp instead.
 */
export class GetMcpStatusTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'get_mcp_status',
      description: 'Check the status of an MCP server by its name. Returns one of the following statuses: NotAdded (server not configured), Disconnected (configured but not connected), Connected (active and running), Error (connection failed), Disconnecting (in process of disconnecting), Connecting (in process of connecting), or NeedsUserInteraction (authentication or other user action is required before the server can connect).',
      inputSchema: {
        type: 'object',
        properties: {
          mcp_name: {
            type: 'string',
            description: 'The name of the MCP server to check status for (e.g., "filesystem", "github", "brave-search")'
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
  static async execute(args: GetMcpStatusArgs): Promise<GetMcpStatusResult> {
    try {
      // Validate input arguments
      if (!args.mcp_name || typeof args.mcp_name !== 'string' || !args.mcp_name.trim()) {
        return {
          success: false,
          mcp_name: args.mcp_name || '',
          status: 'NotAdded',
          message: 'Invalid input: mcp_name is required and must be a non-empty string'
        };
      }

      const mcpName = args.mcp_name.trim();

      // Get the current user (from ProfileCacheManager's internal state)
      // Note: ProfileCacheManager methods require user_alias, but we need to get the active user
      // We assume there is a method to get the current user; otherwise this needs improvement

      // Try to get server info (this will implicitly use the current user)
      let serverInfo;
      try {
        // ProfileCacheManager methods typically require user_alias
        // We need a helper method to get the currently active user_alias
        // Using a try-catch to handle this temporarily

        // Approach: iterate over all possible users to find the server
        // This is not ideal; ideally there would be a getCurrentUser method

        // In practice, we can inspect profileCacheManager's internal state
        // but since it is private, we must use public methods

        // Temporary solution: assume the tool is executing in a user context
        // MCPClientManager should hold the current user info

        // Better approach: have the tool receive user_alias as implicit context
        // or retrieve the current user from MCPClientManager

        // Since this is a built-in tool, it executes within a specific user context
        // We can obtain the current user from the environment

        // Implementation: use profileCacheManager's public API
        // Getting server info for all users may not be feasible

        // Most practical approach: require the caller to supply user_alias or obtain it from execution context
        // For simplicity, assume a default user for now

        // Inspect profileCacheManager's public methods:
        // It provides getMcpServerInfo and getAllMcpServerRuntimeStates
        // but both require a user_alias parameter

        // Solution: get the current user from MCPClientManager
        const currentUser = (mcpClientManager as any).currentUserAlias;

        if (!currentUser) {
          return {
            success: false,
            mcp_name: mcpName,
            status: 'NotAdded',
            message: 'No active user session found. Please sign in first.'
          };
        }

        serverInfo = profileCacheManager.getMcpServerInfo(currentUser, mcpName);
      } catch (error) {
        return {
          success: false,
          mcp_name: mcpName,
          status: 'NotAdded',
          message: `Error accessing MCP server information: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      // Check whether the server exists in the configuration
      if (!serverInfo.config) {
        return {
          success: true,
          mcp_name: mcpName,
          status: 'NotAdded',
          message: `MCP server "${mcpName}" is not added to the configuration.`
        };
      }

      // Get runtime state
      const runtimeState = serverInfo.runtime;

      if (!runtimeState) {
        // Has config but no runtime state = Disconnected
        return {
          success: true,
          mcp_name: mcpName,
          status: 'Disconnected',
          message: `MCP server "${mcpName}" is configured but not connected.`,
          details: {
            in_use: serverInfo.config.in_use,
            transport: serverInfo.config.transport
          }
        };
      }

      // Return the corresponding status based on the runtime state
      let status: McpStatus;
      let message: string;
      const details: GetMcpStatusResult['details'] = {
        in_use: serverInfo.config.in_use,
        tools_count: runtimeState.tools?.length || 0,
        transport: serverInfo.config.transport
      };

      switch (runtimeState.status) {
        case 'connected':
          status = 'Connected';
          message = `MCP server "${mcpName}" is connected and running with ${details.tools_count} tools available.`;
          break;

        case 'connecting':
          status = 'Connecting';
          message = `MCP server "${mcpName}" is currently connecting...`;
          break;

        case 'disconnecting':
          status = 'Disconnecting';
          message = `MCP server "${mcpName}" is currently disconnecting...`;
          break;

        case 'disconnected':
          status = 'Disconnected';
          message = `MCP server "${mcpName}" is disconnected.`;
          break;

        case 'error':
          status = 'Error';
          message = `MCP server "${mcpName}" encountered an error.`;
          if (runtimeState.lastError) {
            details.error_message = runtimeState.lastError.message || String(runtimeState.lastError);
          }
          break;

        case 'needs-user-interaction':
          status = 'NeedsUserInteraction';
          message = `MCP server "${mcpName}" is waiting for user interaction before it can connect.`;
          if (runtimeState.lastError) {
            details.error_message = runtimeState.lastError.message || String(runtimeState.lastError);
          }
          break;

        default:
          status = 'Disconnected';
          message = `MCP server "${mcpName}" has unknown status: ${runtimeState.status}`;
      }

      return {
        success: true,
        mcp_name: mcpName,
        status,
        message,
        details
      };

    } catch (error) {
      return {
        success: false,
        mcp_name: args.mcp_name || '',
        status: 'Error',
        message: `Error checking MCP server status: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}