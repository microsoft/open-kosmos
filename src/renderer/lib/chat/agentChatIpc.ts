// src/renderer/lib/chat/agentChatIpc.ts
// AgentChat IPC wrapper - calls AgentChatManager in the main process via IPC

import { Message, UserMessage } from '@shared/types/chatTypes';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[AgentChatIpc]');

/**
 * AgentChatIpc - IPC wrapper for the main process AgentChatManager
 * Provides the same interface as the renderer-side agentChatManager but calls the main process via IPC
 */
class AgentChatIpc {
  private streamingMessageListeners: ((message: any) => void)[] = [];
  private toolUseListeners: ((toolName: string) => void)[] = [];
  private toolResultListeners: ((result: any) => void)[] = [];
  private contextChangeListeners: ((stats: any) => void)[] = [];

  private streamingCleanup: (() => void) | null = null;
  private toolUseCleanup: (() => void) | null = null;
  private toolResultCleanup: (() => void) | null = null;
  private toolMessageAddedCleanup: (() => void) | null = null;
  private contextChangeCleanup: (() => void) | null = null;
  private streamingChunkCleanup: (() => void) | null = null;

  // 🔥 Cache the last received context stats for late-registered listeners
  private lastContextStats: any | null = null;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // 🔥 Set up unified streaming chunk listener
    // All streaming chunks are automatically forwarded to AgentChatSessionCacheManager (via IPC listener)
    // Only cleanup logic is kept here; actual processing happens in AgentChatSessionCacheManager
    this.streamingChunkCleanup = window.electronAPI.agentChat.onStreamingChunk((chunk: StreamingChunk) => {
      // chunk is automatically handled by AgentChatSessionCacheManager's IPC listener
      // No action needed here; just keep the connection alive
    });

    // 🔥 Retain old streamingMessage listener for backward compatibility (in case backend still sends it)
    this.streamingCleanup = window.electronAPI.agentChat.onStreamingMessage((message: any) => {
      this.streamingMessageListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          logger.error('[AgentChatIpc] Error in streaming message listener:', error);
        }
      });
    });

    // Set up tool use listener
    this.toolUseCleanup = window.electronAPI.agentChat.onToolUse((toolName: string) => {
      this.toolUseListeners.forEach(listener => {
        try {
          listener(toolName);
        } catch (error) {
        }
      });
    });

    // Set up tool result listener
    this.toolResultCleanup = window.electronAPI.agentChat.onToolResult((result: any) => {
      this.toolResultListeners.forEach(listener => {
        try {
          listener(result);
        } catch (error) {
        }
      });
    });

    // 🔥 Added: listen for toolMessageAdded events from the main process and forward as window custom events
    this.toolMessageAddedCleanup = window.electronAPI.agentChat.onToolMessageAdded((data: any) => {

      // Forward as a window custom event for AgentPage.tsx to listen on
      const event = new CustomEvent('agentChat:toolMessageAdded', {
        detail: data
      });
      window.dispatchEvent(event);

    });

    // 🔄 Listen for contextChange events from the main process and forward them
    this.contextChangeCleanup = window.electronAPI.agentChat.onContextChange((data: any) => {
      // 🔥 Remove filter: all context change events are forwarded to Cache Manager
      logger.debug('[AgentChatIpc] 📊 Context change event received', {
        chatSessionId: data.chatSessionId,
        tokenCount: data.stats?.tokenCount
      });

      // 🔥 Cache the latest stats for subsequent listeners
      this.lastContextStats = data.stats;

      // Notify all local listeners (passing the stats object)
      if (this.contextChangeListeners.length > 0) {
        this.contextChangeListeners.forEach(listener => {
          try {
            listener(data.stats);
          } catch (error) {
            logger.error('[AgentChatIpc] Error in context change listener:', error);
          }
        });
      } else {
        logger.debug('[AgentChatIpc] No context change listeners registered');
      }
    });
  }

  /**
   * Initialize AgentChatManager
   */
  async initialize(alias: string): Promise<void> {
    const result = await window.electronAPI.agentChat.initialize(alias);
    if (!result.success) {
      throw new Error(result.error || 'Failed to initialize AgentChatManager');
    }
  }

  /**
   * 🔥 Switch to the specified ChatSession
   */
  async switchToChatSession(chatId: string, chatSessionId: string | null): Promise<any | null> {
    if (!chatId || !chatSessionId) {
      return null;
    }

    logger.debug('[AgentChatIpc] 🔄 Switching to chatSession:', {
      chatId,
      chatSessionId
    });

    const result = await window.electronAPI.agentChat.switchToChatSession(chatId, chatSessionId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to switch to chat session');
    }
    return result.data;
  }

  /**
   * Get current AgentChat instance info
   */
  getCurrentInstance(): any | null {
    // Note: this is a synchronous method, but IPC calls are asynchronous
    // Use the async version in components
    throw new Error('Use getCurrentInstanceAsync() instead');
  }

  /**
   * Get current AgentChat instance info (async version)
   */
  async getCurrentInstanceAsync(): Promise<any | null> {
    const result = await window.electronAPI.agentChat.getCurrentInstance();
    if (!result.success) {
      return null;
    }
    return result.data;
  }

  /**
   * Get current Chat ID
   */
  getCurrentChatId(): string | null {
    // Synchronous method; use the async version
    throw new Error('Use getCurrentChatIdAsync() instead');
  }

  /**
   * Get current Chat ID (async version)
   */
  async getCurrentChatIdAsync(): Promise<string | null> {
    const result = await window.electronAPI.agentChat.getCurrentChatId();
    if (!result.success) {
      return null;
    }
    return result.data ?? null;
  }

  /**
   * Get chat history
   */
  getChatHistory(): Message[] {
    // Synchronous method; use the async version
    throw new Error('Use getChatHistoryAsync() instead');
  }

  /**
   * Get chat history (async version)
   */
  async getChatHistoryAsync(): Promise<Message[]> {
    const result = await window.electronAPI.agentChat.getChatHistory();
    if (!result.success) {
      return [];
    }
    return result.data || [];
  }

  /**
   * 🔥 Added: get messages for display (Custom System Prompt + chat history)
   * This is the recommended method; it explicitly returns messages intended for UI display
   */
  async getDisplayMessagesAsync(): Promise<Message[]> {
    const result = await window.electronAPI.agentChat.getDisplayMessages();
    if (!result.success) {
      return [];
    }
    return result.data || [];
  }

  /**
   * Process conversation
   */
  async streamMessage(
    message: UserMessage,
    callbacks?: {
      onAssistantMessage?: (message: Message) => void;
      onToolUse?: (toolName: string) => void;
      onToolResult?: (result: Message) => void;
    },
    targetChatSessionId?: string,
  ): Promise<Message[]> {
    // Set up callback listeners
    if (callbacks?.onAssistantMessage) {
      this.streamingMessageListeners.push(callbacks.onAssistantMessage);
    }
    if (callbacks?.onToolUse) {
      this.toolUseListeners.push(callbacks.onToolUse);
    }
    if (callbacks?.onToolResult) {
      this.toolResultListeners.push(callbacks.onToolResult);
    }

    try {
      const result = await window.electronAPI.agentChat.streamMessage(message, targetChatSessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to process conversation');
      }
      return result.data || [];
    } finally {
      // Clean up callback listeners
      if (callbacks?.onAssistantMessage) {
        const index = this.streamingMessageListeners.indexOf(callbacks.onAssistantMessage);
        if (index > -1) {
          this.streamingMessageListeners.splice(index, 1);
        }
      }
      if (callbacks?.onToolUse) {
        const index = this.toolUseListeners.indexOf(callbacks.onToolUse);
        if (index > -1) {
          this.toolUseListeners.splice(index, 1);
        }
      }
      if (callbacks?.onToolResult) {
        const index = this.toolResultListeners.indexOf(callbacks.onToolResult);
        if (index > -1) {
          this.toolResultListeners.splice(index, 1);
        }
      }
    }
  }

  /**
   * 🔥 Retry the last failed conversation
   * Does not add a new message; re-calls the LLM API using the existing context history
   * @param chatSessionId the chat session ID to retry
   */
  async retryChat(chatSessionId: string): Promise<Message[]> {
    logger.debug('[AgentChatIpc] 🔄 Retrying chat...', { chatSessionId });

    try {
      const result = await window.electronAPI.agentChat.retryChat(chatSessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to retry chat');
      }
      logger.debug('[AgentChatIpc] ✅ Retry chat completed');
      return result.data || [];
    } catch (error) {
      logger.error('[AgentChatIpc] ❌ Retry chat failed:', error);
      throw error;
    }
  }

  async editUserMessage(
    chatSessionId: string,
    messageId: string,
    updatedMessage: Message,
  ): Promise<Message[]> {
    logger.debug('[AgentChatIpc] ✏️ Editing user message...', {
      chatSessionId,
      messageId,
    });

    const result = await window.electronAPI.agentChat.editUserMessage(
      chatSessionId,
      messageId,
      updatedMessage,
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to edit user message');
    }

    return result.data || [];
  }

  async canEditUserMessage(
    chatSessionId: string,
    messageId: string,
  ): Promise<{ canEdit: boolean; error?: string }> {
    const result = await window.electronAPI.agentChat.canEditUserMessage(
      chatSessionId,
      messageId,
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to validate user message editability');
    }

    return result.data || { canEdit: false, error: 'Failed to validate user message editability' };
  }

  /**
   * 🔥 Added: cancel the currently active ChatSession conversation
   * @param chatSessionId the chatSession ID to cancel; cancels the current session if not provided
   */
  async cancelChatSession(chatSessionId?: string): Promise<void> {
    try {
      if (!chatSessionId) {
        logger.warn('[AgentChatIpc] No chat session ID to cancel');
        return;
      }

      logger.debug('[AgentChatIpc] 🛑 Cancelling chat session:', chatSessionId);

      // Call the backend IPC cancel method
      const result = await window.electronAPI.agentChat.cancelChatSession(chatSessionId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel chat session');
      }

      logger.debug('[AgentChatIpc] ✅ Chat session cancelled successfully');
    } catch (error) {
      logger.error('[AgentChatIpc] ❌ Error cancelling chat session:', error);
      throw error;
    }
  }

  /**
   * 🔥 Backward compatible: cancel the currently active conversation
   * @param chatId the chat ID to cancel; cancels the current chat if not provided
   */
  async cancelChat(chatId?: string): Promise<void> {
    try {
      const targetChatId = chatId || await this.getCurrentChatIdAsync();

      if (!targetChatId) {
        logger.warn('[AgentChatIpc] No chat ID to cancel');
        return;
      }

      logger.debug('[AgentChatIpc] 🛑 Cancelling chat:', targetChatId);

      // Call the backend IPC cancel method
      const result = await window.electronAPI.agentChat.cancelChat(targetChatId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel chat');
      }

      logger.debug('[AgentChatIpc] ✅ Chat cancelled successfully');
    } catch (error) {
      logger.error('[AgentChatIpc] ❌ Error cancelling chat:', error);
      throw error;
    }
  }

  /**
   * Sync chat history
   */
  async syncChatHistory(messages: Message[]): Promise<void> {
    const result = await window.electronAPI.agentChat.syncChatHistory(messages);
    if (!result.success) {
    }
  }

  /**
   * Refresh current instance
   */
  async refreshCurrentInstance(): Promise<any | null> {
    const result = await window.electronAPI.agentChat.refreshCurrentInstance();
    if (!result.success) {
      return null;
    }
    return result.data;
  }

  /**
   * 🔄 Added: add a context change listener
   */
  addContextChangeListener(listener: (stats: any) => void): void {
    this.contextChangeListeners.push(listener);

    // 🔥 If there are cached stats, notify the new listener immediately
    if (this.lastContextStats) {
      try {
        listener(this.lastContextStats);
      } catch (error) {
      }
    } else {
    }
  }

  /**
   * 🔄 Added: remove a context change listener
   */
  removeContextChangeListener(listener: (stats: any) => void): void {
    const index = this.contextChangeListeners.indexOf(listener);
    if (index > -1) {
      this.contextChangeListeners.splice(index, 1);
    }
  }

  /**
   * 🔥 Added: get current Context Token usage (renderer-initiated pull)
   */
  async getCurrentContextTokenUsage(): Promise<{tokenCount: number; totalMessages: number; contextMessages: number; compressionRatio: number} | null> {
    try {
      const result = await window.electronAPI.agentChat.getCurrentContextTokenUsage();
      if (!result.success || !result.data) {
        logger.warn('[AgentChatIpc] Failed to get context token usage:', result.error);
        return null;
      }
      return result.data;
    } catch (error) {
      logger.error('[AgentChatIpc] Error getting context token usage:', error);
      return null;
    }
  }

  /**
   * Destroy AgentChatIpc
   */
  destroy(): void {
    // Clean up event listeners
    if (this.streamingChunkCleanup) {
      this.streamingChunkCleanup();
      this.streamingChunkCleanup = null;
    }
    if (this.streamingCleanup) {
      this.streamingCleanup();
      this.streamingCleanup = null;
    }
    if (this.toolUseCleanup) {
      this.toolUseCleanup();
      this.toolUseCleanup = null;
    }
    if (this.toolResultCleanup) {
      this.toolResultCleanup();
      this.toolResultCleanup = null;
    }
    if (this.toolMessageAddedCleanup) {
      this.toolMessageAddedCleanup();
      this.toolMessageAddedCleanup = null;
    }
    if (this.contextChangeCleanup) {
      this.contextChangeCleanup();
      this.contextChangeCleanup = null;
    }
    // Clean up listener arrays
    this.streamingMessageListeners = [];
    this.toolUseListeners = [];
    this.toolResultListeners = [];
    this.contextChangeListeners = [];
  }
}

// Export singleton instance
export const agentChatIpc = new AgentChatIpc();