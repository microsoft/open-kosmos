/**
 * Profile entity CRUD operations — MCP servers, skills, and sub-agents.
 * Extracted from ProfileCacheManager for modularity.
 */

import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  McpServerConfig,
  SkillConfig,
  SubAgentConfig,
  SubAgentIndex,
  isProfileV2,
} from './types/profile';
import { clearSkillSnapshotsForAffectedChats } from './profileSanitizer';
import { SubAgentFileManager } from "../subAgent/subAgentFileManager";

const logger = createConsoleLogger();

/**
 * Context interface for entity CRUD operations.
 */
export interface EntityCrudContext {
  cache: Map<string, ProfileV2>;
  getProfileDirectoryPath(alias: string): string;
  readProfileFromFile(alias: string): Promise<ProfileV2 | null>;
  writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean>;
  notifyProfileDataManager(alias: string, immediate?: boolean): Promise<void>;
}

// ═══════ MCP Server CRUD ═══════

export async function addMcpServerConfig(ctx: EntityCrudContext, alias: string, mcpServerConfig: McpServerConfig): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    const existingIndex = profile.mcp_servers.findIndex(server => server.name === mcpServerConfig.name);
    if (existingIndex >= 0) {
      return false;
    }

    profile.mcp_servers.push(mcpServerConfig);
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function updateMcpServerConfig(ctx: EntityCrudContext, alias: string, serverName: string, updates: Partial<McpServerConfig>): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    const serverIndex = profile.mcp_servers.findIndex(server => server.name === serverName);
    if (serverIndex < 0) {
      return false;
    }

    profile.mcp_servers[serverIndex] = {
      ...profile.mcp_servers[serverIndex],
      ...updates
    };

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function deleteMcpServerConfig(ctx: EntityCrudContext, alias: string, serverName: string): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    const serverIndex = profile.mcp_servers.findIndex(server => server.name === serverName);
    if (serverIndex < 0) {
      return false;
    }

    profile.mcp_servers.splice(serverIndex, 1);
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// ═══════ Skill CRUD ═══════

export async function addSkill(ctx: EntityCrudContext, alias: string, skillConfig: SkillConfig): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        logger.warn(`[ProfileCacheManager] addSkill failed: profile not found for alias "${alias}"`);
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      logger.warn(`[ProfileCacheManager] addSkill failed: profile for "${alias}" is not V2 format`);
      return false;
    }

    if (!profile.skills) {
      profile.skills = [];
    }

    const existingIndex = profile.skills.findIndex(skill => skill.name === skillConfig.name);
    if (existingIndex >= 0) {
      logger.info(`[ProfileCacheManager] addSkill: skill "${skillConfig.name}" already exists, updating config`);
      profile.skills[existingIndex] = { ...profile.skills[existingIndex], ...skillConfig };
    } else {
      profile.skills.push(skillConfig);
    }

    const clearedCount = clearSkillSnapshotsForAffectedChats(profile, [skillConfig.name]);
    if (clearedCount > 0) {
      logger.info('[ProfileCacheManager] Invalidated skill snapshots after addSkill', 'addSkill', {
        alias,
        skillName: skillConfig.name,
        clearedCount,
      });
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      logger.warn(`[ProfileCacheManager] addSkill failed: could not write profile to file for "${alias}"`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`[ProfileCacheManager] addSkill error for "${alias}":`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function updateSkill(ctx: EntityCrudContext, alias: string, skillName: string, updates: { description?: string; version?: string }): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      return false;
    }

    if (!profile.skills || !Array.isArray(profile.skills)) {
      return false;
    }

    const skillIndex = profile.skills.findIndex(skill => skill.name === skillName);
    if (skillIndex < 0) {
      return false;
    }

    profile.skills[skillIndex] = {
      ...profile.skills[skillIndex],
      ...updates
    };

    const clearedCount = clearSkillSnapshotsForAffectedChats(profile, [skillName]);
    if (clearedCount > 0) {
      logger.info('[ProfileCacheManager] Invalidated skill snapshots after updateSkill', 'updateSkill', {
        alias,
        skillName,
        clearedCount,
      });
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function deleteSkill(ctx: EntityCrudContext, alias: string, skillName: string): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      return false;
    }

    if (!profile.skills || !Array.isArray(profile.skills)) {
      return false;
    }

    const skillIndex = profile.skills.findIndex(skill => skill.name === skillName);
    if (skillIndex < 0) {
      return false;
    }

    profile.skills.splice(skillIndex, 1);

    const clearedCount = clearSkillSnapshotsForAffectedChats(profile, [skillName]);
    if (clearedCount > 0) {
      logger.info('[ProfileCacheManager] Invalidated skill snapshots after deleteSkill', 'deleteSkill', {
        alias,
        skillName,
        clearedCount,
      });
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// ═══════ Sub-Agent CRUD ═══════

export async function getSubAgents(ctx: EntityCrudContext): Promise<SubAgentConfig[]> {
  try {
    const fileManager = SubAgentFileManager.getInstance();

    for (const [alias, profile] of ctx.cache) {
      if (!isProfileV2(profile)) continue;
      const profileDir = ctx.getProfileDirectoryPath(alias);

      if (!fileManager.isCacheWarmed(alias)) {
        const configs = await fileManager.scanAllAgents(profileDir);
        fileManager.markCacheWarmed(alias);
        if (configs.length > 0) {
          return configs;
        }
        if (Array.isArray(profile.sub_agents) && profile.sub_agents.length > 0) {
          const first = profile.sub_agents[0] as any;
          if ('system_prompt' in first) {
            return profile.sub_agents as SubAgentConfig[];
          }
        }
        return [];
      }

      const index = getSubAgentIndex(ctx, alias);
      const configs: SubAgentConfig[] = [];
      for (const idx of index) {
        const config = await fileManager.readAgentConfig(profileDir, idx.name);
        if (config) {
          configs.push(config);
        }
      }
      return configs;
    }
    return [];
  } catch (error) {
    logger.error(`[ProfileCacheManager] getSubAgents error:`, error instanceof Error ? error.message : String(error));
    for (const [, profile] of ctx.cache) {
      if (isProfileV2(profile) && Array.isArray(profile.sub_agents)) {
        return profile.sub_agents as SubAgentConfig[];
      }
    }
    return [];
  }
}

export function getSubAgentIndex(ctx: EntityCrudContext, alias?: string): SubAgentIndex[] {
  if (alias) {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile)) {
      return (profile.sub_agents || []) as SubAgentIndex[];
    }
    return [];
  }
  for (const [, profile] of ctx.cache) {
    if (isProfileV2(profile)) {
      return (profile.sub_agents || []) as SubAgentIndex[];
    }
  }
  return [];
}

export async function addSubAgent(ctx: EntityCrudContext, alias: string, config: SubAgentConfig): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        logger.warn(`[ProfileCacheManager] addSubAgent failed: profile not found for alias "${alias}"`);
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      logger.warn(`[ProfileCacheManager] addSubAgent failed: profile for "${alias}" is not V2 format`);
      return false;
    }

    const fileManager = SubAgentFileManager.getInstance();
    const profileDir = ctx.getProfileDirectoryPath(alias);
    await fileManager.writeAgentConfig(profileDir, config);

    if (!profile.sub_agents) {
      profile.sub_agents = [];
    }

    const newIndex: SubAgentIndex = {
      name: config.name,
      version: config.version || '1.0.0',
      source: config.source || 'ON-DEVICE',
    };

    const existingIdx = (profile.sub_agents as SubAgentIndex[]).findIndex(sa => sa.name === config.name);
    if (existingIdx >= 0) {
      logger.info(`[ProfileCacheManager] addSubAgent: sub-agent "${config.name}" already exists, updating`);
      (profile.sub_agents as SubAgentIndex[])[existingIdx] = newIndex;
    } else {
      (profile.sub_agents as SubAgentIndex[]).push(newIndex);
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      logger.warn(`[ProfileCacheManager] addSubAgent failed: could not write profile to file for "${alias}"`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`[ProfileCacheManager] addSubAgent error for "${alias}":`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function updateSubAgent(ctx: EntityCrudContext, alias: string, name: string, updates: Partial<SubAgentConfig>): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      return false;
    }

    if (!profile.sub_agents || !Array.isArray(profile.sub_agents)) {
      return false;
    }

    const indexArr = profile.sub_agents as SubAgentIndex[];
    const idxPos = indexArr.findIndex(sa => sa.name === name);
    if (idxPos < 0) {
      return false;
    }

    const fileManager = SubAgentFileManager.getInstance();
    const profileDir = ctx.getProfileDirectoryPath(alias);
    let currentConfig = await fileManager.readAgentConfig(profileDir, name);

    if (!currentConfig) {
      currentConfig = {
        name,
        display_name: name,
        description: '',
        emoji: '🤖',
        version: indexArr[idxPos].version || '1.0.0',
        context_access: 'isolated',
        system_prompt: '',
      };
    }

    const mergedConfig = { ...currentConfig, ...updates } as SubAgentConfig;
    await fileManager.writeAgentConfig(profileDir, mergedConfig);

    indexArr[idxPos] = {
      name,
      version: mergedConfig.version || indexArr[idxPos].version || '1.0.0',
      source: (updates.source ?? indexArr[idxPos].source ?? 'ON-DEVICE') as 'ON-DEVICE',
    };

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function deleteSubAgent(ctx: EntityCrudContext, alias: string, name: string): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) {
        return false;
      }
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) {
      return false;
    }

    if (!profile.sub_agents || !Array.isArray(profile.sub_agents)) {
      return false;
    }

    const indexArr = profile.sub_agents as SubAgentIndex[];
    const idxPos = indexArr.findIndex(sa => sa.name === name);
    if (idxPos < 0) {
      return false;
    }

    try {
      const fileManager = SubAgentFileManager.getInstance();
      const profileDir = ctx.getProfileDirectoryPath(alias);
      await fileManager.deleteAgentDirectory(profileDir, name);
    } catch (err) {
      logger.warn(`[ProfileCacheManager] deleteSubAgent: failed to delete agent directory for "${name}": ${err}`);
    }

    indexArr.splice(idxPos, 1);

    for (const chat of profile.chats) {
      if (chat.agent?.sub_agents) {
        chat.agent.sub_agents = chat.agent.sub_agents.filter(n => n !== name);
      }
    }

    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    const success = await ctx.writeProfileToFile(alias, profile);
    if (!success) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export async function syncSubAgentIndex(ctx: EntityCrudContext, alias: string): Promise<void> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return;
      profile = fileProfile;
    }

    if (!isProfileV2(profile)) return;

    const fileManager = SubAgentFileManager.getInstance();
    const profileDir = ctx.getProfileDirectoryPath(alias);

    fileManager.invalidateAllCache();
    const diskConfigs = await fileManager.scanAllAgents(profileDir);
    const diskNames = new Set(diskConfigs.map(c => c.name));

    const currentIndex = (profile.sub_agents || []) as SubAgentIndex[];
    const indexNames = new Set(currentIndex.map(i => i.name));

    let changed = false;

    for (const config of diskConfigs) {
      if (!indexNames.has(config.name)) {
        currentIndex.push({
          name: config.name,
          version: config.version || '1.0.0',
          source: 'ON-DEVICE',
        });
        changed = true;
      }
    }

    const filtered = currentIndex.filter(i => diskNames.has(i.name));
    if (filtered.length !== currentIndex.length) {
      changed = true;
    }

    if (changed) {
      profile.sub_agents = filtered;
      ctx.cache.set(alias, profile);
      await ctx.writeProfileToFile(alias, profile);
      await ctx.notifyProfileDataManager(alias, true);
    }

    fileManager.markCacheWarmed(alias);
    logger.info(`[ProfileCacheManager] syncSubAgentIndex: synced ${filtered.length} sub-agents for "${alias}"`);
  } catch (error) {
    logger.error(`[ProfileCacheManager] syncSubAgentIndex error:`, error instanceof Error ? error.message : String(error));
  }
}
