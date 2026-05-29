import { BrowserWindow } from 'electron';
import { createLogger } from '../../unifiedLogger';
import { agentChatManager } from '../../chat/agentChatManager';
import { RemoteChannelManager } from '../channelManager';
import type { InboundMessage, OutboundMessage } from '../types';
import type { Message, UserMessage, UserContentPart } from '../../../../shared/types/chatTypes';
import type { SessionEntry } from './types';
import { SESSION_TTL } from './types';
import { downloadAndBuildParts } from './attachmentPipeline';
import { loadSessionMap, pruneSessionMap, createPersistScheduler } from './sessionPersistence';
import {
  demoteSession,
  demoteOrphanedSessions,
  registerRemoteSession,
  resolveChatId,
  updateRemoteSessionTitle,
} from './sessionLifecycle';
import {
  handleNewCommand,
  handleSwitchCommand,
  handleAgentCommand,
  handleSkillListCommand,
  getAgentSkills,
  parseSkillMessage,
  type BridgeContext,
} from './commandHandlers';

const logger = createLogger();

const MAX_CONCURRENCY = 3;

/**
 * AgentBridge — Agent bridging layer (singleton)
 *
 * Responsibilities:
 * - Convert remote channel InboundMessage to AgentChat-consumable Message
 * - Maintain mapping from remote users to Agent sessions (persisted)
 * - Initiate conversations via AgentChatManager and collect results
 * - Concurrency control
 */
export class AgentBridge {
  private static instance: AgentBridge;

  private alias: string = '';
  private sessionMap: Map<string, SessionEntry> = new Map();
  private activeTasks = 0;
  private taskQueue: Array<{ resolve: () => void }> = [];
  private persistScheduler: { schedule: () => void; cancel: () => void } | null = null;
  // Per-session serialization Promise chain
  private sessionLocks: Map<string, Promise<void>> = new Map();

  private constructor() {}

  static getInstance(): AgentBridge {
    if (!AgentBridge.instance) {
      AgentBridge.instance = new AgentBridge();
    }
    return AgentBridge.instance;
  }

  async initialize(alias: string): Promise<void> {
    this.alias = alias;
    this.sessionMap = await loadSessionMap(alias);
    this.persistScheduler = createPersistScheduler(alias, this.sessionMap);
    logger.info(`[AgentBridge] Initialized for alias: ${alias}, sessions: ${this.sessionMap.size}`);

    demoteOrphanedSessions(alias, this.sessionMap).catch(() => {});
  }

  async handleInboundMessage(message: InboundMessage, abortSignal?: AbortSignal): Promise<OutboundMessage> {
    const sessionKey = `${message.channelId}:${message.userId}`;

    const prevLock = this.sessionLocks.get(sessionKey) || Promise.resolve();
    const resultPromise = prevLock.then(() => this.processMessage(message, sessionKey, abortSignal));
    this.sessionLocks.set(sessionKey, resultPromise.then(() => {}, () => {}));

    return resultPromise;
  }

  /**
   * Reverse lookup and delete mapping entry by chatSessionId.
   * Returns { channelId, userId } for the caller to send notifications; returns null if not found.
   */
  removeSessionByChatSessionId(chatSessionId: string): { channelId: string; userId: string } | null {
    for (const [key, entry] of this.sessionMap) {
      if (entry.chatSessionId === chatSessionId) {
        this.sessionMap.delete(key);
        this.schedulePersist();
        const sepIndex = key.indexOf(':');
        const channelId = key.substring(0, sepIndex);
        const userId = key.substring(sepIndex + 1);
        logger.info(`[AgentBridge] Removed session mapping for chatSessionId: ${chatSessionId}, key: ${key}`);
        return { channelId, userId };
      }
    }
    return null;
  }

  clearSessionsForChannel(channelId: string): void {
    for (const [key] of this.sessionMap) {
      if (key.startsWith(`${channelId}:`)) {
        this.sessionMap.delete(key);
      }
    }
    this.schedulePersist();
  }

  /**
   * Handle channel unbind: clear session mappings and demote all remote sessions for the channel.
   */
  async handleChannelUnbound(channelId: string): Promise<void> {
    const entries: Array<{ chatId: string; chatSessionId: string }> = [];
    for (const [key, entry] of this.sessionMap) {
      if (key.startsWith(`${channelId}:`)) {
        entries.push({ chatId: entry.chatId, chatSessionId: entry.chatSessionId });
      }
    }

    this.clearSessionsForChannel(channelId);

    for (const { chatId, chatSessionId } of entries) {
      await demoteSession(this.alias, chatId, chatSessionId);
    }

    if (entries.length > 0) {
      logger.info(`[AgentBridge] Unbound channel ${channelId}: cleared ${entries.length} session(s)`);
    }
  }

  getSessionMap(): Map<string, SessionEntry> {
    return this.sessionMap;
  }

  destroy(): void {
    this.persistScheduler?.cancel();
    this.persistScheduler = null;
    this.sessionMap.clear();
    this.sessionLocks.clear();
    this.taskQueue = [];
    this.activeTasks = 0;
  }

  // ── Internal ──

  private schedulePersist(): void {
    this.persistScheduler?.schedule();
  }

  private get bridgeContext(): BridgeContext {
    return {
      alias: this.alias,
      sessionMap: this.sessionMap,
      schedulePersist: () => this.schedulePersist(),
    };
  }

  private async processMessage(
    message: InboundMessage,
    sessionKey: string,
    abortSignal?: AbortSignal,
  ): Promise<OutboundMessage> {
    const trimmedText = message.text.trim().toLowerCase();

    // Intercept dot commands — respond immediately without consuming concurrency
    if (trimmedText === '.new') {
      return handleNewCommand(this.bridgeContext, sessionKey, message.conversationId);
    }

    if (trimmedText === '.switch' || trimmedText.startsWith('.switch ')) {
      return handleSwitchCommand(this.bridgeContext, trimmedText, message.channelId, sessionKey, message.conversationId);
    }

    if (trimmedText === '.agent' || trimmedText.startsWith('.agent ')) {
      return handleAgentCommand(this.bridgeContext, trimmedText, message.channelId, message.conversationId);
    }

    // .skill (list mode) — immediate response, no concurrency slot
    if (trimmedText === '.skill') {
      return handleSkillListCommand(this.bridgeContext, message.channelId, message.conversationId);
    }

    // .skill(...) or .skill N,... — parse skill selection, then continue to LLM
    if (
      trimmedText.startsWith('.skill(') ||
      trimmedText.startsWith('.skill (') ||
      trimmedText.startsWith('.skill（') ||
      /^\.skill\s+\d/.test(trimmedText)
    ) {
      const chatId = resolveChatId(this.alias, message.channelId);
      const skills = getAgentSkills(this.alias, chatId);

      if (skills.length === 0) {
        return { text: 'No skills configured for the current agent.', replyToConversationId: message.conversationId };
      }

      const result = parseSkillMessage(message.text.trim(), skills);
      if (!result.ok) {
        return { text: `⚠️ ${result.error}`, replyToConversationId: message.conversationId };
      }

      // Replace message text with skill-tagged version, continue normal flow
      message = { ...message, text: result.text };
    }

    // Concurrency control
    await this.acquireConcurrencySlot();

    // Start typing indicator — send immediately and repeat every 3s
    const channelManager = RemoteChannelManager.getInstance();
    channelManager.sendTyping(message.channelId);
    const typingInterval = setInterval(() => {
      channelManager.sendTyping(message.channelId);
    }, 3000);


    try {
      const chatSessionId = await this.getOrCreateSession(message.channelId, message.userId);

      const contentParts: UserContentPart[] = [];
      if (message.text.trim()) {
        contentParts.push({ type: 'text', text: message.text });
      }

      if (message.attachments?.length) {
        const parts = await downloadAndBuildParts(message.attachments, chatSessionId);
        contentParts.push(...parts);
      }

      if (contentParts.length === 0) {
        contentParts.push({ type: 'text', text: '' });
      }

      const userMessage: UserMessage = {
        id: `remote_${message.activityId}`,
        role: 'user',
        content: contentParts,
        timestamp: message.timestamp,
      };

      // Set eventSender so AgentChat can push streaming events to the renderer
      const instance = agentChatManager.getInstanceByChatSessionId(chatSessionId);
      if (instance) {
        const mainWindow = BrowserWindow.getAllWindows().find((w: any) => !w.isDestroyed());
        if (mainWindow) {
          instance.setEventSender(mainWindow.webContents);
        }
      }

      const result = await agentChatManager.streamMessage(chatSessionId, userMessage, { emitUserMessage: true, isRemoteSession: true });

      if (instance) {
        instance.setEventSender(null);
      }

      // Update lastActiveAt
      const entry = this.sessionMap.get(sessionKey);
      if (entry) {
        entry.lastActiveAt = Date.now();
        this.schedulePersist();
      }

      if (!result.success) {
        return {
          text: `⚠️ Agent processing failed: ${result.error || 'Unknown error'}`,
          replyToConversationId: message.conversationId,
        };
      }

      const replyText = this.extractAssistantReply(result.data);

      if (entry) {
        await updateRemoteSessionTitle(this.alias, entry.chatId, entry.chatSessionId, message.text);
      }

      return {
        text: replyText || '(Agent returned no content)',
        replyToConversationId: message.conversationId,
      };
    } finally {
      clearInterval(typingInterval);
      this.releaseConcurrencySlot();
    }
  }

  private async getOrCreateSession(channelId: string, userId: string): Promise<string> {
    const sessionKey = `${channelId}:${userId}`;
    const existing = this.sessionMap.get(sessionKey);

    if (existing) {
      if (Date.now() - existing.lastActiveAt > SESSION_TTL) {
        this.sessionMap.delete(sessionKey);
      } else {
        const instance = agentChatManager.getInstanceByChatSessionId(existing.chatSessionId);
        if (!instance) {
          await agentChatManager.switchToChatSession(existing.chatId, existing.chatSessionId);
        }
        return existing.chatSessionId;
      }
    }

    const chatId = resolveChatId(this.alias, channelId);
    const chatSessionId = agentChatManager.generateChatSessionId();
    await agentChatManager.switchToChatSession(chatId, chatSessionId);

    await registerRemoteSession(this.alias, chatId, chatSessionId, channelId);

    this.sessionMap.set(sessionKey, { chatId, chatSessionId, lastActiveAt: Date.now() });

    pruneSessionMap(this.sessionMap);
    this.schedulePersist();

    return chatSessionId;
  }

  private extractAssistantReply(messages?: Message[]): string {
    if (!messages || messages.length === 0) return '';

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return '';

    const texts: string[] = [];
    for (const part of lastAssistant.content) {
      if (part.type === 'text' && part.text) {
        texts.push(part.text);
      }
    }

    return texts.join('\n\n');
  }

  // ── Concurrency control ──

  private async acquireConcurrencySlot(): Promise<void> {
    if (this.activeTasks < MAX_CONCURRENCY) {
      this.activeTasks++;
      return;
    }
    return new Promise(resolve => {
      this.taskQueue.push({ resolve });
    });
  }

  private releaseConcurrencySlot(): void {
    this.activeTasks--;
    const next = this.taskQueue.shift();
    if (next) {
      this.activeTasks++;
      next.resolve();
    }
  }
}
