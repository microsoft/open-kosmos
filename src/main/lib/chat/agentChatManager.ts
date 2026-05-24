// src/main/lib/chat/agentChatManager.ts
// AgentChatManager - Main Process version - Unified AgentChat instance management center

import { AgentChat, AgentConfig } from './agentChat';
import { Message, MessageHelper, UserMessage } from '@shared/types/chatTypes';
import { interactiveRequestManager } from './interactiveRequestManager';
import { BuiltinToolsManager } from '../mcpRuntime/builtinTools/builtinToolsManager';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { generateChatSessionId as generateRuntimeChatSessionId } from '../userDataADO/pathUtils';
import { chatSessionStore } from './chatSessionStore';
import type {
  ChatAgent,
  ChatConfig,
  ChatSessionReadStatus,
} from '../userDataADO/types/profile';
import type { SchedulerJob } from '../scheduler/types';
import { createLogger } from '../unifiedLogger';
import { CancellationError, CancellationTokenSource } from '../cancellation';
import { AgentChatManagerRendererBridge } from './agentChatManagerRendererBridge';
import { AgentChatManagerRegistry, AgentChatRuntimeMode } from './agentChatManagerRegistry';
import { AgentChatManagerSessionCoordinator } from './agentChatManagerSessionCoordinator';
import { AgentChatManagerNotificationBridge } from './agentChatManagerNotificationBridge';
import { AgentChatManagerScheduledRunner } from './agentChatManagerScheduledRunner';

const logger = createLogger();

/**
 * AgentChatManager - Singleton pattern AgentChat instance manager (Main Process version)
 *
 * Responsibilities:
 * 1. Manage AgentChat instances at ChatSessionId granularity
 * 2. Centrally handle ChatSessionId creation and management
 * 3. Each ChatSessionId corresponds to an independent AgentChat instance
 * 4. Provide runtime instance caching to avoid redundant creation
 * 5. Handle instance synchronization during ChatSession switching
 * 6. Manage chatSessionId identification for streaming chunks
 */
export class AgentChatManager {
  private static instance: AgentChatManager;
  private readonly registry: AgentChatManagerRegistry;
  private readonly sessionCoordinator: AgentChatManagerSessionCoordinator;

  // Current user alias
  private currentUserAlias: string | null = null;

  private rendererBridge: AgentChatManagerRendererBridge;
  private notificationBridge: AgentChatManagerNotificationBridge;
  private scheduledRunner: AgentChatManagerScheduledRunner;

  // Lifecycle state
  private isInitialized: boolean = false;

  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.notificationBridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: () => {
        const currentChatSessionId = this.sessionCoordinator.getCurrentChatSessionId();
        logger.info('[AgentChatManager] Main window lost foreground', 'setMainWindow', {
          currentChatSessionId,
          windowState: this.getMainWindowState(),
        });

        if (currentChatSessionId) {
          this.handleSessionLostFocus(currentChatSessionId);
        }
      },
      onWindowRegainedForeground: () => {
        const currentChatSessionId = this.sessionCoordinator.getCurrentChatSessionId();
        logger.info('[AgentChatManager] Main window regained foreground', 'setMainWindow', {
          currentChatSessionId,
          windowState: this.getMainWindowState(),
        });

        if (currentChatSessionId) {
          this.sessionCoordinator.clearPendingUnreadForCurrentSession();
        }
      },
    });
    this.registry = new AgentChatManagerRegistry();
    this.sessionCoordinator = new AgentChatManagerSessionCoordinator({
      onIdleTimeout: (chatSessionId) => this.cleanupIdleInstance(chatSessionId),
      isMainWindowForeground: () => this.isMainWindowForeground(),
      getMainWindowState: () => this.getMainWindowState(),
    }, this.IDLE_TIMEOUT_MS);
    this.rendererBridge = new AgentChatManagerRendererBridge(() => this.notificationBridge.getMainWindow());
    this.scheduledRunner = new AgentChatManagerScheduledRunner({
      createAgentWithChatSession: (userAlias, chatId, chatSessionId) =>
        this.createAgentWithChatSession(userAlias, chatId, chatSessionId),
      registerManagedInstance: (chatSessionId, chatId, instance, runtimeMode) =>
        this.registerManagedInstance(chatSessionId, chatId, instance, runtimeMode),
      updateChatSessionReadStatus: (chatId, chatSessionId, readStatus) =>
        this.updateChatSessionReadStatus(chatId, chatSessionId, readStatus),
      showChatSessionCompletionNotification: (chatId, chatSessionId, chatSessionName, outcome) =>
        this.showChatSessionCompletionNotification(chatId, chatSessionId, chatSessionName, outcome),
      disposeManagedInstance: (chatSessionId, notifyFrontend) =>
        this.disposeManagedInstance(chatSessionId, notifyFrontend),
    });
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
   * 🔥 Note: No longer responsible for auto-selecting primaryAgent; the frontend AgentPage calls startNewChatFor on page load
   */
  async initialize(alias: string): Promise<void> {
    if (this.isInitialized && this.currentUserAlias === alias) {
      return;
    }

    this.currentUserAlias = alias;
    this.isInitialized = true;

    // Setup auto-wake listener for background sub-agent results
    this.setupSubAgentAutoWake();

    logger.info('[AgentChatManager] Initialized for user', 'initialize', { alias });
  }

  // ─── Auto-wake: trigger parent turn when background sub-agent results arrive ───
  private _autoWakeController: any = null;
  private get autoWakeController() {
    if (!this._autoWakeController) {
      try {
        const { SubAgentAutoWakeController } = require('./subAgentAutoWake');
        this._autoWakeController = new SubAgentAutoWakeController({
          getSessionInstance: (id: string) => this.registry.getInstance(id),
          reattachEventSender: (instance: AgentChat) => this.attachEventSenderToMainWindow(instance),
          log: (msg: string, method?: string, meta?: Record<string, unknown>) => logger.info(msg, method, meta),
          isFeatureEnabled: (flag: string) => require('../featureFlags').isFeatureEnabled(flag),
        });
      } catch {
        // Non-fatal in test environments
        this._autoWakeController = { setup() {} };
      }
    }
    return this._autoWakeController;
  }

  private setupSubAgentAutoWake(): void {
    this.autoWakeController.setup();
  }

  /**
   * Generate ChatSessionId
   */
  generateChatSessionId(): string {
    return generateRuntimeChatSessionId();
  }

  /**
   * Switch to specified ChatSession
   */
  async switchToChatSession(chatId: string, chatSessionId: string | null): Promise<AgentChat | null> {
    // 🔥 New: Record old currentChatSessionId, used to trigger lost-focus handling
    const previousChatSessionId = this.sessionCoordinator.getCurrentChatSessionId();

    if (!chatId || !chatSessionId) {
      if (previousChatSessionId) {
        this.sessionCoordinator.clearCurrentSession(previousChatSessionId);
      }

      // 🔥 New: Notify frontend of currentChatSessionId change
      this.notifyCurrentChatSessionIdChanged(null, null);

      logger.info('[AgentChatManager] switchToChatSession -> clear current session', 'switchToChatSession', {
        previousChatSessionId,
      });

      // 🔥 New: If there was a previous current session, check its state and possibly start timer
      if (previousChatSessionId) {
        this.handleSessionLostFocus(previousChatSessionId);
      }

      return null;
    }

    // If already the current ChatSession, return directly
    const currentInstance = this.sessionCoordinator.getCurrentInstance();
    if (this.sessionCoordinator.getCurrentChatSessionId() === chatSessionId && currentInstance) {
      const runtimeMode = this.getRuntimeMode(chatSessionId);
      if (runtimeMode !== 'interactive') {
        logger.warn('[AgentChatManager] Current session has non-interactive runtime mode, promoting to interactive', 'switchToChatSession', {
          chatId,
          chatSessionId,
          runtimeMode,
        });
        this.promoteManagedInstanceToInteractive(chatSessionId, chatId, currentInstance);
      }

      // 🔥 New: Activate current instance, cancel its idle timer
      this.sessionCoordinator.activateSession(chatSessionId, currentInstance);
      this.attachEventSenderToMainWindow(currentInstance);

      // 🔥 Fix: Ensure renderer is notified even if session hasn't changed (e.g. after refresh)
      this.notifyCurrentChatSessionIdChanged(chatId, chatSessionId);

      // 🔥 Fix: Also resend the cache data because the renderer might have lost it (e.g. refresh)
      this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
        renderChatHistory: currentInstance.getDisplayMessages(),
        chatStatus: currentInstance.getChatStatus(),
        contextTokenUsage: currentInstance.getContextTokenUsage(),
        pendingInteractiveRequest: currentInstance.getPendingInteractiveRequest(),
      });

      logger.info('[AgentChatManager] switchToChatSession -> reusing current instance and mark read', 'switchToChatSession', {
        chatId,
        chatSessionId,
        currentStatus: currentInstance.getChatStatus(),
      });
      await this.updateChatSessionReadStatus(chatId, chatSessionId, 'read');

      return currentInstance;
    }

    // Get or create AgentChat instance (by ChatSessionId)
    const instance = await this.getOrCreateInstanceByChatSession(chatId, chatSessionId);

    if (instance) {
      // 🔥 New: If there was a different previous current session, handle its lost focus
      if (previousChatSessionId && previousChatSessionId !== chatSessionId) {
        this.handleSessionLostFocus(previousChatSessionId);
      }

      // Update current state
      this.sessionCoordinator.activateSession(chatSessionId, instance);

      // 🔥 New: Notify frontend of currentChatSessionId change
      this.notifyCurrentChatSessionIdChanged(chatId, chatSessionId);

      // 🔥 New: Activate instance, cancel its idle timer
      this.attachEventSenderToMainWindow(instance);

      // Set up context change listener for the new current instance
      this.setupContextChangeListener(instance, chatSessionId);

      logger.info('[AgentChatManager] switchToChatSession -> activated instance and mark read', 'switchToChatSession', {
        chatId,
        chatSessionId,
        previousChatSessionId,
        currentStatus: instance.getChatStatus(),
      });
      await this.updateChatSessionReadStatus(chatId, chatSessionId, 'read');

      const agentInfo = await instance.getAgentInfo();
      logger.info('[AgentChatManager] Switched to chat session', 'switchToChatSession', {
        chatId,
        chatSessionId,
        agentName: agentInfo.name
      });

      // 🔥 Fix: No longer proactively push Chat Status
      // Frontend will proactively call getChatStatusInfo() after switching to get initial state
    }

    return instance;
  }


  /**
   * Get or create AgentChat instance
   */
  private async getOrCreateInstanceByChatSession(
    chatId: string,
    chatSessionId: string,
    expectedRuntimeMode: AgentChatRuntimeMode = 'interactive'
  ): Promise<AgentChat | null> {
    if (this.registry.hasInstance(chatSessionId)) {
      const runtimeMode = this.getRuntimeMode(chatSessionId);
      if (runtimeMode && runtimeMode !== expectedRuntimeMode) {
        const instance = this.registry.getInstance(chatSessionId)!;
        if (runtimeMode === 'scheduled-silent' && expectedRuntimeMode === 'interactive') {
          logger.info('[AgentChatManager] Promoting cached scheduled instance to interactive', 'getOrCreateInstanceByChatSession', {
            chatId,
            chatSessionId,
            runtimeMode,
            expectedRuntimeMode,
          });
          this.promoteManagedInstanceToInteractive(chatSessionId, chatId, instance);
          return instance;
        }

        logger.warn('[AgentChatManager] Cached instance runtime mode mismatch, disposing before recreate', 'getOrCreateInstanceByChatSession', {
          chatId,
          chatSessionId,
          runtimeMode,
          expectedRuntimeMode,
        });
        this.disposeManagedInstance(chatSessionId, runtimeMode === 'interactive');
      } else {
        const instance = this.registry.getInstance(chatSessionId)!;
        if (expectedRuntimeMode === 'interactive') {
          this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
            renderChatHistory: instance.getDisplayMessages(),
            chatStatus: instance.getChatStatus(),
            contextTokenUsage: instance.getContextTokenUsage(),
            pendingInteractiveRequest: instance.getPendingInteractiveRequest(),
          });
        }
        return instance;
      }
    }

    if (!this.currentUserAlias) {
      logger.error('[AgentChatManager] No current user alias set');
      return null;
    }

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

      let chatSessionData: any = null;
      let chatSessionMetadata: any = null;
      try {
        const aggregate = await chatSessionStore.ensureLoaded(this.currentUserAlias, chatId, chatSessionId);
        chatSessionData = aggregate?.file || null;
        chatSessionMetadata = aggregate?.metadata || null;

        if (chatSessionData) {
          logger.info('[AgentChatManager] Found existing ChatSession data from store', 'getOrCreateInstanceByChatSession', {
            chatSessionId,
            chatId,
            title: chatSessionData.title,
            messagesCount: chatSessionData.chat_history?.length || 0
          });
        }
      } catch (loadError) {
        logger.warn('[AgentChatManager] Failed to load existing ChatSession data from store, creating new session', 'getOrCreateInstanceByChatSession', {
          chatSessionId,
          chatId,
          error: loadError instanceof Error ? loadError.message : String(loadError)
        });
      }

      const instance = await this.createAgentWithChatSession(
        this.currentUserAlias,
        chatId,
        chatSessionId,
        chatSessionData,
        chatSessionMetadata
      );

      this.registerManagedInstance(chatSessionId, chatId, instance, 'interactive');
      return instance;
    } catch (error) {
      logger.error(`[AgentChatManager] Failed to create AgentChat instance for chatSession: ${chatSessionId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private registerManagedInstance(
    chatSessionId: string,
    chatId: string,
    instance: AgentChat,
    runtimeMode: AgentChatRuntimeMode
  ): void {
    this.registry.setInstance(chatSessionId, instance, runtimeMode);
    this.setupStatusChangeListener(instance, chatSessionId);

    if (runtimeMode === 'interactive') {
      this.setupContextChangeListener(instance, chatSessionId);
      this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
        renderChatHistory: instance.getDisplayMessages(),
        chatStatus: instance.getChatStatus(),
        contextTokenUsage: instance.getContextTokenUsage(),
        pendingInteractiveRequest: instance.getPendingInteractiveRequest(),
      });
    }
  }

  private promoteManagedInstanceToInteractive(
    chatSessionId: string,
    chatId: string,
    instance: AgentChat,
  ): void {
    this.registry.setRuntimeMode(chatSessionId, 'interactive');
    this.setupContextChangeListener(instance, chatSessionId);
    this.notifyChatSessionCacheCreated(chatSessionId, chatId, {
      renderChatHistory: instance.getDisplayMessages(),
      chatStatus: instance.getChatStatus(),
      contextTokenUsage: instance.getContextTokenUsage(),
      pendingInteractiveRequest: instance.getPendingInteractiveRequest(),
    });
  }

  private attachEventSenderToMainWindow(instance: AgentChat): void {
    this.rendererBridge.attachEventSenderToMainWindow(instance);
  }

  /**
   * Clean up obsolete ChatSession instances
   */
  private cleanupObsoleteInstances(currentChats: ChatConfig[]): void {
    const validChatIds = new Set(currentChats.map(c => c.chat_id));

    // Get chatId from instance to determine if still valid
    const instancesToRemove: string[] = [];
    this.registry.forEachInstance((instance, chatSessionId) => {
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
   * Remove specified ChatSession instance
   * 🔥 Modified: Changed from private to public, for external calls (e.g., cleanup when deleting ChatSession)
   */
  public removeInstanceByChatSession(chatSessionId: string): void {
    this.disposeManagedInstance(chatSessionId, true);
  }

  private disposeManagedInstance(chatSessionId: string, notifyFrontend: boolean): void {
    const instance = this.registry.getInstance(chatSessionId);
    if (instance) {
      const removeStatusChangeListener = (instance as any).__removeStatusChangeListener;
      if (typeof removeStatusChangeListener === 'function') {
        removeStatusChangeListener();
        delete (instance as any).__removeStatusChangeListener;
      }

      this.sessionCoordinator.clearPendingUnread(chatSessionId);
      this.sessionCoordinator.handleStatusChange(chatSessionId, 'destroyed', this.getRuntimeMode(chatSessionId));
      interactiveRequestManager.clearSession(chatSessionId);

      instance.destroy();
      this.registry.removeInstance(chatSessionId);
      BuiltinToolsManager.clearDeferredToolsContext(chatSessionId);

      // Cascade: cancel all sub-agent tasks and purge queues for this session
      import('../subAgent/subAgentManager').then(({ SubAgentManager }) => {
        SubAgentManager.getInstance().cancelAllForSession(chatSessionId);
      }).catch(() => { /* non-fatal */ });

      if (notifyFrontend) {
        this.notifyChatSessionCacheDestroyed(chatSessionId);
      }

      if (this.sessionCoordinator.getCurrentChatSessionId() === chatSessionId) {
        this.sessionCoordinator.clearCurrentSession(chatSessionId);
        this.notifyCurrentChatSessionIdChanged(null, null);
      }
    }
  }


  // ========== Public interface methods ==========

  /**
   * Get currently active AgentChat instance
   */
  getCurrentInstance(): AgentChat | null {
    return this.sessionCoordinator.getCurrentInstance();
  }

  /**
   * 🔥 Get AgentChat instance by chatSessionId
   * Used for scenarios requiring operations on a specific session (e.g., retry)
   */
  getInstanceByChatSessionId(chatSessionId: string): AgentChat | null {
    return this.registry.getInstance(chatSessionId);
  }

  updateSessionTitle(chatSessionId: string, newTitle: string): boolean {
    const instance = this.registry.getInstance(chatSessionId);
    if (!instance) {
      return false;
    }

    const updated = instance.updateSessionTitle(newTitle);
    if (!updated) {
      return false;
    }

    if (this.sessionCoordinator.getCurrentChatSessionId() === chatSessionId) {
      this.notifyChatSessionCacheCreated(chatSessionId, instance.getChatId(), {
        renderChatHistory: instance.getDisplayMessages(),
        chatStatus: instance.getChatStatus(),
        contextTokenUsage: instance.getContextTokenUsage(),
        pendingInteractiveRequest: instance.getPendingInteractiveRequest(),
      });
    }

    return true;
  }

  getRuntimeMode(chatSessionId: string): AgentChatRuntimeMode | null {
    return this.registry.getRuntimeMode(chatSessionId);
  }

  /**
   * Refresh current instance
   */
  async refreshCurrentInstance(): Promise<AgentChat | null> {
    const currentChatSessionId = this.sessionCoordinator.getCurrentChatSessionId();
    if (!currentChatSessionId) {
      return null;
    }

    const chatSessionId = currentChatSessionId;
    const instance = this.registry.getInstance(chatSessionId);
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
    if (this.sessionCoordinator.getCurrentInstance()) {
      logger.warn('[AgentChatManager] syncChatHistory not fully implemented in main process version');
    } else {
      logger.warn('[AgentChatManager] No current instance to sync chat history to');
    }
  }

  /**
   * Get ChatHistory
   */
  getChatHistory(): Message[] {
    const currentInstance = this.sessionCoordinator.getCurrentInstance();
    if (currentInstance) {
      return currentInstance.getChatHistory();
    }
    return [];
  }

  /**
   * 🔥 New: Start a new conversation for specified ChatId
   * Responsibilities:
   * 1. Check if a new ChatSessionId already exists, generate one if not
   * 2. Ensure instance exists (via getOrCreateInstanceByChatSession)
   * 3. Call switchToChatSession to handle switching and notification uniformly
   */
  async startNewChatFor(chatId: string): Promise<AgentChat | null> {
    if (!chatId) {
      logger.error('[AgentChatManager] chatId is required for startNewChatFor');
      return null;
    }

    logger.info('[AgentChatManager] Starting new chat for chatId:', 'startNewChatFor', { chatId });

    // Check if ChatId already has a New ChatSessionId in the newChatSessionIdForChatId map
    const existingNewChatSessionId = this.sessionCoordinator.getNewChatSessionId(chatId);
    const newChatSessionId = this.sessionCoordinator.getOrCreateNewChatSessionId(chatId, () => this.generateChatSessionId());

    if (existingNewChatSessionId) {
      // If a new ChatSessionId already exists, switch via switchToChatSession
      logger.info('[AgentChatManager] Found existing new ChatSessionId for chatId:', 'startNewChatFor', {
        chatId,
        newChatSessionId
      });
    } else {
      logger.info('[AgentChatManager] Generated new ChatSessionId for chatId:', 'startNewChatFor', {
        chatId,
        newChatSessionId
      });
    }

    // 🔥 Uniformly handle switching and notification via switchToChatSession
    const instance = await this.switchToChatSession(chatId, newChatSessionId);

    // 🔥 Create chat session file directory
    await this.sessionCoordinator.ensureChatSessionDirectory(this.currentUserAlias, chatId, newChatSessionId);

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
   * After the first user message is saved successfully, remove the mapping from newChatSessionIdForChatId
   * This allows the creation of the next New Chat Session
   */
  exitNewChatSessionFor(chatId: string, chatSessionId: string): void {
    const result = this.sessionCoordinator.exitNewChatSession(chatId, chatSessionId);
    if (result.success) {
      logger.info('[AgentChatManager] Exited New Chat Session state', 'exitNewChatSessionFor', {
        chatId,
        chatSessionId
      });
    } else {
      logger.warn('[AgentChatManager] ChatSessionId mismatch when exiting New Chat Session', 'exitNewChatSessionFor', {
        chatId,
        requestedChatSessionId: chatSessionId,
        existingNewChatSessionId: result.existingChatSessionId
      });
    }
  }

  /**
   * 🔥 New: Fork ChatSession
   *
   * Responsibilities:
   * 1. Generate new targetChatSessionId
   * 2. Copy ChatSession data via chatSessionManager (files and ChatSessionList)
   * 3. Load data for targetChatSessionId and create AgentChat instance
   * 4. Switch to new ChatSession and notify frontend
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

      // 2. Copy ChatSession data via ChatSessionStore
      const copySuccess = await chatSessionStore.copySession(
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

      const forkedSessionDir = await this.sessionCoordinator.forkChatSessionDirectory(
        this.currentUserAlias,
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
      );

      if (!forkedSessionDir) {
        logger.error('[AgentChatManager] Failed to provision forked ChatSession workspace', 'forkChatSession', {
          chatId,
          sourceChatSessionId,
          targetChatSessionId,
        });
        return { success: false, error: 'Failed to provision forked ChatSession workspace' };
      }

      // 3. Switch to new ChatSession (this automatically loads data, creates instance, and notifies frontend)
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
      totalInstances: this.registry.getInstanceCount(),
      currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
      cachedChatSessionIds: this.registry.listCachedSessionIds()
    };
  }

  async runScheduledJob(
    job: SchedulerJob,
    options?: { chatSessionId?: string; onReady?: (payload: { chatSessionId: string }) => void },
  ): Promise<{ success: boolean; chatSessionId?: string; messagesCount?: number; error?: string }> {
    if (!this.currentUserAlias) {
      logger.warn('scheduler.runtime.runScheduledJob.end', 'runScheduledJob', {
        jobId: job.id,
        agentId: job.agentId,
        success: false,
        error: 'No current user alias set',
      });
      return { success: false, error: 'No current user alias set' };
    }

    const chatSessionId = options?.chatSessionId || this.generateChatSessionId();
    logger.info('scheduler.runtime.runScheduledJob.start', 'runScheduledJob', {
      alias: this.currentUserAlias,
      jobId: job.id,
      name: job.name,
      agentId: job.agentId,
      chatSessionId,
    });

    const result = await this.scheduledRunner.run(this.currentUserAlias, chatSessionId, job, {
      onReady: options?.onReady,
    });

    logger.info('scheduler.runtime.runScheduledJob.end', 'runScheduledJob', {
      alias: this.currentUserAlias,
      jobId: job.id,
      name: job.name,
      agentId: job.agentId,
      chatSessionId,
      success: result.success,
      messagesCount: result.messagesCount,
      error: result.error,
    });

    return result;
  }

  /**
   * Get or create CancellationTokenSource
   */
  private getOrCreateCancellationSource(chatSessionId: string): CancellationTokenSource {
    return this.registry.getOrCreateCancellationSource(chatSessionId);
  }

  /**
   * Cancel operation for specified chatSession
   */
  async cancelChatSession(chatSessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('[AgentChatManager] 🛑 Cancelling chat session', 'cancelChatSession', { chatSessionId });

      // Check if there is an active AgentChat instance
      const agentChat = this.registry.getInstance(chatSessionId);
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

      const source = this.registry.getCancellationSource(chatSessionId);
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

        const interruptedInteractiveRequest = interactiveRequestManager.interruptSession(chatSessionId);
        if (interruptedInteractiveRequest) {
          logger.info('[AgentChatManager] Interrupted pending interactive request during fallback chat cancellation', 'cancelChatSession', {
            chatSessionId,
          });
        }

        // Clean up any pending push state (external agent fire-and-forget)
        agentChat.cancelPush();

        // If no CancellationTokenSource but chat is not idle, try directly setting chat status to idle
        try {
          let agentName = 'Unknown';
          try {
            const agentInfo = await agentChat.getAgentInfo();
            agentName = agentInfo.name || 'Unknown';
          } catch (agentInfoError) {
            // If retrieval fails, use default value
          }

          // Notify frontend that cancellation is complete
          this.notificationBridge.emitChatStatusChanged(agentChat.getChatId(), chatSessionId, 'idle', agentName);

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
      agentChat.invalidateActiveExecution();
      logger.info('[AgentChatManager] source.cancel() completed, token cancelled:', 'cancelChatSession', {
        chatSessionId,
        isCancelled: source.token.isCancellationRequested
      });

      const interruptedInteractiveRequest = interactiveRequestManager.interruptSession(chatSessionId);
      if (interruptedInteractiveRequest) {
        logger.info('[AgentChatManager] Interrupted pending interactive request during chat cancellation', 'cancelChatSession', {
          chatSessionId,
        });
      }

      try {
        await agentChat.cancelActiveToolExecution();
      } catch (activeToolCancelError) {
        logger.warn('[AgentChatManager] Failed to cancel active tool execution', 'cancelChatSession', {
          chatSessionId,
          error: activeToolCancelError instanceof Error ? activeToolCancelError.message : String(activeToolCancelError)
        });
      }

      let agentName = 'Unknown';
      try {
        const agentInfo = await agentChat.getAgentInfo();
        agentName = agentInfo.name || 'Unknown';
      } catch {
      }

      this.notificationBridge.emitChatStatusChanged(agentChat.getChatId(), chatSessionId, 'idle', agentName);

      // 🔥 New: Synchronously cancel all sub-agent tasks spawned from this session
      try {
        const { SubAgentManager } = await import('../subAgent/subAgentManager');
        const subAgentManager = SubAgentManager.getInstance();
        const cancelledCount = await subAgentManager.cancelByParentSession(chatSessionId);
        if (cancelledCount > 0) {
          logger.info('[AgentChatManager] 🛑 Cancelled sub-agent tasks', 'cancelChatSession', {
            chatSessionId,
            cancelledCount
          });
        }
      } catch (subAgentError) {
        // Non-fatal: Sub-agent cancellation failure does not affect main flow
        logger.warn('[AgentChatManager] Failed to cancel sub-agent tasks', 'cancelChatSession', {
          chatSessionId,
          error: subAgentError instanceof Error ? subAgentError.message : String(subAgentError)
        });
      }

      // Clean up the cancelled source so future sends can create a fresh token, then wait
      // for the current turn to unwind to idle. Partial-response persistence happens in
      // that unwind path before AgentChat marks the session idle, so awaiting here keeps
      // stopChat from returning before the cancelled reply has been flushed.
      this.registry.clearCancellationSource(chatSessionId);

      // Force idle immediately so subsequent user messages are not rejected while waiting
      // for the cancelled turn to unwind. The nonce guard in startChat's catch block may
      // skip the normal handleFailure → idle transition when invalidateActiveExecution has
      // already bumped the nonce.
      agentChat.forceIdleStatus();

      logger.info('[AgentChatManager] Waiting for idle transition after cancellation', 'cancelChatSession', { chatSessionId });
      await this.waitForChatSessionIdle(chatSessionId, 5000);

      // If the conversation loop hasn't unwound within the timeout (e.g. a long-running
      // MCP tool that hasn't checked the cancellation token yet), force the internal
      // status to idle so subsequent user messages aren't rejected.
      if (agentChat.getChatStatus() !== 'idle') {
        agentChat.forceIdleStatus();
      }

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
    const agentChat = this.registry.getInstance(chatSessionId);

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
          // If getting status fails, instance may be destroyed, resolve directly
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
    message: UserMessage,
    options?: { emitUserMessage?: boolean; isRemoteSession?: boolean }
  ): Promise<{ success: boolean; data?: Message[]; error?: string }> {
    const agentChat = this.registry.getInstance(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'streamMessage', { chatSessionId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }

    const currentStatus = agentChat.getChatStatus();
    if (currentStatus !== 'idle') {
      logger.warn('[AgentChatManager] Rejecting streamMessage while session is not idle', 'streamMessage', {
        chatSessionId,
        messageId: message.id,
        currentStatus,
      });
      return {
        success: false,
        error: `Cannot send a new message while chat status is ${currentStatus}`,
      };
    }

    try {
      // 🔥 New: Cancel idle timer when starting processing (if any)
      this.sessionCoordinator.handleStatusChange(chatSessionId, 'sending_response', this.getRuntimeMode(chatSessionId));

      // Get or create CancellationTokenSource
      const source = this.getOrCreateCancellationSource(chatSessionId);

      logger.info('[AgentChatManager] Starting stream message with cancellation support', 'streamMessage', {
        chatSessionId,
        messageId: message.id,
        tokenCancelled: source.token.isCancellationRequested
      });

      // Pass token to AgentChat
      const messages = await agentChat.streamMessage(message, source.token, undefined, options);

      logger.info('[AgentChatManager] Stream message completed', 'streamMessage', {
        chatSessionId,
        messagesCount: messages.length,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        finalAgentStatusBeforeCheck: agentChat.getChatStatus(),
      });

      // Clean up source after successful completion
      this.registry.clearCancellationSource(chatSessionId);

      // 🔥 New: Check status after completion, start cleanup timer if idle
      const finalStatus = agentChat.getChatStatus();
      const lostForegroundWhileActive = this.sessionCoordinator.hasPendingUnread(chatSessionId);
      const shouldMarkUnread = this.sessionCoordinator.shouldMarkUnreadAfterCompletion(chatSessionId, finalStatus, messages.length);
      logger.info('[AgentChatManager] streamMessage -> final status check', 'streamMessage', {
        chatSessionId,
        finalStatus,
        messagesCount: messages.length,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        lostForegroundWhileActive,
        shouldMarkUnread,
      });
      if (shouldMarkUnread) {
        this.sessionCoordinator.clearPendingUnread(chatSessionId);
        await this.markChatSessionAsUnreadIfNeeded(chatSessionId);
      }

      return { success: true, data: messages };
    } catch (error) {
      // Check if failure was due to cancellation
      if (error instanceof CancellationError) {
        logger.info('[AgentChatManager] Operation cancelled', 'streamMessage', { chatSessionId });

        // Clean up source after cancellation
        this.registry.clearCancellationSource(chatSessionId);

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
      this.registry.clearCancellationSource(chatSessionId);

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
    const agentChat = this.registry.getInstance(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'retryChat', { chatSessionId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }

    try {
      // 🔥 Cancel idle timer when starting processing (if any)
      this.sessionCoordinator.handleStatusChange(chatSessionId, 'sending_response', this.getRuntimeMode(chatSessionId));

      // Get or create CancellationTokenSource
      const source = this.getOrCreateCancellationSource(chatSessionId);

      logger.info('[AgentChatManager] Starting retry chat with cancellation support', 'retryChat', {
        chatSessionId,
        tokenCancelled: source.token.isCancellationRequested
      });

      // Call AgentChat's retryChat method
      const messages = await agentChat.retryChat(source.token);

      logger.info('[AgentChatManager] Retry chat completed', 'retryChat', {
        chatSessionId,
        messagesCount: messages.length,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        finalAgentStatusBeforeCheck: agentChat.getChatStatus(),
      });

      // Resync frontend cache with the full persisted history.
      // This fixes the case where the user message was removed from the frontend cache
      // after the initial API error but remains persisted on disk.
      this.notifyChatSessionCacheCreated(chatSessionId, agentChat.getChatId(), {
        renderChatHistory: agentChat.getDisplayMessages(),
        chatStatus: agentChat.getChatStatus(),
        contextTokenUsage: agentChat.getContextTokenUsage(),
        pendingInteractiveRequest: agentChat.getPendingInteractiveRequest(),
      });

      // Clean up source after successful completion
      this.registry.clearCancellationSource(chatSessionId);

      // 🔥 Check status after completion
      const finalStatus = agentChat.getChatStatus();
      const lostForegroundWhileActive = this.sessionCoordinator.hasPendingUnread(chatSessionId);
      const shouldMarkUnread = this.sessionCoordinator.shouldMarkUnreadAfterCompletion(chatSessionId, finalStatus, messages.length);
      logger.info('[AgentChatManager] retryChat -> final status check', 'retryChat', {
        chatSessionId,
        finalStatus,
        messagesCount: messages.length,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        lostForegroundWhileActive,
        shouldMarkUnread,
      });
      if (shouldMarkUnread) {
        this.sessionCoordinator.clearPendingUnread(chatSessionId);
        await this.markChatSessionAsUnreadIfNeeded(chatSessionId);
      }

      return { success: true, data: messages };
    } catch (error) {
      // Check if failure was due to cancellation
      if (error instanceof CancellationError) {
        logger.info('[AgentChatManager] Retry cancelled', 'retryChat', { chatSessionId });

        // Clean up source after cancellation
        this.registry.clearCancellationSource(chatSessionId);

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
      this.registry.clearCancellationSource(chatSessionId);

      // 🔥 Preserve more error context information
      const retryErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      const retryStatusCode = (error as any)?.statusCode;
      return {
        success: false,
        error: retryStatusCode ? `[HTTP ${retryStatusCode}] ${retryErrorMessage}` : retryErrorMessage
      };
    }
  }

  async editUserMessage(
    chatSessionId: string,
    messageId: string,
    updatedMessage: Message,
  ): Promise<{ success: boolean; data?: Message[]; error?: string }> {
    const agentChat = this.registry.getInstance(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'editUserMessage', { chatSessionId, messageId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }

    try {
      this.sessionCoordinator.handleStatusChange(chatSessionId, 'sending_response', this.getRuntimeMode(chatSessionId));
      const source = this.getOrCreateCancellationSource(chatSessionId);

      logger.info('[AgentChatManager] Starting editUserMessage', 'editUserMessage', {
        chatSessionId,
        messageId,
        tokenCancelled: source.token.isCancellationRequested,
      });

      const messages = await agentChat.editUserMessage(messageId, updatedMessage, source.token);

      this.registry.clearCancellationSource(chatSessionId);

      return { success: true, data: messages };
    } catch (error) {
      if (error instanceof CancellationError) {
        this.registry.clearCancellationSource(chatSessionId);
        return { success: true, data: [] };
      }

      logger.error('[AgentChatManager] editUserMessage failed', 'editUserMessage', {
        chatSessionId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.registry.clearCancellationSource(chatSessionId);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  canEditUserMessage(
    chatSessionId: string,
    messageId: string,
  ): { success: boolean; data?: { canEdit: boolean; error?: string }; error?: string } {
    const agentChat = this.registry.getInstance(chatSessionId);
    if (!agentChat) {
      logger.error('[AgentChatManager] No agent instance found', 'canEditUserMessage', { chatSessionId, messageId });
      return { success: false, error: 'No agent instance found for this chat session' };
    }

    try {
      return {
        success: true,
        data: agentChat.canEditUserMessage(messageId),
      };
    } catch (error) {
      logger.error('[AgentChatManager] canEditUserMessage failed', 'canEditUserMessage', {
        chatSessionId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
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
    this.notificationBridge.setMainWindow(window);

    logger.info('[AgentChatManager] Main window reference updated', 'setMainWindow', {
      hasWindow: !!window,
      windowState: this.getMainWindowState(),
      currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
    });

    // After window is ready, trigger all instances to re-notify context stats
    if (window && !window.isDestroyed()) {
      this.registry.forEachInstance((instance, chatSessionId) => {
        try {
          instance.calculateAndNotifyContext();
        } catch (error) {
          logger.error(`[AgentChatManager] Failed to resend context stats for chatSession ${chatSessionId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
  }

  private showChatSessionCompletionNotification(
    chatId: string,
    chatSessionId: string,
    chatSessionName?: string | null,
    outcome: 'completed' | 'failed' = 'completed'
  ): void {
    this.notificationBridge.showChatSessionCompletionNotification(chatId, chatSessionId, chatSessionName, outcome);
  }

  /**
   * Set up context change listener
   */
  private setupContextChangeListener(instance: AgentChat, chatSessionId: string): void {
    this.rendererBridge.setupContextChangeListener(instance, chatSessionId);
  }

  /**
   * 🔥 New: Notify frontend of currentChatSessionId change
   */
  private notifyCurrentChatSessionIdChanged(chatId: string | null, chatSessionId: string | null): void {
    this.rendererBridge.notifyCurrentChatSessionIdChanged(chatId, chatSessionId);
  }

  /**
   * 🔥 New: Notify frontend to create ChatSession cache
   */
  private notifyChatSessionCacheCreated(chatSessionId: string, chatId: string, initialData?: any): void {
    this.rendererBridge.notifyChatSessionCacheCreated(chatSessionId, chatId, initialData);
  }

  /**
   * 🔥 New: Notify frontend to destroy ChatSession cache
   */
  private notifyChatSessionCacheDestroyed(chatSessionId: string): void {
    this.rendererBridge.notifyChatSessionCacheDestroyed(chatSessionId);
  }

  /**
   * Get currently active chatSessionId
   */
  getCurrentActiveChatSessionId(): string | null {
    return this.sessionCoordinator.getCurrentChatSessionId();
  }

  /**
   * 🔥 New: Get current ChatSession's Context Token usage
   * Used for frontend to proactively pull initial state (e.g., when ContextBadge initializes)
   */
  getCurrentContextTokenUsage(): { tokenCount: number; totalMessages: number; contextMessages: number; compressionRatio: number } | null {
    const currentInstance = this.sessionCoordinator.getCurrentInstance();
    if (!currentInstance) {
      logger.warn('[AgentChatManager] No current instance for context token usage');
      return null;
    }

    // Get cached statistics from latestContextStats
    const contextStats = (currentInstance as any).latestContextStats;

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
    return this.sessionCoordinator.getCurrentChatSessionId() === chatSessionId;
  }

  /**
   * Create AgentChat instance
   */
  private async createAgentWithChatSession(userAlias: string, chatId: string, chatSessionId: string, chatSessionData?: any, chatSessionMetadata?: any): Promise<AgentChat> {
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

    if (chatSessionMetadata) {
      agent.hydrateSchedulerMetadata(chatSessionMetadata);
    }

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
  destroy(notifyFrontend: boolean = false): void {
    logger.info('[AgentChatManager] Destroying AgentChatManager', 'destroy');

    this.notificationBridge.destroy();

    this.registry.disposeAllCancellationSources();

    // Destroy all AgentChat instances
    this.registry.listCachedSessionIds().forEach((chatSessionId) => {
      try {
        this.disposeManagedInstance(chatSessionId, notifyFrontend);
      } catch (error) {
        logger.error('[AgentChatManager] Error destroying agent instance', 'destroy', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.registry.clearAll();
    this.sessionCoordinator.reset();

    this.currentUserAlias = null;
    this.isInitialized = false;

    logger.info('[AgentChatManager] AgentChatManager destroyed', 'destroy');
  }

  /**
   * Keep manager-owned runtime status handling and renderer propagation aligned for all managed instances.
   */
  private setupStatusChangeListener(instance: AgentChat, chatSessionId: string): void {
    if (typeof (instance as any).__removeStatusChangeListener === 'function') {
      return;
    }

    const removeListener = instance.addStatusChangeListener((status) => {
      let agentName = 'Unknown';
      try {
        const latestConfig = this.currentUserAlias
          ? profileCacheManager.getChatConfig(this.currentUserAlias, instance.getChatId())
          : null;
        agentName = latestConfig?.agent?.name || 'Unknown';
      } catch {
      }

      if (!instance.hasEventSender()) {
        this.rendererBridge.notifyChatStatusChanged(instance.getChatId(), chatSessionId, status, agentName);
      }
      this.handleStatusChange(chatSessionId, status);
    });

    (instance as any).__removeStatusChangeListener = removeListener;
  }

  /**
   * 🔥 New: Handle ChatSession status change
   */
  private handleStatusChange(chatSessionId: string, status: string): void {
    const runtimeMode = this.getRuntimeMode(chatSessionId);

    logger.info('[AgentChatManager] handleStatusChange', 'handleStatusChange', {
      chatSessionId,
      status,
      isProtected: this.isProtectedSession(chatSessionId),
      currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
      runtimeMode,
      hasIdleTimer: this.sessionCoordinator.hasIdleTimer(chatSessionId),
    });

    this.sessionCoordinator.handleStatusChange(chatSessionId, status, runtimeMode);
  }

  /**
   * 🔥 New: Check if this is a protected session (New Chat or Current Chat)
   */
  private isProtectedSession(chatSessionId: string): boolean {
    return this.sessionCoordinator.isProtectedSession(chatSessionId, this.getRuntimeMode(chatSessionId));
  }

  private isMainWindowForeground(): boolean {
    return this.notificationBridge.isMainWindowForeground();
  }

  private getMainWindowState(): {
    hasWindow: boolean;
    destroyed: boolean;
    visible: boolean | null;
    minimized: boolean | null;
    focused: boolean | null;
  } {
    return this.notificationBridge.getMainWindowState();
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
    const instance = this.registry.getInstance(chatSessionId);
    if (!instance) {
      logger.warn('[AgentChatManager] Instance not found for cleanup', 'cleanupIdleInstance', {
        chatSessionId
      });
      return;
    }

    // Final confirmation: check if current status is still idle
    const currentStatus = instance.getChatStatus();
    if (currentStatus !== 'idle') {
      logger.info('[AgentChatManager] Instance no longer idle, skipping cleanup', 'cleanupIdleInstance', {
        chatSessionId,
        currentStatus
      });
      // Cancel timer
      this.sessionCoordinator.handleStatusChange(chatSessionId, currentStatus, this.getRuntimeMode(chatSessionId));
      return;
    }

    // 🔥 Modified: Use unified cleanup method
    logger.info('[AgentChatManager] ✅ Cleaning up idle instance', 'cleanupIdleInstance', {
      chatSessionId,
      remainingInstances: this.registry.getInstanceCount() - 1
    });

    this.removeInstanceByChatSession(chatSessionId);
  }

  /**
   * 🔥 New: Handle ChatSession losing focus (from Current to non-Current)
   */
  private handleSessionLostFocus(chatSessionId: string): void {
    const instance = this.registry.getInstance(chatSessionId);
    if (!instance) {
      logger.info('[AgentChatManager] Session lost focus skipped: instance not found', 'handleSessionLostFocus', {
        chatSessionId,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        windowState: this.getMainWindowState(),
      });
      return;
    }

    try {
      // Check current status of the session that lost focus
      const currentStatus = instance.getChatStatus();
      const runtimeMode = this.getRuntimeMode(chatSessionId);
      const hadPendingUnread = this.sessionCoordinator.hasPendingUnread(chatSessionId);
      this.sessionCoordinator.handleSessionLostFocus(chatSessionId, currentStatus, runtimeMode);

      logger.info('[AgentChatManager] Session lost focus', 'handleSessionLostFocus', {
        chatSessionId,
        currentStatus,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        runtimeMode,
        lostFocusWhileActive: runtimeMode === 'interactive' && currentStatus !== 'idle',
        hadPendingUnread,
        hasPendingUnreadAfterUpdate: this.sessionCoordinator.hasPendingUnread(chatSessionId),
        windowState: this.getMainWindowState(),
      });
    } catch (error) {
      logger.error('[AgentChatManager] Error handling session lost focus', 'handleSessionLostFocus', {
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async markChatSessionAsUnreadIfNeeded(chatSessionId: string): Promise<void> {
    const instance = this.registry.getInstance(chatSessionId);
    if (!instance) {
      logger.warn('[AgentChatManager] markChatSessionAsUnreadIfNeeded skipped: no instance', 'markChatSessionAsUnreadIfNeeded', {
        chatSessionId,
      });
      return;
    }

    const runtimeMode = this.getRuntimeMode(chatSessionId);
    if (runtimeMode !== 'interactive') {
      logger.info('[AgentChatManager] markChatSessionAsUnreadIfNeeded skipped: non-interactive', 'markChatSessionAsUnreadIfNeeded', {
        chatSessionId,
        runtimeMode,
      });
      return;
    }

    if (this.isProtectedSession(chatSessionId)) {
      logger.info('[AgentChatManager] markChatSessionAsUnreadIfNeeded skipped: session is foreground protected', 'markChatSessionAsUnreadIfNeeded', {
        chatSessionId,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
        currentStatus: instance.getChatStatus(),
        windowState: this.getMainWindowState(),
      });
      return;
    }

    const chatId = instance.getChatId();
    logger.info('[AgentChatManager] markChatSessionAsUnreadIfNeeded -> update unread', 'markChatSessionAsUnreadIfNeeded', {
      chatId,
      chatSessionId,
      currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
      currentStatus: instance.getChatStatus(),
      windowState: this.getMainWindowState(),
    });
    const unreadUpdated = await this.updateChatSessionReadStatus(chatId, chatSessionId, 'unread');
    logger.info('[AgentChatManager] markChatSessionAsUnreadIfNeeded -> update result', 'markChatSessionAsUnreadIfNeeded', {
      chatId,
      chatSessionId,
      unreadUpdated,
      windowState: this.getMainWindowState(),
    });
    if (unreadUpdated) {
      this.showChatSessionCompletionNotification(
        chatId,
        chatSessionId,
        instance.getCurrentChatSession()?.title,
        'completed'
      );
    } else {
      logger.warn('[AgentChatManager] markChatSessionAsUnreadIfNeeded skipped notification because unread update did not persist', 'markChatSessionAsUnreadIfNeeded', {
        chatId,
        chatSessionId,
        currentStatus: instance.getChatStatus(),
        windowState: this.getMainWindowState(),
      });
    }
  }

  private async updateChatSessionReadStatus(
    chatId: string,
    chatSessionId: string,
    readStatus: ChatSessionReadStatus
  ): Promise<boolean> {
    if (!this.currentUserAlias) {
      return false;
    }

    try {
      const instance = this.registry.getInstance(chatSessionId);

      logger.info('[AgentChatManager] updateChatSessionReadStatus -> begin', 'updateChatSessionReadStatus', {
        chatId,
        chatSessionId,
        targetReadStatus: readStatus,
        hasInstance: !!instance,
        currentChatSessionId: this.sessionCoordinator.getCurrentChatSessionId(),
      });

      const sessionExists = !!(await chatSessionStore.ensureLoaded(
        this.currentUserAlias,
        chatId,
        chatSessionId
      ));

      if (!sessionExists) {
        logger.info('[AgentChatManager] updateChatSessionReadStatus skipped: session not yet persisted', 'updateChatSessionReadStatus', {
          chatId,
          chatSessionId,
          readStatus,
        });
        return false;
      }

      const updated = await chatSessionStore.setReadStatus(
        this.currentUserAlias,
        chatId,
        chatSessionId,
        readStatus
      );

      const success = !!updated;

      if (!success) {
        logger.warn('[AgentChatManager] updateChatSessionReadStatus failed to persist', 'updateChatSessionReadStatus', {
          chatId,
          chatSessionId,
          readStatus,
        });
        return false;
      }

      await profileCacheManager.syncStarredChatSessionIndex(
        this.currentUserAlias,
        chatId,
        updated.metadata,
        { notifyRenderer: false },
      );

      logger.info('[AgentChatManager] updateChatSessionReadStatus -> persisted', 'updateChatSessionReadStatus', {
        chatId,
        chatSessionId,
        readStatus,
        windowState: this.getMainWindowState(),
      });
      return true;
    } catch (error) {
      logger.warn('[AgentChatManager] Failed to update chat session read status', 'updateChatSessionReadStatus', {
        chatId,
        chatSessionId,
        readStatus,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async cancelActiveToolExecution(chatSessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const agentChat = this.registry.getInstance(chatSessionId);
      if (!agentChat) {
        return { success: false, error: 'No active chat session instance found' };
      }

      await agentChat.cancelActiveToolExecution();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const agentChatManager = AgentChatManager.getInstance();