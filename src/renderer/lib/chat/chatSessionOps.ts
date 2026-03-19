/**
 * Chat Session Operations (Coordination layer refactored version)
 *
 * Frontend ChatSession operations coordination layer, only interacts with ProfileCacheManager, provides unified operation interface:
 * 1. saveChatSession - Unified save method (automatically determines add/update)
 * 2. deleteChatSession - Unified delete method
 * 3. getChatSessionFile - Get complete data (renamed to align with main process method name)
 *
 * New architecture notes:
 * - Frontend ChatSessionOpsManager serves as coordination layer: only interacts with ProfileCacheManager
 * - ProfileCacheManager handles all ChatSession metadata and file management
 * - No longer interacts directly with ChatSessionFileOps
 *
 * Parameter notes:
 * - All methods require alias and chat_id parameters
 * - saveChatSession automatically determines add or update via existChatSession
 */

import { ChatSessionFile } from '../../../main/lib/userDataADO/chatSessionFileOps';

/**
 * ChatSession operation result interface
 */
export interface ChatSessionOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * ChatSession list item interface (metadata obtained from ProfileCacheManager)
 */
export interface ChatSessionListItem {
  chatSession_id: string;
  last_updated: string;
  title: string;
}

/**
 * Complete ChatSession data interface (obtained from main process ChatSessionOps)
 * Now directly uses the main process ChatSessionFile type, format is unified
 */
export type ChatSessionCompleteData = ChatSessionFile;

/**
 * Frontend ChatSession operations manager
 * 
 * Provides 5 core features using dual backend architecture:
 * - ProfileCacheManager: Metadata management
 * - Main process ChatSessionOps: File operations
 */
export class ChatSessionOpsManager {
  private static instance: ChatSessionOpsManager;

  private constructor() {}

  static getInstance(): ChatSessionOpsManager {
    if (!ChatSessionOpsManager.instance) {
      ChatSessionOpsManager.instance = new ChatSessionOpsManager();
    }
    return ChatSessionOpsManager.instance;
  }

  /**
   * Validate IPC API availability (changed to only check ProfileCacheManager-related APIs)
   */
  private validateAPI(): boolean {
    const electronAPI = (window as any).electronAPI;
    return !!(
      electronAPI?.profile?.existChatSession &&
      electronAPI?.profile?.addChatSession &&
      electronAPI?.profile?.updateChatSession &&
      electronAPI?.profile?.deleteChatSession &&
      electronAPI?.profile?.getChatSessionFile &&
      electronAPI?.profile?.getChatSessions
    );
  }

  /**
   * Generate ChatSession ID
   */
  private generateChatSessionId(): string {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    return `chatSession_${timestamp}`;
  }

  /**
   * Unified save ChatSession method (automatically determines add/update)
   * Only calls ProfileCacheManager methods: existChatSession => addChatSession or updateChatSession
   * Parameters must include alias, chat_id
   */
  async saveChatSession(alias: string, chatId: string, chatSession: ChatSessionFile): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Update timestamp
      const updatedChatSession = {
        ...chatSession,
        last_updated: new Date().toISOString()
      };

      // Step 1: Check if ChatSession exists via ProfileCacheManager
      const existResult = await (window as any).electronAPI.profile.existChatSession(
        alias,
        chatId,
        {
          chatSession_id: updatedChatSession.chatSession_id,
          last_updated: updatedChatSession.last_updated,
          title: updatedChatSession.title
        }
      );

      if (!existResult.success) {
        return {
          success: false,
          error: `Failed to check session existence: ${existResult.error}`
        };
      }

      const isExisting = existResult.data;

      // Step 2: Call the corresponding ProfileCacheManager method based on existence
      let result;
      if (isExisting) {
        // Update existing ChatSession
        result = await (window as any).electronAPI.profile.updateChatSession(
          alias,
          chatId,
          updatedChatSession.chatSession_id,
          {
            chatSession_id: updatedChatSession.chatSession_id,
            last_updated: updatedChatSession.last_updated,
            title: updatedChatSession.title
          },
          updatedChatSession
        );
      } else {
        // Add new ChatSession
        result = await (window as any).electronAPI.profile.addChatSession(
          alias,
          chatId,
          {
            chatSession_id: updatedChatSession.chatSession_id,
            last_updated: updatedChatSession.last_updated,
            title: updatedChatSession.title
          },
          updatedChatSession
        );
      }

      if (!result.success) {
        return {
          success: false,
          error: `Failed to ${isExisting ? 'update' : 'add'} ChatSession: ${result.error}`
        };
      }

      return {
        success: true,
        data: updatedChatSession
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Unified delete ChatSession method
   * Only calls ProfileCacheManager's deleteChatSession, parameters must include alias, chat_id
   */
  async deleteChatSession(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to delete ChatSession (handles both metadata and file)
      const result = await (window as any).electronAPI.profile.deleteChatSession(
        alias,
        chatId,
        sessionId
      );

      if (!result.success) {
        return {
          success: false,
          error: `Failed to delete ChatSession: ${result.error}`
        };
      }

      return {
        success: true,
        data: { sessionId }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get ChatSession list
   * Calls ProfileCacheManager to get list (session id, last updated, session title)
   */
  async getChatSessionList(alias: string, chatId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to get session list
      const result = await (window as any).electronAPI.profile.getChatSessions(
        alias,
        chatId
      );

      if (!result.success) {
        return {
          success: false,
          error: `Failed to get session list: ${result.error}`
        };
      }

      // Convert to standard format
      const sessionList: ChatSessionListItem[] = (result.data || []).map((session: any) => ({
        chatSession_id: session.chatSession_id,
        last_updated: session.last_updated,
        title: session.title
      }));

      return {
        success: true,
        data: sessionList
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get complete data for a specified ChatSession (renamed to getChatSessionFile, aligned with main process method name)
   * 🔥 New architecture: requires chatId parameter to locate ChatSession file
   * Only calls ProfileCacheManager's getChatSessionFile, parameters must include alias and chatId
   */
  async getChatSessionFile(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to get complete ChatSession file data
      const result = await (window as any).electronAPI.profile.getChatSessionFile(
        alias,
        chatId,
        sessionId
      );

      if (!result.success) {
        return {
          success: false,
          error: `Failed to get ChatSession file: ${result.error}`
        };
      }

      return {
        success: true,
        data: result.data as ChatSessionFile
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // ========== Convenience Methods ==========

  /**
   * Create a new ChatSession (convenience method)
   */
  async createNewChatSession(alias: string, chatId: string, title: string = 'New Chat'): Promise<ChatSessionOperationResult> {
    const sessionId = this.generateChatSessionId();
    const newChatSession: ChatSessionFile = {
      chatSession_id: sessionId,
      last_updated: new Date().toISOString(),
      title: title,
      chat_history: [],
      context_history: []
    };
    return await this.saveChatSession(alias, chatId, newChatSession);
  }

  /**
   * Validate ChatSession ID format
   */
  isValidChatSessionId(sessionId: string): boolean {
    return /^chatSession_\d{14}$/.test(sessionId);
  }
}

// Export singleton instance
export const chatSessionOps = ChatSessionOpsManager.getInstance();

// ========== Convenience Functions ==========

/**
 * Save ChatSession (add or update)
 */
export async function saveChatSession(alias: string, chatId: string, chatSession: ChatSessionFile): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.saveChatSession(alias, chatId, chatSession);
}

/**
 * Delete ChatSession
 */
export async function deleteChatSession(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.deleteChatSession(alias, chatId, sessionId);
}

/**
 * Get ChatSession list
 */
export async function getChatSessionList(alias: string, chatId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.getChatSessionList(alias, chatId);
}

/**
 * Get complete data for a specified ChatSession (renamed to getChatSessionFile)
 * 🔥 New architecture: requires chatId parameter to locate ChatSession file
 */
export async function getChatSessionFile(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.getChatSessionFile(alias, chatId, sessionId);
}

/**
 * Create new ChatSession (convenience function)
 */
export async function createNewChatSession(alias: string, chatId: string, title?: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.createNewChatSession(alias, chatId, title);
}

/**
 * Validate ChatSession ID format
 */
export function isValidChatSessionId(sessionId: string): boolean {
  return chatSessionOps.isValidChatSessionId(sessionId);
}