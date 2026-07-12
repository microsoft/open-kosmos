/**
 * profileChatSessionOps.ts
 *
 * ChatSession save / delete / query operations.
 * All operations delegate to chatSessionStore as the single source of truth.
 *
 * <!-- Last verified: 2026-04-05 -->
 */

import { createConsoleLogger } from '../unifiedLogger';
import { ChatSession } from './types/profile';
import { ChatSessionFile } from './chatSessionFileOps';
import { chatSessionStore } from '../chat/chatSessionStore';

const logger = createConsoleLogger();

/**
 * Context required by ChatSession operations.
 */
export interface ChatSessionOpsContext {
  syncStarredChatSessionIndex: (
    alias: string,
    chatId: string,
    session: { chatSession_id: string; title: string; last_updated: string },
    options?: { notifyRenderer?: boolean },
  ) => Promise<boolean>;
  removeStarredChatSessionIndex: (
    alias: string,
    chatSessionId: string,
    options?: { notifyRenderer?: boolean },
  ) => Promise<boolean>;
  notifyProfileDataManager: (alias: string, immediate?: boolean) => Promise<void>;
}

export async function saveChatSession(
  ctx: ChatSessionOpsContext,
  alias: string,
  chatId: string,
  chatSessionFile: ChatSessionFile,
): Promise<boolean> {
  try {
    logger.info('[ProfileChatSessionOps] Saving ChatSession via store', 'saveChatSession', {
      alias, chatId, chatSessionId: chatSessionFile.chatSession_id,
    });

    const saved = await chatSessionStore.saveSession(
      alias,
      chatId,
      {
        chatSession_id: chatSessionFile.chatSession_id,
        last_updated: chatSessionFile.last_updated,
        title: chatSessionFile.title,
      } as ChatSession,
      chatSessionFile,
    );
    if (!saved) return false;

    await ctx.syncStarredChatSessionIndex(
      alias,
      chatId,
      {
        chatSession_id: chatSessionFile.chatSession_id,
        title: chatSessionFile.title,
        last_updated: chatSessionFile.last_updated,
      },
      { notifyRenderer: false },
    );

    await ctx.notifyProfileDataManager(alias, true);
    return true;
  } catch (error) {
    logger.error('[ProfileChatSessionOps] Exception in saveChatSession', 'saveChatSession', {
      alias, chatId, chatSessionId: chatSessionFile.chatSession_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function deleteChatSession(
  ctx: ChatSessionOpsContext,
  alias: string,
  chatId: string,
  chatSessionId: string,
): Promise<boolean> {
  try {
    logger.info('[ProfileChatSessionOps] Deleting ChatSession via store', 'deleteChatSession', {
      alias, chatId, chatSessionId,
    });

    const success = await chatSessionStore.deleteSession(alias, chatId, chatSessionId);
    if (!success) {
      logger.error('[ProfileChatSessionOps] Failed to delete ChatSession', 'deleteChatSession', {
        alias, chatId, chatSessionId,
      });
      return false;
    }

    await ctx.removeStarredChatSessionIndex(alias, chatSessionId, { notifyRenderer: false });
    await ctx.notifyProfileDataManager(alias, true);

    logger.info('[ProfileChatSessionOps] ChatSession deleted successfully', 'deleteChatSession', {
      alias, chatId, chatSessionId,
    });
    return true;
  } catch (error) {
    logger.error('[ProfileChatSessionOps] Exception in deleteChatSession', 'deleteChatSession', {
      alias, chatId, chatSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * @deprecated Use getChatSessionsAsync instead
 */
export function getChatSessions(alias: string, chatId: string): ChatSession[] {
  logger.warn('[ProfileChatSessionOps] getChatSessions is deprecated, use getChatSessionsAsync instead', 'getChatSessions', {
    alias, chatId,
  });
  return [];
}

export async function getChatSessionsAsync(
  alias: string,
  chatId: string,
): Promise<ChatSession[]> {
  try {
    const result = await chatSessionStore.getChatSessionsProjection(alias, chatId);
    return result.sessions;
  } catch (error) {
    logger.error('[ProfileChatSessionOps] Failed to get ChatSessions async', 'getChatSessionsAsync', {
      alias, chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function getChatSessionFile(
  alias: string,
  chatId: string,
  chatSessionId: string,
): Promise<ChatSessionFile | null> {
  try {
    return (await chatSessionStore.ensureLoaded(alias, chatId, chatSessionId))?.file || null;
  } catch (error) {
    logger.error('[ProfileChatSessionOps] Failed to get ChatSession file', 'getChatSessionFile', {
      alias, chatId, chatSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
