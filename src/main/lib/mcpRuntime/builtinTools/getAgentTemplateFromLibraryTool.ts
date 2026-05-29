/**
 * Get Agent Template from Library Tool
 * Retrieves an Agent template configuration from the Agent Library by name
 *
 * Process flow:
 * 1. Call AgentLibraryFetcher to fetch the Agent library list
 * 2. Find the Agent configuration matching the given name
 * 3. Check if there is a locally installed agent with the same name; if so, replace the workspace in the new version config with the local value
 * 4. Handle OpenKosmos and USER-INPUT placeholders (if any)
 * 5. Return the complete configuration JSON (without any omissions)
 */

import { BuiltinToolDefinition } from './types';
import { AgentLibraryFetcher } from '../../assetsFetcher/agentLibraryFetcher';
import { getCdnBaseUrl } from '@shared/utils/cdn';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';

/**
 * Tool input arguments interface
 */
interface GetAgentTemplateFromLibraryArgs {
  /** Agent name (the name field from the library) */
  agent_name: string;
}

/**
 * Full Agent configuration (from agent_lib.json)
 * Preserves the original JSON structure without any omissions
 */
interface AgentLibraryConfig {
  name: string;
  version: string;
  source?: 'IN-LIBRARY' | 'ON-DEVICE';
  description: string;
  contact?: string;
  requirements?: {
    software?: Record<string, string>;
    mcp?: string[];
    skills?: string[];
  };
  configuration?: {
    emoji?: string;
    avatar?: string;
    name?: string;
    workspace?: string;
    model?: string;
    mcp_servers?: Array<{
      name: string;
      tools?: string[];
    }>;
    system_prompt?: string;
    context_enhancement?: {
      search_memory?: {
        enabled: boolean;
        semantic_similarity_threshold?: number;
        semantic_top_n?: number;
      };
      generate_memory?: {
        enabled: boolean;
      };
    };
    skills?: string[];
    zero_states?: {
      greeting?: string;
      quick_starts?: Array<{
        title: string;
        image?: string;
        description: string;
        prompt: string;
      }>;
    };
  };
  prompts?: {
    setup_agent?: string;
    update_agent?: string;
    setup_requirements?: string;
  };
}

/**
 * Tool execution result interface
 */
interface GetAgentTemplateFromLibraryResult {
  success: boolean;
  message: string;
  config?: AgentLibraryConfig;
  error?: string;
}

/**
 * Get Agent Template from Library Tool Implementation
 * @deprecated Use search_agents instead.
 */
export class GetAgentTemplateFromLibraryTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    const baseCdnUrl = getCdnBaseUrl();
    const sourceDescription = baseCdnUrl
      ? `fetches the latest Agent library from ${baseCdnUrl}/agent/agent_lib.json`
      : 'fetches the latest Agent library from the locally cached source';
    return {
      name: 'get_agent_template_from_library',
      description: `Get Agent configuration from the Agent Library by its name. This tool ${sourceDescription}, finds the agent configuration by name, and returns the complete config JSON without any field omissions.`,
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'The name of the Agent to get config from the library (e.g., "Research Agent")'
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
  static async execute(args: GetAgentTemplateFromLibraryArgs): Promise<GetAgentTemplateFromLibraryResult> {
    try {
      // Validate input arguments
      if (!args.agent_name || typeof args.agent_name !== 'string' || !args.agent_name.trim()) {
        return {
          success: false,
          message: 'Invalid input: agent_name is required and must be a non-empty string',
          error: 'INVALID_INPUT'
        };
      }

      const agentName = args.agent_name.trim();

      // Step 1: Fetch Agent Library data
      const fetcher = AgentLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return {
          success: false,
          message: `Failed to fetch Agent library: ${libraryResult.error || 'Unknown error'}`,
          error: 'LIBRARY_FETCH_FAILED'
        };
      }

      // Step 2: Find the specified Agent by name in the library
      const agents = libraryResult.data.agents;
      const foundAgent = agents.find(agent => agent.name === agentName);

      if (!foundAgent) {
        // Provide a list of available Agents as suggestions
        const availableAgents = agents.map(a => a.name).slice(0, 10); // Show only the first 10
        return {
          success: false,
          message: `Agent "${agentName}" not found in library. Available agents include: ${availableAgents.join(', ')}${agents.length > 10 ? ', ...' : ''}`,
          error: 'AGENT_NOT_FOUND'
        };
      }

      // Step 3: Build the agent configuration, preserving all fields
      const agentConfig: AgentLibraryConfig = {
        name: foundAgent.name,
        version: foundAgent.version,
        source: (foundAgent as any).source,
        description: foundAgent.description,
        contact: foundAgent.contact,
        requirements: foundAgent.requirements,
        configuration: foundAgent.configuration ? { ...foundAgent.configuration } : undefined,
        prompts: (foundAgent as any).prompts
      };

      // Step 3.5: Check if there is a locally installed agent with the same name;
      // if so, replace the workspace in the new version config with the local value.
      // This step is performed before handling OpenKosmos and USER-INPUT placeholders.
      // Automatically get the current user alias
      const currentUserAlias = GetAgentTemplateFromLibraryTool.getCurrentUserAlias();
      let localWorkspaceApplied = false;

      if (currentUserAlias && agentConfig.configuration) {
        const localWorkspace = await GetAgentTemplateFromLibraryTool.getLocalAgentWorkspace(currentUserAlias, agentName);
        if (localWorkspace) {
          // Override the workspace in the new version config with the local agent's workspace value
          agentConfig.configuration.workspace = localWorkspace;
          localWorkspaceApplied = true;
        }
      }

      // Step 4: Handle OpenKosmos and USER-INPUT placeholders (if any)
      // Note: Placeholder handling is the responsibility of the caller (e.g., createAgentFromConfigTool or updateAgentTool).
      // This tool only fetches the config and applies local workspace (if it exists).

      // Successfully return complete configuration
      return {
        success: true,
        message: `Successfully retrieved Agent config for "${agentName}" from library.${localWorkspaceApplied ? ' Local workspace preserved from existing agent.' : ''}`,
        config: agentConfig
      };

    } catch (error) {
      return {
        success: false,
        message: `Error getting Agent config: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * Get the current user alias
   * Retrieves the currently cached user alias from profileCacheManager
   *
   * @returns Current user alias, or null if not available
   */
  private static getCurrentUserAlias(): string | null {
    try {
      // Get the list of cached user aliases from profileCacheManager
      const cachedAliases = profileCacheManager.getCachedAliases();

      // Usually only one user is signed in; return the first one
      if (cachedAliases.length > 0) {
        return cachedAliases[0];
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a local agent with the same name exists and return its workspace value
   *
   * @param userAlias User alias
   * @param agentName Agent name
   * @returns Workspace value of the local agent with the same name, or null if not found
   */
  private static async getLocalAgentWorkspace(userAlias: string, agentName: string): Promise<string | null> {
    try {
      // Get all chat configurations from profileCacheManager
      const allChats = profileCacheManager.getAllChatConfigs(userAlias);

      // Find an agent with the same name
      for (const chat of allChats) {
        if (chat.agent && chat.agent.name === agentName) {
          // Found an agent with the same name, return its workspace value
          const workspace = chat.agent.workspace;
          if (workspace && typeof workspace === 'string' && workspace.trim() !== '') {
            return workspace;
          }
        }
      }

      // No agent with the same name found, or no valid workspace
      return null;
    } catch (error) {
      // Return null on error to avoid affecting the main flow
      return null;
    }
  }

  /**
   * Get available Agents from library (helper method)
   *
   * @returns List of available Agent names
   */
  static async getAvailableAgents(): Promise<string[]> {
    try {
      const fetcher = AgentLibraryFetcher.getInstance();
      const libraryResult = await fetcher.getLibraryData();

      if (!libraryResult.success || !libraryResult.data) {
        return [];
      }

      return libraryResult.data.agents.map(agent => agent.name);
    } catch (error) {
      return [];
    }
  }
}
