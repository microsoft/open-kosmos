/**
 * Profile migration functions — version-controlled one-time migrations and builtin defaults upgrades.
 * Extracted from ProfileCacheManager for modularity.
 *
 * Part 1: applyProfileMigrations — destructive/irreversible data transformations
 * Part 2: applyBuiltinDefaultsMigrations — builtin-tools server and skills version management
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  ProfileV2,
  ChatConfig,
  isBuiltinAgent,
  withNormalizedAgentKnowledge,
} from './types/profile';
import { BUILTIN_SKILL_CHANGELOG, BUILTIN_DEFAULTS_VERSION } from '../../../shared/constants/builtinSkills';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

/**
 * Determine whether a ChatConfig is the default config.
 */
export function isDefaultChatConfig(chat: ChatConfig): boolean {
  if (!chat.agent) return true;

  const isDefaultAgent = chat.agent.role === 'Default Assistant' && chat.agent.name === 'Kobi';
  const hasNoCustomMcpServers = !chat.agent.mcp_servers ||
    chat.agent.mcp_servers.length === 0 ||
    (chat.agent.mcp_servers.length === 1 && chat.agent.mcp_servers[0].name === 'builtin-tools');

  return isDefaultAgent && hasNoCustomMcpServers;
}

/**
 * Determine whether a profile is the default config (user has made no modifications).
 * Used when migrating the freDone field to determine whether the user needs the FRE.
 */
export function isDefaultProfile(profile: ProfileV2): boolean {
  const hasNoMcpServers = !profile.mcp_servers || profile.mcp_servers.length === 0;
  const hasNoSkills = !profile.skills || profile.skills.length === 0;
  const hasDefaultChats = !profile.chats || profile.chats.length === 0 ||
    (profile.chats.length === 1 && isDefaultChatConfig(profile.chats[0]));

  return hasNoMcpServers && hasNoSkills && hasDefaultChats;
}

function isYearMonthDirectoryName(name: string): boolean {
  return /^\d{6}$/.test(name);
}

function mergeDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        mergeDirectoryContents(sourcePath, targetPath);
        if (fs.existsSync(sourcePath) && fs.readdirSync(sourcePath).length === 0) {
          fs.rmdirSync(sourcePath);
        }
      } else if (!fs.existsSync(targetPath)) {
        fs.renameSync(sourcePath, targetPath);
      }
      continue;
    }

    // Target wins on name conflicts. Keep the source file in place so we do not
    // silently overwrite user data during regression recovery.
    if (!fs.existsSync(targetPath)) {
      fs.renameSync(sourcePath, targetPath);
    }
  }
}

function restoreRegressedKnowledgeDeliveryDirectories(chat: ChatConfig): void {
  try {
    const workspace = chat.agent?.workspace?.trim();
    const knowledgeBase = chat.agent?.knowledge?.knowledgeBase?.trim();
    if (!workspace || !knowledgeBase) {
      return;
    }

    const normalizedWorkspace = path.resolve(workspace);
    const expectedKnowledgeBase = path.resolve(path.join(normalizedWorkspace, 'knowledge'));
    const normalizedKnowledgeBase = path.resolve(knowledgeBase);
    if (normalizedKnowledgeBase !== expectedKnowledgeBase || !fs.existsSync(normalizedKnowledgeBase)) {
      return;
    }

    const entries = fs.readdirSync(normalizedKnowledgeBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isYearMonthDirectoryName(entry.name)) {
        continue;
      }

      const sourceMonthDir = path.join(normalizedKnowledgeBase, entry.name);
      const targetMonthDir = path.join(normalizedWorkspace, entry.name);

      if (fs.existsSync(targetMonthDir)) {
        if (!fs.statSync(targetMonthDir).isDirectory()) {
          continue;
        }
        mergeDirectoryContents(sourceMonthDir, targetMonthDir);
        if (fs.existsSync(sourceMonthDir) && fs.readdirSync(sourceMonthDir).length === 0) {
          fs.rmdirSync(sourceMonthDir);
        }
        continue;
      }

      fs.renameSync(sourceMonthDir, targetMonthDir);
    }
  } catch (error) {
    logger.warn('[ProfileMigration] Failed to restore regressed knowledge delivery directories', 'restoreRegressedKnowledgeDeliveryDirectories', {
      chatId: chat.chat_id,
      agentName: chat.agent?.name,
      workspace: chat.agent?.workspace,
      knowledgeBase: chat.agent?.knowledge?.knowledgeBase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Part 1: One-time Migrations (version-controlled, incremental)
 *
 * Each migration runs only once per profile lifetime. Once applied,
 * profileMigrationVersion is bumped and the migration never re-runs.
 *
 * To add a new migration:
 *   1. Add `if (storedMigrationVersion < N) { ... }` block below.
 *   2. Update PROFILE_MIGRATION_VERSION to N.
 *   3. The migration will run for all profiles with profileMigrationVersion < N.
 *
 * @returns true if any mutation was made
 */
export const PROFILE_MIGRATION_VERSION = 3;

export function applyProfileMigrations(profileCopy: ProfileV2): boolean {
  const storedMigrationVersion = profileCopy.profileMigrationVersion ?? 0;

  if (storedMigrationVersion >= PROFILE_MIGRATION_VERSION) {
    return false;
  }

  // ─── Migration V1 (cutoff: v2.7.2, 2026-04-04) ───
  if (storedMigrationVersion < 1) {
    // 1a. freDone: determine initial value based on whether this is a default profile
    if (profileCopy.freDone === undefined || typeof profileCopy.freDone !== 'boolean') {
      const isDefault = isDefaultProfile(profileCopy);
      profileCopy.freDone = !isDefault;
    }

    // 1b. Per-chat: normalize legacy knowledge fields → knowledge object
    if (profileCopy.chats && Array.isArray(profileCopy.chats)) {
      for (let index = 0; index < profileCopy.chats.length; index++) {
        const chat = profileCopy.chats[index];
        if (!chat.agent) continue;

        const hasLegacyKnowledgeFields = chat.agent.knowledgeBase !== undefined;
        if (hasLegacyKnowledgeFields) {
          profileCopy.chats[index] = {
            ...chat,
            agent: withNormalizedAgentKnowledge(chat.agent)
          };
        }

        // 1d. Normalize legacy mcp_servers string format → object format
        const rawMcpServers = chat.agent.mcp_servers || [];
        const hasLegacyFormat = rawMcpServers.some(s => typeof s === 'string');
        if (hasLegacyFormat) {
          const cleaned = rawMcpServers
            .map(server => {
              if (typeof server === 'string') {
                return { name: server, tools: [] };
              } else if (server && typeof server === 'object' && server.name) {
                return { name: server.name, tools: Array.isArray(server.tools) ? server.tools : [] };
              }
              return null;
            })
            .filter((server): server is { name: string; tools: string[] } => server !== null && server.name !== '');
          const currentChat = profileCopy.chats[index];
          profileCopy.chats[index] = {
            ...currentChat,
            agent: { ...currentChat.agent!, mcp_servers: cleaned }
          };
        }
      }
    }
  }

  // ─── Migration V2 (cutoff: v2.7.3, 2026-04-05) ───
  if (storedMigrationVersion < 2) {
    if (profileCopy.chats && Array.isArray(profileCopy.chats)) {
      for (let index = 0; index < profileCopy.chats.length; index++) {
        const chat = profileCopy.chats[index];
        if (!chat.agent) continue;

        const normalizedAgent = withNormalizedAgentKnowledge(chat.agent);
        const normalizedChat = {
          ...chat,
          agent: normalizedAgent,
        };
        restoreRegressedKnowledgeDeliveryDirectories(normalizedChat);
        profileCopy.chats[index] = normalizedChat;
      }
    }
  }

  // ─── Migration V3 (cutoff: v2.8.0, 2026-05-23) ───
  if (storedMigrationVersion < 3) {
    // V3: Rename kosmos → openkosmos in feature flags and placeholders
    // Feature flags: openkosmosFeature* → openkosmosFeature*, openkosmosUse* → openkosmosUse*, openkosmosPath* → openkosmosPath*
    if ((profileCopy as any).featureFlags && typeof (profileCopy as any).featureFlags === 'object') {
      const oldFlags = (profileCopy as any).featureFlags as Record<string, any>;
      const newFlags: Record<string, any> = {};
      for (const [key, value] of Object.entries(oldFlags)) {
        const newKey = key.replace(/^kosmos/, 'openkosmos');
        newFlags[newKey] = value;
      }
      (profileCopy as any).featureFlags = newFlags;
    }
    // Placeholders: @OpenKosmos_ → @OPENKOSMOS_ in MCP server env values
    if (profileCopy.mcp_servers && Array.isArray(profileCopy.mcp_servers)) {
      for (const server of profileCopy.mcp_servers) {
        if (server.env && typeof server.env === 'object') {
          for (const [key, value] of Object.entries(server.env)) {
            if (typeof value === 'string' && value.includes('@OpenKosmos_')) {
              (server.env as Record<string, string>)[key] = value.replace(/@OpenKosmos_/g, '@OPENKOSMOS_');
            }
          }
        }
      }
    }
  }

  profileCopy.profileMigrationVersion = PROFILE_MIGRATION_VERSION;
  return true;
}

/**
 * Part 2: Built-in Defaults Migration (version-controlled via builtinDefaultsVersion)
 *
 * Manages builtin-tools server and builtin skills across agent upgrades.
 * See BUILTIN_SKILL_CHANGELOG in src/shared/constants/builtinSkills.ts for the changelog pattern.
 *
 * @returns true if any mutation was made
 */
export function applyBuiltinDefaultsMigrations(profileCopy: ProfileV2): boolean {
  const BUILTIN_SERVER_NAME = 'builtin-tools';
  const storedBuiltinVersion = profileCopy.builtinDefaultsVersion ?? 0;

  if (storedBuiltinVersion >= BUILTIN_DEFAULTS_VERSION) {
    return false;
  }

  for (const chat of profileCopy.chats) {
    if (!chat.agent) continue;

    // Skip built-in agents (already handled by backfill)
    if (isBuiltinAgent(chat.agent.name)) continue;

    // 1. Ensure builtin-tools server with all tools enabled (initial migration only).
    if (storedBuiltinVersion === 0) {
      const mcpServers = chat.agent.mcp_servers || [];
      const builtinIdx = mcpServers.findIndex(s => s.name === BUILTIN_SERVER_NAME);
      if (builtinIdx === -1) {
        chat.agent.mcp_servers = [
          { name: BUILTIN_SERVER_NAME, tools: [] },
          ...mcpServers,
        ];
      } else if (mcpServers[builtinIdx].tools && mcpServers[builtinIdx].tools.length > 0) {
        mcpServers[builtinIdx].tools = [];
      }
    }

    // 2. Add incremental skills from new versions only
    const currentSkills = chat.agent.skills || [];
    for (let v = storedBuiltinVersion + 1; v <= BUILTIN_DEFAULTS_VERSION; v++) {
      const newSkills = BUILTIN_SKILL_CHANGELOG[v] || [];
      for (const skill of newSkills) {
        if (!currentSkills.includes(skill)) {
          currentSkills.push(skill);
        }
      }
    }
    chat.agent.skills = currentSkills;
  }

  profileCopy.builtinDefaultsVersion = BUILTIN_DEFAULTS_VERSION;
  return true;
}
