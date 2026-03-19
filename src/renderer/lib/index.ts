// src/renderer/lib/index.ts
// Main lib index - exports all module groups

export * from './auth';
export * from './chat';

// 🆕 Refactored: MCP types are now exported from ./mcp as the authoritative source
// MCP types in ./userData have been marked as deprecated
export * from './mcp';

// Export from userData excluding MCP types that are duplicated in ./mcp
export {
  // ProfileDataManager
  ProfileDataManager,
  profileDataManager,
  // Types (excluding MCP types that are now in ./mcp)
  type Profile,
  type GhcUser,
  type GhcTokens,
  type ModelConfig,
  type McpServerConfig,
  type ProfileCacheData,
  type ProfileDataListener,
  type ProfileSyncResponse,
  type GhcModel
} from './userData';

export * from './streaming';
// Export perf module separately to avoid conflicts with performanceMonitor in streaming
export { GhcPerformanceOptimizer, memoryOptimizer } from './perf';
export * from './utilities';
