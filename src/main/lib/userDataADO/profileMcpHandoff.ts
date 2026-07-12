import { createConsoleLogger } from '../unifiedLogger';
import { mcpConfigManager } from './mcpConfigManager';
import { skillsConfigManager } from './skillsConfigManager';
import { hooksConfigManager } from './hooksConfigManager';
import type { McpServerConfig, SkillConfig, HookDefinition, ProfileV2 } from './types/profile';

const logger = createConsoleLogger();

export async function tryCommitMcpServers(
  alias: string,
  servers: McpServerConfig[],
  operation: string,
  message: string,
): Promise<boolean> {
  try {
    await mcpConfigManager.commitResolvedServers(alias, servers);
    return true;
  } catch (error) {
    logger.error(message, operation, { alias, error: String(error) });
    return false;
  }
}

export async function tryCommitSkills(
  alias: string,
  skills: SkillConfig[],
  operation: string,
  message: string,
): Promise<boolean> {
  try {
    await skillsConfigManager.commitResolvedSkills(alias, skills);
    return true;
  } catch (error) {
    logger.error(message, operation, { alias, error: String(error) });
    return false;
  }
}

export async function tryCommitHooks(
  alias: string,
  hooks: HookDefinition[],
  operation: string,
  message: string,
): Promise<boolean> {
  try {
    await hooksConfigManager.commitResolvedHooks(alias, hooks);
    return true;
  } catch (error) {
    logger.error(message, operation, { alias, error: String(error) });
    return false;
  }
}

/**
 * Migrate + persist a loading profile's global skill registry through
 * SkillsConfigManager (skills.json's owner): a legacy profile's inline skills are
 * split into skills.json and `needsProfileRewrite` is flagged so the legacy field
 * is stripped from profile.json.
 *
 * Returns `null` when the migration write throws (disk full, permission/AV lock).
 * The caller must then keep the existing profile.json intact rather than letting the
 * throw bubble to its catch-all — which would treat profile.json as unreadable and
 * reset it to a default profile, losing the user's agents/settings/chats. The registry
 * stays hydrated in memory from the pre-gate resolveFromDisk; migration retries next load.
 */
export async function loadSkillRegistryForProfile(
  alias: string,
  rawProfile: { skills?: unknown },
): Promise<{ skills: SkillConfig[]; needsProfileRewrite: boolean } | null> {
  try {
    return await skillsConfigManager.loadForAlias(alias, rawProfile);
  } catch (error) {
    logger.error(
      '[ProfileCacheManager] Failed to persist skills.json during profile load; keeping existing profile.json intact',
      'readProfileFromFile',
      { alias, error: String(error) },
    );
    return null;
  }
}

/**
 * Migrate + persist a loading profile's global Agent Hook library through
 * HooksConfigManager (hooks.json's owner): a legacy profile's inline hooks are
 * split into hooks.json and `needsProfileRewrite` is flagged so the legacy field
 * is stripped from profile.json. Mirrors {@link loadSkillRegistryForProfile}.
 *
 * Returns `null` when the migration write throws (disk full, permission/AV lock).
 * The caller must then keep the existing profile.json intact rather than letting the
 * throw bubble to its catch-all — which would treat profile.json as unreadable and
 * reset it to a default profile, losing the user's agents/settings/chats. The library
 * stays hydrated in memory from the pre-gate resolveFromDisk; migration retries next load.
 *
 * NOTE: this moves only the hook *list*. The Hooks master switch (`hooksEnabled`)
 * is never touched here — it stays in profile.json.
 */
export async function loadHookRegistryForProfile(
  alias: string,
  rawProfile: { hooks?: unknown },
): Promise<{ hooks: HookDefinition[]; needsProfileRewrite: boolean } | null> {
  try {
    return await hooksConfigManager.loadForAlias(alias, rawProfile);
  } catch (error) {
    logger.error(
      '[ProfileCacheManager] Failed to persist hooks.json during profile load; keeping existing profile.json intact',
      'readProfileFromFile',
      { alias, error: String(error) },
    );
    return null;
  }
}

export function fingerprintProfileForDirtyCheck(profile: Partial<ProfileV2>): string {
  const rest = { ...profile };
  delete rest.mcp_servers;
  delete rest.skills;
  // The hook *list* lives in hooks.json, so it must not dirty the profile.json
  // fingerprint. `hooksEnabled` is deliberately NOT stripped: the master switch
  // stays in profile.json and toggling it SHOULD rewrite profile.json.
  delete rest.hooks;
  delete rest.updatedAt;
  return JSON.stringify(rest);
}
