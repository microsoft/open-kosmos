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
import { BRAND_NAME } from '@shared/constants/branding';
import { agentIdOf, getChatPrimaryAgent } from './agentAccessor';
import { ensureInlineAgentIds, migrateWorkspaceToChat } from './agentExtraction';
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
    const workspace = chat.workspace?.trim() || chat.agent?.workspace?.trim();
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
      workspace: chat.workspace || chat.agent?.workspace,
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
export const PROFILE_MIGRATION_VERSION = 7;

function isLegacyHiddenMemexServer(server: {
  name?: string;
  hidden?: boolean;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
} | null | undefined): boolean {
  return server?.hidden === true
    && typeof server.name === 'string'
    && server.name.startsWith('memex-')
    && server.transport === 'stdio'
    && server.command === 'memex'
    && Array.isArray(server.args)
    && server.args.length === 1
    && server.args[0] === 'mcp'
    && typeof server.env?.MEMEX_HOME === 'string'
    && server.env.MEMEX_HOME.length > 0;
}

function isLegacyMemexServerBinding(server: { name?: string } | null | undefined, removedNames: Set<string>): boolean {
  return typeof server?.name === 'string' && removedNames.has(server.name);
}

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

        const hasLegacyKnowledgeFields = chat.agent.knowledgeBase !== undefined
          || (chat.agent as typeof chat.agent & { teams_enabled?: unknown }).teams_enabled !== undefined
          || (chat.agent as typeof chat.agent & { teams_chats?: unknown }).teams_chats !== undefined
          || (chat.agent as typeof chat.agent & { outlook_emails_enabled?: unknown }).outlook_emails_enabled !== undefined;
        if (hasLegacyKnowledgeFields) {
          profileCopy.chats[index] = {
            ...chat,
            agent: withNormalizedAgentKnowledge(chat.agent)
          };
        }

        // 1c. Normalize legacy mcp_servers string format → object format
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

  // ─── Migration V3 (cutoff: v2.7.4, 2026-04-09) ───
  if (storedMigrationVersion < 3) {
    if (profileCopy.chats && Array.isArray(profileCopy.chats)) {
      for (let index = 0; index < profileCopy.chats.length; index++) {
        const chat = profileCopy.chats[index];
        if (!chat.agent) continue;

        const legacyAgent = chat.agent as typeof chat.agent & {
          teams_enabled?: unknown;
          teams_chats?: unknown;
          outlook_emails_enabled?: unknown;
          knowledge?: Record<string, unknown>;
        };

        const hasRemovedLegacyKnowledgeFields = legacyAgent.teams_enabled !== undefined
          || legacyAgent.teams_chats !== undefined
          || legacyAgent.outlook_emails_enabled !== undefined
          || legacyAgent.knowledge?.teams_enabled !== undefined
          || legacyAgent.knowledge?.teams_chats !== undefined
          || legacyAgent.knowledge?.outlook_emails_enabled !== undefined;

        if (!hasRemovedLegacyKnowledgeFields) {
          continue;
        }

        profileCopy.chats[index] = {
          ...chat,
          agent: withNormalizedAgentKnowledge(chat.agent),
        };
      }
    }
  }

  // ─── Migration V4 (cutoff: v2.8.8, 2026-06-10) ───
  // Native memex replaced the old hidden stdio-MCP servers. Remove only the
  // system-managed hidden memex server configs and stale agent bindings; keep
  // the on-disk memex_memory card trees untouched.
  if (storedMigrationVersion < 4) {
    const legacyMemexServerNames = new Set(
      (profileCopy.mcp_servers || [])
        .filter(isLegacyHiddenMemexServer)
        .map((server) => server.name),
    );

    if (legacyMemexServerNames.size > 0) {
      profileCopy.mcp_servers = (profileCopy.mcp_servers || []).filter(
        (server) => !isLegacyHiddenMemexServer(server),
      );
    }

    if (profileCopy.chats && Array.isArray(profileCopy.chats)) {
      for (const chat of profileCopy.chats) {
        if (!chat.agent?.mcp_servers) continue;
        chat.agent.mcp_servers = chat.agent.mcp_servers.filter(
          (server) => !isLegacyMemexServerBinding(server, legacyMemexServerNames),
        );
      }
    }
  }

  // ─── Migration V5 (cutoff: 2026-06-27) ───
  // Installed global MCP server extraction: the profile-level `mcp_servers` slice now
  // lives in a sibling `mcp.json` file instead of inside `profile.json`.
  //
  // Seeding `mcp.json` from the legacy in-profile slice happens at load time in
  // `McpConfigManager.resolveFromDisk`, which runs BEFORE this migration, so by
  // the time we get here `profileCopy.mcp_servers` already holds the resolved
  // installed server configs (either freshly seeded from profile.json or loaded from an existing
  // mcp.json). ProfileCacheManager commits these post-migration configs to
  // mcp.json BEFORE persisting the bumped profileMigrationVersion, so V4 MCP
  // cleanup remains retryable if the sidecar write fails. This version bump
  // exists to (a) guarantee a write so profile.json is rewritten without the
  // now-extracted field, and (b) record that the extraction ran. No in-object
  // data transform is required here.
  if (storedMigrationVersion < 5) {
    // Intentionally empty: ProfileCacheManager persists `mcp_servers` to mcp.json
    // and omits it from profile.json on the write triggered by this bump.
  }

  // ─── Migration V6 ───
  // Agent/chat separation (1 Chat : N Agents). This single version bump carries
  // every profile-shape change introduced by this PR; the whole PR is unreleased
  // (main is at V5), so there is no intermediate released state to stay compatible
  // with and all of the work below MUST live under one gate.
  //
  // (a) Derive each chat's agent id list into `chat.agent_ids` from the inline
  //     agent(s) so the mapping exists before consumers/disk extraction flip over.
  //     Each inline agent that lacks an id is first minted a stable,
  //     name-independent UUID (`ensureInlineAgentIds`), so migrated agents get the
  //     same UUID id as brand-new ones — the migration never derives an id from the
  //     agent name. The minted id then flows to `agent_ids`, the standalone store,
  //     and the knowledge relocation (all read it back through `agentIdOf`). Inline
  //     `agent`/`agents` are intentionally retained for now; physical knowledge
  //     relocation runs as an idempotent per-load sidecar
  //     (migrateKnowledgeToAgentStore), and dropping archived_agents.json stays
  //     deferred so this transform is reversible.
  // (b) Primary chat identity: the profile-level `primaryAgent` field stored an
  //     agent *name*, which broke whenever the agent was renamed and could not
  //     disambiguate two chats sharing the same agent. It is replaced by
  //     `primaryChat`, holding the stable `chat_id` of the primary chat. We resolve
  //     the legacy name to its owning chat (via the chat's primary agent) and store
  //     that chat_id; the legacy field is then dropped. An unmatched name leaves
  //     `primaryChat` unset, so runtime selection falls back to the first chat.
  // (c) Workspace ownership: legacy `chat.agent.workspace` moves to
  //     `chat.workspace`, because workspace follows the chat while
  //     `agent.knowledge.knowledgeBase` follows the agent.
  if (storedMigrationVersion < 6) {
    if (profileCopy.chats && Array.isArray(profileCopy.chats)) {
      for (const chat of profileCopy.chats) {
        if (Array.isArray(chat.agent_ids) && chat.agent_ids.length > 0) {
          continue;
        }
        ensureInlineAgentIds(chat);
        const inline = Array.isArray(chat.agents) && chat.agents.length > 0
          ? chat.agents
          : chat.agent
            ? [chat.agent]
            : [];
        const ids = inline
          .filter((a) => a && a.name)
          .map((a) => agentIdOf(a));
        if (ids.length > 0) {
          chat.agent_ids = ids;
        }
      }
    }
    migrateWorkspaceToChat(profileCopy);

    // (b) primaryAgent (name) -> primaryChat (chat_id). Resolved here while inline
    // agents are still present (stripping happens after migration), so the owning
    // chat can be found by its primary agent's name.
    const legacyPrimaryAgent = (profileCopy as { primaryAgent?: unknown }).primaryAgent;
    if (typeof legacyPrimaryAgent === 'string' && legacyPrimaryAgent) {
      const chats = Array.isArray(profileCopy.chats) ? profileCopy.chats : [];
      const owningChat = chats.find((chat) => getChatPrimaryAgent(chat)?.name === legacyPrimaryAgent);
      if (owningChat?.chat_id) {
        profileCopy.primaryChat = owningChat.chat_id;
      }
    }
    delete (profileCopy as { primaryAgent?: unknown }).primaryAgent;
  }

  // ─── Migration V7 ───
  // Remote channels were removed. Drop the legacy configuration without
  // inspecting credentials or attempting to reconnect.
  if (storedMigrationVersion < 7) {
    delete (profileCopy as ProfileV2 & { remoteChannels?: unknown }).remoteChannels;
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
    if (isBuiltinAgent(chat.agent.name, BRAND_NAME)) continue;

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
