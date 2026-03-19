// src/main/lib/chat/agentChatManager.ts
// AgentChatManager - Main Process version - Unified AgentChat instance management center

import { AgentChat, AgentConfig } from './agentChat';
import { Message } from '../types/chatTypes';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { chatSessionManager } from '../userDataADO/chatSessionManager';
import type { ChatAgent, ChatConfig } from '../userDataADO/types/profile';
import { createLogger } from '../unifiedLogger';
import { CancellationTokenSource, CancellationError } from '../cancellation';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger();

/**
 * AgentChatManager - Singleton pattern AgentChat instance manager (Main Process version)
 *
 * Responsibilities:
 * 1. Manage AgentChat instances at ChatSessionId granularity
 * 2. Unified creation and management of ChatSessionIds
 * 3. Each ChatSessionId corresponds to an independent AgentChat instance
 * 4. Provide Runtime instance caching to avoid redundant creation
 * 5. Handle instance synchronization during ChatSession switching
 * 6. Manage chatSessionId identification for streaming chunks
 */
export class AgentChatManager {
  private static instance: AgentChatManager;
  
  // Runtime instance cache - key: chatSessionId, value: AgentChat instance
  private agentInstances: Map<string, AgentChat> = new Map();
  
  // CancellationTokenSource cache - key: chatSessionId, value: CancellationTokenSource
  private cancellationSources: Map<string, CancellationTokenSource> = new Map();
  
  // 🔥 New: ChatId to new ChatSessionId mapping - used for new conversation flow
  private newChatSessionIdForChatId: Map<string, string> = new Map();
  
  // Currently active AgentChat instance and ChatSessionId
  private currentInstance: AgentChat | null = null;
  private currentChatSessionId: string | null = null;
  
  // Current user alias
  private currentUserAlias: string | null = null;
  
  // Main window reference for sending IPC events
  private mainWindow: Electron.BrowserWindow | null = null;
  
  // Lifecycle state
  private isInitialized: boolean = false;
  
  // 🔥 New: Idle instance cleanup mechanism
  // key: chatSessionId, value: { timer: NodeJS.Timeout, idleSince: number }
  private idleTimers: Map<string, { timer: NodeJS.Timeout; idleSince: number }> = new Map();
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  
  private constructor() {
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): AgentChatManager {
    if (!AgentChatManager.instance) {
      AgentChatManager.instance = new AgentChatManager();
    }
    return AgentChatManager.instance;
  }
  
  /**
   * Initialize AgentChatManager
   * 🔥 Note: No longer responsible for auto-selecting primaryAgent; frontend AgentPage calls startNewChatFor on page load
   */
  async initialize(alias: string): Promise<void> {
    if (this.isInitialized && this.currentUserAlias === alias) {
      return;
    }
    
    this.currentUserAlias = alias;
    this.isInitialized = true;
    
    logger.info('[AgentChatManager] Initialized for user', 'initialize', { alias });
  }
  
  /**
   * Generate ChatSessionId
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
   * Ensure Chat Session file directory exists
   * Creates YYYYMM/ChatSessionId directory structure under agent.config.workspace
   * @param chatId Chat ID
   * @param chatSessionId Chat Session ID (format: chatSession_YYYYMMDDHHmmss)
   */
  private async ensureChatSessionDirectory(chatId: string, chatSessionId: string): Promise<string | null> {
    try {
      if (!this.currentUserAlias) {
        logger.warn('[AgentChatManager] No current user alias, skip creating chat session directory');
        return null;
      }

      // Get agent's workspace path
      const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, chatId);
      const workspacePath = chatConfig?.agent?.workspace;

      if (!workspacePath || workspacePath.trim() === '') {
        logger.warn(`[AgentChatManager] No workspace path for chat ${chatId}, skip creating chat session directory`);
        return null;
      }

      // Extract YYYYMM from chatSessionId
      // chatSessionId format: chatSession_YYYYMMDDHHmmss
      const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
      if (!match) {
        logger.warn(`[AgentChatManager] Invalid chatSessionId format: ${chatSessionId}, skip creating directory`);
        return null;
      }

      const yyyymm = `${match[1]}${match[2]}`;

      // Create YYYYMM directory
      const monthDir = path.join(workspacePath, yyyymm);
      if (!fs.existsSync(monthDir)) {
        fs.mkdirSync(monthDir, { recursive: true });
        logger.info('[AgentChatManager] Created month directory', 'ensureChatSessionDirectory', { monthDir });
      }

      // Create ChatSessionId directory
      const sessionDir = path.join(monthDir, chatSessionId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
        logger.info('[AgentChatManager] Created chat session directory', 'ensureChatSessionDirectory', { sessionDir });
      }

      return sessionDir;
    } catch (error) {
      logger.error(`[AgentChatManager] Failed to create chat session directory for ${chatId}/${chatSessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }
  
  /**
   * Switch to the specified ChatSession
   */
  async switchToChatSession(chatId: string, chatSessionId: string | null): Promise<AgentChat | null> {
    // 🔥 New: Record the old currentChatSessionId for triggering lost-focus handling
    const previousChatSessionId = this.currentChatSessionId;
    
    if (!chatId || !chatSessionId) {
      this.currentInstance = null;
      this.currentChatSessionId = null;
      
      // 🔥 New: Notify frontend of currentChatSessionId change
      this.notifyCurrentChatSessionIdChanged(null, null);
      
      // 🔥 New: If there was a previous current session, check its status and possibly start timer
      if (previousChatSessionId) {
        this.handleSessionLostFocus(previousChatSessionId);
      }
      
      return null;
    }
    
    // If already the current ChatSession, return directly
    if (this.currentChatSessionId === chatSessionId && this.currentInstance) {
      // 🔥 New: Activate current instance, cancel its idle timer
      this.cancelIdleTimer(chatSessionId);
      // 🔥 Fix: Ensure renderer is notified even if session hasn't changed (e.g. after refresh)
      this.notifyCurrentChatSessionIdChanged(chatId, chatSessionId);
      
      // 🔥 Fix: Also resend the cache data because the renderer might have lost it (e.g. refresh)
      this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
        renderChatHistory: this.currentInstance.getDisplayMessages(),
        chatStatus: this.currentInstance.getChatStatus(),
        contextTokenUsage: this.currentInstance.getContextTokenUsage()
      });
      
      return this.currentInstance;
    }
    
    // Get or create AgentChat instance (by ChatSessionId)
    const instance = await this.getOrCreateInstanceByChatSession(chatId, chatSessionId);
    
    if (instance) {
      // 🔥 New: If there was a different previous current session, handle its lost focus
      if (previousChatSessionId && previousChatSessionId !== chatSessionId) {
        this.handleSessionLostFocus(previousChatSessionId);
      }
      
      // Update current state
      this.currentInstance = instance;
      this.currentChatSessionId = chatSessionId;
      
      // 🔥 New: Notify frontend of currentChatSessionId change
      this.notifyCurrentChatSessionIdChanged(chatId, chatSessionId);
      
      // 🔥 New: Activate instance, cancel its idle timer
      this.cancelIdleTimer(chatSessionId);
      
      // Set context change listener for the new current instance
      this.setupContextChangeListener(instance, chatSessionId);
      
      const agentInfo = await instance.getAgentInfo();
      logger.info('[AgentChatManager] Switched to chat session', 'switchToChatSession', {
        chatId,
        chatSessionId,
        agentName: agentInfo.name
      });
      
      // 🔥 Fix: No longer proactively push Chat Status
      // Frontend will proactively call getChatStatusInfo() to get initial state after switching
    }
    
    return instance;
  }
  
  
  /**
   * Get or create AgentChat instance
   */
  private async getOrCreateInstanceByChatSession(chatId: string, chatSessionId: string): Promise<AgentChat | null> {
    // Check cache (by ChatSessionId)
    if (this.agentInstances.has(chatSessionId)) {
      const instance = this.agentInstances.get(chatSessionId)!;
      // 🔥 Fix: Always notify cache created, in case renderer missed it (e.g. refresh)
      this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
        renderChatHistory: instance.getDisplayMessages(),
        chatStatus: instance.getChatStatus(),
        contextTokenUsage: instance.getContextTokenUsage()
      });
      return instance;
    }
    
    if (!this.currentUserAlias) {
      logger.error('[AgentChatManager] No current user alias set');
      return null;
    }
    
    // Verify chat config exists (but don't need to read detailed config)
    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, chatId);
    if (!chatConfig || !chatConfig.agent) {
      logger.error(`[AgentChatManager] No chat config or agent found for chat: ${chatId}`);
      return null;
    }
    
    try {
      logger.info('[AgentChatManager] Creating new AgentChat instance', 'getOrCreateInstanceByChatSession', {
        chatId,
        chatSessionId,
        agentName: chatConfig.agent.name
      });
      
      // 🔥 Load existing ChatSession data (using the new chatSessionManager architecture)
      let chatSessionData: any = null;
      try {
        chatSessionData = await chatSessionManager.getChatSessionFile(this.currentUserAlias, chatId, chatSessionId);
        
        if (chatSessionData) {
          logger.info('[AgentChatManager] Found existing ChatSession data', 'getOrCreateInstanceByChatSession', {
            chatSessionId,
            chatId,
            title: chatSessionData.title,
            messagesCount: chatSessionData.chat_history?.length || 0
          });
        }
      } catch (loadError) {
        logger.warn('[AgentChatManager] Failed to load existing ChatSession data, creating new session', 'getOrCreateInstanceByChatSession', {
          chatSessionId,
          chatId,
          error: loadError instanceof Error ? loadError.message : String(loadError)
        });
      }
      
      // Create AgentChat instance
      const instance = await this.createAgentWithChatSession(
        this.currentUserAlias,
        chatId,
        chatSessionId,
        chatSessionData // 🔥 Pass ChatSession data (if exists)
      );
      
      // Set context change listener
      this.setupContextChangeListener(instance, chatSessionId);
      
      // 🔥 New: Listen for AgentChat status changes, used for idle cleanup mechanism
      this.setupStatusChangeListener(instance, chatSessionId);
      
      // Cache instance (by ChatSessionId)
      this.agentInstances.set(chatSessionId, instance);
      
      // 🔥 New: Notify frontend to create ChatSession cache
      this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
        renderChatHistory: instance.getDisplayMessages(),
        chatStatus: instance.getChatStatus(),
        contextTokenUsage: instance.getContextTokenUsage()
      });
      
      return instance;
      
    } catch (error) {
      logger.error(`[AgentChatManager] Failed to create AgentChat instance for chatSession: ${chatSessionId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Clean up expired ChatSession instances
   */
  private cleanupObsoleteInstances(currentChats: ChatConfig[]): void {
    const validChatIds = new Set(currentChats.map(c => c.chat_id));
    
    // Get chatId from instances to determine if they are still valid
    const instancesToRemove: string[] = [];
    this.agentInstances.forEach((instance, chatSessionId) => {
      const instanceChatId = instance.getChatId();
      if (!validChatIds.has(instanceChatId)) {
        instancesToRemove.push(chatSessionId);
      }
    });
    
    // 🔥 Modified: Use unified cleanup method
    for (const chatSessionId of instancesToRemove) {
      this.removeInstanceByChatSession(chatSessionId);
    }
  }
  
  /**
   * Remove the specified ChatSession instance
   * 🔥 Modified: Changed from private to public, for external calls (e.g., cleaning up instance when deleting ChatSession)
   */
  public removeInstanceByChatSession(chatSessionId: string): void {
    const instance = this.agentInstances.get(chatSessionId);
    if (instance) {
      // 🔥 New: Clean up status check timer
      const checkInterval = (instance as any).__statusCheckInterval;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      
      // 🔥 New: Clean up idle timer
      this.cancelIdleTimer(chatSessionId);
      
      instance.destroy();
      this.agentInstances.delete(chatSessionId);
      
      // 🔥 New: Notify frontend to destroy ChatSession cache
      this.notifyChatSessionCacheDestroyed(chatSessionId);
      
      // If it's the current instance, also clean up
      if (this.currentChatSessionId === chatSessionId) {
        this.currentInstance = null;
        this.currentChatSessionId = null;
        // Notify frontend of currentChatSessionId change
        this.notifyCurrentChatSessionIdChanged(null, null);
      }
    }
  }
  
  
  // ========== Public interface methods ==========
  
  /**
   * Get the currently active AgentChat instance
   */
  getCurrentInstance(): AgentChat | null {
    return this.currentInstance;
  }
  
  /**
   * 🔥 Get AgentChat instance by chatSessionId
   * Used for scenarios requiring operations on a specific session (e.g., retry)
   */
  getInstanceByChatSessionId(chatSessionId: string): AgentChat | null {
    return this.agentInstances.get(chatSessionId) || null;
  }
  
  /**
   * Refresh current instance
   */
  async refreshCurrentInstance(): Promise<AgentChat | null> {
    if (!this.currentChatSessionId) {
      return null;
    }
    
    const chatSessionId = this.currentChatSessionId;
    const instance = this.agentInstances.get(chatSessionId);
    if (!instance) {
      return null;
    }
    
    const chatId = instance.getChatId();
    
    // Remove current instance
    this.removeInstanceByChatSession(chatSessionId);
    
    // Recreate
    return await this.switchToChatSession(chatId, chatSessionId);
  }
  
  /**
   * Sync ChatHistory to current instance
   */
  syncChatHistory(messages: Message[]): void {
    if (this.currentInstance) {
      logger.warn('[AgentChatManager] syncChatHistory not fully implemented in main process version');
    } else {
      logger.warn('[AgentChatManager] No current instance to sync chat history to');
    }
  }
  
  /**
   * Get ChatHistory
   */
  getChatHistory(): Message[] {
    if (this.currentInstance) {
      return this.currentInstance.getChatHistory();
    }
    return [];
  }
  
  /**
   * 🔥 New: Start new conversation for specified ChatId
   * Responsibilities:
   * 1. Check if there's already a new ChatSessionId, generate one if not
   * 2. Ensure instance exists (via getOrCreateInstanceByChatSession)
   * 3. Call switchToChatSession to handle switching and notifications uniformly
   */
  async startNewChatFor(chatId: string): Promise<AgentChat | null> {
    if (!chatId) {
      logger.error('[AgentChatManager] chatId is required for startNewChatFor');
      return null;
    }
    
    logger.info('[AgentChatManager] Starting new chat for chatId:', 'startNewChatFor', { chatId });
    
    // Check if the newChatSessionIdForChatId map already has a New ChatSessionId for this ChatId
    let newChatSessionId = this.newChatSessionIdForChatId.get(chatId);
    
    if (newChatSessionId) {
      // If there's already a new ChatSessionId, switch via switchToChatSession
      logger.info('[AgentChatManager] Found existing new ChatSessionId for chatId:', 'startNewChatFor', {
        chatId,
        newChatSessionId
      });
    } else {
      // If no new ChatSessionId exists, generate a new ChatSessionId for this ChatId and record in mapping
      newChatSessionId = this.generateChatSessionId();
      this.newChatSessionIdForChatId.set(chatId, newChatSessionId);
      
      logger.info('[AgentChatManager] Generated new ChatSessionId for chatId:', 'startNewChatFor', {
        chatId,
        newChatSessionId
      });
    }
    
    // 🔥 Handle switching and notifications uniformly via switchToChatSession
    const instance = await this.switchToChatSession(chatId, newChatSessionId);
    
    // 🔥 Create chat session file directory
    await this.ensureChatSessionDirectory(chatId, newChatSessionId);
    
    if (instance) {
      const agentInfo = await instance.getAgentInfo();
      logger.info('[AgentChatManager] New chat session activated', 'startNewChatFor', {
        chatId,
        newChatSessionId,
        agentName: agentInfo.name
      });
    }
    
    return instance;
  }
  
  /**
   * 🔥 New: Exit New Chat Session state
   * After the first user message is successfully saved, remove the mapping from newChatSessionIdForChatId
   * This allows creation of the next New Chat Session
   */
  exitNewChatSessionFor(chatId: string, chatSessionId: string): void {
    const existingNewChatSessionId = this.newChatSessionIdForChatId.get(chatId);
    
    if (existingNewChatSessionId === chatSessionId) {
      this.newChatSessionIdForChatId.delete(chatId);
      logger.info('[AgentChatManager] Exited New Chat Session state', 'exitNewChatSessionFor', {
        chatId,
        chatSessionId
      });
    } else {
      logger.warn('[AgentChatManager] ChatSessionId mismatch when exiting New Chat Session', 'exitNewChatSessionFor', {
        chatId,
        requestedChatSessionId: chatSessionId,
        existingNewChatSessionId
      });
    }
  }

  /**
   * 🔥 New: Fork ChatSession
   *
   * Responsibilities:
   * 1. Generate new targetChatSessionId
   * 2. Copy ChatSession data via chatSessionManager (files and ChatSessionList)
   * 3. Load data and create AgentChat instance for targetChatSessionId
   * 4. Switch to the new ChatSession and notify frontend
   *
   * @param chatId - Current chatId (Agent ID)
   * @param sourceChatSessionId - Source ChatSession ID
   * @returns Promise<{ success: boolean; chatSessionId?: string; error?: string }>
   */
  async forkChatSession(chatId: string, sourceChatSessionId: string): Promise<{ success: boolean; chatSessionId?: string; error?: string }> {
    if (!this.currentUserAlias) {
      logger.error('[AgentChatManager] No current user alias set', 'forkChatSession');
      return { success: false, error: 'No current user alias set' };
    }

    if (!chatId || !sourceChatSessionId) {
      logger.error('[AgentChatManager] chatId and sourceChatSessionId are required', 'forkChatSession', {
        chatId,
        sourceChatSessionId
      });
      return { success: false, error: 'chatId and sourceChatSessionId are required' };
    }

    logger.info('[AgentChatManager] Starting fork ChatSession', 'forkChatSession', {
      chatId,
      sourceChatSessionId
    });

    try {
      // 1. Generate new targetChatSessionId
      const targetChatSessionId = this.generateChatSessionId();
      logger.info('[AgentChatManager] Generated target ChatSession ID', 'forkChatSession', {
        targetChatSessionId,
        sourceChatSessionId
      });

      // 2. Copy ChatSession data via chatSessionManager
      const copySuccess = await chatSessionManager.copyChatSession(
        this.currentUserAlias,
        chatId,
        sourceChatSessionId,
        targetChatSessionId
      );

      if (!copySuccess) {
        logger.error('[AgentChatManager] Failed to copy ChatSession', 'forkChatSession', {
          chatId,
          sourceChatSessionId,
          targetChatSessionId
        });
        return { success: false, error: 'Failed to copy ChatSession' };
      }

      logger.info('[AgentChatManager] ChatSession copied successfully', 'forkChatSession', {
        chatId,
        sourceChatSessionId,
        targetChatSessionId
      });

      // 3. Switch to the new ChatSession (this automatically loads data, creates instance, and notifies frontend)
      const instance = await this.switchToChatSession(chatId, targetChatSessionId);

      if (!instance) {
        logger.error('[AgentChatManager] Failed to switch to forked ChatSession', 'forkChatSession', {
          chatId,
          targetChatSessionId
        });
        return { success: false, error: 'Failed to switch to forked ChatSession' };
      }

      const agentInfo = await instance.getAgentInfo();
      logger.info('[AgentChatManager] ✅ Fork ChatSession completed successfully', 'forkChatSession', {
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
        agentName: agentInfo.name
      });

      return {
        success: true,
        chatSessionId: targetChatSessionId
      };

    } catch (error) {
      logger.error('[AgentChatManager] ❌ Fork ChatSession failed', 'forkChatSession', {
        chatId,
        sourceChatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during fork'
      };
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalInstances: number; currentChatSessionId: string | null; cachedChatSessionIds: string[] } {
    return {
      totalInstances: this.agentInstances.size,
      currentChatSessionId: this.currentChatSessionId,
      cachedChatSessionIds: Array.from(this.agentInstances.keys())
    };
  }
  
  /**
   * Get or create CancellationTokenSource
   */
  private getOrCreateCancellationSource(chatSessionId: string): CancellationTokenSource {
    let source = this.cancellationSources.get(chatSessionId);
    
    // If source has been cancelled or doesn't exist, create a new one
    if (!source || source.token.isCancellationRequested) {
      if (source) {
        source.dispose();
        logger.info('[AgentChatManager] Disposing old cancelled source', 'getOrCreateCancellationSource', { chatSessionId });
      }
      
      source = new CancellationTokenSource();
      this.cancellationSources.set(chatSessionId, source);
      logger.info('[AgentChatManager] Created new CancellationTokenSource', 'getOrCreateCancellationSource', { chatSessionId });
    } else {
      logger.info('[AgentChatManager] Reusing existing CancellationTokenSource', 'getOrCreateCancellationSource', { chatSessionId });
    }
    
    return source;
  }
  
  /**
   * Cancel the operation for specified chatSession
   */
  async cancelChatSession(chatSessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('[AgentChatManager] 🛑 Cancelling chat session', 'cancelChatSession', { chatSessionId });
      
      // Check if there's an active AgentChat instance
      const agentChat = this.agentInstances.get(chatSessionId);
      if (!agentChat) {
        logger.warn('[AgentChatManager] No agent instance found', 'cancelChatSession', { chatSessionId });
        return { success: false, error: 'No active chat session instance found' };
      }
      
      // Check chat status, if already idle, return success directly
      const currentStatus = agentChat.getChatStatus();
      logger.info('[AgentChatManager] Current chat status', 'cancelChatSession', {
        chatSessionId,
        currentStatus
      });
      
      if (currentStatus === 'idle') {
        logger.info('[AgentChatManager] Chat is already idle, no need to cancel', 'cancelChatSession', {
          chatSessionId,
          currentStatus
        });
        return { success: true };
      }
      
      const source = this.cancellationSources.get(chatSessionId);
      logger.info('[AgentChatManager] Cancellation source status', 'cancelChatSession', {
        chatSessionId,
        hasSource: !!source,
        isAlreadyCancelled: source?.token.isCancellationRequested
      });
      
      if (!source) {
        logger.warn('[AgentChatManager] No active cancellation source found', 'cancelChatSession', {
          chatSessionId,
          currentStatus
        });
        
        // If no CancellationTokenSource but chat is not idle, try to directly set chat status to idle
        try {
          let agentName = 'Unknown';
          try {
            const agentInfo = await agentChat.getAgentInfo();
            agentName = agentInfo.name || 'Unknown';
          } catch (agentInfoError) {
            // If retrieval fails, use default value
          }
          
          // Notify frontend that cancellation is complete
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('agentChat:chatStatusChanged', {
              chatId: agentChat.getChatId(),
              chatSessionId: chatSessionId,
              chatStatus: 'idle',
              agentName: agentName,
              timestamp: new Date().toISOString()
            });
          }
          
          logger.info('[AgentChatManager] ✅ Forced chat to idle state', 'cancelChatSession', { chatSessionId });
          return { success: true };
        } catch (forceError) {
          logger.error('[AgentChatManager] Failed to force chat to idle', 'cancelChatSession', {
            chatSessionId,
            error: forceError instanceof Error ? forceError.message : String(forceError)
          });
          return { success: false, error: 'Unable to cancel - no active operation found' };
        }
      }
      
      // Call cancel() to trigger cancellation
      logger.info('[AgentChatManager] Calling source.cancel()', 'cancelChatSession', { chatSessionId });
      source.cancel();
      logger.info('[AgentChatManager] source.cancel() completed, token cancelled:', 'cancelChatSession', {
        chatSessionId,
        isCancelled: source.token.isCancellationRequested
      });
      
      // Wait for chat status to become idle (with timeout)
      logger.info('[AgentChatManager] Waiting for chat to become idle', 'cancelChatSession', { chatSessionId });
      await this.waitForChatSessionIdle(chatSessionId, 5000);
      
      // Clean up old source, prepare for next operation
      source.dispose();
      this.cancellationSources.delete(chatSessionId);
      
      logger.info('[AgentChatManager] ✅ Chat session cancelled successfully', 'cancelChatSession', { chatSessionId });
      
      return { success: true };
    } catch (error) {
      logger.error('[AgentChatManager] ❌ Failed to cancel chat session', 'cancelChatSession', {
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  
  /**
   * Wait for chatSession to return to idle state
   */
  private async waitForChatSessionIdle(chatSessionId: string, timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    const agentChat = this.agentInstances.get(chatSessionId);
    
    if (!agentChat) {
      logger.warn('[AgentChatManager] Chat session instance not found for idle wait', 'waitForChatSessionIdle', { chatSessionId });
      return;
    }
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        // Check timeout
        if (elapsed > timeoutMs) {
          clearInterval(checkInterval);
          logger.warn('[AgentChatManager] Wait for idle timed out', 'waitForChatSessionIdle', {
            chatSessionId,
            elapsed,
            timeout: timeoutMs
          });
          resolve();
          return;
        }
        
        // Check status
        try {
          const status = agentChat.getChatStatus();
          
          if (status === 'idle') {
            clearInterval(checkInterval);
            logger.info('[AgentChatManager] Chat session reached idle state', 'waitForChatSessionIdle', {
              chatSessionId,
              elapsed
            });
            resolve();
          }
        } catch (error) {
          // If getting status fails, instance may have been destroyed, resolve directly
          clearInterval(checkInterval);
          logger.warn('[AgentChatManager] Failed to get chat status, assuming idle', 'waitForChatSessionIdle', {
            chatSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
          resolve();
        }
      }, 100); // Check every 100ms
    });
  }
  
  
  /**
   * Send streaming message
   */
  async streamMessage(
    chatSessionId: string,
    message: Message
  ): Promise<{ success: boolean; data?: Message[]; error?: string }> {
    const agentChat = this.agentInstances.get(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'streamMessage', { chatSessionId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }
    
    try {
      // 🔥 New: Cancel idle timer when starting processing (if any)
      this.cancelIdleTimer(chatSessionId);
      
      // Get or create CancellationTokenSource
      const source = this.getOrCreateCancellationSource(chatSessionId);
      
      logger.info('[AgentChatManager] Starting stream message with cancellation support', 'streamMessage', {
        chatSessionId,
        messageId: message.id,
        tokenCancelled: source.token.isCancellationRequested
      });
      
      // Pass token to AgentChat
      const messages = await agentChat.streamMessage(message, source.token);
      
      logger.info('[AgentChatManager] Stream message completed', 'streamMessage', {
        chatSessionId,
        messagesCount: messages.length
      });
      
      // Clean up source after successful completion
      source.dispose();
      this.cancellationSources.delete(chatSessionId);
      
      // 🔥 New: Check status after completion, start cleanup timer if idle
      const finalStatus = agentChat.getChatStatus();
      this.handleStatusChange(chatSessionId, finalStatus);
      
      return { success: true, data: messages };
    } catch (error) {
      // Check if failure was due to cancellation
      if (error instanceof CancellationError) {
        logger.info('[AgentChatManager] Operation cancelled', 'streamMessage', { chatSessionId });
        
        // Clean up source after cancellation
        const source = this.cancellationSources.get(chatSessionId);
        if (source) {
          source.dispose();
          this.cancellationSources.delete(chatSessionId);
        }
        
        // 🔥 New: Also check status after cancellation
        const finalStatus = agentChat.getChatStatus();
        this.handleStatusChange(chatSessionId, finalStatus);
        
        // Cancellation is not an error, return success
        return { success: true, data: [] };
      }
      
      logger.error('[AgentChatManager] Stream message failed', 'streamMessage', {
        chatSessionId,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        statusCode: (error as any)?.statusCode,
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      
      // Also clean up source on error
      const source = this.cancellationSources.get(chatSessionId);
      if (source) {
        source.dispose();
        this.cancellationSources.delete(chatSessionId);
      }
      
      // 🔥 New: Also check status after error
      try {
        const finalStatus = agentChat.getChatStatus();
        this.handleStatusChange(chatSessionId, finalStatus);
      } catch (statusError) {
        // Ignore status check errors
      }
      
      // 🔥 Preserve more error context information
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = (error as any)?.statusCode;
      return {
        success: false,
        error: statusCode ? `[HTTP ${statusCode}] ${errorMessage}` : errorMessage
      };
    }
  }
  
  /**
   * 🔥 Retry the last failed conversation
   * Does not add new messages, re-calls LLM API using existing context history
   */
  async retryChat(
    chatSessionId: string
  ): Promise<{ success: boolean; data?: Message[]; error?: string }> {
    const agentChat = this.agentInstances.get(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'retryChat', { chatSessionId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }
    
    try {
      // 🔥 Cancel idle timer when starting processing (if any)
      this.cancelIdleTimer(chatSessionId);
      
      // Get or create CancellationTokenSource
      const source = this.getOrCreateCancellationSource(chatSessionId);
      
      logger.info('[AgentChatManager] Starting retry chat with cancellation support', 'retryChat', {
        chatSessionId,
        tokenCancelled: source.token.isCancellationRequested
      });
      
      // Call AgentChat retryChat method
      const messages = await agentChat.retryChat(source.token);
      
      logger.info('[AgentChatManager] Retry chat completed', 'retryChat', {
        chatSessionId,
        messagesCount: messages.length
      });
      
      // Clean up source after successful completion
      source.dispose();
      this.cancellationSources.delete(chatSessionId);
      
      // 🔥 Check status after completion
      const finalStatus = agentChat.getChatStatus();
      this.handleStatusChange(chatSessionId, finalStatus);
      
      return { success: true, data: messages };
    } catch (error) {
      // Check if failure was due to cancellation
      if (error instanceof CancellationError) {
        logger.info('[AgentChatManager] Retry cancelled', 'retryChat', { chatSessionId });
        
        // Clean up source after cancellation
        const source = this.cancellationSources.get(chatSessionId);
        if (source) {
          source.dispose();
          this.cancellationSources.delete(chatSessionId);
        }
        
        // Check status after cancellation
        const finalStatus = agentChat.getChatStatus();
        this.handleStatusChange(chatSessionId, finalStatus);
        
        return { success: true, data: [] };
      }
      
      logger.error('[AgentChatManager] Retry chat failed', 'retryChat', {
        chatSessionId,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        statusCode: (error as any)?.statusCode,
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      
      // Clean up source on error
      const source = this.cancellationSources.get(chatSessionId);
      if (source) {
        source.dispose();
        this.cancellationSources.delete(chatSessionId);
      }
      
      // Check status after error
      try {
        const finalStatus = agentChat.getChatStatus();
        this.handleStatusChange(chatSessionId, finalStatus);
      } catch (statusError) {
        // Ignore status check errors
      }
      
      // 🔥 Preserve more error context information
      const retryErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      const retryStatusCode = (error as any)?.statusCode;
      return {
        success: false,
        error: retryStatusCode ? `[HTTP ${retryStatusCode}] ${retryErrorMessage}` : retryErrorMessage
      };
    }
  }
  
  /**
   * Sync Profile updates
   */
  async syncProfileUpdate(alias: string): Promise<void> {
    if (this.currentUserAlias !== alias) {
      logger.warn(`[AgentChatManager] Alias mismatch in syncProfileUpdate: ${alias} vs ${this.currentUserAlias}`);
      return;
    }
    
    
    const allChats = profileCacheManager.getAllChatConfigs(alias);
    
    // Clean up Chat instances that no longer exist
    this.cleanupObsoleteInstances(allChats);
    
  }
  
  /**
   * Set main window reference
   */
  setMainWindow(window: Electron.BrowserWindow | null): void {
    this.mainWindow = window;
    
    // After window is ready, trigger all instances to resend context stats
    if (window && !window.isDestroyed()) {
      this.agentInstances.forEach((instance, chatSessionId) => {
        try {
          instance.calculateAndNotifyContext();
        } catch (error) {
          logger.error(`[AgentChatManager] Failed to resend context stats for chatSession ${chatSessionId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
  }
  
  /**
   * Set up context change listener
   */
  private setupContextChangeListener(instance: AgentChat, chatSessionId: string): void {
    const contextChangeListener = (stats: any) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const eventData = {
          chatSessionId,
          chatId: instance.getChatId(),
          stats,
          timestamp: new Date().toISOString()
        };
        this.mainWindow.webContents.send('agentChat:contextChange', eventData);
      } else {
        logger.warn('[AgentChatManager] Cannot send context change - no valid main window');
      }
    };
    
    instance.addContextChangeListener(contextChangeListener);
  }
  
  /**
   * 🔥 New: Notify frontend of currentChatSessionId change
   */
  private notifyCurrentChatSessionIdChanged(chatId: string | null, chatSessionId: string | null): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agentChat:currentChatSessionIdChanged', {
        chatId,
        chatSessionId
      });
      logger.info('[AgentChatManager] Notified current chat session changed', 'notifyCurrentChatSessionIdChanged', {
        chatId,
        chatSessionId
      });
    }
  }
  
  /**
   * 🔥 New: Notify frontend to create ChatSession cache
   */
  private notifyChatSessionCacheCreated(chatSessionId: string, chatId: string, initialData?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agentChat:chatSessionCacheCreated', {
        chatSessionId,
        chatId,
        initialData
      });
      logger.info('[AgentChatManager] Notified chat session cache created', 'notifyChatSessionCacheCreated', {
        chatSessionId,
        chatId
      });
    }
  }
  
  /**
   * 🔥 New: Notify frontend to destroy ChatSession cache
   */
  private notifyChatSessionCacheDestroyed(chatSessionId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agentChat:chatSessionCacheDestroyed', {
        chatSessionId
      });
      logger.info('[AgentChatManager] Notified chat session cache destroyed', 'notifyChatSessionCacheDestroyed', {
        chatSessionId
      });
    }
  }
  
  /**
   * Get the currently active chatSessionId
   */
  getCurrentActiveChatSessionId(): string | null {
    return this.currentChatSessionId;
  }
  
  /**
   * 🔥 New: Get Context Token usage for the current ChatSession
   * Used for frontend to proactively pull initial state (e.g., during ContextBadge initialization)
   */
  getCurrentContextTokenUsage(): { tokenCount: number; totalMessages: number; contextMessages: number; compressionRatio: number } | null {
    if (!this.currentInstance) {
      logger.warn('[AgentChatManager] No current instance for context token usage');
      return null;
    }
    
    // Get cached stats from latestContextStats
    const contextStats = (this.currentInstance as any).latestContextStats;
    
    if (!contextStats) {
      logger.warn('[AgentChatManager] No context stats available');
      return null;
    }
    
    return {
      tokenCount: contextStats.tokenCount || 0,
      totalMessages: contextStats.totalMessages || 0,
      contextMessages: contextStats.contextMessages || 0,
      compressionRatio: contextStats.compressionRatio || 1.0
    };
  }
  
  /**
   * Check if chatSessionId is the currently active chatSession
   */
  isActiveChatSessionId(chatSessionId: string): boolean {
    return this.currentChatSessionId === chatSessionId;
  }
  
  /**
   * Create AgentChat instance
   */
  private async createAgentWithChatSession(userAlias: string, chatId: string, chatSessionId: string, chatSessionData?: any): Promise<AgentChat> {
    // Verify config exists
    const chatConfig = profileCacheManager.getChatConfig(userAlias, chatId);
    
    if (!chatConfig || !chatConfig.agent) {
      const error = new Error(`No chat config or agent found for userAlias: ${userAlias}, chatId: ${chatId}`);
      logger.error('[AgentChatManager] Failed to create agent - config not found', 'createAgentWithChatSession', {
        userAlias,
        chatId,
        chatSessionId
      });
      throw error;
    }
    
    logger.info('[AgentChatManager] Creating AgentChat instance with ChatSession', 'createAgentWithChatSession', {
      userAlias,
      chatId,
      chatSessionId,
      agentName: chatConfig.agent.name
    });
    
    // Create AgentChat instance
    const agent = chatSessionData
      ? new AgentChat(userAlias, chatId, chatSessionId, chatSessionData)
      : new AgentChat(userAlias, chatId, chatSessionId);
    
    // Initialize instance
    try {
      await agent.initialize();
      
      logger.info('[AgentChatManager] AgentChat instance created successfully', 'createAgentWithChatSession', {
        userAlias,
        chatId,
        chatSessionId,
        agentName: chatConfig.agent.name
      });
      
      return agent;
    } catch (error) {
      logger.error('[AgentChatManager] Failed to initialize AgentChat instance', 'createAgentWithChatSession', {
        userAlias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  
  /**
   * Destroy AgentChatManager
   */
  destroy(): void {
    logger.info('[AgentChatManager] Destroying AgentChatManager', 'destroy');
    
    // 🔥 New: Clean up all idle timers
    this.idleTimers.forEach((timerData, chatSessionId) => {
      try {
        clearTimeout(timerData.timer);
        logger.debug('[AgentChatManager] Cleared idle timer', 'destroy', { chatSessionId });
      } catch (error) {
        logger.error('[AgentChatManager] Error clearing idle timer', 'destroy', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    this.idleTimers.clear();
    
    // Destroy all CancellationTokenSources
    this.cancellationSources.forEach((source, chatSessionId) => {
      try {
        source.dispose();
        logger.debug('[AgentChatManager] Disposed cancellation source', 'destroy', { chatSessionId });
      } catch (error) {
        logger.error('[AgentChatManager] Error disposing cancellation source', 'destroy', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    this.cancellationSources.clear();
    
    // Destroy all AgentChat instances
    this.agentInstances.forEach((instance, chatSessionId) => {
      try {
        // 🔥 New: Clean up status check timer
        const checkInterval = (instance as any).__statusCheckInterval;
        if (checkInterval) {
          clearInterval(checkInterval);
        }
        
        instance.destroy();
      } catch (error) {
        logger.error('[AgentChatManager] Error destroying agent instance', 'destroy', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Clean up state
    this.agentInstances.clear();
    this.newChatSessionIdForChatId.clear();  // 🔧 Fix: Clean up ChatId to ChatSessionId mapping
    this.currentInstance = null;
    this.currentChatSessionId = null;
    this.currentUserAlias = null;
    this.isInitialized = false;
    // 🔧 Key fix: Do not clean up mainWindow, as the window is still valid, user just switched
    // this.mainWindow = null;
    
    logger.info('[AgentChatManager] AgentChatManager destroyed', 'destroy');
  }
  
  /**
   * 🔥 New: Set up status change listener for idle cleanup mechanism
   * Gets status directly from AgentChat instance, does not rely on IPC events
   */
  private setupStatusChangeListener(instance: AgentChat, chatSessionId: string): void {
    // Create periodic checker, checks status every 30 seconds
    const checkInterval = setInterval(() => {
      try {
        const currentStatus = instance.getChatStatus();
        this.handleStatusChange(chatSessionId, currentStatus);
      } catch (error) {
        // Instance may have been destroyed, clean up timer
        clearInterval(checkInterval);
      }
    }, 30000); // Check every 30 seconds
    
    // Save timer reference for cleanup
    (instance as any).__statusCheckInterval = checkInterval;
  }
  
  /**
   * 🔥 New: Handle ChatSession status changes
   */
  private handleStatusChange(chatSessionId: string, status: string): void {
    // Check if this is a New Chat Session or Current Chat Session
    if (this.isProtectedSession(chatSessionId)) {
      // Protected session, cancel any idle timer
      this.cancelIdleTimer(chatSessionId);
      return;
    }
    
    // Check status
    if (status === 'idle') {
      // Entered idle state, start timer
      this.startIdleTimer(chatSessionId);
    } else {
      // Non-idle state (active), cancel timer
      this.cancelIdleTimer(chatSessionId);
    }
  }
  
  /**
   * 🔥 New: Check if this is a protected session (New Chat or Current Chat)
   */
  private isProtectedSession(chatSessionId: string): boolean {
    // Check if this is the Current Chat Session
    if (this.currentChatSessionId === chatSessionId) {
      return true;
    }
    
    // Check if this is a New Chat Session
    for (const [chatId, newChatSessionId] of this.newChatSessionIdForChatId.entries()) {
      if (newChatSessionId === chatSessionId) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 🔥 New: Start idle timer
   */
  private startIdleTimer(chatSessionId: string): void {
    // If there is an existing timer, cancel it first
    this.cancelIdleTimer(chatSessionId);
    
    const idleSince = Date.now();
    const timer = setTimeout(() => {
      this.cleanupIdleInstance(chatSessionId);
    }, this.IDLE_TIMEOUT_MS);
    
    this.idleTimers.set(chatSessionId, { timer, idleSince });
    
    logger.info('[AgentChatManager] Started idle timer for session', 'startIdleTimer', {
      chatSessionId,
      timeoutMs: this.IDLE_TIMEOUT_MS
    });
  }
  
  /**
   * 🔥 New: Cancel idle timer
   */
  private cancelIdleTimer(chatSessionId: string): void {
    const timerData = this.idleTimers.get(chatSessionId);
    if (timerData) {
      clearTimeout(timerData.timer);
      this.idleTimers.delete(chatSessionId);
      
      const idleDuration = Date.now() - timerData.idleSince;
      logger.info('[AgentChatManager] Cancelled idle timer for session', 'cancelIdleTimer', {
        chatSessionId,
        idleDurationMs: idleDuration
      });
    }
  }
  
  /**
   * 🔥 New: Clean up idle instance
   */
  private cleanupIdleInstance(chatSessionId: string): void {
    // Check again if this is a protected session
    if (this.isProtectedSession(chatSessionId)) {
      logger.info('[AgentChatManager] Skipping cleanup for protected session', 'cleanupIdleInstance', {
        chatSessionId
      });
      return;
    }
    
    // Check if instance exists
    const instance = this.agentInstances.get(chatSessionId);
    if (!instance) {
      logger.warn('[AgentChatManager] Instance not found for cleanup', 'cleanupIdleInstance', {
        chatSessionId
      });
      return;
    }
    
    // Final check: verify current status is still idle
    const currentStatus = instance.getChatStatus();
    if (currentStatus !== 'idle') {
      logger.info('[AgentChatManager] Instance no longer idle, skipping cleanup', 'cleanupIdleInstance', {
        chatSessionId,
        currentStatus
      });
      // Cancel timer
      this.cancelIdleTimer(chatSessionId);
      return;
    }
    
    // 🔥 Modified: Use unified cleanup method
    logger.info('[AgentChatManager] ✅ Cleaning up idle instance', 'cleanupIdleInstance', {
      chatSessionId,
      remainingInstances: this.agentInstances.size - 1
    });
    
    this.removeInstanceByChatSession(chatSessionId);
  }
  
  /**
   * 🔥 New: Handle ChatSession losing focus (from Current to non-Current)
   */
  private handleSessionLostFocus(chatSessionId: string): void {
    const instance = this.agentInstances.get(chatSessionId);
    if (!instance) {
      return;
    }
    
    try {
      // Check the current status of the session that lost focus
      const currentStatus = instance.getChatStatus();
      
      logger.info('[AgentChatManager] Session lost focus', 'handleSessionLostFocus', {
        chatSessionId,
        currentStatus
      });
      
      // If idle, start cleanup timer
      if (currentStatus === 'idle') {
        this.handleStatusChange(chatSessionId, currentStatus);
      }
    } catch (error) {
      logger.error('[AgentChatManager] Error handling session lost focus', 'handleSessionLostFocus', {
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Export singleton instance
export const agentChatManager = AgentChatManager.getInstance();