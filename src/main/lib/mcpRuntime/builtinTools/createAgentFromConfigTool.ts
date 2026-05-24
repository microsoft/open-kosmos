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

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';
import { generateChatId as generateRuntimeChatId } from '../../utilities/idFactory';
import {
  ChatConfig,
  ChatAgent,
  AgentMcpServer,
  DEFAULT_CHAT_AGENT
} from '../../userDataADO/types/profile';

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
 * Context Enhancement configuration input interface
 */
interface ContextEnhancementInput {
  /** Memory search configuration */
  search_memory?: {
    /** Whether to enable memory search */
    enabled?: boolean;
    /** Semantic similarity threshold, range [0,1] */
    semantic_similarity_threshold?: number;
    /** Number of top-N results for semantic similarity */
    semantic_top_n?: number;
  };
  /** Memory generation configuration */
  generate_memory?: {
    /** Whether to enable memory generation */
    enabled?: boolean;
  };
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
  /** System prompt (optional) */
  system_prompt?: string;
  /** Context Enhancement configuration (optional) */
  context_enhancement?: ContextEnhancementInput;
  /** List of skill names for the agent (optional) */
  skills?: string[];
  /** Agent workspace directory path (optional; empty means system auto-sets default path) */
  workspace?: string;
  /** Knowledge Base directory path (optional, default: workspace/knowledge) */
  knowledgeBase?: string;
  /** Agent version (optional, default 1.0.0) */
  version?: string;
  /** Agent source (optional, default ON-DEVICE) */
  source?: 'ON-DEVICE' | 'EXTERNAL';
  /** 🆕 Zero States configuration (optional, for initial chat experience) */
  zero_states?: {
    greeting?: string;
    quick_starts?: Array<{
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
            description: 'The avatar image URL for the agent (optional, should be empty for ON-DEVICE agents)'
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
            type: 'string',
            description: 'The system prompt that defines the agent\'s behavior and personality (optional)'
          },
          context_enhancement: {
            type: 'object',
            description: 'Context enhancement settings for memory search and generation (optional)',
            properties: {
              search_memory: {
                type: 'object',
                properties: {
                  enabled: {
                    type: 'boolean',
                    description: 'Enable memory search'
                  },
                  semantic_similarity_threshold: {
                    type: 'number',
                    description: 'Semantic similarity threshold (0-1)'
                  },
                  semantic_top_n: {
                    type: 'number',
                    description: 'Number of top results to retrieve'
                  }
                }
              },
              generate_memory: {
                type: 'object',
                properties: {
                  enabled: {
                    type: 'boolean',
                    description: 'Enable memory generation'
                  }
                }
              }
            }
          },
          skills: {
            type: 'array',
            description: 'List of skill names to enable for this agent (optional)',
            items: {
              type: 'string'
            }
          },
          workspace: {
            type: 'string',
            description: 'The workspace directory path for this agent (optional, system will set default path if empty or not provided)'
          },
          version: {
            type: 'string',
            description: 'Agent version (optional, defaults to 1.0.0)'
          },
          source: {
            type: 'string',
            enum: ['ON-DEVICE', 'EXTERNAL'],
            description: 'Agent source (optional, defaults to ON-DEVICE)'
          },
          knowledgeBase: {
            type: 'string',
            description: 'The knowledge base directory path for this agent (optional, defaults to workspace/knowledge)'
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
    // Build mcp_servers array, default to empty if not specified
    const mcpServers: AgentMcpServer[] = args.mcp_servers
      ? args.mcp_servers.map(server => ({
          name: server.name,
          tools: Array.isArray(server.tools) ? server.tools : []
        }))
      : [];

    // Build context_enhancement (pass through user input or default to disabled)
    const contextEnhancement: Record<string, unknown> | undefined = args.context_enhancement ? {
      search_memory: {
        enabled: args.context_enhancement?.search_memory?.enabled ?? false,
        semantic_similarity_threshold: args.context_enhancement?.search_memory?.semantic_similarity_threshold ?? 0.7,
        semantic_top_n: args.context_enhancement?.search_memory?.semantic_top_n ?? 5
      },
      generate_memory: {
        enabled: args.context_enhancement?.generate_memory?.enabled ?? false
      }
    } : undefined;

    const finalVersion = args.version || '1.0.0';
    const finalSource = args.source || 'ON-DEVICE';

    return {
      name: args.name.trim(),
      emoji: args.emoji || DEFAULT_CHAT_AGENT.emoji,
      avatar: args.avatar || '',
      role: args.role || 'Assistant',
      model: args.model || DEFAULT_CHAT_AGENT.model,
      // 🆕 Added: version and source fields; use args values if specified, otherwise use defaults
      version: finalVersion,
      source: finalSource,
      mcp_servers: mcpServers,
      system_prompt: args.system_prompt || '',
      context_enhancement: contextEnhancement,
      skills: args.skills || [],
      // 🆕 Added: zero_states field
      zero_states: args.zero_states
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
        chat.agent && chat.agent.name === agentName
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

      // Build ChatConfig
      // 🔄 workspace is now at the agent level; chatSessions has been removed (loaded dynamically at runtime)
      // If workspace is provided, use the provided value; otherwise empty string,
      // and profileCacheManager.addChatConfig will automatically set the default path
      const chatConfig: ChatConfig = {
        chat_id: chatId,
        chat_type: 'single_agent',
        agent: {
          ...chatAgent,
          workspace: args.workspace ?? '',
          knowledgeBase: args.knowledgeBase ?? ''
        }
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
        .filter(chat => chat.agent?.name)
        .map(chat => chat.agent!.name);
    } catch (error) {
      return [];
    }
  }
}