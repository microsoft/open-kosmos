/**
 * Chat Configuration Operations
 *
 * This module provides frontend APIs for Chat configuration management in V2 profiles.
 * It communicates directly with ProfileCacheManager through IPC for data persistence.
 *
 * Key Features:
 * - Chat configuration CRUD operations
 * - Chat agent management
 * - Direct integration with ProfileCacheManager
 * - Type-safe chat operations
 * - Error handling and validation
 */

import { ChatConfig, ChatAgent, DEFAULT_CHAT_AGENT } from '../../../main/lib/userDataADO/types/profile';
import { buildChatId } from '../../../shared/utils/idFormats';

/**
 * Chat operation result interface
 */
export interface ChatOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Chat info for UI display
 */
export interface ChatInfo {
  chat_id: string;
  chat_type: 'single_agent' | 'multi_agent';
  agent?: ChatAgent;
  agents?: ChatAgent[];
  displayName: string;
  agentCount: number;
}

/**
 * Generate unique chat ID
 */
async function generateChatId(): Promise<string> {
  const deviceId = await (window as any).electronAPI?.getInstallationDeviceId?.();
  return buildChatId(deviceId || 'unknown-device');
}

/**
 * Chat Operations Manager
 *
 * Provides high-level APIs for managing Chat configurations through IPC communication
 * with ProfileCacheManager in the main process.
 */
export class ChatOpsManager {
  private static instance: ChatOpsManager;
  private currentUserAlias: string | null = null;

  private constructor() {}

  static getInstance(): ChatOpsManager {
    if (!ChatOpsManager.instance) {
      ChatOpsManager.instance = new ChatOpsManager();
    }
    return ChatOpsManager.instance;
  }

  /**
   * Initialize the manager with current user alias
   */
  initialize(userAlias: string): void {
    this.currentUserAlias = userAlias;
  }

  /**
   * Clear current user context (for sign out)
   */
  cleanup(): void {
    this.currentUserAlias = null;
  }

  /**
   * Validate that user is authenticated
   */
  private validateUser(): string {
    if (!this.currentUserAlias) {
      throw new Error('No user authenticated. Please sign in first.');
    }
    return this.currentUserAlias;
  }

  /**
   * Check if Chat Config APIs are available
   */
  private validateAPI(): boolean {
    return !!(window as any).electronAPI?.profile?.addChatConfig &&
           !!(window as any).electronAPI?.profile?.updateChatConfig &&
           !!(window as any).electronAPI?.profile?.deleteChatConfig &&
           !!(window as any).electronAPI?.profile?.getChatConfig &&
           !!(window as any).electronAPI?.profile?.getAllChatConfigs &&
           !!(window as any).electronAPI?.profile?.updateChatAgent;
  }

  /**
   * Add a new chat configuration
   */
  async addChatConfig(chatConfig: Partial<ChatConfig>): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      // Generate chat ID if not provided
      const finalChatConfig: ChatConfig = {
        chat_id: chatConfig.chat_id || await generateChatId(),
        chat_type: chatConfig.chat_type || 'single_agent',
        ...(chatConfig.agent && { agent: { ...chatConfig.agent, workspace: chatConfig.agent.workspace || '' } }),
        ...(chatConfig.agents && { agents: chatConfig.agents })
      };

      // Ensure agent exists for single_agent type
      if (finalChatConfig.chat_type === 'single_agent' && !finalChatConfig.agent) {
        finalChatConfig.agent = { ...DEFAULT_CHAT_AGENT, workspace: '' };
      }

      const result = await (window as any).electronAPI.profile.addChatConfig(finalChatConfig);

      if (result.success) {
        return {
          success: true,
          data: finalChatConfig
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to add chat configuration'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update an existing chat configuration
   */
  async updateChatConfig(chatId: string, updates: Partial<ChatConfig>): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      if (!chatId || chatId.trim() === '') {
        return {
          success: false,
          error: 'Chat ID is required'
        };
      }

      const result = await (window as any).electronAPI.profile.updateChatConfig(chatId, updates);

      if (result.success) {
        return {
          success: true,
          data: { chatId, updates }
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to update chat configuration'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete a chat configuration
   */
  async deleteChatConfig(chatId: string): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      if (!chatId || chatId.trim() === '') {
        return {
          success: false,
          error: 'Chat ID is required'
        };
      }

      const result = await (window as any).electronAPI.profile.deleteChatConfig(chatId);

      if (result.success) {
        return {
          success: true,
          data: { chatId }
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to delete chat configuration'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get a specific chat configuration by ID
   */
  async getChatConfig(chatId: string): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      if (!chatId || chatId.trim() === '') {
        return {
          success: false,
          error: 'Chat ID is required'
        };
      }

      const result = await (window as any).electronAPI.profile.getChatConfig(chatId);

      if (result.success) {
        return {
          success: true,
          data: result.data
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to get chat configuration'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all chat configurations
   */
  async getAllChatConfigs(): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      const result = await (window as any).electronAPI.profile.getAllChatConfigs();

      if (result.success) {
        return {
          success: true,
          data: result.data || []
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to get chat configurations'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update chat agent configuration
   */
  async updateChatAgent(chatId: string, agentUpdates: Partial<ChatAgent>): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Chat Config API not available'
        };
      }

      if (!chatId || chatId.trim() === '') {
        return {
          success: false,
          error: 'Chat ID is required'
        };
      }

      const result = await (window as any).electronAPI.profile.updateChatAgent(chatId, agentUpdates);

      if (result.success) {
        return {
          success: true,
          data: { chatId, agentUpdates }
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to update chat agent'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get chat information formatted for UI display
   */
  async getChatInfoList(): Promise<ChatOperationResult> {
    try {
      const result = await this.getAllChatConfigs();
      if (!result.success) {
        return result;
      }

      const chatConfigs: ChatConfig[] = result.data;
      const chatInfoList: ChatInfo[] = chatConfigs.map(config => {
        let displayName = config.chat_id;
        let agentCount = 0;

        if (config.chat_type === 'single_agent' && config.agent) {
          displayName = `${config.agent.emoji} ${config.agent.name}`;
          agentCount = 1;
        } else if (config.chat_type === 'multi_agent' && config.agents) {
          const agentNames = config.agents.map(agent => agent.name).join(', ');
          displayName = `Multi-Agent: ${agentNames}`;
          agentCount = config.agents.length;
        }

        return {
          chat_id: config.chat_id,
          chat_type: config.chat_type,
          agent: config.agent,
          agents: config.agents,
          displayName,
          agentCount
        };
      });

      return {
        success: true,
        data: chatInfoList
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create a default single-agent chat
   */
  async createDefaultChat(customAgent?: Partial<ChatAgent>): Promise<ChatOperationResult> {
    const defaultChatConfig: ChatConfig = {
      chat_id: await generateChatId(),
      chat_type: 'single_agent',
      agent: {
        ...DEFAULT_CHAT_AGENT,
        workspace: '', // 🔄 workspace is now at the agent level; the backend will automatically set the default path
        ...customAgent
      }
    };

    return await this.addChatConfig(defaultChatConfig);
  }

  /**
   * Duplicate an existing chat configuration with independent knowledge and scheduled tasks
   */
  async duplicateChatConfig(chatId: string, newName?: string): Promise<ChatOperationResult> {
    try {
      this.validateUser();

      if (!this.validateAPI()) {
        return { success: false, error: 'Chat Config API not available' };
      }

      const agentName = newName?.trim() || 'Agent Copy';
      const result = await (window as any).electronAPI.profile.duplicateChatConfig(chatId, agentName);

      if (result.success) {
        return { success: true, data: { chat_id: result.newChatId, knowledgeCopyFailed: result.knowledgeCopyFailed, scheduleCopyFailed: result.scheduleCopyFailed } };
      } else {
        return { success: false, error: result.error || 'Failed to duplicate agent' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

}

// Export singleton instance
export const chatOps = ChatOpsManager.getInstance();

/**
 * Convenience functions for common operations
 */

/**
 * Add a new chat configuration
 */
export async function addChat(chatConfig: Partial<ChatConfig>): Promise<ChatOperationResult> {
  return await chatOps.addChatConfig(chatConfig);
}

/**
 * Update chat configuration
 */
export async function updateChat(chatId: string, updates: Partial<ChatConfig>): Promise<ChatOperationResult> {
  return await chatOps.updateChatConfig(chatId, updates);
}

/**
 * Delete chat configuration
 */
export async function deleteChat(chatId: string): Promise<ChatOperationResult> {
  return await chatOps.deleteChatConfig(chatId);
}

/**
 * Get chat configuration
 */
export async function getChat(chatId: string): Promise<ChatOperationResult> {
  return await chatOps.getChatConfig(chatId);
}

/**
 * Get all chat configurations
 */
export async function getAllChats(): Promise<ChatOperationResult> {
  return await chatOps.getAllChatConfigs();
}

/**
 * Update chat agent
 */
export async function updateAgent(chatId: string, agentUpdates: Partial<ChatAgent>): Promise<ChatOperationResult> {
  return await chatOps.updateChatAgent(chatId, agentUpdates);
}

/**
 * Update chat agent (alias for updateAgent)
 */
export async function updateChatAgent(chatId: string, agentUpdates: Partial<ChatAgent>): Promise<ChatOperationResult> {
  return await chatOps.updateChatAgent(chatId, agentUpdates);
}

/**
 * Get formatted chat list for UI
 */
export async function getChatList(): Promise<ChatOperationResult> {
  return await chatOps.getChatInfoList();
}

/**
 * Create default chat
 */
export async function createDefaultChat(customAgent?: Partial<ChatAgent>): Promise<ChatOperationResult> {
  return await chatOps.createDefaultChat(customAgent);
}

/**
 * Duplicate chat
 */
export async function duplicateChat(chatId: string, newName?: string): Promise<ChatOperationResult> {
  return await chatOps.duplicateChatConfig(chatId, newName);
}