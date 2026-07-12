/**
 * Update Agent by Config Tool
 * Updates an installed Agent using Agent configuration
 *
 * Workflow:
 * 1. Receive Agent configuration object
 * 2. Validate that the Agent is installed (by name lookup)
 * 3. Apply the local update
 * 4. Call profileCacheManager to update the configuration
 *
 * Existing remote metadata is accepted for compatibility but never consulted.
 */

import { BuiltinToolDefinition } from './types';
import {
  ChatAgent,
  ChatConfig,
  AgentMcpServer,
  AgentKnowledge,
  DEFAULT_CHAT_AGENT,
  type ZeroStates,
} from '../../userDataADO/types/profile';
import { randomUUID } from 'crypto';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";
import { agentIdOf, getChatAgents, getChatPrimaryAgent } from "../../userDataADO/agentAccessor";
import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  mergeAgentSystemPromptUpdate,
  setAgentSystemPromptFile,
  type AgentSystemPrompt,
} from '@shared/types/agentSystemPrompt';

/**
 * Agent MCP Server configuration input interface
 */
interface AgentMcpServerInput {
  /** MCP server name */
  name: string;
  /** List of selected tools (optional; empty or not provided means use all tools) */
  tools?: string[];
}

interface AgentKnowledgeInput {
  knowledgeBase?: string;
}

/**
 * Tool input arguments interface
 */
interface UpdateAgentByConfigArgs {
  /** Agent configuration update */
  agent_config: {
    /** Agent name (required, used to find the installed Agent) */
    name: string;
    /** Agent emoji (optional) */
    emoji?: string;
    /** Agent avatar URL (optional) */
    avatar?: string;
    /** Agent role description (optional) */
    role?: string;
    /** Model to use (optional) */
    model?: string;
    /** List of MCP servers dedicated to this Agent (optional) */
    mcp_servers?: AgentMcpServerInput[];
    /**
     * How to apply mcp_servers against the existing list (optional).
     * 'merge' (default): union by server name — additive, never drops existing servers.
     * 'replace': overwrite the entire list with the provided one.
     */
    mcp_servers_mode?: 'merge' | 'replace';
    /** System prompt file map (optional; legacy string is accepted and stored as Base.md) */
    system_prompt?: AgentSystemPrompt | string;
    /** Agent Identity prompt content. Updates Base.md without touching AGENTS.md. */
    agent_identity_prompt?: string;
    /** Project Context prompt content. Updates AGENTS.md without touching Base.md. */
    project_context_prompt?: string;
    /** List of Skill names used by the Agent (optional) */
    skills?: string[];
    /**
     * How to apply skills against the existing list (optional).
     * 'merge' (default): union by skill name — additive, never drops existing skills.
     * 'replace': overwrite the entire list with the provided one.
     */
    skills_mode?: 'merge' | 'replace';
    /** Agent Hook ids bound to this Agent (optional) */
    hooks?: string[];
    /**
     * How to apply hooks against the existing list (optional).
     * 'merge' (default): union by Hook id — additive, never drops existing hooks.
     * 'replace': overwrite the entire list with the provided one.
     */
    hooks_mode?: 'merge' | 'replace';
    /** Knowledge Base directory path (optional) */
    knowledgeBase?: string;
    /** Agent knowledge settings (optional) */
    knowledge?: AgentKnowledgeInput;
    /** Legacy metadata accepted but ignored. */
    version?: string;
    /** Legacy metadata accepted but ignored. */
    source?: 'IN-LIBRARY' | 'ON-DEVICE';
    /** Legacy metadata accepted but ignored. */
    remoteVersion?: string;
    /** 🆕 Zero States configuration (optional, for initial chat experience) */
    zero_states?: {
      greeting?: string;
      quick_starts?: Array<{
        id?: string;
        title: string;
        image?: string;
        description: string;
        prompt: string;
      }>;
    };
  };
}

/**
 * Tool execution result interface
 */
interface UpdateAgentResult {
  success: boolean;
  message: string;
  agent_name?: string;
  chat_id?: string;
  old_version?: string;
  new_version?: string;
  old_source?: string;
  new_source?: string;
  error?: string;
}

/**
 * Auto-increment version patch number by 1
 * Example: "1.0.0" -> "1.0.1", "2.3.5" -> "2.3.6"
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    // If version format is invalid, return version + ".1"
    return version + '.1';
  }

  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  return `${major}.${minor}.${patch + 1}`;
}

function mergeAgentMcpServers(
  existing: AgentMcpServer[],
  incoming: AgentMcpServer[],
): AgentMcpServer[] {
  const merged = new Map(existing.map(server => [server.name, server]));
  for (const server of incoming) {
    merged.set(server.name, { ...merged.get(server.name), ...server });
  }
  return Array.from(merged.values());
}

function mergeStrings(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

function normalizeKnowledgeInput(input: AgentKnowledgeInput | undefined, existingAgent: ChatAgent): AgentKnowledge {
  const existingKnowledge = existingAgent.knowledge || {};

  return {
    ...existingKnowledge,
    knowledgeBase: input?.knowledgeBase !== undefined
      ? input.knowledgeBase
      : (existingKnowledge.knowledgeBase ?? existingAgent.knowledgeBase),
  };
}

function normalizeZeroStatesUpdate(update: UpdateAgentByConfigArgs['agent_config']['zero_states'] | undefined, existingAgent: ChatAgent): ZeroStates | undefined {
  if (update === undefined) {
    return existingAgent.zero_states;
  }

  return {
    ...(existingAgent.zero_states || {}),
    ...update,
    quick_starts: update.quick_starts !== undefined
      ? update.quick_starts.map(qs => ({
          ...qs,
          id: qs.id || randomUUID().slice(0, 8),
        }))
      : existingAgent.zero_states?.quick_starts,
  };
}

/**
 * Update Agent Tool Implementation
 * @deprecated Use manage_agents instead.
 */
export class UpdateAgentTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'update_agent',
      description: 'Update an existing locally configured AI agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_config: {
            type: 'object',
            description: 'Agent configuration update',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the agent to update (must match an existing agent)'
              },
              emoji: {
                type: 'string',
                description: 'The emoji icon for the agent (optional, keeps existing if not provided)'
              },
              avatar: {
                type: 'string',
                description: 'The optional avatar image URL for the agent'
              },
              role: {
                type: 'string',
                description: 'The role description of the agent (optional, keeps existing if not provided)'
              },
              model: {
                type: 'string',
                description: 'The AI model to use for this agent (optional, keeps existing if not provided)'
              },
              mcp_servers: {
                type: 'array',
                description: 'List of MCP servers available to this agent (optional)',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'MCP server name'
                    },
                    tools: {
                      type: 'array',
                      description: 'List of specific tools to enable from this server (empty array means all tools)',
                      items: {
                        type: 'string'
                      }
                    }
                  },
                  required: ['name']
                }
              },
              mcp_servers_mode: {
                type: 'string',
                enum: ['merge', 'replace'],
                description: 'How to apply mcp_servers. "merge" (default) adds to the existing list without dropping any; "replace" overwrites the whole list.'
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
                description: 'System prompt files for the agent. On update, omitted files are preserved; legacy string input updates Base.md only.'
              },
              agent_identity_prompt: {
                type: 'string',
                description: 'Safe shortcut for updating Base.md / Agent Identity only. Does not modify AGENTS.md.'
              },
              project_context_prompt: {
                type: 'string',
                description: 'Safe shortcut for updating AGENTS.md / Project Context only. Does not modify Base.md.'
              },
              skills: {
                type: 'array',
                description: 'List of skill names to enable for this agent (optional)',
                items: {
                  type: 'string'
                }
              },
              skills_mode: {
                type: 'string',
                enum: ['merge', 'replace'],
                description: 'How to apply skills. "merge" (default) adds to the existing list without dropping any; "replace" overwrites the whole list.'
              },
              hooks: {
                type: 'array',
                description: 'List of Hook ids to bind to this agent (optional)',
                items: {
                  type: 'string'
                }
              },
              hooks_mode: {
                type: 'string',
                enum: ['merge', 'replace'],
                description: 'How to apply hooks. "merge" (default) adds to the existing list without dropping any; "replace" overwrites the whole list.'
              },
              knowledgeBase: {
                type: 'string',
                description: 'The knowledge base directory path for this agent (optional, keeps existing if not provided)'
              },
              knowledge: {
                type: 'object',
                description: 'Knowledge source settings for this agent.',
                properties: {
                  knowledgeBase: {
                    type: 'string',
                    description: 'The knowledge base directory path for this agent (optional, keeps existing if not provided)'
                  }
                }
              },
              zero_states: {
                type: 'object',
                description: 'Partial zero states configuration for chat initial experience. Omitted fields are preserved on update; quick_starts replaces the full quick start list when provided.',
                properties: {
                  greeting: {
                    type: 'string',
                    description: 'Greeting message shown when chat is empty. Preserves existing quick_starts when this is the only zero_states field provided.'
                  },
                  quick_starts: {
                    type: 'array',
                    description: 'Quick start cards for common tasks',
                    items: {
                      type: 'object',
                      properties: {
                        title: {
                          type: 'string',
                          description: 'Card title'
                        },
                        image: {
                          type: 'string',
                          description: 'Card image URL (optional)'
                        },
                        description: {
                          type: 'string',
                          description: 'Card description'
                        },
                        prompt: {
                          type: 'string',
                          description: 'Prompt to send when card is clicked'
                        }
                      },
                      required: ['title', 'description', 'prompt']
                    }
                  }
                }
              }
            },
            required: ['name']
          }
        },
        required: ['agent_config']
      }
    };
  }

  /**
   * Execute the tool
   *
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: UpdateAgentByConfigArgs): Promise<UpdateAgentResult> {
    try {
      // Validate input parameters
      if (!args.agent_config || typeof args.agent_config !== 'object') {
        return {
          success: false,
          message: 'Invalid input: agent_config is required and must be an object',
          error: 'INVALID_INPUT'
        };
      }

      const config = args.agent_config;
  const knowledgeInput = config.knowledge;

      // Validate required fields
      if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
        return {
          success: false,
          message: 'Invalid input: agent_config.name is required and must be a non-empty string',
          error: 'INVALID_INPUT'
        };
      }

      if (Object.prototype.hasOwnProperty.call(config as object, 'workspace')) {
        return {
          success: false,
          message: 'Invalid input: workspace is chat-owned and derived from the chat id; it cannot be updated through agent configuration.',
          error: 'INVALID_INPUT'
        };
      }

      const agentName = config.name.trim();

      // Get profileCacheManager to check whether the Agent is installed

      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          message: 'No current user session found. Please ensure you are logged in.',
          error: 'NO_USER_SESSION'
        };
      }

      // Check whether the Agent is installed (by name lookup)
      const existingChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
      let existingChat: ChatConfig | undefined = undefined;
      let existingAgents: ChatAgent[] = [];
      let existingAgent: ChatAgent | undefined = undefined;
      for (const chat of existingChats) {
        const chatAgents = getChatAgents(chat);
        const matchingAgent = chatAgents.find(agent => agent?.name === agentName);
        if (matchingAgent) {
          existingChat = chat;
          existingAgents = chatAgents;
          existingAgent = matchingAgent;
          break;
        }
      }

      if (!existingChat || !existingAgent) {
        return {
          success: false,
          message: `Agent "${agentName}" is not installed. Use create_agent_from_config to install it first.`,
          error: 'NOT_INSTALLED'
        };
      }
      const targetAgent = existingAgent;

      const chatId = existingChat.chat_id;
      const oldVersion = targetAgent.version || '1.0.0';
      const finalVersion = incrementPatchVersion(oldVersion);

      const normalizedKnowledge = normalizeKnowledgeInput({
        ...knowledgeInput,
        knowledgeBase: knowledgeInput?.knowledgeBase ?? config.knowledgeBase,
      }, targetAgent);

      // Build mcp_servers array (if new ones are provided).
      // Rationale: callers typically mean "add this server", not "set the list to only this".
      // Full replacement here previously wiped existing bindings (see regression: chrome-devtools
      // overwrote all of Kobi's MCP servers).
      const mcpServersMode = config.mcp_servers_mode === 'replace' ? 'replace' : 'merge';
      let finalMcpServers: AgentMcpServer[] | undefined;
      if (config.mcp_servers !== undefined) {
        const newMcpServers = (config.mcp_servers || []).map(server => ({
          name: server.name,
          tools: Array.isArray(server.tools) ? server.tools : []
        }));
        if (mcpServersMode === 'merge') {
          // Merge — preserve existing servers/tool selections, add new ones
          finalMcpServers = mergeAgentMcpServers(existingAgent.mcp_servers || [], newMcpServers);
        } else {
          finalMcpServers = newMcpServers;
        }
      }

      // Build skills array.
      const skillsMode = config.skills_mode === 'replace' ? 'replace' : 'merge';
      let finalSkills: string[] | undefined;
      if (config.skills !== undefined) {
        if (skillsMode === 'merge') {
          finalSkills = mergeStrings(existingAgent.skills || [], config.skills || []);
        } else {
          finalSkills = config.skills;
        }
      }

      const hooksMode = config.hooks_mode === 'replace' ? 'replace' : 'merge';
      let finalHooks: string[] | undefined;
      if (config.hooks !== undefined) {
        if (hooksMode === 'merge') {
          finalHooks = mergeStrings(existingAgent.hooks || [], config.hooks || []);
        } else {
          finalHooks = config.hooks;
        }
      }

      let finalSystemPrompt = mergeAgentSystemPromptUpdate(targetAgent.system_prompt, config.system_prompt);
      if (config.agent_identity_prompt !== undefined) {
        finalSystemPrompt = setAgentSystemPromptFile(finalSystemPrompt, AGENT_SYSTEM_PROMPT_BASE_FILE, config.agent_identity_prompt);
      }
      if (config.project_context_prompt !== undefined) {
        finalSystemPrompt = setAgentSystemPromptFile(finalSystemPrompt, AGENT_SYSTEM_PROMPT_AGENTS_FILE, config.project_context_prompt);
      }

      // Build agent update object
      const agentUpdates: Partial<ChatAgent> = {
        // Basic attributes: use new value if provided, otherwise keep original
        emoji: config.emoji || targetAgent.emoji,
        avatar: config.avatar !== undefined ? config.avatar : (targetAgent.avatar || ''),
        role: config.role || targetAgent.role,
        model: config.model || targetAgent.model,
        system_prompt: finalSystemPrompt,
        knowledge: normalizedKnowledge,
        // Bindings have already been merged or replaced based on the requested mode.
        mcp_servers: finalMcpServers !== undefined ? finalMcpServers : targetAgent.mcp_servers,
        skills: finalSkills !== undefined ? finalSkills : targetAgent.skills,
        hooks: finalHooks !== undefined ? finalHooks : targetAgent.hooks,
        version: finalVersion,
        source: 'ON-DEVICE',
        remoteVersion: targetAgent.remoteVersion,
        // zero_states is a partial object: omitted greeting/quick_starts stay intact.
        zero_states: normalizeZeroStatesUpdate(config.zero_states, targetAgent)
      };

      // updateChatAgent edits only the primary agent. Secondary agents in a
      // multi-agent chat use the plural store-aware updateChatConfig path.
      const primaryAgent = getChatPrimaryAgent(existingChat);
      const targetAgentId = agentIdOf(targetAgent);
      const primaryAgentId = primaryAgent ? agentIdOf(primaryAgent) : undefined;
      const updateResult = primaryAgentId === targetAgentId
        ? await profileCacheManager.updateChatAgent(currentUserAlias, chatId, agentUpdates)
        : await profileCacheManager.updateChatConfig(currentUserAlias, chatId, {
            agent: primaryAgent ?? existingAgents[0],
            agents: existingAgents.map(agent =>
              agentIdOf(agent) === targetAgentId
                ? { ...targetAgent, ...agentUpdates }
                : agent
            ),
          });

      if (!updateResult) {
        return {
          success: false,
          message: `Failed to update agent "${agentName}": Unable to save configuration`,
          error: 'UPDATE_FAILED'
        };
      }

      // Successfully updated
      return {
        success: true,
        message: `Successfully updated Agent "${agentName}".`,
        agent_name: agentName,
        chat_id: chatId,
        old_version: oldVersion,
        new_version: finalVersion,
        old_source: targetAgent.source,
        new_source: 'ON-DEVICE'
      };

    } catch (error) {
      return {
        success: false,
        message: `Error updating Agent: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * Validate Agent config for update (helper method)
   *
   * @param config Agent configuration to validate
   * @param existingAgent Existing Agent configuration
   * @returns Validation result with error message if invalid
   */
  static validateConfigForUpdate(config: any, existingAgent: ChatAgent): { valid: boolean; error?: string } {
    if (!config || typeof config !== 'object') {
      return { valid: false, error: 'Config must be an object' };
    }

    if (!config.name || typeof config.name !== 'string') {
      return { valid: false, error: 'Config must have a valid name' };
    }

    if (config.name !== existingAgent.name) {
      return { valid: false, error: 'Cannot change agent name during update' };
    }

    if (Object.prototype.hasOwnProperty.call(config, 'workspace')) {
      return { valid: false, error: 'workspace is chat-owned and derived from the chat id' };
    }

    return { valid: true };
  }
}
