import { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[StartNewChatFor]');

export interface SayHiMessageConfig {
  markdownContent: string;
  initialDelay?: number;
  retryDelay?: number;
  maxRetries?: number;
}

function applySayHiMessageWhenReady(
  chatSessionId: string,
  sayHiMessageConfig?: SayHiMessageConfig,
): void {
  const markdownContent = sayHiMessageConfig?.markdownContent?.trim();
  if (!markdownContent) return;

  const maxRetries = sayHiMessageConfig?.maxRetries ?? 10;
  const retryDelay = sayHiMessageConfig?.retryDelay ?? 100;
  const initialDelay = sayHiMessageConfig?.initialDelay ?? 300;
  let retries = 0;

  const setSayHiWithRetry = (): void => {
    const cache = agentChatSessionCacheManager.getChatSessionCache(chatSessionId);
    if (!cache) {
      if (retries < maxRetries) {
        retries++;
        logger.debug(
          `[startNewChatFor] Say hi cache not ready, retry ${retries}/${maxRetries}`,
          chatSessionId,
        );
        setTimeout(setSayHiWithRetry, retryDelay);
      } else {
        logger.error(
          '[startNewChatFor] Say hi cache not found after max retries:',
          chatSessionId,
        );
      }
      return;
    }

    agentChatSessionCacheManager.setAssistantSayHiMessage(
      chatSessionId,
      markdownContent,
    );
    logger.debug('[startNewChatFor] ✅ Say hi message set:', chatSessionId);
  };

  setTimeout(setSayHiWithRetry, initialDelay);
}

export async function startNewChatFor(
  chatId: string,
  sayHiMessageConfig?: SayHiMessageConfig,
): Promise<{ success: boolean; chatSessionId?: string; error?: string }> {
  if (!window.electronAPI?.agentChat?.startNewChatFor) {
    return { success: false, error: 'startNewChatFor API not available' };
  }

  const result = await window.electronAPI.agentChat.startNewChatFor(chatId, {
    sayHiMessageConfig,
  });

  if (result?.success && result.chatSessionId) {
    applySayHiMessageWhenReady(result.chatSessionId, sayHiMessageConfig);
  }

  return result;
}
