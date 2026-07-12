/**
 * Agent Hook CRUD operations for the global Hook library.
 *
 * The hook *list* now lives in `hooks.json`, owned end-to-end by
 * {@link ../userDataADO/hooksConfigManager HooksConfigManager} (structurally
 * mirroring skills/mcp). These functions are thin wrappers that keep the public
 * ProfileCacheManager API unchanged:
 *
 * - `getHooks` / `addHook` / `updateHook` / `deleteHook` delegate to the manager.
 *   The mutators gate on profile existence (so a hook can only be mutated for an
 *   alias that actually has a profile, which also seeds the manager from disk) and
 *   fire the profile notification so the renderer cache refreshes — exactly the
 *   skill/mcp delegation pattern.
 * - `isHooksEnabled` / `setHooksEnabled` are INTENTIONALLY unchanged: the Hooks
 *   master switch (`ProfileV2.hooksEnabled`) stays in `profile.json`, so it is
 *   still read from the cached profile and written through the profile write path.
 */

import { createConsoleLogger } from '../unifiedLogger';
import { ProfileV2, HookDefinition, isProfileV2 } from './types/profile';
import { hooksConfigManager, UpdateHookInput } from './hooksConfigManager';
import {
  ensureProfileLoadedForConfigCrud,
  withProfileWriteLock,
  writeProfileThenCommitCache,
  type EntityCrudContext,
} from './profileEntityCrud';

const logger = createConsoleLogger();

/**
 * Load a V2 profile for the Hooks master switch, preferring the cache and
 * falling back to disk. Returns null when the profile is missing or not V2.
 */
async function loadProfileForHooks(ctx: EntityCrudContext, alias: string): Promise<ProfileV2 | null> {
  const profile = ctx.cache.get(alias) ?? (await ctx.readProfileFromFile(alias)) ?? undefined;
  return profile && isProfileV2(profile) ? profile : null;
}

/**
 * Read the global Hook library (synchronous). The list lives in HooksConfigManager
 * (hooks.json), so this delegates there rather than reading the cached profile,
 * which no longer carries `hooks`. Returns an empty array when not loaded.
 */
export function getHooks(ctx: EntityCrudContext, alias: string): HookDefinition[] {
  return hooksConfigManager.getHooks(alias);
}

/** Read the profile-level Hooks master switch (synchronous, cache-only). */
export function isHooksEnabled(ctx: EntityCrudContext, alias: string): boolean {
  const profile = ctx.cache.get(alias);
  return Boolean(profile && isProfileV2(profile) && profile.hooksEnabled === true);
}

/** Persist the profile-level Hooks master switch (stays in profile.json). */
export async function setHooksEnabled(ctx: EntityCrudContext, alias: string, enabled: boolean): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForHooks(ctx, alias);
      if (!profile) {
        logger.warn(`[ProfileCacheManager] setHooksEnabled failed: profile not found or not V2 for "${alias}"`);
        return false;
      }
      const nextProfile: ProfileV2 = {
        ...profile,
        hooksEnabled: enabled,
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      logger.error(`[ProfileCacheManager] setHooksEnabled error for "${alias}":`, error instanceof Error ? error.message : String(error));
      return false;
    }
  });
}

/**
 * Add a new Hook to the global library. The manager rejects malformed definitions
 * and duplicate ids and stamps createdAt/updatedAt server-side; it writes ONLY
 * hooks.json. We gate on profile existence and notify the renderer on success.
 */
export async function addHook(ctx: EntityCrudContext, alias: string, hook: HookDefinition): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    logger.warn(`[ProfileCacheManager] addHook failed: profile not found for "${alias}"`);
    return false;
  }
  const added = await hooksConfigManager.addHook(alias, hook);
  if (added) {
    await ctx.notifyProfileDataManager(alias, true);
  }
  return added;
}

/**
 * Update an existing Hook by id. The id and createdAt are immutable; updatedAt is
 * always refreshed. The manager rejects updates that would make the Hook invalid.
 */
export async function updateHook(
  ctx: EntityCrudContext,
  alias: string,
  hookId: string,
  updates: UpdateHookInput,
): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const updated = await hooksConfigManager.updateHook(alias, hookId, updates);
  if (updated) {
    await ctx.notifyProfileDataManager(alias, true);
  }
  return updated;
}

/** Delete a Hook from the global library by id. */
export async function deleteHook(ctx: EntityCrudContext, alias: string, hookId: string): Promise<boolean> {
  if (!(await ensureProfileLoadedForConfigCrud(ctx, alias))) {
    return false;
  }
  const deleted = await hooksConfigManager.deleteHook(alias, hookId);
  if (deleted) {
    await ctx.notifyProfileDataManager(alias, true);
  }
  return deleted;
}
