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
  isProfileV2,
  isBuiltinAgent,
} from './types/profile';

const logger = createConsoleLogger();

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

/**
 * Get the archived_agents.json file path for a profile.
 */
export function getArchivedAgentsFilePath(ctx: ArchiveContext, alias: string): string {
  const profileDir = ctx.getProfileDirectoryPath(alias);
  const archiveDir = path.join(profileDir, 'archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
  return path.join(archiveDir, 'archived_agents.json');
}

/**
 * Read the archived agents list from file.
 */
export function readArchivedAgents(ctx: ArchiveContext, alias: string): any[] {
  try {
    const filePath = getArchivedAgentsFilePath(ctx, alias);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    return data.archived_agents || [];
  } catch (error) {
    logger.error('[ProfileCacheManager] Failed to read archived agents', 'readArchivedAgents', {
      alias,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Write the archived agents list to file.
 */
export function writeArchivedAgents(ctx: ArchiveContext, alias: string, archivedAgents: any[]): boolean {
  try {
    const filePath = getArchivedAgentsFilePath(ctx, alias);
    const data = { archived_agents: archivedAgents };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    logger.error('[ProfileCacheManager] Failed to write archived agents', 'writeArchivedAgents', {
      alias,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Archive a chat agent - move from profile.json chats[] to archived_agents.json.
 * Does NOT delete workspace or chat sessions (preserved for potential restore).
 */
export async function archiveChatConfig(ctx: ArchiveContext, alias: string, chatId: string): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (chatIndex < 0) {
      logger.warn('[ProfileCacheManager] Chat not found for archiving', 'archiveChatConfig', { alias, chatId });
      return false;
    }

    const chatToArchive = profile.chats[chatIndex];

    if (isBuiltinAgent(chatToArchive.agent?.name)) {
      logger.warn('[ProfileCacheManager] Cannot archive built-in agent', 'archiveChatConfig', {
        alias, chatId, agentName: chatToArchive.agent?.name,
      });
      return false;
    }

    if (profile.primaryAgent === chatToArchive.agent?.name) {
      logger.warn('[ProfileCacheManager] Cannot archive primary agent', 'archiveChatConfig', {
        alias, chatId, agentName: chatToArchive.agent?.name,
      });
      return false;
    }

    const archivedEntry = {
      archived_at: new Date().toISOString(),
      chat_id: chatToArchive.chat_id,
      chat_type: chatToArchive.chat_type || 'single_agent',
      agent: chatToArchive.agent ? { ...chatToArchive.agent } : undefined,
    };

    const archivedAgents = readArchivedAgents(ctx, alias);
    archivedAgents.push(archivedEntry);

    const writeSuccess = writeArchivedAgents(ctx, alias, archivedAgents);
    if (!writeSuccess) {
      logger.error('[ProfileCacheManager] Failed to write archived agents file', 'archiveChatConfig', { alias, chatId });
      return false;
    }

    profile.chats.splice(chatIndex, 1);
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) return false;

    logger.info('[ProfileCacheManager] Chat archived successfully', 'archiveChatConfig', {
      alias, chatId, agentName: chatToArchive.agent?.name,
    });

    return true;
  } catch (error) {
    logger.error('[ProfileCacheManager] Exception in archiveChatConfig', 'archiveChatConfig', {
      alias, chatId,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Unarchive (restore) a chat agent - move from archived_agents.json back to profile.json chats[].
 */
export async function unarchiveChatConfig(ctx: ArchiveContext, alias: string, chatId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const archivedAgents = readArchivedAgents(ctx, alias);

    const archivedIndex = archivedAgents.findIndex((entry: any) => entry.chat_id === chatId);
    if (archivedIndex < 0) {
      logger.warn('[ProfileCacheManager] Archived chat not found', 'unarchiveChatConfig', { alias, chatId });
      return { success: false, error: 'Archived agent not found' };
    }

    const archivedEntry = archivedAgents[archivedIndex];

    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return { success: false, error: 'Profile not found' };
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return { success: false, error: 'Invalid profile format' };

    const existingIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (existingIndex >= 0) {
      logger.warn('[ProfileCacheManager] Chat already exists in profile', 'unarchiveChatConfig', { alias, chatId });
      archivedAgents.splice(archivedIndex, 1);
      writeArchivedAgents(ctx, alias, archivedAgents);
      return { success: true };
    }

    const archivedAgentName = archivedEntry.agent?.name;
    if (archivedAgentName) {
      const nameConflict = profile.chats.some(
        chat => chat.agent?.name?.toLowerCase() === archivedAgentName.toLowerCase()
      );
      if (nameConflict) {
        logger.warn('[ProfileCacheManager] Agent name conflict during restore', 'unarchiveChatConfig', {
          alias, chatId, agentName: archivedAgentName,
        });
        return { success: false, error: `An agent named "${archivedAgentName}" already exists. Please rename or delete the existing agent first.` };
      }
    }

    const restoredChat: ChatConfig = {
      chat_id: archivedEntry.chat_id,
      chat_type: archivedEntry.chat_type || 'single_agent',
      agent: archivedEntry.agent,
    };

    profile.chats.push(restoredChat);
    archivedAgents.splice(archivedIndex, 1);
    writeArchivedAgents(ctx, alias, archivedAgents);

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) return { success: false, error: 'Failed to write profile to file' };

    logger.info('[ProfileCacheManager] Chat unarchived successfully', 'unarchiveChatConfig', {
      alias, chatId, agentName: archivedEntry.agent?.name,
    });

    return { success: true };
  } catch (error) {
    logger.error('[ProfileCacheManager] Exception in unarchiveChatConfig', 'unarchiveChatConfig', {
      alias, chatId,
      error: error instanceof Error ? error.message : String(error)
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all archived agents for a profile.
 */
export function getArchivedAgents(ctx: ArchiveContext, alias: string): any[] {
  return readArchivedAgents(ctx, alias);
}
