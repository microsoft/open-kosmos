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
  ChatSkillSnapshot,
  ChatSession,
  StarredChatSessionIndexItem,
  McpServerConfig,
  SubAgentConfig,
  SubAgentIndex,
  SkillConfig,
  isProfileV2,
  VoiceInputSettings,
  BrowserControlSettings,
  DevToolsMcpSettings,
  ConfirmationSettings,
} from './types/profile';
import { ChatSessionFile } from './chatSessionFileOps';
import { chatSessionManager } from './chatSessionManager';
import { getDefaultWorkspacePath, isDefaultWorkspacePath } from './pathUtils';
import { getExternalAgentService } from '../../startup/lazy';
import { chatSessionStore } from '../chat/chatSessionStore';
import { BUILTIN_DEFAULTS_VERSION } from '../../../shared/constants/builtinSkills';
import {
  sanitizeProfileV2,
  sanitizeSubAgents,
  sanitizeStarredChatSessions,
  buildStarredChatSessionIndexItem,
  sanitizeChatSkillSnapshot,
  clearSkillSnapshotsForAffectedChats,
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
import * as settingsCrud from './profileSettingsCrud';
import type { SettingsCrudContext } from './profileSettingsCrud';
import * as archiveOps from './profileArchiveManager';
import type { ArchiveContext } from './profileArchiveManager';
import * as entityCrud from './profileEntityCrud';
import type { EntityCrudContext } from './profileEntityCrud';
import * as chatCrud from './profileChatCrud';
import type { ChatCrudContext } from './profileChatCrud';
import * as chatSessionOps from './profileChatSessionOps';
import type { ChatSessionOpsContext } from './profileChatSessionOps';
import { ghcModelsManager } from "../llm/ghcModelsManager";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { pluginManager } from "../plugin/pluginManager";
import { agentChatManager } from "../chat/agentChatManager";

/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction';

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
  }

  static getInstance(): ProfileCacheManager {
    if (!ProfileCacheManager.instance) {
      ProfileCacheManager.instance = new ProfileCacheManager();
    }
    return ProfileCacheManager.instance;
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
      const profilePath = this.getProfileFilePath(alias);

      if (!fs.existsSync(profilePath)) {
        return null;
      }

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
        return null;
      }

      // V2 format: verify and ensure integrity of chatSessions fields
      const sanitizedProfile = await this.ensureV2ProfileIntegrity(alias, rawProfile as ProfileV2);
      return sanitizedProfile;
    } catch (error) {
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

  async syncStarredChatSessionIndex(
    alias: string,
    chatId: string,
    session: Partial<ChatSession>,
    options?: { notifyRenderer?: boolean },
  ): Promise<boolean> {
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

    this.cache.set(alias, nextProfile);
    const saved = await this.writeProfileToFile(alias, nextProfile);
    if (!saved) {
      this.cache.set(alias, cachedProfile);
      return false;
    }

    if (options?.notifyRenderer !== false) {
      await this.notifyProfileDataManager(alias, true);
    }

    return true;
  }

  async removeStarredChatSessionIndex(
    alias: string,
    chatSessionId: string,
    options?: { notifyRenderer?: boolean },
  ): Promise<boolean> {
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

    this.cache.set(alias, nextProfile);
    const saved = await this.writeProfileToFile(alias, nextProfile);
    if (!saved) {
      this.cache.set(alias, cachedProfile);
      return false;
    }

    if (options?.notifyRenderer !== false) {
      await this.notifyProfileDataManager(alias, true);
    }

    return true;
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
  private async ensureV2ProfileIntegrity(alias: string, profile: ProfileV2): Promise<ProfileV2> {
    try {

      let needsSave = false;
      // 🔧 Deep copy: isolate the original profile to prevent accidental mutation through shared nested references.
      // See [Deep-copy rule] above.
      const profileCopy: ProfileV2 = JSON.parse(JSON.stringify(profile));

      // Part 1: One-time Migrations (version-controlled via profileMigrationVersion)
      if (applyProfileMigrations(profileCopy)) {
        needsSave = true;
      }

      // Ensure chats array exists before Part 2 and Part 3
      if (!profileCopy.chats || !Array.isArray(profileCopy.chats)) {
        profileCopy.chats = [createDefaultChat()];
        needsSave = true;
      }

      // Part 2: Built-in Defaults Migration (version-controlled via builtinDefaultsVersion)
      if (applyBuiltinDefaultsMigrations(profileCopy)) {
        needsSave = true;
      }

      // Part 3: Normalize via sanitizeProfileV2 (single source of truth for schema + defaults)
      // Pre-fill workspace paths (requires alias context, cannot be done in sanitizeProfileV2)
      for (const chat of profileCopy.chats) {
        if (chat.agent) {
          const ws = chat.agent.workspace;
          if (!ws || typeof ws !== 'string' || ws.trim() === '') {
            chat.agent.workspace = getDefaultWorkspacePath(alias, chat.chat_id);
          }
        }
      }
      // Apply sanitizeProfileV2 to normalize all fields and fill defaults
      const normalizedCopy = sanitizeProfileV2(profileCopy);
      // Preserve alias (sanitizeProfileV2 may produce empty string from raw data)
      normalizedCopy.alias = profileCopy.alias || alias;

      // Detect whether normalization changed anything
      const originalJson = JSON.stringify(profile);
      const normalizedJson = JSON.stringify(normalizedCopy);
      if (originalJson !== normalizedJson) {
        needsSave = true;
      }
      // Use the normalized copy from here on
      Object.assign(profileCopy, normalizedCopy);

      // If there were any modifications, persist to file immediately
      if (needsSave) {
        profileCopy.updatedAt = new Date().toISOString();

        const saveSuccess = await this.writeProfileToFile(alias, profileCopy);
        if (saveSuccess) {
          // 🔧 Fix: do NOT notify the frontend here. ensureV2ProfileIntegrity is only responsible for migration and persistence.
          // Notifying the frontend is handled by handleProfile after updating the cache.
          // Calling notifyProfileDataManager here would cause the frontend to receive stale data (cache not yet updated).
        }
      }

      return profileCopy;
    } catch (error) {
      // Return minimal safe config
      return {
        version: '2.0.0',
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        alias: profile.alias || alias,
        freDone: false,
        primaryAgent: 'Kobi',
        mcp_servers: profile.mcp_servers || [],
        skills: profile.skills || [],
        'starred-chat-sessions': Array.isArray(profile['starred-chat-sessions']) ? profile['starred-chat-sessions'] : [],
        chats: [createDefaultChat()]
      };
    }
  }

  // Migration methods extracted to ./profileMigration.ts
  // Utility methods (createDefaultChat, generateChatId) extracted to ./profileSanitizer.ts

  /**
   * Write profile to file
   */
  private async writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean> {
    try {
      const profileDir = this.getProfileDirectoryPath(alias);
      const profilePath = this.getProfileFilePath(alias);

      // Ensure the directory exists
      this.ensureDirectoryExists(profileDir);

      // Clean and validate the data structure to ensure it conforms to the template schema
      const sanitizedProfile = this.sanitizeProfile(profile);

      // Update the timestamp
      sanitizedProfile.updatedAt = new Date().toISOString();

      // Write file — the sanitized, template-conforming data is now written
      await fs.promises.writeFile(profilePath, JSON.stringify(sanitizedProfile, null, 2), 'utf-8');

      return true;
    } catch (error) {
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

      // Get main window reference and send IPC notification
      // Prefer the explicitly set mainWindow; otherwise try to locate one
      let targetWindow: BrowserWindow | null | undefined = this.mainWindow;

      if (!targetWindow || targetWindow.isDestroyed()) {
        const windows = BrowserWindow.getAllWindows();
        // Try to match by title (multi-brand compatible)
        const appTitle = process.env.APP_NAME; // e.g. "OpenKosmos" (may not match window title exactly)

        // Window lookup strategy:
        // 1. Exact title match "OpenKosmos AI Studio" (default / legacy)
        // 2. Title contains "OpenKosmos"
        // 3. Fall back to the only open window

        targetWindow = windows.find((window: BrowserWindow) => {
          const title = window.title;
          return title === 'OpenKosmos AI Studio' ||
                 (appTitle && title === appTitle) || // Fallback to provided APP_NAME
                 title.includes('OpenKosmos');
        });

        // Still not found, but there is only one window — assume it is the main window
        if (!targetWindow && windows.length === 1) {
           targetWindow = windows[0];
        }
      }

      if (targetWindow && !targetWindow.isDestroyed() && targetWindow.webContents) {
        const profile = this.cache.get(alias);

        // 🔥 New architecture: load chatSessions for each chat from chatSessionManager.
        // chatSessions are no longer stored in profile.json; they must be loaded dynamically.
        // Use ChatConfigRuntime type to include runtime chatSessions.
        let profileWithChatSessions: (Omit<ProfileV2, 'chats'> & { chats: ChatConfigRuntime[] }) | null = profile ? JSON.parse(JSON.stringify(profile)) : null;

        if (profileWithChatSessions && profileWithChatSessions.chats && profileWithChatSessions.chats.length > 0) {
          try {
            // Use a local variable reference to avoid undefined issues in closures
            const profileToUpdate = profileWithChatSessions;

            // Load chatSessions for all chats in parallel
            const loadPromises = profileToUpdate.chats.map(async (chat: ChatConfigRuntime, index: number) => {
              try {
                const result = await chatSessionStore.getChatSessionsProjection(alias, chat.chat_id);
                // Assign the loaded sessions to chat.chatSessions
                profileToUpdate.chats[index].chatSessions = result.sessions.map((s: any) => ({
                  chatSession_id: s.chatSession_id,
                  last_updated: s.last_updated,
                  title: s.title,
                  readStatus: s.readStatus,
                  ...(typeof s.starred === 'boolean' ? { starred: s.starred } : {}),
                  ...(s.starredAt ? { starredAt: s.starredAt } : {}),
                  ...(s.schedulerJobId ? { schedulerJobId: s.schedulerJobId } : {}),
                  ...(s.schedulerExecutionStatus ? { schedulerExecutionStatus: s.schedulerExecutionStatus } : {}),
                  ...(s.schedulerStartedAt ? { schedulerStartedAt: s.schedulerStartedAt } : {}),
                  ...(s.schedulerCompletedAt ? { schedulerCompletedAt: s.schedulerCompletedAt } : {}),
                  ...(s.schedulerError ? { schedulerError: s.schedulerError } : {}),
                  source: s.source ? { ...s.source } : undefined,
                }));
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
            profileWithChatSessions = profile ? JSON.parse(JSON.stringify(profile)) : null;
          }
        }

        const messageData = {
          alias,
          profile: profileWithChatSessions ? {
            ...profileWithChatSessions,
            alias: this.currentUserAlias || alias // ensure the profile includes the alias field
          } : null,
          timestamp: Date.now()
        };

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

  /**
   * Update the in_use status of an MCP server.
   */
  updateMcpServerInUse(alias: string, serverName: string, inUse: boolean): void {
    try {
      const profile = this.cache.get(alias);
      if (!profile) {
        return;
      }

      const serverIndex = profile.mcp_servers.findIndex(server => server.name === serverName);
      if (serverIndex >= 0) {
        profile.mcp_servers[serverIndex].in_use = inUse;
        this.cache.set(alias, profile);
      }
    } catch (error) {
    }
  }

  // isDefaultProfile and isDefaultChatConfig extracted to ./profileMigration.ts

  /**
   * Create the default profile
   */
  private createDefaultProfile(alias: string): ProfileV2 {
    const now = new Date().toISOString();

    return {
      version: '2.0.0',
      createdAt: now,
      updatedAt: now,
      alias,
      freDone: false,
      primaryAgent: 'Kobi',
      mcp_servers: [],
      skills: [],
      'starred-chat-sessions': [],
      builtinDefaultsVersion: BUILTIN_DEFAULTS_VERSION,
      profileMigrationVersion: PROFILE_MIGRATION_VERSION,
      chats: [createDefaultChat()]
    };
  }

  /**
   * Function 1: Handle profile.json loading and creation
   * - If a local profile.json exists, load the existing config
   * - If no local profile.json exists, create a default profile
   *
   * 🚀 Performance: MCP, Mem0, and AgentChat initialization is moved to background parallel execution
   * No longer blocks profile loading; the window can display faster
   */
  async handleProfile(alias: string, options?: { notifyRenderer?: boolean }): Promise<ProfileV2 | null> {
    console.time('[ProfileCacheManager] handleProfile');
    try {
      const shouldNotifyRenderer = options?.notifyRenderer ?? true;

      // Set the current user alias
      this.currentUserAlias = alias;

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

        // 🚀 Background parallel initialization of MCP, Mem0, AgentChat (non-blocking)
        this.initializeBackgroundServices(alias);

        console.timeEnd('[ProfileCacheManager] handleProfile');
        return profile;
      } else {
        // Case 2: profile.json does not exist — create a V2-format default config for this new user

        // Create the new V2 config
        const newProfileV2 = this.createDefaultProfile(alias);

        // Update the cache
        this.cache.set(alias, newProfileV2);

        // Notify the frontend ProfileDataManager to sync data (immediate for profile updates)
        if (shouldNotifyRenderer) {
          await this.notifyProfileDataManager(alias, true);
        }

        // Create the profile.json file
        const success = await this.writeProfileToFile(alias, newProfileV2);
        if (!success) {
          console.timeEnd('[ProfileCacheManager] handleProfile');
          return null;
        }

        // 🚀 Background parallel initialization of MCP, Mem0, AgentChat (non-blocking)
        this.initializeBackgroundServices(alias);

        console.timeEnd('[ProfileCacheManager] handleProfile');
        return newProfileV2;
      }
    } catch (error) {
      console.timeEnd('[ProfileCacheManager] handleProfile');
      return null;
    }
  }

  /**
   * 🚀 Background service initialization
   * MCP, Mem0, and AgentChat are initialized in parallel without blocking the main flow
   */
  private initializeBackgroundServices(alias: string): void {
    console.time('[ProfileCacheManager] backgroundServices');

    // Use Promise.allSettled to run all initializations in parallel without blocking each other
    Promise.allSettled([
      // Initialize GhcModelsManager (model list cache)
      (async () => {
        console.time('[ProfileCacheManager] ghcModelsManager.initialize');
        try {
          await ghcModelsManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] ghcModelsManager.initialize');
        } catch (modelsError) {
          console.timeEnd('[ProfileCacheManager] ghcModelsManager.initialize');
          logger.error(`[ProfileCacheManager] GhcModelsManager initialization failed: ${modelsError instanceof Error ? modelsError.message : String(modelsError)}`);
        }
      })(),

      // Initialize MCPClientManager
      (async () => {
        console.time('[ProfileCacheManager] mcpClientManager.initialize');
        try {
          this.mcpClientManager = mcpClientManager;
          await mcpClientManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] mcpClientManager.initialize');
        } catch (mcpError) {
          console.timeEnd('[ProfileCacheManager] mcpClientManager.initialize');
          logger.error(`[ProfileCacheManager] MCP initialization failed: ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`);
        }
      })(),

      // Initialize PluginManager
      (async () => {
        console.time('[ProfileCacheManager] pluginManager.initialize');
        try {
          const result = await pluginManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] pluginManager.initialize');
          if (result.errors.length > 0) {
            logger.warn(`[ProfileCacheManager] Plugin initialization had ${result.errors.length} error(s): ${result.errors.map(e => e.message).join('; ')}`);
          }
        } catch (pluginError) {
          console.timeEnd('[ProfileCacheManager] pluginManager.initialize');
          logger.error(`[ProfileCacheManager] Plugin initialization failed: ${pluginError instanceof Error ? pluginError.message : String(pluginError)}`);
        }
      })(),

      // Initialize AgentChatManager
      (async () => {
        console.time('[ProfileCacheManager] agentChatManager.initialize');
        try {
          await agentChatManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] agentChatManager.initialize');
        } catch (agentError) {
          console.timeEnd('[ProfileCacheManager] agentChatManager.initialize');
          logger.error(`[ProfileCacheManager] AgentChatManager initialization failed: ${agentError instanceof Error ? agentError.message : String(agentError)}`);
        }
      })(),

      // Initialize External Agent service
      (async () => {
        console.time('[ProfileCacheManager] externalAgent?.initialize');
        try {
          if (!featureFlagManager.isEnabled('openkosmosFeatureExternalAgent')) {
            console.timeEnd('[ProfileCacheManager] externalAgent?.initialize');
            return;
          }

          await getExternalAgentService(alias);
          console.timeEnd('[ProfileCacheManager] externalAgent?.initialize');
        } catch (error) {
          console.timeEnd('[ProfileCacheManager] externalAgent?.initialize');
          logger.error(`[ProfileCacheManager] External Agent initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })()
    ]).then((results) => {
      console.timeEnd('[ProfileCacheManager] backgroundServices');
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        logger.warn(`[ProfileCacheManager] ${failed.length} background services failed to initialize`);
      } else {
        logger.debug('[ProfileCacheManager] All background services initialized successfully');
      }
    });
  }


  // ========================================
  // MCP Server, Skill, Sub-Agent CRUD — delegated to ./profileEntityCrud.ts
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
  async addSkill(alias: string, skillConfig: SkillConfig): Promise<boolean> {
    return entityCrud.addSkill(this.entityCtx(), alias, skillConfig);
  }
  async updateSkill(alias: string, skillName: string, updates: { description?: string; version?: string }): Promise<boolean> {
    return entityCrud.updateSkill(this.entityCtx(), alias, skillName, updates);
  }
  async deleteSkill(alias: string, skillName: string): Promise<boolean> {
    return entityCrud.deleteSkill(this.entityCtx(), alias, skillName);
  }
  async getSubAgents(): Promise<SubAgentConfig[]> {
    return entityCrud.getSubAgents(this.entityCtx());
  }
  getSubAgentIndex(alias?: string): SubAgentIndex[] {
    return entityCrud.getSubAgentIndex(this.entityCtx(), alias);
  }
  async addSubAgent(alias: string, config: SubAgentConfig): Promise<boolean> {
    return entityCrud.addSubAgent(this.entityCtx(), alias, config);
  }
  async updateSubAgent(alias: string, name: string, updates: Partial<SubAgentConfig>): Promise<boolean> {
    return entityCrud.updateSubAgent(this.entityCtx(), alias, name, updates);
  }
  async deleteSubAgent(alias: string, name: string): Promise<boolean> {
    return entityCrud.deleteSubAgent(this.entityCtx(), alias, name);
  }
  async syncSubAgentIndex(alias: string): Promise<void> {
    return entityCrud.syncSubAgentIndex(this.entityCtx(), alias);
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

  async updateChatSkillSnapshot(alias: string, chatId: string, skillSnapshot?: ChatSkillSnapshot | null, options?: { notifyRenderer?: boolean }): Promise<boolean> {
    return chatCrud.updateChatSkillSnapshot(this.chatCrudCtx(), alias, chatId, skillSnapshot, options);
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
          ? `hasChats=${!!userProfile.chats}, mcpServersCount=${userProfile.mcp_servers?.length || 0}, version=${userProfile.version}`
          : 'no profile data';

        // Phase 2: Clear user cache
        this.cache.delete(alias);
        const clearDuration = Date.now() - clearStart;

      } else {
        const clearDuration = Date.now() - clearStart;
      }

      // Phase 3: Clear user runtime states (including MCP servers)
      this.clearUserRuntimeStates(alias);
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
    const profile = this.getCachedProfile(alias);
    const config = profile?.mcp_servers.find(server => server.name === serverName) || null;
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
    const profile = this.getCachedProfile(alias);
    if (!profile) {
      return [];
    }

    return profile.mcp_servers.map(config => ({
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
  async updatePrimaryAgent(alias: string, agentName: string): Promise<boolean> {
    return settingsCrud.updatePrimaryAgent(this.settingsCtx(), alias, agentName);
  }
  async updateFreDone(alias: string, freDone: boolean): Promise<boolean> {
    return settingsCrud.updateFreDone(this.settingsCtx(), alias, freDone);
  }
  getFreDone(alias: string): boolean {
    return settingsCrud.getFreDone(this.settingsCtx(), alias);
  }
  getBrowserControlSettings(alias: string): BrowserControlSettings {
    return settingsCrud.getBrowserControlSettings(this.settingsCtx(), alias);
  }
  async updateBrowserControlSettings(alias: string, settings: Partial<BrowserControlSettings>): Promise<boolean> {
    return settingsCrud.updateBrowserControlSettings(this.settingsCtx(), alias, settings);
  }
  getDevToolsMcpSettings(alias: string): DevToolsMcpSettings {
    return settingsCrud.getDevToolsMcpSettings(this.settingsCtx(), alias);
  }
  async updateDevToolsMcpSettings(alias: string, settings: Partial<DevToolsMcpSettings>): Promise<boolean> {
    return settingsCrud.updateDevToolsMcpSettings(this.settingsCtx(), alias, settings);
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