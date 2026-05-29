/**
 * Update Agent by Config Tool
 * Updates an installed Agent using Agent configuration
 *
 * Workflow:
 * 1. Receive Agent configuration object
 * 2. Validate that the Agent is installed (by name lookup)
 * 3. Process update according to source and version rules
 * 4. Call profileCacheManager to update the configuration
 *
 * Source and Version update rules:
 * 2.1. If original source is ON-DEVICE
 *      2.1.1. If new source is ON-DEVICE => ignore new version, use original source, auto-increment original version patch
 *      2.1.2. If new source is IN-LIBRARY => new version must not be empty && new version > original version, override with new source and version
 *      2.1.3. If new source is not provided => ignore new version, use original source, auto-increment original version patch
 *
 * 2.2. If original source is IN-LIBRARY
 *      2.2.1. If new source is ON-DEVICE => not allowed to overwrite IN-LIBRARY config with ON-DEVICE config
 *      2.2.2. If new source is IN-LIBRARY => new version must not be empty && new version > original version, override with new source and version
 *      2.2.3. If new source is not provided => must specify new source and new version
 */

import { BuiltinToolDefinition } from './types';
import {
  ChatAgent,
  AgentMcpServer,
  AgentKnowledge,
  ContextEnhancement,
  DEFAULT_CONTEXT_ENHANCEMENT,
  DEFAULT_CHAT_AGENT
} from '../../userDataADO/types/profile';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";
import { mergeAgentMcpServers, mergeAgentSkills } from "../../startupUpdate/startupUpdateService";

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
    /** Agent avatar URL (optional; only for IN-LIBRARY agents, should be empty for ON-DEVICE agents) */
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
    /** Agent version (required when source is IN-LIBRARY) */
    version?: string;
    /** Agent source */
    source?: 'IN-LIBRARY' | 'ON-DEVICE';
    /** 🆕 Remote CDN version (only for IN-LIBRARY; should be empty string for ON-DEVICE) */
    remoteVersion?: string;
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

/**
 * Compare two semantic version numbers
 * @param newVersion new version
 * @param oldVersion original version
 * @returns 1 if newVersion > oldVersion, -1 if newVersion < oldVersion, 0 if equal
 */
function compareVersions(newVersion: string, oldVersion: string): number {
  const parseVersion = (version: string): number[] => {
    const parts = version.split('.');
    return [
      parseInt(parts[0], 10) || 0,
      parseInt(parts[1], 10) || 0,
      parseInt(parts[2], 10) || 0
    ];
  };

  const newParts = parseVersion(newVersion);
  const oldParts = parseVersion(oldVersion);

  for (let i = 0; i < 3; i++) {
    if (newParts[i] > oldParts[i]) return 1;
    if (newParts[i] < oldParts[i]) return -1;
  }

  return 0;
}

/**
 * Check whether the new version is greater than the original version
 * @param newVersion new version
 * @param oldVersion original version
 * @returns true if newVersion > oldVersion
 */
function isVersionGreater(newVersion: string, oldVersion: string): boolean {
  return compareVersions(newVersion, oldVersion) > 0;
}

function normalizeKnowledgeInput(input: AgentKnowledgeInput | undefined, existingAgent: ChatAgent): AgentKnowledge {
  const existingKnowledge = existingAgent.knowledge || {};

  return {
    ...existingKnowledge,
    knowledgeBase: input?.knowledgeBase !== undefined
      ? input.knowledgeBase
      : (existingKnowledge.knowledgeBase ?? existingAgent.knowledge?.knowledgeBase),
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
                description: 'The avatar image URL for the agent (optional, only used for IN-LIBRARY agents, should be empty for ON-DEVICE agents)'
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
                description: 'Agent version (required when source is IN-LIBRARY)'
              },
              source: {
                type: 'string',
                enum: ['IN-LIBRARY', 'ON-DEVICE'],
                description: 'Agent source'
              },
              remoteVersion: {
                type: 'string',
                description: 'Remote CDN version (only for IN-LIBRARY sources, should be empty string for ON-DEVICE)'
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
      const oldSource = existingAgent.source || 'ON-DEVICE';
      const oldVersion = existingAgent.version || '1.0.0';
      const newSource = config.source;
      const newVersion = config.version;

      // Process update according to source and version rules
      let finalSource: 'IN-LIBRARY' | 'ON-DEVICE' = oldSource as 'IN-LIBRARY' | 'ON-DEVICE';
      let finalVersion: string = oldVersion;

      // 2.1. If original source is ON-DEVICE
      if (oldSource === 'ON-DEVICE') {
        if (newSource === 'ON-DEVICE' || newSource === undefined) {
          // 2.1.1 or 2.1.3: ignore new version, use original source, auto-increment original version patch
          finalSource = 'ON-DEVICE';
          finalVersion = incrementPatchVersion(oldVersion);
        } else if (newSource === 'IN-LIBRARY') {
          // 2.1.2: new version must not be empty && new version > original version, override with new source and version
          if (!newVersion || typeof newVersion !== 'string' || !newVersion.trim()) {
            return {
              success: false,
              message: 'When changing source from ON-DEVICE to IN-LIBRARY, version must be provided',
              error: 'VERSION_REQUIRED'
            };
          }
          const trimmedNewVersion = newVersion.trim();
          if (!isVersionGreater(trimmedNewVersion, oldVersion)) {
            return {
              success: false,
              message: `New version (${trimmedNewVersion}) must be greater than old version (${oldVersion}) when updating to IN-LIBRARY`,
              error: 'VERSION_NOT_GREATER'
            };
          }
          finalSource = 'IN-LIBRARY';
          finalVersion = trimmedNewVersion;
        }
      }
      // 2.2. If original source is IN-LIBRARY
      else if (oldSource === 'IN-LIBRARY') {
        if (newSource === 'ON-DEVICE') {
          // 2.2.1: not allowed to overwrite IN-LIBRARY config with ON-DEVICE config
          return {
            success: false,
            message: 'Cannot override IN-LIBRARY configuration with ON-DEVICE configuration. IN-LIBRARY Agents must be updated from the library.',
            error: 'SOURCE_OVERRIDE_NOT_ALLOWED'
          };
        } else if (newSource === 'IN-LIBRARY') {
          // 2.2.2: new version must not be empty && new version > original version, override with new source and version
          if (!newVersion || typeof newVersion !== 'string' || !newVersion.trim()) {
            return {
              success: false,
              message: 'When updating IN-LIBRARY Agent, version must be provided',
              error: 'VERSION_REQUIRED'
            };
          }
          const trimmedNewVersion = newVersion.trim();
          if (!isVersionGreater(trimmedNewVersion, oldVersion)) {
            return {
              success: false,
              message: `New version (${trimmedNewVersion}) must be greater than old version (${oldVersion}) when updating IN-LIBRARY Agent`,
              error: 'VERSION_NOT_GREATER'
            };
          }
          finalSource = 'IN-LIBRARY';
          finalVersion = trimmedNewVersion;
        } else {
          // 2.2.3: if new source is not provided => must specify new source and new version
          return {
            success: false,
            message: 'When updating IN-LIBRARY Agent without specifying source, both source and version must be provided',
            error: 'SOURCE_AND_VERSION_REQUIRED'
          };
        }
      }

      const normalizedKnowledge = normalizeKnowledgeInput({
        ...knowledgeInput,
        knowledgeBase: knowledgeInput?.knowledgeBase ?? config.knowledgeBase,
      }, existingAgent);

      // Build the updated ChatAgent
      // Build mcp_servers array (if new ones are provided)
      // IN-LIBRARY update: merge strategy — keep local tool selection, add remote new servers
      // ON-DEVICE update: full replacement
      let finalMcpServers: AgentMcpServer[] | undefined;
      if (config.mcp_servers !== undefined) {
        const newMcpServers = (config.mcp_servers || []).map(server => ({
          name: server.name,
          tools: Array.isArray(server.tools) ? server.tools : []
        }));
        if (finalSource === 'IN-LIBRARY') {
          // IN-LIBRARY: merge — preserve local tools selections, add new remote servers
          finalMcpServers = mergeAgentMcpServers(existingAgent.mcp_servers || [], newMcpServers);
        } else {
          // ON-DEVICE: complete replacement
          finalMcpServers = newMcpServers;
        }
      }

      // Build skills array
      // IN-LIBRARY update: merge strategy — keep local skills, add remote new skills
      // ON-DEVICE update: full replacement
      let finalSkills: string[] | undefined;
      if (config.skills !== undefined) {
        if (finalSource === 'IN-LIBRARY') {
          // IN-LIBRARY: merge — union of local and remote skills
          finalSkills = mergeAgentSkills(existingAgent.skills || [], config.skills || []);
        } else {
          // ON-DEVICE: complete replacement
          finalSkills = config.skills;
        }
      }

      // Build context_enhancement (if new ones are provided)
      let contextEnhancement: ContextEnhancement | undefined;
      if (config.context_enhancement !== undefined) {
        const existingCE = existingAgent.context_enhancement || DEFAULT_CONTEXT_ENHANCEMENT;
        contextEnhancement = {
          search_memory: {
            enabled: config.context_enhancement?.search_memory?.enabled ?? existingCE.search_memory.enabled,
            semantic_similarity_threshold: config.context_enhancement?.search_memory?.semantic_similarity_threshold ?? existingCE.search_memory.semantic_similarity_threshold,
            semantic_top_n: config.context_enhancement?.search_memory?.semantic_top_n ?? existingCE.search_memory.semantic_top_n
          },
          generate_memory: {
            enabled: config.context_enhancement?.generate_memory?.enabled ?? existingCE.generate_memory.enabled
          }
        };
      }

      // Build agent update object
      const agentUpdates: Partial<ChatAgent> = {
        // Basic attributes: use new value if provided, otherwise keep original
        emoji: config.emoji || existingAgent.emoji,
        avatar: config.avatar !== undefined ? config.avatar : (existingAgent.avatar || ''),
        role: config.role || existingAgent.role,
        // model defers to local: keep local model for IN-LIBRARY, allow remote override for ON-DEVICE
        model: finalSource === 'IN-LIBRARY' ? (existingAgent.model || config.model) : (config.model || existingAgent.model),
        system_prompt: config.system_prompt !== undefined ? config.system_prompt : existingAgent.system_prompt,
        workspace: config.workspace !== undefined ? config.workspace : existingAgent.workspace,
        knowledge: normalizedKnowledge,
        // mcp_servers and skills have already been merged or replaced based on source type
        mcp_servers: finalMcpServers !== undefined ? finalMcpServers : existingAgent.mcp_servers,
        // Use new context_enhancement if provided; otherwise keep original
        context_enhancement: contextEnhancement !== undefined ? contextEnhancement : existingAgent.context_enhancement,
        // skills have already been merged or replaced based on source type
        skills: finalSkills !== undefined ? finalSkills : existingAgent.skills,
        // Version and source use the result after rule processing
        version: finalVersion,
        source: finalSource,
        // 🆕 remoteVersion: use the passed value or keep original for IN-LIBRARY; clear for ON-DEVICE
        remoteVersion: finalSource === 'IN-LIBRARY'
          ? (config.remoteVersion || existingAgent.remoteVersion || '')
          : '',
        // 🆕 zero_states: use new value if provided; otherwise keep original
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
        message: `Successfully updated Agent "${agentName}". Version: ${oldVersion} -> ${finalVersion}, Source: ${oldSource} -> ${finalSource}.`,
        agent_name: agentName,
        chat_id: chatId,
        old_version: oldVersion,
        new_version: finalVersion,
        old_source: oldSource,
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
    if (config.source && !['IN-LIBRARY', 'ON-DEVICE'].includes(config.source)) {
      return { valid: false, error: 'Source must be IN-LIBRARY or ON-DEVICE' };
    }

    return { valid: true };
  }
}
