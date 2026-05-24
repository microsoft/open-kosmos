/**
 * Update Agent by Config Tool
 * Updates an installed Agent using Agent configuration.
 *
 * Source is always ON-DEVICE. Version is auto-incremented on each update.
 */

import { BuiltinToolDefinition } from './types';
import {
  ChatAgent,
  AgentMcpServer,
  AgentKnowledge,
  DEFAULT_CHAT_AGENT
} from '../../userDataADO/types/profile';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";

/**
 * Agent MCP Server configuration input interface
 */
interface AgentMcpServerInput {
  /** MCP server name */
  name: string;
  /** List of selected tools (optional; empty or not provided means use all tools) */
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
    /** Number of top-N semantic similarity results */
    semantic_top_n?: number;
  };
  /** Memory generation configuration */
  generate_memory?: {
    /** Whether to enable memory generation */
    enabled?: boolean;
  };
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
    /** Agent avatar URL (optional; should be empty for ON-DEVICE agents) */
    avatar?: string;
    /** Agent role description (optional) */
    role?: string;
    /** Model to use (optional) */
    model?: string;
    /** List of MCP servers dedicated to this Agent (optional) */
    mcp_servers?: AgentMcpServerInput[];
    /** System prompt (optional) */
    system_prompt?: string;
    /** Context Enhancement configuration (optional) */
    context_enhancement?: ContextEnhancementInput;
    /** List of Skill names used by the Agent (optional) */
    skills?: string[];
    /** Agent working directory path (optional) */
    workspace?: string;
    /** Knowledge Base directory path (optional) */
    knowledgeBase?: string;
    /** Agent knowledge settings (optional) */
    knowledge?: AgentKnowledgeInput;
    /** Agent version (optional, auto-managed) */
    version?: string;
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

function normalizeKnowledgeInput(input: AgentKnowledgeInput | undefined, existingAgent: ChatAgent): AgentKnowledge {
  const existingKnowledge = existingAgent.knowledge || {};

  return {
    ...existingKnowledge,
    knowledgeBase: input?.knowledgeBase !== undefined
      ? input.knowledgeBase
      : (existingKnowledge.knowledgeBase ?? existingAgent.knowledgeBase),
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
      description: 'Update an existing AI agent configuration. The agent must be already installed (checked by name). Follows specific rules for source and version updates.',
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
                description: 'The avatar image URL for the agent (optional, should be empty for ON-DEVICE agents)'
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
                description: 'The workspace directory path for this agent (optional, keeps existing if not provided)'
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
              version: {
                type: 'string',
                description: 'Agent version (auto-managed)'
              },
              source: {
                type: 'string',
                enum: ['ON-DEVICE'],
                description: 'Agent source'
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
      const existingChat = existingChats.find(chat =>
        chat.agent && chat.agent.name === agentName
      );

      if (!existingChat || !existingChat.agent) {
        return {
          success: false,
          message: `Agent "${agentName}" is not installed. Use create_agent_from_config to install it first.`,
          error: 'NOT_INSTALLED'
        };
      }

      const existingAgent = existingChat.agent;
      const chatId = existingChat.chat_id;
      const oldVersion = existingAgent.version || '1.0.0';

      // Always ON-DEVICE; auto-increment patch version
      const finalSource: 'ON-DEVICE' = 'ON-DEVICE';
      const finalVersion: string = incrementPatchVersion(oldVersion);

      const normalizedKnowledge = normalizeKnowledgeInput({
        ...knowledgeInput,
        knowledgeBase: knowledgeInput?.knowledgeBase ?? config.knowledgeBase,
      }, existingAgent);

      // Build the updated ChatAgent
      // Build mcp_servers array (full replacement for ON-DEVICE)
      let finalMcpServers: AgentMcpServer[] | undefined;
      if (config.mcp_servers !== undefined) {
        finalMcpServers = (config.mcp_servers || []).map(server => ({
          name: server.name,
          tools: Array.isArray(server.tools) ? server.tools : []
        }));
      }

      // Build skills array (full replacement for ON-DEVICE)
      let finalSkills: string[] | undefined;
      if (config.skills !== undefined) {
        finalSkills = config.skills;
      }

      // Build context_enhancement (if new ones are provided)
      let contextEnhancement: Record<string, unknown> | undefined;
      if (config.context_enhancement !== undefined) {
        const existingCE = (existingAgent.context_enhancement || {}) as any;
        contextEnhancement = {
          search_memory: {
            enabled: config.context_enhancement?.search_memory?.enabled ?? existingCE?.search_memory?.enabled ?? false,
            semantic_similarity_threshold: config.context_enhancement?.search_memory?.semantic_similarity_threshold ?? existingCE?.search_memory?.semantic_similarity_threshold ?? 0.7,
            semantic_top_n: config.context_enhancement?.search_memory?.semantic_top_n ?? existingCE?.search_memory?.semantic_top_n ?? 5
          },
          generate_memory: {
            enabled: config.context_enhancement?.generate_memory?.enabled ?? existingCE?.generate_memory?.enabled ?? false
          }
        };
      }

      // Build agent update object
      const agentUpdates: Partial<ChatAgent> = {
        // Basic attributes: use new value if provided, otherwise keep original
        emoji: config.emoji || existingAgent.emoji,
        avatar: config.avatar !== undefined ? config.avatar : (existingAgent.avatar || ''),
        role: config.role || existingAgent.role,
        model: config.model || existingAgent.model,
        system_prompt: config.system_prompt !== undefined ? config.system_prompt : existingAgent.system_prompt,
        workspace: config.workspace !== undefined ? config.workspace : existingAgent.workspace,
        knowledge: normalizedKnowledge,
        mcp_servers: finalMcpServers !== undefined ? finalMcpServers : existingAgent.mcp_servers,
        context_enhancement: contextEnhancement !== undefined ? contextEnhancement : existingAgent.context_enhancement,
        skills: finalSkills !== undefined ? finalSkills : existingAgent.skills,
        version: finalVersion,
        source: finalSource,
        zero_states: config.zero_states !== undefined ? config.zero_states : existingAgent.zero_states
      };

      // Call profileCacheManager to update Agent
      const updateResult = await profileCacheManager.updateChatAgent(currentUserAlias, chatId, agentUpdates);

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
        message: `Successfully updated Agent "${agentName}". Version: ${oldVersion} -> ${finalVersion}.`,
        agent_name: agentName,
        chat_id: chatId,
        old_version: oldVersion,
        new_version: finalVersion,
        old_source: 'ON-DEVICE',
        new_source: finalSource
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

    // Validate source if provided
    if (config.source && !['ON-DEVICE'].includes(config.source)) {
      return { valid: false, error: 'Source must be ON-DEVICE' };
    }

    return { valid: true };
  }
}
