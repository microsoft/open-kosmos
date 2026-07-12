/**
 * CreateAgentFromConfigTool
 * Creates a new Agent from the provided configuration
 *
 * Process flow:
 * 1. Validate input configuration arguments
 * 2. Build the ChatAgent configuration
 * 3. Build the ChatConfig
 * 4. Call ProfileCacheManager to add the Agent to the user's configuration
 */

import { randomUUID } from 'crypto';
import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';
import { getChatAgents } from '../../userDataADO/agentAccessor';
import { generateChatId as generateRuntimeChatId } from '../../utilities/idFactory';
import {
  ChatConfig,
  ChatAgent,
  AgentMcpServer,
  DEFAULT_CHAT_AGENT
} from '../../userDataADO/types/profile';
import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  normalizeAgentSystemPrompt,
  setAgentSystemPromptFile,
  type AgentSystemPrompt,
} from '@shared/types/agentSystemPrompt';

/**
 * Agent MCP Server configuration input interface
 */
interface AgentMcpServerInput {
  /** MCP server name */
  name: string;
  /** List of selected tools (optional; empty or not provided means all tools are used) */
  tools?: string[];
}

/**
 * Tool input arguments interface
 */
interface CreateAgentFromConfigArgs {
  /** Agent name (required) */
  name: string;
  /** Agent emoji (optional, default 🤖) */
  emoji?: string;
  /** Agent avatar URL (optional) */
  avatar?: string;
  /** Agent role description (optional, default Assistant) */
  role?: string;
  /** Model to use (optional, uses system default if not specified) */
  model?: string;
  /** List of MCP servers dedicated to this agent (optional) */
  mcp_servers?: AgentMcpServerInput[];
  /** System prompt file map (optional; legacy string is accepted and stored as Base.md) */
  system_prompt?: AgentSystemPrompt | string;
  /** Agent Identity prompt content. Updates Base.md without touching AGENTS.md. */
  agent_identity_prompt?: string;
  /** Project Context prompt content. Updates AGENTS.md without touching Base.md. */
  project_context_prompt?: string;
  /** List of skill names for the agent (optional) */
  skills?: string[];
  /** Agent version (optional, default 1.0.0) */
  version?: string;
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
}

/**
 * Tool execution result interface
 */
interface CreateAgentResult {
  success: boolean;
  message: string;
  agent_name?: string;
  chat_id?: string;
  error?: string;
}

/**
 * Create Agent from Config Tool Implementation
 * @deprecated Use manage_agents instead.
 */
export class CreateAgentFromConfigTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'create_agent_from_config',
      description: 'Create a new AI agent with the specified configuration. This tool allows you to create custom agents with specific roles, models, MCP servers, system prompts, and skills.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the agent (required, must be unique)'
          },
          emoji: {
            type: 'string',
            description: 'The emoji icon for the agent (optional, default: 🤖)'
          },
          avatar: {
            type: 'string',
            description: 'The optional avatar image URL for this local agent'
          },
          role: {
            type: 'string',
            description: 'The role description of the agent (optional, default: Assistant)'
          },
          model: {
            type: 'string',
            description: 'The AI model to use for this agent (optional, uses system default if not specified)'
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
            description: 'System prompt files for the agent. Use {"Base.md":"...","AGENTS.md":"..."} for full content; omitted files default to empty on create. Legacy string input is accepted as Base.md.'
          },
          agent_identity_prompt: {
            type: 'string',
            description: 'Safe shortcut for Base.md / Agent Identity content. Prefer this when setting only who the agent is.'
          },
          project_context_prompt: {
            type: 'string',
            description: 'Safe shortcut for AGENTS.md / Project Context content. Prefer this when setting only what the agent works on and how to work in that context.'
          },
          skills: {
            type: 'array',
            description: 'List of skill names to enable for this agent (optional)',
            items: {
              type: 'string'
            }
          },
          version: {
            type: 'string',
            description: 'Agent version (optional, defaults to 1.0.0)'
          },
          zero_states: {
            type: 'object',
            description: 'Zero states configuration for chat initial experience (optional)',
            properties: {
              greeting: {
                type: 'string',
                description: 'Greeting message shown when chat is empty'
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
    };
  }

  /**
   * Generate a unique chat ID
   */
  private static generateChatId(): string {
    return generateRuntimeChatId();
  }

  /**
   * Build ChatAgent from input arguments
   */
  private static buildChatAgent(args: CreateAgentFromConfigArgs): ChatAgent {
    // Build mcp_servers from the provided config. When no mcp_servers are
    // specified, default to an empty array (no tools): an agent that was never
    // granted any servers must not silently receive builtin-tools.
    const mcpServers: AgentMcpServer[] = args.mcp_servers
      ? args.mcp_servers.map(server => ({
          name: server.name,
          tools: Array.isArray(server.tools) ? server.tools : []
        }))
      : [];

    const finalVersion = args.version || '1.0.0';
    let systemPrompt = normalizeAgentSystemPrompt(args.system_prompt);
    if (args.agent_identity_prompt !== undefined) {
      systemPrompt = setAgentSystemPromptFile(systemPrompt, AGENT_SYSTEM_PROMPT_BASE_FILE, args.agent_identity_prompt);
    }
    if (args.project_context_prompt !== undefined) {
      systemPrompt = setAgentSystemPromptFile(systemPrompt, AGENT_SYSTEM_PROMPT_AGENTS_FILE, args.project_context_prompt);
    }

    return {
      name: args.name.trim(),
      emoji: args.emoji || DEFAULT_CHAT_AGENT.emoji,
      avatar: args.avatar || '',
      role: args.role || 'Assistant',
      model: args.model || DEFAULT_CHAT_AGENT.model,
      version: finalVersion,
      source: 'ON-DEVICE',
      mcp_servers: mcpServers,
      system_prompt: systemPrompt,
      skills: args.skills || [],
      // 🆕 Added: zero_states field
      zero_states: args.zero_states
        ? {
            ...args.zero_states,
            quick_starts: args.zero_states.quick_starts?.map(qs => ({
              ...qs,
              id: qs.id || randomUUID().slice(0, 8),
            })),
          }
        : undefined
    };
  }

  /**
   * Execute the tool
   *
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: CreateAgentFromConfigArgs): Promise<CreateAgentResult> {
    try {
      // Validate input arguments
      if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
        return {
          success: false,
          message: 'Invalid input: name is required and must be a non-empty string',
          error: 'INVALID_INPUT'
        };
      }

      if (Object.prototype.hasOwnProperty.call(args as object, 'workspace')) {
        return {
          success: false,
          message: 'Invalid input: workspace is chat-owned and derived from the chat id; it cannot be set through agent creation.',
          error: 'INVALID_INPUT'
        };
      }

      if (Object.prototype.hasOwnProperty.call(args as object, 'knowledgeBase')) {
        return {
          success: false,
          message: 'Invalid input: knowledgeBase is managed by the agent store and cannot be set through agent creation.',
          error: 'INVALID_INPUT'
        };
      }

      const agentName = args.name.trim();

      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          message: 'No current user session found. Please ensure you are logged in.',
          error: 'NO_USER_SESSION'
        };
      }

      // Check if an agent with the same name already exists
      const existingChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
      const existingAgent = existingChats.find(chat =>
        getChatAgents(chat).some(agent => agent?.name === agentName)
      );

      if (existingAgent) {
        return {
          success: false,
          message: `An agent with name "${agentName}" already exists. Please choose a different name.`,
          error: 'AGENT_EXISTS'
        };
      }

      // Generate a new chat ID
      const chatId = this.generateChatId();

      // Build ChatAgent
      const chatAgent = this.buildChatAgent(args);

      // Build ChatConfig. Workspace is chat-owned and derived by addChatConfig.
      const chatConfig: ChatConfig = {
        chat_id: chatId,
        chat_type: 'single_agent',
        agent: chatAgent,
      };

      // Add the Agent to the user's configuration
      const addResult = await profileCacheManager.addChatConfig(currentUserAlias, chatConfig);

      if (!addResult) {
        return {
          success: false,
          message: `Failed to add agent "${agentName}": Unable to save configuration`,
          error: 'ADD_FAILED'
        };
      }

      // Successfully added
      return {
        success: true,
        message: `Successfully created agent "${agentName}" with chat ID "${chatId}".`,
        agent_name: agentName,
        chat_id: chatId
      };

    } catch (error) {
      return {
        success: false,
        message: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * Get all existing agent names (helper method)
   *
   * @returns List of existing agent names
   */
  static getExistingAgentNames(): string[] {
    try {
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return [];
      }

      const chats = profileCacheManager.getAllChatConfigs(currentUserAlias);
      return chats
        .flatMap(chat => getChatAgents(chat).map(agent => agent?.name))
        .filter((name): name is string => !!name);
    } catch (error) {
      return [];
    }
  }
}