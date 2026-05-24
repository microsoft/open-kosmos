// src/renderer/lib/chat/agentChatSessionCacheManager.ts
// Singleton chat-session state manager for the frontend

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Message } from '@shared/types/chatTypes';
import { createLogger } from '../utilities/logger';
import { external } from '@/atom/external';

import { SessionManager, type ChatSessionCache, type ChatStatus } from './session-manager';

const logger = createLogger('[AgentChatSessionCacheManager]');

export type {
  ChatSessionCache,
  ChatStatus,
}

/**
 * ThinkingStatus enum
 * - thinking: currently thinking (streaming or waiting for tool results)
 * - thought: thinking complete (final reply received)
 */
export type ThinkingStatus = 'thinking' | 'thought';

/**
 * ChatTurn interface - represents a complete conversation turn
 *
 * A conversation turn consists of:
 * 1. User message
 * 2. AI thinking process (assistant message with tool calls + tool result messages)
 * 3. AI final reply (assistant message without tool calls)
 */
export interface ChatTurn {
  /** User message */
  userMessage: Message;

  /** Unique identifier for the thinking section */
  thinkingId: string;

  /** Thinking status: 'thinking' (in progress) or 'thought' (complete) */
  thinkingStatus: ThinkingStatus;

  /**
   * List of thinking messages.
   * Contains: assistant messages with tool calls and tool result messages.
   * These show the AI's reasoning and tool-use process.
   */
  thinkingMessages: Message[];

  /**
   * Final reply message.
   * An assistant message without tool calls.
   * null while still in the 'thinking' state.
   */
  assistantMessage: Message | null;

  /**
   * File paths extracted from the assistant message (without tool calls), cached for
   * frontend rendering to avoid blocking the UI with synchronous extractFilePath calls.
   */
  filePathsInAssistantMessage: CachedFilePath[];
}

/**
 * CachedFilePath interface - cached file path information
 * Contains the file path and whether it exists.
 */
export interface CachedFilePath {
  /** File path */
  path: string;
  /** Whether the file exists */
  exists: boolean;
}

/**
 * StructuredChatHistory interface - structured chat history for rendering
 */
export interface StructuredChatHistory {
  /** System prompt message (if present) */
  systemPrompt: Message | null;

  /**
   * Optional assistant Say Hi message.
   * Used for frontend rendering only; not included in the chat context and never sent to the backend.
   * Rendered after systemPrompt and before chatTurns.
   */
  assistantSayHiMessage: Message | null;

  /** List of conversation turns */
  chatTurns: ChatTurn[];
}


interface Sessions {
  [id: string]: ChatSessionCache | undefined;
}
/**
 * Direct callback type - used for real-time streaming updates.
 * Invoked synchronously in the same call stack with no async delay.
 */
export type DirectMessageUpdateCallback = (message: Message, chatSessionId: string) => void;
export type CurrentChatSessionIdCallback = (chatSessionId: string | null) => void;
export type ChatSessionCacheLifecycleCallback = (chatSessionId: string) => void;
export type AfterSessionUpdated = (next: ChatSessionCache) => void;

/**
 * AgentChatSessionCacheManager
 *
 * Responsibilities:
 * 1. Manage currentChatId and currentChatSessionId
 * 2. Manage cache data for all ChatSessions (renderChatHistory, chatStatus, contextTokenUsage)
 * 3. Receive IPC event notifications from the backend AgentChatManager
 * 4. Provide a unified data-access interface and change-subscription mechanism
 *
 * This is the sole place on the frontend that manages these states.
 */
export class AgentChatSessionCacheManager {
  private static instance: AgentChatSessionCacheManager;

  // Currently active ChatId and ChatSessionId
  private currentChatId: string | null = null;
  private currentChatSessionId: string | null = null;
  private sessions = new SessionManager();

  // Direct callback management - fix: use Set to support multiple callbacks
  private directMessageUpdateCallbacks: Map<string, Set<DirectMessageUpdateCallback>> = new Map();
  private currentChatSessionIdCallbacks: Set<CurrentChatSessionIdCallback> = new Set();
  private chatSessionCacheLifecycleCallbacks: Set<ChatSessionCacheLifecycleCallback> = new Set();

  // IPC event cleanup functions
  private ipcCleanupFunctions: Array<() => void> = [];

  private constructor() {
    this.setupIpcListeners();
    this.ipcCleanupFunctions.push(
      this.sessions.onMessageChange((msg, session) => {
        const set = this.directMessageUpdateCallbacks.get(session.chatSessionId);
        if (!set) return;
        const last = msg[msg.length - 1];
        if (set) set.forEach(f => f(last.message, session.chatSessionId));
      }),
    );
    let ids = new Set<string>();
    const notifySession = () => {
      ids.forEach(id => this.notifyChatSessionCacheLifecycleCallbacks(id));
      ids.clear();
    };
    this.ipcCleanupFunctions.push(
      this.sessions.onSessionChange((session) => {
        if (ids.size === 0) setTimeout(notifySession, 0);
        ids.add(session.chatSessionId);
      }),
    );
  }

  static getInstance(): AgentChatSessionCacheManager {
    if (!AgentChatSessionCacheManager.instance) {
      AgentChatSessionCacheManager.instance = new AgentChatSessionCacheManager();
    }
    return AgentChatSessionCacheManager.instance;
  }

  /**
   * Set up IPC listeners to receive notifications from the backend
   */
  private setupIpcListeners(): void {
    logger.debug('[AgentChatSessionCacheManager] Setting up IPC listeners');

    if (!window.electronAPI?.agentChat) {
      logger.error('[AgentChatSessionCacheManager] electronAPI.agentChat not available');
      return;
    }

    // 1. Listen for currentChatSessionId changes
    const cleanupCurrentChanged = window.electronAPI.agentChat.onCurrentChatSessionIdChanged?.(
      (data: { chatId: string | null; chatSessionId: string | null }) => {
        logger.debug('[AgentChatSessionCacheManager] Current chat session changed:', {
          oldChatId: this.currentChatId,
          oldChatSessionId: this.currentChatSessionId,
          newChatId: data.chatId,
          newChatSessionId: data.chatSessionId,
        });
        this.setCurrentChatSessionId(data.chatId, data.chatSessionId);
      }
    );
    if (cleanupCurrentChanged) this.ipcCleanupFunctions.push(cleanupCurrentChanged);

    // 2. Listen for ChatSession cache creation
    const cleanupCacheCreated = window.electronAPI.agentChat.onChatSessionCacheCreated?.(
      (data: { chatSessionId: string; chatId: string; initialData?: Partial<ChatSessionCache> }) => {
        this.sessions.handleChatSessionCacheCreated(data.chatSessionId, data.chatId, data.initialData);
      }
    );
    if (cleanupCacheCreated) this.ipcCleanupFunctions.push(cleanupCacheCreated);

    // 3. Listen for ChatSession cache destruction
    const cleanupCacheDestroyed = window.electronAPI.agentChat.onChatSessionCacheDestroyed?.(
      (data: { chatSessionId: string }) => {
        this.handleChatSessionCacheDestroyed(data.chatSessionId);
      }
    );
    if (cleanupCacheDestroyed) this.ipcCleanupFunctions.push(cleanupCacheDestroyed);

    // 4. Listen for chat status changes
    const cleanupStatusChanged = window.electronAPI.agentChat.onChatStatusChanged?.(
      (data: { chatId: string; chatSessionId: string; chatStatus: string; agentName?: string; timestamp?: string }) => {
        const validStatuses: ChatStatus[] = ['idle', 'sending_response', 'compressing_context', 'compressed_context', 'received_response'];
        const chatStatus = validStatuses.includes(data.chatStatus as ChatStatus)
          ? data.chatStatus as ChatStatus
          : 'idle';
        this.sessions.handleChatStatusChanged(data.chatSessionId, chatStatus);
      }
    );
    if (cleanupStatusChanged) this.ipcCleanupFunctions.push(cleanupStatusChanged);

    // 5. Listen for context changes
    const cleanupContextChange = window.electronAPI.agentChat.onContextChange?.(
      (data: { chatSessionId: string; stats: any }) => {
        this.sessions.handleContextChange(data.chatSessionId, data.stats);
      }
    );
    if (cleanupContextChange) this.ipcCleanupFunctions.push(cleanupContextChange);

    // 6. Listen for streaming chunks (update renderChatHistory)
    const cleanupStreamingChunk = window.electronAPI.agentChat.onStreamingChunk?.(
      (chunk: any) => {
        if (chunk.chatSessionId) {
          this.sessions.handleStreamingChunk(chunk.chatSessionId, chunk);
        }
      }
    );
    if (cleanupStreamingChunk) this.ipcCleanupFunctions.push(cleanupStreamingChunk);

    // 7. Listen for unified interaction requests
    const cleanupInteractionRequest = window.electronAPI.agentChat.onInteractionRequest?.(
      (data: any) => {
        if (data.chatSessionId) {
          this.sessions.handleInteractiveRequest(data.chatSessionId, data);
        }
      }
    );
    if (cleanupInteractionRequest) this.ipcCleanupFunctions.push(cleanupInteractionRequest);

    // 8. Listen for unified interaction processed events
    const cleanupInteractionProcessed = window.electronAPI.agentChat.onInteractionProcessed?.(
      (data: any) => {
        if (data.chatSessionId) {
          this.sessions.handleInteractionProcessed(data.chatSessionId, data);
        }
      }
    );
    if (cleanupInteractionProcessed) this.ipcCleanupFunctions.push(cleanupInteractionProcessed);
  }

  // ========== IPC Event Handler Methods ==========

  // Private proxy methods for testing — delegate to this.sessions
  private handleStreamingChunk(chatSessionId: string, chunk: any): void {
    this.sessions.handleStreamingChunk(chatSessionId, chunk);
  }
  private handleChatStatusChanged(chatSessionId: string, chatStatus: any): void {
    this.sessions.handleChatStatusChanged(chatSessionId, chatStatus);
  }
  private handleContextChange(chatSessionId: string, stats: any): void {
    this.sessions.handleContextChange(chatSessionId, stats);
  }
  private handleInteractiveRequest(chatSessionId: string, data: any): void {
    this.sessions.handleInteractiveRequest(chatSessionId, data);
  }
  private handleInteractionProcessed(chatSessionId: string, data: any): void {
    this.sessions.handleInteractionProcessed(chatSessionId, data);
  }
  private handleChatSessionCacheCreated(chatSessionId: string, chatId: string, initialData?: any): void {
    this.sessions.handleChatSessionCacheCreated(chatSessionId, chatId, initialData);
  }
  private isIncomingSnapshotPrefixOfExistingCache(incoming: any[], existing: any[]): boolean {
    return (this.sessions as any).isIncomingSnapshotPrefixOfExistingCache(incoming, existing);
  }

  /**
   * Handle ChatSession cache destruction
   */
  private handleChatSessionCacheDestroyed(chatSessionId: string): void {
    logger.debug('[AgentChatSessionCacheManager] Destroying chat session cache:', { chatSessionId });

    // Delete the cache
    const success = this.sessions.handleChatSessionCacheDestroyed(chatSessionId);
    if (!success) return;

    this.directMessageUpdateCallbacks.delete(chatSessionId);
    // If this is the currently active chatSession, clear the current state
    if (this.currentChatSessionId === chatSessionId) {
      this.setCurrentChatSessionId(null, null);
    }
  }

  /**
   * Add a user message to the messages array.
   * No longer creates a ChatTurn; appends directly to the flat message list.
   */
  addUserMessage(chatSessionId: string, userMessage: Message): void {
    this.sessions.addUserMessage(chatSessionId, userMessage);
  }

  removeMessage(chatSessionId: string, messageId: string): void {
    this.sessions.removeMessage(chatSessionId, messageId);
  }


  // ========== Public API Methods ==========

  /**
   * Get the current ChatId
   */
  getCurrentChatId = (): string | null => {
    return this.currentChatId;
  };

  /**
   * Get the current ChatSessionId
   */
  getCurrentChatSessionId = (): string | null => {
    return this.currentChatSessionId;
  };

  /**
   * Manually set the current ChatSessionId (frontend use only; does not affect the backend)
   */
  setCurrentChatSessionId(chatId: string | null, chatSessionId: string | null): void {
    if (this.currentChatId === chatId && this.currentChatSessionId === chatSessionId) {
      return; // No change, skip
    }
    this.currentChatId = chatId;
    this.currentChatSessionId = chatSessionId;
    this.notifyCurrentChatSessionIdCallbacks();
  }

  /**
   * Get the cache for a specific ChatSession
   */
  getChatSessionCache(chatSessionId: string): ChatSessionCache | null {
    return this.sessions.getChatSessionCache(chatSessionId);
  }

  getCurrentChatSessionCache(): ChatSessionCache | null {
    if (!this.currentChatSessionId) return null;
    return this.sessions.getChatSessionCache(this.currentChatSessionId);
  }

  getUserMessageSendState(chatSessionId: string | null | undefined): {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  } {
    if (!chatSessionId) {
      return { canSend: false, error: 'Cannot send a new message until chat status is ready.', chatStatus: null };
    }

    const chatStatus = this.getChatSessionCache(chatSessionId)?.chatStatus ?? null;
    if (chatStatus !== 'idle') {
      return {
        canSend: false,
        error: chatStatus
          ? `Cannot send a new message while chat status is ${chatStatus}.`
          : 'Cannot send a new message until chat status is ready.',
        chatStatus,
      };
    }
    return { canSend: true, error: '', chatStatus };
  }

  /**
   * Wait until a session cache is ready to send (chatStatus === 'idle'), up to timeoutMs.
   * Resolves true when ready, false on timeout.
   */
  waitForSendReady(chatSessionId: string, timeoutMs = 5000): Promise<boolean> {
    // Already ready?
    if (this.getUserMessageSendState(chatSessionId).canSend) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = this.subscribeToChatSessionCacheLifecycle((id) => {
        if (id === chatSessionId && this.getUserMessageSendState(chatSessionId).canSend) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  hasChatSessionCache(chatSessionId: string | null | undefined): boolean {
    return this.sessions.hasChatSessionCache(chatSessionId);
  }

  /**
   * Get all ChatSession caches
   */
  getAllChatSessionCaches(): Sessions {
    return this.sessions.getAllChatSessionCaches();
  }

  /**
   * Replace file path references in the current ChatSession's cached messages.
   * Used when a file is moved to Knowledge Base - updates all path references in the frontend cache
   * so the UI immediately reflects the new file location.
   * @param oldPath - Original file path
   * @param newPath - New file path after move
   * @returns number of replacements made
   */
  replaceFilePathInMessages(oldPath: string, newPath: string): number {
    if (!this.currentChatSessionId) {
      logger.warn('[AgentChatSessionCacheManager] No current session for replaceFilePathInMessages');
      return 0;
    }

    return this.sessions.replaceFilePathInMessages(this.currentChatSessionId, oldPath, newPath);
  }

  /**
   * Manually create a ChatSession cache (for frontend-initiated creation)
   */
  createChatSessionCache(chatSessionId: string, chatId: string, initialData?: Partial<ChatSessionCache>): void {
    if (this.sessions.hasChatSessionCache(chatSessionId)) {
      logger.warn('[AgentChatSessionCacheManager] Cache already exists:', chatSessionId);
      return;
    }
    this.sessions.handleChatSessionCacheCreated(chatSessionId, chatId, initialData);
  }

  replaceMessages(chatSessionId: string, messages: Message[], updates?: Partial<ChatSessionCache>): void {
    this.sessions.replaceMessages(chatSessionId, messages, updates);
  }

  /**
   * Set the Assistant Say Hi message.
   * Used for frontend rendering only; not included in the chat context and never sent to the backend.
   * @param chatSessionId - ChatSession ID
   * @param markdownContent - Markdown greeting text; pass null or an empty string to clear it
   */
  setAssistantSayHiMessage(chatSessionId: string, markdownContent: string | null): void {
    this.sessions.setAssistantSayHiMessage(chatSessionId, markdownContent);
  }
  // ========== Callback Management ==========

  registerDirectMessageUpdateCallback(
    chatSessionId: string,
    callback: DirectMessageUpdateCallback
  ): () => void {
    // Fix: use Set to support multiple callbacks
    let callbackSet = this.directMessageUpdateCallbacks.get(chatSessionId);
    if (!callbackSet) {
      callbackSet = new Set();
      this.directMessageUpdateCallbacks.set(chatSessionId, callbackSet);
    }
    callbackSet.add(callback);
    logger.debug('[AgentChatSessionCacheManager] Registered direct callback for:', chatSessionId, 'total:', callbackSet.size);

    return () => {
      const set = this.directMessageUpdateCallbacks.get(chatSessionId);
      if (set) {
        set.delete(callback);
        logger.debug('[AgentChatSessionCacheManager] Unregistered direct callback for:', chatSessionId, 'remaining:', set.size);
        if (set.size === 0) {
          this.directMessageUpdateCallbacks.delete(chatSessionId);
        }
      }
    };
  }

  subscribeToCurrentChatSessionId = (callback: CurrentChatSessionIdCallback, skipFirst = false): VoidFunction => {
    this.currentChatSessionIdCallbacks.add(callback);
    if (!skipFirst) {
      callback(this.currentChatSessionId);
    }
    return () => {
      this.currentChatSessionIdCallbacks.delete(callback);
    };
  };

  subscribeToChatSessionCacheLifecycle(callback: ChatSessionCacheLifecycleCallback): () => void {
    this.chatSessionCacheLifecycleCallbacks.add(callback);
    return () => {
      this.chatSessionCacheLifecycleCallbacks.delete(callback);
    };
  }

  private notifyCurrentChatSessionIdCallbacks(): void {
    this.currentChatSessionIdCallbacks.forEach(callback => {
      try {
        callback(this.currentChatSessionId);
      } catch (error) {
        logger.error('[AgentChatSessionCacheManager] Error in current session callback:', error);
      }
    });
  }

  private notifyChatSessionCacheLifecycleCallbacks(chatSessionId: string): void {
    this.chatSessionCacheLifecycleCallbacks.forEach(callback => {
      try {
        callback(chatSessionId);
      } catch (error) {
        logger.error('[AgentChatSessionCacheManager] Error in cache lifecycle callback:', error);
      }
    });
  }


  // ========== Error Message Methods ==========

  /**
   * Set the error message for a ChatSession.
   * Used to display an error in the ErrorBar.
   */
  setErrorMessage(chatSessionId: string, errorMessage: string): void {
    this.sessions.setErrorMessage(chatSessionId, errorMessage);
  }

  /**
   * Clear the error message for a ChatSession.
   * Called when the user clicks Retry or the error has been handled.
   */
  clearErrorMessage(chatSessionId: string): void {
    this.sessions.clearErrorMessage(chatSessionId);
  }

  // ========== Cleanup Methods ==========

  /**
   * Clean up all caches and listeners.
   * Important fix: on logout, only clear cache data; retain IPC listeners and React subscriptions
   * so that a new user can still receive backend messages and update the UI after logging in.
   */
  cleanup(): void {
    logger.debug('[AgentChatSessionCacheManager] Cleaning up');

    // Clear all session cache data
    this.sessions.cleanup();
    // Reset the current session state and notify all subscribers
    const oldChatId = this.currentChatId;
    const oldChatSessionId = this.currentChatSessionId;
    this.setCurrentChatSessionId(null, null);

    // Notify all subscribers that the session has been cleared.
    // This causes React components to update their state.
    logger.debug('[AgentChatSessionCacheManager] 🔔 Notifying subscribers of cleared session', {
      oldChatId,
      oldChatSessionId,
      newChatId: null,
      newChatSessionId: null
    });

    logger.debug('[AgentChatSessionCacheManager] ✅ Cleanup completed, listeners preserved');
  }
}

// Windows path regex: matches paths starting with a drive letter
const WindowsPathRegex = /(?<![:/])([A-Za-z]:[\\\/](?:[^\\\/<>"'|?*:\n]+[\\\/])*[^\\\/<>"'|?*:\n]*\.[a-zA-Z0-9]+)/gi;
// Unix path regex: matches paths starting with common system directories
const UnixPathRegex = /(\/(?:Users|home|opt|var|etc|usr|Applications|Library|System|private|tmp|bin|sbin|dev|proc|sys|mnt|media|run)(?:\/[^\/\n<>"'|?*:]+)*\/[^\/\n<>"'|?*:]*\.[a-zA-Z0-9]+)/gi;

/**
 * Standalone exported function that extracts file paths from text.
 * Supports Windows and Unix path formats.
 * Used as a fallback in ChatContainer to extract file paths from assistant messages.
 */
export function extractFilePathsFromText(text: string): string[] {
  const filePaths: string[] = [];
  const matchedRanges: Array<{start: number, end: number}> = [];

  let match;

  // Extract Windows paths first and record their match positions
  while ((match = WindowsPathRegex.exec(text)) !== null) {
    const rawPath = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + rawPath.length;

    // Normalise to backslash format (Windows standard)
    const normalizedPath = rawPath.replace(/\//g, '\\');

    filePaths.push(normalizedPath);
    matchedRanges.push({ start: matchStart, end: matchEnd });
  }

  // Check whether Unix paths overlap with already-matched Windows paths
  const isOverlapping = (start: number, end: number): boolean => {
    return matchedRanges.some(range =>
      (start >= range.start && start < range.end) ||
      (end > range.start && end <= range.end) ||
      (start <= range.start && end >= range.end)
    );
  };

  // Extract Unix paths, skipping those that overlap with Windows paths
  while ((match = UnixPathRegex.exec(text)) !== null) {
    const unixPath = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + unixPath.length;

    // Skip if this Unix path overlaps with a Windows path
    if (isOverlapping(matchStart, matchEnd)) {
      continue;
    }

    filePaths.push(unixPath);
  }

  // Deduplicate and return
  return [...new Set(filePaths)];
}

export const agentChatSessionCacheManager = AgentChatSessionCacheManager.getInstance();
const manager = agentChatSessionCacheManager;

export function useCurrentChatSessionId(): string | null {
  return useSyncExternalStore(
    manager.subscribeToCurrentChatSessionId,
    manager.getCurrentChatSessionId,
    manager.getCurrentChatSessionId,
  );
}

export function useHasChatSessionCache(chatSessionId?: string | null): boolean {
  const [hasCache, setHasCache] = useState<boolean>(() => manager.hasChatSessionCache(chatSessionId));

  useEffect(() => {
    setHasCache(manager.hasChatSessionCache(chatSessionId));
    if (!chatSessionId) return;

    return manager.subscribeToChatSessionCacheLifecycle((changedChatSessionId) => {
      if (changedChatSessionId !== chatSessionId) return;
      setHasCache(manager.hasChatSessionCache(chatSessionId));
    });
  }, [chatSessionId, manager]);

  return hasCache;
}

/**
 * Reactive hook: get the current chatId (agent ID).
 * Automatically re-renders the component when currentChatId changes.
 *
 * Note: currentChatId and currentChatSessionId always change together
 * (both updated in handleCurrentChatSessionIdChanged),
 * so we can reuse subscribeToCurrentChatSessionId to watch chatId changes.
 */
export function useCurrentChatId(): string | null {
  return useSyncExternalStore(
    manager.subscribeToCurrentChatSessionId,
    manager.getCurrentChatId,
    manager.getCurrentChatId,
  );
}

const SubCurrentSession = external((update) => {
  const m = agentChatSessionCacheManager;
  const unsubSession = m.subscribeToCurrentChatSessionId(update, true);
  const unsubLifecycle = m.subscribeToChatSessionCacheLifecycle((id) => {
    if (id === m.getCurrentChatSessionId()) update();
  });
  return () => {
    unsubSession();
    unsubLifecycle();
  };
});

export const CurrentSessionStatus = SubCurrentSession(() => {
  const id = agentChatSessionCacheManager.getCurrentChatSessionId();
  if (id) {
    const cache = agentChatSessionCacheManager.getChatSessionCache(id);
    if (cache) {
      const { chatId, chatSessionId, chatStatus } = cache;
      return { chatId, chatSessionId, chatStatus };
    }
  }
  return {
    chatId: agentChatSessionCacheManager.getCurrentChatId() || undefined,
    chatSessionId: id || undefined,
    chatStatus: 'idle' as const,
  };
}, (prev, next) => {
  // session id 相同时，chat id 一定相同
  return prev.chatSessionId === next.chatSessionId && prev.chatStatus === next.chatStatus;
});

export function useStreamingMessageId(): string | null {
  const currentSessionId = useCurrentChatSessionId();
  if (!currentSessionId) {
    return null;
  }
  const cache = manager.getChatSessionCache(currentSessionId);
  return cache?.streamingMessageId || null;
}

const SubCurrentSid = external(agentChatSessionCacheManager.subscribeToCurrentChatSessionId);

export const CurrentSessionError = SubCurrentSession(() => {
  const cache = agentChatSessionCacheManager.getCurrentChatSessionCache();
  return cache?.errorMessage || null;
});

export const CurrentSessionIdle = SubCurrentSession(() => {
  const cache = agentChatSessionCacheManager.getCurrentChatSessionCache();
  if (cache && cache.chatStatus) {
    return cache.chatStatus === 'idle';
  }
  return true;
});

export const CurrentSessionInteractiveRequest = SubCurrentSession(() => {
  const cache = agentChatSessionCacheManager.getCurrentChatSessionCache();
  return cache?.pendingInteractiveRequest || null;
}, (prev, next) => prev?.interactionId === next?.interactionId);

export const { useMessages, useMessagesWithStream } = (() => {
  const EMPTY_MESSAGES: Message[] = [];
  const EMPTY_WITH_STREAM = { messages: EMPTY_MESSAGES, streamingMessageId: undefined as string | undefined };

  const { use: useMessages } = SubCurrentSession(() => {
    const cache = agentChatSessionCacheManager.getCurrentChatSessionCache();
    return cache?.messages || EMPTY_MESSAGES;
  });

  const { use: useMessagesWithStream } = SubCurrentSession(() => {
    const session = agentChatSessionCacheManager.getCurrentChatSessionCache();
    if (session) {
      const { messages, streamingMessageId } = session;
      return { messages, streamingMessageId };
    }
    return EMPTY_WITH_STREAM;
  }, (prev, next) => {
    return prev.streamingMessageId === next.streamingMessageId && prev.messages === next.messages;
  });

  return { useMessages, useMessagesWithStream };
})();
