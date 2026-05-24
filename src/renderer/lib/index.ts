// src/renderer/lib/index.ts
// Main lib index - exports all module groups

export * from './auth';
export * from './chat';

// 🆕 Refactored: MCP types exported from ./mcp first (authoritative source)
// MCP types in ./userData are marked as deprecated
export * from './mcp';

// Re-export from userData, excluding MCP types that are now in ./mcp
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
  type GhcModel
} from './userData';

export * from './streaming';
// Export perf module separately to avoid conflicts with performanceMonitor in streaming
export { GhcPerformanceOptimizer, memoryOptimizer } from './perf';
export * from './utilities';
