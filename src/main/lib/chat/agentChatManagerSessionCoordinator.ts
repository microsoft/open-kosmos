import * as fs from 'fs';
import { cp, mkdir, readdir, rm } from 'fs/promises';
import * as path from 'path';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { createLogger } from '../unifiedLogger';
import { AgentChat } from './agentChat';
import { AgentChatRuntimeMode } from './agentChatManagerRegistry';

const logger = createLogger();

interface AgentChatManagerSessionCoordinatorDeps {
  onIdleTimeout(chatSessionId: string): void;
  isMainWindowForeground(): boolean;
  getMainWindowState(): {
    hasWindow: boolean;
    destroyed: boolean;
    visible: boolean | null;
    minimized: boolean | null;
    focused: boolean | null;
  };
}

export class AgentChatManagerSessionCoordinator {
  private currentInstance: AgentChat | null = null;
  private currentChatSessionId: string | null = null;
  private readonly newChatSessionIdForChatId = new Map<string, string>();
  private readonly idleTimers = new Map<string, { timer: NodeJS.Timeout; idleSince: number }>();
  private readonly pendingUnreadOnIdleSessions = new Set<string>();
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly deps: AgentChatManagerSessionCoordinatorDeps,
    idleTimeoutMs: number,
  ) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

  getCurrentInstance(): AgentChat | null {
    return this.currentInstance;
  }

  getCurrentChatSessionId(): string | null {
    return this.currentChatSessionId;
  }

  activateSession(chatSessionId: string, instance: AgentChat): void {
    this.currentInstance = instance;
    this.currentChatSessionId = chatSessionId;
    this.cancelIdleTimer(chatSessionId);
    this.pendingUnreadOnIdleSessions.delete(chatSessionId);
  }

  clearCurrentSession(chatSessionId: string): void {
    if (this.currentChatSessionId !== chatSessionId) {
      return;
    }

    this.currentInstance = null;
    this.currentChatSessionId = null;
  }

  getOrCreateNewChatSessionId(chatId: string, generate: () => string): string {
    const existing = this.newChatSessionIdForChatId.get(chatId);
    if (existing) {
      return existing;
    }

    const created = generate();
    this.newChatSessionIdForChatId.set(chatId, created);
    return created;
  }

  getNewChatSessionId(chatId: string): string | null {
    return this.newChatSessionIdForChatId.get(chatId) || null;
  }

  exitNewChatSession(chatId: string, chatSessionId: string): { success: boolean; existingChatSessionId: string | null } {
    const existing = this.newChatSessionIdForChatId.get(chatId);
    if (existing !== chatSessionId) {
      return {
        success: false,
        existingChatSessionId: existing || null,
      };
    }

    this.newChatSessionIdForChatId.delete(chatId);
    return {
      success: true,
      existingChatSessionId: existing || null,
    };
  }

  hasIdleTimer(chatSessionId: string): boolean {
    return this.idleTimers.has(chatSessionId);
  }

  hasPendingUnread(chatSessionId: string): boolean {
    return this.pendingUnreadOnIdleSessions.has(chatSessionId);
  }

  clearPendingUnread(chatSessionId: string): void {
    this.pendingUnreadOnIdleSessions.delete(chatSessionId);
  }

  clearPendingUnreadForCurrentSession(): void {
    if (!this.currentChatSessionId) {
      return;
    }

    this.pendingUnreadOnIdleSessions.delete(this.currentChatSessionId);
  }

  handleSessionLostFocus(chatSessionId: string, status: string, runtimeMode: AgentChatRuntimeMode | null): void {
    const lostFocusWhileActive = runtimeMode === 'interactive' && status !== 'idle';
    if (lostFocusWhileActive) {
      this.pendingUnreadOnIdleSessions.add(chatSessionId);
    }

    logger.info('[AgentChatManagerSessionCoordinator] Session lost focus', 'handleSessionLostFocus', {
      chatSessionId,
      status,
      currentChatSessionId: this.currentChatSessionId,
      runtimeMode,
      lostFocusWhileActive,
      hasPendingUnreadAfterUpdate: this.pendingUnreadOnIdleSessions.has(chatSessionId),
      windowState: this.deps.getMainWindowState(),
    });

    if (status === 'idle') {
      this.handleStatusChange(chatSessionId, status, runtimeMode);
    }
  }

  handleStatusChange(chatSessionId: string, status: string, runtimeMode: AgentChatRuntimeMode | null): void {
    const isProtected = this.isProtectedSession(chatSessionId, runtimeMode);

    logger.info('[AgentChatManagerSessionCoordinator] handleStatusChange', 'handleStatusChange', {
      chatSessionId,
      status,
      isProtected,
      currentChatSessionId: this.currentChatSessionId,
      runtimeMode,
      hasIdleTimer: this.idleTimers.has(chatSessionId),
    });

    if (isProtected) {
      this.cancelIdleTimer(chatSessionId);
      return;
    }

    if (status === 'idle') {
      this.startIdleTimer(chatSessionId);
      return;
    }

    this.cancelIdleTimer(chatSessionId);
  }

  shouldMarkUnreadAfterCompletion(chatSessionId: string, finalStatus: string, messagesCount: number): boolean {
    return messagesCount > 0 && finalStatus === 'idle' && this.pendingUnreadOnIdleSessions.has(chatSessionId);
  }

  isProtectedSession(chatSessionId: string, runtimeMode: AgentChatRuntimeMode | null): boolean {
    if (runtimeMode !== 'interactive') {
      return false;
    }

    if (this.currentChatSessionId === chatSessionId) {
      const isForeground = this.deps.isMainWindowForeground();
      if (!isForeground) {
        logger.info('[AgentChatManagerSessionCoordinator] Current session is not protected because main window is not foreground', 'isProtectedSession', {
          chatSessionId,
          currentChatSessionId: this.currentChatSessionId,
          windowState: this.deps.getMainWindowState(),
        });
      }
      if (isForeground) {
        return true;
      }
    }

    for (const [, newChatSessionId] of this.newChatSessionIdForChatId.entries()) {
      if (newChatSessionId === chatSessionId) {
        return true;
      }
    }

    return false;
  }

  async ensureChatSessionDirectory(currentUserAlias: string | null, chatId: string, chatSessionId: string): Promise<string | null> {
    try {
      return await this.resolveOrCreateChatSessionDirectory(currentUserAlias, chatId, chatSessionId);
    } catch (error) {
      logger.error(`[AgentChatManagerSessionCoordinator] Failed to create chat session directory for ${chatId}/${chatSessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  async forkChatSessionDirectory(
    currentUserAlias: string | null,
    chatId: string,
    sourceChatSessionId: string,
    targetChatSessionId: string,
  ): Promise<string | null> {
    try {
      const targetSessionDir = this.resolveChatSessionDirectoryPath(currentUserAlias, chatId, targetChatSessionId);
      if (!targetSessionDir) {
        return null;
      }

      const monthDir = path.dirname(targetSessionDir);
      await mkdir(monthDir, { recursive: true });

      const sourceSessionDir = this.resolveChatSessionDirectoryPath(currentUserAlias, chatId, sourceChatSessionId);
      if (!sourceSessionDir || !fs.existsSync(sourceSessionDir)) {
        if (!(await this.isDirectoryEmpty(targetSessionDir))) {
          logger.error('[AgentChatManagerSessionCoordinator] Target chat session directory already contains data during empty fork', 'forkChatSessionDirectory', {
            chatId,
            sourceChatSessionId,
            targetChatSessionId,
            targetSessionDir,
          });
          return null;
        }

        await mkdir(targetSessionDir, { recursive: true });
        logger.warn('[AgentChatManagerSessionCoordinator] Source chat session directory missing during fork, created empty target directory', 'forkChatSessionDirectory', {
          chatId,
          sourceChatSessionId,
          targetChatSessionId,
          sourceSessionDir,
          targetSessionDir,
        });
        return targetSessionDir;
      }

      if (!(await this.isDirectoryEmpty(targetSessionDir))) {
        logger.error('[AgentChatManagerSessionCoordinator] Refusing to overwrite non-empty fork target directory', 'forkChatSessionDirectory', {
          chatId,
          sourceChatSessionId,
          targetChatSessionId,
          sourceSessionDir,
          targetSessionDir,
        });
        return null;
      }

      if (fs.existsSync(targetSessionDir)) {
        await rm(targetSessionDir, { recursive: true, force: true });
      }

      await cp(sourceSessionDir, targetSessionDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });

      logger.info('[AgentChatManagerSessionCoordinator] Forked chat session directory', 'forkChatSessionDirectory', {
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
        sourceSessionDir,
        targetSessionDir,
      });

      return targetSessionDir;
    } catch (error) {
      logger.error('[AgentChatManagerSessionCoordinator] Failed to fork chat session directory', 'forkChatSessionDirectory', {
        chatId,
        sourceChatSessionId,
        targetChatSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  reset(): void {
    this.idleTimers.forEach((timerData, chatSessionId) => {
      try {
        clearTimeout(timerData.timer);
        logger.debug('[AgentChatManagerSessionCoordinator] Cleared idle timer', 'reset', { chatSessionId });
      } catch (error) {
        logger.error('[AgentChatManagerSessionCoordinator] Error clearing idle timer', 'reset', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.idleTimers.clear();
    this.pendingUnreadOnIdleSessions.clear();
    this.newChatSessionIdForChatId.clear();
    this.currentInstance = null;
    this.currentChatSessionId = null;
  }

  private startIdleTimer(chatSessionId: string): void {
    this.cancelIdleTimer(chatSessionId);
    const idleSince = Date.now();
    const timer = setTimeout(() => {
      this.deps.onIdleTimeout(chatSessionId);
    }, this.idleTimeoutMs);

    this.idleTimers.set(chatSessionId, { timer, idleSince });

    logger.info('[AgentChatManagerSessionCoordinator] Started idle timer for session', 'startIdleTimer', {
      chatSessionId,
      timeoutMs: this.idleTimeoutMs,
    });
  }

  private cancelIdleTimer(chatSessionId: string): void {
    const timerData = this.idleTimers.get(chatSessionId);
    if (!timerData) {
      return;
    }

    clearTimeout(timerData.timer);
    this.idleTimers.delete(chatSessionId);

    logger.info('[AgentChatManagerSessionCoordinator] Cancelled idle timer for session', 'cancelIdleTimer', {
      chatSessionId,
      idleDurationMs: Date.now() - timerData.idleSince,
    });
  }

  private async resolveOrCreateChatSessionDirectory(currentUserAlias: string | null, chatId: string, chatSessionId: string): Promise<string | null> {
    const sessionDir = this.resolveChatSessionDirectoryPath(currentUserAlias, chatId, chatSessionId);
    if (!sessionDir) {
      return null;
    }

    const monthDir = path.dirname(sessionDir);
    if (!fs.existsSync(monthDir)) {
      await mkdir(monthDir, { recursive: true });
      logger.info('[AgentChatManagerSessionCoordinator] Created month directory', 'resolveOrCreateChatSessionDirectory', { monthDir });
    }

    if (!fs.existsSync(sessionDir)) {
      await mkdir(sessionDir, { recursive: true });
      logger.info('[AgentChatManagerSessionCoordinator] Created chat session directory', 'resolveOrCreateChatSessionDirectory', { sessionDir });
    }

    return sessionDir;
  }

  private async isDirectoryEmpty(directoryPath: string): Promise<boolean> {
    if (!fs.existsSync(directoryPath)) {
      return true;
    }

    const entries = await readdir(directoryPath);
    return entries.length === 0;
  }

  private resolveChatSessionDirectoryPath(currentUserAlias: string | null, chatId: string, chatSessionId: string): string | null {
    if (!currentUserAlias) {
      logger.warn('[AgentChatManagerSessionCoordinator] No current user alias, skip resolving chat session directory');
      return null;
    }

    const chatConfig = profileCacheManager.getChatConfig(currentUserAlias, chatId);
    const workspacePath = chatConfig?.agent?.workspace;
    if (!workspacePath || workspacePath.trim() === '') {
      logger.warn(`[AgentChatManagerSessionCoordinator] No workspace path for chat ${chatId}, skip resolving chat session directory`);
      return null;
    }

    const yyyymm = extractMonthFromChatSessionId(chatSessionId);
    if (!yyyymm) {
      logger.warn(`[AgentChatManagerSessionCoordinator] Invalid chatSessionId format: ${chatSessionId}, skip resolving chat session directory`);
      return null;
    }

    return path.join(workspacePath, yyyymm, chatSessionId);
  }
}