/**
 * AgentChatPushReceiver — handles incoming push streams from external agents.
 *
 * Manages push state (message ID, accumulated text, timeout) and delegates
 * to AgentChat for status changes, streaming chunk emission, and persistence.
 */
import { Message, MessageHelper, type TextContentPart } from '@shared/types/chatTypes';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

const PUSH_TIMEOUT_MS = 120_000; // 2 minutes

export interface PushReceiverHost {
  chatId: string;
  getChatSessionId(): string;
  setChatStatus(status: 'sending_response' | 'idle'): void;
  getChatStatus(): string;
  emitStreamingChunk(chunk: StreamingChunk): void;
  addMessageToSession(msg: Message): Promise<void>;
}

export class AgentChatPushReceiver {
  private pushMsgId: string | null = null;
  private pushAccumulated: string = '';
  private pushTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: PushReceiverHost) {}

  handlePushChunk(text: string, msgId?: string): void {
    if (!this.pushMsgId) {
      this.pushMsgId = msgId || `msg_push_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      this.pushAccumulated = '';
      this.host.setChatStatus('sending_response');
    }
    this.pushAccumulated += text;

    this.startOrResetPushTimeout();

    this.host.emitStreamingChunk({
      chunkId: `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      messageId: this.pushMsgId,
      chatId: this.host.chatId,
      chatSessionId: this.host.getChatSessionId(),
      timestamp: Date.now(),
      type: 'content',
      contentDelta: { text },
    });
  }

  async handlePushComplete(skipPersistence = false): Promise<void> {
    if (this.pushTimeoutTimer) {
      clearTimeout(this.pushTimeoutTimer);
      this.pushTimeoutTimer = null;
    }

    if (!this.pushMsgId) {
      this.pushAccumulated = '';
      if (this.host.getChatStatus() === 'sending_response') {
        this.host.setChatStatus('idle');
      }
      return;
    }

    const msgId = this.pushMsgId;
    const text = this.pushAccumulated;
    const chatSessionId = this.host.getChatSessionId();

    // Reset push state before async work
    this.pushMsgId = null;
    this.pushAccumulated = '';

    // Persist (unless caller owns persistence, e.g. ExternalAgentService)
    if (!skipPersistence) {
      const assistantMsg = MessageHelper.createTextMessage(text, 'assistant', msgId);
      try {
        await this.host.addMessageToSession(assistantMsg);
      } catch (err) {
        logger.error('[AgentChat] Failed to persist push message', 'handlePushComplete', { chatId: this.host.chatId, msgId, error: String(err) });
      }
    }

    // Always emit complete chunk and reset status, even if persistence failed
    this.host.emitStreamingChunk({
      chunkId: `chunk_${Date.now()}_complete`,
      messageId: msgId,
      chatId: this.host.chatId,
      chatSessionId,
      timestamp: Date.now(),
      type: 'complete',
      complete: { messageId: msgId, hasToolCalls: false },
    });

    this.host.setChatStatus('idle');
  }

  cancelPush(): void {
    if (this.pushTimeoutTimer) {
      clearTimeout(this.pushTimeoutTimer);
      this.pushTimeoutTimer = null;
    }
    const hadPush = !!this.pushMsgId;
    this.pushMsgId = null;
    this.pushAccumulated = '';
    if (hadPush) {
      this.host.setChatStatus('idle');
    }
  }

  startOrResetPushTimeout(): void {
    if (this.pushTimeoutTimer) {
      clearTimeout(this.pushTimeoutTimer);
    }
    this.pushTimeoutTimer = setTimeout(() => {
      if (this.pushMsgId) {
        logger.warn('[AgentChat] Push stream timed out, auto-completing', 'startOrResetPushTimeout', {
          chatId: this.host.chatId, msgId: this.pushMsgId, accumulatedLength: this.pushAccumulated.length,
        });
        this.handlePushComplete().catch(() => {});
      } else {
        // Bot never responded — no push chunk arrived within timeout
        logger.warn('[AgentChat] Push timeout: bot never responded', 'startOrResetPushTimeout', {
          chatId: this.host.chatId,
        });
        const timeoutMsg = MessageHelper.createTextMessage(
          '⚠️ External agent did not respond in time. Please try again.', 'system'
        );
        this.host.addMessageToSession(timeoutMsg).catch(() => {});
        this.emitFullMessage(timeoutMsg);
        this.host.setChatStatus('idle');
      }
    }, PUSH_TIMEOUT_MS);
  }

  destroy(): void {
    if (this.pushTimeoutTimer) {
      clearTimeout(this.pushTimeoutTimer);
      this.pushTimeoutTimer = null;
    }
    this.pushMsgId = null;
    this.pushAccumulated = '';
  }

  /** Emit content + complete streaming chunks for a fully-formed message */
  private emitFullMessage(msg: Message): void {
    const msgId = msg.id || `msg_${Date.now()}`;
    const text = msg.content?.[0]?.type === 'text' ? (msg.content[0] as TextContentPart).text : '';
    this.host.emitStreamingChunk({
      chunkId: `chunk_${Date.now()}_content`,
      messageId: msgId,
      chatId: this.host.chatId,
      chatSessionId: this.host.getChatSessionId(),
      timestamp: Date.now(),
      type: 'content',
      contentDelta: { text },
    });
    this.host.emitStreamingChunk({
      chunkId: `chunk_${Date.now()}_complete`,
      messageId: msgId,
      chatId: this.host.chatId,
      chatSessionId: this.host.getChatSessionId(),
      timestamp: Date.now(),
      type: 'complete',
      complete: { messageId: msgId, hasToolCalls: false },
    });
  }
}
