import { BrowserWindow, Notification } from 'electron';

import { APP_NAME } from '@shared/constants/branding';

import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export interface AgentChatManagerNotificationBridgeHooks {
  onWindowLostForeground(): void;
  onWindowRegainedForeground(): void;
}

export class AgentChatManagerNotificationBridge {
  private mainWindow: Electron.BrowserWindow | null = null;
  private mainWindowFocusEventCleanup: (() => void) | null = null;
  private readonly activeNotifications = new Map<string, Notification>();

  constructor(private readonly hooks: AgentChatManagerNotificationBridgeHooks) {}

  setMainWindow(window: Electron.BrowserWindow | null): void {
    if (this.mainWindowFocusEventCleanup) {
      this.mainWindowFocusEventCleanup();
      this.mainWindowFocusEventCleanup = null;
    }

    this.mainWindow = window;

    if (!window || window.isDestroyed()) {
      return;
    }

    const handleLostForeground = () => {
      this.hooks.onWindowLostForeground();
    };

    const handleRegainedForeground = () => {
      this.hooks.onWindowRegainedForeground();
    };

    window.on('blur', handleLostForeground);
    window.on('hide', handleLostForeground);
    window.on('minimize', handleLostForeground);
    window.on('focus', handleRegainedForeground);
    window.on('show', handleRegainedForeground);
    window.on('restore', handleRegainedForeground);

    this.mainWindowFocusEventCleanup = () => {
      window.removeListener('blur', handleLostForeground);
      window.removeListener('hide', handleLostForeground);
      window.removeListener('minimize', handleLostForeground);
      window.removeListener('focus', handleRegainedForeground);
      window.removeListener('show', handleRegainedForeground);
      window.removeListener('restore', handleRegainedForeground);
    };
  }

  getMainWindow(): Electron.BrowserWindow | null {
    return this.mainWindow;
  }

  isMainWindowForeground(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    return this.mainWindow.isVisible() && !this.mainWindow.isMinimized() && this.mainWindow.isFocused();
  }

  getMainWindowState(): {
    hasWindow: boolean;
    destroyed: boolean;
    visible: boolean | null;
    minimized: boolean | null;
    focused: boolean | null;
  } {
    if (!this.mainWindow) {
      return {
        hasWindow: false,
        destroyed: false,
        visible: null,
        minimized: null,
        focused: null,
      };
    }

    const destroyed = this.mainWindow.isDestroyed();
    if (destroyed) {
      return {
        hasWindow: true,
        destroyed: true,
        visible: null,
        minimized: null,
        focused: null,
      };
    }

    return {
      hasWindow: true,
      destroyed: false,
      visible: this.mainWindow.isVisible(),
      minimized: this.mainWindow.isMinimized(),
      focused: this.mainWindow.isFocused(),
    };
  }

  emitChatStatusChanged(chatId: string, chatSessionId: string, chatStatus: string, agentName: string): void {
    const mainWindow = this.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('agentChat:chatStatusChanged', {
      chatId,
      chatSessionId,
      chatStatus,
      agentName,
      timestamp: new Date().toISOString(),
    });
  }

  showChatSessionCompletionNotification(
    chatId: string,
    chatSessionId: string,
    chatSessionName?: string | null,
    outcome: 'completed' | 'failed' = 'completed',
  ): void {
    logger.info('[AgentChatManager] Preparing system notification', 'showChatSessionCompletionNotification', {
      chatId,
      chatSessionId,
      outcome,
      platform: process.platform,
      notificationSupported: Notification.isSupported(),
      windowState: this.getMainWindowState(),
      activeNotifications: this.activeNotifications.size,
    });

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      logger.info('[AgentChatManager] System notification skipped: unsupported platform', 'showChatSessionCompletionNotification', {
        chatId,
        chatSessionId,
        platform: process.platform,
      });
      return;
    }

    if (!Notification.isSupported()) {
      logger.info('[AgentChatManager] System notification not supported', 'showChatSessionCompletionNotification', {
        chatId,
        chatSessionId,
        platform: process.platform,
      });
      return;
    }

    const sessionName = chatSessionName?.trim() || chatSessionId;
    const formattedSessionName = `#${sessionName}#`;
    const body = outcome === 'failed'
      ? `${formattedSessionName} failed, click to view`
      : `${formattedSessionName} is complete, click to view`;

    try {
      const notification = new Notification({
        title: APP_NAME,
        body,
      });
      const notificationId = `${chatSessionId}_${Date.now()}`;

      const cleanupNotification = () => {
        this.activeNotifications.delete(notificationId);
        logger.debug('[AgentChatManager] Notification reference cleaned up', 'showChatSessionCompletionNotification', {
          notificationId,
          remainingNotifications: this.activeNotifications.size,
        });
      };

      notification.on('click', () => {
        const targetWindow = this.getNotificationWindow();

        logger.info('[AgentChatManager] Notification clicked', 'showChatSessionCompletionNotification', {
          notificationId,
          chatId,
          chatSessionId,
          hasTargetWindow: !!targetWindow,
          windowState: this.getMainWindowState(),
        });

        cleanupNotification();

        if (!targetWindow) {
          return;
        }

        if (targetWindow.isMinimized()) {
          targetWindow.restore();
        }
        targetWindow.show();
        targetWindow.focus();
        targetWindow.webContents.send('navigate:to', {
          route: `/agent/chat/${chatId}/${chatSessionId}`,
          state: {
            source: 'system-notification',
            intent: 'open-session',
            targetChatId: chatId,
            targetSessionId: chatSessionId,
          },
        });
      });

      notification.on('close', () => {
        logger.info('[AgentChatManager] Notification closed', 'showChatSessionCompletionNotification', {
          notificationId,
          chatId,
          chatSessionId,
          activeNotifications: this.activeNotifications.size,
        });
        cleanupNotification();
      });

      this.activeNotifications.set(notificationId, notification);
      logger.debug('[AgentChatManager] Notification reference stored', 'showChatSessionCompletionNotification', {
        notificationId,
        activeNotifications: this.activeNotifications.size,
        platform: process.platform,
      });

      notification.show();
      logger.info('[AgentChatManager] System notification sent', 'showChatSessionCompletionNotification', {
        chatId,
        chatSessionId,
        outcome,
        sessionName,
        platform: process.platform,
        notificationId,
        windowState: this.getMainWindowState(),
      });
    } catch (error) {
      logger.warn('[AgentChatManager] Failed to send system notification', 'showChatSessionCompletionNotification', {
        chatId,
        chatSessionId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
        windowState: this.getMainWindowState(),
      });
    }
  }

  destroy(): void {
    if (this.mainWindowFocusEventCleanup) {
      this.mainWindowFocusEventCleanup();
      this.mainWindowFocusEventCleanup = null;
    }

    // Intentionally keep the mainWindow reference. The window can remain valid across
    // manager teardown/reinitialization cycles, and clearing it here risks later
    // reintroducing the historical bug where foreground/window state was lost.

    if (this.activeNotifications.size > 0) {
      logger.debug('[AgentChatManager] Clearing active notification references', 'destroy', {
        count: this.activeNotifications.size,
      });
      this.activeNotifications.clear();
    }
  }

  private getNotificationWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }

    const windows = BrowserWindow.getAllWindows();
    return windows.find((window) => !window.isDestroyed()) || null;
  }
}