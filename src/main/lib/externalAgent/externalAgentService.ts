/**
 * ExternalAgentService — standalone service for External Agent external LLM integration.
 *
 * Push model: Bot→OpenKosmos messages arrive as `push`/`push_end` WS messages.
 * Push chunks are routed through AgentChat for proper status management and streaming.
 * User→Bot messages are fire-and-forget (no pending reply listener).
 */
import { BrowserWindow } from 'electron';
import { ExternalAgentWsServer } from './wsServer';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { chatSessionStore } from '../chat/chatSessionStore';
import { createLogger } from '../unifiedLogger';
import { mainToRender } from '@shared/ipc/externalAgent';
import { MessageHelper } from '@shared/types/chatTypes';
import { agentChatManager } from '../chat/agentChatManager';

const logger = createLogger();

export class ExternalAgentService {
  private static instance: ExternalAgentService;
  private wsServer: ExternalAgentWsServer | null = null;
  private starting = false;
  private alias: string | null = null;

  /** token → chatId mapping, built during token validation */
  private tokenToChatId = new Map<string, string>();

  /** Per-conversation push stream state: accumulated text + stable message ID */
  private pushStreams = new Map<string, { text: string; msgId: string }>();

  private constructor() {}

  static getInstance(): ExternalAgentService {
    if (!ExternalAgentService.instance) {
      ExternalAgentService.instance = new ExternalAgentService();
    }
    return ExternalAgentService.instance;
  }

  async start(alias: string, port: number): Promise<void> {
    if (this.wsServer || this.starting) {
      logger.info('[ExternalAgentService] Already started, skipping', 'start');
      return;
    }
    this.starting = true;
    this.alias = alias;
    try {
      this.wsServer = new ExternalAgentWsServer({ port });

      // Validate token against all External Agent bots in profile
      // and cache token→chatId mapping on success
      this.wsServer.setTokenValidator((token) => {
        const profile = profileCacheManager.getCachedProfile(alias);
        if (!profile) return false;
        const chat = profile.chats.find(
          c => c.agent?.source === 'EXTERNAL' && c.agent?.authToken === token
        );
        if (chat) {
          this.tokenToChatId.set(token, chat.chat_id);
          return true;
        }
        return false;
      });

      // Push message handler: route through AgentChat
      this.wsServer.onPush((text, conversationId, token) => {
        this.handlePushMessage(text, conversationId, token);
      });

      // Push end handler: finalize through AgentChat
      this.wsServer.onPushEnd((conversationId, token) => {
        this.handlePushEnd(conversationId, token);
      });

      this.wsServer.onConnected(() => {
        this.broadcastStatus(true);
      });

      this.wsServer.onDisconnected(() => {
        this.broadcastStatus(false);
      });

      this.wsServer.start();
      logger.info('[ExternalAgentService] Started', 'start', { alias, port });
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    if (this.wsServer) {
      this.wsServer.stop();
      this.wsServer = null;
    }
    this.alias = null;
    this.tokenToChatId.clear();
    this.pushStreams.clear();
    logger.info('[ExternalAgentService] Stopped', 'stop');
  }

  sendMessage(text: string, chatId: string, conversationId: string): boolean {
    if (!this.wsServer || !this.alias) return false;
    const chat = profileCacheManager.getChatConfig(this.alias, chatId);
    const token = chat?.agent?.authToken;
    if (!token) {
      logger.warn('[ExternalAgentService] No authToken for chat', 'sendMessage', { chatId });
      return false;
    }
    return this.wsServer.sendMessage(text, conversationId, token);
  }

  get isConnected(): boolean {
    return this.wsServer?.isConnected ?? false;
  }

  private async handlePushMessage(text: string, conversationId: string, token: string): Promise<void> {
    const chatId = this.tokenToChatId.get(token);
    if (!chatId || !this.alias) {
      logger.warn('[ExternalAgentService] Push from unknown token, ignoring', 'handlePushMessage');
      return;
    }

    const chatSessionId = conversationId;

    // Initialize push stream on first chunk
    let stream = this.pushStreams.get(chatSessionId);
    if (!stream) {
      stream = { text: '', msgId: `msg_push_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
      this.pushStreams.set(chatSessionId, stream);
    }
    stream.text += text;

    // Stream through AgentChat if instance exists (UI path)
    const agentChat = this.getAgentChatInstance(chatSessionId);
    if (agentChat) {
      // Ensure event sender is attached so streaming chunks reach the renderer
      if (!agentChat.hasEventSender()) {
        const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
        if (mainWindow) {
          agentChat.setEventSender(mainWindow.webContents);
          logger.info('[ExternalAgentService] Attached event sender to AgentChat for push delivery', 'handlePushMessage', { chatId, chatSessionId });
        } else {
          logger.warn('[ExternalAgentService] No main window available to attach event sender', 'handlePushMessage', { chatId, chatSessionId });
        }
      }
      agentChat.handlePushChunk(text, stream.msgId);
      logger.info('[ExternalAgentService] Push chunk routed through AgentChat', 'handlePushMessage', { chatId, chatSessionId, textLength: text.length });
    } else {
      logger.info('[ExternalAgentService] Push chunk accumulated (no AgentChat instance)', 'handlePushMessage', { chatId, chatSessionId, textLength: text.length });
    }
  }

  private async handlePushEnd(conversationId: string, token: string): Promise<void> {
    const chatId = this.tokenToChatId.get(token);
    if (!chatId || !this.alias) {
      logger.warn('[ExternalAgentService] PushEnd from unknown token, ignoring', 'handlePushEnd');
      return;
    }

    const chatSessionId = conversationId;
    const stream = this.pushStreams.get(chatSessionId);
    const accumulatedText = stream?.text || '';
    const msgId = stream?.msgId;
    this.pushStreams.delete(chatSessionId);

    // Service is the single persistence owner for push messages.
    // When AgentChat exists: UI cleanup only (skipPersistence=true), then
    // persist via AgentChat.addMessageToSession (updates in-memory + disk
    // atomically, avoiding patchFile/saveSession conflicts).
    // When no AgentChat: persist directly via chatSessionStore.patchFile.
    const agentChat = this.getAgentChatInstance(chatSessionId);
    if (agentChat) {
      await agentChat.handlePushComplete(/* skipPersistence */ true);
      if (accumulatedText) {
        const msg = MessageHelper.createTextMessage(accumulatedText, 'assistant', msgId);
        await agentChat.addMessageToSession(msg);
      }
      logger.info('[ExternalAgentService] Push completed via AgentChat (service-owned persistence)', 'handlePushEnd', { chatId, chatSessionId });
    } else if (accumulatedText) {
      await this.persistPushMessage(chatId, chatSessionId, accumulatedText, msgId);
    }

    // Mark as unread
    if (agentChat) {
      await agentChatManager.markChatSessionAsUnreadIfNeeded(chatSessionId).catch(err => {
        logger.warn('[ExternalAgentService] Failed to mark unread', 'handlePushEnd', { err: String(err) });
      });
    } else if (accumulatedText) {
      // No AgentChat instance (offline delivery) — mark unread directly
      await chatSessionStore.setReadStatus(this.alias!, chatId, chatSessionId, 'unread').catch(err => {
        logger.warn('[ExternalAgentService] Failed to mark unread via chatSessionStore', 'handlePushEnd', { err: String(err) });
      });
    }
  }

  private async persistPushMessage(chatId: string, chatSessionId: string, text: string, msgId?: string): Promise<void> {
    try {
      const aggregate = await chatSessionStore.ensureLoaded(this.alias!, chatId, chatSessionId);
      if (!aggregate) {
        logger.warn('[ExternalAgentService] Cannot persist push: session not found', 'persistPushMessage', { chatId, chatSessionId });
        return;
      }

      const msg = MessageHelper.createTextMessage(text, 'assistant', msgId);
      const updatedChatHistory = [...aggregate.file.chat_history, msg];
      const updatedContextHistory = [...aggregate.file.context_history, msg];

      await chatSessionStore.patchFile(this.alias!, chatId, chatSessionId, {
        chat_history: updatedChatHistory,
        context_history: updatedContextHistory,
      });

      logger.info('[ExternalAgentService] Push message persisted via chatSessionStore', 'persistPushMessage', { chatId, chatSessionId, textLength: text.length });
    } catch (err) {
      logger.error('[ExternalAgentService] Failed to persist push message', 'persistPushMessage', { chatId, chatSessionId, error: String(err) });
    }
  }

  private getAgentChatInstance(chatSessionId: string) {
    return agentChatManager.getInstanceByChatSessionId(chatSessionId) || null;
  }

  private broadcastStatus(connected: boolean): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        const sender = mainToRender.bindWebContents(win.webContents);
        sender.statusChanged({ connected });
      }
    }
  }
}
