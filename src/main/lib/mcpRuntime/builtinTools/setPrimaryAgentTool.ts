/**
 * Set Primary Agent Tool
 * Set the primary agent
 * 
 * Sets the primaryAgent property via ProfileCacheManager
 * primaryAgent is displayed first in the AgentChatList and is the agent used when the app starts
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';

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
 */
export class SetPrimaryAgentTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'set_primary_agent',
      description: 'Set the primary agent for the user. The primary agent will be displayed first in the agent list and will be the default agent when the app starts. Use get_all_agents first to get the list of available agent names.',
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

      // Read the current primaryAgent property
      const previousPrimaryAgent = typeof profile.primaryAgent === 'string'
        ? profile.primaryAgent
        : 'Kobi';

      // If already the primary agent, return success directly
      if (previousPrimaryAgent === agentName) {
        return {
          success: true,
          primaryAgent: agentName,
          previousPrimaryAgent,
          message: `Agent "${agentName}" is already the primary agent.`
        };
      }

      // Call ProfileCacheManager to update primaryAgent
      const updateSuccess = await profileCacheManager.updatePrimaryAgent(
        currentUserAlias, 
        agentName
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