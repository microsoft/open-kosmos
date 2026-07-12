/**
 * Set Primary Agent Tool
 * Sets the primary agent
 *
 * Sets the primary chat mapping via ProfileCacheManager, resolving the given
 * agent name to its owning chat. The primary chat is displayed first in the
 * AgentChatList and is the chat opened after app startup.
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';
import { getChatAgents, getChatPrimaryAgent } from '../../userDataADO/agentAccessor';

/**
 * Tool input arguments interface
 */
interface SetPrimaryAgentArgs {
  /** Agent name */
  agent_name: string;
}

/**
 * Tool execution result interface
 */
interface SetPrimaryAgentResult {
  success: boolean;
  /** primaryAgent name after setting */
  primaryAgent: string;
  /** primaryAgent name before setting */
  previousPrimaryAgent: string;
  message: string;
}

/**
 * Set Primary Agent Tool Implementation
 * @deprecated Use manage_agents instead.
 */
export class SetPrimaryAgentTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'set_primary_agent',
      description: 'Set the primary agent for the user. The primary agent will be displayed first in the agent list and will be the default agent when the app starts. Use list_agents first to get the list of available agent names.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'The name of the agent to set as primary. Must be an existing agent name from the user profile.'
          }
        },
        required: ['agent_name']
      }
    };
  }

  /**
   * Execute the tool
   *
   * @param args Tool arguments containing agent_name
   * @returns Execution result with new primary agent status
   */
  static async execute(args: SetPrimaryAgentArgs): Promise<SetPrimaryAgentResult> {
    try {
      // Validate arguments
      if (!args || !args.agent_name || typeof args.agent_name !== 'string') {
        return {
          success: false,
          primaryAgent: '',
          previousPrimaryAgent: '',
          message: 'Invalid argument: agent_name is required and must be a non-empty string.'
        };
      }

      const agentName = args.agent_name.trim();
      if (!agentName) {
        return {
          success: false,
          primaryAgent: '',
          previousPrimaryAgent: '',
          message: 'Invalid argument: agent_name cannot be empty.'
        };
      }

      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          primaryAgent: '',
          previousPrimaryAgent: '',
          message: 'No active user session found. Please sign in first.'
        };
      }

      // Get the user's profile
      const profile = profileCacheManager.getCachedProfile(currentUserAlias);

      if (!profile) {
        return {
          success: false,
          primaryAgent: '',
          previousPrimaryAgent: '',
          message: 'User profile not found. Please ensure you are signed in.'
        };
      }

      // The cached profile stores chats as agent_ids only; use the hydrated chat
      // configs so each chat's inline agent (and its name) is resolvable.
      const chats = profileCacheManager.getAllChatConfigs(currentUserAlias);

      // Resolve the current primary chat's agent name for reporting.
      const previousChat = chats.find((c) => c.chat_id === profile.primaryChat);
      const previousPrimaryAgent = getChatPrimaryAgent(previousChat)?.name ?? '';

      // Resolve the chat that owns the requested agent — the primary chat is keyed
      // by chat_id, so the agent name is mapped to its owning chat here.
      const targetChat = chats.find((c) =>
        getChatAgents(c).some(agent => agent?.name === agentName)
      );
      if (!targetChat) {
        return {
          success: false,
          primaryAgent: previousPrimaryAgent,
          previousPrimaryAgent,
          message: `Agent "${agentName}" was not found in your profile. Use list_agents to see available agent names.`
        };
      }

      // If already the primary chat, return success immediately
      if (profile.primaryChat === targetChat.chat_id) {
        return {
          success: true,
          primaryAgent: agentName,
          previousPrimaryAgent,
          message: `Agent "${agentName}" is already the primary agent.`
        };
      }

      // Invoke ProfileCacheManager to update the primary chat mapping
      const updateSuccess = await profileCacheManager.updatePrimaryChat(
        currentUserAlias,
        targetChat.chat_id
      );

      if (!updateSuccess) {
        return {
          success: false,
          primaryAgent: previousPrimaryAgent,
          previousPrimaryAgent,
          message: `Failed to set "${agentName}" as primary agent. Please ensure the agent name exists in your profile.`
        };
      }

      return {
        success: true,
        primaryAgent: agentName,
        previousPrimaryAgent,
        message: `Successfully set "${agentName}" as the primary agent. It will now appear first in the agent list and be the default agent on app startup.`
      };

    } catch (error) {
      return {
        success: false,
        primaryAgent: '',
        previousPrimaryAgent: '',
        message: `Error setting primary agent: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}