import {
  ProfileCacheData,
  ProfileCacheDataV2,
  ProfileDataListener,
  type Profile,
  type ProfileV2,
  type ChatConfigRuntime,
  type ChatAgent,
  type ChatSession,
  type StarredChatSessionIndexItem,
  type SkillConfig,
  type SubAgentConfig
} from './types'
import { agentChatSessionCacheManager } from '../chat/agentChatSessionCacheManager'
import { createLogger } from '../utilities/logger';
import { mcpClientCacheManager } from "../mcp/mcpClientCacheManager";
const logger = createLogger('[ProfileDataManager]');

const isScheduledSession = (session: Partial<ChatSession> | null | undefined): boolean => {
  return !!session?.schedulerJobId && session.schedulerJobId.trim().length > 0
}

/**
 * ProfileDataManager - Refactored for data synchronization only
 *
 * 🆕 Refactoring notes:
 * - MCP server runtime state management has been migrated to mcpClientCacheManager
 * - profileDataManager no longer caches or manages MCP runtime state
 * - All MCP-related read-only access methods have been marked as deprecated and delegate directly to mcpClientCacheManager
 *
 * Responsibilities:
 * 1. Sync profile data from ProfileCacheManager (main process)
 * 2. Provide read-only access to cached profile data
 * 3. Handle notifications from main process about profile data changes
 * 4. Notify frontend components when profile data changes
 *
 * NOT responsible for:
 * - MCP server runtime state management (migrated to mcpClientCacheManager)
 * - Auth session management (removed auth-related caching)
 * - localStorage operations
 * - Data modification operations
 * - User alias management
 * - Auth token/user/capabilities management
 */
export class ProfileDataManager {
  private static instance: ProfileDataManager
  private cache: ProfileCacheDataV2
  private listeners: ProfileDataListener[] = []
  private userAlias: string | null = null
  private chatSessionReadStatusUpdatedAt: Map<string, number> = new Map()

  // Historical prompt queue management
  private promptHistory: string[] = []
  private promptCursor: number = -1 // -1 indicates pointing to queue tail (E position)
  private currentEditingPrompt: string = ''
  private readonly HISTORY_PROMPT_QUEUE_SIZE: number = parseInt(process.env.HISTORY_PROMPT_QUEUE_SIZE || '20')

  private constructor() {
    // MCP data is now independently managed by mcpClientCacheManager
    this.cache = {
      profile: null,
      chats: [],
      skills: [],
      subAgents: [],
      lastUpdated: 0,
      isInitialized: false
    }

    // 🔧 FIX: Setup IPC listeners immediately when ProfileDataManager is created
    // This ensures listeners are ready BEFORE any IPC messages are sent from main process
    this.setupDataSyncListeners()
  }

  static getInstance(): ProfileDataManager {
    if (!ProfileDataManager.instance) {
      ProfileDataManager.instance = new ProfileDataManager()
    }
    return ProfileDataManager.instance
  }

  // Get cached data (read-only)
  getCache(): ProfileCacheData {
    return { ...this.cache }
  }

  // Subscribe to data changes
  subscribe(listener: ProfileDataListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  // Debounced notification to reduce frequent updates
  private notificationTimeout: NodeJS.Timeout | null = null
  private pendingNotification = false

  // Notify all listeners of data changes (with debouncing)
  private notifyListeners(immediate = false): void {
    if (immediate) {
      this.performNotification()
      return
    }

    // Use debouncing to reduce frequent notifications during initialization
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout)
    }

    this.pendingNotification = true
    this.notificationTimeout = setTimeout(() => {
      if (this.pendingNotification) {
        this.performNotification()
      }
    }, 200) // 200ms debounce
  }

  private performNotification(): void {
    const cacheSnapshot = this.getCache()
    this.listeners.forEach((listener, index) => {
      listener(cacheSnapshot)
    })

    this.pendingNotification = false
    this.notificationTimeout = null
  }

  // Initialize ProfileDataManager with empty data structure - PASSIVE MODE
  // Passive mode: only initialize empty data structure, wait for IPC notifications from ProfileCacheManager
  async initialize(userAlias: string): Promise<void> {

    if (!userAlias) {
      throw new Error(
        'User alias is required for ProfileDataManager initialization',
      );
    }

    if (this.userAlias === userAlias && this.cache.isInitialized) {
      return;
    }

    this.userAlias = userAlias;

    // 🔧 FIX: IPC listeners are now set up in constructor, not here
    // This ensures listeners are ready BEFORE main process sends any messages

    // 🔧 FIX: Only initialize empty data structure, isInitialized stays false
    // Will be set to true only when first sync from ProfileCacheManager succeeds
    this.cache = {
      profile: null,
      chats: [],
      skills: [],
      subAgents: [],
      lastUpdated: Date.now(),
      isInitialized: false  // 🔧 Keep false until first successful sync
    }


    // 🔧 FIX: Actively pull profile data from main process as a reliable fallback.
    // Background: main process sends `profile:cacheUpdated` BEFORE `auth_set`, so when this
    // method is called the push-based notification has already been silently dropped
    // (userAlias was empty at the time). The `profile:getProfile` IPC triggers
    // `forceNotifyProfileDataManager` on the main side (push), but we also directly use
    // the returned data here so initialization succeeds even if the push is lost (e.g.
    // machine woke from sleep mid-IPC, window not found, etc.).
    //
    // A 15-second timeout guards against indefinite hangs when the machine suspends while
    // the IPC invoke is in-flight (observed: Windows ARM connected-standby after ~6 min).
    try {
      if (window.electronAPI && window.electronAPI.profile) {
        const timeoutMs = 15000;
        let timeoutHandle: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`getProfile timed out after ${timeoutMs}ms`)), timeoutMs)
        });
        const result = await Promise.race([
          window.electronAPI.profile.getProfile(userAlias),
          timeoutPromise,
        ]);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        // Directly apply the returned profile so isInitialized is set even when the
        // push-based `profile:cacheUpdated` event was missed.
        if (result.success && result.data && !this.cache.isInitialized) {
          this.handleProfileCacheUpdate({ alias: userAlias, profile: result.data, timestamp: Date.now() });
        }
      }
    } catch (error) {
      // Non-fatal: push-based profile:cacheUpdated may still arrive via forceNotifyProfileDataManager
      logger.warn('[ProfileDataManager] getProfile fallback failed or timed out:', error instanceof Error ? error.message : String(error));
    }

  }

  // Set up listeners for data sync from main process
  // 🆕 Refactored: MCP state listening has been migrated to mcpClientCacheManager
  private setupDataSyncListeners(): void {

    // 🆕 Refactored: MCP state listening has been migrated to mcpClientCacheManager
    // No longer listening for mcp:serverStatesUpdated events here

    if (window.electronAPI && window.electronAPI.profile) {
      // Listen for profile cache updates from ProfileCacheManager
      window.electronAPI.profile.onCacheUpdated((data: {alias: string; profile: any; timestamp: number}) => {
        this.handleProfileCacheUpdate(data)
      })

      // 🔥 New: Listen for auto-select ChatSession IPC events
      window.electronAPI.profile.onAutoSelectChatSession((data: {alias: string; chatId: string; chatSessionId: string; timestamp: number}) => {
        this.handleAutoSelectChatSession(data)
      })

      if (window.electronAPI.profile.onChatSessionStoreSessionCreated) {
        window.electronAPI.profile.onChatSessionStoreSessionCreated((data: {alias: string; chatId: string; session: ChatSession; timestamp: number}) => {
          this.handleChatSessionStoreSessionCreated(data)
        })
      }

      if (window.electronAPI.profile.onChatSessionStoreMetadataPatched) {
        window.electronAPI.profile.onChatSessionStoreMetadataPatched((data: {alias: string; chatId: string; chatSessionId: string; metadata: ChatSession; timestamp: number}) => {
          this.handleChatSessionStoreMetadataPatched(data)
        })
      }

      if (window.electronAPI.profile.onChatSessionStoreSessionDeleted) {
        window.electronAPI.profile.onChatSessionStoreSessionDeleted((data: {alias: string; chatId: string; chatSessionId: string; timestamp: number}) => {
          this.handleChatSessionStoreSessionDeleted(data)
        })
      }

    } else {
    }
  }

  // Handle V2 Profile cache updates from ProfileCacheManager
  private handleProfileCacheUpdate(data: {alias: string; profile: ProfileV2 | null; timestamp: number}): void {

    // Only update if this is for the current user
    if (this.userAlias && data.alias === this.userAlias) {
      if (data.timestamp < this.cache.lastUpdated) {
        logger.warn('[ProfileDataManager] Ignoring stale profile:cacheUpdated event', {
          eventTimestamp: data.timestamp,
          cacheLastUpdated: this.cache.lastUpdated,
          alias: data.alias,
        })
        return
      }

      // 🔧 FIX: Mark as initialized on first successful sync from ProfileCacheManager
      const wasNotInitialized = !this.cache.isInitialized

      this.cache.profile = data.profile
      this.cache.lastUpdated = data.timestamp

      if (data.profile === null) {
        // Clear all cached data
        this.cache.chats = []
        this.cache.skills = []
        this.cache.subAgents = []
      } else {
        // Update chat configurations
        this.cache.chats = data.profile.chats || []

        // Update skills configurations
        this.cache.skills = data.profile.skills || []

        // 🆕 Update sub-agents configurations
        // Profile push contains SubAgentIndex[] (lightweight: name, version, source only).
        // We need to fetch full SubAgentConfig[] via IPC to get display_name, emoji, description, etc.
        const subAgentIndex = data.profile.sub_agents || []
        if (subAgentIndex.length > 0) {
          // Set lightweight data first so the count is visible immediately
          this.cache.subAgents = subAgentIndex as SubAgentConfig[]
          // Then fetch full configs asynchronously
          this.fetchFullSubAgentConfigs()
        } else {
          this.cache.subAgents = []
        }

        // 🆕 Refactored: MCP server config sync to mcpClientCacheManager
        // profileDataManager is no longer responsible for MCP config
        if (data.profile.mcp_servers && Array.isArray(data.profile.mcp_servers)) {
          try {
            mcpClientCacheManager.updateServerConfigs(data.profile!.mcp_servers)
          } catch (err) {
            logger.error('[ProfileDataManager] Failed to sync MCP configs:', err)
          }
        }
      }

      // 🔧 FIX: Set isInitialized to true after first successful sync
      if (wasNotInitialized) {
        this.cache.isInitialized = true
      }

      this.notifyListeners(true) // Immediate notification for profile updates
    } else {
    }
  }

  // 🔥 New: Handle auto-select ChatSession IPC events
  // ⚠️ Deprecated: currentChatSessionId management has been migrated to agentChatSessionCacheManager
  private handleAutoSelectChatSession(data: {alias: string; chatId: string; chatSessionId: string; timestamp: number}): void {
    // Only handle events for the current user
    if (this.userAlias && data.alias === this.userAlias) {

      // Verify chatId and chatSessionId exist
      const chat = this.cache.chats.find(c => c.chat_id === data.chatId);
      if (!chat) {
        logger.warn('[ProfileDataManager] Auto-select failed: chat not found', {
          chatId: data.chatId,
          availableChats: this.cache.chats.map(c => c.chat_id)
        });
        return;
      }

      const chatSession = chat.chatSessions?.find(s => s.chatSession_id === data.chatSessionId);
      if (!chatSession) {
        logger.warn('[ProfileDataManager] Auto-select failed: chatSession not found', {
          chatId: data.chatId,
          chatSessionId: data.chatSessionId,
          availableSessions: chat.chatSessions?.map(s => s.chatSession_id) || []
        });
        return;
      }

      // ⚠️ Deprecated: currentChatSessionId management has been migrated to agentChatSessionCacheManager
      // This event is now handled by agentChatSessionCacheManager
    }
  }

  private buildStarredChatSessionIndexItem(
    chatId: string,
    session: Partial<ChatSession>,
    fallbackStarredAt?: string,
  ): StarredChatSessionIndexItem | null {
    const chat = this.cache.chats.find(candidate => candidate.chat_id === chatId)
    if (!chat || !session.chatSession_id || !session.title || !session.last_updated) {
      return null
    }

    return {
      chatId,
      chatSessionId: session.chatSession_id,
      title: session.title,
      lastUpdated: session.last_updated,
      readStatus: session.readStatus,
      source: session.source,
      agentName: chat.agent?.name || 'Unnamed Agent',
      agentEmoji: chat.agent?.emoji,
      agentAvatar: chat.agent?.avatar,
      agentSource: chat.agent?.source,
      agentVersion: chat.agent?.version,
      starredAt: session.starredAt || fallbackStarredAt || new Date().toISOString(),
    }
  }

  private syncStarredChatSessionInProfile(
    chatId: string,
    session: Partial<ChatSession>,
  ): void {
    if (!this.cache.profile || !session.chatSession_id) {
      return
    }

    const currentItems = this.cache.profile['starred-chat-sessions'] || []
    const existingItem = currentItems.find(item => item.chatSessionId === session.chatSession_id)
    const shouldRemove = isScheduledSession(session) || session.starred === false
    const shouldTrack = session.starred === true || !!existingItem

    if (!shouldRemove && !shouldTrack) {
      return
    }

    let nextItems = currentItems.filter(item => item.chatSessionId !== session.chatSession_id)
    if (!shouldRemove) {
      const nextItem = this.buildStarredChatSessionIndexItem(chatId, session, existingItem?.starredAt)
      if (!nextItem) {
        return
      }
      nextItems = [nextItem, ...nextItems].sort(
        (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
      )
    }

    this.cache.profile = {
      ...this.cache.profile,
      ['starred-chat-sessions']: nextItems,
    }
  }

  private removeStarredChatSessionFromProfile(chatSessionId: string): void {
    if (!this.cache.profile) {
      return
    }

    const currentItems = this.cache.profile['starred-chat-sessions'] || []
    const nextItems = currentItems.filter(item => item.chatSessionId !== chatSessionId)
    if (nextItems.length === currentItems.length) {
      return
    }

    this.cache.profile = {
      ...this.cache.profile,
      ['starred-chat-sessions']: nextItems,
    }
  }

  private handleChatSessionStoreSessionCreated(data: {alias: string; chatId: string; session: ChatSession; timestamp: number}): void {
    if (!(this.userAlias && data.alias === this.userAlias)) {
      return
    }

    const chatIndex = this.cache.chats.findIndex(c => c.chat_id === data.chatId)
    if (chatIndex < 0) {
      return
    }

    const existingSessions = this.cache.chats[chatIndex].chatSessions || []
    const updatedSessions = [...existingSessions.filter(session => session.chatSession_id !== data.session.chatSession_id), data.session]
      .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())

    this.cache.chats = [
      ...this.cache.chats.slice(0, chatIndex),
      {
        ...this.cache.chats[chatIndex],
        chatSessions: updatedSessions,
      },
      ...this.cache.chats.slice(chatIndex + 1)
    ]
    this.syncStarredChatSessionInProfile(data.chatId, data.session)
    this.cache.lastUpdated = Math.max(this.cache.lastUpdated, data.timestamp || Date.now())
    this.notifyListeners(true)
  }

  private handleChatSessionStoreMetadataPatched(data: {alias: string; chatId: string; chatSessionId: string; metadata: ChatSession; timestamp: number}): void {
    if (!(this.userAlias && data.alias === this.userAlias)) {
      return
    }

    const chatIndex = this.cache.chats.findIndex(c => c.chat_id === data.chatId)
    if (chatIndex < 0) {
      return
    }

    const existingSessions = this.cache.chats[chatIndex].chatSessions || []
    const sessionIndex = existingSessions.findIndex(session => session.chatSession_id === data.chatSessionId)
    const nextSessions = [...existingSessions]

    if (sessionIndex >= 0) {
      nextSessions[sessionIndex] = {
        ...nextSessions[sessionIndex],
        ...data.metadata,
      }
    } else {
      nextSessions.push(data.metadata)
    }

    this.cache.chats = [
      ...this.cache.chats.slice(0, chatIndex),
      {
        ...this.cache.chats[chatIndex],
        chatSessions: nextSessions.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()),
      },
      ...this.cache.chats.slice(chatIndex + 1)
    ]
    this.syncStarredChatSessionInProfile(data.chatId, data.metadata)
    this.cache.lastUpdated = Math.max(this.cache.lastUpdated, data.timestamp || Date.now())
    this.notifyListeners(true)
  }

  private handleChatSessionStoreSessionDeleted(data: {alias: string; chatId: string; chatSessionId: string; timestamp: number}): void {
    if (!(this.userAlias && data.alias === this.userAlias)) {
      return
    }

    const chatIndex = this.cache.chats.findIndex(c => c.chat_id === data.chatId)
    if (chatIndex < 0) {
      return
    }

    const existingSessions = this.cache.chats[chatIndex].chatSessions || []
    const updatedSessions = existingSessions.filter(session => session.chatSession_id !== data.chatSessionId)

    this.cache.chats = [
      ...this.cache.chats.slice(0, chatIndex),
      {
        ...this.cache.chats[chatIndex],
        chatSessions: updatedSessions,
      },
      ...this.cache.chats.slice(chatIndex + 1)
    ]
    this.removeStarredChatSessionFromProfile(data.chatSessionId)
    this.cache.lastUpdated = Math.max(this.cache.lastUpdated, data.timestamp || Date.now())
    this.notifyListeners(true)
  }

  // Refresh all data from ProfileCacheManager (without full reinitialization)
  // 🆕 Refactored: MCP state refresh has been migrated to mcpClientCacheManager
  async refresh(): Promise<void> {
    if (!this.userAlias) {
      throw new Error('User alias not set, cannot refresh data')
    }


    try {
      // 🔧 Fix: Refresh Profile data first (including ChatSessions)
      if (window.electronAPI?.profile?.getProfile) {
        const profileResponse = await window.electronAPI.profile.getProfile(this.userAlias)
        if (profileResponse.success) {
          // getProfile triggers profile:cacheUpdated event, so no need to manually update cache
        } else {
        }
      }

      // 🆕 Refactored: MCP state refresh is handled by mcpClientCacheManager
      await mcpClientCacheManager.refresh()

    } catch (error) {
    }
  }

  // Read-only accessors for cached data
  getProfile(): Profile | null {
    return this.cache.profile
  }

  /**
   * Get the current user alias
   * Usage: When frontend API calls require the user alias parameter
   */
  getCurrentUserAlias(): string | null {
    return this.userAlias
  }

  // ========== V2 Chat Config Management Methods ==========

  /**
   * Get all Chat configs
   */
  getChatConfigs(): ChatConfigRuntime[] {
    return [...this.cache.chats]
  }

  /**
   * Get the currently active Chat config
   * Purpose: In a multi-Chat environment, determine which Chat the user is currently using
   * Usage: Display current Chat's Agent config in UI, use corresponding model and MCP servers when sending messages
   *
   * ⚠️ Note: currentChatId management has been migrated to agentChatSessionCacheManager
   * This method obtains currentChatId from agentChatSessionCacheManager to find the Chat config
   */
  getCurrentChat(): ChatConfigRuntime | null {
    // Get the real currentChatId from agentChatSessionCacheManager
    const currentChatId = agentChatSessionCacheManager.getCurrentChatId();

    if (!currentChatId) {
      // If no current Chat is set, default to returning the first Chat
      return this.cache.chats.length > 0 ? this.cache.chats[0] : null
    }
    return this.cache.chats.find(chat => chat.chat_id === currentChatId) || null
  }

  // ========== V2 Agent Methods (based on current Chat) ==========

  /**
   * Get the current Chat's Agent config
   */
  getCurrentAgent(): ChatAgent | null {
    const currentChat = this.getCurrentChat()
    return currentChat?.agent || null
  }

  /**
   * Get the current Chat's Agent model
   * Important: This is the only way to get the model in V2, replacing the V1 selectedModel concept
   * V1: profile.ghcAuth.selectedModel (global)
   * V2: profile.chats[current].agent.model (per Chat)
   */
  getCurrentModel(): string | null {
    const agent = this.getCurrentAgent()
    return agent?.model || null
  }

  /**
   * Get the Agent model for a specified Chat
   * @param chatId - Chat ID
   * @returns The Agent model for the Chat, or null if not found
   */
  getSelectedModel(chatId: string): string | null {
    const chat = this.cache.chats.find(c => c.chat_id === chatId)
    return chat?.agent?.model || null
  }

  /**
   * Get the per-chat reasoning effort selected by the user.
   * Returns `undefined` when no effort has been chosen (the agent should not send
   * a `reasoning_effort` parameter in that case). Values are canonicalized to
   * lowercase on write, so new tiers (e.g. `minimal`) are surfaced without
   * code changes.
   */
  getReasoningEffort(chatId: string): string | undefined {
    const chat = this.cache.chats.find(c => c.chat_id === chatId)
    const value = chat?.agent?.reasoningEffort
    if (typeof value !== 'string' || value.length === 0) return undefined
    // Defensive lowercase on read so any value written by other paths (sync,
    // eval harness, CDN agents) still matches the canonical lowercase form
    // used by capability gating and the request layer.
    return value.toLowerCase()
  }

  /**
   * Get the MCP server configs assigned to the current Chat's Agent
   * V2: Each Agent only uses its assigned subset of MCP servers, including tool selection
   * Return format: [{ name: string, tools: string[] }, ...]
   */
  getAssignedMcpServers(): Array<{ name: string; tools: string[] }> {
    const agent = this.getCurrentAgent()
    return agent?.mcp_servers || []
  }

  /**
   * Get the Context Enhancement config for the current Chat's Agent
   * Returns memory-related config, including search_memory and generate_memory settings
   */
  getCurrentAgentContextEnhancement(): Record<string, unknown> | null {
    const agent = this.getCurrentAgent()
    return agent?.context_enhancement || null
  }

  /**
   * Check if the current Agent has memory search enabled
   * Note: Memory (mem0) has been removed; always returns false.
   */
  isMemorySearchEnabled(): boolean {
    const contextEnhancement = this.getCurrentAgentContextEnhancement() as any
    return contextEnhancement?.search_memory?.enabled || false
  }

  /**
   * Check if the current Agent has memory generation enabled
   * Note: Memory (mem0) has been removed; always returns false.
   */
  isMemoryGenerationEnabled(): boolean {
    const contextEnhancement = this.getCurrentAgentContextEnhancement() as any
    return contextEnhancement?.generate_memory?.enabled || false
  }

  /**
   * Get the current Agent's memory search config
   */
  getMemorySearchConfig(): {
    enabled: boolean;
    semantic_similarity_threshold: number;
    semantic_top_n: number
  } {
    const contextEnhancement = this.getCurrentAgentContextEnhancement() as any
    const searchMemory = contextEnhancement?.search_memory

    return {
      enabled: searchMemory?.enabled || false,
      semantic_similarity_threshold: searchMemory?.semantic_similarity_threshold || 0.0,
      semantic_top_n: searchMemory?.semantic_top_n || 5
    }
  }

  /**
   * Get the current Agent's memory generation config
   */
  getMemoryGenerationConfig(): { enabled: boolean } {
    const contextEnhancement = this.getCurrentAgentContextEnhancement() as any
    const generateMemory = contextEnhancement?.generate_memory

    return {
      enabled: generateMemory?.enabled || false
    }
  }

  // ❌ V2: Completely removed original GHC-related methods, ensuring no more global selectedModel concept:
  // ❌ getGHCModelData() - Removed
  // ❌ updateSelectedModel() - Removed, use ChatOps.updateChatAgent() instead
  // ❌ Any methods returning "selectedModel" - Removed

  // ❌ Refactored: All MCP-related methods have been completely removed
  // ❌ getMCPServers() - Removed, use mcpClientCacheManager.getMCPServers()
  // ❌ getMCPServerByName() - Removed, use mcpClientCacheManager.getMCPServerByName()
  // ❌ getMCPRuntimeStates() - Removed, use mcpClientCacheManager.getMCPRuntimeStates()
  // ❌ getMCPRuntimeState() - Removed, use mcpClientCacheManager.getMCPRuntimeState()
  // ❌ getAllMCPTools() - Removed, use mcpClientCacheManager.getAllMCPTools()
  // ❌ getAgentSpecificTools() - Removed, use mcpClientCacheManager.getAgentSpecificTools()
  // ❌ getCurrentAgentTools() - Removed, use mcpClientCacheManager.getAgentSpecificTools()
  // ❌ getAvailableTools() - Removed, use mcpClientCacheManager
  // ❌ getMCPStats() - Removed, use mcpClientCacheManager.getMCPStats()

  // ========== Skills Data Access Methods ==========

  /**
   * Get all Skills configs
   */
  getSkills(): SkillConfig[] {
    return [...this.cache.skills]
  }

  /**
   * Get Skill config by name
   * @param skillName - Skill name
   */
  getSkillByName(skillName: string): SkillConfig | null {
    return this.cache.skills.find(s => s.name === skillName) || null
  }

  /**
   * Get Skills statistics
   */
  getSkillsStats(): { totalSkills: number } {
    return {
      totalSkills: this.cache.skills.length
    }
  }

  // ========== Sub-Agents Data Access Methods ==========

  /**
   * Fetch full SubAgentConfig[] via IPC (async).
   * Called after profile push delivers lightweight SubAgentIndex[].
   * Updates cache and notifies listeners so UI gets display_name, emoji, description, etc.
   */
  private fetchFullSubAgentConfigs(): void {
    if (!window.electronAPI?.subAgent?.getAll) return
    window.electronAPI.subAgent.getAll()
      .then((result: { success: boolean; data?: SubAgentConfig[]; error?: string }) => {
        if (result.success && Array.isArray(result.data)) {
          this.cache.subAgents = result.data
          this.notifyListeners(false) // Debounced notification to refresh UI
        }
      })
      .catch((err: unknown) => {
        logger.warn('[ProfileDataManager] Failed to fetch full sub-agent configs:', err)
      })
  }

  /**
   * Get all Sub-Agent configs
   */
  getSubAgents(): SubAgentConfig[] {
    return [...(this.cache.subAgents || [])]
  }

  /**
   * Get Sub-Agent config by name
   * @param name - Sub-Agent name
   */
  getSubAgentByName(name: string): SubAgentConfig | undefined {
    return (this.cache.subAgents || []).find(sa => sa.name === name)
  }

  /**
   * Get Sub-Agents statistics
   */
  getSubAgentsStats(): { total: number; onDevice: number } {
    const subAgents = this.cache.subAgents || []
    return {
      total: subAgents.length,
      onDevice: subAgents.filter(sa => sa.source === 'ON-DEVICE').length,
    }
  }

  // ========== FRE (First Run Experience) Data Access Methods ==========

  /**
   * Get freDone status
   * @returns freDone status, returns false if not present
   */
  getFreDone(): boolean {
    const profile = this.cache.profile
    if (!profile) {
      return false
    }
    return profile.freDone === true
  }

  /**
   * Check if FRE (First Run Experience) needs to be shown
   * @returns If data is initialized and freDone is false, FRE needs to be shown
   *
   * 🔧 Key fix: Returns false when data is not initialized or profile is null,
   * preventing FRE from incorrectly showing when user logs out then logs back in due to cache being cleared
   */
  needsFRE(): boolean {
    // If data is not initialized or profile is null, don't show FRE
    if (!this.cache.isInitialized || !this.cache.profile) {
      return false
    }
    return !this.getFreDone()
  }

  /**
   * Get Skills used by the current Agent
   */
  getCurrentAgentSkills(): SkillConfig[] {
    const agent = this.getCurrentAgent()
    if (!agent || !agent.skills) {
      return []
    }

    return agent.skills
      .map(skillName => this.getSkillByName(skillName))
      .filter((skill): skill is SkillConfig => skill !== null)
  }

  isDataStale(maxAgeMs: number = 300000): boolean {
    return (Date.now() - this.cache.lastUpdated) > maxAgeMs
  }

  // Cleanup method for sign-out
  cleanup(): void {
    logger.debug('[ProfileDataManager] 🧹 Cleaning up for sign-out');

    // Clean up notification timeout
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout)
      this.notificationTimeout = null
    }
    this.pendingNotification = false
    this.chatSessionReadStatusUpdatedAt.clear()

    // 🔄 Removed: AgentChatManager has been migrated to main process, no cleanup needed here

    this.cache = {
      profile: null,
      chats: [],
      skills: [],
      subAgents: [],
      lastUpdated: 0,
      isInitialized: false
    }

    // 🔧 Key fix: Don't clear listeners, instead notify them that data has been cleared
    // This allows React components to properly respond to state changes
    this.notifyListeners(true)

    this.userAlias = null

    // Clean up historical prompt data
    this.promptHistory = []
    this.promptCursor = -1
    this.currentEditingPrompt = ''

    logger.debug('[ProfileDataManager] ✅ Cleanup completed, listeners notified');
  }

  // ========== ChatSessions Data Access Methods ==========

  /**
   * Get all ChatSessions for a specified Chat
   * Provides data access only, not responsible for data management
   */
  getChatSessions(chatId: string): ChatSession[] {
    const chat = this.cache.chats.find(c => c.chat_id === chatId)
    return chat?.chatSessions ? [...chat.chatSessions] : []
  }

  /**
   * Get all ChatSessions for the current Chat
   */
  getCurrentChatSessions(): ChatSession[] {
    const currentChat = this.getCurrentChat()
    return currentChat?.chatSessions ? [...currentChat.chatSessions] : []
  }

  /**
   * Get a specific ChatSession within a specified Chat
   */
  getChatSession(chatId: string, chatSessionId: string): ChatSession | null {
    const chatSessions = this.getChatSessions(chatId)
    return chatSessions.find(chatSession => chatSession.chatSession_id === chatSessionId) || null
  }

  /**
   * Get a specific ChatSession within the current Chat
   */
  getCurrentChatSession(chatSessionId: string): ChatSession | null {
    const currentChat = this.getCurrentChat()
    if (!currentChat) return null
    return this.getChatSession(currentChat.chat_id, chatSessionId)
  }

  /**
   * Get ChatSessions statistics for a specified Chat
   */
  getChatSessionsStats(chatId: string): {
    totalChatSessions: number;
    lastUpdated: string | null;
    oldestChatSession: string | null;
    newestChatSession: string | null;
  } {
    const chatSessions = this.getChatSessions(chatId)

    if (chatSessions.length === 0) {
      return {
        totalChatSessions: 0,
        lastUpdated: null,
        oldestChatSession: null,
        newestChatSession: null
      }
    }

    // Sort by last updated time
    const sortedChatSessions = chatSessions
      .slice()
      .sort((a, b) => new Date(a.last_updated).getTime() - new Date(b.last_updated).getTime())

    return {
      totalChatSessions: chatSessions.length,
      lastUpdated: sortedChatSessions[sortedChatSessions.length - 1]?.last_updated || null,
      oldestChatSession: sortedChatSessions[0]?.chatSession_id || null,
      newestChatSession: sortedChatSessions[sortedChatSessions.length - 1]?.chatSession_id || null
    }
  }

  /**
   * Get ChatSessions statistics for the current Chat
   */
  getCurrentChatSessionsStats(): {
    totalChatSessions: number;
    lastUpdated: string | null;
    oldestChatSession: string | null;
    newestChatSession: string | null;
  } {
    const currentChat = this.getCurrentChat()
    if (!currentChat) {
      return {
        totalChatSessions: 0,
        lastUpdated: null,
        oldestChatSession: null,
        newestChatSession: null
      }
    }
    return this.getChatSessionsStats(currentChat.chat_id)
  }

  // ========== CurrentChatSessionId Cache Management Methods ==========
  // ⚠️ Deprecated: currentChatSessionId management has been migrated to agentChatSessionCacheManager
  // Please use agentChatSessionCacheManager.getCurrentChatSessionId() instead

  // ========== Historical prompt queue management methods ==========

  /**
   * Add prompt to history queue
   * Called when sending a message
   */
  addPromptToHistory(prompt: string): void {
    if (!prompt.trim()) return


    // Avoid adding duplicate prompts
    const lastPrompt = this.promptHistory[this.promptHistory.length - 1]
    if (lastPrompt === prompt.trim()) {
      return
    }

    // Add to queue tail
    this.promptHistory.push(prompt.trim())

    // Maintain queue size limit
    if (this.promptHistory.length > this.HISTORY_PROMPT_QUEUE_SIZE) {
      const removedPrompt = this.promptHistory.shift() // Remove oldest prompt
    }

    // Reset cursor to queue tail (E position)
    this.promptCursor = -1
    this.currentEditingPrompt = ''

  }

  /**
   * Get previous prompt
   * Called when up arrow key is pressed
   */
  getPreviousPrompt(): string | null {

    if (this.promptHistory.length === 0) {
      return null
    }

    // Move cursor towards queue head
    if (this.promptCursor === -1) {
      // Start from tail position, move to last prompt
      this.promptCursor = this.promptHistory.length - 1
    } else if (this.promptCursor > 0) {
      // Continue moving forward
      this.promptCursor--
    } else {
    }
    // If cursor is already 0, keep unchanged (already reached queue head)

    const prompt = this.promptHistory[this.promptCursor]

    return prompt
  }

  /**
   * Get next prompt
   * Called when down arrow key is pressed
   */
  getNextPrompt(): string | null {

    if (this.promptHistory.length === 0) {
      return this.currentEditingPrompt || null
    }

    if (this.promptCursor === -1) {
      // Already at queue tail, return current editing prompt
      return this.currentEditingPrompt || null
    }

    // Move cursor towards queue tail
    if (this.promptCursor < this.promptHistory.length - 1) {
      this.promptCursor++
      const prompt = this.promptHistory[this.promptCursor]
      return prompt
    } else {
      // Reached queue tail, reset to E position and return current editing prompt
      this.promptCursor = -1
      return this.currentEditingPrompt || null
    }
  }

  /**
   * Set current editing prompt
   * Called when user modifies input box content
   */
  setCurrentEditingPrompt(prompt: string): void {

    this.currentEditingPrompt = prompt
    // Reset cursor to queue tail (E position)
    this.promptCursor = -1

  }

  /**
   * Get current editing prompt
   */
  getCurrentEditingPrompt(): string {
    return this.currentEditingPrompt
  }

  /**
   * Get prompt history statistics
   */
  getPromptHistoryStats(): { total: number; current: number; maxSize: number } {
    const stats = {
      total: this.promptHistory.length,
      current: this.promptCursor,
      maxSize: this.HISTORY_PROMPT_QUEUE_SIZE
    }


    return stats
  }

  /**
   * Check if in browsing history state
   */
  isBrowsingHistory(): boolean {
    return this.promptCursor !== -1
  }
}

// Export singleton instance
export const profileDataManager = ProfileDataManager.getInstance()
