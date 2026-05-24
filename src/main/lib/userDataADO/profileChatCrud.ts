/**
 * profileChatCrud.ts
 *
 * ChatConfig, ChatAgent, and ChatSkillSnapshot CRUD operations.
 * Extracted from ProfileCacheManager for single-responsibility.
 *
 * <!-- Last verified: 2026-04-05 -->
 */

import { createConsoleLogger } from '../unifiedLogger';
import { quickStartImageCacheManager } from '../cache/quickStartImageCacheManager';
import {
  ProfileV2,
  ChatConfig,
  ChatAgent,
  ChatSkillSnapshot,
  DEFAULT_CHAT_AGENT,
  getAgentKnowledge,
  isProfileV2,
  isBuiltinAgent,
  withNormalizedAgentKnowledge,
} from './types/profile';
import {
  getDefaultAgentWorkspacePath,
  ensureWorkspaceExists,
  removeChatSessionsDirectory,
  removeDefaultWorkspaceDirectory,
} from './pathUtils';
import {
  normalizeAgentSkillNames,
  createDefaultChat,
} from './profileSanitizer';

const logger = createConsoleLogger();

/**
 * Context required by ChatConfig CRUD operations.
 * Injected by ProfileCacheManager to avoid circular dependencies.
 */
export interface ChatCrudContext {
  cache: Map<string, ProfileV2>;
  readProfileFromFile: (alias: string) => Promise<ProfileV2 | null>;
  writeProfileToFile: (alias: string, profile: ProfileV2) => Promise<boolean>;
  notifyProfileDataManager: (alias: string, immediate?: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// ChatConfig CRUD
// ---------------------------------------------------------------------------

export async function addChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatConfig: ChatConfig,
): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const existingIndex = profile.chats.findIndex(chat => chat.chat_id === chatConfig.chat_id);
    if (existingIndex >= 0) return false;

    // Auto-set default workspace path (agent-level)
    if (chatConfig.agent && (!chatConfig.agent.workspace || chatConfig.agent.workspace.trim() === '')) {
      const agentName = chatConfig.agent.name || 'default';
      const agentSource = chatConfig.agent.source || 'ON-DEVICE';
      chatConfig.agent.workspace = getDefaultAgentWorkspacePath(alias, agentName, agentSource);
    }

    if (chatConfig.agent?.workspace) {
      ensureWorkspaceExists(chatConfig.agent.workspace);
    }

    // Auto-set default knowledgeBase path
    if (chatConfig.agent) {
      const knowledge = getAgentKnowledge(chatConfig.agent);
      if ((!knowledge.knowledgeBase || knowledge.knowledgeBase.trim() === '') && chatConfig.agent.workspace) {
        const path = require('path');
        knowledge.knowledgeBase = path.join(chatConfig.agent.workspace, 'knowledge');
      }
      chatConfig.agent = withNormalizedAgentKnowledge({ ...chatConfig.agent, knowledge });
    }

    const normalizedKnowledgeBase = getAgentKnowledge(chatConfig.agent).knowledgeBase;
    if (normalizedKnowledgeBase) {
      ensureWorkspaceExists(normalizedKnowledgeBase);
    }

    profile.chats.push(chatConfig);
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);

    const success = await ctx.writeProfileToFile(alias, profile);
    return success;
  } catch (error) {
    return false;
  }
}

export async function updateChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
  updates: Partial<ChatConfig>,
): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (chatIndex < 0) return false;

    profile.chats[chatIndex] = { ...profile.chats[chatIndex], ...updates };
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);

    const success = await ctx.writeProfileToFile(alias, profile);
    return success;
  } catch (error) {
    return false;
  }
}

export async function deleteChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (chatIndex < 0) return false;

    const chatToDelete = profile.chats[chatIndex];
    if (isBuiltinAgent(chatToDelete.agent?.name)) {
      logger.warn('[ProfileChatCrud] Cannot delete built-in agent', 'deleteChatConfig', {
        alias, chatId, agentName: chatToDelete.agent?.name,
      });
      return false;
    }

    if (profile.chats.length <= 1) {
      profile.chats = [createDefaultChat()];
    } else {
      profile.chats.splice(chatIndex, 1);
    }

    // Clean up associated directories
    const chatSessionsCleanup = removeChatSessionsDirectory(alias, chatId);
    if (!chatSessionsCleanup) {
      logger.warn('[ProfileChatCrud] Failed to cleanup chat sessions directory', 'deleteChatConfig', { alias, chatId });
    }

    const workspaceCleanup = removeDefaultWorkspaceDirectory(alias, chatId);
    if (!workspaceCleanup) {
      logger.warn('[ProfileChatCrud] Failed to cleanup workspace directory', 'deleteChatConfig', { alias, chatId });
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);

    const success = await ctx.writeProfileToFile(alias, profile);
    return success;
  } catch (error) {
    return false;
  }
}

export function getChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
): ChatConfig | null {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile || !isProfileV2(profile)) return null;
    return profile.chats.find(chat => chat.chat_id === chatId) || null;
  } catch (error) {
    return null;
  }
}

export function getAllChatConfigs(
  ctx: ChatCrudContext,
  alias: string,
): ChatConfig[] {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile || !isProfileV2(profile)) return [];
    return [...profile.chats];
  } catch (error) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ChatAgent update
// ---------------------------------------------------------------------------

export async function updateChatAgent(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
  agentUpdates: Partial<ChatAgent>,
): Promise<boolean> {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile || !isProfileV2(profile)) return false;

    const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (chatIndex < 0) return false;

    const currentChat = profile.chats[chatIndex];
    const oldAgent = currentChat.agent;

    // Quick Start image cache cleanup on version/quick_starts change
    if (oldAgent?.name) {
      let shouldClearImageCache = false;

      if (agentUpdates.version !== undefined && oldAgent.version !== agentUpdates.version) {
        shouldClearImageCache = true;
        logger.info(`[ProfileChatCrud] Agent version changed: ${oldAgent.version} -> ${agentUpdates.version}, will clear image cache`);
      }

      if (agentUpdates.zero_states !== undefined) {
        const oldQuickStarts = JSON.stringify(oldAgent.zero_states?.quick_starts || []);
        const newQuickStarts = JSON.stringify(agentUpdates.zero_states?.quick_starts || []);
        if (oldQuickStarts !== newQuickStarts) {
          shouldClearImageCache = true;
          logger.info(`[ProfileChatCrud] Agent quick_starts changed, will clear image cache`);
        }
      }

      if (shouldClearImageCache) {
        quickStartImageCacheManager.clearAgentCache(oldAgent.name);
      }
    }

    // Ensure workspace directory exists
    if (agentUpdates.workspace && agentUpdates.workspace.trim() !== '') {
      ensureWorkspaceExists(agentUpdates.workspace);
    }

    // Ensure knowledgeBase directory exists
    const nextKnowledge = getAgentKnowledge({ ...(oldAgent || DEFAULT_CHAT_AGENT), ...agentUpdates });
    if (nextKnowledge.knowledgeBase && nextKnowledge.knowledgeBase.trim() !== '') {
      ensureWorkspaceExists(nextKnowledge.knowledgeBase);
    }

    // Sync primaryAgent when agent is renamed
    const oldAgentName = oldAgent?.name;
    const newAgentName = agentUpdates.name;

    if (newAgentName !== undefined && oldAgentName && newAgentName !== oldAgentName) {
      if (profile.primaryAgent === oldAgentName) {
        profile.primaryAgent = newAgentName;
        logger.info('[ProfileChatCrud] Updated primaryAgent due to agent rename', 'updateChatAgent', {
          oldPrimaryAgent: oldAgentName, newPrimaryAgent: newAgentName,
        });
      }

      quickStartImageCacheManager.clearAgentCache(oldAgentName);
      logger.info('[ProfileChatCrud] Agent renamed', 'updateChatAgent', {
        oldName: oldAgentName, newName: newAgentName,
      });
    }

    // Apply update
    const previousAgentSkills = normalizeAgentSkillNames(currentChat.agent?.skills);

    if (currentChat.agent) {
      profile.chats[chatIndex].agent = withNormalizedAgentKnowledge({
        ...currentChat.agent,
        ...agentUpdates,
      });
    } else {
      profile.chats[chatIndex].agent = withNormalizedAgentKnowledge({
        ...DEFAULT_CHAT_AGENT,
        ...agentUpdates,
      });
    }

    // Clear skill snapshot if skills changed
    const nextAgentSkills = normalizeAgentSkillNames(profile.chats[chatIndex].agent?.skills);
    const didSkillsChange = agentUpdates.skills !== undefined
      && JSON.stringify(previousAgentSkills) !== JSON.stringify(nextAgentSkills);

    if (didSkillsChange && profile.chats[chatIndex].skill_snapshot) {
      delete profile.chats[chatIndex].skill_snapshot;
      logger.info('[ProfileChatCrud] Cleared chat skill snapshot due to agent skills update', 'updateChatAgent', {
        alias, chatId,
        previousSkillCount: previousAgentSkills.length,
        nextSkillCount: nextAgentSkills.length,
      });
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);

    const success = await ctx.writeProfileToFile(alias, profile);
    return success;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ChatSkillSnapshot
// ---------------------------------------------------------------------------

export async function updateChatSkillSnapshot(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
  skillSnapshot?: ChatSkillSnapshot | null,
  options?: { notifyRenderer?: boolean },
): Promise<boolean> {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile || !isProfileV2(profile)) return false;

    const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
    if (chatIndex < 0) return false;

    if (skillSnapshot) {
      profile.chats[chatIndex].skill_snapshot = skillSnapshot;
      logger.info('[ProfileChatCrud] Updated chat skill snapshot', 'updateChatSkillSnapshot', {
        alias, chatId,
        skillCount: skillSnapshot.skills.length,
        missingSkillCount: skillSnapshot.missing_skill_names?.length || 0,
      });
    } else {
      delete profile.chats[chatIndex].skill_snapshot;
      logger.info('[ProfileChatCrud] Cleared chat skill snapshot', 'updateChatSkillSnapshot', {
        alias, chatId,
      });
    }

    ctx.cache.set(alias, profile);

    if (options?.notifyRenderer) {
      await ctx.notifyProfileDataManager(alias, true);
    }

    const success = await ctx.writeProfileToFile(alias, profile);
    return success;
  } catch {
    return false;
  }
}
