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
 * - knowledge_base unified field (not dual knowledgeBase / knowledge.knowledgeBase)
 * - Local configuration only; legacy source metadata is treated as inert
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
import { randomUUID } from 'crypto';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { getChatAgents } from '../../../userDataADO/agentAccessor';
import type { ChatAgent, ZeroStates } from '../../../userDataADO/types/profile';
import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  mergeAgentSystemPromptUpdate,
  normalizeAgentSystemPrompt,
  setAgentSystemPromptFile,
  type AgentSystemPrompt,
} from '@shared/types/agentSystemPrompt';

const VALID_ACTIONS = ['create', 'update', 'list', 'set_primary', 'status'] as const;

export class ManageAgentsFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_agents',
      description:
        'Create, update, list, set_primary, or check status of agents. ' +
        'MCP servers can be specified as a simple name list. ' +
        'Prefer agent_identity_prompt or project_context_prompt when changing only one prompt file. ' +
        'On update, greeting preserves existing quick_starts and quick_starts merge by default. ' +
        'Deleting an agent is not supported here — remove the chat that references it instead.',
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
            anyOf: [
              {
                type: 'object',
                properties: {
                  'Base.md': { type: 'string' },
                  'AGENTS.md': { type: 'string' },
                },
                additionalProperties: false,
              },
              { type: 'string' },
            ],
            description: 'Advanced system prompt file input. On update, omitted files are preserved; legacy string input updates Base.md only. Prefer agent_identity_prompt/project_context_prompt for safer partial edits.',
          },
          agent_identity_prompt: {
            type: 'string',
            description: 'Safe shortcut for Base.md / Agent Identity content. Use this to define who the agent is without modifying AGENTS.md.',
          },
          project_context_prompt: {
            type: 'string',
            description: 'Safe shortcut for AGENTS.md / Project Context content. Use this to define what the agent works on and how to work in that context without modifying Base.md.',
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
          mcp_servers_mode: {
            type: 'string',
            enum: ['merge', 'replace'],
            description: 'How to apply mcp_servers during update. Defaults to merge.',
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
          skills_mode: {
            type: 'string',
            enum: ['merge', 'replace'],
            description: 'How to apply skills during update. Defaults to merge.',
          },
          hooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Hook ids to bind to this agent',
          },
          hooks_mode: {
            type: 'string',
            enum: ['merge', 'replace'],
            description: 'How to apply hooks during update. Defaults to merge.',
          },
          greeting: {
            type: 'string',
            description: 'Welcome message shown when chat starts. On update, this preserves existing quick_starts.',
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
            description: 'Quick start cards for the chat zero state. On update, new cards are merged by default; set quick_starts_mode="replace" to overwrite the whole list.',
          },
          quick_starts_mode: {
            type: 'string',
            enum: ['merge', 'replace'],
            description: 'How to apply quick_starts during update. Defaults to merge.',
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

    if (Object.prototype.hasOwnProperty.call(args as object, 'workspace')) {
      return errorResult(
        '"workspace" is no longer supported by manage_agents.',
        'Chat workspace is derived from the chat id and cannot be configured through agent tools.',
      );
    }

    switch (args.action) {
      case 'create':
        return ManageAgentsFacade.createDirect(name, args);
      case 'update':
        return ManageAgentsFacade.update(name, args);
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
      remoteVersion: '',
    };

    if (args.emoji) createArgs.emoji = args.emoji;
    if (args.role) createArgs.role = args.role;
    if (args.model) createArgs.model = args.model;
    const createSystemPrompt = ManageAgentsFacade.buildSystemPromptUpdate(undefined, args);
    if (createSystemPrompt) createArgs.system_prompt = createSystemPrompt;
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
    let existingChat: typeof allChats[number] | undefined = undefined;
    let existing: ChatAgent | undefined = undefined;
    for (const chat of allChats) {
      const matchingAgent = getChatAgents(chat).find(agent => agent?.name === name);
      if (matchingAgent) {
        existingChat = chat;
        existing = matchingAgent;
        break;
      }
    }

    if (!existingChat || !existing) {
      return errorResult(
        `Agent "${name}" not found.`,
        'Use manage_agents with action="list" to see installed agents.',
      );
    }
    // Build update payload
    const agentConfig: any = { name };

    if (args.emoji !== undefined) agentConfig.emoji = args.emoji;
    if (args.role !== undefined) agentConfig.role = args.role;
    if (args.model !== undefined) agentConfig.model = args.model;
    const promptUpdate = ManageAgentsFacade.buildSystemPromptUpdate(existing.system_prompt, args);
    if (promptUpdate) agentConfig.system_prompt = promptUpdate;
    if (args.skills !== undefined) {
      agentConfig.skills = args.skills;
      agentConfig.skills_mode = args.skills_mode === 'replace' ? 'replace' : 'merge';
    }
    if (args.hooks !== undefined) {
      agentConfig.hooks = args.hooks;
      agentConfig.hooks_mode = args.hooks_mode === 'replace' ? 'replace' : 'merge';
    }

    if (args.knowledge_base !== undefined) {
      agentConfig.knowledgeBase = args.knowledge_base;
    }

    if (args.mcp_servers !== undefined) {
      agentConfig.mcp_servers = ManageAgentsFacade.buildMcpServersArray(
        args.mcp_servers,
        args.mcp_tool_filter,
      );
      agentConfig.mcp_servers_mode = args.mcp_servers_mode === 'replace' ? 'replace' : 'merge';
    }

    if (args.greeting !== undefined || args.quick_starts !== undefined) {
      agentConfig.zero_states = ManageAgentsFacade.buildZeroStates(
        args.greeting,
        args.quick_starts,
        existing.zero_states,
        args.quick_starts_mode === 'replace' ? 'replace' : 'merge',
      );
    }

    const result = await UpdateAgentTool.execute({ agent_config: agentConfig });
    return result as unknown as FacadeResult;
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
   * Build zero_states from flat greeting + quick_starts, with optional template fallback.
   */
  private static buildZeroStates(
    greeting?: string,
    quickStarts?: Array<{ id?: string; title: string; description: string; prompt: string }>,
    templateZeroStates?: ZeroStates,
    quickStartsMode: 'merge' | 'replace' = 'replace',
  ): ZeroStates {
    const base = templateZeroStates || {};
    const result: ZeroStates = { ...base };
    if (greeting !== undefined) result.greeting = greeting;
    if (quickStarts !== undefined) {
      const normalizedQuickStarts = quickStarts.map(qs => ({
        ...qs,
        id: qs.id || randomUUID().slice(0, 8),
      }));
      if (quickStartsMode === 'merge' && Array.isArray(base.quick_starts)) {
        const incomingById = new Map(
          normalizedQuickStarts.map(qs => [qs.id, qs] as const),
        );
        const updatedExisting = base.quick_starts.map(existing => {
          const existingId = typeof existing.id === 'string' ? existing.id : undefined;
          return existingId && incomingById.has(existingId)
            ? incomingById.get(existingId)!
            : existing;
        });
        const existingIds = new Set(
          base.quick_starts
            .map(existing => (typeof existing.id === 'string' ? existing.id : undefined))
            .filter((id): id is string => Boolean(id)),
        );
        result.quick_starts = [
          ...updatedExisting,
          ...normalizedQuickStarts.filter(qs => !qs.id || !existingIds.has(qs.id)),
        ];
      } else {
        result.quick_starts = normalizedQuickStarts;
      }
    }
    return result;
  }

  private static buildSystemPromptUpdate(
    existingPrompt: unknown,
    args: Pick<ManageAgentsInput, 'system_prompt' | 'agent_identity_prompt' | 'project_context_prompt'>,
  ): AgentSystemPrompt | undefined {
    const hasPromptUpdate = args.system_prompt !== undefined ||
      args.agent_identity_prompt !== undefined ||
      args.project_context_prompt !== undefined;
    if (!hasPromptUpdate) return undefined;

    let prompt = args.system_prompt !== undefined
      ? mergeAgentSystemPromptUpdate(existingPrompt, args.system_prompt)
      : normalizeAgentSystemPrompt(existingPrompt);

    if (args.agent_identity_prompt !== undefined) {
      prompt = setAgentSystemPromptFile(prompt, AGENT_SYSTEM_PROMPT_BASE_FILE, args.agent_identity_prompt);
    }
    if (args.project_context_prompt !== undefined) {
      prompt = setAgentSystemPromptFile(prompt, AGENT_SYSTEM_PROMPT_AGENTS_FILE, args.project_context_prompt);
    }

    return prompt;
  }

  // ---- Utility ----

  private static getCurrentUserAlias(): string | null {
    try {
      return (profileCacheManager as any).currentUserAlias as string | null;
    } catch {
      return null;
    }
  }

}
