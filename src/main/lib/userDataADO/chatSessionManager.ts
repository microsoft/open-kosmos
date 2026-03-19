/**
 * ChatSession Manager - New Architecture
 * 
 * chatSessions are no longer maintained by profile.json, replaced with independent file directory structure:
 * 
 * Directory structure:
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/index.json
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/index.json
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/{chatSessionId}.json
 * 
 * ChatSessionId format: "chatSession_{YYYYMMDDHHmmSS}"
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';
import { ChatSession } from './types/profile';
import { ChatSessionFile } from './chatSessionFileOps';
import {
  getChatSessionsRootPath,
  getChatSessionsChatPath,
  getChatSessionsChatIndexPath,
  getChatSessionsMonthPath,
  getChatSessionsMonthIndexPath,
  getChatSessionFilePath,
  extractMonthFromChatSessionId,
  generateChatSessionId as generateChatSessionIdFromUtils,
  getCurrentMonth,
  isValidChatSessionId
} from './pathUtils';

const logger = createConsoleLogger();

/**
 * Chat-level index file structure
 * Maintains the list of all months under a chat_id
 */
export interface ChatSessionsChatIndex {
  /** Chat ID */
  chat_id: string;
  /** List of all months containing chatSessions (YYYYMM format) */
  months: string[];
  /** Last updated time */
  last_updated: string;
}

/**
 * Month-level index file structure
 * Maintains metadata for all chatSessions within the month
 */
export interface ChatSessionsMonthIndex {
  /** Chat ID */
  chat_id: string;
  /** Month (YYYYMM format) */
  month: string;
  /** Metadata for all chatSessions in this month */
  sessions: ChatSession[];
  /** Last updated time */
  last_updated: string;
}

/**
 * ChatSession Manager Class
 * Manages chatSession CRUD operations and index maintenance
 */
export class ChatSessionManager {
  private static instance: ChatSessionManager;
  
  private constructor() {}
  
  static getInstance(): ChatSessionManager {
    if (!ChatSessionManager.instance) {
      ChatSessionManager.instance = new ChatSessionManager();
    }
    return ChatSessionManager.instance;
  }
  
  // ========================================
  // Index management methods
  // ========================================
  
  /**
   * Read chat-level index file
   */
  async readChatIndex(alias: string, chatId: string): Promise<ChatSessionsChatIndex | null> {
    try {
      const indexPath = getChatSessionsChatIndexPath(alias, chatId);
      
      if (!fs.existsSync(indexPath)) {
        return null;
      }
      
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      return JSON.parse(content) as ChatSessionsChatIndex;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to read chat index', 'readChatIndex', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  
  /**
   * Write chat-level index file
   */
  async writeChatIndex(alias: string, chatId: string, index: ChatSessionsChatIndex): Promise<boolean> {
    try {
      const indexPath = getChatSessionsChatIndexPath(alias, chatId);
      index.last_updated = new Date().toISOString();
      
      await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to write chat index', 'writeChatIndex', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Read month-level index file
   */
  async readMonthIndex(alias: string, chatId: string, month: string): Promise<ChatSessionsMonthIndex | null> {
    try {
      const indexPath = getChatSessionsMonthIndexPath(alias, chatId, month);
      
      if (!fs.existsSync(indexPath)) {
        return null;
      }
      
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      return JSON.parse(content) as ChatSessionsMonthIndex;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to read month index', 'readMonthIndex', {
        alias,
        chatId,
        month,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  
  /**
   * Write month-level index file
   */
  async writeMonthIndex(alias: string, chatId: string, month: string, index: ChatSessionsMonthIndex): Promise<boolean> {
    try {
      const indexPath = getChatSessionsMonthIndexPath(alias, chatId, month);
      index.last_updated = new Date().toISOString();
      
      await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to write month index', 'writeMonthIndex', {
        alias,
        chatId,
        month,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Ensure chat index exists, create if not
   */
  async ensureChatIndex(alias: string, chatId: string): Promise<ChatSessionsChatIndex> {
    let index = await this.readChatIndex(alias, chatId);
    
    if (!index) {
      index = {
        chat_id: chatId,
        months: [],
        last_updated: new Date().toISOString()
      };
      await this.writeChatIndex(alias, chatId, index);
    }
    
    return index;
  }
  
  /**
   * Ensure month index exists, create if not
   * 🔥 Fix: always ensure chat-level index contains the month regardless of whether the month index exists
   */
  async ensureMonthIndex(alias: string, chatId: string, month: string): Promise<ChatSessionsMonthIndex> {
    let index = await this.readMonthIndex(alias, chatId, month);
    
    if (!index) {
      index = {
        chat_id: chatId,
        month: month,
        sessions: [],
        last_updated: new Date().toISOString()
      };
      await this.writeMonthIndex(alias, chatId, month, index);
    }
    
    // 🔥 Fix: always ensure chat-level index contains the month regardless of whether the month index exists
    // This ensures correct addition even if month directory/index.json exists but chat_id/index.json doesn't contain that month
    const chatIndex = await this.ensureChatIndex(alias, chatId);
    if (!chatIndex.months.includes(month)) {
      chatIndex.months.push(month);
      chatIndex.months.sort().reverse(); // Sort months in descending order
      await this.writeChatIndex(alias, chatId, chatIndex);
      
      logger.info('[ChatSessionManager] Added month to chat index', 'ensureMonthIndex', {
        alias,
        chatId,
        month,
        updatedMonths: chatIndex.months
      });
    }
    
    return index;
  }
  
  // ========================================
  // ChatSession CRUD operations
  // ========================================
  
  /**
   * Add a new ChatSession
   */
  async addChatSession(
    alias: string,
    chatId: string,
    chatSession: ChatSession,
    chatSessionFile: ChatSessionFile
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Adding chat session', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id
      });
      
      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSession.chatSession_id)) {
        logger.error('[ChatSessionManager] Invalid chatSessionId format', 'addChatSession', {
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }
      
      // Extract month
      const month = extractMonthFromChatSessionId(chatSession.chatSession_id);
      if (!month) {
        logger.error('[ChatSessionManager] Failed to extract month from chatSessionId', 'addChatSession', {
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }
      
      // Get or create month index
      const monthIndex = await this.ensureMonthIndex(alias, chatId, month);
      
      // Check if already exists
      const existingIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSession.chatSession_id);
      if (existingIndex >= 0) {
        logger.warn('[ChatSessionManager] ChatSession already exists', 'addChatSession', {
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }
      
      // Add to month index
      monthIndex.sessions.push(chatSession);
      monthIndex.sessions.sort((a, b) => 
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      
      // Save month index
      const indexWriteSuccess = await this.writeMonthIndex(alias, chatId, month, monthIndex);
      if (!indexWriteSuccess) {
        return false;
      }
      
      // Save chatSession file
      const filePath = getChatSessionFilePath(alias, chatId, chatSession.chatSession_id);
      await fs.promises.writeFile(filePath, JSON.stringify(chatSessionFile, null, 2), 'utf-8');
      
      // Notify frontend
      await this.notifyFrontend(alias, chatId);
      
      // Auto-select new ChatSession
      await this.notifyAutoSelectChatSession(alias, chatId, chatSession.chatSession_id);
      
      logger.info('[ChatSessionManager] ChatSession added successfully', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        month
      });
      
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to add chat session', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Update ChatSession
   */
  async updateChatSession(
    alias: string,
    chatId: string,
    chatSessionId: string,
    updates: Partial<ChatSession>,
    chatSessionFile: ChatSessionFile
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Updating chat session', 'updateChatSession', {
        alias,
        chatId,
        chatSessionId
      });
      
      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSessionId)) {
        logger.error('[ChatSessionManager] Invalid chatSessionId format', 'updateChatSession', {
          chatSessionId
        });
        return false;
      }
      
      // Extract month
      const month = extractMonthFromChatSessionId(chatSessionId);
      if (!month) {
        logger.error('[ChatSessionManager] Failed to extract month from chatSessionId', 'updateChatSession', {
          chatSessionId
        });
        return false;
      }
      
      // Read month index
      const monthIndex = await this.readMonthIndex(alias, chatId, month);
      if (!monthIndex) {
        logger.error('[ChatSessionManager] Month index not found', 'updateChatSession', {
          alias,
          chatId,
          month
        });
        return false;
      }
      
      // Find and update session
      const sessionIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSessionId);
      if (sessionIndex < 0) {
        logger.error('[ChatSessionManager] ChatSession not found in index', 'updateChatSession', {
          chatSessionId
        });
        return false;
      }
      
      // Update metadata
      monthIndex.sessions[sessionIndex] = {
        ...monthIndex.sessions[sessionIndex],
        ...updates,
        last_updated: new Date().toISOString()
      };
      
      // Re-sort
      monthIndex.sessions.sort((a, b) => 
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      
      // Save month index
      const indexWriteSuccess = await this.writeMonthIndex(alias, chatId, month, monthIndex);
      if (!indexWriteSuccess) {
        return false;
      }
      
      // Save chatSession file
      const filePath = getChatSessionFilePath(alias, chatId, chatSessionId);
      chatSessionFile.last_updated = new Date().toISOString();
      await fs.promises.writeFile(filePath, JSON.stringify(chatSessionFile, null, 2), 'utf-8');
      
      // Notify frontend
      await this.notifyFrontend(alias, chatId);
      
      logger.info('[ChatSessionManager] ChatSession updated successfully','updateChatSession', {
        alias,
        chatId,
        chatSessionId
      });
      
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to update chat session', 'updateChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Delete ChatSession
   */
  async deleteChatSession(alias: string, chatId: string, chatSessionId: string): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Deleting chat session', 'deleteChatSession', {
        alias,
        chatId,
        chatSessionId
      });
      
      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSessionId)) {
        logger.error('[ChatSessionManager] Invalid chatSessionId format', 'deleteChatSession', {
          chatSessionId
        });
        return false;
      }
      
      // Extract month
      const month = extractMonthFromChatSessionId(chatSessionId);
      if (!month) {
        logger.error('[ChatSessionManager] Failed to extract month from chatSessionId', 'deleteChatSession', {
          chatSessionId
        });
        return false;
      }
      
      // Read month index
      const monthIndex = await this.readMonthIndex(alias, chatId, month);
      if (!monthIndex) {
        logger.warn('[ChatSessionManager] Month index not found, session may already be deleted', 'deleteChatSession', {
          alias,
          chatId,
          month
        });
        return true; // Treat as deletion success
      }
      
      // Remove from index
      const sessionIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSessionId);
      if (sessionIndex >= 0) {
        monthIndex.sessions.splice(sessionIndex, 1);
        await this.writeMonthIndex(alias, chatId, month, monthIndex);
        
        // If month index becomes empty, consider deleting the month directory (optional)
        if (monthIndex.sessions.length === 0) {
          // Update chat-level index, remove empty month
          const chatIndex = await this.readChatIndex(alias, chatId);
          if (chatIndex) {
            chatIndex.months = chatIndex.months.filter(m => m !== month);
            await this.writeChatIndex(alias, chatId, chatIndex);
          }
        }
      }
      
      // Delete file
      const filePath = getChatSessionFilePath(alias, chatId, chatSessionId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      
      // Notify frontend
      await this.notifyFrontend(alias, chatId);
      
      logger.info('[ChatSessionManager] ChatSession deleted successfully','deleteChatSession', {
        alias,
        chatId,
        chatSessionId
      });
      
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to delete chat session', 'deleteChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Get ChatSession file content
   * 🔥 Fix: must first confirm session exists via index before reading file
   */
  async getChatSessionFile(alias: string, chatId: string, chatSessionId: string): Promise<ChatSessionFile | null> {
    try {
      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSessionId)) {
        return null;
      }
      
      // 🔥 Fix: first confirm session exists via index
      const month = extractMonthFromChatSessionId(chatSessionId);
      if (!month) {
        logger.warn('[ChatSessionManager] Failed to extract month from chatSessionId', 'getChatSessionFile', {
          chatSessionId
        });
        return null;
      }
      
      // Confirm session exists via month index
      const monthIndex = await this.readMonthIndex(alias, chatId, month);
      if (!monthIndex) {
        logger.warn('[ChatSessionManager] Month index not found', 'getChatSessionFile', {
          alias,
          chatId,
          month
        });
        return null;
      }
      
      const sessionExists = monthIndex.sessions.some(s => s.chatSession_id === chatSessionId);
      if (!sessionExists) {
        logger.warn('[ChatSessionManager] ChatSession not found in index', 'getChatSessionFile', {
          alias,
          chatId,
          chatSessionId
        });
        return null;
      }
      
      // After index confirms existence, read the file
      const filePath = getChatSessionFilePath(alias, chatId, chatSessionId);
      
      if (!fs.existsSync(filePath)) {
        // Index exists but file not found, indicating data inconsistency
        logger.error('[ChatSessionManager] Index exists but file not found - data inconsistency', 'getChatSessionFile', {
          alias,
          chatId,
          chatSessionId,
          filePath
        });
        return null;
      }
      
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as ChatSessionFile;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to read chat session file', 'getChatSessionFile', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  
  /**
   * Get ChatSession metadata for the specified chat (paginated loading)
   * Initial load: starts from the latest month, loads until reaching minCount or all loaded
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param minCount Minimum load count, default 10
   * @returns Load result, including sessions and pagination state
   */
  async getChatSessions(alias: string, chatId: string, minCount: number = 10): Promise<{
    sessions: ChatSession[];
    loadedMonths: string[];
    hasMore: boolean;
    nextMonthIndex: number;
  }> {
    try {
      const chatIndex = await this.readChatIndex(alias, chatId);
      if (!chatIndex || chatIndex.months.length === 0) {
        return {
          sessions: [],
          loadedMonths: [],
          hasMore: false,
          nextMonthIndex: 0
        };
      }
      
      const allSessions: ChatSession[] = [];
      const loadedMonths: string[] = [];
      let monthIndex = 0;
      
      // Read months in order (months already in descending order), until reaching minCount
      while (monthIndex < chatIndex.months.length && allSessions.length < minCount) {
        const month = chatIndex.months[monthIndex];
        const monthData = await this.readMonthIndex(alias, chatId, month);
        
        if (monthData && monthData.sessions.length > 0) {
          allSessions.push(...monthData.sessions);
          loadedMonths.push(month);
        }
        
        monthIndex++;
      }
      
      // Ensure sorted in descending order by time
      allSessions.sort((a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      
      const hasMore = monthIndex < chatIndex.months.length;
      
      logger.info('[ChatSessionManager] getChatSessions completed','getChatSessions', {
        alias,
        chatId,
        loadedCount: allSessions.length,
        loadedMonths: loadedMonths.length,
        hasMore,
        nextMonthIndex: monthIndex
      });
      
      return {
        sessions: allSessions,
        loadedMonths,
        hasMore,
        nextMonthIndex: monthIndex
      };
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to get chat sessions', 'getChatSessions', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        sessions: [],
        loadedMonths: [],
        hasMore: false,
        nextMonthIndex: 0
      };
    }
  }
  
  /**
   * Load more ChatSessions (scroll loading)
   * Loads one month of data at a time
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param fromMonthIndex Month index to start loading from
   * @returns Load result, including newly loaded sessions and pagination state
   */
  async getMoreChatSessions(alias: string, chatId: string, fromMonthIndex: number): Promise<{
    sessions: ChatSession[];
    loadedMonth: string | null;
    hasMore: boolean;
    nextMonthIndex: number;
  }> {
    try {
      const chatIndex = await this.readChatIndex(alias, chatId);
      if (!chatIndex || chatIndex.months.length === 0 || fromMonthIndex >= chatIndex.months.length) {
        return {
          sessions: [],
          loadedMonth: null,
          hasMore: false,
          nextMonthIndex: fromMonthIndex
        };
      }
      
      const month = chatIndex.months[fromMonthIndex];
      const monthData = await this.readMonthIndex(alias, chatId, month);
      
      const sessions = monthData?.sessions || [];
      const nextMonthIndex = fromMonthIndex + 1;
      const hasMore = nextMonthIndex < chatIndex.months.length;
      
      // Ensure sorted in descending order by time
      sessions.sort((a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      
      logger.info('[ChatSessionManager] getMoreChatSessions completed','getMoreChatSessions', {
        alias,
        chatId,
        month,
        loadedCount: sessions.length,
        hasMore,
        nextMonthIndex
      });
      
      return {
        sessions,
        loadedMonth: month,
        hasMore,
        nextMonthIndex
      };
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to get more chat sessions', 'getMoreChatSessions', {
        alias,
        chatId,
        fromMonthIndex,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        sessions: [],
        loadedMonth: null,
        hasMore: false,
        nextMonthIndex: fromMonthIndex
      };
    }
  }
  
  /**
   * Get all ChatSessions (non-paginated, for migration and similar scenarios)
   * @deprecated Please use getChatSessions + getMoreChatSessions for paginated loading
   */
  async getAllChatSessions(alias: string, chatId: string): Promise<ChatSession[]> {
    try {
      const chatIndex = await this.readChatIndex(alias, chatId);
      if (!chatIndex || chatIndex.months.length === 0) {
        return [];
      }
      
      const allSessions: ChatSession[] = [];
      
      // Load all months
      for (const month of chatIndex.months) {
        const monthData = await this.readMonthIndex(alias, chatId, month);
        if (monthData && monthData.sessions.length > 0) {
          allSessions.push(...monthData.sessions);
        }
      }
      
      // Ensure sorted in descending order by time
      allSessions.sort((a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      
      return allSessions;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to get all chat sessions', 'getAllChatSessions', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
  
  /**
   * Generate a new ChatSessionId
   * Format: "chatSession_{YYYYMMDDHHmmSS}"
   */
  generateChatSessionId(): string {
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
   * Copy ChatSession (Fork feature)
   *
   * Workflow:
   * 1. Read source ChatSession metadata and file content
   * 2. Generate new targetChatSessionId
   * 3. Create new ChatSession metadata (add "(Fork)" suffix to title)
   * 4. Copy file content to new ChatSession
   * 5. Add to index
   * 6. Notify frontend
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param sourceChatSessionId Source ChatSession ID
   * @param targetChatSessionId Target ChatSession ID
   * @returns Whether the copy was successful
   */
  async copyChatSession(
    alias: string,
    chatId: string,
    sourceChatSessionId: string,
    targetChatSessionId: string
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Copying chat session', 'copyChatSession', {
        alias,
        chatId,
        sourceChatSessionId,
        targetChatSessionId
      });
      
      // 1. Validate source ChatSessionId format
      if (!isValidChatSessionId(sourceChatSessionId)) {
        logger.error('[ChatSessionManager] Invalid source chatSessionId format', 'copyChatSession', {
          sourceChatSessionId
        });
        return false;
      }
      
      // 2. Validate target ChatSessionId format
      if (!isValidChatSessionId(targetChatSessionId)) {
        logger.error('[ChatSessionManager] Invalid target chatSessionId format', 'copyChatSession', {
          targetChatSessionId
        });
        return false;
      }
      
      // 3. Read source ChatSession file content
      const sourceSessionFile = await this.getChatSessionFile(alias, chatId, sourceChatSessionId);
      if (!sourceSessionFile) {
        logger.error('[ChatSessionManager] Source ChatSession file not found', 'copyChatSession', {
          alias,
          chatId,
          sourceChatSessionId
        });
        return false;
      }
      
      // 4. Get source ChatSession metadata
      const sourceMonth = extractMonthFromChatSessionId(sourceChatSessionId);
      if (!sourceMonth) {
        logger.error('[ChatSessionManager] Failed to extract month from source chatSessionId', 'copyChatSession', {
          sourceChatSessionId
        });
        return false;
      }
      
      const sourceMonthIndex = await this.readMonthIndex(alias, chatId, sourceMonth);
      const sourceSession = sourceMonthIndex?.sessions.find(s => s.chatSession_id === sourceChatSessionId);
      
      if (!sourceSession) {
        logger.error('[ChatSessionManager] Source ChatSession metadata not found', 'copyChatSession', {
          alias,
          chatId,
          sourceChatSessionId
        });
        return false;
      }
      
      // 5. Create new ChatSession metadata
      const now = new Date().toISOString();
      const newTitle = sourceSession.title ? `${sourceSession.title} (Fork)` : 'New Chat (Fork)';
      
      const newSession: ChatSession = {
        chatSession_id: targetChatSessionId,
        title: newTitle,
        last_updated: now
      };
      
      // 6. Create new ChatSession file content (copy source content but update ID and timestamp)
      const newSessionFile: ChatSessionFile = {
        ...sourceSessionFile,
        chatSession_id: targetChatSessionId,
        title: newTitle,
        last_updated: now
      };
      
      // 7. Use addChatSession to add the new ChatSession (automatically handles index and file saving)
      const addResult = await this.addChatSession(alias, chatId, newSession, newSessionFile);
      
      if (!addResult) {
        logger.error('[ChatSessionManager] Failed to add copied ChatSession', 'copyChatSession', {
          alias,
          chatId,
          targetChatSessionId
        });
        return false;
      }
      
      logger.info('[ChatSessionManager] ChatSession copied successfully', 'copyChatSession', {
        alias,
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
        newTitle
      });
      
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to copy chat session', 'copyChatSession', {
        alias,
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  /**
   * Check if ChatSession exists
   */
  async existsChatSession(alias: string, chatId: string, chatSessionId: string): Promise<boolean> {
    try {
      if (!isValidChatSessionId(chatSessionId)) {
        return false;
      }
      
      const month = extractMonthFromChatSessionId(chatSessionId);
      if (!month) {
        return false;
      }
      
      const monthIndex = await this.readMonthIndex(alias, chatId, month);
      if (!monthIndex) {
        return false;
      }
      
      return monthIndex.sessions.some(s => s.chatSession_id === chatSessionId);
    } catch (error) {
      return false;
    }
  }
  
  // ========================================
  // Migration methods
  // ========================================
  
  /**
   * Migrate from profile.json chatSessions to new structure
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessions Original chatSessions array from profile.json
   * @param getChatSessionFileFunc Function to get chatSession file content
   */
  async migrateFromProfile(
    alias: string,
    chatId: string,
    chatSessions: ChatSession[],
    getChatSessionFileFunc: (chatSessionId: string) => Promise<ChatSessionFile | null>
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Starting migration from profile.json', 'migrateFromProfile', {
        alias,
        chatId,
        sessionCount: chatSessions.length
      });
      
      if (chatSessions.length === 0) {
        logger.info('[ChatSessionManager] No sessions to migrate', 'migrateFromProfile', {
          alias,
          chatId
        });
        return true;
      }
      
      // Group by month
      const sessionsByMonth = new Map<string, ChatSession[]>();
      
      for (const session of chatSessions) {
        if (!isValidChatSessionId(session.chatSession_id)) {
          logger.warn('[ChatSessionManager] Skipping invalid chatSessionId during migration', 'migrateFromProfile', {
            chatSessionId: session.chatSession_id
          });
          continue;
        }
        
        const month = extractMonthFromChatSessionId(session.chatSession_id);
        if (!month) {
          logger.warn('[ChatSessionManager] Skipping session with invalid month', 'migrateFromProfile', {
            chatSessionId: session.chatSession_id
          });
          continue;
        }
        
        if (!sessionsByMonth.has(month)) {
          sessionsByMonth.set(month, []);
        }
        sessionsByMonth.get(month)!.push(session);
      }
      
      // Create chat-level index
      const months = Array.from(sessionsByMonth.keys()).sort().reverse();
      const chatIndex: ChatSessionsChatIndex = {
        chat_id: chatId,
        months: months,
        last_updated: new Date().toISOString()
      };
      await this.writeChatIndex(alias, chatId, chatIndex);
      
      // Create index and migrate files for each month
      for (const [month, sessions] of sessionsByMonth) {
        // Sort
        sessions.sort((a, b) => 
          new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
        );
        
        // Create month index
        const monthIndex: ChatSessionsMonthIndex = {
          chat_id: chatId,
          month: month,
          sessions: sessions,
          last_updated: new Date().toISOString()
        };
        await this.writeMonthIndex(alias, chatId, month, monthIndex);
        
        // Migrate each session file
        for (const session of sessions) {
          const chatSessionFile = await getChatSessionFileFunc(session.chatSession_id);
          if (chatSessionFile) {
            const filePath = getChatSessionFilePath(alias, chatId, session.chatSession_id);
            await fs.promises.writeFile(filePath, JSON.stringify(chatSessionFile, null, 2), 'utf-8');
            logger.info('[ChatSessionManager] Migrated session file', 'migrateFromProfile', {
              chatSessionId: session.chatSession_id,
              month
            });
          } else {
            logger.warn('[ChatSessionManager] Session file not found during migration', 'migrateFromProfile', {
              chatSessionId: session.chatSession_id
            });
          }
        }
      }
      
      logger.info('[ChatSessionManager] Migration completed successfully', 'migrateFromProfile', {
        alias,
        chatId,
        migratedMonths: months.length,
        totalSessions: chatSessions.length
      });
      
      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Migration failed', 'migrateFromProfile', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
  
  // ========================================
  // Notification methods
  // ========================================
  
  /**
   * Notify frontend of ChatSession data update
   */
  private async notifyFrontend(alias: string, chatId: string): Promise<void> {
    try {
      const windows = BrowserWindow.getAllWindows();
      const mainWindow = windows.find((window: BrowserWindow) => window.title === 'Kosmos AI Studio');
      
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        // Get latest chatSessions list (using paginated load result)
        const result = await this.getChatSessions(alias, chatId);
        
        mainWindow.webContents.send('chatSession:updated', {
          alias,
          chatId,
          sessions: result.sessions,
          loadedMonths: result.loadedMonths,
          hasMore: result.hasMore,
          nextMonthIndex: result.nextMonthIndex,
          timestamp: Date.now()
        });
        
        logger.info('[ChatSessionManager] Notified frontend of ChatSession update', 'notifyFrontend', {
          alias,
          chatId,
          sessionCount: result.sessions.length,
          hasMore: result.hasMore
        });
      }
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to notify frontend', 'notifyFrontend', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Notify frontend to auto-select ChatSession
   */
  private async notifyAutoSelectChatSession(alias: string, chatId: string, chatSessionId: string): Promise<void> {
    try {
      const windows = BrowserWindow.getAllWindows();
      const mainWindow = windows.find((window: BrowserWindow) => window.title === 'Kosmos AI Studio');
      
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('chatSession:autoSelect', {
          alias,
          chatId,
          chatSessionId,
          timestamp: Date.now()
        });
        
        logger.info('[ChatSessionManager] Sent auto-select notification', 'notifyAutoSelectChatSession', {
          alias,
          chatId,
          chatSessionId
        });
      }
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to send auto-select notification', 'notifyAutoSelectChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Export singleton instance
export const chatSessionManager = ChatSessionManager.getInstance();
