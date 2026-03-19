// src/main/lib/chat/agentChat.ts
// AgentChat main process version - chat processing customized for Agent instances
import {
  SecurityValidator,
  ApprovalRequestItem,
  BatchValidationResult,
  ToolCallValidationResult
} from '../security/securityValidator';

/**
 * Get electron app, with support for test environment mocking
 */
function getElectronApp() {
  try {
    // Check if there is a global mock in the test environment
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    
    // Try to import electron
    const { app } = require('electron');
    return app;
  } catch (error) {
    // If electron cannot be imported (e.g., in test environment), return null
    return null;
  }
}
import {
  GhcCopilotModel,
  GhcApiSettings,
  GhcModelConfig,
  GhcModelCapabilities,
  OpenAiFunctionTool,
  OpenAiFunctionDef,
  ToolMode
} from '../types/ghcChatTypes';
import { Message, StartChatCallbacks, MessageHelper } from '../types/chatTypes';
import { StreamingChunk } from '../types/streamingTypes';
import { CreateChatSessionParams } from '../types/chatSessionTypes';
import { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { GhcApiError } from '../utilities/errors';
import {
  GITHUB_COPILOT_MODELS,
  getModelById,
  getModelCapabilities,
  getDefaultModel,
  validateModelId,
  getAllKosmosUsedModels
} from '../llm/ghcModels';
import { getEndpointForModel } from '../llm/ghcModelApi';
import { mainAuthManager } from '../auth/authManager';
import { createLogger } from '../unifiedLogger';
import { formatFileSize } from '../utilities/contentUtils';
import { kosmosPlaceholderManager, containsKosmosPlaceholder } from '../userDataADO/kosmosPlaceholders';
import { userInputPlaceholderParser, UserInputField } from '../userDataADO/userInputPlaceholderParser';
import { kosmosMemoryManager } from '../mem0/kosmos-adapters/KosmosMemoryManager';
import { ChatSessionTitleLlmSummarizer } from '../llm/chatSessionTitleLlmSummarizer';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { skillManager } from '../skill/skillManager';
import { getGlobalSystemPromptAsMessages } from './globalSystemPrompt';
import { featureFlagManager } from '../featureFlags';

// 🔥 New: Import CancellationToken related types
import { CancellationToken, CancellationError } from '../cancellation';

//  New: Token counting module import
import {
  createTokenCounter,
  TokenCounter,
  type TokenCounterConfig
} from '../token';

// 🔄 New: Compression module import
import {
  createFullModeCompressor,
  FullModeCompressor,
  type FullModeCompressionConfig,
  type FullModeCompressionResult
} from '../compression/fullModeCompressor';

// 🔄 New: Utility method imports
import {
  normalizeToolCalls,
  checkCompressionNeeds,
  compressContextHistoryWithFullMode,
  applyStorageCompressionToRecentMessages,
  formatMessagesForApi,
  hasImageContentInMessages,
  convertMcpToolsToOpenAiFormat,
  validateToolsRequest,
  determineToolChoice
} from './agentChatUtilities';

const logger = createLogger();

// Agent configuration interface
export interface AgentConfig {
  role: string        // "Default Assistant"
  emoji: string       // "🤖"
  name: string        // "Kosmos"
  model: string       // "gpt-5"
  mcp_servers: Array<{name: string; tools: string[]}>
  system_prompt: string
  context_enhancement?: {
    search_memory: {
      enabled: boolean;
      semantic_similarity_threshold: number;
      semantic_top_n: number;
    };
    generate_memory: {
      enabled: boolean;
    };
  };
}

// Context change notification interface
interface ContextStats {
  totalMessages: number
  contextMessages: number
  tokenCount: number
  compressionRatio: number
}

// 🔥 New: ContextTokenUsage interface for frontend caching
interface ContextTokenUsage {
  tokenCount: number
  totalMessages: number
  contextMessages: number
  compressionRatio: number
}

// 🔥 New: Chat status enum
enum ChatStatus {
  IDLE = 'idle',
  SENDING_RESPONSE = 'sending_response',
  COMPRESSING_CONTEXT = 'compressing_context',
  COMPRESSED_CONTEXT = 'compressed_context',
  RECEIVED_RESPONSE = 'received_response'
}

// AgentChat class - Main process version
export class AgentChat {
  // 🔥 Refactored: Identity information (includes ChatSessionId)
  private currentUserAlias: string
  private chatId: string
  private chatSessionId: string
  
  // Chat session and UI state
  private currentChatSession: ChatSessionFile | null = null
  private contextChangeListeners: ((stats: ContextStats) => void)[] = []
  private latestContextStats: ContextStats | null = null
  
  // 🔥 New: Private contextTokenUsage variable for caching latest context token stats
  private contextTokenUsage: ContextTokenUsage | null = null
  
  // 🔥 New: Cache first user message for deferred title generation
  private firstUserMessage: Message | null = null
  
  // 🔄 Optimized: Removed redundant model cache, fetching directly from ghcModels
  // private availableModels: GhcCopilotModel[] = []  // ❌ Removed
  // private supportedModels: Map<string, GhcCopilotModel> = new Map()  // ❌ Removed
  
  // Event sender
  private eventSender: Electron.WebContents | null = null
  
  // Token counting and compression related properties
  private tokenCounter: TokenCounter
  private fullModeCompressor: FullModeCompressor
  
  // 🔥 New: Message save queue for atomic saving
  private messagesToSave: Message[] = []
  
  // 🔥 New: Private chat status variable
  private chatStatus: ChatStatus = ChatStatus.IDLE
  
  // 🔥 Refactored: Provide two constructor overloads
  constructor(userAlias: string, chatId: string, chatSessionId: string);
  constructor(userAlias: string, chatId: string, chatSessionId: string, chatSessionData: ChatSessionFile);
  constructor(userAlias: string, chatId: string, chatSessionId: string, chatSessionData?: ChatSessionFile) {
    // 🔥 Refactored: Accept identity information and ChatSessionId (must be provided by AgentChatManager)
    this.currentUserAlias = userAlias
    this.chatId = chatId
    this.chatSessionId = chatSessionId
    
    // 🔥 Validation: Throw error if userAlias is empty
    if (!userAlias || userAlias.trim().length === 0) {
      const error = new Error(`Cannot create AgentChat: userAlias is empty or invalid`);
      logger.error('[AgentChat] ❌ CRITICAL: Empty userAlias detected', 'AgentChat.constructor', {
        userAlias,
        chatId,
        chatSessionId,
        error: error.message
      });
      throw error;
    }
    
    // Verify config exists
    const config = this.getLatestAgentConfig()
    if (!config) {
      throw new Error(`Cannot create AgentChat: no config found for userAlias=${userAlias}, chatId=${chatId}`)
    }
    
    // 🔥 Initialize currentChatSession based on whether chatSessionData is provided
    if (chatSessionData) {
      // Case 1: Existing ChatSession data, use directly
      this.currentChatSession = { ...chatSessionData };
      logger.info('[AgentChat] Initialized with existing ChatSession data', 'constructor', {
        userAlias,
        chatId,
        chatSessionId,
        title: chatSessionData.title,
        messagesCount: chatSessionData.chat_history?.length || 0
      });
    } else {
      // Case 2: New ChatSession, create an empty ChatSession
      this.createChatSession({ chatSession_id: chatSessionId });
      logger.info('[AgentChat] Created new ChatSession', 'constructor', {
        userAlias,
        chatId,
        chatSessionId
      });
    }
    
    // Initialize token counter and compressor
    this.tokenCounter = createTokenCounter({
      defaultEncoding: 'cl100k_base',
      enableCache: true,
      cacheSize: 10000
    });
    
    // Initialize compressor (using default settings)
    this.fullModeCompressor = createFullModeCompressor();
    
    // 🔥 New: Calculate and notify initial context state at end of constructor
    // Note: This is a synchronous call, but calculateAndNotifyContext is async internally
    // We don't await, letting it execute in the background
    this.calculateAndNotifyContext().catch(error => {
      logger.error('[AgentChat] Failed to calculate initial context in constructor', 'constructor', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.getAgentName()
      });
    });
  }
  
  
  /**
   * 🔥 Helper method: Get agent name (for logging)
   */
  private getAgentName(): string {
    const config = this.getLatestAgentConfig();
    return config?.name || 'Unknown Agent';
  }
  
  /**
   * 🔥 Modified: Set chat status and sync to frontend - sends for all ChatSessions
   */
  private setChatStatus(status: ChatStatus): void {
    this.chatStatus = status;

    // Send ChatStatus to frontend without filtering
    if (this.eventSender) {
      this.eventSender.send('agentChat:chatStatusChanged', {
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        chatStatus: status,
        agentName: this.getAgentName(),
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * 🔥 New: Get current chat status
   */
  public getChatStatus(): ChatStatus {
    return this.chatStatus;
  }
  
  /**
   * 🔥 New: Get chat status info (includes chatId)
   */
  public getChatStatusInfo(): { chatId: string; chatStatus: ChatStatus; agentName: string } {
    return {
      chatId: this.chatId,
      chatStatus: this.chatStatus,
      agentName: this.getAgentName()
    };
  }
  
  /**
   * 🔥 Modified: Unified event sending method - removed filtering, all events are sent
   */
  private safeEmitEvent(eventName: string, data: any): void {
    if (!this.eventSender) {
      return; // No event sender, return directly
    }
    
    // Ensure data includes chatSessionId
    const eventData = {
      ...data,
      chatSessionId: data.chatSessionId || this.chatSessionId
    };
    
    // Send event without filtering
    this.eventSender.send(eventName, eventData);
  }
  
  /**
   * 🔄 New: Dynamically get the latest Agent configuration
   * Fetches from ProfileCacheManager via currentUserAlias and chatId
   */
  private getLatestAgentConfig(): AgentConfig | null {
    if (!this.currentUserAlias || !this.chatId) {
      return null;
    }
    
    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
    if (!chatConfig || !chatConfig.agent) {
      return null;
    }
    
    return {
      role: chatConfig.agent.role,
      emoji: chatConfig.agent.emoji,
      name: chatConfig.agent.name,
      model: chatConfig.agent.model,
      mcp_servers: chatConfig.agent.mcp_servers || [],
      system_prompt: chatConfig.agent.system_prompt || '',
      context_enhancement: chatConfig.agent.context_enhancement
    };
  }
  
  /**
   * Initialize Agent instance
   */
  async initialize(): Promise<void> {
    
    try {
      // 🔄 Optimized: No longer need to load model list into local cache
      // this.loadSupportedModels()  // ❌ Removed
      
      
      this.calculateAndNotifyContext()
      
    } catch (error) {
      logger.error(`[AgentChat] Failed to initialize agent ${this.getAgentName()}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Get Chat ID
   */
  getChatId(): string {
    return this.chatId;
  }
  
  
  /**
   * Get User Alias
   */
  getUserAlias(): string {
    return this.currentUserAlias;
  }
  
  /**
   * 🔄 New: Dynamically get current model ID
   */
  private getCurrentModelId(): string {
    const config = this.getLatestAgentConfig();
    return config?.model || getDefaultModel();
  }
  
  /**
   * 🔥 Refactored: Dynamically get current available tools (no longer cached)
   * Fetches the latest connected tools from MCP manager and ProfileCacheManager on each call
   */
  private async getCurrentAvailableTools(): Promise<any[]> {
    try {
      // Dynamically get the latest configuration
      const latestConfig = this.getLatestAgentConfig();
      if (!latestConfig) {
        logger.warn(`[AgentChat] Cannot get tools: no agent config available`);
        return [];
      }
      
      const { mcpClientManager } = await import('../mcpRuntime/mcpClientManager');
      
      const allTools = await mcpClientManager.getAllTools();
      
      // Get global mcp_servers configuration (includes in_use flag)
      let globalMcpServers: Array<{name: string; in_use: boolean}> = [];
      if (this.currentUserAlias) {
        const profile = profileCacheManager.getCachedProfile(this.currentUserAlias);
        globalMcpServers = profile?.mcp_servers || [];
      }
      
      // Filter tools based on agent's mcp_servers configuration
      if (latestConfig.mcp_servers.length > 0) {
        const filteredTools: any[] = [];
        
        for (const serverConfig of latestConfig.mcp_servers) {
          const serverName = serverConfig.name;
          const selectedTools = serverConfig.tools || [];
          
          // 🔥 Key fix: Check the in_use status of this server in global configuration
          const globalServer = globalMcpServers.find(s => s.name === serverName);
          if (globalServer && globalServer.in_use === false) {
            continue;
          }
          
          // Get all tools for this server
          const serverTools = allTools.filter(tool => tool.serverName === serverName);
          
          // If tools array is empty, select all tools for this server
          if (selectedTools.length === 0) {
            filteredTools.push(...serverTools);
          } else {
            // Otherwise only select the specified tools
            const specificTools = serverTools.filter(tool =>
              selectedTools.includes(tool.name)
            );
            filteredTools.push(...specificTools);
          }
        }
        
        return filteredTools;
      }
      
      return allTools;
    } catch (error) {
      logger.error(`[AgentChat] Failed to get current available tools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * 🔄 New: Get the latest Custom System Prompt (from AgentConfig)
   * @returns {Message[]} system-prompt array (array with single element)
   */
  private getLatestCustomSystemPrompt(): Message[] {
    const config = this.getLatestAgentConfig();
    
    if (!config || !config.system_prompt) {
      return [];
    }
    
    const systemMessage: Message = MessageHelper.createTextMessage(
      config.system_prompt,
      'system',
      `system-${config.name}-${config.role}`
    );
    
    return [systemMessage];
  }
  
  /**
   * 🔄 New: Get Global System Prompt (from globalSystemPrompt.ts)
   * @returns {Message[]} system-prompt array (array with single element)
   */
  private getGlobalSystemPrompt(): Message[] {
    return getGlobalSystemPromptAsMessages();
  }
  
  /**
   * 🔄 New: Get Agent Specific System Prompt (includes agent identity, workspace info, and skills instructions)
   * @returns {Message[]} agent-specific system-prompt array (array with single element)
   */
  private getAgentSpecificSystemPrompt(): Message[] {
    let agentIdentityInfo = '';
    let workspaceInfo = '';
    let skillsInfo = '';
    
    // 🔥 New: Agent Identity - tell the AI its name
    const agentName = this.getAgentName();
    agentIdentityInfo = `\n---\n**Your Identity:**\n- You are **${agentName}**, an AI assistant.\n- When users ask about "${agentName}" or refer to "you", they are asking about you as ${agentName}.\n- Your Knowledge Base files are part of your pre-configured knowledge. When users ask questions related to "${agentName}", reference your Knowledge Base files as relevant information.\n---`;
    
    try {
      // Get current Chat's workspace from ProfileCacheManager
      const { profileCacheManager } = require('../userDataADO/profileCacheManager');
      
      if (this.currentUserAlias) {
        // Use ProfileCacheManager's public method to get all chats
        const allChats = profileCacheManager.getAllChatConfigs(this.currentUserAlias);
        
        // Find the chat configuration for the current agent
        const currentChat = allChats.find((chat: any) =>
          chat.agent?.name === this.getAgentName()
        );
        
        {
          // === Knowledge Base ===
          const knowledgeBasePath = currentChat?.agent?.knowledgeBase;
          const hasKnowledgeBase = knowledgeBasePath && typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim().length > 0;

          // === Current Chat Session Deliverables Directory ===
          const workspacePath = currentChat?.agent?.workspace;
          const hasWorkspace = workspacePath && typeof workspacePath === 'string' && workspacePath.trim().length > 0;
          let chatSessionFilesPath = '';
          if (hasWorkspace && this.chatSessionId) {
            // Extract YYYYMM from chatSessionId, format: chatSession_YYYYMMDDHHmmss
            const match = this.chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
            if (match) {
              const yearMonth = `${match[1]}${match[2]}`;
              // 🔥 Fix: Use path separator consistent with workspace path (\\ on Windows)
              const sep = workspacePath.includes('\\') ? '\\' : '/';
              chatSessionFilesPath = `${workspacePath}${sep}${yearMonth}${sep}${this.chatSessionId}`;
            }
          }
          const hasChatSessionFiles = chatSessionFilesPath.length > 0;

          if (hasKnowledgeBase || hasChatSessionFiles) {
            const sections: string[] = [];
            sections.push('\n---');

            // Knowledge Base section
            if (hasKnowledgeBase) {
              sections.push(`\n**Your Knowledge Base:** \`${knowledgeBasePath}\``);
              sections.push(`- Path schema: \`@knowledge-base:{relative_path}\` → \`${knowledgeBasePath}/{relative_path}\``);
            }

            // Current Chat Session Deliverables Directory section
            if (hasChatSessionFiles) {
              sections.push(`\n**Your Current Chat Session Deliverables Directory:** \`${chatSessionFilesPath}\``);
              sections.push(`- Path schema: \`@chat-session:{relative_path}\` → \`${chatSessionFilesPath}/{relative_path}\``);
            }

            // Command Execution cwd
            const primaryCwd = hasChatSessionFiles ? chatSessionFilesPath : (hasKnowledgeBase ? knowledgeBasePath : '');
            sections.push(`\n**Command Execution:**`);
            sections.push(`- Your working directory is \`${primaryCwd}\`. Pass the correct 'cwd' parameter when using execute_command.`);
            sections.push(`- To run commands outside this directory, prepend \`cd {target_dir} &&\` before the command.`);

            sections.push('\n---');
            workspaceInfo = sections.join('\n');
          } else {
            // No directory configuration
            workspaceInfo = `\n---\n**Your Knowledge Base:** (NOT SET)\n**Your Current Chat Session Deliverables Directory:** (NOT SET)\n\nNo directories are configured. Inform the user to configure them before attempting file or command operations.\n---`;
          }

          // 🔥 New: Scan the .claude/skills directory under the knowledgeBase path (filesystem skill registration)
          if (hasKnowledgeBase) {
            try {
              const fs = require('fs');
              const path = require('path');
              const claudeSkillsDir = path.join(knowledgeBasePath, '.claude', 'skills');

              if (fs.existsSync(claudeSkillsDir)) {
                const entries: any[] = fs.readdirSync(claudeSkillsDir, { withFileTypes: true });
                const skillDirs = entries.filter((e: any) => e.isDirectory());

                if (skillDirs.length > 0) {
                  const fsSkillsSections: string[] = [];
                  fsSkillsSections.push('\n---');
                  fsSkillsSections.push(`\n**Knowledge Base Skills** (${skillDirs.length} skills found in \`${claudeSkillsDir}\`):`);
                  fsSkillsSections.push('\nThese skills are pre-configured in your Knowledge Base directory. When a task is relevant to a skill, use `read_file` to load its `SKILL.md` for detailed instructions before proceeding.\n');

                  for (let i = 0; i < skillDirs.length; i++) {
                    const skillDir = skillDirs[i];
                    const skillDirPath = path.join(claudeSkillsDir, skillDir.name);
                    const skillMdPath = path.join(skillDirPath, 'SKILL.md');
                    const hasSkillMd = fs.existsSync(skillMdPath);

                    // Use standard skillManager to parse YAML frontmatter metadata
                    let description = 'No description available';
                    let version = 'N/A';
                    if (hasSkillMd) {
                      const { metadata } = skillManager.getSkillMetadata(skillDirPath);
                      if (metadata) {
                        description = metadata.description || description;
                        version = metadata.version || version;
                      }
                    }

                    fsSkillsSections.push(`${i + 1}. **${skillDir.name}**`);
                    fsSkillsSections.push(`   - Description: ${description}`);
                    fsSkillsSections.push(`   - Version: ${version}`);
                    fsSkillsSections.push(`   - File Path: \`${hasSkillMd ? skillMdPath : skillDirPath}\``);
                    fsSkillsSections.push('');
                  }

                  fsSkillsSections.push('\n---');
                  skillsInfo = fsSkillsSections.join('\n') + skillsInfo;
                }
              }
            } catch (fsErr) {
              logger.warn('[AgentChat] 📂 Failed to scan .claude/skills directory', 'getAgentSpecificSystemPrompt', fsErr);
            }
          }
        }
        
        // 🔥 New: Get and inject Skills Instructions
        if (currentChat?.agent?.skills && Array.isArray(currentChat.agent.skills) && currentChat.agent.skills.length > 0) {
          // Get all skills configured in the Profile
          const profile = profileCacheManager.getCachedProfile(this.currentUserAlias);
          const availableSkills = profile?.skills || [];
          
          // Build skills instructions
          const skillsSections: string[] = [];
          
          skillsSections.push('\n---\n**Skills Instructions:**\n');
          skillsSections.push('\n**What are Skills?**');
          skillsSections.push('Skills are specialized capabilities that extend your abilities for specific tasks. Each skill contains instructions, scripts, and resources to help you complete tasks in a consistent, repeatable way.\n');
          
          skillsSections.push('\n**How to Use Skills:**');
          skillsSections.push('1. **Progressive Disclosure:** Skills information is loaded dynamically - you receive skill metadata first, then full instructions when relevant');
          skillsSections.push('2. **Skill Selection:** Review available skills and load the ones relevant to the current task');
          skillsSections.push('3. **Follow Instructions:** Each skill provides specific workflows and best practices - follow them carefully');
          skillsSections.push('4. **Combine Skills:** You can use multiple skills together to accomplish complex tasks');
          skillsSections.push('5. **Executable Scripts:** Some skills include code that you can run directly without loading into context\n');
          
          skillsSections.push('\n**Available Skills for This Agent:**\n');
          
          // Iterate through agent's configured skills
          const agentSkillNames = currentChat.agent.skills;
          let foundSkills = 0;
          
          for (const skillName of agentSkillNames) {
            // Find the corresponding skill config in profile.skills
            const skillConfig = availableSkills.find((s: any) => s.name === skillName);
            
            if (skillConfig) {
              foundSkills++;
              // Build the skill.md path
              const electronApp = getElectronApp();
              if (electronApp) {
                const appPath = electronApp.getPath('userData');
                const skillPath = `${appPath}/profiles/${this.currentUserAlias}/skills/${skillConfig.name}/skill.md`;
                
                skillsSections.push(`${foundSkills}. **${skillConfig.name}**`);
                skillsSections.push(`   - Description: ${skillConfig.description || 'No description available'}`);
                skillsSections.push(`   - Version: ${skillConfig.version || 'N/A'}`);
                skillsSections.push(`   - File Path: \`${skillPath}\``);
                skillsSections.push('');
              }
            }
          }
          
          if (foundSkills === 0) {
            skillsSections.push('No valid skills configured for this agent.');
          }
          
          skillsSections.push('\n**Best Practices:**');
          skillsSections.push('- Load skills only when they\'re relevant to the current task');
          skillsSections.push('- Follow the specific instructions and workflows in each skill');
          skillsSections.push('- Use skill-provided scripts for deterministic operations');
          skillsSections.push('- Combine multiple skills when needed for complex workflows');
          skillsSections.push('- Always check skill metadata first before loading full content\n');
          
          skillsSections.push('---');
          
          skillsInfo = skillsSections.join('\n');
        }
      }
    } catch (err) {
      logger.warn('[AgentChat] 📂 WORKSPACE CONTEXT - Failed to add workspace to agent-specific system prompt', 'getAgentSpecificSystemPrompt', err);
      workspaceInfo = `\n---\n**Current Workspace:** (ERROR)\n\n⚠️ **Operating Rules:**\n\n**1. Configuration Error:**\n- Failed to retrieve workspace configuration\n- Please inform the user about this error\n---`;
    }
    
    // Merge agent identity, workspace, and skills information
    const combinedInfo = agentIdentityInfo + workspaceInfo + skillsInfo;
    
    // If no agent-specific information exists, return empty array
    if (!combinedInfo) {
      return [];
    }
    
    const agentSpecificMessage: Message = MessageHelper.createTextMessage(
      combinedInfo,
      'system',
      `system-agent-specific-${this.getAgentName()}`
    );
    
    return [agentSpecificMessage];
  }
  
  /**
   * 🔄 New: Merge Custom, Agent-Specific, and Global System Prompts
   * @returns {Message[]} merged system-prompt array (array with single element)
   */
  private getCombinedSystemPromptForContext(): Message[] {
    const customPrompts = this.getLatestCustomSystemPrompt();
    const agentSpecificPrompts = this.getAgentSpecificSystemPrompt();
    const globalPrompts = this.getGlobalSystemPrompt();
    
    // Collect all non-empty prompt texts
    const texts: string[] = [];
    
    if (customPrompts.length > 0) {
      texts.push(MessageHelper.getText(customPrompts[0]));
    }
    
    if (agentSpecificPrompts.length > 0) {
      texts.push(MessageHelper.getText(agentSpecificPrompts[0]));
    }
    
    if (globalPrompts.length > 0) {
      texts.push(MessageHelper.getText(globalPrompts[0]));
    }
    
    // If no prompts exist, return empty array
    if (texts.length === 0) {
      return [];
    }
    
    // Merge all prompts: Custom + Agent-Specific + Global
    const combinedText = texts.join('\n\n---\n\n');
    
    const combinedMessage: Message = MessageHelper.createTextMessage(
      combinedText,
      'system',
      `system-combined-${this.getAgentName()}`
    );
    
    return [combinedMessage];
  }
  
  
  
  // ====== ChatSession Management Methods ======
  
  /**
   * 🔄 Fix: Save ChatSession to persistent storage
   * Uses instance's own chatId, no longer needs parameter passing
   */
  async saveChatSession(): Promise<{success: boolean; error?: string}> {
    if (!this.currentChatSession) {
      return { success: false, error: 'No current ChatSession' };
    }
    
    if (!this.currentUserAlias) {
      logger.error('[AgentChat] No user alias set, cannot save ChatSession', 'saveChatSession', {
        agentName: this.getAgentName(),
        sessionId: this.currentChatSession.chatSession_id
      });
      return { success: false, error: 'No user alias set' };
    }
    
    if (!this.chatId) {
      logger.error('[AgentChat] No chat ID set, cannot save ChatSession', 'saveChatSession', {
        agentName: this.getAgentName(),
        sessionId: this.currentChatSession.chatSession_id,
        hint: 'Make sure setChatId() is called when creating the AgentChat instance'
      });
      return { success: false, error: 'No chat ID set' };
    }
    
    // 🔥 Optimization: If there is a cached first user message and the title is still "New Chat",
    // save immediately with a temporary title, then asynchronously generate the real title
    if (this.firstUserMessage && this.currentChatSession.title === "New Chat") {
      
      // 1. Immediately use a temporary title (timestamp-based)
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      this.currentChatSession.title = `Chat ${timeStr}`;
      
      // 2. Asynchronously generate the real title (non-blocking save)
      const cachedUserMessage = this.firstUserMessage;
      this.firstUserMessage = null; // Clear cache to avoid duplicate generation
      
      // Asynchronously execute title generation without awaiting result
      this.generateChatSessionTitle(cachedUserMessage).then(() => {
        // After title generation succeeds, save again to update the title
        this.saveChatSession().catch(error => {
          logger.error('[AgentChat] Failed to save after title generation', 'saveChatSession', {
            agentName: this.getAgentName(),
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }).catch(error => {
        logger.error('[AgentChat] Async title generation failed', 'saveChatSession', {
          agentName: this.getAgentName(),
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    
    try {
      
      // 🔥 Key fix: Use the correct ProfileCacheManager flow
      const { profileCacheManager } = require('../userDataADO/profileCacheManager');
      
      // 1. Check if the session already exists
      const sessionMetadata = {
        chatSession_id: this.currentChatSession.chatSession_id,
        last_updated: new Date().toISOString(),
        title: this.currentChatSession.title
      };
      
      // Update ChatSession timestamp
      this.currentChatSession.last_updated = sessionMetadata.last_updated;
      
      const exists = await profileCacheManager.existChatSession(
        this.currentUserAlias,
        this.chatId,
        sessionMetadata
      );
      
      let success: boolean;
      if (exists) {
        // 2a. Update existing session
        
        success = await profileCacheManager.updateChatSession(
          this.currentUserAlias,
          this.chatId,
          this.currentChatSession.chatSession_id,
          sessionMetadata,
          this.currentChatSession
        );
      } else {
        // 2b. Add new session
        
        success = await profileCacheManager.addChatSession(
          this.currentUserAlias,
          this.chatId,
          sessionMetadata,
          this.currentChatSession
        );
      }
      
      if (!success) {
        logger.error('[AgentChat] Failed to save ChatSession via ProfileCacheManager', 'saveChatSession', {
          userAlias: this.currentUserAlias,
          chatId: this.chatId,
          sessionId: this.currentChatSession.chatSession_id,
          isUpdate: exists
        });
        return {
          success: false,
          error: `Failed to save ChatSession`
        };
      }
      
      
      // 🔥 Refactored: Fact extraction moved to standalone method extractFactsFromConversation()
      // No longer executed here, called separately after conversation turn ends
      
      // 📝 Note: ProfileCacheManager's addChatSession/updateChatSession methods
      // already automatically notify the frontend and update profile.json, no additional operations needed
      
      return { success: true };
      
    } catch (error) {
      logger.error('[AgentChat] ❌ Exception in saveChatSession', 'saveChatSession', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agentName: this.getAgentName(),
        sessionId: this.currentChatSession.chatSession_id
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  getSystemMessages(): Message[] {
    return this.getCombinedSystemPromptForContext()
  }

  getCurrentChatSession(): ChatSessionFile | null {
    return this.currentChatSession
  }

  private createChatSession(params: CreateChatSessionParams = {}): void {
    // 🔥 Fix: ChatSessionId must be provided by parameters, no longer auto-generated
    if (!params.chatSession_id) {
      throw new Error('chatSession_id must be provided by AgentChatManager')
    }
    const sessionId = params.chatSession_id
    const title = params.title || "New Chat"
    
    // 🔥 Modified: Directly initialize this.currentChatSession, no return value
    this.currentChatSession = {
      chatSession_id: sessionId,
      title: title,
      last_updated: new Date().toISOString(),
      chat_history: params.initialMessage ? [params.initialMessage] : [],
      context_history: params.initialMessage ? [params.initialMessage] : []
    }
  }

  
  /**
   * 🔥 New: Get ChatSessionId (public method)
   */
  getChatSessionId(): string {
    return this.chatSessionId;
  }


  initializeEmptyChatSession(): void {
    this.currentChatSession = null
    this.firstUserMessage = null  // 🔥 Clear cached first message
  }

  addMessageToChatHistory(message: Message): void {
    // 🔥 Note: currentChatSession creation has been moved to AddMessageToSession
    if (!this.currentChatSession) {
      throw new Error('currentChatSession must be initialized before calling addMessageToChatHistory. Use AddMessageToSession instead.');
    }
    
    this.currentChatSession.chat_history.push(message)
    this.currentChatSession.last_updated = new Date().toISOString()
  }

  /**
   * 🔄 New: Generate title for ChatSession
   */
  private async generateChatSessionTitle(userMessage: Message): Promise<void> {
    if (!this.currentChatSession) {
      logger.warn('[AgentChat] No current ChatSession for title generation', 'AgentChat.generateChatSessionTitle', {
        agentName: this.getAgentName()
      });
      return
    }


    try {
      // Extract text content from user message
      const userMessageText = MessageHelper.getText(userMessage)
      
      if (!userMessageText || userMessageText.trim().length === 0) {
        logger.warn('[AgentChat] User message has no text content, skipping title generation', 'AgentChat.generateChatSessionTitle', {
          agentName: this.getAgentName()
        });
        return
      }


      // Call LLM to generate title - direct call from main process
      const titleResponse = await ChatSessionTitleLlmSummarizer.generateTitle(userMessageText)

      if (titleResponse?.success && titleResponse.title) {
        const newTitle = titleResponse.title.trim()
        

        // Update ChatSession title
        this.currentChatSession.title = newTitle
        this.currentChatSession.last_updated = new Date().toISOString()

      } else {
        logger.warn('[AgentChat] Title generation failed or returned no title', 'AgentChat.generateChatSessionTitle', {
          agentName: this.getAgentName(),
          sessionId: this.currentChatSession.chatSession_id,
          success: titleResponse?.success,
          hasTitle: !!titleResponse?.title,
          errors: titleResponse?.errors,
          warnings: titleResponse?.warnings
        });

        // If LLM generation failed, use a simple fallback title
        const fallbackTitle = this.generateFallbackTitle(userMessageText)
        this.currentChatSession.title = fallbackTitle
        this.currentChatSession.last_updated = new Date().toISOString()

      }
    } catch (error) {
      logger.error('[AgentChat] Exception during title generation', 'AgentChat.generateChatSessionTitle', {
        agentName: this.getAgentName(),
        sessionId: this.currentChatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Use a simple fallback title in case of exception
      try {
        const userMessageText = MessageHelper.getText(userMessage)
        const fallbackTitle = this.generateFallbackTitle(userMessageText)
        this.currentChatSession.title = fallbackTitle
        this.currentChatSession.last_updated = new Date().toISOString()

      } catch (recoveryError) {
        logger.error('[AgentChat] Failed to apply fallback title after exception', 'AgentChat.generateChatSessionTitle', {
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        });
      }
    }
  }

  /**
   * 🔄 New: Generate fallback title
   */
  private generateFallbackTitle(userMessageText: string): string {
    const trimmedMessage = userMessageText.trim()
    
    // Extract the first few words as the title
    const words = trimmedMessage.split(/\s+/).slice(0, 4)
    let fallbackTitle = words.join(' ')
    
    // Truncate if too long
    if (fallbackTitle.length > 50) {
      fallbackTitle = fallbackTitle.substring(0, 47) + '...'
    }
    
    // If too short or generic, use a timestamp title
    if (fallbackTitle.length < 5) {
      const now = new Date()
      const timeStr = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
      fallbackTitle = `Chat ${timeStr}`
    }
    
    return fallbackTitle
  }
  
  /**
   * 🔥 New: AddMessageToSession - Unified message adding and saving method
   * Handles adding messages to Chat History and Context History, and implements atomic saving strategy
   */
  private async AddMessageToSession(message: Message): Promise<void> {
    // 🔥 Constructor ensures currentChatSession exists, no need to check creation
    
    // 🔥 Check if this is the first message (for title generation)
    const isFirstMessage = this.currentChatSession!.chat_history.length === 0;
    
    // 🔥 Check if this is the first user message (for exiting New Chat Session state)
    const isFirstUserMessage = isFirstMessage && message.role === 'user';
    
    // 1. Add to Chat History
    this.addMessageToChatHistory(message);
    
    // 2. Add to Context History
    await this.addMessageToContext(message);
    
    // 3. 🔥 Cache first user message for deferred title generation
    if (isFirstMessage && message.role === 'user' && !this.firstUserMessage) {
      this.firstUserMessage = message;
    }
    
    // 4. Add to save queue
    this.messagesToSave.push(message);
    
    // 5. Validate queue length
    if (this.messagesToSave.length > 2) {
      logger.error('[AgentChat] ❌ CRITICAL ERROR: messagesToSave exceeded limit', 'AddMessageToSession', {
        messagesToSaveLength: this.messagesToSave.length,
        messages: this.messagesToSave.map(m => ({
          id: m.id,
          role: m.role,
          hasToolCalls: !!(m.role === 'assistant' && m.tool_calls)
        }))
      });
      throw new Error('MessageToSave only allow a single message or a pair of <Assistant message with Tool call, Tool message>');
    }
    
    // 6. Determine if immediate save is needed
    const isAssistantWithToolCall = message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0;
    
    if (!isAssistantWithToolCall) {
      // Not an assistant message with tool call, save asynchronously (non-blocking)
      
      // Async save, don't wait for result
      this.saveChatSession().then((result) => {
        // 🔥 Exit mechanism: After the first user message is saved successfully, notify AgentChatManager to exit New Chat Session state
        if (result.success && isFirstUserMessage) {
          this.exitNewChatSessionState();
        }
      }).catch(error => {
        logger.error('[AgentChat] ❌ Async save failed', 'AddMessageToSession', {
          error: error instanceof Error ? error.message : String(error),
          agentName: this.getAgentName()
        });
      });
      
      // Clear queue
      this.messagesToSave = [];
    } else {
      // Is an assistant message with tool call, wait for next tool message
    }
  }
  
  
  /**
   * 🔥 New: Standalone Fact Extraction method
   * Extracted from saveChatSession, called separately after conversation turn ends
   */
  private async extractFactsFromConversation(): Promise<void> {
    try {
      // 🔥 Check if Memory feature is enabled via Feature Flag (Dev environment and non-Windows ARM)
      const isMemoryFeatureEnabled = featureFlagManager.isEnabled('kosmosFeatureMemory');
      
      if (!isMemoryFeatureEnabled) {
        logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Disabled by feature flag', 'extractFactsFromConversation', {
          agentName: this.getAgentName(),
          featureFlag: 'kosmosFeatureMemory',
          platform: process.platform,
          arch: process.arch,
          environment: process.env.NODE_ENV || 'production'
        });
        return;
      }
      
      // 🔥 Fix: Check agent config's memory generation settings
      const agentConfig = this.getLatestAgentConfig();
      const isMemoryGenerationEnabled = agentConfig?.context_enhancement?.generate_memory?.enabled || false;
      
      logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Checking configuration', 'extractFactsFromConversation', {
        agentName: this.getAgentName(),
        isMemoryFeatureEnabled,
        isMemoryGenerationEnabled,
        contextEnhancementConfig: agentConfig?.context_enhancement,
        userAlias: this.currentUserAlias
      });
      
      if (!isMemoryGenerationEnabled) {
        logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Disabled in agent config, skipping fact extraction', 'extractFactsFromConversation', {
          agentName: this.getAgentName()
        });
        return;
      }
      
      if (!this.currentUserAlias) {
        logger.warn('[AgentChat] 🧠 Fact extraction skipped - no user alias', 'extractFactsFromConversation');
        return;
      }
      
      if (!this.currentChatSession) {
        logger.warn('[AgentChat] 🧠 Fact extraction skipped - no chat session', 'extractFactsFromConversation');
        return;
      }
      
      
      const chatHistory = this.currentChatSession.chat_history;
      
      // Search backwards to find the most recent user message
      let lastUserMessage: Message | null = null;
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].role === 'user') {
          lastUserMessage = chatHistory[i];
          break;
        }
      }
      
      if (!lastUserMessage) {
        return;
      }
      
      // Build user message text for fact extraction (only extract current turn's user message, excluding assistant reply)
      let userMessageText = '';
      try {
        if (Array.isArray(lastUserMessage.content)) {
          userMessageText = MessageHelper.getText(lastUserMessage);
        } else if (typeof lastUserMessage.content === 'string') {
          userMessageText = lastUserMessage.content;
        } else if (lastUserMessage.content && typeof lastUserMessage.content === 'object') {
          userMessageText = JSON.stringify(lastUserMessage.content);
        }
      } catch (error) {
        logger.error('[AgentChat] Failed to extract text from user message', 'extractFactsFromConversation', {
          messageId: lastUserMessage.id,
          error: error instanceof Error ? error.message : String(error)
        });
        userMessageText = '[Content extraction failed]';
      }
      
      const conversationText = userMessageText;
      
      
      // Call memory manager to store the conversation
      logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Initializing memory manager', 'extractFactsFromConversation', {
        userAlias: this.currentUserAlias,
        agentName: this.getAgentName(),
        sessionId: this.currentChatSession.chatSession_id
      });
      
      const memory = await kosmosMemoryManager.initializeForUser(this.currentUserAlias);
      
      logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Calling memory.add()', 'extractFactsFromConversation', {
        userAlias: this.currentUserAlias,
        userMessageTextLength: conversationText.length,
        userMessageTextPreview: conversationText.substring(0, 200) + (conversationText.length > 200 ? '...' : ''),
        metadata: {
          source: 'chat_conversation',
          agentName: this.getAgentName(),
          sessionId: this.currentChatSession.chatSession_id,
          extractFacts: true
        }
      });
      
      const addResult = await memory.add(conversationText, {
        userId: this.currentUserAlias,
        metadata: {
          source: 'chat_conversation',
          timestamp: Date.now(),
          agentName: this.getAgentName(),
          sessionId: this.currentChatSession.chatSession_id,
          extractFacts: true
        }
      });
      
      logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - memory.add() completed', 'extractFactsFromConversation', {
        userAlias: this.currentUserAlias,
        hasResults: !!(addResult.results && addResult.results.length > 0),
        resultsCount: addResult.results?.length || 0,
        addResult: JSON.stringify(addResult).substring(0, 500)
      });
      
      if (addResult.results && addResult.results.length > 0) {
        logger.debug('[AgentChat] 🧠 GENERATE_MEMORY - Facts extracted successfully', 'extractFactsFromConversation', {
          userAlias: this.currentUserAlias,
          extractedFactsCount: addResult.results.length,
          facts: addResult.results.map((r: any) => r.memory || r.text || JSON.stringify(r).substring(0, 100))
        });
      } else {
        logger.warn('[AgentChat] ⚠️ Fact extraction returned no results', 'extractFactsFromConversation', {
          userAlias: this.currentUserAlias,
          addResultKeys: Object.keys(addResult || {})
        });
      }
      
    } catch (error) {
      logger.error('[AgentChat] ❌ Fact extraction failed', 'extractFactsFromConversation', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agentName: this.getAgentName()
      });
    }
  }

  async addMessageToContext(message: Message): Promise<void> {
    // 🔥 Constructor ensures currentChatSession exists, no need to check creation
    
    // Main process version: simplified context enhancement (does not include memory queries and other features requiring IPC)
    let enhancedMessage = message;
    if (message.role === 'user') {
      enhancedMessage = await this.enhanceUserMessageContext(message);
    }
    
    // 🔄 Optimized: Add message to ContextHistory first
    this.currentChatSession!.context_history.push(enhancedMessage)
    this.currentChatSession!.last_updated = new Date().toISOString()
    
    this.calculateAndNotifyContext()
  }

  private async enhanceUserMessageContext(message: Message): Promise<Message> {
    // 🔥 Diagnostic log: Record method entry
    
    const enhancedMessage = { ...message };
    const originalContent = MessageHelper.getText(message);
    
    // 🔥 Removed: No longer adding Current time to user message
    // Current time should be obtained by the LLM via the built-in tool get_current_datetime when needed
    
    // 🔥 Check if Memory feature is enabled via Feature Flag (Dev environment and non-Windows ARM)
    const isMemoryFeatureEnabled = featureFlagManager.isEnabled('kosmosFeatureMemory');
    
    if (!isMemoryFeatureEnabled) {
      logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Disabled by feature flag', 'enhanceUserMessageContext', {
        messageId: message.id,
        agentName: this.getAgentName(),
        featureFlag: 'kosmosFeatureMemory',
        platform: process.platform,
        arch: process.arch,
        environment: process.env.NODE_ENV || 'production'
      });
      // Return the original message directly, no memory enhancement
      return enhancedMessage;
    }
    
    // 1. Get agent's memory configuration
    const agentConfig = this.getLatestAgentConfig();
    const memoryConfig = agentConfig?.context_enhancement?.search_memory;
    
    // 🔥 Fix: Use agent config's memory settings
    const isMemorySearchEnabled = memoryConfig?.enabled || false;
    const semanticSimilarityThreshold = memoryConfig?.semantic_similarity_threshold || 0.0;
    const semanticTopN = memoryConfig?.semantic_top_n || 5;
    
    logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Configuration', 'enhanceUserMessageContext', {
      messageId: message.id,
      agentName: this.getAgentName(),
      userAlias: this.currentUserAlias,
      isMemoryFeatureEnabled,
      isMemorySearchEnabled,
      semanticSimilarityThreshold,
      semanticTopN,
      memoryConfig,
      originalContentLength: originalContent.length,
      originalContentPreview: originalContent.substring(0, 100) + (originalContent.length > 100 ? '...' : '')
    });
    
    let memoryEnhancement = '';
    
    // 3. Add memory query (only executed when enabled)
    if (isMemorySearchEnabled) {
      try {
        // 🔥 Enhanced diagnostics: Detailed logging of user alias state
        
        // Check user alias
        if (!this.currentUserAlias) {
          logger.warn('[AgentChat] 🧠 MEMORY QUERY SKIPPED - No user alias available', 'enhanceUserMessageContext', {
            messageId: message.id,
            agentName: this.getAgentName(),
            reason: 'currentUserAlias is null, undefined, or empty string'
          });
        } else {
          logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Initializing memory manager', 'enhanceUserMessageContext', {
            messageId: message.id,
            userAlias: this.currentUserAlias,
            agentName: this.getAgentName()
          });

          const { getKosmosMemory } = await import('../mem0/kosmos-adapters');
          const memoryManager = await getKosmosMemory(this.currentUserAlias);
          
          logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Calling memoryManager.search()', 'enhanceUserMessageContext', {
            messageId: message.id,
            userAlias: this.currentUserAlias,
            searchQuery: originalContent.substring(0, 200) + (originalContent.length > 200 ? '...' : ''),
            searchOptions: { userId: this.currentUserAlias, limit: semanticTopN }
          });
          
          // 🔥 Fix: Must pass userId parameter to search method
          const searchResult = await memoryManager.search(originalContent, {
            userId: this.currentUserAlias,
            limit: semanticTopN
          });
          
          logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Search completed', 'enhanceUserMessageContext', {
            messageId: message.id,
            userAlias: this.currentUserAlias,
            hasResults: !!(searchResult?.results),
            resultsCount: searchResult?.results?.length || 0,
            rawSearchResult: JSON.stringify(searchResult).substring(0, 500)
          });
          
          // Process search results - searchResult.results is an array
          const memoryResults = searchResult?.results || [];
          
          if (memoryResults && memoryResults.length > 0) {
            logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Processing results', 'enhanceUserMessageContext', {
              messageId: message.id,
              totalResults: memoryResults.length,
              threshold: semanticSimilarityThreshold,
              resultsBeforeFilter: memoryResults.map((item: any) => ({
                memory: (item.memory || '').substring(0, 50) + '...',
                score: item.score,
                created_at: item.created_at
              }))
            });
            
            // 🔥 New: Filter results with score >= semantic_similarity_threshold
            const filteredResults = memoryResults.filter((item: any) => {
              const score = item.score || 0;
              return score >= semanticSimilarityThreshold;
            });
            
            logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Filtered results', 'enhanceUserMessageContext', {
              messageId: message.id,
              originalCount: memoryResults.length,
              filteredCount: filteredResults.length,
              threshold: semanticSimilarityThreshold,
              filteredOutCount: memoryResults.length - filteredResults.length
            });
            
            if (filteredResults.length > 0) {
              const memories = filteredResults.map((item: any, index: number) => {
                const memoryText = `${index + 1}. ${item.memory}`;
                const confidence = item.score ? ` (confidence: ${(item.score * 100).toFixed(1)}%)` : '';
                const createdAt = item.created_at ? ` [created at: ${item.created_at}]` : '';
                return memoryText + confidence + createdAt;
              }).join('\n');
              
              memoryEnhancement = `\n\n---\nRelevant Context from Memory:\n${memories}\n---`;
              
              logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Enhancement added', 'enhanceUserMessageContext', {
                messageId: message.id,
                memoriesCount: filteredResults.length,
                enhancementLength: memoryEnhancement.length,
                enhancementPreview: memoryEnhancement.substring(0, 300) + (memoryEnhancement.length > 300 ? '...' : '')
              });
            } else {
              logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - No results after filtering', 'enhanceUserMessageContext', {
                messageId: message.id,
                originalCount: memoryResults.length,
                threshold: semanticSimilarityThreshold
              });
            }
          } else {
            logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - No memory results found', 'enhanceUserMessageContext', {
              messageId: message.id,
              userAlias: this.currentUserAlias
            });
          }
        }
      } catch (error) {
        logger.error('[AgentChat] ❌ MEMORY QUERY ERROR - Exception during memory search', 'enhanceUserMessageContext', {
          messageId: message.id,
          agentName: this.getAgentName(),
          userAlias: this.currentUserAlias,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    } else {
      logger.debug('[AgentChat] 🔍 MEMORY_SEARCH - Disabled in agent config, skipping memory search', 'enhanceUserMessageContext', {
        messageId: message.id,
        agentName: this.getAgentName(),
        isMemorySearchEnabled
      });
    }
    
    // 2. Build enhanced content (original content + memory, no longer adding time)
    const enhancedContent = originalContent + memoryEnhancement;
    
    // 3. Update message content
    if (Array.isArray(enhancedMessage.content)) {
      enhancedMessage.content = enhancedMessage.content.map(part => {
        if (part.type === 'text') {
          return { ...part, text: enhancedContent };
        }
        return part;
      });
    } else {
      enhancedMessage.content = [{ type: 'text' as const, text: enhancedContent }];
    }
    
    
    return enhancedMessage;
  }


  getContextHistory(): Message[] {
    return this.currentChatSession?.context_history || []
  }

  getChatHistory(): Message[] {
    return this.currentChatSession?.chat_history || []
  }
  
  // ====== Main Chat Processing Methods ======
  
  /**
   * 🔥 New: Check and perform compression
   * First checks if compression is needed, then sets compression status and performs compression if needed
   */
  private async CheckAndCompress(): Promise<void> {
    try {
      const currentContextHistory = this.getContextHistory();
      const currentModelId = this.getCurrentModelId();
      const modelCapabilities = this.getModelCapabilities(currentModelId);
      const contextWindowSize = modelCapabilities.maxContextLength;
      
      // 1. Check if compression is needed
      const needsCompression = await checkCompressionNeeds(
        currentContextHistory,
        contextWindowSize,
        this.getAgentName(),
        async () => await this.calculateThreeComponentTokens()
      );
      
      if (needsCompression) {
        // 2. Set compressing status
        this.setChatStatus(ChatStatus.COMPRESSING_CONTEXT);
        
        // 3. Perform compression
        const compressionResult = await compressContextHistoryWithFullMode(
          currentContextHistory,
          this.fullModeCompressor,
          this.getAgentName()
        );
        
        // 4. Update compressed context history
        if (compressionResult.success && compressionResult.compressedMessages && this.currentChatSession) {
          this.currentChatSession.context_history = compressionResult.compressedMessages;
          this.currentChatSession.last_updated = new Date().toISOString();
        }
        
        // 5. Set compression completed status
        this.setChatStatus(ChatStatus.COMPRESSED_CONTEXT);
      }
    } catch (error) {
      logger.error('[AgentChat] Error in CheckAndCompress', 'CheckAndCompress', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.getAgentName()
      });
    }
  }
  
  /**
   * 🔥 Retry the last failed conversation (without adding new messages, using existing context history)
   * 
   * When an API call fails (e.g., 502 error), the user message has already been added to context history.
   * This method allows retrying the LLM call directly without resending the user message.
   *
   * @param token - Optional cancellation token
   * @param callbacks - Optional callback functions
   * @returns Array of display messages
   */
  async retryChat(
    token?: CancellationToken,
    callbacks?: StartChatCallbacks
  ): Promise<Message[]> {
    logger.info('[AgentChat] 🔄 Retrying chat with existing context', 'retryChat', {
      hasCancellationToken: !!token,
      agentName: this.getAgentName()
    });
    
    // 🔥 Check cancellation status before starting
    if (token?.isCancellationRequested) {
      logger.warn('[AgentChat] 🛑 Retry cancelled before start', 'retryChat', {
        agentName: this.getAgentName()
      });
      throw new CancellationError('Retry was cancelled before it started');
    }
    
    try {
      // Directly call startChat without adding new messages
      await this.startChat(token, callbacks);
      return this.getDisplayMessages();
    } catch (error) {
      // 🔥 Distinguish between cancellation errors and other errors
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] ✅ Retry cancelled gracefully', 'retryChat', {
          agentName: this.getAgentName()
        });
        throw error;
      }
      
      logger.error(`[AgentChat] Retry failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * 🔄 Modified: streamMessage supports CancellationToken
   *
   * @param userMessage - User message
   * @param token - Optional cancellation token
   * @param callbacks - Optional callback functions
   * @returns Array of display messages
   */
  async streamMessage(
    userMessage: Message,
    token?: CancellationToken,
    callbacks?: StartChatCallbacks
  ): Promise<Message[]> {
    logger.info('[AgentChat] 🚀 Starting streamMessage', 'streamMessage', {
      messageId: userMessage.id,
      hasCancellationToken: !!token,
      agentName: this.getAgentName()
    });
    
    // 🔥 Check cancellation status before starting
    if (token?.isCancellationRequested) {
      logger.warn('[AgentChat] 🛑 Operation cancelled before start', 'streamMessage', {
        agentName: this.getAgentName()
      });
      throw new CancellationError('Operation was cancelled before it started');
    }
    
    // 🔥 Refactored: Use new AddMessageToSession method
    await this.AddMessageToSession(userMessage);
    
    try {
      await this.startChat(token, callbacks);
      return this.getDisplayMessages();
    } catch (error) {
      // 🔥 Distinguish between cancellation errors and other errors
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] ✅ Operation cancelled gracefully', 'streamMessage', {
          agentName: this.getAgentName()
        });
        throw error;
      }
      
      logger.error(`[AgentChat] Conversation processing failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * 🔄 Modified: startChat supports CancellationToken
   */
  private async startChat(
    token?: CancellationToken,
    callbacks: StartChatCallbacks = {}
  ): Promise<void> {
    logger.info('[AgentChat] Starting chat conversation loop', 'startChat', {
      agentName: this.getAgentName(),
      hasCancellationToken: !!token
    });
    
    let requiresFollowUp = true;
    
    try {
      const sessionData = await this.getSessionFromAuthManager();
      if (!sessionData) {
        throw new GhcApiError('GitHub Copilot authentication required', 401);
      }
      
      while (requiresFollowUp) {
        // 🔥 Check cancellation status at the beginning of each loop iteration
        if (token?.isCancellationRequested) {
          logger.info('[AgentChat] 🛑 Cancellation detected in conversation loop', 'startChat', {
            agentName: this.getAgentName(),
            loopIteration: 'start'
          });
          throw new CancellationError('Operation cancelled during conversation loop');
        }
        
        // 🔥 Refactored: Use new CheckAndCompress method
        await this.CheckAndCompress();
        
        // 🔥 Check cancellation status again after compression
        if (token?.isCancellationRequested) {
          logger.info('[AgentChat] 🛑 Cancellation detected after compression', 'startChat', {
            agentName: this.getAgentName()
          });
          throw new CancellationError('Operation cancelled after compression');
        }
        
        // 🔥 New: Set "sending response" status before LLM call
        this.setChatStatus(ChatStatus.SENDING_RESPONSE);
        
        // 🔥 Pass token to API call
        const response = await this.callWithToolsStreaming(token);
        
        // 🔥 Set status to received
        this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
        
        let responseText = MessageHelper.getText(response).trimEnd();
        const hasToolCalls = response.tool_calls && response.tool_calls.length > 0;
        
        if (hasToolCalls) {
          const normalizedToolCalls = normalizeToolCalls(response.tool_calls);
          if (normalizedToolCalls) {
            response.tool_calls = normalizedToolCalls;
          }

          // 🔥 Refactored: Use new AddMessageToSession method
          await this.AddMessageToSession(response);
        } else if (responseText) {
          // 🔥 Refactored: Use new AddMessageToSession method
          await this.AddMessageToSession(response);
        }
        
        if (hasToolCalls && response.tool_calls) {
          // 🔥 Check cancellation status before batch validation
          if (token?.isCancellationRequested) {
            logger.info('[AgentChat] 🛑 Cancellation detected before tool validation', 'startChat', {
              agentName: this.getAgentName()
            });
            throw new CancellationError('Operation cancelled before tool validation');
          }
          
          // 🔥 Refactored: Batch validate all tool calls
          const approvalMap = await this.batchValidateAndRequestApproval(response.tool_calls);
          
          // 🔥 Check cancellation status again (batch approval may take time)
          if (token?.isCancellationRequested) {
            logger.info('[AgentChat] 🛑 Cancellation detected after tool validation', 'startChat', {
              agentName: this.getAgentName()
            });
            throw new CancellationError('Operation cancelled after tool validation');
          }
          
          // 🔥 Execute tool calls one by one, using batch validation results
          for (const toolCall of response.tool_calls) {
            // 🔥 Check cancellation status before each tool call
            if (token?.isCancellationRequested) {
              logger.info('[AgentChat] 🛑 Cancellation detected during tool execution', 'startChat', {
                agentName: this.getAgentName(),
                toolName: toolCall.function.name
              });
              throw new CancellationError('Operation cancelled during tool execution');
            }
            
            const toolName = toolCall.function.name;
            const approved = approvalMap.get(toolCall.id);
            
            logger.info('[AgentChat] 🔧 Executing tool call', 'startChat', {
              toolCallId: toolCall.id,
              toolName,
              approved,
              approvalMapHasKey: approvalMap.has(toolCall.id),
              approvalMapSize: approvalMap.size,
              approvalMapEntries: Array.from(approvalMap.entries()),
              agentName: this.getAgentName()
            });
            
            try {
              // 🔥 executeToolCall now returns standard Tool Result (including rejected cases)
              const toolResult = await this.executeToolCall(toolCall, approved);
              // Add a post-processing step: toolResult <- postProcessToolResult(toolResult)
              const postProcessedResult = await this.postProcessToolResult(toolCall, toolResult);
              const processedContent = typeof postProcessedResult === 'object'
                ? JSON.stringify(postProcessedResult, null, 2)
                : String(postProcessedResult);
              
              // 🔥 Check if this is an error Tool Result (including denied, truncated, or parse error)
              const isErrorResult = typeof toolResult === 'object' && (
                toolResult.denied === true || 
                toolResult.truncated === true || 
                toolResult.parseError === true ||
                toolResult.success === false
              );
              
              // 🔥 Detect Tool Result containing images and extract image data
              // 🔒 browserControl feature flag protection: MCP image processing only effective when browserControl is enabled
              const { isFeatureEnabled } = await import('../featureFlags');
              const browserControlEnabled = isFeatureEnabled('browserControl');
              
              let mcpImageData: { data: string; mimeType: string } | null = null;
              let sanitizedContent = processedContent; // Default to original content; will be restructured if it's image format
              
              if (browserControlEnabled) {
                try {
                  const parsed = JSON.parse(processedContent);
                  
                  // Check if it's MCP standard image format: { type: "image", data: "base64...", mimeType: "image/..." }
                  if (parsed && parsed.type === 'image' && parsed.data && parsed.mimeType) {
                    logger.info('[AgentChat] 🖼️ MCP Image detected in tool result', 'startChat', {
                      toolName,
                      toolCallId: toolCall.id,
                      mimeType: parsed.mimeType,
                      dataLength: parsed.data.length
                    });
                    
                    // Extract data and mimeType to temporary variables
                    mcpImageData = {
                      data: parsed.data,
                      mimeType: parsed.mimeType
                    };
                    
                    // Restructure processedContent, remove data field (prevent base64 from polluting session)
                    sanitizedContent = JSON.stringify({
                      type: 'image',
                      mimeType: parsed.mimeType,
                      description: '[Image returned, image data will be injected as user message]'
                    }, null, 2);
                  }
                } catch (e) {
                }
              }
              
              // 🔥 Use sanitizedContent to create tool response
              const toolResponse: Message = MessageHelper.createToolMessage(
                sanitizedContent,
                toolCall.id,
                toolName,
                toolCall.id
              );
              
              // 🔥 Refactored: Use new AddMessageToSession method
              await this.AddMessageToSession(toolResponse);
              
              // 🔒 browserControl feature flag protection: Entire MCP image injection logic only executes when browserControl is enabled
              if (browserControlEnabled) {
                // 🔥 New: If MCP image is detected, construct a user image message and insert into session
                if (mcpImageData) {
                  // 🔥 First-pass compression: mimics VSCode's upload-time compression (768px short side, quality 0.8)
                  let compressedImageData = mcpImageData;
                  let imageWidth: number | undefined;
                  let imageHeight: number | undefined;
                  let actualFileSize: number;
                  
                  try {
                    const { compressImageFirstPass } = await import('../utilities/imageStorageCompression');
                    const compressionResult = await compressImageFirstPass(
                      mcpImageData.data,
                      mcpImageData.mimeType
                    );
                    
                    compressedImageData = {
                      data: compressionResult.base64Data,
                      mimeType: compressionResult.mimeType
                    };
                    imageWidth = compressionResult.width;
                    imageHeight = compressionResult.height;
                    actualFileSize = compressionResult.compressedSize;
                    
                    if (compressionResult.wasCompressed) {
                      logger.info('[AgentChat] 🖼️ MCP image compressed (first pass)', 'startChat', {
                        toolName,
                        toolCallId: toolCall.id,
                        originalSize: compressionResult.originalSize,
                        compressedSize: compressionResult.compressedSize,
                        compressionRatio: (compressionResult.compressedSize / compressionResult.originalSize * 100).toFixed(1) + '%',
                        dimensions: `${imageWidth}x${imageHeight}`
                      });
                    }
                  } catch (compressionError) {
                    // Compression failed, use original data
                    logger.warn('[AgentChat] 🖼️ First pass compression failed, using original', 'startChat', {
                      toolName,
                      toolCallId: toolCall.id,
                      error: compressionError instanceof Error ? compressionError.message : String(compressionError)
                    });
                    // Calculate actual byte size of original base64
                    actualFileSize = Math.ceil(mcpImageData.data.length * 3 / 4);
                  }
                  
                  const imageMessage: Message = {
                    id: `user_img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: '[Image from tool result - automatically injected for vision model]'
                      },
                      {
                        type: 'image',
                        image_url: {
                          url: `data:${compressedImageData.mimeType};base64,${compressedImageData.data}`,
                          detail: 'auto'
                        },
                        metadata: {
                          fileName: `screenshot_${Date.now()}.${compressedImageData.mimeType.split('/')[1] || 'png'}`,
                          fileSize: actualFileSize!,
                          mimeType: compressedImageData.mimeType,
                          width: imageWidth,
                          height: imageHeight,
                          compressionStage: 'first'  // Marked as having undergone first-pass compression
                        }
                      } as any
                    ]
                  };
                  
                  // Inject user-identity image message into the session
                  await this.AddMessageToSession(imageMessage);
                }
              }
              
              // 🔥 Send Tool Result chunk (using sanitizedContent to avoid sending base64 to frontend)
              const toolResultChunk: StreamingChunk = {
                chunkId: `tool_result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                messageId: toolCall.id,
                chatId: this.chatId,
                chatSessionId: this.chatSessionId,
                timestamp: Date.now(),
                type: 'tool_result',
                toolResult: {
                  tool_call_id: toolCall.id,
                  tool_name: toolName,
                  content: sanitizedContent,
                  isError: isErrorResult
                }
              };
              
              // Send Tool Result chunk
              this.emitStreamingChunk(toolResultChunk);
              
            } catch (error) {
              logger.error(`[AgentChat] Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
              
              const errorContent = JSON.stringify({
                error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                tool_call_id: toolCall.id,
                tool_name: toolName
              }, null, 2);
              
              const errorResponse: Message = MessageHelper.createToolMessage(
                errorContent,
                toolCall.id,
                toolName,
                `${toolCall.id}_error`
              );
              
              // 🔥 Refactored: Use new AddMessageToSession method
              await this.AddMessageToSession(errorResponse);
              
              // 🔥 Send Tool Result error chunk
              const errorChunk: StreamingChunk = {
                chunkId: `tool_result_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                messageId: toolCall.id,
                chatId: this.chatId,
                chatSessionId: this.chatSessionId,
                timestamp: Date.now(),
                type: 'tool_result',
                toolResult: {
                  tool_call_id: toolCall.id,
                  tool_name: toolName,
                  content: errorContent,
                  isError: true
                }
              };
              
              // Send Tool Result error chunk
              this.emitStreamingChunk(errorChunk);
            }
          }
          
          requiresFollowUp = true;
        } else {
          // 🔥 Check cancellation status before storage compression
          if (token?.isCancellationRequested) {
            logger.info('[AgentChat] 🛑 Cancellation detected before storage compression', 'startChat', {
              agentName: this.getAgentName()
            });
            throw new CancellationError('Operation cancelled before storage compression');
          }
          
          // 🔥 New: Apply storage compression to recent messages in context_history
          const chatHistory = this.getChatHistory();
          const storageCompressionResult = await applyStorageCompressionToRecentMessages(
            chatHistory,
            this.getAgentName()
          );
          
          if (storageCompressionResult.success && storageCompressionResult.compressedMessage && this.currentChatSession) {
            // Update messages in ChatHistory and ContextHistory
            const targetMessageId = storageCompressionResult.compressedMessage.id;
            
            // 1. Update message in ChatHistory
            const chatMessageIndex = this.currentChatSession.chat_history.findIndex((msg: Message) => msg.id === targetMessageId);
            if (chatMessageIndex !== -1) {
              this.currentChatSession.chat_history[chatMessageIndex] = { ...storageCompressionResult.compressedMessage };
            }
            
            // 2. Update message in ContextHistory
            const contextMessageIndex = this.currentChatSession.context_history.findIndex((msg: Message) => msg.id === targetMessageId);
            if (contextMessageIndex !== -1) {
              this.currentChatSession.context_history[contextMessageIndex] = { ...storageCompressionResult.compressedMessage };
            }
            
            // Save to local file
            await this.saveChatSession();
            
            // Recalculate and notify context changes
            await this.calculateAndNotifyContext();
          }
          
          // 🔥 Refactored: Execute standalone fact extraction
          await this.extractFactsFromConversation();

          requiresFollowUp = false;

          // 🔥 New: Set idle status after the last tool-free response output ends
          this.setChatStatus(ChatStatus.IDLE);
        }
      }
      
      
    } catch (error) {
      // 🔥 Fix: Handle cancellation error in catch block, ensure status is set correctly
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] Handling cancellation', 'startChat', {
          agentName: this.getAgentName()
        });
        
        // 🔥 Key: Clean up unexecuted tool calls from the last message
        await this.cleanupIncompleteToolCalls();
        
        // 🔥 Important: Set chat status to idle first (this notifies the frontend)
        this.setChatStatus(ChatStatus.IDLE);
        
        // 🔥 Then clean up eventSender, stop sending any subsequent streaming data
        this.eventSender = null;
        
        // Rethrow cancellation error
        throw error;
      }
      
      logger.error(`[AgentChat] Unified streaming processing failed: ${error instanceof Error ? error.message : String(error)}`);
      // 🔥 Fix: Set idle status first for other errors, then clean up eventSender
      this.setChatStatus(ChatStatus.IDLE);
      this.eventSender = null;
      throw error;
    }
  }
  
  // ====== Core API Call Methods ======
  
  /**
   * 🔄 Modified: callWithToolsStreaming supports CancellationToken
   */
  async callWithToolsStreaming(token?: CancellationToken): Promise<Message> {
    try {
      // 🔥 Check cancellation status before API call
      if (token?.isCancellationRequested) {
        throw new CancellationError('Operation cancelled before API call');
      }
      
      const currentModelId = this.getCurrentModelId();
      const modelConfig = this.getCurrentModelConfig(currentModelId);
      const modelCapabilities = this.getModelCapabilities(currentModelId);

      let openAiTools: OpenAiFunctionTool[] | undefined = undefined;
      let toolChoice: string | { type: 'function'; function: { name: string } } | undefined = undefined;
      
      const currentTools = await this.getCurrentAvailableTools();
      if (modelCapabilities.supportsTools && currentTools.length > 0) {
        try {
          openAiTools = convertMcpToolsToOpenAiFormat(currentTools);
          validateToolsRequest(openAiTools);
          toolChoice = determineToolChoice(openAiTools, ToolMode.Auto);
        } catch (error) {
          logger.error(`[AgentChat] Tool processing failed: ${error instanceof Error ? error.message : String(error)}`);
          openAiTools = undefined;
          toolChoice = undefined;
        }
      }

      const systemMessages = this.getCombinedSystemPromptForContext();
      const contextHistory = this.getContextHistory();
      const supportsTools = this.currentModelSupportsTools();
      
      // 🔥 Fix: Dynamically select endpoint based on model
      const endpoint = getEndpointForModel(currentModelId);

      const formattedMessages = await formatMessagesForApi(
        systemMessages,
        contextHistory,
        supportsTools,
        endpoint
      );
      
      const requestOptions: any = {
        model: currentModelId,
        messages: formattedMessages,
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.supportsTemperature ? 0.7 : undefined,
        stream: true
      };

      if (openAiTools && openAiTools.length > 0) {
        requestOptions.tools = openAiTools;
        if (toolChoice) {
          requestOptions.tool_choice = toolChoice;
        }
      }

      // 🔥 Pass token to the actual API call
      const response = await this.makeStreamingApiCall(requestOptions, token);
      
      return response;
    } catch (error) {
      // 🔥 Distinguish cancellation errors
      if (error instanceof CancellationError) {
        throw error;
      }
      
      // 🔥 Fix: Preserve original GhcApiError status code to avoid losing information
      const originalMessage = error instanceof Error ? error.message : 'Streaming call failed';
      const originalStatusCode = error instanceof GhcApiError ? (error as GhcApiError).statusCode : 500;
      
      logger.error(`[AgentChat] Streaming call failed: ${originalMessage}`, 'callWithToolsStreaming', {
        statusCode: originalStatusCode,
        model: this.getCurrentModelId(),
        agentName: this.getAgentName()
      });
      throw new GhcApiError(originalMessage, originalStatusCode);
    }
  }
  
  /**
   * 🔄 Modified: makeStreamingApiCall supports CancellationToken
   * Uses AbortController to cancel fetch requests
   */
  private async makeStreamingApiCall(requestOptions: any, token?: CancellationToken): Promise<Message> {
   const session = await this.getSessionFromAuthManager();
   if (!session) {
     throw new GhcApiError('No GitHub Copilot session available', 401);
   }

   // 🔥 Fix: Dynamically select endpoint based on model
   const currentModelId = this.getCurrentModelId();
   const endpoint = getEndpointForModel(currentModelId);
   const url = `${GHC_CONFIG.API_ENDPOINT}${endpoint}`;
   const hasImageContent = hasImageContentInMessages(requestOptions.messages);
   
   // 🔥 New: Adjust request body format based on endpoint
   let requestBody: any;
   if (endpoint === '/responses') {
     // /responses endpoint uses a different format: requires input array
     // Note: formatMessagesForApi already returns ResponseInputItem[], used directly here
     
     requestBody = {
       model: requestOptions.model,
       input: requestOptions.messages, // messages here are already converted inputItems
       max_tokens: requestOptions.max_tokens, // Note: Some implementations may need to map to max_output_tokens, but keeping consistent for now
       stream: requestOptions.stream,
       include: ['reasoning.encrypted_content'] // Support Thinking
       // ❌ /responses endpoint does not support temperature parameter
     };

     // 🔥 Fix: Pass tools and tool_choice parameters, adapting to /responses format
     if (requestOptions.tools && requestOptions.tools.length > 0) {
       // /responses API expects flat FunctionTool objects for tools format
       requestBody.tools = requestOptions.tools.map((tool: any) => ({
         type: 'function',
         name: tool.function.name,
         description: tool.function.description,
         parameters: tool.function.parameters,
         strict: false
       }));

       if (requestOptions.tool_choice) {
         // /responses API also expects flat tool_choice format
         if (typeof requestOptions.tool_choice === 'object') {
           requestBody.tool_choice = {
             type: 'function',
             name: requestOptions.tool_choice.function.name
           };
         } else {
           requestBody.tool_choice = requestOptions.tool_choice;
         }
       }
     }
   } else {
     // /chat/completions uses standard format
     requestBody = requestOptions;
   }
    
    // Generate message ID for all chunks
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let chunkCounter = 0;
    
    // 🔥 New: Create AbortController for cancelling fetch requests
    const abortController = new AbortController();
    
    // 🔥 New: Listen for CancellationToken's cancellation event
    let cancellationListener: (() => void) | null = null;
    if (token) {
      cancellationListener = () => {
        logger.info('[AgentChat] 🛑 Aborting fetch request due to cancellation', 'makeStreamingApiCall', {
          messageId,
          agentName: this.getAgentName()
        });
        abortController.abort();
      };
      token.onCancellationRequested(cancellationListener);
    }
    
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': GHC_CONFIG.USER_AGENT,
        'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
        'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
      };
      
      if (hasImageContent) {
        headers['Copilot-Vision-Request'] = 'true';
      }
      
      const bodyString = JSON.stringify(requestBody);
      
      // 🔥 Add AbortSignal to fetch options
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyString,
        signal: abortController.signal
      });

      if (!response.ok) {
        let errorBody = '';
        let errorMessage = '';
        try {
          errorBody = await response.text();
          // Try to parse JSON-formatted error response
          try {
            const errorJson = JSON.parse(errorBody);
            // Extract the original error message returned by the API
            errorMessage = errorJson.error?.message || errorJson.message || errorJson.error || errorBody;
          } catch {
            // If not JSON, use the text directly
            errorMessage = errorBody || response.statusText;
          }
        } catch (e) {
          errorMessage = response.statusText || 'Failed to read error response';
        }
        
        logger.error('[AgentChat] ❌ API ERROR - Request failed', 'makeStreamingApiCall', {
          agentName: this.getAgentName(),
          status: response.status,
          statusText: response.statusText,
          errorBody,
          errorMessage,
          requestModel: requestOptions.model,
          hasImageContent
        });
        
        // Add specific error causes and fix suggestions based on status code
        let userFriendlyMessage = errorMessage || `HTTP ${response.status}`;
        
        // Add request context for debugging
        const requestContext = `[Model: ${requestOptions.model}, Endpoint: ${endpoint}, Status: ${response.status}]`;
        
        if (response.status === 500) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Server internal error - the API encountered an unexpected condition\nSuggestion: This may be caused by overly long context or truncated tool calls. Try starting a new conversation or simplifying the request`;
        } else if (response.status === 502 || response.status === 503 || response.status === 504) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: GitHub Copilot API service is temporarily unstable\nSuggestion: Please try again later`;
        } else if (response.status === 401) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Authentication expired\nSuggestion: Please sign in again`;
        } else if (response.status === 403) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Access denied\nSuggestion: Please check your Copilot subscription status`;
        } else if (response.status === 429) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Too many requests\nSuggestion: Please try again later`;
        } else {
          // Other unknown status codes also get context
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}`;
        }
        
        throw new GhcApiError(userFriendlyMessage, response.status);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new GhcApiError('Failed to get response stream reader', 500);
      }

      // For local accumulation, final return of complete Message
      let fullContent = '';
      let toolCalls: any[] = [];
      const decoder = new TextDecoder();
      let buffer = '';
      let isCancelled = false; // 🔥 Add cancellation flag

      try {
        while (true) {
          // 🔥 Check cancellation status before each read
          if (token?.isCancellationRequested) {
            logger.info('[AgentChat] 🛑 Cancellation detected during streaming', 'makeStreamingApiCall', {
              messageId,
              agentName: this.getAgentName()
            });
            isCancelled = true; // 🔥 Set cancellation flag, stop processing any new chunks
            reader.cancel();
            throw new CancellationError('Operation cancelled during streaming');
          }
          
          const { done, value } = await reader.read();
          if (done) {
            // 🔥 Fix: Process remaining last chunk in buffer
            if (buffer.trim()) {
              const trimmed = buffer.trim();
              if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                try {
                  const jsonStr = trimmed.slice(6);
                  const data = JSON.parse(jsonStr);
                  
                  // 🔥 If cancelled, stop processing any chunks
                  if (!isCancelled) {
                    // 🔄 Adapt: Handle different response formats based on endpoint
                    if (endpoint === '/responses') {
                      // Process /responses format last chunk
                      if (data.type === 'response.output_text.delta' && data.delta) {
                        const textDelta = data.delta;
                        fullContent += textDelta;
                        
                        // Send content chunk
                        const contentChunk: StreamingChunk = {
                          chunkId: `${messageId}_chunk_${chunkCounter++}`,
                          messageId,
                          chatId: this.chatId,
                          chatSessionId: this.chatSessionId,
                          timestamp: Date.now(),
                          type: 'content',
                          contentDelta: {
                            text: textDelta
                          }
                        };
                        
                        // Send content chunk
                        this.emitStreamingChunk(contentChunk);
                      }
                    } else {
                      // Process standard /chat/completions format last chunk
                      if (data.choices && data.choices[0] && data.choices[0].delta) {
                        const delta = data.choices[0].delta;
                        
                        if (delta.content) {
                          fullContent += delta.content;
                          
                          const contentChunk: StreamingChunk = {
                            chunkId: `${messageId}_chunk_${chunkCounter++}`,
                            messageId,
                            chatId: this.chatId,
                            chatSessionId: this.chatSessionId,
                            timestamp: Date.now(),
                            type: 'content',
                            contentDelta: {
                              text: delta.content
                            }
                          };
                          
                          // Send content chunk
                          this.emitStreamingChunk(contentChunk);
                        }
                      }
                    }
                  }
                } catch (e) {
                  logger.warn('[AgentChat] Failed to parse final buffer chunk:', buffer);
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed === 'data: [DONE]') continue;
            
            if (trimmed.startsWith('data: ')) {
              try {
                const jsonStr = trimmed.slice(6);
                const data = JSON.parse(jsonStr);
                
                // 🔥 If cancelled, stop processing any chunks
                if (isCancelled) {
                  continue;
                }

                // 🔄 Adapt: Handle different response formats based on endpoint
                if (endpoint === '/responses') {
                  // Process /responses format
                  // Listen for response.output_text.delta events
                  if (data.type === 'response.output_text.delta' && data.delta) {
                    const textDelta = data.delta;
                    fullContent += textDelta;
                    
                    // Set received status
                    if (fullContent === textDelta) {
                      this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                    }
                    
                    // Send content chunk
                    const contentChunk: StreamingChunk = {
                      chunkId: `${messageId}_chunk_${chunkCounter++}`,
                      messageId,
                      chatId: this.chatId,
                      chatSessionId: this.chatSessionId,
                      timestamp: Date.now(),
                      type: 'content',
                      contentDelta: {
                        text: textDelta
                      }
                    };
                    
                    // Send content chunk
                    this.emitStreamingChunk(contentChunk);
                  } else if (data.type === 'response.output_item.done' && data.item?.type === 'function_call') {
                    // Process /responses tool calls
                    // response.output_item.done event contains complete tool call info
                    const toolCallItem = data.item;
                    
                    // Ensure status is set when receiving the first tool call
                    if (toolCalls.length === 0) {
                      this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                    }
                    
                    // Find or assign index (for simplicity, append directly)
                    const index = toolCalls.length;
                    
                    // Local accumulation
                    toolCalls[index] = {
                      id: toolCallItem.call_id,
                      type: 'function',
                      function: {
                        name: toolCallItem.name,
                        arguments: toolCallItem.arguments
                      }
                    };
                    
                    // Send complete tool call chunk
                    // Note: Send complete arguments at once, not as delta
                    const toolCallChunk: StreamingChunk = {
                      chunkId: `${messageId}_chunk_${chunkCounter++}`,
                      messageId,
                      chatId: this.chatId,
                      chatSessionId: this.chatSessionId,
                      timestamp: Date.now(),
                      type: 'tool_call',
                      toolCallDelta: {
                        index,
                        id: toolCallItem.call_id,
                        type: 'function',
                        function: {
                          name: toolCallItem.name,
                          arguments: toolCallItem.arguments
                        }
                      }
                    };
                    
                    // Send tool call chunk
                    this.emitStreamingChunk(toolCallChunk);
                  } else {
                    // 🔥 Debug log: Capture other /responses event types
                    // Only log for non-text-delta and non-progress events to avoid log explosion
                    if (data.type !== 'response.output_text.delta' &&
                        data.type !== 'response.in_progress' &&
                        data.type !== 'response.created' &&
                        data.type !== 'response.completed' &&
                        data.type !== 'response.output_item.done') { // Exclude already-handled done events
                      
                      logger.info('[AgentChat] 🔍 /responses event captured', 'makeStreamingApiCall', {
                        type: data.type,
                        keys: Object.keys(data),
                        dataSample: JSON.stringify(data).substring(0, 500) // Truncated to prevent excessive length
                      });
                    }
                  }
                  
                } else {
                  // Process standard /chat/completions format
                  if (data.choices && data.choices[0] && data.choices[0].delta) {
                    const delta = data.choices[0].delta;
                    
                    // 🔥 Process Content chunk
                    if (delta.content) {
                      fullContent += delta.content;
                      
                      // 🔥 Fix: Set received_response status immediately upon first content chunk
                      if (fullContent === delta.content) {
                        this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                      }
                      
                      // Send content chunk to frontend
                      const contentChunk: StreamingChunk = {
                        chunkId: `${messageId}_chunk_${chunkCounter++}`,
                        messageId,
                        chatId: this.chatId,
                        chatSessionId: this.chatSessionId,
                        timestamp: Date.now(),
                        type: 'content',
                        contentDelta: {
                          text: delta.content
                        }
                      };
                      
                      // Send content chunk
                      this.emitStreamingChunk(contentChunk);
                    }
                    
                    // 🔥 Process Tool Call chunk
                    if (delta.tool_calls) {
                      // 🔥 Fix: Set received_response status upon first tool call chunk
                      if (toolCalls.length === 0 && delta.tool_calls.length > 0) {
                        this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                      }
                      
                      for (const toolCall of delta.tool_calls) {
                        const index = toolCall.index || 0;
                        
                        // Local accumulation (for final return)
                        if (!toolCalls[index]) {
                          toolCalls[index] = {
                            id: toolCall.id || '',
                            type: 'function',
                            function: { name: '', arguments: '' }
                          };
                        }
                        if (toolCall.id) toolCalls[index].id = toolCall.id;
                        if (toolCall.function?.name) toolCalls[index].function.name = toolCall.function.name;
                        if (toolCall.function?.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;
                        
                        // Send tool call chunk to frontend
                        const toolCallChunk: StreamingChunk = {
                          chunkId: `${messageId}_chunk_${chunkCounter++}`,
                          messageId,
                          chatId: this.chatId,
                          chatSessionId: this.chatSessionId,
                          timestamp: Date.now(),
                          type: 'tool_call',
                          toolCallDelta: {
                            index,
                            id: toolCall.id,
                            type: 'function',
                            function: {
                              name: toolCall.function?.name,
                              arguments: toolCall.function?.arguments
                            }
                          }
                        };
                        
                        // Send tool call chunk
                        this.emitStreamingChunk(toolCallChunk);
                      }
                    }
                  }
                }
              } catch (e) {
                logger.warn('[AgentChat] Failed to parse streaming chunk:', trimmed);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Build final Message
      const result: Message = MessageHelper.createTextMessage(fullContent, 'assistant', messageId);
      if (toolCalls.length > 0) {
        result.tool_calls = toolCalls.filter(tc => tc && tc.id);
      }

      // 🔥 Send completion chunk
      const completeChunk: StreamingChunk = {
        chunkId: `${messageId}_complete`,
        messageId,
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        timestamp: Date.now(),
        type: 'complete',
        complete: {
          messageId,
          hasToolCalls: (result.tool_calls?.length || 0) > 0
        }
      };
      
      // Send completion chunk
      this.emitStreamingChunk(completeChunk);

      return result;
    } catch (error) {
      // 🔥 Distinguish between different types of errors
      if (error instanceof CancellationError) {
        // Cancellation error, rethrow directly
        throw error;
      }
      
      // 🔥 Check if this is an AbortError (fetch was aborted)
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('[AgentChat] 🛑 Fetch request aborted', 'makeStreamingApiCall', {
          messageId,
          agentName: this.getAgentName()
        });
        throw new CancellationError('Fetch request was aborted');
      }
      
      const originalErrorMessage = error instanceof Error ? error.message : String(error);
      const capitalizedErrorMessage = originalErrorMessage.charAt(0).toUpperCase() + originalErrorMessage.slice(1);
      
      // 🔥 Extract underlying cause info (Node.js undici's TypeError usually contains a cause property)
      let causeInfo = '';
      if (error instanceof Error) {
        const cause = (error as Error & { cause?: Error }).cause;
        if (cause) {
          causeInfo = cause.message || String(cause);
          if ((cause as Error & { code?: string }).code) {
            causeInfo = `[${(cause as Error & { code?: string }).code}] ${causeInfo}`;
          }
        }
        if ((error as Error & { code?: string }).code) {
          causeInfo = causeInfo ? `${(error as Error & { code?: string }).code} - ${causeInfo}` : (error as Error & { code?: string }).code || '';
        }
      }
      
      logger.error(`[AgentChat] Network error during streaming: ${originalErrorMessage}`, 'makeStreamingApiCall', {
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: originalErrorMessage,
        errorCause: causeInfo || 'none',
        errorCode: error instanceof Error ? (error as Error & { code?: string }).code : undefined,
        agentName: this.getAgentName(),
        messageId
      });
      
      // Add specific cause descriptions and fix suggestions based on error type
      const lowerMsg = originalErrorMessage.toLowerCase();
      let userFriendlyMessage = capitalizedErrorMessage || 'Unknown network error';
      
      if (lowerMsg.includes('fetch failed') || 
          lowerMsg.includes('enotfound') ||
          lowerMsg.includes('econnrefused') ||
          lowerMsg.includes('etimedout')) {
        userFriendlyMessage = `${capitalizedErrorMessage}\n\nCause: Network connection failed${causeInfo ? ` (${causeInfo})` : ''}\nSuggestion: Please check if VPN is connected, or if network is working properly`;
      } else if (lowerMsg.includes('certificate') ||
                 lowerMsg.includes('ssl') ||
                 lowerMsg.includes('tls')) {
        userFriendlyMessage = `${capitalizedErrorMessage}\n\nCause: SSL/TLS certificate issue\nSuggestion: Please check if system time is correct, or try switching network`;
      } else if (lowerMsg === 'terminated') {
        // 🔥 Node.js undici throws "TypeError: terminated" when the connection is unexpectedly closed
        // This typically occurs when the server/network is interrupted during SSE streaming
        const detailedCause = causeInfo || 'Server connection was unexpectedly closed during streaming';
        userFriendlyMessage = `Connection terminated during streaming\n\nCause: ${detailedCause}\nSuggestion: Please check your network/VPN connection and try again`;
      }
      
      throw new GhcApiError(userFriendlyMessage, 0);
    } finally {
      // 🔥 Cleanup: Remove cancellation listener
      if (cancellationListener && token) {
        // Note: EventEmitter implementation automatically cleans up one-time listeners
        // If manual cleanup is needed, an off method can be added to CancellationToken
      }
    }
  }
  
  /**
   * 🔥 New: Batch validate all tool calls and request user approval
   * Validates all tool calls at once, collects approval requests, and presents them to the user together
   *
   * @param toolCalls - Array of tool calls
   * @returns Batch approval result: Map<toolCallId, approved>
   */
  private async batchValidateAndRequestApproval(
    toolCalls: Array<{id: string; function: {name: string; arguments: string}}>
  ): Promise<Map<string, boolean>> {
    logger.info('[AgentChat] 🔐 Starting batch validation and approval request', 'batchValidateAndRequestApproval', {
      toolCallsCount: toolCalls.length,
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        argsPreview: tc.function.arguments.substring(0, 200)
      })),
      agentName: this.getAgentName()
    });
    
    // 🔥 TODO: Temporarily skip file security validation, will re-enable after optimization
    // Skip file validation security check for now, will re-enable after optimization
    logger.info('[AgentChat] ⏭️ Skipping file security validation (temporarily disabled)', 'batchValidateAndRequestApproval', {
      toolCallsCount: toolCalls.length,
      agentName: this.getAgentName()
    });
    
    const approvalMap = new Map<string, boolean>();
    for (const toolCall of toolCalls) {
      approvalMap.set(toolCall.id, true);
    }
    return approvalMap;
    
    /* 🔥 The following code is temporarily skipped, will re-enable after optimization
    // The following code is temporarily skipped, will re-enable after optimization
    
    // Get current workspace path
    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
    const workspacePath = chatConfig?.agent?.workspace;
    
    logger.info('[AgentChat] Workspace configuration', 'batchValidateAndRequestApproval', {
      workspacePath,
      agentName: this.getAgentName()
    });
    
    // 1. Batch validate all tool calls
    const batchResult = SecurityValidator.validateBatchToolCalls(toolCalls, workspacePath);
    
    
    logger.info('[AgentChat] 📊 Batch validation result', 'batchValidateAndRequestApproval', {
      allApproved: batchResult.allApproved,
      needsApproval: batchResult.needsApproval,
      validationResultsCount: batchResult.validationResults.length,
      agentName: this.getAgentName()
    });
    
    // 2. If all passed, return all approved directly
    if (batchResult.allApproved) {
      logger.info('[AgentChat] ✅ All tool calls approved automatically', 'batchValidateAndRequestApproval', {
        agentName: this.getAgentName()
      });
      
      const approvalMap = new Map<string, boolean>();
      for (const toolCall of toolCalls) {
        approvalMap.set(toolCall.id, true);
      }
      return approvalMap;
    }
    
    // 3. Extract approval requests that need user approval
    const approvalRequests = SecurityValidator.extractApprovalRequests(batchResult);
    
    logger.warn('[AgentChat] ⚠️ Tools require approval for paths outside workspace', 'batchValidateAndRequestApproval', {
      requestsCount: approvalRequests.length,
      requests: approvalRequests.map(r => ({
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        pathsCount: r.paths.length,
        paths: r.paths.map(p => ({
          path: p.path,
          normalizedPath: p.normalizedPath
        }))
      })),
      agentName: this.getAgentName()
    });
    
    // 4. Send batch approval request to frontend, wait for user response
    logger.info('[AgentChat] 📤 Sending approval request to frontend', 'batchValidateAndRequestApproval', {
      requestsCount: approvalRequests.length,
      agentName: this.getAgentName()
    });
    
    const approvalResponses = await this.requestBatchUserApproval(approvalRequests);
    
    logger.info('[AgentChat] 📥 Received approval responses from frontend', 'batchValidateAndRequestApproval', {
      responsesCount: approvalResponses.size,
      responses: Array.from(approvalResponses.entries()).map(([toolCallId, approved]) => ({
        toolCallId,
        approved
      })),
      agentName: this.getAgentName()
    });
    
    // 5. 🔥 Modified: Build approval result Map for each tool call
    // Now approvalResponses key is directly toolCallId
    const approvalMap = new Map<string, boolean>();
    
    logger.info('[AgentChat] 🔍 Constructing approval map', 'batchValidateAndRequestApproval', {
      validationResultsCount: batchResult.validationResults.length,
      approvalResponsesSize: approvalResponses.size,
      approvalResponsesEntries: Array.from(approvalResponses.entries()),
      agentName: this.getAgentName()
    });
    
    for (const validation of batchResult.validationResults) {
      if (validation.approved) {
        // Auto-approved (validation passed)
        approvalMap.set(validation.toolCallId, true);
        logger.info('[AgentChat] Tool auto-approved (validation passed)', 'batchValidateAndRequestApproval', {
          toolCallId: validation.toolCallId,
          agentName: this.getAgentName()
        });
      } else {
        // 🔥 Modified: Validation failed, check if user approved this tool
        const approved = approvalResponses.get(validation.toolCallId) === true;
        approvalMap.set(validation.toolCallId, approved);
        logger.info('[AgentChat] Tool approval from user response', 'batchValidateAndRequestApproval', {
          toolCallId: validation.toolCallId,
          approved,
          hasResponse: approvalResponses.has(validation.toolCallId),
          agentName: this.getAgentName()
        });
      }
    }
    
    logger.info('[AgentChat] ✅ Approval map constructed', 'batchValidateAndRequestApproval', {
      approvalMapSize: approvalMap.size,
      approvals: Array.from(approvalMap.entries()).map(([id, approved]) => ({
        toolCallId: id,
        approved
      })),
      agentName: this.getAgentName()
    });
    
    return approvalMap;
    */
  }
  
  /**
   * 🔥 Modified: Request batch user approval for multiple tool accesses
   * Display all approval requests uniformly, one request per tool
   *
   * @param requests - Approval request list (one request per tool)
   * @returns Approval response Map: key is toolCallId, value is whether approved
   */
  private async requestBatchUserApproval(
    requests: ApprovalRequestItem[]
  ): Promise<Map<string, boolean>> {
    logger.info('[AgentChat] 📤 Starting batch user approval request', 'requestBatchUserApproval', {
      requestsCount: requests.length,
      agentName: this.getAgentName()
    });
    
    return new Promise((resolve) => {
      if (!this.eventSender) {
        logger.error('[AgentChat] ❌ No event sender available for batch approval request', 'requestBatchUserApproval', {
          agentName: this.getAgentName()
        });
        // No event sender, reject all
        const responses = new Map<string, boolean>();
        for (const req of requests) {
          responses.set(req.toolCallId, false);
        }
        resolve(responses);
        return;
      }
      
      const batchRequestId = `batch_approval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const responses = new Map<string, boolean>();
      let respondedCount = 0;
      
      // 🔥 Modified: Create batch approval request event, one request per tool
      const batchApprovalRequest = {
        type: 'batch_tool_approval_request',
        batchRequestId,
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        requests: requests.map(req => {
          // 🔥 Generate unique requestId
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 9);
          return {
            requestId: `${batchRequestId}_${req.toolCallId}_${timestamp}_${randomSuffix}`,
            toolCallId: req.toolCallId,
            toolName: req.toolName,
            paths: req.paths, // 🔥 Include all paths
            message: `Tool "${req.toolName}" needs approval to access ${req.paths.length} path${req.paths.length > 1 ? 's' : ''} outside the workspace.`
          };
        })
      };
      
      logger.info('[AgentChat] 📤 Sending batch approval request event', 'requestBatchUserApproval', {
        batchRequestId,
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        requestsCount: batchApprovalRequest.requests.length,
        requests: batchApprovalRequest.requests.map(r => ({
          requestId: r.requestId,
          toolName: r.toolName,
          pathsCount: r.paths.length
        })),
        agentName: this.getAgentName()
      });
      
      // Send batch approval request to frontend without filtering
      this.safeEmitEvent('agentChat:batchApprovalRequest', batchApprovalRequest);
      
      // 🔥 Removed timeout monitoring: Frontend fully controls timeout handling
      // Backend only waits for all frontend responses (approved or rejected)
      
      // Listen for responses - via global pending handlers mechanism
      const cleanup = () => {
        // Remove this request's handler from global pending handlers
        if ((global as any).__pendingBatchApprovalHandlers) {
          delete (global as any).__pendingBatchApprovalHandlers[batchRequestId];
        }
      };
      
      // Temporarily store response handler, waiting for response
      (global as any).__pendingBatchApprovalHandlers = (global as any).__pendingBatchApprovalHandlers || {};
      (global as any).__pendingBatchApprovalHandlers[batchRequestId] = (response: any) => {
        // 🔥 Modified: response format: { requestId, toolCallId, approved }
        responses.set(response.toolCallId, response.approved);
        respondedCount++;
        
        logger.info('[AgentChat] 📥 Received approval response', 'requestBatchUserApproval', {
          batchRequestId,
          responseRequestId: response.requestId,
          toolCallId: response.toolCallId,
          approved: response.approved,
          respondedCount,
          totalRequests: requests.length,
          agentName: this.getAgentName()
        });
        
        // 🔥 Modified: Immediately notify frontend to remove the corresponding approval request
        if (this.eventSender) {
          this.eventSender.send('agentChat:approvalResponseProcessed', {
            chatSessionId: this.chatSessionId,
            batchRequestId,
            requestId: response.requestId,
            toolCallId: response.toolCallId,
            approved: response.approved
          });
          
          logger.info('[AgentChat] 📤 Sent approval response processed notification', 'requestBatchUserApproval', {
            chatSessionId: this.chatSessionId,
            requestId: response.requestId,
            agentName: this.getAgentName()
          });
        }
        
        // If all requests have been responded to, resolve
        if (respondedCount >= requests.length) {
          logger.info('[AgentChat] ✅ All approval responses received', 'requestBatchUserApproval', {
            batchRequestId,
            totalResponses: respondedCount,
            agentName: this.getAgentName()
          });
          cleanup();
          resolve(responses);
        }
      };
      
      logger.info('[AgentChat] ⏳ Waiting for approval responses from frontend', 'requestBatchUserApproval', {
        batchRequestId,
        expectedResponses: requests.length,
        agentName: this.getAgentName()
      });
    });
  }
  
  /**
   * 🔥 New: Post-processing method after tool execution completes
   * Performs post-processing on specific tool results, such as collecting user input
   */
  private async postProcessToolResult(toolCall: any, toolResult: any): Promise<any> {
    const toolName = toolCall.function?.name;
    
    if (toolName === 'get_mcp_config_from_lib') {
      return await this.postProcessForGetMcpConfigFromLibTool(toolResult);
    }
    
    if (toolName === 'get_agent_config_from_lib') {
      return await this.postProcessForGetAgentConfigFromLibTool(toolResult);
    }
    
    // Other tools are not processed, return the original result directly
    return toolResult;
  }
  
  /**
   * 🔥 New: Method for processing get_mcp_config_from_lib tool results
   * Checks if ENV parameters require user input, and initiates the info collection flow if so
   */
  private async postProcessForGetMcpConfigFromLibTool(toolResult: any): Promise<any> {
    try {
      // Parse tool result
      let configData: any;
      if (typeof toolResult === 'string') {
        try {
          configData = JSON.parse(toolResult);
        } catch (error) {
          // If not a JSON string, return the original result
          return toolResult;
        }
      } else if (typeof toolResult === 'object') {
        configData = toolResult;
      } else {
        return toolResult;
      }
      
      // Locate the actual config object containing env
      // If the result is wrapped in { success: true, config: { ... } }, extract config
      // Otherwise assume it is the config object directly
      const actualConfig = (configData.config && typeof configData.config === 'object')
        ? configData.config
        : configData;

      // Check if there is an env configuration
      if (!actualConfig.env || typeof actualConfig.env !== 'object') {
        // Even without env, still need to check for placeholders in url
        const currentAuth = mainAuthManager.getCurrentAuth();
        const currentUserAlias = currentAuth?.ghcAuth?.alias || '';
        
        if (currentUserAlias && actualConfig.url && typeof actualConfig.url === 'string' && containsKosmosPlaceholder(actualConfig.url)) {
          actualConfig.url = kosmosPlaceholderManager.replacePlaceholders(actualConfig.url, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced KOSMOS placeholders in MCP config url', 'postProcessForGetMcpConfigFromLibTool', {
            agentName: this.getAgentName()
          });
        }
        
        return typeof toolResult === 'string'
          ? JSON.stringify(configData, null, 2)
          : configData;
      }
      
      // 🔥 Step 1: Process @KOSMOS_ placeholder variables (auto-replaced, no user input needed)
      const currentAuth = mainAuthManager.getCurrentAuth();
      const currentUserAlias = currentAuth?.ghcAuth?.alias || '';
      
      if (currentUserAlias) {
        // Check if env contains @KOSMOS_ placeholders
        const envEntries = Object.entries(actualConfig.env);
        let hasKosmosPlaceholder = false;
        
        for (const [, value] of envEntries) {
          if (typeof value === 'string' && containsKosmosPlaceholder(value)) {
            hasKosmosPlaceholder = true;
            break;
          }
        }
        
        // Also check if url field contains placeholders
        const urlHasPlaceholder = actualConfig.url && typeof actualConfig.url === 'string' && containsKosmosPlaceholder(actualConfig.url);
        
        if (hasKosmosPlaceholder) {
          // Replace all @KOSMOS_ placeholders
          actualConfig.env = kosmosPlaceholderManager.replacePlaceholdersInObject(
            actualConfig.env,
            { alias: currentUserAlias }
          );
          
          logger.info('[AgentChat] Replaced KOSMOS placeholders in MCP config env', 'postProcessForGetMcpConfigFromLibTool', {
            agentName: this.getAgentName()
          });
        }
        
        // Replace placeholders in url field
        if (urlHasPlaceholder) {
          actualConfig.url = kosmosPlaceholderManager.replacePlaceholders(actualConfig.url, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced KOSMOS placeholders in MCP config url', 'postProcessForGetMcpConfigFromLibTool', {
            agentName: this.getAgentName()
          });
        }
      }
      
      // 🔥 Step 2: Use the unified UserInputPlaceholderParser to parse @USER_INPUT_ placeholders
      // 🔥 Include both env and url for USER_INPUT detection
      const configForUserInput = {
        env: actualConfig.env,
        url: actualConfig.url || ''
      };
      const parseResult = userInputPlaceholderParser.parseConfig(configForUserInput, {
        currentUserAlias: currentUserAlias || undefined
      });
      
      // If no fields require user input, return processed result (with KOSMOS placeholders already replaced)
      if (!parseResult.hasUserInputFields) {
        return typeof toolResult === 'string'
          ? JSON.stringify(configData, null, 2)
          : configData;
      }
      
      // 🔥 Step 3: Extract MCP Server name and contact info
      const mcpServerName = actualConfig.name || 'MCP Server';
      const mcpServerContact = actualConfig.contact || '';
      
      logger.info('[AgentChat] Found user input fields in MCP config, requesting user info', 'postProcessForGetMcpConfigFromLibTool', {
        userInputFieldsCount: parseResult.fields.length,
        mcpServerName,
        mcpServerContact,
        fields: parseResult.fields.map((f: UserInputField) => ({
          key: f.key,
          type: f.type,
          subtype: f.subtype,
          varName: f.varName
        })),
        agentName: this.getAgentName()
      });
      
      // 🔥 Build body.description (fully built by backend, frontend displays directly)
      const bodyDescription = mcpServerContact
        ? `Please fill in the following environment variables to complete the MCP server setup. Contact <strong class="contact-highlight">${mcpServerContact}</strong> for assistance if you need help.`
        : 'Please fill in the following environment variables to complete the MCP server setup.';
      
      // 🔥 Build request object conforming to InfoInputRequest interface (using fields returned by parser)
      const infoInputRequestData = {
        fields: parseResult.fields.map((field: UserInputField) => ({
          key: field.key,
          label: field.label,
          type: field.type.toLowerCase(),
          subtype: field.subtype.toLowerCase(),
          varName: field.varName,
          required: field.isRequired,
          defaultValue: field.defaultValue
        })),
        header: {
          title: `Configure ${mcpServerName}`
        },
        body: {
          description: bodyDescription
        }
      };
      
      // Initiate info collection flow
      const userInputs = await this.requestUserInfoInput(infoInputRequestData);
      
      // Process result based on user's choice
      if (userInputs === null) {
        // User chose "Skip, set up later", remove ENV section from configuration
        const resultWithoutEnv = JSON.parse(JSON.stringify(configData)); // Deep copy
        const targetToModify = (resultWithoutEnv.config && typeof resultWithoutEnv.config === 'object') 
            ? resultWithoutEnv.config 
            : resultWithoutEnv;
        
        delete targetToModify.env;
        
        logger.info('[AgentChat] User skipped info input, removing env from config', 'postProcessForGetMcpConfigFromLibTool', {
          agentName: this.getAgentName()
        });
        
        return typeof toolResult === 'string'
          ? JSON.stringify(resultWithoutEnv, null, 2)
          : resultWithoutEnv;
      } else {
        // User chose "Confirm and continue", apply user input to environment variables
        const updatedResult = JSON.parse(JSON.stringify(configData)); // Deep copy
        const targetToModify = (updatedResult.config && typeof updatedResult.config === 'object') 
            ? updatedResult.config 
            : updatedResult;
        
        // Apply user input to environment variables
        const updatedEnv = { ...targetToModify.env };
        for (const field of parseResult.fields) {
          const inputValue = userInputs[field.key];
          const isInputEmpty = inputValue === null || inputValue === undefined || String(inputValue).trim() === '';
          
          if (!field.isRequired && isInputEmpty) {
            // Optional field with no user input -> delete this env variable
            delete updatedEnv[field.key];
          } else if (userInputs.hasOwnProperty(field.key)) {
            // Required field or has input value -> update value
            updatedEnv[field.key] = String(inputValue);
          }
        }
        targetToModify.env = updatedEnv;
        
        logger.info('[AgentChat] User provided info input, updated config with user values', 'postProcessForGetMcpConfigFromLibTool', {
          updatedFields: Object.keys(userInputs),
          agentName: this.getAgentName()
        });
        
        return typeof toolResult === 'string'
          ? JSON.stringify(updatedResult, null, 2)
          : updatedResult;
      }
      
    } catch (error) {
      logger.error('[AgentChat] Error in postProcessForGetMcpConfigFromLibTool', 'postProcessForGetMcpConfigFromLibTool', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.getAgentName()
      });
      
      // Return original result on error
      return toolResult;
    }
  }

  /**
   * 🔥 New: Method for processing get_agent_config_from_lib tool results
   * Checks if the workspace field in Agent config contains KOSMOS placeholders or USER INPUT placeholders
   */
  private async postProcessForGetAgentConfigFromLibTool(toolResult: any): Promise<any> {
    try {
      // Parse tool result
      let configData: any;
      if (typeof toolResult === 'string') {
        try {
          configData = JSON.parse(toolResult);
        } catch (error) {
          // If not a JSON string, return the original result
          return toolResult;
        }
      } else if (typeof toolResult === 'object') {
        configData = toolResult;
      } else {
        return toolResult;
      }

      // Locate the actual config object containing configuration
      // If the result is wrapped in { success: true, config: { ... } }, extract config
      const actualConfig = (configData.config && typeof configData.config === 'object')
        ? configData.config
        : configData;

      // Check if there is a configuration object
      if (!actualConfig.configuration || typeof actualConfig.configuration !== 'object') {
        return toolResult;
      }

      const configuration = actualConfig.configuration;

      // 🔥 Step 1: Process @KOSMOS_ placeholder variables in workspace field (auto-replaced, no user input needed)
      const currentAuth = mainAuthManager.getCurrentAuth();
      const currentUserAlias = currentAuth?.ghcAuth?.alias || '';

      if (currentUserAlias && configuration.workspace && typeof configuration.workspace === 'string') {
        if (containsKosmosPlaceholder(configuration.workspace)) {
          // Replace @KOSMOS_ placeholders in workspace
          configuration.workspace = kosmosPlaceholderManager.replacePlaceholders(
            configuration.workspace,
            { alias: currentUserAlias }
          );

          logger.info('[AgentChat] Replaced KOSMOS placeholders in Agent workspace', 'postProcessForGetAgentConfigFromLibTool', {
            agentName: this.getAgentName(),
            newWorkspace: configuration.workspace
          });
        }
      }

      // 🔥 Step 2: Check if workspace field contains @USER_INPUT_ placeholders
      if (configuration.workspace && typeof configuration.workspace === 'string') {
        const workspaceEnv = { workspace: configuration.workspace };
        const parseResult = userInputPlaceholderParser.parseConfig(workspaceEnv, {
          currentUserAlias: currentUserAlias || undefined
        });

        // If there are fields requiring user input
        if (parseResult.hasUserInputFields) {
          // 🔥 Extract Agent name and contact info
          const agentName = actualConfig.name || 'Agent';
          const agentContact = actualConfig.contact || '';

          logger.info('[AgentChat] Found user input fields in Agent workspace, requesting user info', 'postProcessForGetAgentConfigFromLibTool', {
            userInputFieldsCount: parseResult.fields.length,
            agentName,
            agentContact,
            fields: parseResult.fields.map((f: UserInputField) => ({
              key: f.key,
              type: f.type,
              subtype: f.subtype,
              varName: f.varName
            }))
          });

          // 🔥 Build body.description
          const bodyDescription = agentContact
            ? `Please fill in the following configuration to complete the Agent setup. Contact <strong class="contact-highlight">${agentContact}</strong> for assistance if you need help.`
            : 'Please fill in the following configuration to complete the Agent setup.';

          // 🔥 Build request object conforming to InfoInputRequest interface
          const infoInputRequestData = {
            fields: parseResult.fields.map((field: UserInputField) => ({
              key: field.key,
              label: field.label,
              type: field.type.toLowerCase(),
              subtype: field.subtype.toLowerCase(),
              varName: field.varName,
              required: field.isRequired,
              defaultValue: field.defaultValue
            })),
            header: {
              title: `Configure ${agentName}`
            },
            body: {
              description: bodyDescription
            }
          };

          // Initiate info collection flow
          const userInputs = await this.requestUserInfoInput(infoInputRequestData);

          // Process result based on user's choice
          if (userInputs === null) {
            // User chose "Skip", set workspace to empty string
            configuration.workspace = '';

            logger.info('[AgentChat] User skipped workspace input, setting workspace to empty', 'postProcessForGetAgentConfigFromLibTool', {
              agentName: this.getAgentName()
            });
          } else {
            // User chose "Confirm and continue", apply user input
            for (const field of parseResult.fields) {
              const inputValue = userInputs[field.key];
              const isInputEmpty = inputValue === null || inputValue === undefined || String(inputValue).trim() === '';

              if (!field.isRequired && isInputEmpty) {
                // Optional field with no user input -> set to empty string
                configuration.workspace = '';
              } else if (userInputs.hasOwnProperty(field.key)) {
                // Has input value -> update workspace
                configuration.workspace = String(inputValue);
              }
            }

            logger.info('[AgentChat] User provided workspace input, updated Agent config', 'postProcessForGetAgentConfigFromLibTool', {
              updatedFields: Object.keys(userInputs),
              agentName: this.getAgentName()
            });
          }
        }
      }

      // Return updated result
      return typeof toolResult === 'string'
        ? JSON.stringify(configData, null, 2)
        : configData;

    } catch (error) {
      logger.error('[AgentChat] Error in postProcessForGetAgentConfigFromLibTool', 'postProcessForGetAgentConfigFromLibTool', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.getAgentName()
      });

      // Return original result on error
      return toolResult;
    }
  }
  
  /**
   * 🔥 Refactored: Method to request info input from user
   * Parameters aligned with frontend InfoInputRequest interface (except requestId)
   *
   * @param request - Info collection request (aligned with InfoInputRequest, except requestId)
   *   - fields: List of fields to collect
   *   - header: Title configuration { title: string }
   *   - body: Description configuration { description: string }
   */
  private async requestUserInfoInput(
    request: {
      fields: Array<{
        key: string;
        label: string;
        type: string;
        subtype: string;
        varName: string;
        required: boolean;
        defaultValue?: string;
      }>;
      header: { title: string };
      body: { description: string };
    }
  ): Promise<Record<string, any> | null> {
    logger.info('[AgentChat] Requesting user info input', 'requestUserInfoInput', {
      fieldsCount: request.fields.length,
      headerTitle: request.header.title,
      agentName: this.getAgentName()
    });
    
    return new Promise((resolve) => {
      if (!this.eventSender) {
        logger.error('[AgentChat] No event sender available for info input request', 'requestUserInfoInput', {
          agentName: this.getAgentName()
        });
        // No event sender, return null (equivalent to skip)
        resolve(null);
        return;
      }
      
      const requestId = `info_input_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Create info collection request event, directly using passed header, body, fields
      const infoInputRequest = {
        type: 'user_info_input_request',
        requestId,
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        // 🔥 Directly use passed header and body (built by caller)
        header: request.header,
        body: request.body,
        fields: request.fields
      };
      
      logger.info('[AgentChat] Sending info input request event', 'requestUserInfoInput', {
        requestId,
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        headerTitle: request.header.title,
        fieldsCount: infoInputRequest.fields.length,
        agentName: this.getAgentName()
      });
      
      // Send info collection request to frontend
      this.safeEmitEvent('agentChat:userInfoInputRequest', infoInputRequest);
      
      // Temporarily store response handler, waiting for response
      (global as any).__pendingInfoInputHandlers = (global as any).__pendingInfoInputHandlers || {};
      (global as any).__pendingInfoInputHandlers[requestId] = (response: any) => {
        logger.info('[AgentChat] Received info input response', 'requestUserInfoInput', {
          requestId,
          action: response.action, // 'confirm' | 'skip'
          hasValues: !!response.values,
          agentName: this.getAgentName()
        });
        
        // Clean up handler
        delete (global as any).__pendingInfoInputHandlers[requestId];
        
        // 🔥 New: Notify frontend that response has been processed, can clean up pendingInfoInputRequest
        this.safeEmitEvent('agentChat:userInfoInputResponseProcessed', {
          chatSessionId: this.chatSessionId,
          requestId,
          action: response.action
        });
        
        logger.info('[AgentChat] Sent userInfoInputResponseProcessed notification', 'requestUserInfoInput', {
          chatSessionId: this.chatSessionId,
          requestId,
          agentName: this.getAgentName()
        });
        
        if (response.action === 'continue') {
          resolve(response.userInputs || {});
        } else {
          resolve(null); // skip
        }
      };
      
      logger.info('[AgentChat] Waiting for info input response from frontend', 'requestUserInfoInput', {
        requestId,
        expectedFields: request.fields.length,
        agentName: this.getAgentName()
      });
    });
  }

  async executeToolCall(toolCall: any, approved?: boolean): Promise<any> {
    if (!this.currentModelSupportsTools()) {
      throw new Error(`Model ${this.getCurrentModelId()} does not support tool calls`);
    }

    const { name, arguments: args } = toolCall.function;
    let parsedArgs;

    try {
      // 🔥 Fix: Handle cases where args is empty string, undefined, or null
      // When LLM calls a tool without passing arguments, or arguments are truncated during streaming
      if (!args || (typeof args === 'string' && args.trim() === '')) {
        logger.info('[AgentChat] Tool call with empty arguments, using empty object', 'executeToolCall', {
          toolName: name,
          toolCallId: toolCall.id,
          argsType: typeof args,
          argsValue: args
        });
        parsedArgs = {};  // Default to empty object
      } else {
        // 🔥 New: Detect truncated JSON (common when large tool call output exceeds token limit)
        const trimmedArgs = args.trim();
        const openBraces = (trimmedArgs.match(/{/g) || []).length;
        const closeBraces = (trimmedArgs.match(/}/g) || []).length;
        const openBrackets = (trimmedArgs.match(/\[/g) || []).length;
        const closeBrackets = (trimmedArgs.match(/\]/g) || []).length;
        
        // Detect unclosed quotes (simple detection)
        const quoteCount = (trimmedArgs.match(/(?<!\\)"/g) || []).length;
        const hasUnbalancedQuotes = quoteCount % 2 !== 0;
        
        if (openBraces !== closeBraces || openBrackets !== closeBrackets || hasUnbalancedQuotes) {
          logger.warn('[AgentChat] Detected truncated JSON in tool arguments', 'executeToolCall', {
            toolName: name,
            toolCallId: toolCall.id,
            argsLength: args.length,
            openBraces,
            closeBraces,
            openBrackets,
            closeBrackets,
            hasUnbalancedQuotes,
            argsSample: args.length > 200 ? `${args.substring(0, 100)}...${args.substring(args.length - 100)}` : args
          });
          
          // 🔥 Return structured error instead of throwing exception, letting LLM know arguments were truncated so it can retry
          return {
            success: false,
            error: 'Tool arguments were truncated',
            message: `The tool call arguments appear to be truncated (incomplete JSON). This usually happens when the content is too large. Please try breaking down the task into smaller parts or use a different approach. Detected: ${openBraces} open braces vs ${closeBraces} close braces, ${openBrackets} open brackets vs ${closeBrackets} close brackets.`,
            tool_call_id: toolCall.id,
            tool_name: name,
            truncated: true
          };
        }
        
        parsedArgs = JSON.parse(args);
      }
    } catch (error) {
      logger.error('[AgentChat] Failed to parse tool arguments', 'executeToolCall', {
        toolName: name,
        toolCallId: toolCall.id,
        argsType: typeof args,
        argsValue: args,
        argsLength: args?.length || 0,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // 🔥 Fix: Return structured error instead of throwing exception, avoiding 400 API errors
      // This way the LLM can receive the error info and attempt to correct it
      return {
        success: false,
        error: 'Invalid tool arguments',
        message: `Failed to parse tool arguments: ${error instanceof Error ? error.message : String(error)}. Please ensure the arguments are valid JSON and try again with corrected parameters.`,
        tool_call_id: toolCall.id,
        tool_name: name,
        parseError: true
      };
    }
    
    // 🔥 Modified: If approved parameter is false, return standard rejection Tool Result instead of throwing error
    // This allows pairing with the ToolCall in History
    if (approved === false) {
      logger.warn('[AgentChat] Tool execution denied by user (batch approval)', 'executeToolCall', {
        toolName: name,
        toolCallId: toolCall.id
      });
      
      // 🔥 Return standard Tool Result format, including tool_call_id
      return {
        success: false,
        error: 'Tool execution denied by user',
        message: 'Access to paths outside workspace was rejected by user',
        tool_call_id: toolCall.id,
        tool_name: name,
        denied: true
      };
    }

    // Main process version: Execute MCP tool directly (not through IPC)
    try {
      const { mcpClientManager } = await import('../mcpRuntime/mcpClientManager');
      // Note: Adjust the call based on actual mcpClientManager API
      const result = await mcpClientManager.executeTool({ toolName: name, toolArgs: parsedArgs });
      return result;
    } catch (error) {
      logger.error(`[AgentChat] MCP tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }



  /**
   * 🔄 New: Enable/disable compression
   */
  setCompressionEnabled(enabled: boolean): void {
    // Compression is always enabled, maintaining interface compatibility
  }

  /**
   * 🔄 New: Check if compression is enabled
   */
  isCompressionEnabled(): boolean {
    return !!this.fullModeCompressor;
  }

  /**
   * 🔄 New: Get compression system status
   */
  getCompressionStatus(): {
    enabled: boolean;
    fullModeCompressionReady: boolean;
    currentModel: string;
  } {
    return {
      enabled: true,
      fullModeCompressionReady: !!this.fullModeCompressor,
      currentModel: this.getCurrentModelId()
    };
  }
  
  
  // ====== Model Management ======
  
  // 🔄 Optimized: Removed loadSupportedModels(), using ghcModels methods directly

  /**
   * 🔄 New: Get current model configuration from ghcModels.ts
   */
  private getCurrentModelConfig(modelId: string) {
    const model = getModelById(modelId);
    if (!model) {
      return {
        maxTokens: 4000,
        supportsTemperature: true,
        supportsTools: false,
        supportsImages: false
      };
    }
    
    return {
      maxTokens: model.capabilities.limits?.max_output_tokens || 4000,
      supportsTemperature: !model.capabilities.family.includes('o3') && !model.capabilities.family.includes('o4'),
      supportsTools: model.capabilities.supports.tool_calls || false,
      supportsImages: model.capabilities.supports.vision || false
    };
  }

  getModelCapabilities(modelId: string): GhcModelCapabilities {
    const capabilities = getModelCapabilities(modelId);
    if (!capabilities) {
      throw new GhcApiError(`Model capabilities not found for: ${modelId}`, 404);
    }
    return capabilities;
  }

  currentModelSupportsTools(): boolean {
    const capabilities = this.getModelCapabilities(this.getCurrentModelId());
    return capabilities.supportsTools;
  }
  
  currentModelSupportsImages(): boolean {
    const capabilities = this.getModelCapabilities(this.getCurrentModelId());
    return capabilities.supportsImages;
  }
  
  
  async getSessionFromAuthManager(): Promise<any | null> {
    try {
      const currentAuth = mainAuthManager.getCurrentAuth();
      
      if (currentAuth && currentAuth.ghcAuth) {
        return {
          type: 'ghc',
          accessToken: currentAuth.ghcAuth.copilotTokens?.token || '',
          user: currentAuth.ghcAuth.user
        };
      } else {
        return null;
      }
    } catch (error) {
      logger.error(`[AgentChat] Failed to get session from AuthManager: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  
  // ====== Context Management ======
  
  addContextChangeListener(listener: (stats: ContextStats) => void): void {
    this.contextChangeListeners.push(listener)
    
    if (this.latestContextStats) {
      try {
        listener(this.latestContextStats)
      } catch (error) {
        logger.error(`[AgentChat] Error sending cached stats to new listener: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  removeContextChangeListener(listener: (stats: ContextStats) => void): void {
    const index = this.contextChangeListeners.indexOf(listener)
    if (index > -1) {
      this.contextChangeListeners.splice(index, 1)
    }
  }

  /**
   * 🔄 New: Shared method for calculating three-component token consumption
   * contextHistory + systemPrompt + tools
   */
  private async calculateThreeComponentTokens(contextHistory?: Message[]): Promise<{
    contextHistoryTokens: number;
    systemPromptTokens: number;
    toolsTokens: number;
    totalTokens: number;
  }> {
    const currentContextHistory = contextHistory || this.getContextHistory();
    
    // Analyze image content in contextHistory
    const imageMessages = currentContextHistory.filter((msg: Message) => {
      if (!msg.content || !Array.isArray(msg.content)) return false;
      return msg.content.some((part: any) => part && part.type === 'image_url');
    });
    
    if (imageMessages.length > 0) {
    }
    
    // 1. contextHistory tokens (new TokenCounter API is synchronous)
    const contextHistoryTokens = this.tokenCounter.countMessagesTokens(currentContextHistory);
    
    // 2. systemPrompt tokens
    let systemPromptTokens = 0;
    const systemMessages = this.getCombinedSystemPromptForContext();
    if (systemMessages.length > 0) {
      systemPromptTokens = this.tokenCounter.countMessagesTokens(systemMessages);
    }
    
    // 3. tools tokens (using TokenCounter's countToolsTokens method)
    let toolsTokens = 0;
    const currentTools = await this.getCurrentAvailableTools();
    if (currentTools.length > 0) {
      const toolsResult = this.tokenCounter.countToolsTokens(currentTools);
      toolsTokens = toolsResult.totalTokens;
    }
    
    // Total tokens = contextHistory + systemPrompt + tools (three components)
    const totalTokens = contextHistoryTokens + systemPromptTokens + toolsTokens;
    
    // 🔥 Enhanced debug: Output detailed token calculation results
    
    return {
      contextHistoryTokens,
      systemPromptTokens,
      toolsTokens,
      totalTokens
    };
  }

  /**
   * 🔄 Rewritten: Calculate and notify context changes - using real token calculation
   * 🔥 Changed to public, allowing external triggering of recalculation (e.g., after mainWindow is ready)
   * 🔥 New: Also updates the contextTokenUsage private variable
   */
  async calculateAndNotifyContext(): Promise<void> {
    const contextHistory = this.getContextHistory()
    
    try {
      // Use shared three-component calculation method
      const tokens = await this.calculateThreeComponentTokens();
      
      
      // Immediately notify listeners
      const chatHistory = this.getChatHistory()
      const systemMessages = this.getCombinedSystemPromptForContext()
      const contextStats: ContextStats = {
        totalMessages: systemMessages.length + chatHistory.length,
        contextMessages: contextHistory.length,
        tokenCount: tokens.totalTokens,
        compressionRatio: 1.0 // Compression is handled in formatMessagesForApiWithCompression
      };
      
      // 🔥 New: Update contextTokenUsage cache
      this.contextTokenUsage = {
        tokenCount: contextStats.tokenCount,
        totalMessages: contextStats.totalMessages,
        contextMessages: contextStats.contextMessages,
        compressionRatio: contextStats.compressionRatio
      };
      
      this.notifyContextChange(contextStats);
    } catch (error) {
      logger.error('[AgentChat] Failed to calculate context tokens', 'AgentChat.calculateAndNotifyContext', error)
      // Use simple estimation as fallback
      const estimatedContextHistoryTokens = contextHistory.length * 50
      const systemMessages = this.getCombinedSystemPromptForContext()
      const estimatedSystemPromptTokens = systemMessages.length * 50
      const estimatedToolsTokens = (await this.getCurrentAvailableTools()).length * 100
      const estimatedTotal = estimatedContextHistoryTokens + estimatedSystemPromptTokens + estimatedToolsTokens
      
      
      const chatHistory = this.getChatHistory()
      const fallbackStats: ContextStats = {
        totalMessages: systemMessages.length + chatHistory.length,
        contextMessages: contextHistory.length,
        tokenCount: estimatedTotal,
        compressionRatio: 1.0
      };
      
      // 🔥 New: Update contextTokenUsage even on error (using estimated values)
      this.contextTokenUsage = {
        tokenCount: fallbackStats.tokenCount,
        totalMessages: fallbackStats.totalMessages,
        contextMessages: fallbackStats.contextMessages,
        compressionRatio: fallbackStats.compressionRatio
      };
      
      this.notifyContextChange(fallbackStats);
    }
  }

  private notifyContextChange(stats: ContextStats): void {
    this.latestContextStats = { ...stats }
    
    if (this.contextChangeListeners.length === 0) {
      return;
    }
    
    this.contextChangeListeners.forEach((listener, index) => {
      try {
        listener(stats)
      } catch (error) {
        logger.error(`[AgentChat] Context change listener ${index} error: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  
  /**
   * 🔥 New: Get the latest ContextTokenUsage
   * Called by AgentChatManager for notifying frontend cache
   */
  getContextTokenUsage(): ContextTokenUsage | null {
    return this.contextTokenUsage;
  }
  
  getDisplayMessages(): Message[] {
    const chatHistory = this.getChatHistory()
    const customSystemPrompt = this.getLatestCustomSystemPrompt()
    return [...customSystemPrompt, ...chatHistory]
  }
  
  // ====== Agent Management ======
  
  async getAgentInfo() {
    // 🔥 Fully relies on dynamically fetching the latest configuration
    const latestConfig = this.getLatestAgentConfig();
    
    if (!latestConfig) {
      throw new Error(`Cannot get agent info: no config available for userAlias=${this.currentUserAlias}, chatId=${this.chatId}`);
    }
    
    const tools = await this.getCurrentAvailableTools();
    return {
      role: latestConfig.role,
      emoji: latestConfig.emoji,
      name: latestConfig.name,
      model: latestConfig.model,
      mcpServers: latestConfig.mcp_servers,
      systemPrompt: latestConfig.system_prompt,
      currentModel: this.getCurrentModelId(),
      toolsCount: tools.length,
      chatHistoryLength: this.getChatHistory().length,
      systemMessagesCount: this.getSystemMessages().length
    }
  }
  
  
  // 🔥 New: Set event sender
  setEventSender(sender: Electron.WebContents | null): void {
    this.eventSender = sender;
  }
  
  /**
   * 🔥 Modified: Method to send streaming chunks - removed filtering, all chunks are sent
   */
  private emitStreamingChunk(chunk: any): void {
    if (!this.eventSender) {
      return; // No event sender, return directly
    }
    
    // Send chunk without filtering
    this.eventSender.send('agentChat:streamingChunk', chunk);
  }
  
  destroy(): void {
    
    this.setChatStatus(ChatStatus.IDLE)  // 🔥 New: Reset chat status to idle
    this.contextChangeListeners = []
    this.latestContextStats = null
    // 🔥 No longer need to clean up systemMessages, as they are dynamically fetched
    if (this.currentChatSession) {
      this.currentChatSession.chat_history = []
      this.currentChatSession.context_history = []
      this.currentChatSession.last_updated = new Date().toISOString()
    }
    this.eventSender = null
  }
  
  /**
   * 🔥 New: Clean up incomplete tool calls
   * When cancelling an operation, handle unexecuted tool_calls in the last assistant message
   * 
   * Processing logic:
   * 1. Find executed tools (have corresponding tool message)
   * 2. Find unexecuted tools (no corresponding tool message)
   * 3. Only keep executed tool_calls, remove unexecuted ones
   * 4. If no tools were executed and content is empty, delete the entire assistant message
   * 5. Also clean up orphaned tool messages (without corresponding tool_call)
   */
  private async cleanupIncompleteToolCalls(): Promise<void> {
    try {
      if (!this.currentChatSession) {
        return;
      }
      
      const chatHistory = this.currentChatSession.chat_history;
      const contextHistory = this.currentChatSession.context_history;
      
      if (chatHistory.length === 0) {
        return;
      }
      
      // 1. Find the last assistant message with tool_calls
      let lastAssistantIndex = -1;
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          lastAssistantIndex = i;
          break;
        }
      }
      
      if (lastAssistantIndex === -1) {
        return; // No assistant message with tool calls found
      }
      
      const lastAssistantMessage = chatHistory[lastAssistantIndex];
      const toolCalls = lastAssistantMessage.tool_calls || [];
      
      // 2. Check if each tool_call has a corresponding tool message
      const executedToolCallIds = new Set<string>();
      const unexecutedToolCallIds = new Set<string>();
      
      for (const toolCall of toolCalls) {
        const hasToolMessage = chatHistory.some((msg, idx) =>
          idx > lastAssistantIndex &&
          msg.role === 'tool' &&
          msg.tool_call_id === toolCall.id
        );
        
        if (hasToolMessage) {
          executedToolCallIds.add(toolCall.id);
        } else {
          unexecutedToolCallIds.add(toolCall.id);
        }
      }
      
      logger.info('[AgentChat] Analyzing tool calls for cleanup', 'cleanupIncompleteToolCalls', {
        agentName: this.getAgentName(),
        totalToolCalls: toolCalls.length,
        executedCount: executedToolCallIds.size,
        unexecutedCount: unexecutedToolCallIds.size,
        executedToolCallIds: Array.from(executedToolCallIds),
        unexecutedToolCallIds: Array.from(unexecutedToolCallIds)
      });
      
      // 3. If all tools were executed, no cleanup needed
      if (unexecutedToolCallIds.size === 0) {
        logger.info('[AgentChat] All tool calls executed, no cleanup needed', 'cleanupIncompleteToolCalls', {
          agentName: this.getAgentName()
        });
        return;
      }
      
      // 4. Handle partially executed or fully unexecuted cases
      let needsUpdate = false;
      
      if (executedToolCallIds.size > 0) {
        // Case A: Some tools were executed - only keep executed tool_calls
        const executedToolCalls = toolCalls.filter(tc => executedToolCallIds.has(tc.id));
        
        const cleanedMessage = {
          ...lastAssistantMessage,
          tool_calls: executedToolCalls
        };
        
        this.currentChatSession.chat_history[lastAssistantIndex] = cleanedMessage;
        
        // Sync update context_history
        const contextIndex = contextHistory.findIndex(msg => msg.id === lastAssistantMessage.id);
        if (contextIndex !== -1) {
          this.currentChatSession.context_history[contextIndex] = cleanedMessage;
        }
        
        logger.info('[AgentChat] Kept executed tool calls, removed unexecuted ones', 'cleanupIncompleteToolCalls', {
          agentName: this.getAgentName(),
          messageId: lastAssistantMessage.id,
          keptToolCalls: executedToolCallIds.size,
          removedToolCalls: unexecutedToolCallIds.size
        });
        
        needsUpdate = true;
      } else {
        // Case B: All tools unexecuted - check if content is empty
        const messageContent = MessageHelper.getText(lastAssistantMessage).trim();
        
        if (!messageContent || messageContent.length === 0) {
          // B1: Content is empty, delete entire assistant message
          this.currentChatSession.chat_history.splice(lastAssistantIndex, 1);
          
          // Sync delete from context_history
          const contextIndex = contextHistory.findIndex(msg => msg.id === lastAssistantMessage.id);
          if (contextIndex !== -1) {
            this.currentChatSession.context_history.splice(contextIndex, 1);
          }
          
          logger.info('[AgentChat] Deleted assistant message with no executed tools and empty content', 'cleanupIncompleteToolCalls', {
            agentName: this.getAgentName(),
            messageId: lastAssistantMessage.id,
            removedToolCalls: unexecutedToolCallIds.size
          });
          
          needsUpdate = true;
        } else {
          // B2: Content is not empty, remove tool_calls but keep content
          const cleanedMessage = {
            ...lastAssistantMessage,
            tool_calls: undefined
          };
          
          this.currentChatSession.chat_history[lastAssistantIndex] = cleanedMessage;
          
          // Sync update context_history
          const contextIndex = contextHistory.findIndex(msg => msg.id === lastAssistantMessage.id);
          if (contextIndex !== -1) {
            this.currentChatSession.context_history[contextIndex] = cleanedMessage;
          }
          
          logger.info('[AgentChat] Removed all unexecuted tool calls, kept content', 'cleanupIncompleteToolCalls', {
            agentName: this.getAgentName(),
            messageId: lastAssistantMessage.id,
            removedToolCalls: unexecutedToolCallIds.size,
            contentLength: messageContent.length
          });
          
          needsUpdate = true;
        }
      }
      
      // 5. 🔥 Clean up orphaned tool messages (if assistant message was deleted)
      if (executedToolCallIds.size === 0 && (!MessageHelper.getText(lastAssistantMessage).trim())) {
        // Assistant message was deleted, need to clean up all its corresponding tool messages
        const toolCallIdsToClean = new Set(toolCalls.map(tc => tc.id));
        
        // Delete from back to front to avoid index shifting issues
        for (let i = chatHistory.length - 1; i > lastAssistantIndex; i--) {
          const msg = chatHistory[i];
          if (msg.role === 'tool' && msg.tool_call_id && toolCallIdsToClean.has(msg.tool_call_id)) {
            this.currentChatSession.chat_history.splice(i, 1);
            
            // Sync delete from context_history
            const contextIndex = contextHistory.findIndex(m => m.id === msg.id);
            if (contextIndex !== -1) {
              this.currentChatSession.context_history.splice(contextIndex, 1);
            }
            
            logger.info('[AgentChat] Removed orphaned tool message', 'cleanupIncompleteToolCalls', {
              agentName: this.getAgentName(),
              toolMessageId: msg.id,
              toolCallId: msg.tool_call_id
            });
          }
        }
      }
      
      // 6. Save updates
      if (needsUpdate) {
        await this.saveChatSession();
        logger.info('[AgentChat] ✅ Cleanup completed and saved', 'cleanupIncompleteToolCalls', {
          agentName: this.getAgentName()
        });
      }
      
    } catch (error) {
      logger.error('[AgentChat] Error cleaning up incomplete tool calls', 'cleanupIncompleteToolCalls', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agentName: this.getAgentName()
      });
    }
  }
  
  /**
   * 🔥 New: Exit New Chat Session state
   * After the first user message is saved successfully, notify AgentChatManager to remove the mapping from newChatSessionIdForChatId
   */
  private exitNewChatSessionState(): void {
    try {
      // Import AgentChatManager singleton
      const { agentChatManager } = require('./agentChatManager');
      
      // Call AgentChatManager's exit method
      agentChatManager.exitNewChatSessionFor(this.chatId, this.chatSessionId);
      
      logger.info('[AgentChat] ✅ Exited New Chat Session state', 'exitNewChatSessionState', {
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        agentName: this.getAgentName()
      });
    } catch (error) {
      logger.error('[AgentChat] Failed to exit New Chat Session state', 'exitNewChatSessionState', {
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        agentName: this.getAgentName(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

}
