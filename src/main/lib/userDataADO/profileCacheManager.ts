import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';
import { quickStartImageCacheManager } from '../cache/quickStartImageCacheManager';
import {
  Profile,
  ProfileV2,
  ChatConfig,
  ChatConfigRuntime,
  ChatAgent,
  ChatSession,
  ModelConfig,
  McpServerConfig,
  VoiceInputSettings,
  BrowserControlSettings,
  DEFAULT_PROFILE_V2,
  DEFAULT_CHAT_AGENT,
  DEFAULT_MCP_SERVER,
  DEFAULT_CHAT_SESSION,
  DEFAULT_VOICE_INPUT_SETTINGS,
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  DEFAULT_CONTEXT_ENHANCEMENT,
  DEFAULT_ZERO_STATES,
  isProfileV2,
  ChatSessionUtils,
  isBuiltinAgent
} from './types/profile';
import { ChatSessionFile, ChatSessionFileOps } from './chatSessionFileOps';
import { getDefaultWorkspacePath, getDefaultAgentWorkspacePath, ensureWorkspaceExists, removeChatSessionsDirectory, removeDefaultWorkspaceDirectory, isDefaultWorkspacePath, moveContentsToDirectory } from './pathUtils';
import { chatSessionManager } from './chatSessionManager';
import { BRAND_NAME } from '@shared/constants/branding';
import { BUILTIN_SKILL_NAMES } from '../../../shared/constants/builtinSkills';

/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting';

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
    
    // Try to import Electron
    const { app } = require('electron');
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
      return this.sanitizeProfileV2(profile);
    } catch (error) {
      return this.createDefaultProfile('') as ProfileV2;
    }
  }

  /**
   * V2 Profile data sanitization and validation (schema normalizer called before writing to disk; pure function with no side effects).
   *
   * 📖 Standard pattern for adding new fields, see README Step 3b:
   * src/main/lib/userDataADO/README.md — "3b. sanitizeProfileV2 — called on every write"
   */
  private sanitizeProfileV2(profile: ProfileV2): ProfileV2 {
    try {
      // Sanitize MCP server configs, ensuring version and source fields exist
      const cleanMcpServers = (profile.mcp_servers || []).map(server => ({
        name: server.name || '',
        transport: server.transport || 'stdio',
        command: server.command || '',
        args: Array.isArray(server.args) ? server.args : [],
        env: (server.env && typeof server.env === 'object') ? server.env : {},
        url: server.url || '',
        in_use: Boolean(server.in_use),
        // Migration: ensure version and source fields exist; existing MCPs default to 1.0.0 and ON-DEVICE
        version: server.version || '1.0.0',
        source: server.source || 'ON-DEVICE'
      }));

      // Sanitize chats config
      const cleanChats = (profile.chats || []).map(chat => {
        // Backward compat: read workspace from chat.workspace (legacy) or chat.agent.workspace
        const legacyWorkspace = (chat as any).workspace;
        const agentWorkspace = chat.agent?.workspace;
        const workspacePath = typeof agentWorkspace === 'string' && agentWorkspace 
          ? agentWorkspace 
          : (typeof legacyWorkspace === 'string' ? legacyWorkspace : '');

        const cleanAgent = chat.agent ? {
          role: chat.agent.role || DEFAULT_CHAT_AGENT.role,
          emoji: chat.agent.emoji || DEFAULT_CHAT_AGENT.emoji,
          avatar: chat.agent.avatar || '',
          name: chat.agent.name || DEFAULT_CHAT_AGENT.name,
          model: chat.agent.model || DEFAULT_CHAT_AGENT.model,
          workspace: workspacePath,
          knowledgeBase: chat.agent.knowledgeBase || (workspacePath ? path.join(workspacePath, 'knowledge') : ''),
          // Migration: ensure version and source exist; existing agents default to 1.0.0 and ON-DEVICE
          version: chat.agent.version || '1.0.0',
          source: chat.agent.source || 'ON-DEVICE',
          mcp_servers: Array.isArray(chat.agent.mcp_servers)
            ? chat.agent.mcp_servers
                .map(server => {
                  // 🔧 Backward compat: support both legacy (string) and new (object) formats
                  if (typeof server === 'string') {
                    // Legacy format: server is a name string
                    return { name: server, tools: [] };
                  } else if (server && typeof server === 'object') {
                    // New format: object with name and tools
                    return {
                      name: server.name || '',
                      tools: Array.isArray(server.tools) ? server.tools : []
                    };
                  } else {
                    // Invalid format — return null to be filtered out later
                    return null;
                  }
                })
                .filter(server => server !== null && server.name !== '') // filter out invalid servers
            : [],
          system_prompt: chat.agent.system_prompt !== undefined ? chat.agent.system_prompt : DEFAULT_CHAT_AGENT.system_prompt,
          context_enhancement: chat.agent.context_enhancement || DEFAULT_CONTEXT_ENHANCEMENT,
          skills: Array.isArray(chat.agent.skills) ? chat.agent.skills : [],
          zero_states: chat.agent.zero_states || DEFAULT_ZERO_STATES
        } : undefined;

        // 🆕 Ensure builtin agents include all builtin skills
        if (cleanAgent && isBuiltinAgent(cleanAgent.name, BRAND_NAME)) {
          const missingSkills = BUILTIN_SKILL_NAMES.filter(s => !cleanAgent.skills.includes(s));
          if (missingSkills.length > 0) {
            cleanAgent.skills = [...cleanAgent.skills, ...missingSkills];
          }
        }

        return {
          chat_id: chat.chat_id || this.generateChatId(),
          chat_type: chat.chat_type || 'single_agent',
          ...(cleanAgent && { agent: cleanAgent })
        } as ChatConfig;
      });

      // Build the sanitized V2 Profile
      const sanitizedProfile: ProfileV2 = {
        version: profile.version || '2.0.0',
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: profile.updatedAt || new Date().toISOString(),
        alias: profile.alias || '',
        freDone: typeof profile.freDone === 'boolean' ? profile.freDone : false,
        primaryAgent: profile.primaryAgent || 'Kobi',
        mcp_servers: cleanMcpServers,
        skills: Array.isArray(profile.skills) ? profile.skills.map(skill => ({
          name: skill.name || '',
          description: skill.description || '',
          version: skill.version || '1.0.0',
          source: skill.source || 'ON-DEVICE'
        })) : [],
        chats: cleanChats.length > 0 ? cleanChats : [this.createDefaultChat()],
        browserControl: profile.browserControl,
      };

      return sanitizedProfile;
    } catch (error) {
      // Return minimal safe V2 config
      return {
        version: '2.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        alias: profile.alias || '',
        freDone: false,
        primaryAgent: 'Kobi',
        mcp_servers: [],
        skills: [],
        chats: [this.createDefaultChat()],
      };
    }
  }

  /**
   * Ensure V2 Profile data integrity (one-time startup migration + field backfill)
   * 
   * ═══════════════════════════════════════════════════════════════════
   * 📖 Development guide — MUST READ when adding new fields:
   * src/main/lib/userDataADO/README.md — "3a. ensureV2ProfileIntegrity — called on every read"
   * ═══════════════════════════════════════════════════════════════════
   * 📖 Method overview
   * ═══════════════════════════════════════════════════════════════════
   * 
   * Called immediately after readProfileFromFile() reads profile.json. Responsible for:
   *   1. Setting default values for fields added in new versions (freDone, skills, etc.)
   *   2. Migrating old data structures to new ones (workspace → agent.workspace, chatSessions → filesystem, etc.)
   *   3. Ensuring agent config is complete (mcp_servers format, version/source, etc.)
   *   4. Creating required filesystem directories (workspace, knowledgeBase)
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
   * [Two-phase loop structure]
   *   Each chat in the for loop is processed in two phases:
   * 
   *   Phase 1 (data migration) — operates on the `updatedChat` variable
   *     - Shallow-copy `const chat = profileCopy.chats[index]` into `let updatedChat = { ...chat }`
   *     - Perform workspace / knowledgeBase / chatSessions migration on updatedChat
   *     - Write back via `profileCopy.chats[index] = updatedChat` when done
   * 
   *   Phase 2 (agent field backfill) — operates on the `currentChatRef` variable
   *     - Obtain Phase 1's latest result via `const currentChatRef = profileCopy.chats[index]`
   *     - Backfill version / source / skills, etc. on `updatedAgent = { ...currentChatRef.agent }`
   *     - Write back via `profileCopy.chats[index] = { ...currentChatRef, agent: updatedAgent }`
   * 
   *   ⚠️ Critical: Phase 2 MUST re-fetch the reference from profileCopy.chats[index]
   *   (as currentChatRef) rather than reusing the `chat` variable from Phase 1's start.
   *   Reusing `chat` would lose Phase 1's migration results (e.g. the knowledgeBase field)
   *   because `chat` points to the pre-migration object.
   * 
   * [Variable naming conventions]
   *   - profileCopy:    deep copy of the full profile; all mutations end up here
   *   - chat:           raw reference at the top of the loop iteration (may be stale after Phase 1; do NOT use in Phase 2)
   *   - updatedChat:    Phase 1 working copy for workspace/knowledgeBase/chatSessions migration
   *   - currentChatRef: Phase 2 reference obtained from profileCopy.chats[index]
   *   - updatedAgent:   Phase 2 working copy for agent field backfill
   * 
   * [Standard pattern for adding new fields]
   *   To add a new agent field, add the following in Phase 2:
   *   ```
   *   const xxxNeedsUpdate = currentChatRef.agent.xxx === undefined;
   *   if (xxxNeedsUpdate) {
   *     updatedAgent.xxx = DEFAULT_VALUE;
   *     agentNeedsUpdate = true;
   *   }
   *   ```
   *   Also add corresponding sanitization logic in sanitizeProfileV2().
   * 
   * [Relationship with sanitizeProfileV2]
   *   - sanitizeProfileV2: schema normalizer before writing to disk (pure function, no side effects), called in writeProfileToFile
   *   - ensureV2ProfileIntegrity: one-time startup migration (has side effects: creates dirs, moves files)
   *   - They are complementary: this method handles complex migrations; sanitizeProfileV2 provides final format fallback
   * 
   * [Forbidden actions]
   *   ❌ Use the `chat` variable in Phase 2 (stale; points to pre-migration data)
   *   ❌ Use { ...profile } shallow copy instead of JSON.parse(JSON.stringify(profile))
   *   ❌ Call notifyProfileDataManager inside this method (cache not yet updated; frontend would receive stale data)
   *   ❌ Mutate the input `profile` argument directly (all mutations must be on profileCopy)
   * 
   * ═══════════════════════════════════════════════════════════════════
   */
  private async ensureV2ProfileIntegrity(alias: string, profile: ProfileV2): Promise<ProfileV2> {
    try {
      
      let needsSave = false;
      let needsChatSessionsMigration = false;
      // 🔧 Deep copy: isolate the original profile to prevent accidental mutation through shared nested references.
      // See [Deep-copy rule] above.
      const profileCopy: ProfileV2 = JSON.parse(JSON.stringify(profile));
      const BUILTIN_SERVER_NAME = 'builtin-tools';
      
      // 🔧 Check and ensure freDone field exists (new field migration)
      if (profileCopy.freDone === undefined || typeof profileCopy.freDone !== 'boolean') {
        // Determine whether this is a brand-new default profile (no user modifications).
        // If it equals a freshly created default config (user has not made any changes), set freDone=false.
        // Otherwise the user is an existing power user; no FRE needed — set freDone=true.
        const isDefaultProfile = this.isDefaultProfile(profileCopy);
        profileCopy.freDone = !isDefaultProfile; // default config → freDone=false; otherwise → freDone=true
        needsSave = true;
      }
      
      // 🔧 Check and ensure skills field exists (new field migration)
      if (!profileCopy.skills || !Array.isArray(profileCopy.skills)) {
        profileCopy.skills = [];
        needsSave = true;
      }

      // 🔧 Migration: screenshotSettings has been moved to app-level (app.json).
      // Remove it from profile.json if present.
      if ((profileCopy as any).screenshotSettings !== undefined) {
        delete (profileCopy as any).screenshotSettings;
        needsSave = true;
      }
      
      // Check and ensure version and source fields exist in mcp_servers
      if (profileCopy.mcp_servers && Array.isArray(profileCopy.mcp_servers)) {
        for (let i = 0; i < profileCopy.mcp_servers.length; i++) {
          // Check and backfill version field
          if (profileCopy.mcp_servers[i].version === undefined) {
            profileCopy.mcp_servers[i].version = '1.0.0';
            needsSave = true;
          }
          // Check and backfill source field
          if (profileCopy.mcp_servers[i].source === undefined) {
            profileCopy.mcp_servers[i].source = 'ON-DEVICE';
            needsSave = true;
          }
        }
      }
      
      // Check and ensure version and source fields exist in skills
      if (profileCopy.skills && Array.isArray(profileCopy.skills)) {
        for (let i = 0; i < profileCopy.skills.length; i++) {
          // Check and backfill version field
          if (profileCopy.skills[i].version === undefined) {
            profileCopy.skills[i].version = '1.0.0';
            needsSave = true;
          }
          // Check and backfill source field
          if (profileCopy.skills[i].source === undefined) {
            profileCopy.skills[i].source = 'ON-DEVICE';
            needsSave = true;
          }
        }
      }
      
      // 🔧 Check and ensure primaryAgent field exists (new field migration)
      if (!profileCopy.primaryAgent || typeof profileCopy.primaryAgent !== 'string') {
        profileCopy.primaryAgent = 'Kobi';
        needsSave = true;
      }
      
      // 🔧 Migrate old primaryAgent value from "Kosmos" to "Kobi"
      if (profileCopy.primaryAgent === 'Kosmos') {
        profileCopy.primaryAgent = 'Kobi';
        needsSave = true;
      }
      
      // Ensure chats array exists
      if (!profileCopy.chats || !Array.isArray(profileCopy.chats)) {
        profileCopy.chats = [this.createDefaultChat()];
        needsSave = true;
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Two-phase loop: Phase 1 (data migration) → Phase 2 (agent field backfill)
      // See [Two-phase loop structure] above.
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      for (let index = 0; index < profileCopy.chats.length; index++) {
        const chat = profileCopy.chats[index];
        let chatNeedsUpdate = false;
        let updatedChat = { ...chat };
        
        // ─── Phase 1: Data migration (workspace / knowledgeBase / chatSessions) ───
        // Operates on: updatedChat (shallow copy of chat)
        // Write back via: profileCopy.chats[index] = updatedChat
        
        // 🔄 Check and set a default workspace path (now at the agent level).
        // If workspace is missing, invalid, or empty, set it to the default path.
        if (updatedChat.agent) {
          const currentWorkspace = updatedChat.agent.workspace;
          // Backward compat: check whether chat.workspace (legacy location) still exists
          const legacyWorkspace = (updatedChat as any).workspace;
          
          if (!currentWorkspace || typeof currentWorkspace !== 'string' || currentWorkspace.trim() === '') {
            // If the legacy structure has a workspace, migrate it first
            if (legacyWorkspace && typeof legacyWorkspace === 'string' && legacyWorkspace.trim() !== '') {
              updatedChat.agent = { ...updatedChat.agent!, workspace: legacyWorkspace };
              // 🔄 Ensure the migrated workspace directory exists
              ensureWorkspaceExists(legacyWorkspace);
              chatNeedsUpdate = true;
              logger.info('[ProfileCacheManager] Migrated workspace from chat level to agent level', 'ensureV2ProfileIntegrity', {
                alias,
                chatId: updatedChat.chat_id,
                workspace: legacyWorkspace
              });
            } else {
              // Otherwise set the default path (getDefaultWorkspacePath auto-creates the directory)
              const defaultWorkspace = getDefaultWorkspacePath(alias, updatedChat.chat_id);
              updatedChat.agent = { ...updatedChat.agent!, workspace: defaultWorkspace };
              chatNeedsUpdate = true;
            }
          } else {
            // 🔄 workspace already exists; ensure the directory exists
            ensureWorkspaceExists(currentWorkspace);
          }
          
          // Remove the legacy chat.workspace field if it exists
          if (legacyWorkspace !== undefined) {
            delete (updatedChat as any).workspace;
            chatNeedsUpdate = true;
          }
          
          // 🆕 knowledgeBase migration logic
          const agentWorkspace = updatedChat.agent?.workspace || '';
          const currentKnowledgeBase = updatedChat.agent?.knowledgeBase;
          if (agentWorkspace && (!currentKnowledgeBase || typeof currentKnowledgeBase !== 'string' || currentKnowledgeBase.trim() === '')) {
            // knowledgeBase field is missing — needs migration
            const agentName = updatedChat.agent?.name || 'default';
            const agentSource = updatedChat.agent?.source || 'ON-DEVICE';
            
            if (isDefaultWorkspacePath(alias, agentWorkspace)) {
              // Default workspace path: knowledgeBase = workspace/knowledge; move other files into the knowledge directory
              const knowledgeBasePath = path.join(agentWorkspace, 'knowledge');
              ensureWorkspaceExists(knowledgeBasePath);
              
              // Move other files/directories currently in workspace into knowledge directory (skip the knowledge dir itself)
              const movedCount = moveContentsToDirectory(agentWorkspace, knowledgeBasePath, ['knowledge']);
              if (movedCount > 0) {
                logger.info('[ProfileCacheManager] Migrated workspace files to knowledgeBase', 'ensureV2ProfileIntegrity', {
                  alias,
                  chatId: updatedChat.chat_id,
                  agentName,
                  workspace: agentWorkspace,
                  knowledgeBase: knowledgeBasePath,
                  movedCount
                });
              }
              updatedChat.agent = { ...updatedChat.agent!, knowledgeBase: knowledgeBasePath };
            } else {
              // Non-default workspace path: knowledgeBase = old workspace; workspace reverts to the default path
              const oldWorkspace = agentWorkspace;
              const defaultWorkspace = getDefaultAgentWorkspacePath(alias, agentName, agentSource);
              ensureWorkspaceExists(defaultWorkspace);
              
              updatedChat.agent = { 
                ...updatedChat.agent!, 
                knowledgeBase: oldWorkspace,
                workspace: defaultWorkspace
              };
              logger.info('[ProfileCacheManager] Migrated non-default workspace to knowledgeBase', 'ensureV2ProfileIntegrity', {
                alias,
                chatId: updatedChat.chat_id,
                agentName,
                oldWorkspace,
                newWorkspace: defaultWorkspace,
                knowledgeBase: oldWorkspace
              });
            }
            chatNeedsUpdate = true;
          } else if (currentKnowledgeBase && typeof currentKnowledgeBase === 'string' && currentKnowledgeBase.trim() !== '') {
            // knowledgeBase already exists; ensure the directory exists
            ensureWorkspaceExists(currentKnowledgeBase);
          }
        }
        
        // 🔥 New-architecture migration: check whether chatSessions still exists in profile.json.
        // If so, migrate to the new directory structure and remove it from profile.json.
        const legacyChatSessions = (updatedChat as any).chatSessions;
        if (legacyChatSessions && Array.isArray(legacyChatSessions) && legacyChatSessions.length > 0) {
          logger.info('[ProfileCacheManager] Found chatSessions in profile.json, starting migration', 'ensureV2ProfileIntegrity', {
            alias,
            chatId: updatedChat.chat_id,
            sessionCount: legacyChatSessions.length
          });
          
          // Clean and validate chatSessions
          const cleanedSessions = ChatSessionUtils.sanitizeChatSessions(legacyChatSessions);
          
          // Execute migration
          const migrationSuccess = await this.migrateChatSessionsToNewStructure(alias, updatedChat.chat_id, cleanedSessions);
          
          if (migrationSuccess) {
            logger.info('[ProfileCacheManager] Migration completed, removing chatSessions from profile.json', 'ensureV2ProfileIntegrity', {
              alias,
              chatId: updatedChat.chat_id
            });
          } else {
            logger.error('[ProfileCacheManager] Migration failed for chatSessions', 'ensureV2ProfileIntegrity', {
              alias,
              chatId: updatedChat.chat_id
            });
          }
          
          // Remove chatSessions from profile.json regardless of whether migration succeeded
          delete (updatedChat as any).chatSessions;
          chatNeedsUpdate = true;
          needsChatSessionsMigration = true;
        } else if (legacyChatSessions !== undefined) {
          // chatSessions exists but is an empty array — remove it too
          delete (updatedChat as any).chatSessions;
          chatNeedsUpdate = true;
        }
        
        // If there were any updates, apply them to profileCopy
        if (chatNeedsUpdate) {
          profileCopy.chats[index] = updatedChat;
          needsSave = true;
        }

        // ─── Phase 2: Agent field backfill (version / source / skills / mcp_servers, etc.) ───
        // ⚠️ Critical: must re-fetch from profileCopy.chats[index]; do NOT reuse the `chat` variable from Phase 1.
        // Phase 1 may have replaced the object via profileCopy.chats[index] = updatedChat.
        // Reusing `chat` would lose Phase 1's migration results (e.g. knowledgeBase).
        const currentChatRef = profileCopy.chats[index];
        if (currentChatRef.agent) {
          const rawMcpServers = currentChatRef.agent.mcp_servers || [];
          const cleanedMcpServers = rawMcpServers
            .map(server => {
              // 🔧 Backward compat: support both legacy (string) and new (object) formats
              if (typeof server === 'string') {
                // Legacy format: server is a name string
                return { name: server, tools: [] };
              } else if (server && typeof server === 'object' && server.name) {
                // New format: object with name and tools
                return {
                  name: server.name,
                  tools: Array.isArray(server.tools) ? server.tools : []
                };
              } else {
                // Invalid format — return null to be filtered out later
                return null;
              }
            })
            .filter((server): server is { name: string; tools: string[] } => server !== null && server.name !== ''); // filter out invalid servers
          
          // Check whether the format needs updating
          const formatNeedsUpdate = JSON.stringify(cleanedMcpServers) !== JSON.stringify(rawMcpServers);
          const contextEnhancementNeedsUpdate = !currentChatRef.agent.context_enhancement;
          // 🔧 Check whether agent needs a skills field added
          const skillsNeedsUpdate = !currentChatRef.agent.skills || !Array.isArray(currentChatRef.agent.skills);
          // Check whether agent needs version and source fields added
          const versionNeedsUpdate = currentChatRef.agent.version === undefined;
          const sourceNeedsUpdate = currentChatRef.agent.source === undefined;
          // Check whether agent needs a zero_states field added
          const zeroStatesNeedsUpdate = currentChatRef.agent.zero_states === undefined;
          // 🆕 Check whether agent needs an avatar field added
          const avatarNeedsUpdate = currentChatRef.agent.avatar === undefined;
          
          // 🔧 Step 2: Check whether the agent config needs updating
          let agentNeedsUpdate = false;
          const updatedAgent = { ...currentChatRef.agent };
          
          // Always ensure skills field exists
          if (skillsNeedsUpdate) {
            updatedAgent.skills = [];
            agentNeedsUpdate = true;
          }
          
          // 🆕 Always ensure version field exists
          if (versionNeedsUpdate) {
            updatedAgent.version = '1.0.0';
            agentNeedsUpdate = true;
          }
          
          // Always ensure source field exists
          if (sourceNeedsUpdate) {
            updatedAgent.source = 'ON-DEVICE';
            agentNeedsUpdate = true;
          }
          
          // Always ensure avatar field exists
          if (avatarNeedsUpdate) {
            updatedAgent.avatar = '';
            agentNeedsUpdate = true;
          }
          
          // Always ensure context_enhancement field exists
          if (contextEnhancementNeedsUpdate) {
            updatedAgent.context_enhancement = DEFAULT_CONTEXT_ENHANCEMENT;
            agentNeedsUpdate = true;
          }
          
          // 🆕 Always ensure zero_states field exists
          if (zeroStatesNeedsUpdate) {
            updatedAgent.zero_states = DEFAULT_ZERO_STATES;
            agentNeedsUpdate = true;
          }
          
          // Check whether mcp_servers needs updating
          if (formatNeedsUpdate) {
            updatedAgent.mcp_servers = cleanedMcpServers;
            agentNeedsUpdate = true;
          }
          
          // 🔧 Step 3: If this is a default assistant, check whether BUILTIN_SERVER_NAME needs to be added
          if (currentChatRef.agent.role === 'Default Assistant') {
            const hasBuiltinServer = cleanedMcpServers.some(server => server.name === BUILTIN_SERVER_NAME);
            
            if (!hasBuiltinServer) {
              // Add the builtin server
              updatedAgent.mcp_servers = [
                ...cleanedMcpServers,
                {
                  name: BUILTIN_SERVER_NAME,
                  tools: []  // Empty array: use all tools from the server
                }
              ];
              agentNeedsUpdate = true;
            }
          }
          
          // 🔧 Step 4: Check whether the old Kosmos agent config needs migrating to Kobi.
          // Only migrate when agent.name === 'Kosmos'; update both name and emoji.
          if (currentChatRef.agent && currentChatRef.agent.name === 'Kosmos') {
            updatedAgent.name = 'Kobi';
            updatedAgent.emoji = '🐬';
            agentNeedsUpdate = true;
          }
          
          // 🆕 Step 4.5: Ensure builtin agents include all builtin skills
          if (isBuiltinAgent(updatedAgent.name, BRAND_NAME)) {
            const currentSkills = updatedAgent.skills || [];
            const missingSkills = BUILTIN_SKILL_NAMES.filter(s => !currentSkills.includes(s));
            if (missingSkills.length > 0) {
              updatedAgent.skills = [...currentSkills, ...missingSkills];
              agentNeedsUpdate = true;
            }
          }
          
          // 🔧 Step 5: Apply agent updates if needed
          if (agentNeedsUpdate) {
            profileCopy.chats[index] = {
              ...currentChatRef,
              agent: updatedAgent
            };
            needsSave = true;
          }
        }
      }
      
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
        chats: [this.createDefaultChat()]
      };
    }
  }


  /**
   * Create a default chat config.
   */
  private createDefaultChat(): ChatConfig {
    return {
      chat_id: this.generateChatId(),
      chat_type: 'single_agent',
      agent: { ...DEFAULT_CHAT_AGENT, workspace: '' }
    };
  }

  /**
   * Generate a random Chat ID
   */
  private generateChatId(): string {
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

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
        const appTitle = process.env.APP_NAME; // "OpenKosmos", etc.
        
        // Window lookup strategy:
        // 1. Exact title match "OpenKosmos" (default / legacy)
        // 2. Title contains "Kosmos"
        // 3. Fall back to the only open window
        
        targetWindow = windows.find((window: BrowserWindow) => {
          const title = window.title;
          return title === 'OpenKosmos' || 
                 (appTitle && title === appTitle) || // Fallback to provided APP_NAME
                 title.includes('Kosmos');
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
                const result = await chatSessionManager.getChatSessions(alias, chat.chat_id);
                // Assign the loaded sessions to chat.chatSessions
                profileToUpdate.chats[index].chatSessions = result.sessions.map((s: any) => ({
                  chatSession_id: s.chatSession_id,
                  last_updated: s.last_updated,
                  title: s.title
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

  /**
   * Determine whether a profile is the default config (user has made no modifications).
   * Used when migrating the freDone field to determine whether the user needs the FRE.
   */
  private isDefaultProfile(profile: ProfileV2): boolean {
    // All of the following conditions must be true to qualify as the default config:
    // 1. mcp_servers is an empty array
    // 2. skills is an empty array
    // 3. chats has only one default chat (or is empty)
    // 4. The default chat's agent uses the default config (role is "Default Assistant", name is "Kobi")
    // 5. chatSessions is empty
    
    const hasNoMcpServers = !profile.mcp_servers || profile.mcp_servers.length === 0;
    const hasNoSkills = !profile.skills || profile.skills.length === 0;
    const hasDefaultChats = !profile.chats || profile.chats.length === 0 ||
      (profile.chats.length === 1 && this.isDefaultChatConfig(profile.chats[0]));
    
    return hasNoMcpServers && hasNoSkills && hasDefaultChats;
  }

  /**
   * Determine whether a ChatConfig is the default config.
   */
  private isDefaultChatConfig(chat: ChatConfig): boolean {
    // Characteristics of a default chat:
    // 1. agent.role is "Default Assistant"
    // 2. agent.name is "Kobi"
    // 3. agent has no custom mcp_servers (only the default builtin-tools or empty)
    // Note: chatSessions are no longer part of ChatConfig; they are loaded at runtime.
    
    if (!chat.agent) return true;
    
    const isDefaultAgent = chat.agent.role === 'Default Assistant' && chat.agent.name === 'Kobi';
    const hasNoCustomMcpServers = !chat.agent.mcp_servers ||
      chat.agent.mcp_servers.length === 0 ||
      (chat.agent.mcp_servers.length === 1 && chat.agent.mcp_servers[0].name === 'builtin-tools');
    
    return isDefaultAgent && hasNoCustomMcpServers;
  }

  /**
   * 🔥 New architecture: migrate chatSessions from profile.json to the new directory structure.
   * New directory structure:
   *   {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/
   *   {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/index.json
   *   {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/
   *   {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/index.json
   *
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessions List of ChatSession metadata to migrate
   * @returns Whether the migration succeeded
   */
  private async migrateChatSessionsToNewStructure(alias: string, chatId: string, chatSessions: ChatSession[]): Promise<boolean> {
    try {
      logger.info('[ProfileCacheManager] Starting chatSessions migration', 'migrateChatSessionsToNewStructure', {
        alias,
        chatId,
        sessionCount: chatSessions.length
      });

      // Use ChatSessionFileOps to read the old session files
      const chatSessionFileOps = ChatSessionFileOps.getInstance(alias);

      // Iterate over each chatSession, read its data file, and migrate to the new structure
      for (const session of chatSessions) {
        try {
          // Read the old session file
          const readResult = await chatSessionFileOps.readChatSession(session.chatSession_id);
          
          if (!readResult.success || !readResult.data) {
            logger.warn('[ProfileCacheManager] Failed to read old session file, skipping', 'migrateChatSessionsToNewStructure', {
              alias,
              chatId,
              sessionId: session.chatSession_id,
              error: readResult.error
            });
            continue;
          }

          const sessionFile = readResult.data as ChatSessionFile;

          // Use chatSessionManager to add to the new structure
          const addResult = await chatSessionManager.addChatSession(
            alias,
            chatId,
            session,
            sessionFile
          );

          if (addResult) {
            logger.info('[ProfileCacheManager] Session migrated successfully', 'migrateChatSessionsToNewStructure', {
              alias,
              chatId,
              sessionId: session.chatSession_id
            });
          } else {
            logger.warn('[ProfileCacheManager] Failed to migrate session to new structure', 'migrateChatSessionsToNewStructure', {
              alias,
              chatId,
              sessionId: session.chatSession_id
            });
          }
        } catch (sessionError) {
          logger.error('[ProfileCacheManager] Error migrating individual session', 'migrateChatSessionsToNewStructure', {
            alias,
            chatId,
            sessionId: session.chatSession_id,
            error: sessionError instanceof Error ? sessionError.message : String(sessionError)
          });
          // Continue migrating other sessions; do not abort on a single failure
        }
      }

      logger.info('[ProfileCacheManager] Migration completed', 'migrateChatSessionsToNewStructure', {
        alias,
        chatId,
        sessionCount: chatSessions.length
      });

      return true;
    } catch (error) {
      logger.error('[ProfileCacheManager] Migration failed', 'migrateChatSessionsToNewStructure', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

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
      chats: [this.createDefaultChat()]
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
  async handleProfile(alias: string): Promise<ProfileV2 | null> {
    console.time('[ProfileCacheManager] handleProfile');
    try {

      // Set the current user alias
      this.currentUserAlias = alias;

      // Check whether a local profile.json exists
      let profile = await this.readProfileFromFile(alias);
      
      if (profile) {
        // Case 1: profile.json exists — load the existing config

        // Update the cache
        this.cache.set(alias, profile);

        // Notify the frontend ProfileDataManager to sync data (immediate for profile updates)
        await this.notifyProfileDataManager(alias, true);

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
        await this.notifyProfileDataManager(alias, true);

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
      // Initialize MCPClientManager
      (async () => {
        console.time('[ProfileCacheManager] mcpClientManager.initialize');
        try {
          const { mcpClientManager } = await import('../mcpRuntime/mcpClientManager');
          this.mcpClientManager = mcpClientManager;
          await mcpClientManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] mcpClientManager.initialize');
        } catch (mcpError) {
          console.timeEnd('[ProfileCacheManager] mcpClientManager.initialize');
          console.error('[ProfileCacheManager] MCP initialization failed:', mcpError);
        }
      })(),

      // Initialize the Mem0 system
      (async () => {
        console.time('[ProfileCacheManager] getKosmosMemory');
        try {
          const { getKosmosMemory } = await import('../mem0/kosmos-adapters');
          await getKosmosMemory(alias);
          console.timeEnd('[ProfileCacheManager] getKosmosMemory');
        } catch (mem0Error) {
          console.timeEnd('[ProfileCacheManager] getKosmosMemory');
          console.error('[ProfileCacheManager] Mem0 initialization failed:', mem0Error);
        }
      })(),

      // Initialize AgentChatManager
      (async () => {
        console.time('[ProfileCacheManager] agentChatManager.initialize');
        try {
          const { agentChatManager } = await import('../chat/agentChatManager');
          await agentChatManager.initialize(alias);
          console.timeEnd('[ProfileCacheManager] agentChatManager.initialize');
        } catch (agentError) {
          console.timeEnd('[ProfileCacheManager] agentChatManager.initialize');
          console.error('[ProfileCacheManager] AgentChatManager initialization failed:', agentError);
        }
      })()
    ]).then((results) => {
      console.timeEnd('[ProfileCacheManager] backgroundServices');
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[ProfileCacheManager] ${failed.length} background services failed to initialize`);
      } else {
        console.log('[ProfileCacheManager] All background services initialized successfully');
      }
    });
  }


  /**
   * Function 4: Add/Update/Delete the specified mcp_server config in the cache, notify profileDataManager to sync the cache to the frontend, then persist to profile.json
   */
  async addMcpServerConfig(alias: string, mcpServerConfig: McpServerConfig): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Check whether a server with the same name already exists
      const existingIndex = profile.mcp_servers.findIndex(server => server.name === mcpServerConfig.name);
      if (existingIndex >= 0) {
        return false;
      }

      // Add the new server
      profile.mcp_servers.push(mcpServerConfig);

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async updateMcpServerConfig(alias: string, serverName: string, updates: Partial<McpServerConfig>): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Find the server to update
      const serverIndex = profile.mcp_servers.findIndex(server => server.name === serverName);
      if (serverIndex < 0) {
        return false;
      }

      // Update the server config
      profile.mcp_servers[serverIndex] = {
        ...profile.mcp_servers[serverIndex],
        ...updates
      };

      // Update the cache
      this.cache.set(alias, profile);

      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async deleteMcpServerConfig(alias: string, serverName: string): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Find the server to delete
      const serverIndex = profile.mcp_servers.findIndex(server => server.name === serverName);
      if (serverIndex < 0) {
        return false;
      }

      // Delete the server
      profile.mcp_servers.splice(serverIndex, 1);

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ========================================
   * Skills config management methods (V2 Profile only)
   * ========================================
   */

  /**
   * Add Skill config to a V2 Profile
   * @param alias User alias
   * @param skillConfig Skill configuration
   * @returns Whether the add succeeded
   */
  async addSkill(alias: string, skillConfig: { name: string; description: string; version: string; source: 'ON-DEVICE' }): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          logger.warn(`[ProfileCacheManager] addSkill failed: profile not found for alias "${alias}"`);
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support skills
      if (!isProfileV2(profile)) {
        logger.warn(`[ProfileCacheManager] addSkill failed: profile for "${alias}" is not V2 format`);
        return false;
      }

      // Ensure the skills array exists
      if (!profile.skills) {
        profile.skills = [];
      }

      // Check whether a skill with the same name already exists — if so, update the config (idempotent)
      const existingIndex = profile.skills.findIndex(skill => skill.name === skillConfig.name);
      if (existingIndex >= 0) {
        logger.info(`[ProfileCacheManager] addSkill: skill "${skillConfig.name}" already exists, updating config`);
        profile.skills[existingIndex] = { ...profile.skills[existingIndex], ...skillConfig };
      } else {
        // Add the new skill
        profile.skills.push(skillConfig);
      }

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
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

  /**
   * Update Skill config in a V2 Profile
   * @param alias User alias
   * @param skillName Skill name
   * @param updates Skill config updates (description and version)
   * @returns Whether the update succeeded
   */
  async updateSkill(alias: string, skillName: string, updates: { description?: string; version?: string }): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support skills
      if (!isProfileV2(profile)) {
        return false;
      }

      // Ensure the skills array exists
      if (!profile.skills || !Array.isArray(profile.skills)) {
        return false;
      }

      // Find the skill to update
      const skillIndex = profile.skills.findIndex(skill => skill.name === skillName);
      if (skillIndex < 0) {
        return false;
      }

      // Update the skill config
      profile.skills[skillIndex] = {
        ...profile.skills[skillIndex],
        ...updates
      };

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete Skill config from a V2 Profile
   * @param alias User alias
   * @param skillName Skill name
   * @returns Whether the delete succeeded
   */
  async deleteSkill(alias: string, skillName: string): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support skills
      if (!isProfileV2(profile)) {
        return false;
      }

      // Ensure the skills array exists
      if (!profile.skills || !Array.isArray(profile.skills)) {
        return false;
      }

      // Find the skill to delete
      const skillIndex = profile.skills.findIndex(skill => skill.name === skillName);
      if (skillIndex < 0) {
        return false;
      }

      // Delete the skill
      profile.skills.splice(skillIndex, 1);

      // 🔧 Removed: skill references are no longer automatically deleted from agent.skills
      // The skill selection in agent config is preserved; users manage it themselves

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ========================================
   * Chat config management methods (V2 Profile only)
   * ========================================
   */

  /**
   * Add Chat config to a V2 Profile
   */
  async addChatConfig(alias: string, chatConfig: ChatConfig): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support chats config
      if (!isProfileV2(profile)) {
        return false;
      }

      // Check whether a chat with the same ID already exists
      const existingIndex = profile.chats.findIndex(chat => chat.chat_id === chatConfig.chat_id);
      if (existingIndex >= 0) {
        return false;
      }

      // 🔄 Auto-set the default workspace path (now at the agent level)
      // New rule: directory name is agent-{name}-{source}, format: {user profile folder}/chat_workspaces/agent-{name}-{source}/
      if (chatConfig.agent && (!chatConfig.agent.workspace || chatConfig.agent.workspace.trim() === '')) {
        const agentName = chatConfig.agent.name || 'default';
        const agentSource = chatConfig.agent.source || 'ON-DEVICE';
        chatConfig.agent.workspace = getDefaultAgentWorkspacePath(alias, agentName, agentSource);
      }
      
      // 🔄 Ensure the workspace directory exists (whether the default or user-specified path)
      if (chatConfig.agent?.workspace) {
        ensureWorkspaceExists(chatConfig.agent.workspace);
      }

      // 🆕 Auto-set the default knowledgeBase path (workspace/knowledge)
      if (chatConfig.agent && (!chatConfig.agent.knowledgeBase || chatConfig.agent.knowledgeBase.trim() === '')) {
        if (chatConfig.agent.workspace) {
          chatConfig.agent.knowledgeBase = path.join(chatConfig.agent.workspace, 'knowledge');
        }
      }
      
      // 🆕 Ensure the knowledgeBase directory exists
      if (chatConfig.agent?.knowledgeBase) {
        ensureWorkspaceExists(chatConfig.agent.knowledgeBase);
      }

      // Add the new chat
      profile.chats.push(chatConfig);

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update Chat config
   */
  async updateChatConfig(alias: string, chatId: string, updates: Partial<ChatConfig>): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support chats config
      if (!isProfileV2(profile)) {
        return false;
      }

      // Find the chat to update
      const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (chatIndex < 0) {
        return false;
      }

      // Update the chat config
      profile.chats[chatIndex] = {
        ...profile.chats[chatIndex],
        ...updates
      };

      // Update the cache
      this.cache.set(alias, profile);

      // 🔧 Fix: immediately notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete Chat config
   * Also cleans up the associated ChatSessions and default workspace directory
   * Note: built-in agents (e.g. Kobi, PM Agent) cannot be deleted
   */
  async deleteChatConfig(alias: string, chatId: string): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support chats config
      if (!isProfileV2(profile)) {
        return false;
      }

      // Find the chat to delete
      const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (chatIndex < 0) {
        return false;
      }

      // 🔥 Prevent deletion of built-in agents
      const chatToDelete = profile.chats[chatIndex];
      if (isBuiltinAgent(chatToDelete.agent?.name, BRAND_NAME)) {
        logger.warn('[ProfileCacheManager] Cannot delete built-in agent', 'deleteChatConfig', {
          alias,
          chatId,
          agentName: chatToDelete.agent?.name,
        });
        return false;
      }

      // Prevent deleting the last chat (ensure at least one default chat remains)
      if (profile.chats.length <= 1) {
        profile.chats = [this.createDefaultChat()];
      } else {
        // Delete the chat
        profile.chats.splice(chatIndex, 1);
      }

      // 🔧 Clean up the associated ChatSessions directory
      const chatSessionsCleanup = removeChatSessionsDirectory(alias, chatId);
      if (!chatSessionsCleanup) {
        logger.warn('[ProfileCacheManager] Failed to cleanup chat sessions directory', 'deleteChatConfig', {
          alias,
          chatId,
        });
      } else {
        logger.info('[ProfileCacheManager] Successfully cleaned up chat sessions directory', 'deleteChatConfig', {
          alias,
          chatId,
        });
      }

      // 🔧 Clean up the associated default workspace directory
      const workspaceCleanup = removeDefaultWorkspaceDirectory(alias, chatId);
      if (!workspaceCleanup) {
        logger.warn('[ProfileCacheManager] Failed to cleanup workspace directory', 'deleteChatConfig', {
          alias,
          chatId,
        });
      } else {
        logger.info('[ProfileCacheManager] Successfully cleaned up workspace directory', 'deleteChatConfig', {
          alias,
          chatId,
        });
      }

      // Update the cache
      this.cache.set(alias, profile);

      // Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the specified Chat config
   */
  getChatConfig(alias: string, chatId: string): ChatConfig | null {
    try {
      const profile = this.cache.get(alias);
      if (!profile || !isProfileV2(profile)) {
        return null;
      }

      return profile.chats.find(chat => chat.chat_id === chatId) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all Chat configs
   */
  getAllChatConfigs(alias: string): ChatConfig[] {
    try {
      const profile = this.cache.get(alias);
      if (!profile || !isProfileV2(profile)) {
        return [];
      }

      return [...profile.chats]; // Return a copy to prevent external mutation
    } catch (error) {
      return [];
    }
  }

  /**
   * Update the Chat Agent config
   */
  async updateChatAgent(alias: string, chatId: string, agentUpdates: Partial<ChatAgent>): Promise<boolean> {
    try {

      const profile = this.cache.get(alias);
      if (!profile || !isProfileV2(profile)) {
        return false;
      }

      const chatIndex = profile.chats.findIndex(chat => chat.chat_id === chatId);
      if (chatIndex < 0) {
        return false;
      }

      const currentChat = profile.chats[chatIndex];
      const oldAgent = currentChat.agent;

      // ============================================
      // 🆕 Quick Start image cache cleanup logic
      // ============================================
      if (oldAgent?.name) {
        let shouldClearImageCache = false;

        // Case 1: version changed
        if (agentUpdates.version !== undefined && 
            oldAgent.version !== agentUpdates.version) {
          shouldClearImageCache = true;
          logger.info(`[ProfileCacheManager] Agent version changed: ${oldAgent.version} -> ${agentUpdates.version}, will clear image cache`);
        }

        // Case 2: zero_states.quick_starts changed
        if (agentUpdates.zero_states !== undefined) {
          const oldQuickStarts = JSON.stringify(oldAgent.zero_states?.quick_starts || []);
          const newQuickStarts = JSON.stringify(agentUpdates.zero_states?.quick_starts || []);
          
          if (oldQuickStarts !== newQuickStarts) {
            shouldClearImageCache = true;
            logger.info(`[ProfileCacheManager] Agent quick_starts changed, will clear image cache`);
          }
        }

        // Execute cache cleanup
        if (shouldClearImageCache) {
          quickStartImageCacheManager.clearAgentCache(oldAgent.name);
        }
      }
      // ============================================
      
      // 🔄 If workspace was updated, ensure the directory exists
      if (agentUpdates.workspace && agentUpdates.workspace.trim() !== '') {
        ensureWorkspaceExists(agentUpdates.workspace);
      }
      
      // 🆕 If knowledgeBase was updated, ensure the directory exists
      if (agentUpdates.knowledgeBase && agentUpdates.knowledgeBase.trim() !== '') {
        ensureWorkspaceExists(agentUpdates.knowledgeBase);
      }
      
      // ============================================
      // 🆕 Sync primaryAgent when an agent is renamed
      // ============================================
      const oldAgentName = oldAgent?.name;
      const newAgentName = agentUpdates.name;
      
      if (newAgentName !== undefined && oldAgentName && newAgentName !== oldAgentName) {
        // Check whether this is an ON-DEVICE agent (only ON-DEVICE agents can be renamed)
        // If the renamed agent is the current primaryAgent, sync the primaryAgent update
        if (profile.primaryAgent === oldAgentName) {
          profile.primaryAgent = newAgentName;
          logger.info('[ProfileCacheManager] Updated primaryAgent due to agent rename', 'updateChatAgent', {
            oldPrimaryAgent: oldAgentName,
            newPrimaryAgent: newAgentName
          });
        }
        
        // Clear the image cache for the old name
        quickStartImageCacheManager.clearAgentCache(oldAgentName);
        logger.info('[ProfileCacheManager] Agent renamed', 'updateChatAgent', {
          oldName: oldAgentName,
          newName: newAgentName
        });
      }
      // ============================================
      
      // Update the agent config
      if (currentChat.agent) {
        profile.chats[chatIndex].agent = {
          ...currentChat.agent,
          ...agentUpdates
        };
      } else {
        // No existing agent — create a new one
        profile.chats[chatIndex].agent = {
          ...DEFAULT_CHAT_AGENT,
          ...agentUpdates
        };
      }

      // Update the cache
      this.cache.set(alias, profile);


      // 🔧 Fix: immediately notify the frontend ProfileDataManager to sync (immediate=true forces an instant IPC send)
      await this.notifyProfileDataManager(alias, true);
      

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the cached profile
   */
  getCachedProfile(alias: string): Profile | null {
    return this.cache.get(alias) || null;
  }

  /**
   * Force-notify the frontend ProfileDataManager to sync the cached data
   * Used to proactively sync data after a page reload
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

      // Phase 4: Clean up mem0 resources for user sign-out or profile switching
      this.cleanupMem0Resources().catch(error => {
      });
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

      // Phase 4: Clean up mem0 resources for complete application cleanup
      this.cleanupMem0Resources().catch(error => {
      });
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
   * Cleanup mem0 and mem0-server resources
   * Called during application shutdown or user sign-out
   *
   * 🔧 Fix duplicate-cleanup issue:
   * - ChromaDB server shutdown and mem0 instance reset are now fully handled by MainAuthManager.signOut() Phase 4
   * - ProfileCacheManager is only responsible for clearing local cache and runtime state; mem0 resources are no longer handled here
   * - Avoids duplicate calls to kosmosChromaServerManager.stopServer() and resetKosmosMemory()
   */
  async cleanupMem0Resources(): Promise<void> {
    const cleanupStart = Date.now();
    const cleanupId = `mem0Cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    try {
      
      // 🔧 Important: ChromaDB server and mem0 instance cleanup are no longer done here; they are handled centrally by MainAuthManager.signOut() Phase 4
      // Only logging is needed here to indicate that ProfileCacheManager's cleanup responsibilities have been simplified
      
      // ProfileCacheManager only clears local cache state (already handled elsewhere)
      // e.g. clearCache(), clearUserRuntimeStates(), etc.
      
      const cleanupDuration = Date.now() - cleanupStart;
    } catch (error) {
      const cleanupDuration = Date.now() - cleanupStart;
    }
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

  /**
   * ========================================
   * Voice Input Settings management methods (V2 Profile only)
   * ========================================
   */

  /**
   * Get Voice Input config
   * @param alias User alias
   * @returns Voice Input config
   */
  getVoiceInputSettings(alias: string): VoiceInputSettings {
    try {
      const profile = this.cache.get(alias);
      if (profile && isProfileV2(profile) && profile.voiceInputSettings) {
        return profile.voiceInputSettings;
      }
      return { ...DEFAULT_VOICE_INPUT_SETTINGS };
    } catch (error) {
      return { ...DEFAULT_VOICE_INPUT_SETTINGS };
    }
  }

  /**
   * Update Voice Input config
   * @param alias User alias
   * @param settings Voice Input config updates
   * @returns Whether the update succeeded
   */
  async updateVoiceInputSettings(alias: string, settings: Partial<VoiceInputSettings>): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support voiceInputSettings
      if (!isProfileV2(profile)) {
        return false;
      }

      // Get the current Voice Input settings (use defaults if not present)
      const currentSettings = profile.voiceInputSettings || { ...DEFAULT_VOICE_INPUT_SETTINGS };

      // Merge the new settings
      const updatedSettings: VoiceInputSettings = {
        ...currentSettings,
        ...settings
      };

      // Update the voiceInputSettings in the profile
      profile.voiceInputSettings = updatedSettings;

      // Update the cache
      this.cache.set(alias, profile);

      // Immediately notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ========================================
   * Primary Agent management methods (V2 Profile only)
   * ========================================
   */

  /**
   * Update Primary Agent
   * @param alias User alias
   * @param agentName Agent name
   * @returns Whether the update succeeded
   */
  async updatePrimaryAgent(alias: string, agentName: string): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Only V2 profiles support primaryAgent
      if (!isProfileV2(profile)) {
        return false;
      }

      // Validate that agentName exists in chats
      const agentExists = profile.chats.some(chat => chat.agent?.name === agentName);
      if (!agentExists) {
        return false;
      }

      // Check whether it is already the primary agent
      if (profile.primaryAgent === agentName) {
        return true; // Already the primary agent; no update needed
      }

      // Update the primaryAgent
      profile.primaryAgent = agentName;

      // Update the cache
      this.cache.set(alias, profile);

      // Immediately notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ========================================
   * FRE (First Run Experience) management methods
   * ========================================
   */

  /**
   * Update freDone status
   * @param alias User alias
   * @param freDone Whether the first run experience has been completed
   * @returns Whether the update succeeded
   */
  async updateFreDone(alias: string, freDone: boolean): Promise<boolean> {
    try {

      // Get the cached profile; fall back to reading from file if not cached
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }

      // Check whether the value is already the same to avoid an unnecessary update
      if (profile.freDone === freDone) {
        return true; // Value is the same; no update needed
      }

      // Update freDone
      profile.freDone = freDone;

      // Update the cache
      this.cache.set(alias, profile);

      // Immediately notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      // Write to file
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get freDone status
   * @param alias User alias
   * @returns freDone status; returns false if not present
   */
  getFreDone(alias: string): boolean {
    try {
      const profile = this.cache.get(alias);
      if (!profile) {
        return false;
      }
      return profile.freDone === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ========================================
   * ChatSession management methods (V2 Profile only)
   * 🔥 Refactored: adapted to the new chatSessionManager architecture
   * chatSessions are no longer stored in profile.json; they use an independent directory structure
   * ========================================
   */

  /**
   * Add a ChatSession to the specified Chat
   * 🔥 Refactored: uses chatSessionManager instead of directly manipulating profile.json
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSession ChatSession metadata
   * @param chatSessionFile Complete ChatSession file data
   */
  async addChatSession(alias: string, chatId: string, chatSession: ChatSession, chatSessionFile: ChatSessionFile): Promise<boolean> {
    try {
      logger.info('[ProfileCacheManager] Adding ChatSession via new architecture', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id
      });

      // 🔥 Use the new chatSessionManager to add the ChatSession
      const success = await chatSessionManager.addChatSession(
        alias,
        chatId,
        chatSession,
        chatSessionFile
      );

      if (!success) {
        logger.error('[ProfileCacheManager] Failed to add ChatSession via chatSessionManager', 'addChatSession', {
          alias,
          chatId,
          chatSessionId: chatSession.chatSession_id
        });
        return false;
      }

      // 🔧 Notify the frontend ProfileDataManager to sync (chatSessionManager also notifies internally, but keep this for compatibility)
      await this.notifyProfileDataManager(alias, true);

      logger.info('[ProfileCacheManager] ChatSession added successfully via new architecture', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id
      });

      return true;
    } catch (error) {
      logger.error('[ProfileCacheManager] Exception in addChatSession', 'addChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Update a ChatSession
   * 🔥 Refactored: uses chatSessionManager instead of directly manipulating profile.json
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessionId ChatSession ID
   * @param updates ChatSession metadata updates
   * @param chatSessionFile Complete ChatSession file data
   */
  async updateChatSession(alias: string, chatId: string, chatSessionId: string, updates: Partial<ChatSession>, chatSessionFile: ChatSessionFile): Promise<boolean> {
    try {
      logger.info('[ProfileCacheManager] Updating ChatSession via new architecture', 'updateChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      // 🔥 Use the new chatSessionManager to update the ChatSession
      const success = await chatSessionManager.updateChatSession(
        alias,
        chatId,
        chatSessionId,
        updates,
        chatSessionFile
      );

      if (!success) {
        logger.error('[ProfileCacheManager] Failed to update ChatSession via chatSessionManager', 'updateChatSession', {
          alias,
          chatId,
          chatSessionId
        });
        return false;
      }

      // 🔧 Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      logger.info('[ProfileCacheManager] ChatSession updated successfully via new architecture', 'updateChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      return true;
    } catch (error) {
      logger.error('[ProfileCacheManager] Exception in updateChatSession', 'updateChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete a ChatSession
   * 🔥 Refactored: uses chatSessionManager instead of directly manipulating profile.json
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessionId ChatSession ID
   */
  async deleteChatSession(alias: string, chatId: string, chatSessionId: string): Promise<boolean> {
    try {
      logger.info('[ProfileCacheManager] Deleting ChatSession via new architecture', 'deleteChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      // 🔥 Use the new chatSessionManager to delete the ChatSession
      const success = await chatSessionManager.deleteChatSession(alias, chatId, chatSessionId);

      if (!success) {
        logger.error('[ProfileCacheManager] Failed to delete ChatSession via chatSessionManager', 'deleteChatSession', {
          alias,
          chatId,
          chatSessionId
        });
        return false;
      }

      // 🔧 Notify the frontend ProfileDataManager to sync
      await this.notifyProfileDataManager(alias, true);

      logger.info('[ProfileCacheManager] ChatSession deleted successfully via new architecture', 'deleteChatSession', {
        alias,
        chatId,
        chatSessionId
      });

      return true;
    } catch (error) {
      logger.error('[ProfileCacheManager] Exception in deleteChatSession', 'deleteChatSession', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get all ChatSessions for the specified Chat (metadata only, no data files)
   * 🔥 Refactored: retrieves from chatSessionManager, not profile.json
   * Note: this is a synchronous method, but the new architecture requires async, so this method is deprecated
   * @deprecated Use getChatSessionsAsync instead
   */
  getChatSessions(alias: string, chatId: string): ChatSession[] {
    // 🔥 Warning: this method is synchronous and cannot use the new chatSessionManager
    // For backward compatibility, returns an empty array and logs a warning
    logger.warn('[ProfileCacheManager] getChatSessions is deprecated, use getChatSessionsAsync instead', 'getChatSessions', {
      alias,
      chatId
    });
    return [];
  }

  /**
   * 🔥 New: async retrieval of all ChatSessions for a specified Chat
   * Retrieves from chatSessionManager
   */
  async getChatSessionsAsync(alias: string, chatId: string): Promise<ChatSession[]> {
    try {
      const result = await chatSessionManager.getChatSessions(alias, chatId);
      return result.sessions;
    } catch (error) {
      logger.error('[ProfileCacheManager] Failed to get ChatSessions async', 'getChatSessionsAsync', {
        alias,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get the data file content for a specified ChatSession
   * 🔥 Refactored: uses chatSessionManager (requires chatId parameter)
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSessionId ChatSession ID
   * @returns ChatSessionFile structure or null
   */
  async getChatSessionFile(alias: string, chatId: string, chatSessionId: string): Promise<ChatSessionFile | null> {
    try {
      return await chatSessionManager.getChatSessionFile(alias, chatId, chatSessionId);
    } catch (error) {
      logger.error('[ProfileCacheManager] Failed to get ChatSession file', 'getChatSessionFile', {
        alias,
        chatId,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Check whether a ChatSession with the same ID already exists
   * 🔥 Refactored: uses chatSessionManager
   * @param alias User alias
   * @param chatId Chat ID
   * @param chatSession The ChatSession to check
   * @returns Promise<boolean> true if it exists, false otherwise
   */
  /**
   * Get Browser Control configuration
   */
  getBrowserControlSettings(alias: string): BrowserControlSettings {
    try {
      const profile = this.cache.get(alias);
      if (profile && isProfileV2(profile) && profile.browserControl) {
        return profile.browserControl;
      }
      return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
    } catch (error) {
      return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
    }
  }

  /**
   * Update Browser Control configuration
   */
  async updateBrowserControlSettings(alias: string, settings: Partial<BrowserControlSettings>): Promise<boolean> {
    try {
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) {
          return false;
        }
        profile = fileProfile;
      }
      if (!isProfileV2(profile)) {
        return false;
      }
      const currentSettings = profile.browserControl || { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
      const updatedSettings: BrowserControlSettings = {
        ...currentSettings,
        ...settings
      };
      profile.browserControl = updatedSettings;
      this.cache.set(alias, profile);
      await this.notifyProfileDataManager(alias, true);
      const success = await this.writeProfileToFile(alias, profile);
      if (!success) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async existChatSession(alias: string, chatId: string, chatSession: ChatSession): Promise<boolean> {
    try {
      // 🔥 Use the new chatSessionManager to check existence
      return await chatSessionManager.existsChatSession(alias, chatId, chatSession.chatSession_id);
    } catch (error) {
      logger.error('[ProfileCacheManager] Failed to check ChatSession existence', 'existChatSession', {
        alias,
        chatId,
        chatSessionId: chatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

// Export singleton instance
export const profileCacheManager = ProfileCacheManager.getInstance();