import { createLogger } from '../../unifiedLogger';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { chatSessionStore } from '../../chat/chatSessionStore';
import { AgentChatManager } from '../../chat/agentChatManager';
import type { ProfileV2 } from '../../userDataADO/types/profile';
import { isBuiltinAgent } from '../../userDataADO/types/profile';
import { BRAND_NAME } from '../../../../shared/constants/branding';
import type { SessionEntry } from './types';

const logger = createLogger();

/**
 * Demote a remote session to a local session (clear source).
 */
export async function demoteSession(alias: string, chatId: string, chatSessionId: string): Promise<void> {
  try {
    const updated = await chatSessionStore.patchMetadata(alias, chatId, chatSessionId, {
      source: null,
      last_updated: new Date().toISOString(),
    });
    if (!updated) {
      logger.warn(`[AgentBridge] Cannot demote session: session not found for ${chatSessionId}`);
      return;
    }

    await profileCacheManager.syncStarredChatSessionIndex(alias, chatId, updated.metadata, { notifyRenderer: true });

    logger.info(`[AgentBridge] Demoted remote session to local: ${chatSessionId}`);
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to demote session (non-fatal): ${String(err)}`);
  }
}

/**
 * Scan all remote sessions on startup, demoting those not in sessionMap to local.
 */
export async function demoteOrphanedSessions(alias: string, sessionMap: Map<string, SessionEntry>): Promise<void> {
  try {
    const profile = profileCacheManager.getCachedProfile(alias) as ProfileV2 | undefined;
    if (!profile?.chats?.length) return;

    const activeSessionIds = new Set<string>();
    for (const entry of sessionMap.values()) {
      activeSessionIds.add(entry.chatSessionId);
    }

    let demotedCount = 0;

    for (const chat of profile.chats) {
      const allSessions = await chatSessionStore.getAllSessions(alias, chat.chat_id);
      for (const session of allSessions) {
        if (session.source?.type === 'remote' && !activeSessionIds.has(session.chatSession_id)) {
          await demoteSession(alias, chat.chat_id, session.chatSession_id);
          demotedCount++;
        }
      }
    }

    if (demotedCount > 0) {
      logger.info(`[AgentBridge] Demoted ${demotedCount} orphaned remote session(s) on startup`);
    }
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to demote orphaned sessions (non-fatal): ${String(err)}`);
  }
}

/**
 * Register a new remote session with ProfileCacheManager so it appears in the frontend session list.
 */
export async function registerRemoteSession(
  alias: string,
  chatId: string,
  chatSessionId: string,
  channelId: string,
): Promise<void> {
  try {
    const now = new Date().toISOString();

    const chatSession = {
      chatSession_id: chatSessionId,
      last_updated: now,
      title: '[Remote] New conversation',
      source: { type: 'remote' as const, channel: channelId },
    };

    const chatSessionFile = {
      chatSession_id: chatSessionId,
      last_updated: now,
      title: chatSession.title,
      chat_history: [],
      context_history: [],
    };

    await chatSessionStore.createSession(alias, chatId, chatSession, chatSessionFile, { autoSelect: false });
    await profileCacheManager.forceNotifyProfileDataManager(alias);
    logger.info(`[AgentBridge] Registered remote session: ${chatSessionId} for chat: ${chatId}`);
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to register remote session (non-fatal): ${String(err)}`);
  }
}

/**
 * Mark a session as remote (set source field).
 */
export async function markSessionAsRemote(
  alias: string,
  chatId: string,
  chatSessionId: string,
  channelId: string,
): Promise<void> {
  const updated = await chatSessionStore.patchMetadata(alias, chatId, chatSessionId, {
    source: { type: 'remote' as const, channel: channelId },
    last_updated: new Date().toISOString(),
  });

  if (updated) {
    await profileCacheManager.syncStarredChatSessionIndex(alias, chatId, updated.metadata, { notifyRenderer: true });
  }
}

/**
 * Update the title of a remote session (only if still default).
 */
export async function updateRemoteSessionTitle(
  alias: string,
  chatId: string,
  chatSessionId: string,
  messageText: string,
): Promise<void> {
  try {
    const sessionFile = await chatSessionStore.ensureLoaded(alias, chatId, chatSessionId);
    const currentTitle = sessionFile?.file.title || '';

    if (!currentTitle.startsWith('[Remote] New conversation')) return;

    const preview = messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText;
    const newTitle = `[Remote] ${preview}`;
    const renamed = await chatSessionStore.renameSession(alias, chatId, chatSessionId, newTitle);
    if (renamed) {
      AgentChatManager.getInstance().updateSessionTitle(chatSessionId, newTitle);
      await profileCacheManager.syncStarredChatSessionIndex(alias, chatId, renamed.metadata, { notifyRenderer: true });
      logger.info(`[AgentBridge] Updated remote session title: ${chatSessionId} -> ${newTitle}`);
    }
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to update remote session title (non-fatal): ${String(err)}`);
  }
}

/**
 * Check if a chat is appropriate for routing (all chats are valid for kosmos).
 */
function isChatBrandAppropriate(_chat: { agent?: { name?: string } }): boolean {
  return true;
}

/**
 * Resolve the chatId for a given channelId from the user's profile.
 */
export function resolveChatId(alias: string, channelId: string): string {
  try {
    const profile = profileCacheManager.getCachedProfile(alias) as ProfileV2 | undefined;
    if (profile?.remoteChannels) {
      const channelConfig = (profile.remoteChannels as any)[channelId];
      if (channelConfig?.boundChatId) {
        // Validate that the bound chat is appropriate for the current brand
        const boundChat = profile.chats?.find((c) => c.chat_id === channelConfig.boundChatId);
        if (boundChat && isChatBrandAppropriate(boundChat)) {
          return channelConfig.boundChatId;
        }
        // boundChatId points to a brand-inappropriate agent — fall through to default
      }
    }
    if (profile?.chats?.length) {
      // Pick the first chat with a brand-appropriate built-in agent
      const brandChat = profile.chats.find((chat) => {
        const name = chat.agent?.name;
        if (!name) return false;
        if (!isChatBrandAppropriate(chat)) return false;
        return isBuiltinAgent(name, BRAND_NAME);
      });
      return (brandChat || profile.chats[0]).chat_id;
    }
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to resolve chatId: ${String(err)}`);
  }
  return 'default';
}
