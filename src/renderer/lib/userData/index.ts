/**
 * Profile Operations Module
 * 
 * This module provides a unified interface for profile data management
 * that is consistent with the backend ProfileCacheManager.
 */

// Export the main ProfileDataManager class and singleton
export { ProfileDataManager, profileDataManager } from './profileDataManager'

// 🆕 AppDataManager — Frontend app.json cache management (for frontend use only)
export { AppDataManager, appDataManager } from './appDataManager'
export type { AppDataListener } from './appDataManager'
export { useVoiceInputEnabled } from './useVoiceInputEnabled'
export type { AppConfig, RuntimeEnvironment, RuntimeMode } from './types'

// Export all types for use in other parts of the application
export type {
  // Core types from backend
  Profile,
  GhcUser,
  GhcTokens,
  ModelConfig,
  McpServerConfig,
  
  // Frontend-specific types
  MCPServerStatus,
  MCPTool,
  MCPServerRuntimeState,
  MCPServerExtended,
  ProfileCacheData,
  ProfileDataListener,
  MCPStats,
  ProfileSyncResponse,
  GhcModel
} from './types'
