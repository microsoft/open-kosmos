/**
 * Profile archive operations — archive/unarchive chat agents.
 * Extracted from ProfileCacheManager for modularity.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  ChatConfig,
  ArchivedChatEntry,
  StarredChatSessionIndexItem,
  isProfileV2,
  isBuiltinAgent,
} from './types/profile';
import { BRAND_NAME } from '@shared/constants/branding';
import { withProfileWriteLock, writeProfileThenCommitCache } from './profileEntityCrud';
import { findChatByPrimaryChat, getChatAgentIds, getChatPrimaryAgent, agentIdOf } from './agentAccessor';
import { persistNewChatAgents } from './agentExtraction';
import { readAgent } from './agentStoreManager';
import { getDefaultWorkspacePath } from './pathUtils';

const logger = createConsoleLogger();

/** Derive an archived entry's agent ids: explicit `agent_ids` win, else derive. */
function resolveArchivedEntryIds(entry: any): string[] {
  const explicit = Array.isArray(entry?.agent_ids)
    ? entry.agent_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (explicit.length > 0) {
    return explicit;
  }
  return entry?.agent?.name ? [agentIdOf(entry.agent)] : [];
}

/**
 * Context interface for archive operations.
 */
export interface ArchiveContext {
  cache: Map<string, ProfileV2>;
  getProfileDirectoryPath(alias: string): string;
  readProfileFromFile(alias: string): Promise<ProfileV2 | null>;
  writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean>;
  notifyProfileDataManager(alias: string, immediate?: boolean): Promise<void>;
}

/** Hydrate an archived entry's inline `agent` from the store via its agent_ids. */
function hydrateArchivedEntry(profileDir: string, entry: ArchivedChatEntry): ArchivedChatEntry & { agent?: unknown } {
  if (!Array.isArray(entry?.agent_ids)) {
    return entry;
  }
  const agent = entry.agent_ids.map((id: string) => readAgent(profileDir, id)).find(Boolean);
  return agent ? { ...entry, agent } : entry;
}

/**
 * Read the raw archive list from `profile.archived_chats` (the SSOT in
 * profile.json). Prefers the in-memory cache (authoritative once a profile is
 * loaded); falls back to a synchronous profile.json read for the uncached case.
 */
function readArchivedChatsFromProfile(ctx: ArchiveContext, alias: string): ArchivedChatEntry[] {
  const cached = ctx.cache.get(alias);
  if (cached) {
    return Array.isArray(cached.archived_chats) ? cached.archived_chats : [];
  }
  try {
    const profilePath = path.join(ctx.getProfileDirectoryPath(alias), 'profile.json');
    if (!fs.existsSync(profilePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    return Array.isArray(parsed?.archived_chats) ? parsed.archived_chats : [];
  } catch (error) {
    logger.error('[ProfileCacheManager] Failed to read archived chats', 'readArchivedAgents', {
      alias,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Read archived chat entries, each hydrated with its `agent` resolved from the
 * standalone store. The archive list is owned by `profile.archived_chats`
 * (profile.json); inline agents are no longer persisted, so callers that need
 * the agent for display get it resolved here.
 */
export function readArchivedAgents(ctx: ArchiveContext, alias: string): (ArchivedChatEntry & { agent?: unknown })[] {
  const profileDir = ctx.getProfileDirectoryPath(alias);
  return readArchivedChatsFromProfile(ctx, alias).map((e) => hydrateArchivedEntry(profileDir, e));
}

/**
 * Archive a chat agent - move it from `profile.chats[]` into
 * `profile.archived_chats[]` (the archive SSOT) in a single atomic profile write.
 * Does NOT delete workspace or chat sessions (preserved for potential restore).
 */
export async function archiveChatConfig(ctx: ArchiveContext, alias: string, chatId: string): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = ctx.cache.get(alias) ?? (await ctx.readProfileFromFile(alias)) ?? undefined;
      if (!profile || !isProfileV2(profile)) return false;

      const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (chatIndex < 0) {
        logger.warn('[ProfileCacheManager] Chat not found for archiving', 'archiveChatConfig', { alias, chatId });
        return false;
      }

      const chatToArchive = profile.chats[chatIndex];
      const primaryAgent = getChatPrimaryAgent(chatToArchive);

      if (isBuiltinAgent(primaryAgent?.name, BRAND_NAME)) {
        logger.warn('[ProfileCacheManager] Cannot archive built-in agent', 'archiveChatConfig', {
          alias, chatId, agentName: primaryAgent?.name,
        });
        return false;
      }

      const explicitPrimaryChat = findChatByPrimaryChat(profile.chats, profile.primaryChat);
      const effectivePrimaryChat = explicitPrimaryChat ?? profile.chats[0];
      if (effectivePrimaryChat?.chat_id === chatToArchive.chat_id) {
        logger.warn('[ProfileCacheManager] Cannot archive primary agent', 'archiveChatConfig', {
          alias, chatId, agentName: primaryAgent?.name,
        });
        return false;
      }

      if (profile.chats.length <= 1) {
        logger.warn('[ProfileCacheManager] Cannot archive the last active chat', 'archiveChatConfig', {
          alias, chatId, agentName: primaryAgent?.name,
        });
        return false;
      }

      const starredSessions = (profile['starred-chat-sessions'] || []).filter(
        (s: StarredChatSessionIndexItem) => s.chatId === chatId
      );

      // The archived entry stores agent_ids only (no inline agent), so the inline
      // facade is the LAST copy for a migrated/recovered chat whose earlier agent
      // store write failed (extractAgentsToStore swallows write failures, keeping
      // the agent inline via stripInlineChatAgentsForDisk). Persist the inline
      // agents into the store BEFORE dropping them; if any write fails, abort the
      // archive so the chat stays active with its inline fallback intact rather
      // than becoming an archived (and later restored) chat that can never hydrate.
      const profileDir = ctx.getProfileDirectoryPath(alias);
      const archiveWriteFailed: string[] = [];
      await persistNewChatAgents(profileDir, chatToArchive, archiveWriteFailed);
      if (archiveWriteFailed.length > 0) {
        logger.error('[ProfileCacheManager] Aborting archive: agent store write failed', 'archiveChatConfig', {
          alias, chatId, archiveWriteFailed,
        });
        return false;
      }

      const archivedAgentIds = getChatAgentIds(chatToArchive);
      if (archivedAgentIds.length === 0) {
        logger.warn('[ProfileCacheManager] Cannot archive chat without agent ids', 'archiveChatConfig', {
          alias, chatId, agentName: primaryAgent?.name,
        });
        return false;
      }

      // The persisted archived entry references agents by id only (no inline
      // agent) — symmetric with how active chats are stored.
      const archivedEntry: ArchivedChatEntry = {
        archived_at: new Date().toISOString(),
        chat_id: chatToArchive.chat_id,
        chat_type: chatToArchive.chat_type || 'single_agent',
        agent_ids: archivedAgentIds,
        ...(starredSessions.length > 0 && { starred_sessions: starredSessions }),
      };

      const existingArchived = Array.isArray(profile.archived_chats) ? profile.archived_chats : [];
      const nextProfile: ProfileV2 = {
        ...profile,
        chats: profile.chats.filter((_, index) => index !== chatIndex),
        archived_chats: [...existingArchived, archivedEntry],
        'starred-chat-sessions': (profile['starred-chat-sessions'] || []).filter(
          (s: StarredChatSessionIndexItem) => s.chatId !== chatId
        ),
      };
      const success = await writeProfileThenCommitCache(ctx, alias, profile, nextProfile);
      if (!success) {
        logger.error('[ProfileCacheManager] Failed to persist archived chat', 'archiveChatConfig', { alias, chatId });
        return false;
      }

      logger.info('[ProfileCacheManager] Chat archived successfully', 'archiveChatConfig', {
        alias, chatId, agentName: primaryAgent?.name,
      });

      return true;
    } catch (error) {
      logger.error('[ProfileCacheManager] Exception in archiveChatConfig', 'archiveChatConfig', {
        alias, chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  });
}

/**
 * Unarchive (restore) a chat - move it from `profile.archived_chats[]` back into
 * `profile.chats[]` in a single atomic profile write.
 */
export async function unarchiveChatConfig(ctx: ArchiveContext, alias: string, chatId: string): Promise<{ success: boolean; error?: string }> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = ctx.cache.get(alias) ?? (await ctx.readProfileFromFile(alias)) ?? undefined;
      if (!profile) return { success: false, error: 'Profile not found' };
      if (!isProfileV2(profile)) return { success: false, error: 'Invalid profile format' };

      const archivedChats = Array.isArray(profile.archived_chats) ? profile.archived_chats : [];
      const archivedIndex = archivedChats.findIndex((entry) => entry.chat_id === chatId);
      if (archivedIndex < 0) {
        logger.warn('[ProfileCacheManager] Archived chat not found', 'unarchiveChatConfig', { alias, chatId });
        return { success: false, error: 'Archived agent not found' };
      }

      const archivedEntry = archivedChats[archivedIndex];
      const nextArchivedChats = archivedChats.filter((_, index) => index !== archivedIndex);
      const restoredAgentIds = resolveArchivedEntryIds(archivedEntry);

      // Already present in chats[]: just drop the stale archived record.
      const existingIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (existingIndex >= 0) {
        logger.warn('[ProfileCacheManager] Chat already exists in profile', 'unarchiveChatConfig', { alias, chatId });
        const dedupProfile: ProfileV2 = { ...profile, archived_chats: nextArchivedChats };
        if (!(await writeProfileThenCommitCache(ctx, alias, profile, dedupProfile))) {
          return { success: false, error: 'Failed to write profile to file' };
        }
        return { success: true };
      }

      if (restoredAgentIds.length === 0) {
        logger.warn('[ProfileCacheManager] Cannot restore archived chat without agent ids', 'unarchiveChatConfig', { alias, chatId });
        return { success: false, error: 'Cannot restore archived chat without agent ids' };
      }
      const profileDir = ctx.getProfileDirectoryPath(alias);
      const missingAgentIds = restoredAgentIds.filter((id) => readAgent(profileDir, id) === null);
      if (missingAgentIds.length > 0) {
        logger.warn('[ProfileCacheManager] Cannot restore archived chat with missing agents', 'unarchiveChatConfig', {
          alias, chatId, missingAgentIds,
        });
        return { success: false, error: 'Cannot restore archived chat with missing agents' };
      }

      // Agents are shared by stable id: a single store entry can be bound to more
      // than one chat, so restoring a chat only re-adds its `chat_id -> agent_ids`
      // mapping. No agent-name conflict check is performed — a name collision (or a
      // genuinely shared agent) with an active chat is valid under the shared-agent
      // model and must not block restore.
      const restoredChat: ChatConfig = {
        chat_id: chatId,
        chat_type: archivedEntry.chat_type || 'single_agent',
        workspace: getDefaultWorkspacePath(alias, chatId),
        agent_ids: restoredAgentIds.length > 0 ? restoredAgentIds : undefined,
      };

      const restoredStarred: StarredChatSessionIndexItem[] = Array.isArray(archivedEntry.starred_sessions)
        ? archivedEntry.starred_sessions
        : [];
      const existingStarred: StarredChatSessionIndexItem[] = profile['starred-chat-sessions'] || [];

      const nextProfile: ProfileV2 = {
        ...profile,
        chats: [...profile.chats, restoredChat],
        archived_chats: nextArchivedChats,
        'starred-chat-sessions': restoredStarred.length > 0
          ? [...existingStarred, ...restoredStarred]
          : existingStarred,
      };
      const success = await writeProfileThenCommitCache(ctx, alias, profile, nextProfile);
      if (!success) {
        return { success: false, error: 'Failed to write profile to file' };
      }

      logger.info('[ProfileCacheManager] Chat unarchived successfully', 'unarchiveChatConfig', {
        alias, chatId, agentIds: restoredAgentIds,
      });

      return { success: true };
    } catch (error) {
      logger.error('[ProfileCacheManager] Exception in unarchiveChatConfig', 'unarchiveChatConfig', {
        alias, chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

/**
 * Get all archived chats for a profile (each hydrated with its agent from the
 * standalone store).
 */
export function getArchivedAgents(ctx: ArchiveContext, alias: string): (ArchivedChatEntry & { agent?: unknown })[] {
  return readArchivedAgents(ctx, alias);
}
