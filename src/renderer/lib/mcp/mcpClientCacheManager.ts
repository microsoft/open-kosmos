/**
 * MCP Client Cache Manager (Frontend)
 *
 * Refactored: unified management of frontend MCP server status cache
 *
 * Responsibilities:
 * 1. Manage MCP server runtime status cache (status, tools, error)
 * 2. Listen for status change IPC events from the backend mcpClientManager
 * 3. Notify subscribers of status changes
 * 4. Provide read-only access to MCP server status
 *
 * No longer responsible for:
 * - MCP server configuration management (handled by profileDataManager)
 * - Relaying status through profileDataManager
 */

import type { McpServerConfig } from '../../../main/lib/userDataADO/types/profile'
import { createLogger } from '../utilities/logger';
const logger = createLogger('[McpClientCacheManager]');

/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction'

/**
 * MCP Tool interface
 */
export interface MCPTool {
  name: string
  description?: string
  inputSchema: any
  serverId: string
}

/**
 * Runtime state for MCP servers - matches backend exactly
 */
export interface MCPServerRuntimeState {
  serverName: string
  status: MCPServerStatus
  tools: { name: string; description?: string; inputSchema: any }[]
  lastError: string | null
}

/**
 * Extended MCP server data that includes config and runtime state
 */
export interface MCPServerExtended {
  // Base config fields from McpServerConfig
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  in_use: boolean
  /** MCP server version (from library or user-defined) */
  version?: string
  /** MCP server source: ON-DEVICE (from local machine), or PLUGIN (from plugin) */
  source?: 'ON-DEVICE' | 'PLUGIN'
  /** If true, server is managed by the system and hidden from user-facing UI */
  hidden?: boolean

  // Runtime state fields
  status: MCPServerStatus
  error?: string
  tools?: MCPTool[]
  lastUpdated?: number
}

/**
 * MCP Cache data structure
 */
export interface MCPCacheData {
  servers: MCPServerExtended[]
  runtimeStates: MCPServerRuntimeState[]
  lastUpdated: number
  isInitialized: boolean
}

/**
 * MCP Stats interface
 */
export interface MCPStats {
  totalServers: number
  connectedServers: number
  disconnectedServers: number
  errorServers: number
  totalTools: number
}

/**
 * Data change listener type
 */
export type MCPDataListener = (data: MCPCacheData) => void

/**
 * Connection failure listener type
 * Called when MCP server connection changes from 'connecting' to 'error'
 */
export type MCPConnectionFailureListener = (serverName: string, error: string) => void

/**
 * MCPClientCacheManager - Frontend MCP status cache manager (Singleton)
 */
export class MCPClientCacheManager {
  private static instance: MCPClientCacheManager
  private cache: MCPCacheData
  private listeners: MCPDataListener[] = []
  private cleanupFunctions: (() => void)[] = []

  // Connection failure notification subscribers
  private connectionFailureListeners: MCPConnectionFailureListener[] = []
  // Record the previous server status to detect state changes
  private previousServerStatuses: Map<string, MCPServerStatus> = new Map()

  // Batch notification mechanism
  private notificationTimeout: NodeJS.Timeout | null = null
  private pendingNotification = false

  private constructor() {
    this.cache = {
      servers: [],
      runtimeStates: [],
      lastUpdated: 0,
      isInitialized: false
    }

    // Set up IPC listeners immediately
    this.setupIPCListeners()
  }

  static getInstance(): MCPClientCacheManager {
    if (!MCPClientCacheManager.instance) {
      MCPClientCacheManager.instance = new MCPClientCacheManager()
    }
    return MCPClientCacheManager.instance
  }

  /**
   * Get cached data (read-only)
   */
  getCache(): MCPCacheData {
    return { ...this.cache }
  }

  /**
   * Subscribe to data changes
   */
  subscribe(listener: MCPDataListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * Subscribe to connection failure events
   * Triggered when an MCP server transitions from 'connecting' to 'error'
   */
  subscribeConnectionFailure(listener: MCPConnectionFailureListener): () => void {
    this.connectionFailureListeners.push(listener)
    return () => {
      const index = this.connectionFailureListeners.indexOf(listener)
      if (index > -1) {
        this.connectionFailureListeners.splice(index, 1)
      }
    }
  }

  /**
   * Initialize cache manager
   * Fetch initial state from the backend
   */
  async initialize(): Promise<void> {
    logger.debug('[MCPClientCacheManager] Initializing...')

    try {
      // Fetch current MCP server status from the backend
      if (window.electronAPI?.mcp?.getServerStatus) {
        const result = await window.electronAPI.mcp.getServerStatus()
        if (result.success && result.data) {
          this.handleServerStatesUpdate(result.data)
        }
      }

      this.cache.isInitialized = true
      logger.debug('[MCPClientCacheManager] Initialized successfully')
    } catch (error) {
      logger.error('[MCPClientCacheManager] Initialization failed:', error)
    }
  }

  /**
   * Set up IPC listeners
   * Listen for status update events sent by the backend mcpClientManager
   */
  private setupIPCListeners(): void {
    logger.debug('[MCPClientCacheManager] Setting up IPC listeners...')

    if (window.electronAPI?.mcp?.onServerStatesUpdated) {
      const cleanup = window.electronAPI.mcp.onServerStatesUpdated((serverStates: any[]) => {
        logger.debug('[MCPClientCacheManager] Received server states update:', serverStates?.length || 0, 'servers')
        this.handleServerStatesUpdate(serverStates)
      })
      this.cleanupFunctions.push(cleanup)
      logger.debug('[MCPClientCacheManager] IPC listener registered')
    } else {
      logger.warn('[MCPClientCacheManager] electronAPI.mcp.onServerStatesUpdated not available')
    }
  }

  /**
   * Handle server status updates sent from the backend
   */
  private handleServerStatesUpdate(serverStates: any[]): void {
    if (!serverStates || !Array.isArray(serverStates)) {
      logger.warn('[MCPClientCacheManager] Invalid server states received')
      return
    }

    let hasChanges = false
    const newRuntimeStates: MCPServerRuntimeState[] = []
    const runtimeStatesMap = new Map<string, MCPServerRuntimeState>()

    // Detect connection failures (connecting -> error)
    const connectionFailures: Array<{ serverName: string; error: string }> = []

    // Convert server states to runtime states
    serverStates.forEach((state: any) => {
      const newStatus = this.mapStatus(state.status)
      const previousStatus = this.previousServerStatuses.get(state.serverName)

      // Detect connection failure: connecting -> error
      if (previousStatus === 'connecting' && newStatus === 'error') {
        connectionFailures.push({
          serverName: state.serverName,
          error: state.lastError ? String(state.lastError) : 'Connection failed'
        })
      }

      // Update previous status record
      this.previousServerStatuses.set(state.serverName, newStatus)

      const runtimeState: MCPServerRuntimeState = {
        serverName: state.serverName,
        status: this.mapStatus(state.status),
        tools: state.tools || [],
        lastError: state.lastError ? String(state.lastError) : null
      }
      newRuntimeStates.push(runtimeState)
      runtimeStatesMap.set(state.serverName, runtimeState)
    })

    // Update server list
    const updatedServers: MCPServerExtended[] = []

    // Update runtime state for existing servers
    this.cache.servers.forEach(server => {
      const runtimeState = runtimeStatesMap.get(server.name)
      const updatedServer = { ...server }

      if (runtimeState) {
        const newStatus = runtimeState.status
        const newError = runtimeState.lastError || undefined

        if (server.status !== newStatus || server.error !== newError) {
          updatedServer.status = newStatus
          updatedServer.error = newError
          updatedServer.lastUpdated = Date.now()
          hasChanges = true
        }

        // Update tool list
        const newTools: MCPTool[] = runtimeState.tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema,
          serverId: server.name
        }))

        if (JSON.stringify(server.tools) !== JSON.stringify(newTools)) {
          updatedServer.tools = newTools
          updatedServer.lastUpdated = Date.now()
          hasChanges = true
        }

        updatedServers.push(updatedServer)
      } else {
        // Special handling for built-in servers
        const BUILTIN_SERVER_NAME = 'builtin-tools'
        if (server.name === BUILTIN_SERVER_NAME) {
          updatedServers.push(server)
        } else {
          // Non-built-in server: mark as disconnected
          if (server.status !== 'disconnected') {
            updatedServer.status = 'disconnected'
            updatedServer.error = undefined
            updatedServer.tools = []
            updatedServer.lastUpdated = Date.now()
            hasChanges = true
          }
          updatedServers.push(updatedServer)
        }
      }
    })

    // Handle built-in servers (may not be in config but still need to be displayed)
    const BUILTIN_SERVER_NAME = 'builtin-tools'
    const existingServerNames = new Set(this.cache.servers.map(s => s.name))

    serverStates.forEach((state: any) => {
      if (state.serverName === BUILTIN_SERVER_NAME && !existingServerNames.has(BUILTIN_SERVER_NAME)) {
        const runtimeState = runtimeStatesMap.get(state.serverName)
        if (runtimeState) {
          const builtinServer: MCPServerExtended = {
            name: state.serverName,
            transport: 'stdio' as const,
            command: '',
            args: [],
            env: {},
            url: '',
            in_use: true,
            status: runtimeState.status,
            tools: runtimeState.tools?.map(tool => ({
              name: tool.name,
              description: tool.description || '',
              inputSchema: tool.inputSchema,
              serverId: state.serverName
            })) || [],
            error: runtimeState.lastError ? String(runtimeState.lastError) : undefined,
            lastUpdated: Date.now()
          }
          updatedServers.push(builtinServer)
          hasChanges = true
        }
      }
    })

    // Update cache
    this.cache.servers = updatedServers
    this.cache.runtimeStates = newRuntimeStates

    if (hasChanges) {
      this.cache.lastUpdated = Date.now()
      this.notifyListeners()
    }

    // Notify connection failure subscribers
    if (connectionFailures.length > 0) {
      connectionFailures.forEach(failure => {
        logger.debug('[MCPClientCacheManager] Connection failure detected:', failure.serverName, failure.error)
        this.notifyConnectionFailure(failure.serverName, failure.error)
      })
    }
  }

  /**
   * Notify connection failure subscribers
   */
  private notifyConnectionFailure(serverName: string, error: string): void {
    this.connectionFailureListeners.forEach(listener => {
      try {
        listener(serverName, error)
      } catch (err) {
        logger.error('[MCPClientCacheManager] Connection failure listener error:', err)
      }
    })
  }

  /**
   * Update server config list (sync from profileDataManager)
   * This method syncs configuration info; runtime status is updated via IPC events
   */
  updateServerConfigs(configs: McpServerConfig[]): void {
    if (!configs || !Array.isArray(configs)) {
      return
    }

    let hasChanges = false
    const newServers: MCPServerExtended[] = []

    configs.forEach(config => {
      const existingServer = this.cache.servers.find(s => s.name === config.name)
      const runtimeState = this.cache.runtimeStates.find(s => s.serverName === config.name)

      const server: MCPServerExtended = {
        name: config.name,
        transport: config.transport as 'stdio' | 'sse' | 'StreamableHttp',
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        in_use: config.in_use,
      // Add version and source fields
        version: config.version || existingServer?.version,
        source: config.source || existingServer?.source,
        hidden: config.hidden,
        status: runtimeState?.status || existingServer?.status || 'disconnected',
        tools: runtimeState?.tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema,
          serverId: config.name
        })) || existingServer?.tools || [],
        error: runtimeState?.lastError ? String(runtimeState.lastError) : existingServer?.error,
        lastUpdated: existingServer?.lastUpdated || Date.now()
      }

      newServers.push(server)
    })

    // Preserve built-in servers
    const BUILTIN_SERVER_NAME = 'builtin-tools'
    const builtinServer = this.cache.servers.find(s => s.name === BUILTIN_SERVER_NAME)
    if (builtinServer && !newServers.some(s => s.name === BUILTIN_SERVER_NAME)) {
      newServers.push(builtinServer)
    }

    // Check if there are any changes
    if (JSON.stringify(this.cache.servers) !== JSON.stringify(newServers)) {
      hasChanges = true
      this.cache.servers = newServers
      this.cache.lastUpdated = Date.now()
    }

    if (hasChanges) {
      this.notifyListeners()
    }
  }

  /**
   * Map a status string to the enum type
   */
  private mapStatus(status: string): MCPServerStatus {
    const statusMapping: { [key: string]: MCPServerStatus } = {
      'connected': 'connected',
      'disconnected': 'disconnected',
      'connecting': 'connecting',
      'disconnecting': 'disconnecting',
      'needs-user-interaction': 'needs-user-interaction',
      'error': 'error'
    }
    return statusMapping[status] || 'disconnected'
  }

  /**
   * Notify subscribers of data changes (with debounce)
   */
  private notifyListeners(immediate = false): void {
    if (immediate) {
      this.performNotification()
      return
    }

    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout)
    }

    this.pendingNotification = true
    this.notificationTimeout = setTimeout(() => {
      if (this.pendingNotification) {
        this.performNotification()
      }
    }, 100) // 100ms debounce
  }

  private performNotification(): void {
    const cacheSnapshot = this.getCache()
    this.listeners.forEach(listener => {
      try {
        listener(cacheSnapshot)
      } catch (error) {
        logger.error('[MCPClientCacheManager] Listener error:', error)
      }
    })

    this.pendingNotification = false
    this.notificationTimeout = null
  }

  // ========== Read-only access methods ==========

  /**
   * Get all MCP servers
   */
  getMCPServers(): MCPServerExtended[] {
    return [...this.cache.servers]
  }

  /**
   * Get an MCP server by name
   */
  getMCPServerByName(name: string): MCPServerExtended | null {
    return this.cache.servers.find(s => s.name === name) || null
  }

  /**
   * Get all runtime states
   */
  getMCPRuntimeStates(): MCPServerRuntimeState[] {
    return [...this.cache.runtimeStates]
  }

  /**
   * Get runtime state by server name
   */
  getMCPRuntimeState(serverName: string): MCPServerRuntimeState | null {
    return this.cache.runtimeStates.find(s => s.serverName === serverName) || null
  }

  /**
   * 🆕 Get all server states (alias method for use by profileDataManager)
   */
  getAllServerStates(): MCPServerRuntimeState[] {
    return [...this.cache.runtimeStates]
  }

  /**
   * 🆕 Get state by server name (alias method for use by profileDataManager)
   */
  getServerState(serverName: string): MCPServerRuntimeState | null {
    return this.cache.runtimeStates.find(s => s.serverName === serverName) || null
  }

  /**
   * Get all available MCP tools
   */
  getAllMCPTools(): MCPTool[] {
    const tools: MCPTool[] = []
    this.cache.servers.forEach(server => {
      if (server.status === 'connected' && server.tools) {
        tools.push(...server.tools)
      }
    })
    return tools
  }

  /**
   * Get MCP tools accessible by a specific Agent
   */
  getAgentSpecificTools(agentMcpServers: Array<{ name: string; tools: string[] }>): MCPTool[] {
    if (!agentMcpServers || agentMcpServers.length === 0) {
      return []
    }

    if (this.cache.servers.length === 0) {
      return []
    }

    const tools: MCPTool[] = []

    // Build server -> tools mapping
    const serverToolsMap = new Map<string, string[]>()
    agentMcpServers.forEach(serverConfig => {
      serverToolsMap.set(serverConfig.name, serverConfig.tools || [])
    })

    this.cache.servers.forEach(server => {
      const allowedTools = serverToolsMap.get(server.name)

      // Only process servers specified in the Agent config
      if (allowedTools !== undefined && server.status === 'connected' && server.tools) {
        let serverTools = server.tools

        // If allowedTools is not empty, filter the tools
        if (allowedTools.length > 0) {
          serverTools = server.tools.filter(tool => allowedTools.includes(tool.name))
        }

        tools.push(...serverTools)
      }
    })

    return tools
  }

  /**
   * Get MCP statistics
   */
  getMCPStats(): MCPStats {
    const servers = this.cache.servers
    const connectedCount = servers.filter(s => s.status === 'connected').length
    const totalTools = this.getAllMCPTools().length

    return {
      totalServers: servers.length,
      connectedServers: connectedCount,
      disconnectedServers: servers.filter(s => s.status === 'disconnected').length,
      errorServers: servers.filter(s => s.status === 'error').length,
      totalTools
    }
  }

  /**
   * Check if data is stale
   */
  isDataStale(maxAgeMs: number = 300000): boolean {
    return (Date.now() - this.cache.lastUpdated) > maxAgeMs
  }

  /**
   * Refresh data
   */
  async refresh(): Promise<void> {
    logger.debug('[MCPClientCacheManager] Refreshing data...')

    try {
      if (window.electronAPI?.mcp?.getServerStatus) {
        const result = await window.electronAPI.mcp.getServerStatus()
        if (result.success && result.data) {
          this.handleServerStatesUpdate(result.data)
        }
      }
    } catch (error) {
      logger.error('[MCPClientCacheManager] Refresh failed:', error)
    }
  }

  /**
   * Clean up resources
   * 🔥 Important fix: on user sign-out, only clear cached data; preserve IPC listeners and subscribers
   * so that when a new user signs in, they can still receive backend messages and update the UI
   */
  cleanup(): void {
    logger.debug('[MCPClientCacheManager] Cleaning up...')

    // Clean up notification timer
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout)
      this.notificationTimeout = null
    }
    this.pendingNotification = false

    // 🔥 Important fix: do NOT clean up IPC listeners!
    // These are needed to receive MCP server states from the backend when a new user signs in
    // this.cleanupFunctions.forEach(cleanup => cleanup())
    // this.cleanupFunctions = []

    // Reset cache
    this.cache = {
      servers: [],
      runtimeStates: [],
      lastUpdated: 0,
      isInitialized: false
    }

    // 🔥 Important fix: do NOT clean up subscribers!
    // These are React component subscriptions; once cleared, components can no longer receive new data notifications
    // this.listeners = []
    // this.connectionFailureListeners = []

    // Clear previous server status cache (safe to clear)
    this.previousServerStatuses.clear()

    // 🔥 Notify all subscribers that the cache has been cleared
    logger.debug('[MCPClientCacheManager] 🔔 Notifying listeners of cleared cache')
    this.notifyListeners()

    logger.debug('[MCPClientCacheManager] ✅ Cleanup completed, listeners preserved')
  }
}

// Export singleton instance
export const mcpClientCacheManager = MCPClientCacheManager.getInstance()
