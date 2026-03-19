/**
 * Check MCP Status Tool
 * Check the status of an MCP server by its name
 * 
 * Status types:
 * - NotAdded: Server not added to configuration
 * - Disconnected: Server added but not connected
 * - Connected: Server connected and running normally
 * - Error: Server connection failed or encountered an error
 * - Disconnecting: Server is disconnecting
 * - Connecting: Server is connecting
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { profileCacheManager } from '../../userDataADO';

/**
 * MCP server status type
 */
export type McpStatus = 'NotAdded' | 'Disconnected' | 'Connected' | 'Error' | 'Disconnecting' | 'Connecting';

/**
 * Tool input arguments interface
 */
interface CheckMcpStatusArgs {
  /** MCP server name */
  mcp_name: string;
}

/**
 * Tool execution result interface
 */
interface CheckMcpStatusResult {
  success: boolean;
  mcp_name: string;
  status: McpStatus;
  message: string;
  details?: {
    /** Whether it is in use */
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
 * Check MCP Status Tool Implementation
 */
export class CheckMcpStatusTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'check_mcp_status',
      description: 'Check the status of an MCP server by its name. Returns one of the following statuses: NotAdded (server not configured), Disconnected (configured but not connected), Connected (active and running), Error (connection failed), Disconnecting (in process of disconnecting), or Connecting (in process of connecting).',
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
  static async execute(args: CheckMcpStatusArgs): Promise<CheckMcpStatusResult> {
    try {
      // Validate input parameters
      if (!args.mcp_name|| typeof args.mcp_name !== 'string' || !args.mcp_name.trim()) {
        return {
          success: false,
          mcp_name: args.mcp_name || '',
          status: 'NotAdded',
          message: 'Invalid input: mcp_name is required and must be a non-empty string'
        };
      }

      const mcpName = args.mcp_name.trim();

      // Get the current user (from ProfileCacheManager's internal state)
      // Note: ProfileCacheManager methods require user_alias, but we need to get the current active user
      // Here we assume there is a method to get the current user; if not, this needs improvement
      
      // Try to get server info (this will implicitly use the current user)
      let serverInfo;
      try {
        // ProfileCacheManager methods typically require user_alias
        // We need a helper method to get the currently active user_alias
        // Temporarily using a try-catch to handle this issue
        
        // Approach: Iterate over all possible users to find the server
        // But this is not optimal; ideally there should be a getCurrentUser method
        
        // Actually, we could check profileCacheManager's internal state
        // But since it's private, we need to use public methods
        
        // Temporary solution: Assume the tool executes within a user context
        // MCPClientManager should have the current user information
        
        // Better approach: Have the tool receive user_alias as implicit context
        // Or get the current user from MCPClientManager
        
        // Since this is a built-in tool, it executes in a specific user context
        // We can get the current user from the environment
        
        // Implementation: Use profileCacheManager's public API
        // Getting server info for all users may not be feasible
        
        // Most practical approach: Require the caller to provide user_alias or get it from the execution context
        // But for simplicity, we'll assume there is a default user for now
        
        // Check profileCacheManager's public methods
        // It provides getMcpServerInfo and getAllMcpServerRuntimeStates methods
        // But both require a user_alias parameter
        
        // Solution: Get the current user from MCPClientManager
        const { mcpClientManager } = await import('../mcpClientManager');
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

      // Check if the server exists in the configuration
      if (!serverInfo.config) {
        return {
          success: true,
          mcp_name: mcpName,
          status: 'NotAdded',
          message: `MCP server "${mcpName}" is not added to the configuration.`
        };
      }

      // Get the runtime state
      const runtimeState = serverInfo.runtime;
      
      if (!runtimeState) {
        // Has configuration but no runtime state = Disconnected
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
      const details: CheckMcpStatusResult['details'] = {
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