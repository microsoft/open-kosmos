import { MessageHelper, type Message, type UserMessage } from '@shared/types/chatTypes';
import { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
import { agentChatIpc } from './agentChatIpc';
import { logger } from '../utilities/logger';

type ChatSessionSendCache = {
  getUserMessageSendState: (chatSessionId: string | null | undefined) => {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  };
  addUserMessage: (chatSessionId: string, userMessage: Message) => void;
  removeMessage: (chatSessionId: string, messageId: string) => void;
  setErrorMessage: (chatSessionId: string, errorMessage: string) => void;
};

export async function sendUserMessageOptimistically<T>(options: {
  chatSessionId: string | null | undefined;
  userMessage: Message;
  cacheManager: ChatSessionSendCache;
  send: () => Promise<T>;
}): Promise<T> {
  const { chatSessionId, userMessage, cacheManager, send } = options;
  if (!userMessage.id) {
    throw new Error('Optimistic user messages must have a stable message id.');
  }
  const sendState = cacheManager.getUserMessageSendState(chatSessionId);

  if (!chatSessionId || !sendState.canSend) {
    if (chatSessionId) {
      cacheManager.setErrorMessage(chatSessionId, sendState.error);
    }
    throw new Error(sendState.error);
  }

  cacheManager.addUserMessage(chatSessionId, userMessage);

  try {
    return await send();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Only roll back the optimistic user message if it was never persisted by the backend.
    // Pre-persistence rejections are returned by agentChatManager.streamMessage before
    // addMessageToSession runs — they match known error patterns below.
    // Post-persistence failures (API errors after addMessageToSession) should keep the message
    // in the cache — it already exists on disk and will reappear on session switch anyway.
    const isPrePersistenceRejection =
      /chat status is/i.test(errorMessage) ||
      /No agent instance found/i.test(errorMessage);
    if (isPrePersistenceRejection) {
      cacheManager.removeMessage(chatSessionId, userMessage.id);
    }

    cacheManager.setErrorMessage(chatSessionId, errorMessage);
    throw error;
  }
}

export async function sendUserMessage(message: UserMessage) {
  try {
    logger.debug('[SendUserMessage] 📤 Sending message...');
    await sendUserMessageOptimistically({
      chatSessionId: agentChatSessionCacheManager.getCurrentChatSessionId(),
      userMessage: message,
      cacheManager: agentChatSessionCacheManager,
      send: () => agentChatIpc.streamMessage(message, {
        onAssistantMessage: (msg: any) => {
          logger.debug('[SendUserMessage] 📨 Assistant message:', msg.id);
        },
        onToolUse: (toolName: string) => {
          logger.debug('[SendUserMessage] 🔧 Tool used:', toolName);
        },
        onToolResult: (toolMessage: any) => {
          logger.debug('[SendUserMessage] 📦 Tool result received:', toolMessage.id);
        },
      }),
    });
    logger.debug('[SendUserMessage] ✅ Message sent successfully');
  } catch (error) {
    logger.error('[SendUserMessage] ❌ Error sending message:', error);
  }
}

export async function sendUserPrompt(prompt: string) {
  return sendUserMessage(MessageHelper.createTextMessage(prompt, 'user'));
}
