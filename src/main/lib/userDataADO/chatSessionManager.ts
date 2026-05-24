/**
 * ChatSession Manager - New Architecture
 *
 * chatSessions are no longer managed by profile.json; they now use an independent file directory structure:
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
import { createConsoleLogger } from '../unifiedLogger';
import { ChatSession } from './types/profile';
import { ChatSessionFile, deserializeChatFile } from './chatSessionFileOps';
import {
  getChatSessionsRootPath,
  getChatSessionsChatPath,
  getChatSessionsChatIndexPath,
  getChatSessionsMonthPath,
  getChatSessionsMonthIndexPath,
  getChatSessionFilePath,
  extractMonthFromChatSessionId,
  isValidChatSessionId
} from './pathUtils';

const logger = createConsoleLogger();

function normalizeChatSessionReadStatus(status?: ChatSession['readStatus']): ChatSession['readStatus'] {
  return status === 'unread' ? 'unread' : 'read';
}

class CorruptedMonthIndexError extends Error {
  readonly alias: string;
  readonly chatId: string;
  readonly month: string;

  constructor(alias: string, chatId: string, month: string, message: string) {
    super(message);
    this.name = 'CorruptedMonthIndexError';
    this.alias = alias;
    this.chatId = chatId;
    this.month = month;
  }
}

/**
 * Chat-level index file structure
 * Maintains the list of all months under chat_id
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
 * Maintains metadata for all chatSessions in the month
 */
export interface ChatSessionsMonthIndex {
  /** Chat ID */
  chat_id: string;
  /** Month (YYYYMM format) */
  month: string;
  /** Metadata for all chatSessions in the month */
  sessions: ChatSession[];
  /** Last updated time */
  last_updated: string;
}

/**
 * ChatSession Manager class
 * Manages CRUD operations and index maintenance for chatSessions
 */
export class ChatSessionManager {
  private static instance: ChatSessionManager;
  private readonly monthIndexWriteLocks: Map<string, Promise<void>> = new Map();

  private constructor() {}

  static getInstance(): ChatSessionManager {
    if (!ChatSessionManager.instance) {
      ChatSessionManager.instance = new ChatSessionManager();
    }
    return ChatSessionManager.instance;
  }

  private getMonthIndexLockKey(alias: string, chatId: string, month: string): string {
    return `${alias}::${chatId}::${month}`;
  }

  private async withMonthIndexWriteLock<T>(
    alias: string,
    chatId: string,
    month: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockKey = this.getMonthIndexLockKey(alias, chatId, month);
    const previousLock = this.monthIndexWriteLocks.get(lockKey) || Promise.resolve();

    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.monthIndexWriteLocks.set(
      lockKey,
      previousLock.then(() => currentLock, () => currentLock)
    );

    await previousLock;

    try {
      return await operation();
    } finally {
      release();
      if (this.monthIndexWriteLocks.get(lockKey) === currentLock) {
        this.monthIndexWriteLocks.delete(lockKey);
      }
    }
  }

  private async writeFileAtomically(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // ignore temp file cleanup failure
      }
      throw error;
    }
  }

  // ========================================
  // Index Management Methods
  // ========================================

  /**
   * Read the chat-level index file
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
   * Write the chat-level index file
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
   * Read the month-level index file
   */
  async readMonthIndex(alias: string, chatId: string, month: string): Promise<ChatSessionsMonthIndex | null> {
    try {
      const indexPath = getChatSessionsMonthIndexPath(alias, chatId, month);

      if (!fs.existsSync(indexPath)) {
        return null;
      }

      const content = await fs.promises.readFile(indexPath, 'utf-8');
      if (content.trim().length === 0) {
        logger.warn('[ChatSessionManager] Month index file is empty, treating as missing', 'readMonthIndex', {
          alias,
          chatId,
          month,
        });
        return null;
      }

      try {
        return JSON.parse(content) as ChatSessionsMonthIndex;
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        logger.error('[ChatSessionManager] Failed to read month index', 'readMonthIndex', {
          alias,
          chatId,
          month,
          error: errorMessage
        });
        throw new CorruptedMonthIndexError(
          alias,
          chatId,
          month,
          `Month index is corrupted: ${errorMessage}`
        );
      }
    } catch (error) {
      if (error instanceof CorruptedMonthIndexError) {
        throw error;
      }

      logger.error('[ChatSessionManager] Failed to read month index', 'readMonthIndex', {
        alias,
        chatId,
        month,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async writeMonthIndexUnlocked(alias: string, chatId: string, month: string, index: ChatSessionsMonthIndex): Promise<void> {
    const indexPath = getChatSessionsMonthIndexPath(alias, chatId, month);
    index.last_updated = new Date().toISOString();
    const content = JSON.stringify(index, null, 2);
    await this.writeFileAtomically(indexPath, content);
  }

  /**
   * Write the month-level index file
   */
  async writeMonthIndex(alias: string, chatId: string, month: string, index: ChatSessionsMonthIndex): Promise<boolean> {
    try {
      await this.withMonthIndexWriteLock(alias, chatId, month, async () => {
        await this.writeMonthIndexUnlocked(alias, chatId, month, index);
      });
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
   * Ensure the chat index exists, creating it if not present
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
   * Ensure the month index exists, creating it if not present
   * 🔥 Fix: regardless of whether the month index exists, ensure the chat-level index includes the month
   * ⚠️ If the month index file is corrupted, do NOT automatically recreate an empty index to overwrite it
   */
  async ensureMonthIndex(alias: string, chatId: string, month: string): Promise<ChatSessionsMonthIndex> {
    let index: ChatSessionsMonthIndex | null;

    try {
      index = await this.readMonthIndex(alias, chatId, month);
    } catch (error) {
      if (error instanceof CorruptedMonthIndexError) {
        logger.error('[ChatSessionManager] Refusing to recreate corrupted month index', 'ensureMonthIndex', {
          alias,
          chatId,
          month,
          error: error.message
        });
      }
      throw error;
    }

    if (!index) {
      index = {
        chat_id: chatId,
        month: month,
        sessions: [],
        last_updated: new Date().toISOString()
      };
      await this.writeMonthIndex(alias, chatId, month, index);
    }

    // 🔥 Fix: regardless of whether the month index exists, ensure the chat-level index includes the month
    // This correctly adds the month even if the month directory/index.json exists but is missing from chat_id/index.json
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
  // ChatSession CRUD Operations
  // ========================================

  /**
   * Persist a newly created ChatSession to the on-disk indexes and session file.
   * Callers are responsible for any runtime cache updates or UI notifications.
   */
  async persistNewChatSession(
    alias: string,
    chatId: string,
    chatSession: ChatSession,
    chatSessionFile: ChatSessionFile
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Persisting new chat session', 'persistNewChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id
      });

      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSession.chatSession_id)) {
        logger.error('[ChatSessionManager] Invalid chatSessionId format', 'persistNewChatSession', {
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }

      // Extract month
      const month = extractMonthFromChatSessionId(chatSession.chatSession_id);
      if (!month) {
        logger.error('[ChatSessionManager] Failed to extract month from chatSessionId', 'persistNewChatSession', {
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }

      // Get or create month index
      await this.ensureMonthIndex(alias, chatId, month);

      const normalizedReadStatus = normalizeChatSessionReadStatus(chatSession.readStatus);
      const normalizedChatSession: ChatSession = {
        ...chatSession,
        readStatus: normalizedReadStatus,
      };
      const normalizedChatSessionFile: ChatSessionFile = {
        ...chatSessionFile,
      };

      const indexWriteSuccess = await this.withMonthIndexWriteLock(alias, chatId, month, async () => {
        const monthIndex = await this.readMonthIndex(alias, chatId, month);
        if (!monthIndex) {
          return false;
        }

        const existingIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSession.chatSession_id);
        if (existingIndex >= 0) {
          logger.warn('[ChatSessionManager] ChatSession already exists', 'persistNewChatSession', {
            chatSessionId: chatSession.chatSession_id
          });
          return false;
        }

        // Add to month index
        monthIndex.sessions.push(normalizedChatSession);
        monthIndex.sessions.sort((a, b) =>
          new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
        );

        await this.writeMonthIndexUnlocked(alias, chatId, month, monthIndex);
        return true;
      });
      if (!indexWriteSuccess) {
        return false;
      }

      // Save chatSession file
      const filePath = getChatSessionFilePath(alias, chatId, chatSession.chatSession_id);
      await fs.promises.writeFile(filePath, JSON.stringify(normalizedChatSessionFile, null, 2), 'utf-8');

      logger.info('[ChatSessionManager] New chat session persisted successfully', 'persistNewChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        month
      });

      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to persist new chat session', 'persistNewChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Persist updates for an existing ChatSession to disk.
   * Callers are responsible for any runtime cache updates or UI notifications.
   */
  async persistUpdatedChatSession(
    alias: string,
    chatId: string,
    chatSessionId: string,
    updates: Partial<ChatSession>,
    chatSessionFile: ChatSessionFile
  ): Promise<boolean> {
    try {
      logger.info('[ChatSessionManager] Persisting updated chat session', 'persistUpdatedChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSessionId)) {
        logger.error('[ChatSessionManager] Invalid chatSessionId format', 'persistUpdatedChatSession', {
          chatSessionId
        });
        return false;
      }

      // Extract month
      const month = extractMonthFromChatSessionId(chatSessionId);
      if (!month) {
        logger.error('[ChatSessionManager] Failed to extract month from chatSessionId', 'persistUpdatedChatSession', {
          chatSessionId
        });
        return false;
      }

      // Update metadata (preserve last_updated if explicitly provided in updates, otherwise auto-generate)
      const updatedTimestamp = updates.last_updated ?? new Date().toISOString();
      const indexWriteSuccess = await this.withMonthIndexWriteLock(alias, chatId, month, async () => {
        const monthIndex = await this.readMonthIndex(alias, chatId, month);
        if (!monthIndex) {
          logger.error('[ChatSessionManager] Month index not found', 'persistUpdatedChatSession', {
            alias,
            chatId,
            month
          });
          return false;
        }

        // Find and update the session
        const sessionIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSessionId);
        if (sessionIndex < 0) {
          logger.error('[ChatSessionManager] ChatSession not found in index', 'persistUpdatedChatSession', {
            chatSessionId
          });
          return false;
        }

        const existingSession = monthIndex.sessions[sessionIndex];
        const normalizedReadStatus = normalizeChatSessionReadStatus(
          updates.readStatus ?? existingSession.readStatus
        );
        monthIndex.sessions[sessionIndex] = {
          ...existingSession,
          ...updates,
          last_updated: updatedTimestamp,
          readStatus: normalizedReadStatus,
        };

        // Re-sort
        monthIndex.sessions.sort((a, b) =>
          new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
        );

        await this.writeMonthIndexUnlocked(alias, chatId, month, monthIndex);
        return true;
      });
      if (!indexWriteSuccess) {
        return false;
      }

      // Save chatSession file (use the same timestamp as the index)
      const filePath = getChatSessionFilePath(alias, chatId, chatSessionId);
      const normalizedChatSessionFile: ChatSessionFile = {
        ...chatSessionFile,
        last_updated: updatedTimestamp,
      };
      await fs.promises.writeFile(filePath, JSON.stringify(normalizedChatSessionFile, null, 2), 'utf-8');

      logger.info('[ChatSessionManager] Updated chat session persisted successfully', 'persistUpdatedChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      return true;
    } catch (error) {
      logger.error('[ChatSessionManager] Failed to persist updated chat session', 'persistUpdatedChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete a ChatSession
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

      // Read the month index
      const monthIndex = await this.readMonthIndex(alias, chatId, month);
      if (!monthIndex) {
        logger.warn('[ChatSessionManager] Month index not found, session may already be deleted', 'deleteChatSession', {
          alias,
          chatId,
          month
        });
        return true; // Treat as deleted successfully
      }

      // Remove from index
      const sessionIndex = monthIndex.sessions.findIndex(s => s.chatSession_id === chatSessionId);
      if (sessionIndex >= 0) {
        monthIndex.sessions.splice(sessionIndex, 1);
        await this.writeMonthIndex(alias, chatId, month, monthIndex);

        // If the month index is now empty, optionally remove the month directory
        if (monthIndex.sessions.length === 0) {
          // Update the chat-level index, removing the empty month
          const chatIndex = await this.readChatIndex(alias, chatId);
          if (chatIndex) {
            chatIndex.months = chatIndex.months.filter(m => m !== month);
            await this.writeChatIndex(alias, chatId, chatIndex);
          }
        }
      }

      // Delete the file
      const filePath = getChatSessionFilePath(alias, chatId, chatSessionId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }

      logger.info('[ChatSessionManager] ChatSession deleted successfully', 'deleteChatSession', {
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
   * Get the ChatSession file content
   * 🔥 Fix: must confirm session exists via index before reading the file
   */
  async getChatSessionFile(alias: string, chatId: string, chatSessionId: string): Promise<ChatSessionFile | null> {
    try {
      // Validate chatSessionId format
      if (!isValidChatSessionId(chatSessionId)) {
        return null;
      }

      // 🔥 Fix: confirm session exists via index first
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
        // Index exists but file does not — data inconsistency, log the error
        logger.error('[ChatSessionManager] Index exists but file not found - data inconsistency', 'getChatSessionFile', {
          alias,
          chatId,
          chatSessionId,
          filePath
        });
        return null;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      return deserializeChatFile(JSON.parse(content));
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
   * Get ChatSession metadata for the specified chat (paginated)
   * Initial load: starts from the newest month, loading until minCount sessions or all are loaded
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param minCount Minimum number of sessions to load, default 10
   * @returns Load result containing sessions and pagination state
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
      let nonScheduledCount = 0;

      // Load months in descending order until we have at least minCount non-scheduler
      // (i.e. user-initiated) sessions. We count only manual sessions because the UI
      // filters out scheduler sessions; counting all sessions would let a large volume
      // of scheduler sessions exhaust the quota and prevent earlier months from loading.
      while (monthIndex < chatIndex.months.length && nonScheduledCount < minCount) {
        const month = chatIndex.months[monthIndex];
        const monthData = await this.readMonthIndex(alias, chatId, month);

        if (monthData && monthData.sessions.length > 0) {
          allSessions.push(...monthData.sessions);
          loadedMonths.push(month);
          nonScheduledCount += monthData.sessions.filter(s => !s.schedulerJobId).length;
        }

        monthIndex++;
      }

      // Sort all collected sessions by time descending
      allSessions.sort((a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      const normalizedSessions = allSessions.map(session => ({
        ...session,
        readStatus: normalizeChatSessionReadStatus(session.readStatus),
      }));

      const hasMore = monthIndex < chatIndex.months.length;
      const scheduledCount = normalizedSessions.filter(session => !!session.schedulerJobId).length;

      logger.info('[ChatSessionManager] getChatSessions completed', 'getChatSessions', {
        alias,
        chatId,
        loadedCount: allSessions.length,
        loadedMonths: loadedMonths.length,
        hasMore,
        nextMonthIndex: monthIndex,
        scheduledCount,
        sessionPreview: normalizedSessions.slice(0, 10).map(session => ({
          chatSessionId: session.chatSession_id,
          title: session.title,
          schedulerJobId: session.schedulerJobId || null,
          readStatus: session.readStatus,
        }))
      });

      return {
        sessions: normalizedSessions,
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
   * Load more ChatSessions (scroll-based loading)
   * Loads one month of data at a time
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param fromMonthIndex The month index to start loading from
   * @returns Load result containing newly loaded sessions and pagination state
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

      // Ensure sorted in descending time order
      sessions.sort((a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
      const normalizedSessions = sessions.map(session => ({
        ...session,
        readStatus: normalizeChatSessionReadStatus(session.readStatus),
      }));

      logger.info('[ChatSessionManager] getMoreChatSessions completed', 'getMoreChatSessions', {
        alias,
        chatId,
        month,
        loadedCount: sessions.length,
        hasMore,
        nextMonthIndex,
        scheduledCount: normalizedSessions.filter(session => !!session.schedulerJobId).length,
        sessionPreview: normalizedSessions.slice(0, 10).map(session => ({
          chatSessionId: session.chatSession_id,
          title: session.title,
          schedulerJobId: session.schedulerJobId || null,
          readStatus: session.readStatus,
        }))
      });

      return {
        sessions: normalizedSessions,
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
   * @deprecated Use getChatSessions + getMoreChatSessions for paginated loading
   */
  async getAllChatSessions(alias: string, chatId: string): Promise<ChatSession[]> {
    try {
      const chatIndex = await this.readChatIndex(alias, chatId);
      if (!chatIndex || chatIndex.months.length === 0) {
        return [];
      }

      const allSessions: ChatSession[] = [];

      for (const month of chatIndex.months) {
        const monthData = await this.readMonthIndex(alias, chatId, month);
        if (monthData && monthData.sessions.length > 0) {
          allSessions.push(...monthData.sessions);
        }
      }

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

  // ========================================
  // Migration Methods
  // ========================================

  /**
   * Migrate chatSessions from profile.json to the new directory structure
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessions The chatSessions array from the original profile.json
   * @param getChatSessionFileFunc Function to get the chatSession file content
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

      // Create the chat-level index
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

}

// Export singleton instance
export const chatSessionManager = ChatSessionManager.getInstance();
