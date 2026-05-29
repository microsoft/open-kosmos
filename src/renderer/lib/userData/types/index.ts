/**
 * Type definitions for Profile Operations V2
 * Updated for chat-based architecture
 */

// Re-export backend types for consistency
export type {
  Profile,
  ProfileV2,
  GhcUser,
  GhcTokens,
  ModelConfig,
  McpServerConfig,
  AgentMcpServer,
  ChatConfig,
  ChatConfigRuntime,
  ChatAgent,
  ChatSession,
  StarredChatSessionIndexItem,
  ContextEnhancement,
  SkillConfig,
  SubAgentConfig,
  ZeroStates,
  QuickStartItem
} from '../../../../main/lib/userDataADO/types/profile'
export type { SchedulerJob } from '../../../../main/lib/scheduler/types'

// Re-export App configuration types
export type { AppConfig, RuntimeEnvironment, RuntimeMode } from '../../../../main/lib/userDataADO/types/app'
export { DEFAULT_RUNTIME_ENVIRONMENT, DEFAULT_APP_CONFIG, isAppConfig, isRuntimeEnvironment, isRuntimeMode } from '../../../../main/lib/userDataADO/types/app'

// Re-export builtin agent constants and utilities
export {
  BUILTIN_AGENT_NAMES_OpenKosmos,
  getBuiltinAgentNames,
  isBuiltinAgent
} from '../../../../main/lib/userDataADO/types/profile'

// Import and re-export GhcModel from existing location
import type { GhcModel } from '@shared/types/ghcChatTypes'
export type { GhcModel }

/**
 * MCP Server status enumeration - matches backend
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction'

/**
 * MCP Tool interface - consistent with backend runtime state
 */
export interface MCPTool {
  name: string
  description?: string  // Optional to match backend
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
  lastError: string | null  // Use string for frontend serialization
}

/**
 * Extended MCP server data that includes runtime information
 * Extends backend McpServerConfig with runtime state
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
  /** MCP server version */
  version?: string
  /** MCP server source: IN-LIBRARY (from MCP library), ON-DEVICE (from local machine), or PLUGIN (from plugin) */
  source?: 'IN-LIBRARY' | 'ON-DEVICE' | 'PLUGIN'
  /** Remote CDN version for IN-LIBRARY servers, empty string for ON-DEVICE servers */
  remoteVersion?: string
  /** If true, server is managed by the system and hidden from user-facing UI */
  hidden?: boolean

  // Runtime state fields
  status: MCPServerStatus
  error?: string
  tools?: MCPTool[]
  lastUpdated?: number
}

/**
 * V2 Profile cache data structure - supports chat-based architecture
 *
 * ⚠️ Note: currentChatId has been removed from this structure.
 * currentChatId is now managed centrally by agentChatSessionCacheManager.
 */
export interface ProfileCacheDataV2 {
  profile: import('../../../../main/lib/userDataADO/types/profile').ProfileV2 | null

  // V2: Chat-based data (replaces ghc_model_data) - uses Runtime type to support dynamically loaded chatSessions
  chats: import('../../../../main/lib/userDataADO/types/profile').ChatConfigRuntime[]

  // V2: Skills data
  skills: import('../../../../main/lib/userDataADO/types/profile').SkillConfig[]

  // V2: Sub-Agents data (post-migration will be SubAgentIndex[]; Phase 3 adapts renderer)
  subAgents: import('../../../../main/lib/userDataADO/types/profile').SubAgentConfig[]

  lastUpdated: number
  isInitialized: boolean
}

/**
 * Profile cache data type (V2 only)
 */
export type ProfileCacheData = ProfileCacheDataV2

/**
 * Data change listeners
 */
export type ProfileDataListener = (data: ProfileCacheData) => void

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
 * Profile data sync response
 */
export interface ProfileSyncResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Chat Session operation result interface - frontend specific
 */
export interface ChatSessionOperationResult {
  success: boolean
  error?: string
  data?: any
}

/**
 * Session info for UI display - frontend specific
 */
export interface SessionInfo {
  chatSession_id: string
  title: string
  last_updated: string
  displayName: string
  isActive: boolean
}

/**
 * Session management utility types
 */
export interface SessionListOptions {
  sortBy?: 'last_updated' | 'title' | 'created'
  sortOrder?: 'asc' | 'desc'
  currentSessionId?: string
}
