import { createLogger } from '../unifiedLogger';
import { AgentBridge } from './agentBridge';
import { BRAND_NAME } from '../../../shared/constants/branding';
import { credentialStore } from './credentialStore';
import type {
  RemoteChannelPlugin,
  ChannelStatusInfo,
  ChannelStatus,
  InboundMessage,
  GatewayContext,
} from './types';

const logger = createLogger();

const PROCESSED_IDS_LIMIT = 1000;

/**
 * RemoteChannelManager — Remote channel manager (singleton)
 *
 * Responsibilities:
 * - Manage registered RemoteChannelPlugins
 * - Drive channel lifecycle state machine (start / stop / restart)
 * - Message orchestration: inbound message → idempotent dedup → AgentBridge → chunking → outbound
 * - Notify external consumers (IPC layer) of status changes via callbacks
 */
export class RemoteChannelManager {
  private static instance: RemoteChannelManager;

  private alias: string = '';
  private plugins: Map<string, RemoteChannelPlugin> = new Map();
  private statusMap: Map<string, ChannelStatusInfo> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private processedActivityIds: Map<string, number> = new Map();

  private statusChangeListener: ((info: ChannelStatusInfo) => void) | null = null;
  private bindingChangeListener: ((info: { channelId: string; bound: boolean }) => void) | null = null;

  private constructor() {}

  static getInstance(): RemoteChannelManager {
    if (!RemoteChannelManager.instance) {
      RemoteChannelManager.instance = new RemoteChannelManager();
    }
    return RemoteChannelManager.instance;
  }

  async initialize(alias: string): Promise<void> {
    this.alias = alias;
    await AgentBridge.getInstance().initialize(alias);
    logger.info(`[RemoteChannelManager] Initialized for alias: ${alias}`);
  }

  getAlias(): string {
    return this.alias;
  }

  registerPlugin(plugin: RemoteChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
    this.statusMap.set(plugin.id, { channelId: plugin.id, status: 'stopped' });
    logger.info(`[RemoteChannelManager] Plugin registered: ${plugin.id}`);
  }

  async startChannel(channelId: string): Promise<void> {
    const plugin = this.plugins.get(channelId);
    if (!plugin) {
      logger.warn(`[RemoteChannelManager] Plugin not found: ${channelId}`);
      return;
    }

    const currentStatus = this.statusMap.get(channelId);
    if (currentStatus && currentStatus.status !== 'stopped' && currentStatus.status !== 'error') {
      logger.info(`[RemoteChannelManager] Channel ${channelId} already ${currentStatus.status}, skipping start`);
      return;
    }

    this.updateStatus(channelId, 'starting');

    const abortController = new AbortController();
    this.abortControllers.set(channelId, abortController);

    const ctx: GatewayContext = {
      alias: this.alias,
      abortSignal: abortController.signal,
      onInboundMessage: (message: InboundMessage) => {
        this.handleInboundMessage(channelId, message).catch(err => {
          logger.warn(`[RemoteChannelManager] Error handling inbound message:`, String(err));
        });
      },
      onStatusChange: (status: ChannelStatus, error?: string) => {
        this.updateStatus(channelId, status, error);
      },
      onUnbound: (reason) => {
        logger.info(`[RemoteChannelManager] Unbound by server for ${channelId}: ${reason}`);
        AgentBridge.getInstance().handleChannelUnbound(channelId).catch(err => {
          logger.warn(`[RemoteChannelManager] Failed to clean up sessions on unbind (non-fatal):`, String(err));
        });
        this.sendBindingChanged(channelId, false);
      },
    };

    try {
      await plugin.gateway.start(ctx);
    } catch (err) {
      logger.error(`[RemoteChannelManager] Failed to start channel ${channelId}:`, String(err));
      this.updateStatus(channelId, 'error', String(err));
    }
  }

  async stopChannel(channelId: string): Promise<void> {
    const plugin = this.plugins.get(channelId);
    if (!plugin) return;

    const abortController = this.abortControllers.get(channelId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(channelId);
    }

    try {
      await plugin.gateway.stop();
    } catch (err) {
      logger.warn(`[RemoteChannelManager] Error stopping channel ${channelId}:`, String(err));
    }

    this.updateStatus(channelId, 'stopped');
  }

  async restartChannel(channelId: string): Promise<void> {
    await this.stopChannel(channelId);
    await this.startChannel(channelId);
  }

  getChannelStatus(channelId: string): ChannelStatusInfo | undefined {
    return this.statusMap.get(channelId);
  }

  getAllChannelStatus(): ChannelStatusInfo[] {
    return Array.from(this.statusMap.values());
  }

  setStatusChangeListener(listener: (info: ChannelStatusInfo) => void): void {
    this.statusChangeListener = listener;
  }

  setBindingChangeListener(listener: (info: { channelId: string; bound: boolean }) => void): void {
    this.bindingChangeListener = listener;
  }

  async bind(channelId: string, code: string): Promise<{ userId: string }> {
    const plugin = this.plugins.get(channelId);
    if (!plugin || !plugin.gateway.bind) {
      throw new Error(`Channel ${channelId} does not support binding`);
    }

    const result = await plugin.gateway.bind(code);
    logger.info(`[RemoteChannelManager] Bind result for ${channelId}: ${JSON.stringify(result)}`);

    if (!result.success || !result.userId) {
      throw new Error(result.error || 'Bind failed');
    }

    this.sendBindingChanged(channelId, true);
    return { userId: result.userId };
  }

  async unbind(channelId: string): Promise<void> {
    const plugin = this.plugins.get(channelId);
    if (!plugin || !plugin.gateway.unbind) {
      throw new Error(`Channel ${channelId} does not support unbinding`);
    }
    await plugin.gateway.unbind();
    // Clean up AgentBridge session mappings (same as server-initiated unbind)
    await AgentBridge.getInstance().handleChannelUnbound(channelId);
    this.sendBindingChanged(channelId, false);
  }

  /**
   * When a session is deleted, clean up AgentBridge mappings and proactively notify the remote user.
   * Non-fatal: exceptions are only warned, not thrown.
   */
  async notifySessionDeleted(chatSessionId: string): Promise<void> {
    try {
      const result = AgentBridge.getInstance().removeSessionByChatSessionId(chatSessionId);
      if (!result) return;

      const { channelId, userId } = result;
      const plugin = this.plugins.get(channelId);
      if (plugin?.outbound.sendProactive) {
        await plugin.outbound.sendProactive(
          userId,
          `⚠️ Your current conversation has been removed from ${BRAND_NAME}. Your next message will automatically start a new conversation.`,
        );
        logger.info(`[RemoteChannelManager] Notified user ${userId} about deleted session ${chatSessionId}`);
      }
    } catch (err) {
      logger.warn(`[RemoteChannelManager] Failed to notify session deletion (non-fatal):`, String(err));
    }
  }

  /**
   * Send typing indicator to the remote channel.
   * Non-fatal: silently ignores errors.
   */
  sendTyping(channelId: string): void {
    const plugin = this.plugins.get(channelId);
    if (plugin?.outbound.sendTyping) {
      plugin.outbound.sendTyping().catch(() => {});
    }
  }

  /**
   * Proactively notify the bound user on every running channel for the given alias.
   * Non-fatal: per-channel failures are logged but never thrown.
   * Used by background producers (e.g. SchedulerManager) that need to push status to Teams etc.
   */
  async notifyBoundUser(alias: string, text: string): Promise<void> {
    if (!alias || !text) return;
    const tasks = Array.from(this.plugins.entries()).map(async ([channelId, plugin]) => {
      const status = this.statusMap.get(channelId);
      if (!status || status.status !== 'running') return;
      if (!plugin.outbound.sendProactive) return;

      const userId = await credentialStore.getCredential(alias, channelId, 'boundUserId');
      if (!userId) return;

      await plugin.outbound.sendProactive(userId, text);
      logger.info(`[RemoteChannelManager] notifyBoundUser sent on ${channelId} to ${userId}`);
    });

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn('[RemoteChannelManager] notifyBoundUser failed (non-fatal):', String(r.reason));
      }
    }
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.plugins.keys()).map(id => this.stopChannel(id));
    await Promise.allSettled(stopPromises);
  }

  destroy(): void {
    this.stopAll().catch(() => {});
    this.plugins.clear();
    this.statusMap.clear();
    this.abortControllers.clear();
    this.processedActivityIds.clear();
    this.statusChangeListener = null;
    AgentBridge.getInstance().destroy();
  }

  // ── Internal methods ──

  private async handleInboundMessage(channelId: string, message: InboundMessage): Promise<void> {
    // 1. Idempotency check
    if (this.processedActivityIds.has(message.activityId)) {
      logger.info(`[RemoteChannelManager] Duplicate activityId skipped: ${message.activityId}`);
      return;
    }
    this.processedActivityIds.set(message.activityId, Date.now());
    this.pruneProcessedIds();

    const plugin = this.plugins.get(channelId);
    if (!plugin) return;

    try {
      // 2. AgentBridge processing
      const outbound = await AgentBridge.getInstance().handleInboundMessage(message);

      // 3. Replace unsupported content (e.g. Mermaid diagrams) for remote channels
      const processedText = this.replaceUnsupportedContent(outbound.text);

      // 4. Split by textChunkLimit
      const chunks = this.splitText(processedText, plugin.outbound.textChunkLimit);

      // 5. Send results
      for (const chunk of chunks) {
        await plugin.outbound.sendText({
          text: chunk,
          replyToConversationId: outbound.replyToConversationId,
          metadata: outbound.metadata,
        });
      }
    } catch (err) {
      logger.error(`[RemoteChannelManager] Error processing message from ${channelId}:`, String(err));
      // Try to send error message to user
      try {
        await plugin.outbound.sendText({
          text: `⚠️ An error occurred while processing the message. Please try again later.`,
          replyToConversationId: message.conversationId,
        });
      } catch {
        // Silently ignore send failure
      }
    }
  }

  private updateStatus(channelId: string, status: ChannelStatus, error?: string): void {
    const info: ChannelStatusInfo = {
      channelId,
      status,
      error,
      startedAt: status === 'running' ? Date.now() : this.statusMap.get(channelId)?.startedAt,
    };
    this.statusMap.set(channelId, info);
    if (this.statusChangeListener) {
      this.statusChangeListener(info);
    }
  }

  private sendBindingChanged(channelId: string, bound: boolean): void {
    if (this.bindingChangeListener) {
      this.bindingChangeListener({ channelId, bound });
    }
  }

  private replaceUnsupportedContent(text: string): string {
    return text.replace(
      /```mermaid[\s\S]*?```/g,
      `> ⚠️ This message contains a Mermaid diagram that cannot be rendered in Teams. Please return to ${BRAND_NAME} to view it.`,
    );
  }

  private splitText(text: string, limit: number): string[] {
    if (!text || text.length <= limit) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to split at the nearest newline
      let splitIndex = remaining.lastIndexOf('\n', limit);
      if (splitIndex < 1) splitIndex = limit;
      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).replace(/^\n/, '');
    }
    return chunks;
  }

  private pruneProcessedIds(): void {
    if (this.processedActivityIds.size > PROCESSED_IDS_LIMIT) {
      const entries = Array.from(this.processedActivityIds.entries())
        .sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - PROCESSED_IDS_LIMIT);
      for (const [key] of toRemove) {
        this.processedActivityIds.delete(key);
      }
    }
  }
}
