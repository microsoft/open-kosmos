/**
 * Chat Session Operations (coordination layer refactor)
 *
 * Frontend ChatSession operation coordination layer; interacts only with ProfileCacheManager
 * and provides a unified operation interface:
 * 1. saveChatSession - unified save method (auto-detects add vs. update)
 * 2. deleteChatSession - unified delete method
 * 3. getChatSessionFile - get complete data (renamed to align with main-process method name)
 *
 * New architecture notes:
 * - Frontend ChatSessionOpsManager acts as a coordination layer: only talks to ProfileCacheManager
 * - ProfileCacheManager handles all ChatSession metadata and file management
 * - No longer interacts directly with ChatSessionFileOps
 *
 * Parameter notes:
 * - All methods require alias and chat_id parameters
 * - saveChatSession auto-determines add vs. update via existChatSession
 */

import { ChatSessionFile } from '../../../main/lib/userDataADO/chatSessionFileOps';
import { buildChatSessionId, isValidChatSessionIdFormat } from '../../../shared/utils/idFormats';

/**
 * ChatSession operation result interface
 */
export interface ChatSessionOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * ChatSession list item interface (metadata from ProfileCacheManager)
 */
export interface ChatSessionListItem {
  chatSession_id: string;
  last_updated: string;
  title: string;
}

/**
 * Complete ChatSession data interface (from main-process ChatSessionOps)
 * Now uses the main-process ChatSessionFile type directly; formats are unified
 */
export type ChatSessionCompleteData = ChatSessionFile;

/**
 * Frontend ChatSession operations manager
 *
 * Provides 5 core functions using a dual-backend architecture:
 * - ProfileCacheManager: metadata management
 * - Main-process ChatSessionOps: file operations
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
   * Validate IPC API availability
   */
  private validateAPI(): boolean {
    const electronAPI = (window as any).electronAPI;
    return !!(
      electronAPI?.profile?.saveChatSession &&
      electronAPI?.profile?.deleteChatSession &&
      electronAPI?.profile?.getChatSessionFile &&
      electronAPI?.profile?.getChatSessions
    );
  }

  /**
   * Generate a ChatSession ID
   */
  private async generateChatSessionId(): Promise<string> {
    const deviceId = await (window as any).electronAPI?.getInstallationDeviceId?.();
    return buildChatSessionId(deviceId || 'unknown-device');
  }

  /**
   * Unified ChatSession save method
   * Calls a single main-process save IPC; the backend store determines whether to create or update
   */
  async saveChatSession(alias: string, chatId: string, chatSession: ChatSessionFile): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      const updatedChatSession = {
        ...chatSession,
        last_updated: new Date().toISOString()
      };

      const result = await (window as any).electronAPI.profile.saveChatSession(
        alias,
        chatId,
        updatedChatSession
      );

      if (!result.success) {
        return {
          success: false,
          error: `Failed to save ChatSession: ${result.error}`
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
   * Unified ChatSession delete method
   * Calls only ProfileCacheManager's deleteChatSession; parameters must include alias and chat_id
   */
  async deleteChatSession(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to delete the ChatSession (handles both metadata and file)
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
   * Get the ChatSession list
   * Calls ProfileCacheManager to get the list (session id, last updated, session title)
   */
  async getChatSessionList(alias: string, chatId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to get the session list
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
   * Get complete data for the specified ChatSession (renamed to getChatSessionFile to align with main-process method name)
   * 🔥 New architecture: requires a chatId parameter to locate the ChatSession file
   * Calls only ProfileCacheManager's getChatSessionFile; parameters must include alias and chatId
   */
  async getChatSessionFile(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'ProfileCacheManager API not available'
        };
      }

      // Call ProfileCacheManager to get the complete ChatSession file data
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

  // ========== Convenience methods ==========

  /**
   * Create a new ChatSession (convenience method)
   */
  async createNewChatSession(alias: string, chatId: string, title: string = 'New Chat'): Promise<ChatSessionOperationResult> {
    const sessionId = await this.generateChatSessionId();
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
    return isValidChatSessionIdFormat(sessionId);
  }
}

// Export singleton instance
export const chatSessionOps = ChatSessionOpsManager.getInstance();

// ========== Convenience functions ==========

/**
 * Save a ChatSession (add or update)
 */
export async function saveChatSession(alias: string, chatId: string, chatSession: ChatSessionFile): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.saveChatSession(alias, chatId, chatSession);
}

/**
 * Delete a ChatSession
 */
export async function deleteChatSession(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.deleteChatSession(alias, chatId, sessionId);
}

/**
 * Get the ChatSession list
 */
export async function getChatSessionList(alias: string, chatId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.getChatSessionList(alias, chatId);
}

/**
 * Get complete data for the specified ChatSession (renamed to getChatSessionFile)
 * 🔥 New architecture: requires chatId parameter to locate the ChatSession file
 */
export async function getChatSessionFile(alias: string, chatId: string, sessionId: string): Promise<ChatSessionOperationResult> {
  return await chatSessionOps.getChatSessionFile(alias, chatId, sessionId);
}

/**
 * Create a new ChatSession (convenience function)
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