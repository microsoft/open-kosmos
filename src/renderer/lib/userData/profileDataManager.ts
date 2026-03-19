import {
  ProfileCacheData,
  ProfileCacheDataV2,
  ProfileDataListener,
  ProfileSyncResponse,
  GhcModel,
  type Profile,
  type ProfileV2,
  type McpServerConfig,
  type ChatConfig,
  type ChatConfigRuntime,
  type ChatAgent,
  type ChatSession,
  type ContextEnhancement,
  type SkillConfig
} from './types'

/**
 * ProfileDataManager - Refactored for data synchronization only
 * 
 * 🆕 Refactoring notes:
 * - MCP server runtime state management has been migrated to mcpClientCacheManager
 * - profileDataManager no longer caches or manages MCP runtime state
 * - All MCP-related read-only access methods have been marked as deprecated and will delegate directly to mcpClientCacheManager
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
  private refreshPromise: Promise<void> | null = null
  private userAlias: string | null = null
  
  // Historical prompt queue management
  private promptHistory: string[] = []
  private promptCursor: number = -1 // -1 indicates pointing to queue tail (E position)
  private currentEditingPrompt: string = ''
  private readonly HISTORY_PROMPT_QUEUE_SIZE: number = parseInt(process.env.HISTORY_PROMPT_QUEUE_SIZE || '20')

  private constructor() {
    // 🆕 Refactored: removed mcp_servers and mcp_runtime_states
    // MCP data is now independently managed by mcpClientCacheManager
    this.cache = {
      profile: null,
      mcp_servers: [], // 🚨 Deprecated: kept for type compatibility
      mcp_runtime_states: [], // 🚨 Deprecated: kept for type compatibility
      chats: [],
      skills: [],
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
      mcp_servers: [], // 🚨 Deprecated
      mcp_runtime_states: [], // 🚨 Deprecated
      chats: [],
      skills: [],
      lastUpdated: Date.now(),
      isInitialized: false  // 🔧 Keep false until first successful sync
    }
    

    // 🔧 NEW FIX: Actively request profile data sync from main process
    // This solves the issue where mainWindow refresh causes frontend to wait forever
    try {
      if (window.electronAPI && window.electronAPI.profile) {
        const result = await window.electronAPI.profile.getProfile(userAlias);
        if (result.success) {
        } else {
        }
      }
    } catch (error) {
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
      
      // 🔥 New: Listen for ChatSession list update IPC events (for refreshing list after Fork and similar operations)
      if (window.electronAPI.profile.onChatSessionUpdated) {
        window.electronAPI.profile.onChatSessionUpdated((data: {alias: string; chatId: string; sessions: any[]; loadedMonths: string[]; hasMore: boolean; nextMonthIndex: number; timestamp: number}) => {
          this.handleChatSessionUpdated(data)
        })
      }
      
    } else {
    }
  }

  // Handle V2 Profile cache updates from ProfileCacheManager
  private handleProfileCacheUpdate(data: {alias: string; profile: ProfileV2 | null; timestamp: number}): void {

    // Only update if this is for the current user
    if (this.userAlias && data.alias === this.userAlias) {
      
      // 🔧 FIX: Mark as initialized on first successful sync from ProfileCacheManager
      const wasNotInitialized = !this.cache.isInitialized
      
      this.cache.profile = data.profile
      this.cache.lastUpdated = data.timestamp
      
      if (data.profile === null) {
        // Clear all cached data
        this.cache.chats = []
        this.cache.skills = []
        // 🆕 Refactored: no longer managing mcp_servers and mcp_runtime_states
      } else {
        // Update chat configurations
        this.cache.chats = data.profile.chats || []
        
        // Update skills configurations
        this.cache.skills = data.profile.skills || []
        
        // 🆕 Refactored: sync MCP server configs to mcpClientCacheManager
        // profileDataManager is no longer responsible for MCP configuration
        if (data.profile.mcp_servers && Array.isArray(data.profile.mcp_servers)) {
          // Lazy-load mcpClientCacheManager and sync configs
          import('../mcp/mcpClientCacheManager').then(({ mcpClientCacheManager }) => {
            mcpClientCacheManager.updateServerConfigs(data.profile!.mcp_servers)
          }).catch(err => {
            console.error('[ProfileDataManager] Failed to sync MCP configs:', err)
          })
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
      
      // Validate that chatId and chatSessionId exist
      const chat = this.cache.chats.find(c => c.chat_id === data.chatId);
      if (!chat) {
        console.warn('[ProfileDataManager] Auto-select failed: chat not found', {
          chatId: data.chatId,
          availableChats: this.cache.chats.map(c => c.chat_id)
        });
        return;
      }
      
      const chatSession = chat.chatSessions?.find(s => s.chatSession_id === data.chatSessionId);
      if (!chatSession) {
        console.warn('[ProfileDataManager] Auto-select failed: chatSession not found', {
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

  // 🔥 New: Handle ChatSession list update IPC events (for refreshing list after Fork and similar operations)
  private handleChatSessionUpdated(data: {alias: string; chatId: string; sessions: ChatSession[]; loadedMonths: string[]; hasMore: boolean; nextMonthIndex: number; timestamp: number}): void {
    // Only handle events for the current user
    if (this.userAlias && data.alias === this.userAlias) {
      console.log('[ProfileDataManager] Received chatSession:updated event', {
        chatId: data.chatId,
        sessionsCount: data.sessions?.length || 0,
        hasMore: data.hasMore
      });
      
      // Find the corresponding chat config
      const chatIndex = this.cache.chats.findIndex(c => c.chat_id === data.chatId);
      if (chatIndex < 0) {
        console.warn('[ProfileDataManager] ChatSession update failed: chat not found', {
          chatId: data.chatId,
          availableChats: this.cache.chats.map(c => c.chat_id)
        });
        return;
      }
      
      // 🔥 Key fix: Create a new chats array reference to ensure React can detect changes
      // Issue: Original code only updated array elements, but the array reference didn't change, causing useMemo not to recalculate
      const updatedChat = {
        ...this.cache.chats[chatIndex],
        chatSessions: data.sessions || []
      };
      
      // Create a new chats array, replacing the updated chat
      this.cache.chats = [
        ...this.cache.chats.slice(0, chatIndex),
        updatedChat,
        ...this.cache.chats.slice(chatIndex + 1)
      ];
      
      // Update cache timestamp
      this.cache.lastUpdated = data.timestamp || Date.now();
      
      console.log('[ProfileDataManager] ChatSessions updated successfully', {
        chatId: data.chatId,
        newSessionsCount: this.cache.chats[chatIndex].chatSessions?.length || 0
      });
      
      // Notify listeners that data has been updated
      this.notifyListeners(true); // Use immediate mode to notify instantly
    }
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
          // getProfile will trigger the profile:cacheUpdated event, so no need to manually update cache
        } else {
        }
      }
      
      // 🆕 Refactored: MCP state refresh is handled by mcpClientCacheManager
      const { mcpClientCacheManager } = await import('../mcp/mcpClientCacheManager')
      await mcpClientCacheManager.refresh()
      
    } catch (error) {
    }
  }

  // Read-only accessors for cached data
  getProfile(): Profile | null {
    return this.cache.profile
  }

  /**
   * Get current user alias
   * Usage: Used when frontend API calls require the user alias parameter
   */
  getCurrentUserAlias(): string | null {
    return this.userAlias
  }

  // ========== V2 Chat Configuration Management Methods ==========
  
  /**
   * Get all Chat configurations
   */
  getChatConfigs(): ChatConfigRuntime[] {
    return [...this.cache.chats]
  }

  /**
   * Get the currently active Chat configuration
   * Function: In a multi-Chat environment, determine which Chat the user is currently using
   * Usage: Display current Chat's Agent config in UI, use corresponding model and MCP servers when sending messages
   *
   * ⚠️ Note: currentChatId management has been migrated to agentChatSessionCacheManager
   * This method retrieves currentChatId from agentChatSessionCacheManager to find the Chat config
   */
  getCurrentChat(): ChatConfigRuntime | null {
    // Get the real currentChatId from agentChatSessionCacheManager
    const { agentChatSessionCacheManager } = require('../chat/agentChatSessionCacheManager');
    const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
    
    if (!currentChatId) {
      // If no current Chat is set, return the first Chat by default
      return this.cache.chats.length > 0 ? this.cache.chats[0] : null
    }
    return this.cache.chats.find(chat => chat.chat_id === currentChatId) || null
  }
  
  // ========== V2 Agent Related Methods (based on current Chat) ==========
  
  /**
   * Get the Agent configuration for the current Chat
   */
  getCurrentAgent(): ChatAgent | null {
    const currentChat = this.getCurrentChat()
    return currentChat?.agent || null
  }

  /**
   * Get the Agent model for the current Chat
   * Important: This is the only way to get the model in V2, replacing the V1 selectedModel concept
   * V1: profile.ghcAuth.selectedModel (global)
   * V2: profile.chats[current].agent.model (per Chat)
   */
  getCurrentModel(): string | null {
    const agent = this.getCurrentAgent()
    return agent?.model || null
  }

  /**
   * Get the Agent model for a specific Chat
   * @param chatId - Chat ID
   * @returns The Agent model for the Chat, or null if it doesn't exist
   */
  getSelectedModel(chatId: string): string | null {
    const chat = this.cache.chats.find(c => c.chat_id === chatId)
    return chat?.agent?.model || null
  }

  /**
   * Get the MCP server configurations assigned to the current Chat's Agent
   * V2: Each Agent only uses its assigned subset of MCP servers, including tool selection
   * Return format: [{ name: string, tools: string[] }, ...]
   */
  getAssignedMcpServers(): Array<{ name: string; tools: string[] }> {
    const agent = this.getCurrentAgent()
    return agent?.mcp_servers || []
  }

  /**
   * Get the Context Enhancement configuration for the current Chat's Agent
   * Returns memory-related configuration, including search_memory and generate_memory settings
   */
  getCurrentAgentContextEnhancement(): ContextEnhancement | null {
    const agent = this.getCurrentAgent()
    return agent?.context_enhancement || null
  }

  /**
   * Check if the current Agent has memory search enabled
   */
  isMemorySearchEnabled(): boolean {
    const contextEnhancement = this.getCurrentAgentContextEnhancement()
    return contextEnhancement?.search_memory?.enabled || false
  }

  /**
   * Check if the current Agent has memory generation enabled
   */
  isMemoryGenerationEnabled(): boolean {
    const contextEnhancement = this.getCurrentAgentContextEnhancement()
    return contextEnhancement?.generate_memory?.enabled || false
  }

  /**
   * Get the memory search configuration for the current Agent
   */
  getMemorySearchConfig(): {
    enabled: boolean;
    semantic_similarity_threshold: number;
    semantic_top_n: number
  } {
    const contextEnhancement = this.getCurrentAgentContextEnhancement()
    const searchMemory = contextEnhancement?.search_memory
    
    return {
      enabled: searchMemory?.enabled || false,
      semantic_similarity_threshold: searchMemory?.semantic_similarity_threshold || 0.0,
      semantic_top_n: searchMemory?.semantic_top_n || 5
    }
  }

  /**
   * Get the memory generation configuration for the current Agent
   */
  getMemoryGenerationConfig(): { enabled: boolean } {
    const contextEnhancement = this.getCurrentAgentContextEnhancement()
    const generateMemory = contextEnhancement?.generate_memory
    
    return {
      enabled: generateMemory?.enabled || false
    }
  }

  // ❌ V2: Completely removed original GHC-related methods, ensuring no global selectedModel concept remains:
  // ❌ getGHCModelData() - Deleted
  // ❌ updateSelectedModel() - Deleted, replaced by ChatOps.updateChatAgent()
  // ❌ Any method returning "selectedModel" - Deleted

  // ❌ Refactored: All MCP-related methods have been completely removed
  // ❌ getMCPServers() - Deleted, use mcpClientCacheManager.getMCPServers()
  // ❌ getMCPServerByName() - Deleted, use mcpClientCacheManager.getMCPServerByName()
  // ❌ getMCPRuntimeStates() - Deleted, use mcpClientCacheManager.getMCPRuntimeStates()
  // ❌ getMCPRuntimeState() - Deleted, use mcpClientCacheManager.getMCPRuntimeState()
  // ❌ getAllMCPTools() - Deleted, use mcpClientCacheManager.getAllMCPTools()
  // ❌ getAgentSpecificTools() - Deleted, use mcpClientCacheManager.getAgentSpecificTools()
  // ❌ getCurrentAgentTools() - Deleted, use mcpClientCacheManager.getAgentSpecificTools()
  // ❌ getAvailableTools() - Deleted, use mcpClientCacheManager
  // ❌ getMCPStats() - Deleted, use mcpClientCacheManager.getMCPStats()

  // ========== Skills Data Access Methods ==========

  /**
   * Get all Skills configurations
   */
  getSkills(): SkillConfig[] {
    return [...this.cache.skills]
  }

  /**
   * Get Skill configuration by name
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
   * preventing FRE from being incorrectly shown when user logs out and logs back in due to cache being cleared
   */
  needsFRE(): boolean {
    // If data is not initialized or profile is null, don't show FRE
    if (!this.cache.isInitialized || !this.cache.profile) {
      return false
    }
    return !this.getFreDone()
  }

  /**
   * Get the Skills used by the current Agent
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
    console.log('[ProfileDataManager] 🧹 Cleaning up for sign-out');
    
    // Clean up notification timeout
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout)
      this.notificationTimeout = null
    }
    this.pendingNotification = false
    
    // 🔄 Removed: AgentChatManager has been migrated to the main process, no cleanup needed here
    
    this.cache = {
      profile: null,
      mcp_servers: [], // 🚨 Deprecated
      mcp_runtime_states: [], // 🚨 Deprecated
      chats: [],
      skills: [],
      lastUpdated: 0,
      isInitialized: false
    }
    
    // 🔧 Key fix: Don't clear listeners, instead notify them that data has been cleared
    // This allows React components to correctly respond to state changes
    this.notifyListeners(true)
    
    this.refreshPromise = null
    this.userAlias = null
    
    // Clean up historical prompt data
    this.promptHistory = []
    this.promptCursor = -1
    this.currentEditingPrompt = ''
    
    console.log('[ProfileDataManager] ✅ Cleanup completed, listeners notified');
  }

  // ========== ChatSessions Data Access Methods ==========
  
  /**
   * Get all ChatSessions for a specific Chat
   * Only provides data access, not responsible for data management
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
   * Get a specific ChatSession within a given Chat
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
   * Get ChatSessions statistics for a specific Chat
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
