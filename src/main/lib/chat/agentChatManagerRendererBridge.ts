import type { AgentChat } from './agentChat';

import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export class AgentChatManagerRendererBridge {
  constructor(private readonly getMainWindow: () => Electron.BrowserWindow | null) {}

  attachEventSenderToMainWindow(instance: AgentChat): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      instance.setEventSender(mainWindow.webContents);
    }
  }

  notifyCurrentChatSessionIdChanged(chatId: string | null, chatSessionId: string | null): void {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('agentChat:currentChatSessionIdChanged', {
      chatId,
      chatSessionId,
    });
    logger.info('[AgentChatManager] Notified current chat session changed', 'notifyCurrentChatSessionIdChanged', {
      chatId,
      chatSessionId,
    });
  }

  notifyChatSessionCacheCreated(chatSessionId: string, chatId: string, initialData?: any): void {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('agentChat:chatSessionCacheCreated', {
      chatSessionId,
      chatId,
      initialData,
    });
    logger.info('[AgentChatManager] Notified chat session cache created', 'notifyChatSessionCacheCreated', {
      chatSessionId,
      chatId,
      chatStatus: initialData?.chatStatus ?? null,
      hasPendingInteractiveRequest: !!initialData?.pendingInteractiveRequest,
    });
  }

  notifyChatStatusChanged(chatId: string, chatSessionId: string, chatStatus: string, agentName: string): void {
    const mainWindow = this.getMainWindow();
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
    logger.info('[AgentChatManager] Notified chat status changed', 'notifyChatStatusChanged', {
      chatId,
      chatSessionId,
      chatStatus,
      agentName,
    });
  }

  notifyChatSessionCacheDestroyed(chatSessionId: string): void {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('agentChat:chatSessionCacheDestroyed', {
      chatSessionId,
    });
    logger.info('[AgentChatManager] Notified chat session cache destroyed', 'notifyChatSessionCacheDestroyed', {
      chatSessionId,
    });
  }

  setupContextChangeListener(instance: AgentChat, chatSessionId: string): void {
    const contextChangeListener = (stats: any) => {
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agentChat:contextChange', {
          chatSessionId,
          chatId: instance.getChatId(),
          stats,
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.warn('[AgentChatManager] Cannot send context change - no valid main window');
      }
    };

    instance.addContextChangeListener(contextChangeListener);
  }
}