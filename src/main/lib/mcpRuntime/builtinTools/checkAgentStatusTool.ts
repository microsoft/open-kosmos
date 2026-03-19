/**
 * Check Agent Status Tool
 * Check the status of an Agent by its name
 * 
 * Status types:
 * - NotAdded: Agent's chat not added to the profile
 * - Added: Agent's chat has been added to the profile
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';

/**
 * Agent status type
 */
export type AgentStatus = 'NotAdded' | 'Added';

/**
 * Tool input arguments interface
 */
interface CheckAgentStatusArgs {
  /** Agent name */
  agent_name: string;
}

/**
 * Tool execution result interface
 */
interface CheckAgentStatusResult {
  success: boolean;
  agent_name: string;
  status: AgentStatus;
  message: string;
  details?: {
    /** Chat ID (if added) */
    chat_id?: string;
    /** Agent role (if added) */
    role?: string;
    /** Agent emoji (if added) */
    emoji?: string;
    /** Agent model (if added) */
    model?: string;
  };
}

/**
 * Check Agent Status Tool Implementation
 */
export class CheckAgentStatusTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'check_agent_status',
      description: 'Check the status of an agent by its name. Returns one of the following statuses: NotAdded (agent chat not added to profile), or Added (agent chat has been added to profile).',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'The name of the agent to check status for'
          }
        },
        required: ['agent_name']
      }
    };
  }

  /**
   * Execute the tool
   * 
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: CheckAgentStatusArgs): Promise<CheckAgentStatusResult> {
    try {
      // Validate input parameters
      if (!args.agent_name|| typeof args.agent_name !== 'string' || !args.agent_name.trim()) {
        return {
          success: false,
          agent_name: args.agent_name || '',
          status: 'NotAdded',
          message: 'Invalid input: agent_name is required and must be a non-empty string'
        };
      }

      const agentName = args.agent_name.trim();

      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          agent_name: agentName,
          status: 'NotAdded',
          message: 'No active user session found. Please sign in first.'
        };
      }

      // Get all chat configurations for the user
      const chats = profileCacheManager.getAllChatConfigs(currentUserAlias);
      
      if (!chats || !Array.isArray(chats)) {
        return {
          success: true,
          agent_name: agentName,
          status: 'NotAdded',
          message: `Agent "${agentName}" is not added. No chat configurations found.`
        };
      }

      // Find the agent with the specified name in the chats list
      const foundChat = chats.find(chat => chat.agent && chat.agent.name === agentName);

      if (foundChat && foundChat.agent) {
        // Agent is added
        return {
          success: true,
          agent_name: agentName,
          status: 'Added',
          message: `Agent "${agentName}" is added to the profile.`,
          details: {
            chat_id: foundChat.chat_id,
            role: foundChat.agent.role,
            emoji: foundChat.agent.emoji,
            model: foundChat.agent.model
          }
        };
      } else {
        // Agent is not added
        return {
          success: true,
          agent_name: agentName,
          status: 'NotAdded',
          message: `Agent "${agentName}" is not added to the profile.`
        };
      }

    } catch (error) {
      return {
        success: false,
        agent_name: args.agent_name || '',
        status: 'NotAdded',
        message: `Error checking agent status: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}