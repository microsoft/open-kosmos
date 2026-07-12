/**
 * Profile entity CRUD operations — MCP servers and skills.
 * Extracted from ProfileCacheManager for modularity.
 */

import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  McpServerConfig,
  isProfileV2,
} from './types/profile';
import { mcpConfigManager } from './mcpConfigManager';
import { skillsConfigManager, AddSkillInput, UpdateSkillInput } from './skillsConfigManager';
import { chatSkillSnapshotStore } from './chatSkillSnapshotStore';

const logger = createConsoleLogger();

export interface ProfileWriteContext {
  cache: Map<string, ProfileV2>;
  readProfileFromFile(alias: string): Promise<ProfileV2 | null>;
  writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean>;
  notifyProfileDataManager(alias: string, immediate?: boolean): Promise<void>;
}

/**
 * Context interface for entity CRUD operations.
 */
export interface EntityCrudContext extends ProfileWriteContext {
  getProfileDirectoryPath(alias: string): string;
}

const profileWriteLocks = new Map<string, Promise<void>>();

export async function withProfileWriteLock<T>(alias: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileWriteLocks.get(alias);
  /* v8 ignore next -- Promise executors run synchronously, so this placeholder is replaced before finally can release the lock. */
  let releaseLock: () => void = () => {};
  const current = new Promise<void>(resolve => {
    releaseLock = resolve;
  });
  profileWriteLocks.set(alias, current);
  await previous;
  try {
    return await operation();
  } finally {
    releaseLock();
    if (profileWriteLocks.get(alias) === current) {
      profileWriteLocks.delete(alias);
    }
  }
}

// ──────────────────────────── MCP server CRUD ──────────────────────────────
// Installed global MCP servers live in mcp.json and are owned by McpConfigManager
// (which serializes its own writes and advances its own updatedAt). These thin
// wrappers gate on profile existence and fire the profile notification so the
// renderer cache refreshes — mirroring the skill/sub-agent delegation pattern.

/**
 * Guard for the MCP and skill CRUD wrappers: a config may only be mutated for an
 * alias that actually has a profile. On a cache miss this loads profile.json
 * (which also seeds McpConfigManager / SkillsConfigManager) and caches the
 * stripped profile so a follow-up notification still carries the profile body.
 * Returns false when no profile exists.
 */
export async function ensureProfileLoadedForConfigCrud(ctx: EntityCrudContext, alias: string): Promise<boolean> {
  if (ctx.cache.has(alias)) {
    return true;
  }
  const fileProfile = await ctx.readProfileFromFile(alias);
  if (!fileProfile) {
    return false;
  }
  ctx.cache.set(alias, fileProfile);
  return true;
}

export async function addMcpServerConfig(ctx: EntityCrudContext, alias: string, mcpServerConfig: McpServerConfig): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const added = await mcpConfigManager.addServer(alias, mcpServerConfig);
  if (added) {
    await ctx.notifyProfileDataManager(alias);
  }
  return added;
}

export async function updateMcpServerConfig(ctx: EntityCrudContext, alias: string, serverName: string, updates: Partial<McpServerConfig>): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const updated = await mcpConfigManager.updateServer(alias, serverName, updates);
  if (updated) {
    await ctx.notifyProfileDataManager(alias, true);
  }
  return updated;
}

export async function deleteMcpServerConfig(ctx: EntityCrudContext, alias: string, serverName: string): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const deleted = await mcpConfigManager.deleteServer(alias, serverName);
  if (deleted) {
    await ctx.notifyProfileDataManager(alias);
  }
  return deleted;
}

// ────────────────────────────── skill CRUD ─────────────────────────────────
// The global skill registry lives in skills.json and is owned by
// SkillsConfigManager (which serializes its own writes and advances its own
// updatedAt). These thin wrappers mirror the MCP ones: gate on profile
// existence, delegate the persistence to the manager, then invalidate any
// per-chat skill snapshots that referenced the changed skill (an in-memory
// eagerness optimization on top of the next-turn signature check) and fire the
// profile notification so the renderer cache refreshes.

/**
 * Drop the in-memory snapshots of chats whose single-agent skill binding
 * references `skillName`, so an affected chat rebuilds its snapshot on the next
 * turn. Reads the (read-only) cached chat list; no profile.json write.
 */
function invalidateChatSnapshotsForSkill(ctx: EntityCrudContext, alias: string, skillName: string): void {
  const profile = ctx.cache.get(alias);
  if (!profile || !isProfileV2(profile)) {
    return;
  }
  const cleared = chatSkillSnapshotStore.invalidateAffectedChats(alias, profile.chats, [skillName]);
  if (cleared > 0) {
    logger.info('[ProfileCacheManager] Invalidated skill snapshots after registry change', 'invalidateChatSnapshotsForSkill', {
      alias,
      skillName,
      clearedCount: cleared,
    });
  }
}

export async function addSkillConfig(ctx: EntityCrudContext, alias: string, skillConfig: AddSkillInput): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const added = await skillsConfigManager.addSkill(alias, skillConfig);
  if (added) {
    invalidateChatSnapshotsForSkill(ctx, alias, skillConfig.name);
    await ctx.notifyProfileDataManager(alias);
  }
  return added;
}

export async function updateSkillConfig(ctx: EntityCrudContext, alias: string, skillName: string, updates: UpdateSkillInput): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const updated = await skillsConfigManager.updateSkill(alias, skillName, updates);
  if (updated) {
    invalidateChatSnapshotsForSkill(ctx, alias, skillName);
    await ctx.notifyProfileDataManager(alias, true);
  }
  return updated;
}

export async function deleteSkillConfig(ctx: EntityCrudContext, alias: string, skillName: string): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const deleted = await skillsConfigManager.deleteSkill(alias, skillName);
  if (deleted) {
    invalidateChatSnapshotsForSkill(ctx, alias, skillName);
    await ctx.notifyProfileDataManager(alias, true);
  }
  return deleted;
}

export async function writeProfileThenCommitCache(
  ctx: ProfileWriteContext,
  alias: string,
  currentProfile: ProfileV2,
  nextProfile: ProfileV2,
  immediate = false,
  notify = true,
): Promise<boolean> {
  let success = false;
  try {
    success = await ctx.writeProfileToFile(alias, nextProfile);
  } catch (error) {
    logger.error(`[ProfileCacheManager] Failed to persist profile for "${alias}":`, error instanceof Error ? error.message : String(error));
    return false;
  }
  if (!success) {
    return false;
  }
  Object.assign(currentProfile, nextProfile);
  ctx.cache.set(alias, currentProfile);
  if (notify) {
    if (immediate) {
      await ctx.notifyProfileDataManager(alias, true);
    } else {
      await ctx.notifyProfileDataManager(alias);
    }
  }
  return true;
}
