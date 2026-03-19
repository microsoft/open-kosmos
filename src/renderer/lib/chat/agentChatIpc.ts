// src/renderer/lib/chat/agentChatIpc.ts
// AgentChat IPC Wrapper - Calls main process AgentChatManager via IPC

import { Message } from '../../types/chatTypes';
import { StreamingChunk } from '../../types/streamingTypes';

/**
 * Approval request interface
 */
export interface ApprovalRequest {
  type: 'tool_approval_request';
  requestId: string;
  toolName: string;
  path: string;
  ask_for_approval: string;
  user_response_candidates: string[];
}

/**
 * AgentChatIpc - IPC wrapper for main process AgentChatManager
 * Provides the same interface as the renderer process agentChatManager, but actually calls the main process via IPC
 */
class AgentChatIpc {
  private streamingMessageListeners: ((message: any) => void)[] = [];
  private toolUseListeners: ((toolName: string) => void)[] = [];
  private toolResultListeners: ((result: any) => void)[] = [];
  private contextChangeListeners: ((stats: any) => void)[] = [];
  private approvalRequestListeners: ((request: ApprovalRequest) => void)[] = [];
  
  private streamingCleanup: (() => void) | null = null;
  private toolUseCleanup: (() => void) | null = null;
  private toolResultCleanup: (() => void) | null = null;
  private toolMessageAddedCleanup: (() => void) | null = null;
  private contextChangeCleanup: (() => void) | null = null;
  private approvalRequestCleanup: (() => void) | null = null;
  private streamingChunkCleanup: (() => void) | null = null;
  
  // 🔥 Cache the last received context stats, for listeners registered later
  private lastContextStats: any | null = null;
  
  constructor() {
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // 🔥 Set up unified streaming chunk listener
    // All streaming chunks are automatically forwarded to AgentChatSessionCacheManager (via IPC listener)
    // Only cleanup logic is kept here, actual processing is in AgentChatSessionCacheManager
    this.streamingChunkCleanup = window.electronAPI.agentChat.onStreamingChunk((chunk: StreamingChunk) => {
      // chunk is automatically processed by AgentChatSessionCacheManager's IPC listener
      // Nothing needs to be done here, just keep the connection alive
    });
    
    // 🔥 Keep old streamingMessage listener for backward compatibility (if backend still sends them)
    this.streamingCleanup = window.electronAPI.agentChat.onStreamingMessage((message: any) => {
      this.streamingMessageListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('[AgentChatIpc] Error in streaming message listener:', error);
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
    
    // 🔥 New: Listen for toolMessageAdded event from main process and forward as window custom event
    this.toolMessageAddedCleanup = window.electronAPI.agentChat.onToolMessageAdded((data: any) => {
      
      // Forward as window custom event for AgentPage.tsx to listen to
      const event = new CustomEvent('agentChat:toolMessageAdded', {
        detail: data
      });
      window.dispatchEvent(event);
      
    });
    
    // 🔄 Listen for contextChange event from main process and forward
    this.contextChangeCleanup = window.electronAPI.agentChat.onContextChange((data: any) => {
      // 🔥 Remove filter: all context change events will be forwarded to Cache Manager
      console.log('[AgentChatIpc] 📊 Context change event received', {
        chatSessionId: data.chatSessionId,
        tokenCount: data.stats?.tokenCount
      });
      
      // 🔥 Cache the latest stats for listeners registered later
      this.lastContextStats = data.stats;
      
      // Notify all local listeners (passing stats object)
      if (this.contextChangeListeners.length > 0) {
        this.contextChangeListeners.forEach(listener => {
          try {
            listener(data.stats);
          } catch (error) {
            console.error('[AgentChatIpc] Error in context change listener:', error);
          }
        });
      } else {
        console.log('[AgentChatIpc] No context change listeners registered');
      }
    });
    
    // 🔥 New: Listen for approval request events
    this.approvalRequestCleanup = window.electronAPI.agentChat.onApprovalRequest((request: ApprovalRequest) => {
      
      // Notify all listeners
      this.approvalRequestListeners.forEach(listener => {
        try {
          listener(request);
        } catch (error) {
        }
      });
    });
  }
  
  /**
   * 🔥 New: Add approval request listener
   */
  addApprovalRequestListener(listener: (request: ApprovalRequest) => void): void {
    this.approvalRequestListeners.push(listener);
  }
  
  /**
   * 🔥 New: Remove approval request listener
   */
  removeApprovalRequestListener(listener: (request: ApprovalRequest) => void): void {
    const index = this.approvalRequestListeners.indexOf(listener);
    if (index > -1) {
      this.approvalRequestListeners.splice(index, 1);
    }
  }
  
  /**
   * 🔥 New: Send approval response to main process
   */
  async sendApprovalResponse(requestId: string, userResponse: 'approved' | 'rejected'): Promise<void> {
    const approved = userResponse === 'approved';
    const result = await window.electronAPI.agentChat.sendApprovalResponse({ requestId, approved });
    if (!result.success) {
      throw new Error(result.error || 'Failed to send approval response');
    }
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
    
    console.log('[AgentChatIpc] 🔄 Switching to chatSession:', {
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
    // Note: This is a synchronous method, but IPC calls are asynchronous
    // We need to use the async version in components
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
    // Synchronous method, need to use async version
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
    // Synchronous method, need to use async version
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
   * 🔥 New: Get messages for display (Custom System Prompt + chat history)
   * This is the recommended method, explicitly indicating it returns messages for UI display
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
    message: Message,
    callbacks?: {
      onAssistantMessage?: (message: Message) => void;
      onToolUse?: (toolName: string) => void;
      onToolResult?: (result: Message) => void;
    }
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
      const result = await window.electronAPI.agentChat.streamMessage(message);
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
   * Does not add new messages, uses existing context history to re-call LLM API
   * @param chatSessionId The chat session ID to retry
   */
  async retryChat(chatSessionId: string): Promise<Message[]> {
    console.log('[AgentChatIpc] 🔄 Retrying chat...', { chatSessionId });
    
    try {
      const result = await window.electronAPI.agentChat.retryChat(chatSessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to retry chat');
      }
      console.log('[AgentChatIpc] ✅ Retry chat completed');
      return result.data || [];
    } catch (error) {
      console.error('[AgentChatIpc] ❌ Retry chat failed:', error);
      throw error;
    }
  }
  
  /**
   * 🔥 New: Cancel the current ongoing ChatSession conversation
   * @param chatSessionId The chatSession ID to cancel, if not provided cancels the current chatSession
   */
  async cancelChatSession(chatSessionId?: string): Promise<void> {
    try {
      if (!chatSessionId) {
        console.warn('[AgentChatIpc] No chat session ID to cancel');
        return;
      }
      
      console.log('[AgentChatIpc] 🛑 Cancelling chat session:', chatSessionId);
      
      // Call backend IPC cancel method
      const result = await window.electronAPI.agentChat.cancelChatSession(chatSessionId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel chat session');
      }
      
      console.log('[AgentChatIpc] ✅ Chat session cancelled successfully');
    } catch (error) {
      console.error('[AgentChatIpc] ❌ Error cancelling chat session:', error);
      throw error;
    }
  }
  
  /**
   * 🔥 Backward compatible: Cancel the current ongoing conversation
   * @param chatId The chat ID to cancel, if not provided cancels the current chat
   */
  async cancelChat(chatId?: string): Promise<void> {
    try {
      const targetChatId = chatId || await this.getCurrentChatIdAsync();
      
      if (!targetChatId) {
        console.warn('[AgentChatIpc] No chat ID to cancel');
        return;
      }
      
      console.log('[AgentChatIpc] 🛑 Cancelling chat:', targetChatId);
      
      // Call backend IPC cancel method
      const result = await window.electronAPI.agentChat.cancelChat(targetChatId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel chat');
      }
      
      console.log('[AgentChatIpc] ✅ Chat cancelled successfully');
    } catch (error) {
      console.error('[AgentChatIpc] ❌ Error cancelling chat:', error);
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
   * 🔄 New: Add context change listener
   */
  addContextChangeListener(listener: (stats: any) => void): void {
    this.contextChangeListeners.push(listener);
    
    // 🔥 If there are cached stats, immediately notify new listener
    if (this.lastContextStats) {
      try {
        listener(this.lastContextStats);
      } catch (error) {
      }
    } else {
    }
  }
  
  /**
   * 🔄 New: Remove context change listener
   */
  removeContextChangeListener(listener: (stats: any) => void): void {
    const index = this.contextChangeListeners.indexOf(listener);
    if (index > -1) {
      this.contextChangeListeners.splice(index, 1);
    }
  }
  
  /**
   * 🔥 New: Get current Context Token usage (frontend actively pulls)
   */
  async getCurrentContextTokenUsage(): Promise<{tokenCount: number; totalMessages: number; contextMessages: number; compressionRatio: number} | null> {
    try {
      const result = await window.electronAPI.agentChat.getCurrentContextTokenUsage();
      if (!result.success || !result.data) {
        console.warn('[AgentChatIpc] Failed to get context token usage:', result.error);
        return null;
      }
      return result.data;
    } catch (error) {
      console.error('[AgentChatIpc] Error getting context token usage:', error);
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
    if (this.approvalRequestCleanup) {
      this.approvalRequestCleanup();
      this.approvalRequestCleanup = null;
    }
    
    // Clean up listener arrays
    this.streamingMessageListeners = [];
    this.toolUseListeners = [];
    this.toolResultListeners = [];
    this.contextChangeListeners = [];
    this.approvalRequestListeners = [];
  }
}

// Export singleton instance
export const agentChatIpc = new AgentChatIpc();