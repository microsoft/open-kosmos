/**
 * manage_agents facade — unified agent management tool.
 *
 * Merges the legacy tools:
 *   create_agent_from_config, update_agent,
 *   get_agent_status, list_agents, set_primary_agent
 * into a single action-based interface.
 *
 * Key simplifications:
 * - Flat parameters (no nested agent_config wrapper)
 * - mcp_servers as string[] (not [{name, tools}])
 * - memory_enabled boolean (not nested context_enhancement)
 * - knowledge_base unified field (not dual knowledgeBase / knowledge.knowledgeBase)
 * - source/version managed internally
 */

import {
  BuiltinToolDefinition,
  ManageAgentsInput,
  FacadeResult,
  errorResult,
} from './types';
import { CreateAgentFromConfigTool } from '../createAgentFromConfigTool';
import { UpdateAgentTool } from '../updateAgentTool';
import { GetAgentStatusTool } from '../getAgentStatusTool';
import { ListAgentsTool } from '../listAgentsTool';
import { SetPrimaryAgentTool } from '../setPrimaryAgentTool';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';

const VALID_ACTIONS = ['create', 'update', 'remove', 'list', 'set_primary', 'status'] as const;

export class ManageAgentsFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_agents',
      description:
        'Create, update, remove, list, set_primary, or check status of agents. ' +
        'MCP servers can be specified as a simple name list; memory is a single boolean toggle.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: VALID_ACTIONS as unknown as string[],
            description: 'The operation to perform',
          },
          name: {
            type: 'string',
            description: 'Agent name (required for all actions except "list")',
          },
          emoji: {
            type: 'string',
            description: 'Emoji icon for the agent (default: 🤖)',
          },
          role: {
            type: 'string',
            description: 'Role description (default: Assistant)',
          },
          model: {
            type: 'string',
            description: 'AI model identifier (uses system default if omitted)',
          },
          system_prompt: {
            type: 'string',
            description: 'Custom system prompt for the agent',
          },
          workspace: {
            type: 'string',
            description: 'Workspace directory path',
          },
          knowledge_base: {
            type: 'string',
            description: 'Knowledge base directory path',
          },
          mcp_servers: {
            type: 'array',
            items: { type: 'string' },
            description: 'MCP server names to bind (all tools enabled by default)',
          },
          mcp_tool_filter: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
            description:
              'Optional fine-grained tool filter: { server_name: [tool1, tool2] }. Only needed when limiting specific tools.',
          },
          skills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Skill names to attach to this agent',
          },
          greeting: {
            type: 'string',
            description: 'Welcome message shown when chat starts',
          },
          quick_starts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                prompt: { type: 'string' },
              },
              required: ['title', 'description', 'prompt'],
            },
            description: 'Quick start cards for the chat zero state',
          },
        },
        required: ['action'],
      },
    };
  }

  static async execute(args: ManageAgentsInput): Promise<FacadeResult> {
    // --- Validate action ---
    if (!args.action || !(VALID_ACTIONS as readonly string[]).includes(args.action)) {
      return errorResult(
        `Invalid action "${args.action}".`,
        `Valid actions: ${VALID_ACTIONS.join(', ')}`,
      );
    }

    // name is required for all actions except 'list'
    if (args.action !== 'list') {
      if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
        return errorResult(
          '"name" is required for this action.',
          'Provide the agent name.',
        );
      }
    }

    const name = args.name?.trim() || '';

    switch (args.action) {
      case 'create':
        return ManageAgentsFacade.createDirect(name, args);
      case 'update':
        return ManageAgentsFacade.update(name, args);
      case 'remove':
        return ManageAgentsFacade.remove(name);
      case 'list':
        return ManageAgentsFacade.list();
      case 'set_primary':
        return ManageAgentsFacade.setPrimary(name);
      case 'status':
        return ManageAgentsFacade.getStatus(name);
    }
  }

  // ---- Action handlers ----

  private static async createDirect(
    name: string,
    args: ManageAgentsInput,
  ): Promise<FacadeResult> {
    const createArgs: any = {
      name,
      source: 'ON-DEVICE',
      version: '1.0.0',
    };

    if (args.emoji) createArgs.emoji = args.emoji;
    if (args.role) createArgs.role = args.role;
    if (args.model) createArgs.model = args.model;
    if (args.system_prompt) createArgs.system_prompt = args.system_prompt;
    if (args.workspace) createArgs.workspace = args.workspace;
    if (args.skills) createArgs.skills = args.skills;

    if (args.knowledge_base) {
      createArgs.knowledgeBase = args.knowledge_base;
    }

    if (args.mcp_servers) {
      createArgs.mcp_servers = ManageAgentsFacade.buildMcpServersArray(
        args.mcp_servers,
        args.mcp_tool_filter,
      );
    }

    if (args.memory_enabled !== undefined) {
      createArgs.context_enhancement = ManageAgentsFacade.buildContextEnhancement(
        args.memory_enabled,
      );
    }

    if (args.greeting || args.quick_starts) {
      createArgs.zero_states = ManageAgentsFacade.buildZeroStates(
        args.greeting,
        args.quick_starts,
      );
    }

    const result = await CreateAgentFromConfigTool.execute(createArgs);
    return result as unknown as FacadeResult;
  }

  private static async update(
    name: string,
    args: ManageAgentsInput,
  ): Promise<FacadeResult> {
    // Read existing for version auto-management
    const currentUserAlias = ManageAgentsFacade.getCurrentUserAlias();
    if (!currentUserAlias) {
      return errorResult('No current user session found.', 'Please ensure you are logged in.');
    }

    // Find existing agent
    const allChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
    const existingChat = allChats.find(c => c.agent && c.agent.name === name);

    if (!existingChat || !existingChat.agent) {
      return errorResult(
        `Agent "${name}" not found.`,
        'Use manage_agents with action="list" to see installed agents.',
      );
    }

    const existing = existingChat.agent;
    const existingSource = (existing as any).source || 'ON-DEVICE';
    const existingVersion = (existing as any).version || '1.0.0';

    // Build update payload
    const agentConfig: any = { name };

    if (args.emoji !== undefined) agentConfig.emoji = args.emoji;
    if (args.role !== undefined) agentConfig.role = args.role;
    if (args.model !== undefined) agentConfig.model = args.model;
    if (args.system_prompt !== undefined) agentConfig.system_prompt = args.system_prompt;
    if (args.workspace !== undefined) agentConfig.workspace = args.workspace;
    if (args.skills !== undefined) agentConfig.skills = args.skills;

    if (args.knowledge_base !== undefined) {
      agentConfig.knowledgeBase = args.knowledge_base;
    }

    if (args.mcp_servers) {
      agentConfig.mcp_servers = ManageAgentsFacade.buildMcpServersArray(
        args.mcp_servers,
        args.mcp_tool_filter,
      );
    }

    if (args.memory_enabled !== undefined) {
      agentConfig.context_enhancement = ManageAgentsFacade.buildContextEnhancement(
        args.memory_enabled,
      );
    }

    if (args.greeting !== undefined || args.quick_starts !== undefined) {
      agentConfig.zero_states = ManageAgentsFacade.buildZeroStates(
        args.greeting,
        args.quick_starts,
      );
    }

    // Auto-manage version/source
    agentConfig.source = existingSource;
    agentConfig.version = ManageAgentsFacade.incrementPatch(existingVersion);

    const result = await UpdateAgentTool.execute({ agent_config: agentConfig });
    return result as unknown as FacadeResult;
  }

  private static async remove(name: string): Promise<FacadeResult> {
    try {
      const currentUserAlias = ManageAgentsFacade.getCurrentUserAlias();
      if (!currentUserAlias) {
        return errorResult('No current user session found.');
      }

      const allChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
      const targetChat = allChats.find(c => c.agent && c.agent.name === name);

      if (!targetChat) {
        return errorResult(
          `Agent "${name}" not found.`,
          'Use manage_agents with action="list" to see installed agents.',
        );
      }

      await profileCacheManager.deleteChatConfig(currentUserAlias, targetChat.chat_id);

      return {
        success: true,
        message: `Agent "${name}" has been removed.`,
        agent_name: name,
        chat_id: targetChat.chat_id,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to remove agent "${name}": ${err instanceof Error ? err.message : String(err)}`,
        error: 'REMOVE_FAILED',
      };
    }
  }

  private static async list(): Promise<FacadeResult> {
    const result = await ListAgentsTool.execute();
    return result as unknown as FacadeResult;
  }

  private static async setPrimary(name: string): Promise<FacadeResult> {
    const result = await SetPrimaryAgentTool.execute({ agent_name: name });
    return result as unknown as FacadeResult;
  }

  private static async getStatus(name: string): Promise<FacadeResult> {
    const result = await GetAgentStatusTool.execute({ agent_name: name });
    return result as unknown as FacadeResult;
  }

  // ---- Transform helpers ----

  /**
   * Convert flat mcp_servers string[] + optional mcp_tool_filter
   * into the legacy [{name, tools}] format.
   */
  private static buildMcpServersArray(
    serverNames: string[],
    toolFilter?: Record<string, string[]>,
  ): Array<{ name: string; tools: string[] }> {
    return serverNames.map(serverName => ({
      name: serverName,
      tools: toolFilter?.[serverName] || [],
    }));
  }

  /**
   * Expand boolean memory_enabled into full context_enhancement structure.
   */
  private static buildContextEnhancement(enabled: boolean): Record<string, unknown> {
    if (enabled) {
      return {
        search_memory: {
          enabled: true,
          semantic_similarity_threshold: 0.7,
          semantic_top_n: 5,
        },
        generate_memory: {
          enabled: true,
        },
      };
    }
    return {
      search_memory: { enabled: false },
      generate_memory: { enabled: false },
    };
  }

  /**
   * Build zero_states from flat greeting + quick_starts, with optional template fallback.
   */
  private static buildZeroStates(
    greeting?: string,
    quickStarts?: Array<{ title: string; description: string; prompt: string }>,
    templateZeroStates?: Record<string, unknown>,
  ): Record<string, unknown> {
    const base = templateZeroStates || {};
    const result: Record<string, unknown> = { ...base };
    if (greeting !== undefined) result.greeting = greeting;
    if (quickStarts !== undefined) result.quick_starts = quickStarts;
    return result;
  }

  // ---- Utility ----

  private static getCurrentUserAlias(): string | null {
    try {
      return (profileCacheManager as any).currentUserAlias as string | null;
    } catch {
      return null;
    }
  }

  private static incrementPatch(version: string): string {
    const parts = version.split('.');
    if (parts.length !== 3) return '1.0.1';
    const patch = parseInt(parts[2], 10);
    return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`;
  }
}
