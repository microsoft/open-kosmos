/**
 * profileChatCrud.ts
 *
 * ChatConfig and ChatAgent CRUD operations.
 * Extracted from ProfileCacheManager for single-responsibility.
 *
 * <!-- Last verified: 2026-04-05 -->
 */

import * as fs from 'fs';
import * as path from 'path';
import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  ChatConfig,
  ChatAgent,
  DEFAULT_CHAT_AGENT,
  getAgentKnowledge,
  isProfileV2,
  isBuiltinAgent,
  withNormalizedAgentKnowledge,
} from './types/profile';
import {
  getDefaultWorkspacePath,
  getAgentKnowledgePath,
  ensureWorkspaceExists,
  removeChatSessionsDirectory,
  removeDefaultWorkspaceDirectory,
} from './pathUtils';
import { BRAND_NAME } from '@shared/constants/branding';
import {
  normalizeAgentSkillNames,
  createDefaultChat,
  sanitizeZeroStates,
} from './profileSanitizer';
import { withProfileWriteLock } from './profileEntityCrud';
import { chatSkillSnapshotStore } from './chatSkillSnapshotStore';
import { persistNewChatAgents, syncChatAgentsToStore, pruneStaleStoreAgents, ensureInlineAgentIds } from './agentExtraction';
import { getChatAgents, getChatPrimaryAgent, getChatAgentIds, agentIdOf, collectAgentIdsReferencedByOtherChats } from './agentAccessor';
import { deleteAgent, isSafeAgentId, readAgent } from './agentStoreManager';
import { scheduleSettingsManager } from './scheduleSettingsManager';
import { schedulerManager } from '../scheduler/SchedulerManager';
import { SubAgentTaskStore } from '../subAgent/subAgentTaskStore';

const logger = createConsoleLogger();

function stripAgentWorkspace(agent: ChatAgent | undefined): void {
  if (agent && 'workspace' in agent) {
    delete agent.workspace;
  }
}

function stripChatInlineAgentWorkspaces(chat: ChatConfig): void {
  stripAgentWorkspace(chat.agent);
  if (Array.isArray(chat.agents)) {
    chat.agents.forEach(stripAgentWorkspace);
  }
}

function normalizeAgentStoreKnowledgePath(
  alias: string,
  agent: ChatAgent | undefined,
  mode: 'force-store-path' | 'fill-empty',
): ChatAgent | undefined {
  if (!agent?.name) {
    return agent;
  }

  const knowledge = getAgentKnowledge(agent);
  if (mode === 'force-store-path' || !knowledge.knowledgeBase || knowledge.knowledgeBase.trim() === '') {
    knowledge.knowledgeBase = getAgentKnowledgePath(alias, agentIdOf(agent));
  }

  const normalizedAgent = agent as ChatAgent & {
    knowledgeBase?: string;
    teams_enabled?: unknown;
    teams_chats?: unknown;
    outlook_emails_enabled?: unknown;
  };
  delete normalizedAgent.knowledgeBase;
  delete normalizedAgent.teams_enabled;
  delete normalizedAgent.teams_chats;
  delete normalizedAgent.outlook_emails_enabled;
  normalizedAgent.knowledge = knowledge;
  return agent;
}

function normalizeChatInlineAgentKnowledgePaths(
  alias: string,
  chat: ChatConfig,
  mode: 'force-store-path' | 'fill-empty',
): void {
  chat.agent = normalizeAgentStoreKnowledgePath(alias, chat.agent, mode);
  if (Array.isArray(chat.agents)) {
    chat.agents = chat.agents.map(agent => normalizeAgentStoreKnowledgePath(alias, agent, mode) ?? agent);
  }
}

/**
 * Context required by ChatConfig CRUD operations.
 * Injected by ProfileCacheManager to avoid circular dependencies.
 */
export interface ChatCrudContext {
  cache: Map<string, ProfileV2>;
  readProfileFromFile: (alias: string) => Promise<ProfileV2 | null>;
  writeProfileToFile: (alias: string, profile: ProfileV2) => Promise<boolean>;
  notifyProfileDataManager: (alias: string, immediate?: boolean) => Promise<void>;
  getProfileDirectoryPath: (alias: string) => string;
}

async function cleanupSchedulesForChat(alias: string, chatId: string): Promise<void> {
  try {
    if (schedulerManager.getUserAlias() === alias) {
      const jobs = await schedulerManager.listJobs(chatId);
      await Promise.allSettled(jobs.map(job => schedulerManager.deleteJob(job.id)));
      return;
    }

    const jobs = (await scheduleSettingsManager.getAllJobs(alias)).filter(job => job.chat_id === chatId);
    await Promise.allSettled(jobs.map(async (job) => {
      const location = await scheduleSettingsManager.findJobLocation(alias, job.id);
      if (location) {
        await scheduleSettingsManager.deleteScheduleJob(alias, location.monthKey, job.id);
      }
    }));
  } catch (error) {
    logger.warn('[ProfileChatCrud] Failed to cleanup schedules for deleted chat', 'cleanupSchedulesForChat', {
      alias,
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cleanupSubAgentTasksForChat(alias: string, chatId: string): void {
  try {
    SubAgentTaskStore.getInstance().deleteTasksForChat(alias, chatId);
  } catch (error) {
    logger.warn('[ProfileChatCrud] Failed to cleanup sub-agent tasks for deleted chat', 'cleanupSubAgentTasksForChat', {
      alias,
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cleanupLegacyMemexMemoryForChat(profileDir: string, chatId: string): void {
  if (!isSafeAgentId(chatId)) {
    logger.warn('[ProfileChatCrud] Skipping legacy memex cleanup for unsafe chat id', 'cleanupLegacyMemexMemoryForChat', { chatId });
    return;
  }

  try {
    fs.rmSync(path.join(profileDir, 'memex_memory', chatId), { recursive: true, force: true });
  } catch (error) {
    logger.warn('[ProfileChatCrud] Failed to cleanup legacy memex memory for deleted chat', 'cleanupLegacyMemexMemoryForChat', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupAgentsForDeletedChat(
  profileDir: string,
  agentIds: string[],
  referencedElsewhere: Set<string>,
): Promise<void> {
  for (const agentId of agentIds) {
    if (referencedElsewhere.has(agentId)) {
      logger.info('[ProfileChatCrud] Skipping shared agent during chat deletion', 'cleanupAgentsForDeletedChat', {
        agentId,
      });
      continue;
    }

    try {
      await deleteAgent(profileDir, agentId);
    } catch (error) {
      logger.warn('[ProfileChatCrud] Failed to delete agent store directory for deleted chat', 'cleanupAgentsForDeletedChat', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// ChatConfig CRUD
// ---------------------------------------------------------------------------

export async function addChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatConfig: ChatConfig,
): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
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

      // Mint a stable, name-independent id for each inline agent up front so the
      // store dir, knowledge path, and agent_ids are all keyed by the same id and
      // survive later renames. No-op for agents that already carry an id.
      ensureInlineAgentIds(chatConfig);

      // Runtime workspace is derived from alias + chat_id and stripped from
      // profile.json at the write choke point.
      chatConfig.workspace = getDefaultWorkspacePath(alias, chatConfig.chat_id);
      ensureWorkspaceExists(chatConfig.workspace);
      stripChatInlineAgentWorkspaces(chatConfig);

      // Pin new agents' knowledge dirs to the standalone-store location so
      // remote/library legacy paths cannot leak into freshly separated agents.
      normalizeChatInlineAgentKnowledgePaths(alias, chatConfig, 'force-store-path');

      const normalizedKnowledgeBase = getAgentKnowledge(chatConfig.agent).knowledgeBase;
      if (normalizedKnowledgeBase) {
        ensureWorkspaceExists(normalizedKnowledgeBase);
      }

      // Ensure quick_starts have stable ids before committing to cache and disk
      if (chatConfig.agent?.zero_states) {
        chatConfig.agent.zero_states = sanitizeZeroStates(chatConfig.agent.zero_states);
      }

      // Persist the new chat's agent(s) into the standalone store (agents/{id}/)
      // and register the chat→agent mapping (agent_ids). Creation produces the
      // separated model directly: the store owns the agent and profile.json keeps
      // only ids (writeProfileToFile then strips the inline copy from disk).
      // Create-safe — never prunes/deletes a shared or referenced agent.
      const writeFailedAgentIds: string[] = [];
      await persistNewChatAgents(ctx.getProfileDirectoryPath(alias), chatConfig, writeFailedAgentIds);
      // A failed store write leaves no resolvable agent.json, but writeProfileToFile
      // strips the inline agent (store is SSOT), so persisting now would push an
      // agent_ids pointer to a missing agent and render the new chat agent-less until
      // a manual retry. Abort BEFORE the profile write so the caller can retry cleanly.
      if (writeFailedAgentIds.length > 0) {
        logger.warn('[ProfileChatCrud] Aborting new chat creation: agent store write failed', 'addChatConfig', {
          writeFailedAgentIds,
        });
        return false;
      }

      const nextProfile: ProfileV2 = {
        ...profile,
        chats: [...profile.chats, chatConfig],
      };
      const success = await ctx.writeProfileToFile(alias, nextProfile);
      if (!success) return false;

      profile.chats = nextProfile.chats;
      ctx.cache.set(alias, profile);
      await ctx.notifyProfileDataManager(alias);
      return true;
    } catch (error) {
      return false;
    }
  });
}

export async function updateChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
  updates: Partial<ChatConfig>,
): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
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

      const updatesWithoutWorkspace: Partial<ChatConfig> = { ...updates };
      delete updatesWithoutWorkspace.workspace;
      const nextProfile: ProfileV2 = {
        ...profile,
        chats: profile.chats.map((chat, index) => index === chatIndex ? { ...chat, ...updatesWithoutWorkspace } : chat),
      };
      const updatedChat = nextProfile.chats[chatIndex];
      updatedChat.workspace = getDefaultWorkspacePath(alias, updatedChat.chat_id);
      ensureWorkspaceExists(updatedChat.workspace);
      stripChatInlineAgentWorkspaces(updatedChat);

      // Agent-bearing config updates MUST write through to the standalone store.
      // Post-separation the source of truth for agents is `agents/{id}/agent.json`
      // and `writeProfileToFile` strips inline `agent`/`agents` from disk once
      // `agent_ids` resolve. Callers that legitimately pass full agent objects
      // through this path (skill apply/remove, hook apply on multi-agent chats,
      // legacy imported agents would otherwise have their edit silently discarded
      // — the same class of bug as the AgentEditor Save no-op. Mirror
      // `updateChatAgent`: sync the merged inline agent(s) to the store and
      // re-stamp `agent_ids` BEFORE persisting the profile. Non-agent updates
      // (title, chat_type, workspace, ...) skip this and behave as before.
      // The destructive prune of removed agents is deferred (staleAgentIds) until
      // AFTER the profile write is durable — deleting them first, then failing the
      // write, would strand the persisted profile on agents we already erased.
      const staleAgentIds: string[] = [];
      const writeFailedAgentIds: string[] = [];
      if (updates.agent !== undefined || updates.agents !== undefined) {
        await syncChatAgentsToStore(
          ctx.getProfileDirectoryPath(alias),
          updatedChat,
          collectAgentIdsReferencedByOtherChats(nextProfile, updatedChat.chat_id),
          staleAgentIds,
          writeFailedAgentIds,
          inline => {
            for (const agent of inline) {
              normalizeAgentStoreKnowledgePath(alias, agent, 'fill-empty');
            }
          },
        );
        // A store write that actually threw is undetectable by the readAgent-based
        // strip gate for an UPDATE (the old agent.json survives, so the id still
        // resolves). Persisting the profile now would strip the edited inline agent
        // and lose the edit on reload. Fail instead: the editor stays dirty and the
        // durable old content is untouched.
        if (writeFailedAgentIds.length > 0) {
          logger.warn(
            '[ProfileChatCrud] Aborting chat config update: agent store write failed',
            'updateChatConfig',
            { chatId, writeFailedAgentIds },
          );
          return false;
        }
      }

      const success = await ctx.writeProfileToFile(alias, nextProfile);
      if (!success) return false;

      // Profile durably persisted — now it is safe to prune agents that fell out of
      // the binding (no-op when nothing was removed).
      await pruneStaleStoreAgents(ctx.getProfileDirectoryPath(alias), staleAgentIds);

      profile.chats = nextProfile.chats;
      ctx.cache.set(alias, profile);
      await ctx.notifyProfileDataManager(alias, true);
      return true;
    } catch (error) {
      return false;
    }
  });
}

export async function deleteChatConfig(
  ctx: ChatCrudContext,
  alias: string,
  chatId: string,
): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
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
      const profileDir = ctx.getProfileDirectoryPath(alias);
      const agentIdsToDelete = getChatAgentIds(chatToDelete);
      const referencedAgentIds = collectAgentIdsReferencedByOtherChats(profile, chatId);
      // Resolve the primary agent through the accessor (registry/store) rather than
      // reading chatToDelete.agent directly: the cached profile keeps only agent_ids
      // (inline agents are stripped), so a separated chat has no inline `agent` and a
      // direct read would resolve to undefined and silently bypass the built-in guard.
      const primaryAgentName = getChatPrimaryAgent(chatToDelete)?.name;
      if (isBuiltinAgent(primaryAgentName, BRAND_NAME)) {
        logger.warn('[ProfileChatCrud] Cannot delete built-in agent', 'deleteChatConfig', {
          alias, chatId, agentName: primaryAgentName,
        });
        return false;
      }

      const isLastChat = profile.chats.length <= 1;
      const nextChats: ChatConfig[] = isLastChat
        ? [createDefaultChat()]
        : profile.chats.filter((_, index) => index !== chatIndex);

      // Deleting the last chat replaces it with a fresh default chat that carries
      // only an inline agent (no agent_ids, nothing in the store). Seed it into the
      // standalone store and stamp agent_ids BEFORE the profile is written, cached,
      // and pushed — the same contract the first-run create path (seedNewProfileAgents)
      // and addChatConfig honour. Without this, writeProfileToFile keeps the chat
      // un-stamped (stripInlineChatAgentsForDisk only strips once ids resolve),
      // buildRendererProfilePayload strips the inline agent anyway, and the
      // renderer's resolveChatAgent returns null (no default agent/model/tools)
      // until a full profile reload self-heals.
      if (isLastChat) {
        if (!nextChats[0].workspace || nextChats[0].workspace.trim() === '') {
          nextChats[0].workspace = getDefaultWorkspacePath(alias, nextChats[0].chat_id);
        }
        const writeFailedAgentIds: string[] = [];
        await persistNewChatAgents(ctx.getProfileDirectoryPath(alias), nextChats[0], writeFailedAgentIds);
        // If the replacement default agent's store write failed, aborting keeps the
        // original chat intact rather than deleting it into an agent-less default
        // (agent_ids pointing at a missing agent.json after the inline strip).
        if (writeFailedAgentIds.length > 0) {
          logger.warn('[ProfileChatCrud] Aborting last-chat deletion: replacement agent store write failed', 'deleteChatConfig', {
            alias, chatId, writeFailedAgentIds,
          });
          return false;
        }
      }

      const nextProfile: ProfileV2 = { ...profile, chats: nextChats };
      const success = await ctx.writeProfileToFile(alias, nextProfile);
      if (!success) return false;

      profile.chats = nextProfile.chats;
      ctx.cache.set(alias, profile);

      // Evict the deleted chat's in-memory skill snapshot so it cannot leak.
      chatSkillSnapshotStore.clear(alias, chatId);

      // Clean up associated resources only after the profile deletion is durable.
      const chatSessionsCleanup = removeChatSessionsDirectory(alias, chatId);
      if (!chatSessionsCleanup) {
        logger.warn('[ProfileChatCrud] Failed to cleanup chat sessions directory', 'deleteChatConfig', { alias, chatId });
      }

      const workspaceCleanup = removeDefaultWorkspaceDirectory(alias, chatId);
      if (!workspaceCleanup) {
        logger.warn('[ProfileChatCrud] Failed to cleanup workspace directory', 'deleteChatConfig', { alias, chatId });
      }

      await cleanupSchedulesForChat(alias, chatId);
      cleanupSubAgentTasksForChat(alias, chatId);
      cleanupLegacyMemexMemoryForChat(profileDir, chatId);
      await cleanupAgentsForDeletedChat(profileDir, agentIdsToDelete, referencedAgentIds);

      await ctx.notifyProfileDataManager(alias);
      return true;
    } catch (error) {
      return false;
    }
  });
}

/**
 * Resolve a chat's existing agents for an in-place update, tolerating the
 * post-migration cache shape (`agent_ids` only). Tiers: inline facade → registry
 * accessor (populated on profile load) → direct store reads by id (authoritative,
 * survives a cold/empty registry). Returns an empty list only when the chat has
 * no resolvable agent at all (e.g. a brand-new chat), letting the caller safely
 * create one.
 *
 * This guards `updateChatAgent`: without it, a chat whose inline agent was
 * stripped resolves to `undefined`, the update merges onto `DEFAULT_CHAT_AGENT`
 * (name "Kobi"), and `syncChatAgentsToStore` then writes a default-named agent,
 * re-stamps `agent_ids` to the default id, and PRUNES the chat's real agent —
 * silently destroying it and clobbering the unrelated default-named agent. See
 * the 2026-06-30 postmortem (one model edit deleted "OpenKosmos" and reset "Kobi").
 */
function resolveExistingAgents(
  ctx: ChatCrudContext,
  alias: string,
  chat: ChatConfig,
): ChatAgent[] {
  if (Array.isArray(chat.agents) && chat.agents.length > 0) {
    return chat.agents;
  }
  if (chat.agent) {
    return [chat.agent];
  }
  const resolved = getChatAgents(chat);
  if (resolved.length > 0) {
    return resolved;
  }
  const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids.filter(Boolean) : [];
  if (ids.length > 0) {
    const profileDir = ctx.getProfileDirectoryPath(alias);
    const storedAgents: ChatAgent[] = [];
    for (const id of ids) {
      const stored = readAgent(profileDir, id);
      if (stored) {
        storedAgents.push(stored as ChatAgent);
      }
    }
    return storedAgents;
  }
  return [];
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
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = ctx.cache.get(alias);
      if (!profile || !isProfileV2(profile)) return false;

      const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (chatIndex < 0) return false;

      const agentUpdatesForStore: Partial<ChatAgent> = { ...agentUpdates };
      delete agentUpdatesForStore.workspace;

      const nextProfile: ProfileV2 = {
        ...profile,
        chats: profile.chats.map(chat => ({ ...chat })),
      };
      const currentChat = nextProfile.chats[chatIndex];
      currentChat.workspace = getDefaultWorkspacePath(alias, currentChat.chat_id);
      // Recover the chat's existing primary agent before merging the update.
      // Post-migration the cache holds agent_ids-only chats (inline agents are
      // stripped on write), so reading `chat.agent` directly returns undefined.
      // Without recovering it the merge below would fall back to
      // DEFAULT_CHAT_AGENT and syncChatAgentsToStore would prune the real agent.
      const existingAgents = resolveExistingAgents(ctx, alias, currentChat);
      if (existingAgents.length > 0) {
        if (!currentChat.agent) {
          currentChat.agent = existingAgents[0];
        }
        if ((!Array.isArray(currentChat.agents) || currentChat.agents.length === 0) && existingAgents.length > 1) {
          currentChat.agents = existingAgents;
        }
      }
      const oldAgent = existingAgents[0];
      ensureWorkspaceExists(currentChat.workspace);

      // Detect an agent rename.
      // The primary chat is keyed by chat_id (stable), so a rename never touches
      // the profile-level `primaryChat` field — no profile.json churn on rename.
      const oldAgentName = oldAgent?.name;
      const newAgentName = agentUpdatesForStore.name;

      if (newAgentName !== undefined && oldAgentName && newAgentName !== oldAgentName) {
        logger.info('[ProfileChatCrud] Agent renamed', 'updateChatAgent', {
          oldName: oldAgentName, newName: newAgentName,
        });
      }

      // Apply update
      const previousAgentSkills = normalizeAgentSkillNames(currentChat.agent?.skills);

      const updatedPrimaryAgent = normalizeAgentStoreKnowledgePath(alias, withNormalizedAgentKnowledge({
        ...(currentChat.agent || DEFAULT_CHAT_AGENT),
        ...agentUpdatesForStore,
      }), 'fill-empty')!;
      const updatedKnowledge = getAgentKnowledge(updatedPrimaryAgent);
      if (updatedKnowledge.knowledgeBase && updatedKnowledge.knowledgeBase.trim() !== '') {
        ensureWorkspaceExists(updatedKnowledge.knowledgeBase);
      }
      nextProfile.chats[chatIndex].agent = updatedPrimaryAgent;
      if (Array.isArray(currentChat.agents) && currentChat.agents.length > 0) {
        const primaryId = oldAgent ? agentIdOf(oldAgent) : undefined;
        let replaced = false;
        const updatedAgents = currentChat.agents.map((agent, index) => {
          const isPrimary = primaryId ? agentIdOf(agent) === primaryId : index === 0;
          if (!replaced && isPrimary) {
            replaced = true;
            return updatedPrimaryAgent;
          }
          return agent;
        });
        if (!replaced) {
          updatedAgents[0] = updatedPrimaryAgent;
        }
        nextProfile.chats[chatIndex].agents = updatedAgents;
      }
      stripChatInlineAgentWorkspaces(nextProfile.chats[chatIndex]);

      // Ensure quick_starts have stable ids before committing to cache and disk
      const updatedAgent = nextProfile.chats[chatIndex].agent;
      if (updatedAgent?.zero_states) {
        updatedAgent.zero_states = sanitizeZeroStates(updatedAgent.zero_states);
      }

      // Detect a skill-binding change so the in-memory snapshot can be invalidated
      // once the new binding is durably persisted.
      const nextAgentSkills = normalizeAgentSkillNames(nextProfile.chats[chatIndex].agent?.skills);
      const didSkillsChange = agentUpdatesForStore.skills !== undefined
        && JSON.stringify(previousAgentSkills) !== JSON.stringify(nextAgentSkills);

      // Mirror the edited inline agent into the store. The agent's id is carried
      // (minted at creation, independent of the name), so a rename keeps the same
      // id: agent_ids is unchanged and no store entry is pruned — only the
      // agent.json content is rewritten. Inline fields stay authoritative. Pass
      // the ids referenced by other chats so a genuine agent swap never prunes a
      // store entry still shared with (referenced by) another active/archived chat.
      // Defer the destructive prune (staleAgentIds) until the profile write is
      // durable — pruning first, then failing the write, would leave the persisted
      // profile bound to an agent we already deleted.
      const staleAgentIds: string[] = [];
      const writeFailedAgentIds: string[] = [];
      await syncChatAgentsToStore(
        ctx.getProfileDirectoryPath(alias),
        nextProfile.chats[chatIndex],
        collectAgentIdsReferencedByOtherChats(nextProfile, nextProfile.chats[chatIndex].chat_id),
        staleAgentIds,
        writeFailedAgentIds,
      );
      // A store write that actually threw is undetectable by the readAgent-based strip
      // gate for an UPDATE (the old agent.json survives, so the edited id still
      // resolves). Persisting the profile now would strip the edited inline agent and
      // permanently lose the edit on reload. Fail instead so the editor stays dirty and
      // the durable old content is untouched.
      if (writeFailedAgentIds.length > 0) {
        logger.warn(
          '[ProfileChatCrud] Aborting chat agent update: agent store write failed',
          'updateChatAgent',
          { chatId, writeFailedAgentIds },
        );
        return false;
      }

      const success = await ctx.writeProfileToFile(alias, nextProfile);
      if (!success) return false;

      // Profile durably persisted — now it is safe to prune the swapped-out agents.
      await pruneStaleStoreAgents(ctx.getProfileDirectoryPath(alias), staleAgentIds);

      if (didSkillsChange) {
        chatSkillSnapshotStore.clear(alias, chatId);
        logger.info('[ProfileChatCrud] Cleared chat skill snapshot due to agent skills update', 'updateChatAgent', {
          alias, chatId,
          previousSkillCount: previousAgentSkills.length,
          nextSkillCount: nextAgentSkills.length,
        });
      }

      profile.chats = nextProfile.chats;
      ctx.cache.set(alias, profile);
      await ctx.notifyProfileDataManager(alias, true);
      return true;
    } catch (error) {
      return false;
    }
  });
}
