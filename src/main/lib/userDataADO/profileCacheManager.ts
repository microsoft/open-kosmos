import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';
import { featureFlagManager } from '../featureFlags/featureFlagManager';
import {
  Profile,
  ProfileV2,
  ChatConfig,
  ChatConfigRuntime,
  ChatAgent,
  ChatSession,
  StarredChatSessionIndexItem,
  McpServerConfig,
  HookDefinition,
  isProfileV2,
  VoiceInputSettings,
  DevToolsMcpSettings,
  CodingAgentSettings,
  SyncSettings,
  ConfirmationSettings,
  BrowserSettings,
  MemexSettings,
  ComputerUseSettings,
  DEFAULT_COMPUTER_USE_SETTINGS,
} from './types/profile';
import { ChatSessionFile } from './chatSessionFileOps';
import { chatSessionManager } from './chatSessionManager';
import { getExternalAgentService } from '../../startup/lazy';
import { chatSessionStore } from '../chat/chatSessionStore';
import { BRAND_NAME } from '@shared/constants/branding';
import { BUILTIN_DEFAULTS_VERSION } from '../../../shared/constants/builtinSkills';
import {
  sanitizeProfileV2,
  sanitizeStarredChatSessions,
  buildStarredChatSessionIndexItem,
  createDefaultChat,
  generateChatId,
} from './profileSanitizer';
import {
  PROFILE_MIGRATION_VERSION,
  applyProfileMigrations,
  applyBuiltinDefaultsMigrations,
  isDefaultProfile,
  isDefaultChatConfig,
} from './profileMigration';
import { stripInlineChatAgentsForDisk, runAgentStoreMigrations, seedNewProfileAgents, syncInlineChatAgentsToStore } from './agentExtraction';
import { getRegistryAgentsByIds, getAllRegistryAgents, clearRegistry } from './agentStoreManager';
import type { AgentConfig } from './types/agentStore';
import { setAccessorAgentResolver } from './agentAccessor';
import {
  emitSidecarChangeEvents,
  buildRendererProfilePayload,
  mapChatSessionProjection,
  findNotificationTargetWindow,
} from './profileNotificationHelpers';
import { attachDerivedChatWorkspaces, stripDerivedChatWorkspacesForDisk } from './chatWorkspaceDerivation';
import { backupProfileDirectoryBeforeMutation } from './profileBackupManager';
import { findAgentlessActiveChatIds } from './profileRelationshipGuards';
import * as settingsCrud from './profileSettingsCrud';
import type { SettingsCrudContext } from './profileSettingsCrud';
import * as archiveOps from './profileArchiveManager';
import type { ArchiveContext } from './profileArchiveManager';
import { skillsConfigManager } from './skillsConfigManager';
import { chatSkillSnapshotStore } from './chatSkillSnapshotStore';
import * as entityCrud from './profileEntityCrud';
import type { EntityCrudContext } from './profileEntityCrud';
import * as hookCrud from './profileHookCrud';
import * as chatCrud from './profileChatCrud';
import type { ChatCrudContext } from './profileChatCrud';
import * as chatSessionOps from './profileChatSessionOps';
import type { ChatSessionOpsContext } from './profileChatSessionOps';
import { mcpConfigManager } from './mcpConfigManager';
import { hooksConfigManager } from './hooksConfigManager';
import { fingerprintProfileForDirtyCheck, tryCommitMcpServers, tryCommitSkills, tryCommitHooks, loadSkillRegistryForProfile, loadHookRegistryForProfile } from './profileMcpHandoff';
import { writeFileAtomicallyWithRetry } from './atomicFileWrite';
import { ghcModelsManager } from "../llm/ghcModelsManager";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { agentChatManager } from "../chat/agentChatManager";

/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction';

export function getChangedTopLevelKeys(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return [];
  }

  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  return Array.from(keys)
    .filter((key) => JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]))
    .sort();
}

/**
 * Runtime state for MCP servers (memory-only, not persisted to profile.json)
 */
export interface MCPServerRuntimeState {
  serverName: string;
  status: MCPServerStatus;
  tools: { name: string; description?: string; inputSchema: any }[];
  lastError: Error | null;
}

// 🔧 Cleanup: DataSnapshot interface removed; data-change detection is no longer performed

// Initialize logger
const logger = createConsoleLogger();

// Advanced logger for detailed MCP operations
let advancedLogger: any = null;
try {
  advancedLogger = logger;
} catch (error) {
  // Fallback to console if advanced logger fails
  advancedLogger = console;
}

/**
 * Get the Electron app instance, supporting mock in test environments.
 */
function getElectronApp() {
  try {
    // Check for a global mock in test environments
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }

    return app;
  } catch (error) {
    // Return null if Electron cannot be imported (e.g., in test environments)
    return null;
  }
}

/**
 * ProfileCacheManager manages the caching and persistence of user profiles.
 * Primary responsibilities:
 * 1. Load and create profile.json
 * 2. Update selectedModel in cache and file
 * 3. Manage model configs
 * 4. Manage MCP server configs
 * Note: No longer responsible for auth-related caching and operations.
 *
 * 📖 Development guide: when adding new profile-level config fields, see:
 * src/main/lib/userDataADO/README.md — "Profile-Level Config Development Guide"
 * The guide uses MCP Servers (mcp_servers) as the reference implementation, covering
 * type definitions, integrity migration, frontend sync
 * (ProfileCacheManager ↔ ProfileDataManager IPC), and the Feature Manager pattern.
 */
export class ProfileCacheManager {
  private static instance: ProfileCacheManager;
  private cache: Map<string, ProfileV2> = new Map();
  // Fingerprint of durable profile.json, excluding mcp_servers and updatedAt.
  private lastProfileFingerprint: Map<string, string> = new Map();
  private profileBackupFailedAliases = new Set<string>();
  private profileDataManager: any = null; // Frontend ProfileDataManager instance
  // 🆕 Refactored: MCP runtime state is now managed directly by mcpClientManager; no longer cached here
  private currentUserAlias: string | null = null; // Current user alias
  private mcpClientManager: any = null; // Reference to the MCP client manager
  private lastNotifyTime: number = 0; // Timestamp of last notification, used to throttle retries

  // Batched notification mechanism
  private notificationTimeout: NodeJS.Timeout | null = null;
  private pendingNotification = false;
  private batchedUpdates = new Set<string>(); // Tracks user aliases with pending updates

  private mainWindow: BrowserWindow | null = null; // Reference to the main window

  // Data-change detection — disabled; all notifications are sent directly
  // private lastSentSnapshots: Map<string, DataSnapshot> = new Map(); // user alias -> last sent data snapshot

  private constructor() {
    this.initializeProfileDataManager();
    // Accessor SSOT: resolve a chat's agent_ids from the active profile's
    // registry so main consumers see agents even though the cached profile keeps
    // only ids. Bound to the current user's profile dir.
    setAccessorAgentResolver((ids) =>
      this.currentUserAlias
        ? getRegistryAgentsByIds(this.getProfileDirectoryPath(this.currentUserAlias), ids)
        : [],
    );
  }

  static getInstance(): ProfileCacheManager {
    if (!ProfileCacheManager.instance) {
      ProfileCacheManager.instance = new ProfileCacheManager();
    }
    return ProfileCacheManager.instance;
  }

  public getCurrentUserAlias(): string | null {
    return this.currentUserAlias;
  }

  /**
   * Set the main window reference.
   * @param window Main window instance
   */
  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Initialize communication with the frontend ProfileDataManager.
   */
  private async initializeProfileDataManager(): Promise<void> {
    try {
      // In the main process we communicate with the frontend ProfileDataManager via IPC.
      // The interface is retained here; actual communication is implemented through IPC.
    } catch (error) {
    }
  }

  /**
   * Get the profile directory path.
   */
  private getProfileDirectoryPath(alias: string): string {
    const electronApp = getElectronApp();
    if (!electronApp) {
      throw new Error('Electron app not available');
    }
    const appPath = electronApp.getPath('userData');
    return path.join(appPath, 'profiles', alias);
  }

  /**
   * Snapshot the registered agents for an alias from the in-memory registry hot
   * cache. Feeds the granular `agents:changed` push and the `agents:getAll`
   * pull for the normalized renderer agent cache. Encapsulates the private
   * profile-dir resolution so IPC callers do not need it.
   */
  getRegisteredAgents(alias: string): AgentConfig[] {
    return getAllRegistryAgents(this.getProfileDirectoryPath(alias));
  }

  /**
   * Emit the per-sidecar change events (agents/skills/hooks) to a window. Thin
   * wrapper over {@link emitSidecarChangeEvents} that supplies the current
   * store-backed slices; kept as a method so performNotification and unit tests
   * can invoke it with just (window, alias). See profileNotificationHelpers.ts.
   */
  private emitSidecarChangeEvents(targetWindow: BrowserWindow, alias: string): void {
    emitSidecarChangeEvents(targetWindow.webContents, alias, {
      agents: this.getRegisteredAgents(alias),
      skills: skillsConfigManager.getSkills(alias),
      hooks: hooksConfigManager.getHooks(alias),
    });
  }

  /**
   * Get the profile.json file path.
   */
  private getProfileFilePath(alias: string): string {
    return path.join(this.getProfileDirectoryPath(alias), 'profile.json');
  }

  /**
   * Ensure a directory exists, creating it recursively if necessary.
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Read a profile from file (V2 format only).
   */
  private async readProfileFromFile(alias: string): Promise<ProfileV2 | null> {
    try {
      const profileDir = this.getProfileDirectoryPath(alias);
      const profilePath = this.getProfileFilePath(alias);

      if (!fs.existsSync(profilePath)) {
        return null;
      }

      const backupResult = await backupProfileDirectoryBeforeMutation(profileDir, alias);
      if (!backupResult.success) {
        this.profileBackupFailedAliases.add(alias);
        logger.error(
          '[ProfileCacheManager] Refusing to load mutable profile path because startup backup failed',
          'readProfileFromFile',
          { alias, error: backupResult.error },
        );
        return null;
      }
      this.profileBackupFailedAliases.delete(alias);

      const content = await fs.promises.readFile(profilePath, 'utf-8');

      // Parse JSON (may contain syntax errors)
      let rawProfile: any;
      try {
        rawProfile = JSON.parse(content);
      } catch (parseError) {
        throw new Error(`Invalid JSON in profile file: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

      // Check whether the data is in V2 format
      if (!isProfileV2(rawProfile)) {
        logger.error(
          '[ProfileCacheManager] Existing profile.json is not a valid V2 profile; refusing to treat it as a new user',
          'readProfileFromFile',
          { alias },
        );
        return null;
      }

      const legacySlice = Array.isArray((rawProfile as ProfileV2).mcp_servers)
        ? (rawProfile as ProfileV2).mcp_servers
        : undefined;
      await mcpConfigManager.resolveFromDisk(alias, legacySlice);
      (rawProfile as ProfileV2).mcp_servers = [...mcpConfigManager.getServers(alias)];

      // Hydrate the global skill registry (skills.json) into memory BEFORE the mcp.json
      // gate below (mirrors the MCP resolveFromDisk) so an early return on mcp.json failure
      // can't leave the registry empty and let a later CRUD drop legacy skills. Memory-only.
      const legacySkillSlice = Array.isArray((rawProfile as ProfileV2).skills)
        ? (rawProfile as ProfileV2).skills
        : undefined;
      await skillsConfigManager.resolveFromDisk(alias, legacySkillSlice);

      // Hydrate hooks.json into memory too, so an early return can't drop legacy
      // hooks. Only the list is hydrated here; `hooksEnabled` stays on the body.
      const legacyHookSlice = Array.isArray((rawProfile as ProfileV2).hooks)
        ? (rawProfile as ProfileV2).hooks
        : undefined;
      await hooksConfigManager.resolveFromDisk(alias, legacyHookSlice);

      // Seed mcp.json before any profile write can strip the legacy slice.
      const initialServersCommitted = await tryCommitMcpServers(
        alias,
        mcpConfigManager.getServers(alias),
        'readProfileFromFile',
        '[ProfileCacheManager] Failed to persist mcp.json during profile load; keeping existing profile.json intact',
      );
      if (!initialServersCommitted) {
        return this.sanitizeKeepingProfileIntact(rawProfile as ProfileV2, alias);
      }

      // null = the migration write failed (see loadSkillRegistryForProfile); keep
      // profile.json intact instead of falling through to the default-reset catch-all.
      const loadedSkills = await loadSkillRegistryForProfile(alias, rawProfile as ProfileV2);
      if (!loadedSkills) {
        return this.sanitizeKeepingProfileIntact(rawProfile as ProfileV2, alias);
      }
      (rawProfile as ProfileV2).skills = loadedSkills.skills;

      // Same migration handoff for the global Agent Hook library (hooks.json).
      const loadedHooks = await loadHookRegistryForProfile(alias, rawProfile as ProfileV2);
      if (!loadedHooks) {
        // Mirror the mcp.json / skills.json failure paths: this early return skips
        // ensureV2ProfileIntegrity(), so without sanitizing here the returned profile
        // would still expose orphaned retired-plugin agent bindings (plugin--* in an
        // agent's mcp_servers, which acts as an allowlist and would zero its tools).
        return this.sanitizeKeepingProfileIntact(rawProfile as ProfileV2, alias);
      }
      (rawProfile as ProfileV2).hooks = loadedHooks.hooks;

      // V2 format: verify and ensure integrity of chatSessions fields. Force a profile.json
      // rewrite when either sidecar migration stripped a legacy slice.
      const sanitizedProfile = await this.ensureV2ProfileIntegrity(alias, rawProfile as ProfileV2, loadedSkills.needsProfileRewrite || loadedHooks.needsProfileRewrite);

      await tryCommitMcpServers(
        alias,
        sanitizedProfile.mcp_servers ?? [],
        'readProfileFromFile',
        '[ProfileCacheManager] Failed to persist post-migration mcp.json during profile load; keeping previously committed MCP server configs',
      );
      delete (sanitizedProfile as Partial<ProfileV2>).mcp_servers;

      // Strip the registry from the cached profile (mirroring mcp_servers); loadForAlias
      // already persisted skills.json and the renderer payload re-injects it.
      delete (sanitizedProfile as Partial<ProfileV2>).skills;

      // Strip the hook list too (loadForAlias already persisted hooks.json and the
      // renderer re-injects it); keep hooksEnabled, which stays in profile.json.
      delete (sanitizedProfile as Partial<ProfileV2>).hooks;

      // Strip inline agent/agents from the cached profile (keeping agent_ids).
      // The standalone store is the SSOT; memory holds ids only. Chat workspace is
      // derived in memory from alias + chat_id and is not persisted in profile.json.
      const cachedProfile = attachDerivedChatWorkspaces(
        alias,
        stripInlineChatAgentsForDisk(this.getProfileDirectoryPath(alias), sanitizedProfile),
      );

      this.lastProfileFingerprint.set(
        alias,
        fingerprintProfileForDirtyCheck(stripDerivedChatWorkspacesForDisk(this.sanitizeProfile(cachedProfile))),
      );
      return cachedProfile;
    } catch (error) {
      logger.error(
        '[ProfileCacheManager] Failed to read existing profile.json',
        'readProfileFromFile',
        { alias, error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /**
   * Sanitize and validate the profile data structure (V2 only).
   */
  private sanitizeProfile(profile: ProfileV2): ProfileV2 {
    try {
      return sanitizeProfileV2(profile);
    } catch (error) {
      return this.createDefaultProfile('') as ProfileV2;
    }
  }

  /**
   * Sanitize a profile on a load FAILURE path (e.g. mcp.json / skills.json / hooks.json
   * could not be persisted) where we deliberately keep profile.json on disk intact.
   *
   * These paths return early, before ensureV2ProfileIntegrity() runs, so without this
   * the returned profile would skip sanitizeProfileV2() and still expose orphaned
   * retired-plugin MCP servers / skills (source:'PLUGIN' or plugin--* bindings). We
   * therefore strip them in-memory here via the single source of truth
   * (sanitizeProfileV2), WITHOUT writing to disk. sanitizeProfileV2 never throws (it
   * has its own internal fallback), so this cannot escalate the failure path into the
   * profile-resetting outer catch.
   */
  private sanitizeKeepingProfileIntact(profile: ProfileV2, alias: string): ProfileV2 {
    const sanitized = sanitizeProfileV2(profile);
    // Preserve alias (sanitizeProfileV2 may produce empty string from raw data).
    sanitized.alias = profile.alias || alias;
    return sanitized;
  }

  async syncStarredChatSessionIndex(
    alias: string,
    chatId: string,
    session: Partial<ChatSession>,
    options?: { notifyRenderer?: boolean },
  ): Promise<boolean> {
    return entityCrud.withProfileWriteLock(alias, async () => {
      const cachedProfile = this.cache.get(alias);
      if (!cachedProfile || !session.chatSession_id) {
        return false;
      }

      const currentItems = cachedProfile['starred-chat-sessions'] || [];
      const existingItem = currentItems.find((item) => item.chatSessionId === session.chatSession_id);
      const shouldRemove = session.starred === false;
      const shouldTrack = session.starred === true || !!existingItem;

      if (!shouldRemove && !shouldTrack) {
        return false;
      }

      let nextItems = currentItems.filter((item) => item.chatSessionId !== session.chatSession_id);
      if (!shouldRemove) {
        const nextItem = buildStarredChatSessionIndexItem(cachedProfile, chatId, session, existingItem?.starredAt);
        if (!nextItem) {
          return false;
        }
        nextItems = [nextItem, ...nextItems].sort(
          (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
        );
      }

      if (JSON.stringify(currentItems) === JSON.stringify(nextItems)) {
        return false;
      }

      const nextProfile: ProfileV2 = {
        ...cachedProfile,
        'starred-chat-sessions': nextItems,
      };

      return entityCrud.writeProfileThenCommitCache(
        this.entityCtx(),
        alias,
        cachedProfile,
        nextProfile,
        true,
        options?.notifyRenderer !== false,
      );
    });
  }

  async removeStarredChatSessionIndex(
    alias: string,
    chatSessionId: string,
    options?: { notifyRenderer?: boolean },
  ): Promise<boolean> {
    return entityCrud.withProfileWriteLock(alias, async () => {
      const cachedProfile = this.cache.get(alias);
      if (!cachedProfile) {
        return false;
      }

      const currentItems = cachedProfile['starred-chat-sessions'] || [];
      const nextItems = currentItems.filter((item) => item.chatSessionId !== chatSessionId);
      if (nextItems.length === currentItems.length) {
        return false;
      }

      const nextProfile: ProfileV2 = {
        ...cachedProfile,
        'starred-chat-sessions': nextItems,
      };

      return entityCrud.writeProfileThenCommitCache(
        this.entityCtx(),
        alias,
        cachedProfile,
        nextProfile,
        true,
        options?.notifyRenderer !== false,
      );
    });
  }

  /**
   * Ensure V2 Profile data integrity (migration + backfill)
   *
   * ═══════════════════════════════════════════════════════════════════
   * 📖 Development guide — MUST READ when adding new fields:
   * src/main/lib/userDataADO/README.md — "3a. ensureV2ProfileIntegrity — called on every read"
   * ═══════════════════════════════════════════════════════════════════
   * 📖 Method overview
   * ═══════════════════════════════════════════════════════════════════
   *
   * Called immediately after readProfileFromFile() reads profile.json.
   * The method is organized into three parts:
   *
   * Part 1: One-time Migrations (version-controlled via profileMigrationVersion)
   *   - Destructive or irreversible data transformations (e.g., removing deprecated fields,
   *     converting legacy formats). Each migration runs only once per profile lifetime.
   *   - To add a new migration: add a case in the switch, bump PROFILE_MIGRATION_VERSION.
   *
   * Part 2: Built-in Defaults Migration (version-controlled via builtinDefaultsVersion)
   *   - Manages builtin-tools server and builtin skills across agent upgrades.
   *   - Already version-controlled; see BUILTIN_SKILL_CHANGELOG for the changelog pattern.
   *
   * Part 3: Normalize via sanitizeProfileV2 (single source of truth)
   *   - After migrations, pre-fills empty workspace paths (requires alias context),
   *     then delegates all schema normalization and default-filling to sanitizeProfileV2().
   *   - sanitizeProfileV2 is the single source of truth for profile structure.
   *     Adding a new field only requires updating sanitizeProfileV2 — no separate backfill needed.
   *   - The result is compared with the original to detect if a write is needed.
   *
   * If any field is modified, the result is automatically written back to profile.json.
   *
   * ═══════════════════════════════════════════════════════════════════
   * ⚠️ Editing guidelines (MUST READ BEFORE EDITING)
   * ═══════════════════════════════════════════════════════════════════
   *
   * [Deep-copy rule]
   *   - Use JSON.parse(JSON.stringify(profile)) to deep-copy at the entry point.
   *   - Never use { ...profile } (shallow copy), because nested arrays such as
   *     chats/mcp_servers/skills share references; mutating profileCopy's inner
   *     properties would unexpectedly affect the original profile object.
   *
   * [Adding a new one-time migration (Part 1)]
   *   1. Add `if (storedMigrationVersion < N) { ... }` block in Part 1.
   *   2. Bump PROFILE_MIGRATION_VERSION to N.
   *   3. The migration block only runs once. After completion, profileMigrationVersion is set to N.
   *
   * [Adding a new builtin defaults migration (Part 2)]
   *   See src/shared/constants/builtinSkills.ts for the step-by-step guide.
   *
   * [Adding a new field with default value]
   *   Only update sanitizeProfileV2(). It handles both read-time normalization (Part 3)
   *   and write-time normalization (writeProfileToFile). No separate backfill code needed.
   *
   * [Relationship with sanitizeProfileV2]
   *   - sanitizeProfileV2 is the single source of truth for schema normalization and default-filling.
   *   - It is called in two places: (1) ensureV2ProfileIntegrity (read-time), (2) writeProfileToFile (write-time).
   *   - This ensures the in-memory cache and on-disk data are always consistent.
   *
   * [Forbidden actions]
   *   ❌ Use { ...profile } shallow copy instead of JSON.parse(JSON.stringify(profile))
   *   ❌ Call notifyProfileDataManager inside this method (cache not yet updated; frontend would receive stale data)
   *   ❌ Mutate the input `profile` argument directly (all mutations must be on profileCopy)
   *   ❌ Add incremental field backfill logic — use sanitizeProfileV2 instead
   *
   * ═══════════════════════════════════════════════════════════════════
   */
  private async ensureV2ProfileIntegrity(alias: string, profile: ProfileV2, forceSave = false): Promise<ProfileV2> {
    try {

      let needsSave = forceSave;
      // 🔧 Deep copy: isolate the original profile to prevent accidental mutation through shared nested references.
      // See [Deep-copy rule] above.
      const profileCopy: ProfileV2 = JSON.parse(JSON.stringify(profile));

      // Part 1: One-time Migrations (version-controlled via profileMigrationVersion)
      if (applyProfileMigrations(profileCopy)) {
        needsSave = true;
      }

      // Run all agent-store migrations for this load (mirror inline agents into the
      // store, hydrate chats, heal agent_ids, consolidate workspace dirs, relocate
      // knowledge, refresh the registry). Store-only repairs self-persist, while
      // returning true keeps this load's healed profile snapshot durable too.
      if (await runAgentStoreMigrations(this.getProfileDirectoryPath(alias), profileCopy, profile)) {
        needsSave = true;
      }

      // Ensure chats array exists before Part 2 and Part 3
      if (!profileCopy.chats || !Array.isArray(profileCopy.chats)) {
        profileCopy.chats = [createDefaultChat()];
        needsSave = true;
      }

      // Part 2: Built-in Defaults Migration (version-controlled via builtinDefaultsVersion)
      if (applyBuiltinDefaultsMigrations(profileCopy)) {
        // Persist Part-2's inline builtin-defaults mutations to the store, or the disk write strips them while the version bumps. See syncInlineChatAgentsToStore.
        const builtinDefaultsSyncFailures: string[] = [];
        await syncInlineChatAgentsToStore(this.getProfileDirectoryPath(alias), profileCopy, builtinDefaultsSyncFailures);
        if (builtinDefaultsSyncFailures.length > 0) {
          logger.warn('[ProfileCacheManager] Built-in defaults store sync failed; migration will retry on next load', 'ensureV2ProfileIntegrity', {
            alias,
            agentIds: builtinDefaultsSyncFailures,
          });
          return profile;
        }
        needsSave = true;
      }

      // Part 3: Normalize via sanitizeProfileV2 (single source of truth for schema + defaults)
      // Apply sanitizeProfileV2 to normalize all fields and fill defaults
      const normalizedCopy = sanitizeProfileV2(profileCopy);
      // Preserve alias (sanitizeProfileV2 may produce empty string from raw data)
      normalizedCopy.alias = profileCopy.alias || alias;
      const diskNormalizedCopy = stripDerivedChatWorkspacesForDisk(normalizedCopy);

      // Detect whether normalization changed anything
      const originalJson = JSON.stringify(profile);
      const normalizedJson = JSON.stringify(diskNormalizedCopy);
      if (originalJson !== normalizedJson) {
        needsSave = true;
      }
      // Use the normalized copy from here on
      Object.assign(profileCopy, attachDerivedChatWorkspaces(alias, normalizedCopy));

      // If there were any modifications, persist to file immediately
      if (needsSave) {
        const changedTopLevelKeys = getChangedTopLevelKeys(profile, profileCopy);
        profileCopy.updatedAt = new Date().toISOString();

        if (mcpConfigManager.hasServersLoaded(alias) && !await tryCommitMcpServers(alias, profileCopy.mcp_servers ?? [], 'ensureV2ProfileIntegrity', '[ProfileCacheManager] Failed to persist post-migration mcp.json before profile write')) {
          return profile;
        }

        // Skills durability is enforced at the writeProfileToFile choke point below
        // (it commits skills.json before stripping), so no separate pre-commit here.
        const saveSuccess = await this.writeProfileToFile(alias, profileCopy);
        if (saveSuccess) {
          logger.info('[ProfileCacheManager] Profile integrity changes persisted', 'ensureV2ProfileIntegrity', {
            alias,
            changedTopLevelKeys,
            previousComputerUseEnabled: profile.computerUse?.enabled === true,
            nextComputerUseEnabled: profileCopy.computerUse?.enabled === true,
          });
          // 🔧 Fix: do NOT notify the frontend here. ensureV2ProfileIntegrity is only responsible for migration and persistence.
          // Notifying the frontend is handled by handleProfile after updating the cache.
          // Calling notifyProfileDataManager here would cause the frontend to receive stale data (cache not yet updated).
        }
      }

      return profileCopy;
    } catch (error) {
      // Return minimal safe config
      const fallbackChat = createDefaultChat();
      return {
        version: '2.0.0',
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        alias: profile.alias || alias,
        freDone: false,
        primaryChat: fallbackChat.chat_id,
        mcp_servers: profile.mcp_servers || [],
        skills: profile.skills || [],
        'starred-chat-sessions': Array.isArray(profile['starred-chat-sessions']) ? profile['starred-chat-sessions'] : [],
        computerUse: { ...DEFAULT_COMPUTER_USE_SETTINGS },
        chats: [fallbackChat]
      };
    }
  }

  // Migration methods extracted to ./profileMigration.ts
  // Utility methods (createDefaultChat, generateChatId) extracted to ./profileSanitizer.ts

  /**
   * Persist `profile.json` only. A pending MCP handoff is retried first so a
   * legacy top-level `mcp_servers` slice is never stripped before `mcp.json` exists.
   */
  private async writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean> {
    const profileDir = this.getProfileDirectoryPath(alias);
    const profilePath = this.getProfileFilePath(alias);
    try {
      // Ensure the directory exists
      this.ensureDirectoryExists(profileDir);

      // Clean and validate the data structure to ensure it conforms to the template schema
      const sanitizedProfile = this.sanitizeProfile(profile);
      const now = new Date().toISOString();

      if (this.profileBackupFailedAliases.has(alias)) {
        logger.error(
          '[ProfileCacheManager] Refusing to write profile because startup backup failed',
          'writeProfileToFile',
          { alias },
        );
        return false;
      }

      const agentlessChatIds = findAgentlessActiveChatIds(sanitizedProfile);
      if (agentlessChatIds.length > 0) {
        logger.error(
          '[ProfileCacheManager] Refusing to write profile with agentless active chats',
          'writeProfileToFile',
          { alias, chatIds: agentlessChatIds },
        );
        return false;
      }

      if (!mcpConfigManager.hasPersistedServers(alias) && mcpConfigManager.hasServersLoaded(alias)) {
        const serversCommitted = await tryCommitMcpServers(
          alias,
          sanitizedProfile.mcp_servers ?? mcpConfigManager.getServers(alias),
          'writeProfileToFile',
          '[ProfileCacheManager] Failed to persist mcp.json before stripping profile.json; aborting profile write',
        );
        if (!serversCommitted) {
          return false;
        }
      }

      // Symmetric guard for the global skill registry: never strip the legacy inline
      // skills slice below until skills.json durably holds it (mirrors the mcp.json gate).
      if (!skillsConfigManager.hasPersistedSkills(alias) && skillsConfigManager.hasSkillsLoaded(alias)) {
        const skillsCommitted = await tryCommitSkills(
          alias,
          sanitizedProfile.skills ?? skillsConfigManager.getSkills(alias),
          'writeProfileToFile',
          '[ProfileCacheManager] Failed to persist skills.json before stripping profile.json; aborting profile write',
        );
        if (!skillsCommitted) {
          return false;
        }
      }

      // Symmetric guard for the hook library: never strip the legacy inline hooks slice below until hooks.json durably holds it.
      if (!hooksConfigManager.hasPersistedHooks(alias) && hooksConfigManager.hasHooksLoaded(alias)) {
        const hooksCommitted = await tryCommitHooks(
          alias,
          sanitizedProfile.hooks ?? hooksConfigManager.getHooks(alias),
          'writeProfileToFile',
          '[ProfileCacheManager] Failed to persist hooks.json before stripping profile.json; aborting profile write',
        );
        if (!hooksCommitted) {
          return false;
        }
      }

      // Strip inline agent/agents from the disk copy (keeping agent_ids) once the
      // store durably holds them — same pattern as mcp_servers/skills/hooks. Seeding
      // happens upstream (integrity extract / CRUD sync); this is a read-only gate.
      const diskProfile = stripDerivedChatWorkspacesForDisk(stripInlineChatAgentsForDisk(profileDir, sanitizedProfile));

      // Top-level mcp_servers (mcp.json) and the global skill registry (skills.json)
      // are both stripped here; profile.json carries neither. Per-agent bindings stay.
      const profileFingerprint = fingerprintProfileForDirtyCheck(diskProfile);
      if (this.lastProfileFingerprint.get(alias) !== profileFingerprint) {
        const profileToWrite = { ...diskProfile } as Partial<ProfileV2>;
        delete profileToWrite.mcp_servers;
        delete profileToWrite.skills;
        // Strip the hook *list* (hooks.json); keep the master switch hooksEnabled.
        delete profileToWrite.hooks;
        profileToWrite.updatedAt = now;
        await writeFileAtomicallyWithRetry(profilePath, JSON.stringify(profileToWrite, null, 2), {
          onRetry: ({ attempt, error, delayMs }) => {
            logger.warn(
              '[ProfileCacheManager] Transient profile.json rename failure; retrying',
              'writeProfileToFile',
              { alias, attempt, delayMs, code: error.code },
            );
          },
        });
        this.lastProfileFingerprint.set(alias, profileFingerprint);
      }

      return true;
    } catch (error) {
      logger.error(
        '[ProfileCacheManager] Failed to write profile.json',
        'writeProfileToFile',
        { alias, error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }

  /**
   * Batched notification to the frontend ProfileDataManager to sync cache data.
   * 🔧 Key improvement: batching reduces frequent IPC notifications.
   * 🔧 Optimization: merges multiple status updates into a single notification during MCP initialization.
   */
  private async notifyProfileDataManager(alias: string, immediate = false): Promise<void> {

    if (immediate) {
      return this.performNotification(alias, true); // pass the immediate flag
    }

    // Add to the batch queue
    this.batchedUpdates.add(alias);

    // Use debounce to reduce frequent notifications
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }

    this.pendingNotification = true;
    this.notificationTimeout = setTimeout(() => {
      if (this.pendingNotification) {
        this.processBatchedNotifications();
      }
    }, 150); // 150 ms batch delay
  }

  /**
   * Process batched notifications.
   */
  private async processBatchedNotifications(): Promise<void> {
    if (this.batchedUpdates.size === 0) {
      return;
    }

    const aliases = Array.from(this.batchedUpdates);
    this.batchedUpdates.clear();
    this.pendingNotification = false;
    this.notificationTimeout = null;


    // Process all user notifications in parallel
    await Promise.all(aliases.map(alias => this.performNotification(alias)));
  }

  /**
   * Perform the actual notification operation.
   * 🔥 Fix: load chatSessions for each chat from chatSessionManager before sending the profile to the frontend.
   * 🆕 Refactored: no longer sends mcp:serverStatesUpdated; MCP runtime state is managed and notified directly by mcpClientManager.
   */
  private async performNotification(alias: string, forceImmediate = false): Promise<void> {
    try {

      // Get main window reference and send IPC notification.
      // Prefer the explicitly set mainWindow; otherwise locate one by brand title.
      const targetWindow = findNotificationTargetWindow(
        this.mainWindow,
        () => BrowserWindow.getAllWindows(),
        process.env.APP_NAME, // May not match window title.
      );

      if (targetWindow && !targetWindow.isDestroyed() && targetWindow.webContents) {
        const profile = this.cache.get(alias);

        // 🔥 New architecture: load chatSessions for each chat from chatSessionManager.
        // chatSessions are no longer stored in profile.json; they must be loaded dynamically.
        // Use ChatConfigRuntime type to include runtime chatSessions.
        let profileWithChatSessions: (Omit<ProfileV2, 'chats'> & { chats: ChatConfigRuntime[] }) | null = profile
          ? attachDerivedChatWorkspaces(alias, JSON.parse(JSON.stringify(profile)))
          : null;

        if (profileWithChatSessions && profileWithChatSessions.chats && profileWithChatSessions.chats.length > 0) {
          try {
            // Use a local variable reference to avoid undefined issues in closures
            const profileToUpdate = profileWithChatSessions;

            // Load chatSessions for all chats in parallel
            const loadPromises = profileToUpdate.chats.map(async (chat: ChatConfigRuntime, index: number) => {
              try {
                const result = await chatSessionStore.getChatSessionsProjection(alias, chat.chat_id);
                // Assign the loaded sessions to chat.chatSessions
                profileToUpdate.chats[index].chatSessions = result.sessions.map(mapChatSessionProjection);
              } catch (loadError) {
                logger.warn('[ProfileCacheManager] Failed to load chatSessions for chat', 'performNotification', {
                  alias,
                  chatId: chat.chat_id,
                  error: loadError instanceof Error ? loadError.message : String(loadError)
                });
                // Keep empty array on load failure
                profileToUpdate.chats[index].chatSessions = [];
              }
            });

            await Promise.all(loadPromises);

          } catch (error) {
            logger.error('[ProfileCacheManager] Failed to load chatSessions for profile notification', 'performNotification', {
              alias,
              error: error instanceof Error ? error.message : String(error)
            });
            // If loading fails, fall back to the original profile (chatSessions may be empty)
            profileWithChatSessions = profile ? attachDerivedChatWorkspaces(alias, JSON.parse(JSON.stringify(profile))) : null;
          }
        }

        const messageData = {
          alias,
          // Renderer wire body: buildRendererProfilePayload strips chats to
          // `agent_ids` only when durable (else keeps inline); mcp/skills/hooks re-attached.
          profile: profileWithChatSessions
            ? buildRendererProfilePayload(profileWithChatSessions, this.currentUserAlias || alias, {
                mcp_servers: mcpConfigManager.getServers(alias),
                skills: skillsConfigManager.getSkills(alias),
                hooks: hooksConfigManager.getHooks(alias),
              }, this.getRegisteredAgents(alias))
            : null,
          timestamp: Date.now()
        };

        // Granular per-sidecar change events (Phase 1 of renderer normalization,
        // see docs/sidecar-renderer-normalization-tech-doc.md). Emitted BEFORE the
        // agent_ids-only profile push (Phase 4) so the store-backed client caches
        // are fresh when the renderer resolves agents against them.
        this.emitSidecarChangeEvents(targetWindow, alias);

        // Send profile update notification
        targetWindow.webContents.send('profile:cacheUpdated', messageData);

        // 🆕 Refactored: no longer sends mcp:serverStatesUpdated.
        // MCP runtime state is now managed and notified to the frontend directly by mcpClientManager.

      } else {
      }
    } catch (error) {
    }
  }

  // 🔧 Cleanup: all data-change detection methods removed.
  // All notifications are now sent directly to the frontend without any filtering.

  // isDefaultProfile and isDefaultChatConfig extracted to ./profileMigration.ts

  /**
   * Create the default profile
   */
  private createDefaultProfile(alias: string): ProfileV2 {
    const now = new Date().toISOString();
    const defaultChat = createDefaultChat();

    return {
      version: '2.0.0',
      createdAt: now,
      updatedAt: now,
      alias,
      freDone: false,
      primaryChat: defaultChat.chat_id,
      mcp_servers: [],
      skills: [],
      'starred-chat-sessions': [],
      computerUse: { ...DEFAULT_COMPUTER_USE_SETTINGS },
      builtinDefaultsVersion: BUILTIN_DEFAULTS_VERSION,
      profileMigrationVersion: PROFILE_MIGRATION_VERSION,
      chats: [defaultChat]
    };
  }

  /**
   * Function 1: Handle profile.json loading and creation
   * - If a local profile.json exists, load the existing config
   * - If no local profile.json exists, create a default profile
   *
   * 🚀 Performance: MCP and AgentChat initialization is moved to background parallel execution
   * No longer blocks profile loading; the window can display faster
   */
  async handleProfile(alias: string, options?: { notifyRenderer?: boolean }): Promise<ProfileV2 | null> {
    return entityCrud.withProfileWriteLock(alias, async () => {
      try {
        const shouldNotifyRenderer = options?.notifyRenderer ?? true;

        // Set the current user alias
        this.currentUserAlias = alias;
        await this.cleanupLegacyRemoteCredentials(alias);

        // Check whether a local profile.json exists
        let profile = await this.readProfileFromFile(alias);

        if (profile) {
          // Case 1: profile.json exists — load the existing config

          // Update the cache
          this.cache.set(alias, profile);

          // Notify the frontend ProfileDataManager to sync data (immediate for profile updates)
          if (shouldNotifyRenderer) {
            await this.notifyProfileDataManager(alias, true);
          }

          // 🚀 Background parallel initialization of MCP, AgentChat (non-blocking)
          this.initializeBackgroundServices(alias);

          return profile;
        } else {
          const profilePath = this.getProfileFilePath(alias);
          if (fs.existsSync(profilePath)) {
            if (this.profileBackupFailedAliases.has(alias)) {
              logger.error(
                '[ProfileCacheManager] Refusing default-profile recovery because startup backup failed',
                'handleProfile',
                { alias },
              );
              return null;
            }
            await this.backupUnreadableProfile(alias, profilePath);
          }

          // Create the new V2 config
          const newProfileV2 = this.createDefaultProfile(alias);
          const profileDir = this.getProfileDirectoryPath(alias);

          // Seed the default chat's agent(s) into the store + stamp agent_ids BEFORE
          // the first write/push (matches migrated-profile shape). A failed store write
          // would strip the inline agent yet leave agent_ids at a missing agent.json, so
          // abort creation (return null) and let a later load retry cleanly.
          const seedFailedAgentIds: string[] = [];
          await seedNewProfileAgents(profileDir, newProfileV2, seedFailedAgentIds);
          if (seedFailedAgentIds.length > 0) {
            logger.error('[ProfileCacheManager] Aborting first-run profile creation: agent store seed failed', 'handleProfile', { alias, seedFailedAgentIds });
            return null;
          }

          // Create the profile.json file
          const success = await this.writeProfileToFile(alias, newProfileV2);
          if (!success) {
            return null;
          }

          // Resolve first so default-profile recovery never clobbers valid mcp.json.
          await mcpConfigManager.resolveFromDisk(alias, newProfileV2.mcp_servers ?? []);
          await tryCommitMcpServers(
            alias,
            mcpConfigManager.getServers(alias),
            'handleProfile',
            '[ProfileCacheManager] Failed to persist mcp.json during default profile creation; continuing with runtime MCP server configs',
          );
          delete (newProfileV2 as Partial<ProfileV2>).mcp_servers;

          // Seed skills.json the same way, then strip skills from the cached profile.
          await skillsConfigManager.loadForAlias(alias, newProfileV2);
          delete (newProfileV2 as Partial<ProfileV2>).skills;

          // Seed hooks.json the same way, then strip the list; hooksEnabled stays on newProfileV2.
          await hooksConfigManager.loadForAlias(alias, newProfileV2);
          delete (newProfileV2 as Partial<ProfileV2>).hooks;

          // Update the cache after profile.json exists on disk. Strip inline
          // agents (keeping agent_ids) so the cache matches the load-path shape.
          const cachedProfile = attachDerivedChatWorkspaces(alias, stripInlineChatAgentsForDisk(profileDir, newProfileV2));
          this.cache.set(alias, cachedProfile);

          // Notify the frontend ProfileDataManager to sync data (immediate for profile updates)
          if (shouldNotifyRenderer) {
            await this.notifyProfileDataManager(alias, true);
          }

          // 🚀 Background parallel initialization of MCP, AgentChat (non-blocking)
          this.initializeBackgroundServices(alias);

          return cachedProfile;
        }
      } catch (error) {
        return null;
      }
    });
  }

  private async backupUnreadableProfile(alias: string, profilePath: string): Promise<void> {
    const backupPath = `${profilePath}.corrupt-${Date.now()}`;
    try {
      await fs.promises.copyFile(profilePath, backupPath);
      logger.error(
        '[ProfileCacheManager] Existing profile.json could not be read; backed up original content before creating a default profile',
        'handleProfile',
        { alias, backupPath },
      );
    } catch (error) {
      logger.error(
        '[ProfileCacheManager] Failed to back up unreadable profile.json before overwriting',
        'handleProfile',
        { alias, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async cleanupLegacyRemoteCredentials(alias: string): Promise<void> {
    const credentialsDir = path.join(this.getProfileDirectoryPath(alias), 'credentials');
    const credentialPaths = [
      path.join(credentialsDir, 'teams_bindingToken.enc'),
      path.join(credentialsDir, 'teams_boundUserId.enc'),
    ];
    const results = await Promise.allSettled(
      credentialPaths.map((credentialPath) => fs.promises.rm(credentialPath, { force: true })),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn('[ProfileCacheManager] Failed to remove legacy remote credential', 'cleanupLegacyRemoteCredentials', {
          alias,
          credentialPath: credentialPaths[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }

  /**
   * 🚀 Background service initialization
   * MCP and AgentChat are initialized in parallel without blocking the main flow
   */
  private initializeBackgroundServices(alias: string): void {
    // Use Promise.allSettled to run all initializations in parallel without blocking each other
    Promise.allSettled([
      // Initialize GhcModelsManager (model list cache)
      (async () => {
        try {
          await ghcModelsManager.initialize(alias);
        } catch (modelsError) {
          logger.error(`[ProfileCacheManager] GhcModelsManager initialization failed: ${modelsError instanceof Error ? modelsError.message : String(modelsError)}`);
        }
      })(),

      // Initialize MCPClientManager
      (async () => {
        try {
          this.mcpClientManager = mcpClientManager;
          await mcpClientManager.initialize(alias);
        } catch (mcpError) {
          logger.error(`[ProfileCacheManager] MCP initialization failed: ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`);
        }
      })(),

      // Initialize AgentChatManager
      (async () => {
        try {
          await agentChatManager.initialize(alias);
        } catch (agentError) {
          logger.error(`[ProfileCacheManager] AgentChatManager initialization failed: ${agentError instanceof Error ? agentError.message : String(agentError)}`);
        }
      })(),

      // Initialize External Agent service
      (async () => {
        try {
          if (!featureFlagManager.isEnabled('openkosmosFeatureExternalAgent')) {
            return;
          }

          await getExternalAgentService(alias);
        } catch (error) {
          logger.error(`[ProfileCacheManager] External Agent initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })()
    ]).then((results) => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        logger.warn(`[ProfileCacheManager] ${failed.length} background services failed to initialize`);
      } else {
        logger.debug('[ProfileCacheManager] All background services initialized successfully');
      }
    });
  }


  // ========================================
  // MCP Server, Skill & Sub-Agent CRUD — delegated to ./profileEntityCrud.ts.
  // Installed global MCP servers are owned by ./mcpConfigManager.ts (mcp.json).
  // ========================================

  private entityCtx(): EntityCrudContext {
    return {
      cache: this.cache,
      getProfileDirectoryPath: (alias) => this.getProfileDirectoryPath(alias),
      readProfileFromFile: (alias) => this.readProfileFromFile(alias),
      writeProfileToFile: (alias, profile) => this.writeProfileToFile(alias, profile),
      notifyProfileDataManager: (alias, immediate?) => immediate !== undefined
        ? this.notifyProfileDataManager(alias, immediate)
        : this.notifyProfileDataManager(alias),
    };
  }

  async addMcpServerConfig(alias: string, mcpServerConfig: McpServerConfig): Promise<boolean> {
    return entityCrud.addMcpServerConfig(this.entityCtx(), alias, mcpServerConfig);
  }
  async updateMcpServerConfig(alias: string, serverName: string, updates: Partial<McpServerConfig>): Promise<boolean> {
    return entityCrud.updateMcpServerConfig(this.entityCtx(), alias, serverName, updates);
  }
  async deleteMcpServerConfig(alias: string, serverName: string): Promise<boolean> {
    return entityCrud.deleteMcpServerConfig(this.entityCtx(), alias, serverName);
  }
  async addSkill(alias: string, skillConfig: { name: string; description: string; version: string; remoteVersion?: string; source: 'IN-LIBRARY' | 'ON-DEVICE' }): Promise<boolean> {
    return entityCrud.addSkillConfig(this.entityCtx(), alias, skillConfig);
  }
  async updateSkill(alias: string, skillName: string, updates: { description?: string; version?: string; remoteVersion?: string }): Promise<boolean> {
    return entityCrud.updateSkillConfig(this.entityCtx(), alias, skillName, updates);
  }
  async deleteSkill(alias: string, skillName: string): Promise<boolean> {
    return entityCrud.deleteSkillConfig(this.entityCtx(), alias, skillName);
  }
  getHooks(alias: string): HookDefinition[] {
    return hookCrud.getHooks(this.entityCtx(), alias);
  }
  isHooksEnabled(alias: string): boolean {
    return hookCrud.isHooksEnabled(this.entityCtx(), alias);
  }
  async setHooksEnabled(alias: string, enabled: boolean): Promise<boolean> {
    return hookCrud.setHooksEnabled(this.entityCtx(), alias, enabled);
  }
  async addHook(alias: string, hook: HookDefinition): Promise<boolean> {
    return hookCrud.addHook(this.entityCtx(), alias, hook);
  }
  async updateHook(alias: string, hookId: string, updates: Partial<Omit<HookDefinition, 'id' | 'createdAt' | 'updatedAt'>>): Promise<boolean> {
    return hookCrud.updateHook(this.entityCtx(), alias, hookId, updates);
  }
  async deleteHook(alias: string, hookId: string): Promise<boolean> {
    return hookCrud.deleteHook(this.entityCtx(), alias, hookId);
  }

  /**
   * ========================================
   * Chat config management (delegates to profileChatCrud.ts)
   * ========================================
   */

  private chatCrudCtx(): ChatCrudContext {
    return {
      cache: this.cache,
      readProfileFromFile: (alias) => this.readProfileFromFile(alias),
      writeProfileToFile: (alias, profile) => this.writeProfileToFile(alias, profile),
      notifyProfileDataManager: (alias, immediate?) => immediate !== undefined
        ? this.notifyProfileDataManager(alias, immediate)
        : this.notifyProfileDataManager(alias),
      getProfileDirectoryPath: (alias) => this.getProfileDirectoryPath(alias),
    };
  }

  async addChatConfig(alias: string, chatConfig: ChatConfig): Promise<boolean> {
    return chatCrud.addChatConfig(this.chatCrudCtx(), alias, chatConfig);
  }
  async updateChatConfig(alias: string, chatId: string, updates: Partial<ChatConfig>): Promise<boolean> {
    return chatCrud.updateChatConfig(this.chatCrudCtx(), alias, chatId, updates);
  }
  async deleteChatConfig(alias: string, chatId: string): Promise<boolean> {
    return chatCrud.deleteChatConfig(this.chatCrudCtx(), alias, chatId);
  }
  getChatConfig(alias: string, chatId: string): ChatConfig | null {
    return chatCrud.getChatConfig(this.chatCrudCtx(), alias, chatId);
  }
  getAllChatConfigs(alias: string): ChatConfig[] {
    return chatCrud.getAllChatConfigs(this.chatCrudCtx(), alias);
  }
  async updateChatAgent(alias: string, chatId: string, agentUpdates: Partial<ChatAgent>): Promise<boolean> {
    return chatCrud.updateChatAgent(this.chatCrudCtx(), alias, chatId, agentUpdates);
  }

  /**
   * Get the cached profile
   */
  getCachedProfile(alias: string): Profile | null {
    return this.cache.get(alias) || null;
  }

  /**
   * Force-notify the frontend ProfileDataManager to sync the cached data
   */
  async forceNotifyProfileDataManager(alias: string): Promise<void> {
    await this.notifyProfileDataManager(alias, true);
  }

  /**
   * Clear the cache
   */
  clearCache(alias?: string): void {
    const clearStart = Date.now();
    const clearId = `clearCache_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    if (alias) {

      // Phase 1: Check if user exists in cache
      const hadCache = this.cache.has(alias);
      const cacheSize = this.cache.size;


      if (hadCache) {
        const userProfile = this.cache.get(alias);
        const profileDetails = userProfile
          ? `hasChats=${!!userProfile.chats}, mcpServersCount=${mcpConfigManager.getServers(alias).length}, version=${userProfile.version}`
          : 'no profile data';

        // Phase 2: Clear user cache
        this.cache.delete(alias);
        const clearDuration = Date.now() - clearStart;

      } else {
        const clearDuration = Date.now() - clearStart;
      }

      // Phase 3: Clear user runtime states (including MCP servers)
      this.clearUserRuntimeStates(alias);
      mcpConfigManager.clearCache(alias);
      // Drop the cached global skill registry and per-chat skill snapshots for this user.
      skillsConfigManager.clearForAlias(alias);
      chatSkillSnapshotStore.clearForAlias(alias);
      // Drop the cached global Agent Hook library for this user (no per-chat snapshots).
      hooksConfigManager.clearForAlias(alias);
      clearRegistry(this.getProfileDirectoryPath(alias));
    } else {

      // Phase 1: Inventory all cached users
      const cachedUsers = Array.from(this.cache.keys());
      const totalCacheSize = this.cache.size;


      if (totalCacheSize > 0) {
        // Phase 2: Clear all cache
        this.cache.clear();
        const clearDuration = Date.now() - clearStart;

      } else {
        const clearDuration = Date.now() - clearStart;
      }

      // Phase 3: Clear all runtime states for complete clearing
      for (const user of cachedUsers) {
        this.clearUserRuntimeStates(user);
      }
      mcpConfigManager.clearCache();
      // Drop all cached global skill registries and per-chat skill snapshots.
      skillsConfigManager.clearAll();
      chatSkillSnapshotStore.clearAll();
      // Drop all cached global Agent Hook libraries (no per-chat snapshots).
      hooksConfigManager.clearAll();
      clearRegistry();
    }
  }

  /**
   * Get all cached profile aliases
   */
  getCachedAliases(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Runtime state management methods
   * 🆕 Refactored: these methods now delegate to mcpClientManager; runtimeStates are no longer maintained inside profileCacheManager
   */

  /**
   * Update MCP server runtime status
   * 🆕 Refactored: delegates to mcpClientManager
   * @deprecated This method is kept for backward compatibility; state is now managed internally by mcpClientManager
   */
  updateMcpServerStatus(alias: string, serverName: string, status: MCPServerStatus): void {
    // 🆕 Refactored: state is now managed internally by mcpClientManager
    // This method retains an empty implementation for backward compatibility
    // mcpClientManager automatically notifies the frontend when state changes
    logger.debug('[ProfileCacheManager] updateMcpServerStatus called (deprecated, delegated to mcpClientManager)', 'updateMcpServerStatus', {
      alias,
      serverName,
      status
    });
  }

  /**
   * Update MCP server tools
   * 🆕 Refactored: delegates to mcpClientManager
   * @deprecated This method is kept for backward compatibility; the tool list is now managed internally by mcpClientManager
   */
  updateMcpServerTools(alias: string, serverName: string, tools: { name: string; description?: string; inputSchema: any }[]): void {
    // 🆕 Refactored: the tool list is now managed internally by mcpClientManager
    // This method retains an empty implementation for backward compatibility
    logger.debug('[ProfileCacheManager] updateMcpServerTools called (deprecated, delegated to mcpClientManager)', 'updateMcpServerTools', {
      alias,
      serverName,
      toolCount: tools.length
    });
  }

  /**
   * Update MCP server last error
   * 🆕 Refactored: delegates to mcpClientManager
   * @deprecated This method is kept for backward compatibility; errors are now managed internally by mcpClientManager
   */
  updateMcpServerError(alias: string, serverName: string, error: Error | null): void {
    // 🆕 Refactored: errors are now managed internally by mcpClientManager
    // This method retains an empty implementation for backward compatibility
    logger.debug('[ProfileCacheManager] updateMcpServerError called (deprecated, delegated to mcpClientManager)', 'updateMcpServerError', {
      alias,
      serverName,
      hasError: error !== null
    });
  }

  /**
   * Get MCP server runtime state
   * 🆕 Refactored: retrieves from mcpClientManager
   */
  getMcpServerRuntimeState(alias: string, serverName: string): MCPServerRuntimeState | null {
    // 🆕 Refactored: retrieves runtime state from mcpClientManager
    if (!this.mcpClientManager) {
      return null;
    }
    return this.mcpClientManager.getMcpServerRuntimeState(serverName);
  }

  /**
   * Get all MCP server runtime states for a user
   * 🆕 Refactored: retrieves from mcpClientManager
   */
  getAllMcpServerRuntimeStates(alias: string): MCPServerRuntimeState[] {
    // 🆕 Refactored: retrieves all runtime states from mcpClientManager
    if (!this.mcpClientManager) {
      return [];
    }
    return this.mcpClientManager.getAllMcpServerRuntimeStates();
  }

  /**
   * Clear MCP server runtime state
   * 🆕 Refactored: delegates to mcpClientManager
   */
  clearMcpServerRuntimeState(alias: string, serverName: string): void {
    // 🆕 Refactored: delegates to mcpClientManager for cleanup
    if (this.mcpClientManager) {
      this.mcpClientManager._clearServerRuntimeState(serverName);
    }
    logger.debug('[ProfileCacheManager] clearMcpServerRuntimeState delegated to mcpClientManager', 'clearMcpServerRuntimeState', {
      alias,
      serverName
    });
  }

  /**
   * Clear all runtime states for a user
   * 🆕 Refactored: delegates to mcpClientManager
   */
  clearUserRuntimeStates(alias: string): void {
    // 🆕 Refactored: delegates to mcpClientManager to clear all states
    if (this.mcpClientManager) {
      // Get all server names and clear them one by one
      const allStates = this.mcpClientManager.getAllMcpServerRuntimeStates();
      for (const state of allStates) {
        this.mcpClientManager._clearServerRuntimeState(state.serverName);
      }
    }
    logger.debug('[ProfileCacheManager] clearUserRuntimeStates delegated to mcpClientManager', 'clearUserRuntimeStates', {
      alias
    });
  }

  /**
   * Get combined server info (config + runtime state)
   */
  getMcpServerInfo(alias: string, serverName: string): {
    config: McpServerConfig | null;
    runtime: MCPServerRuntimeState | null;
  } {
    const config = mcpConfigManager.getServerInfo(alias, serverName);
    const runtime = this.getMcpServerRuntimeState(alias, serverName);

    return { config, runtime };
  }

  /**
   * Get all server info for a user (config + runtime states)
   */
  getAllMcpServerInfo(alias: string): Array<{
    config: McpServerConfig;
    runtime: MCPServerRuntimeState | null;
  }> {
    return mcpConfigManager.getServers(alias).map(config => ({
      config,
      runtime: this.getMcpServerRuntimeState(alias, config.name)
    }));
  }

  /**
   * Execute MCP tool call — unified entry point
   * Calls mcpClientManager to execute the tool via ProfileCacheManager
   */
  async executeToolCall(toolName: string, args: any): Promise<any> {
    try {

      if (!this.mcpClientManager) {
        throw new Error('MCP Client Manager not initialized');
      }

      if (!this.currentUserAlias) {
        throw new Error('No current user alias set');
      }

      // Call mcpClientManager's executeTool method
      const result = await this.mcpClientManager.executeTool({ toolName, toolArgs: args });

      return result;
    } catch (error) {
      throw error;
    }
  }

  // ========================================
  // Settings CRUD — delegated to ./profileSettingsCrud.ts
  // ========================================

  private settingsCtx(): SettingsCrudContext {
    return {
      cache: this.cache,
      readProfileFromFile: (alias) => this.readProfileFromFile(alias),
      writeProfileToFile: (alias, profile) => this.writeProfileToFile(alias, profile),
      notifyProfileDataManager: (alias, immediate?) => immediate !== undefined
        ? this.notifyProfileDataManager(alias, immediate)
        : this.notifyProfileDataManager(alias),
    };
  }

  getConfirmationSettings(alias: string): ConfirmationSettings {
    return settingsCrud.getConfirmationSettings(this.settingsCtx(), alias);
  }
  async updateConfirmationSettings(alias: string, settings: Partial<ConfirmationSettings>): Promise<boolean> {
    return settingsCrud.updateConfirmationSettings(this.settingsCtx(), alias, settings);
  }
  getVoiceInputSettings(alias: string): VoiceInputSettings {
    return settingsCrud.getVoiceInputSettings(this.settingsCtx(), alias);
  }
  async updateVoiceInputSettings(alias: string, settings: Partial<VoiceInputSettings>): Promise<boolean> {
    return settingsCrud.updateVoiceInputSettings(this.settingsCtx(), alias, settings);
  }
  async updatePrimaryChat(alias: string, chatId: string): Promise<boolean> {
    return settingsCrud.updatePrimaryChat(this.settingsCtx(), alias, chatId);
  }
  async updateFreDone(alias: string, freDone: boolean): Promise<boolean> {
    return settingsCrud.updateFreDone(this.settingsCtx(), alias, freDone);
  }
  getFreDone(alias: string): boolean {
    return settingsCrud.getFreDone(this.settingsCtx(), alias);
  }
  getDevToolsMcpSettings(alias: string): DevToolsMcpSettings {
    return settingsCrud.getDevToolsMcpSettings(this.settingsCtx(), alias);
  }
  async updateDevToolsMcpSettings(alias: string, settings: Partial<DevToolsMcpSettings>): Promise<boolean> {
    return settingsCrud.updateDevToolsMcpSettings(this.settingsCtx(), alias, settings);
  }
  getCodingAgentSettings(alias: string): CodingAgentSettings {
    return settingsCrud.getCodingAgentSettings(this.settingsCtx(), alias);
  }
  async updateCodingAgentSettings(alias: string, settings: Partial<CodingAgentSettings>): Promise<boolean> {
    return settingsCrud.updateCodingAgentSettings(this.settingsCtx(), alias, settings);
  }
  getSyncSettings(alias: string): SyncSettings {
    return settingsCrud.getSyncSettings(this.settingsCtx(), alias);
  }
  async updateSyncSettings(alias: string, settings: Partial<SyncSettings>): Promise<boolean> {
    return settingsCrud.updateSyncSettings(this.settingsCtx(), alias, settings);
  }
  getBrowserSettings(alias: string): BrowserSettings {
    return settingsCrud.getBrowserSettings(this.settingsCtx(), alias);
  }
  async updateBrowserSettings(alias: string, settings: Partial<BrowserSettings>): Promise<boolean> {
    return settingsCrud.updateBrowserSettings(this.settingsCtx(), alias, settings);
  }
  getMemexSettings(alias: string): MemexSettings {
    return settingsCrud.getMemexSettings(this.settingsCtx(), alias);
  }
  async updateMemexSettings(alias: string, settings: Partial<MemexSettings>): Promise<boolean> {
    return settingsCrud.updateMemexSettings(this.settingsCtx(), alias, settings);
  }
  getComputerUseSettings(alias: string): ComputerUseSettings {
    return settingsCrud.getComputerUseSettings(this.settingsCtx(), alias);
  }
  async updateComputerUseSettings(alias: string, settings: Partial<ComputerUseSettings>): Promise<boolean> {
    return settingsCrud.updateComputerUseSettings(this.settingsCtx(), alias, settings);
  }

  // ========================================
  // Archive Agent Operations — delegated to ./profileArchiveManager.ts
  // ========================================

  private archiveCtx(): ArchiveContext {
    return {
      cache: this.cache,
      getProfileDirectoryPath: (alias) => this.getProfileDirectoryPath(alias),
      readProfileFromFile: (alias) => this.readProfileFromFile(alias),
      writeProfileToFile: (alias, profile) => this.writeProfileToFile(alias, profile),
      notifyProfileDataManager: (alias, immediate?) => immediate !== undefined
        ? this.notifyProfileDataManager(alias, immediate)
        : this.notifyProfileDataManager(alias),
    };
  }

  async archiveChatConfig(alias: string, chatId: string): Promise<boolean> {
    return archiveOps.archiveChatConfig(this.archiveCtx(), alias, chatId);
  }
  async unarchiveChatConfig(alias: string, chatId: string): Promise<{ success: boolean; error?: string }> {
    return archiveOps.unarchiveChatConfig(this.archiveCtx(), alias, chatId);
  }
  getArchivedAgents(alias: string): any[] {
    return archiveOps.getArchivedAgents(this.archiveCtx(), alias);
  }

  /**
   * ========================================
   * ChatSession operations (delegates to profileChatSessionOps.ts)
   * ========================================
   */

  private chatSessionCtx(): ChatSessionOpsContext {
    return {
      syncStarredChatSessionIndex: (alias, chatId, session, options?) =>
        this.syncStarredChatSessionIndex(alias, chatId, session, options),
      removeStarredChatSessionIndex: (alias, chatSessionId, options?) =>
        this.removeStarredChatSessionIndex(alias, chatSessionId, options),
      notifyProfileDataManager: (alias, immediate?) => immediate !== undefined
        ? this.notifyProfileDataManager(alias, immediate)
        : this.notifyProfileDataManager(alias),
    };
  }

  async saveChatSession(alias: string, chatId: string, chatSessionFile: ChatSessionFile): Promise<boolean> {
    return chatSessionOps.saveChatSession(this.chatSessionCtx(), alias, chatId, chatSessionFile);
  }
  async deleteChatSession(alias: string, chatId: string, chatSessionId: string): Promise<boolean> {
    return chatSessionOps.deleteChatSession(this.chatSessionCtx(), alias, chatId, chatSessionId);
  }
  /** @deprecated Use getChatSessionsAsync instead */
  getChatSessions(alias: string, chatId: string): ChatSession[] {
    return chatSessionOps.getChatSessions(alias, chatId);
  }
  async getChatSessionsAsync(alias: string, chatId: string): Promise<ChatSession[]> {
    return chatSessionOps.getChatSessionsAsync(alias, chatId);
  }
  async getChatSessionFile(alias: string, chatId: string, chatSessionId: string): Promise<ChatSessionFile | null> {
    return chatSessionOps.getChatSessionFile(alias, chatId, chatSessionId);
  }
}

// Export singleton instance
export const profileCacheManager = ProfileCacheManager.getInstance();