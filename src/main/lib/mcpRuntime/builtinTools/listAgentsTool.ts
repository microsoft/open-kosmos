/**
 * Get All Agents Tool
 * Get a list of all agent names
 *
 * Reads agent names from all chat configurations in ProfileCacheManager
 * and returns an array of all agent names configured by the user
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';

/**
 * Tool execution result interface
 */
interface GetAllAgentsResult {
  success: boolean;
  /** List of all agent names */
  agents: string[];
  /** Total number of agents */
  count: number;
  message: string;
}

/**
 * List Agents Tool Implementation
 * @deprecated Use manage_agents or search_agents instead.
 */
export class ListAgentsTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'list_agents',
      description: 'Get all agent names from the user profile. Returns an array of agent names configured in the system. This includes all agents across different chats.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }

  /**
   * Execute the tool
   *
   * @returns Execution result with agent names array
   */
  static async execute(): Promise<GetAllAgentsResult> {
    try {
      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          agents: [],
          count: 0,
          message: 'No active user session found. Please sign in first.'
        };
      }

      // Get the user's profile
      const profile = profileCacheManager.getCachedProfile(currentUserAlias);

      if (!profile) {
        return {
          success: false,
          agents: [],
          count: 0,
          message: 'User profile not found. Please ensure you are signed in.'
        };
      }

      // Extract all agent names from chats
      const agentNames: string[] = [];

      if (profile.chats && Array.isArray(profile.chats)) {
        for (const chat of profile.chats) {
          if (chat.agent && chat.agent.name) {
            // Avoid adding duplicate agent names
            if (!agentNames.includes(chat.agent.name)) {
              agentNames.push(chat.agent.name);
            }
          }
        }
      }

      return {
        success: true,
        agents: agentNames,
        count: agentNames.length,
        message: agentNames.length > 0
          ? `Found ${agentNames.length} agent(s): ${agentNames.join(', ')}`
          : 'No agents configured in the profile.'
      };

    } catch (error) {
      return {
        success: false,
        agents: [],
        count: 0,
        message: `Error getting all agents: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}