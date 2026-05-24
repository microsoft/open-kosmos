/**
 * External agent chat handler — fire-and-forget model.
 * Sends user message via WS and returns immediately.
 * Bot replies arrive asynchronously via push handler in ExternalAgentService.
 */
import { Message, MessageHelper, type TextContentPart } from '@shared/types/chatTypes';
import { useExternalAgentService } from '../../startup/lazy';
import { createLogger } from '../unifiedLogger';
import type { StreamingChunk } from '@shared/types/streamingTypes';

const logger = createLogger();

export interface ExternalAgentChatContext {
  chatId: string;
  chatSessionId: string;
  addMessageToSession: (message: Message) => Promise<void>;
  emitStreamingChunk: (chunk: StreamingChunk) => void;
  emitStatus: (status: 'sending' | 'idle') => void;
}

/**
 * Handle a user message for an External agent.
 * Fire-and-forget: persists user message, sends via WS, returns immediately.
 * Bot replies are handled asynchronously by ExternalAgentService push handler.
 */
export async function handleExternalAgentMessage(
  ctx: ExternalAgentChatContext,
  userMessage: Message,
): Promise<Message[]> {
  await ctx.addMessageToSession(userMessage);
  ctx.emitStatus('sending');

  const userText = userMessage.content?.map((c) => c.type === 'text' ? (c as TextContentPart).text : '').join('') || '';
  const { chatId, chatSessionId } = ctx;

  logger.info('[AgentChat] External agent: sending message via WS (fire-and-forget)', 'handleExternalAgentMessage', { chatId, chatSessionId, textLength: userText.length });

  const sent = useExternalAgentService(s => s.sendMessage(userText, chatId, chatSessionId));
  if (!sent) {
    const errorMsg = MessageHelper.createTextMessage(
      '⚠️ External agent is not connected. Please check the connection.', 'system'
    );
    await ctx.addMessageToSession(errorMsg);
    emitFullMessage(ctx, errorMsg, (errorMsg.content[0] as TextContentPart)?.text || '');
    ctx.emitStatus('idle');
    return [errorMsg];
  }

  // Fire-and-forget: message sent successfully, return immediately.
  // Do NOT emit 'idle' here — status stays as 'sending' until push arrives
  // and AgentChat.handlePushComplete() sets it back to idle.
  return [];
}

/** Emit content + complete streaming chunks for a fully-received message */
function emitFullMessage(ctx: ExternalAgentChatContext, msg: Message, text: string): void {
  const msgId = msg.id || `msg_${Date.now()}`;
  ctx.emitStreamingChunk({
    chunkId: `chunk_${Date.now()}_content`,
    messageId: msgId,
    chatId: ctx.chatId,
    chatSessionId: ctx.chatSessionId,
    timestamp: Date.now(),
    type: 'content',
    contentDelta: { text },
  });
  ctx.emitStreamingChunk({
    chunkId: `chunk_${Date.now()}_complete`,
    messageId: msgId,
    chatId: ctx.chatId,
    chatSessionId: ctx.chatSessionId,
    timestamp: Date.now(),
    type: 'complete',
    complete: { messageId: msgId, hasToolCalls: false },
  });
}
