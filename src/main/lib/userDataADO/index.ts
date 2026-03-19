// This module contains ProfileCacheManager and related functionality
// Note: SigninOps functionality has been merged into MainAuthManager
export { ProfileCacheManager, profileCacheManager } from './profileCacheManager';

// 🆕 AppCacheManager — responsible for reading/writing and caching app.json
export { AppCacheManager, appCacheManager } from './appCacheManager';
export type { AppConfig, RuntimeEnvironment, RuntimeMode } from './types/app';
export { DEFAULT_APP_CONFIG, DEFAULT_RUNTIME_ENVIRONMENT, isAppConfig } from './types/app';
export type { ChatSessionFile, ChatSessionFileResult } from './chatSessionFileOps';
export { ChatSessionFileOps } from './chatSessionFileOps';

// 🔥 New architecture: ChatSession independent directory structure manager
export { chatSessionManager, ChatSessionManager } from './chatSessionManager';
export type { ChatSessionsChatIndex, ChatSessionsMonthIndex } from './chatSessionManager';

// Path utility functions
export {
  getChatSessionsRootPath,
  getChatSessionsChatPath,
  getChatSessionsChatIndexPath,
  getChatSessionsMonthPath,
  getChatSessionsMonthIndexPath,
  getChatSessionFilePath,
  extractMonthFromChatSessionId,
  generateChatSessionId,
  getCurrentMonth,
  isValidChatSessionId
} from './pathUtils';

// 🔥 KOSMOS placeholder variable management
export {
  KosmosPlaceholder,
  KOSMOS_PLACEHOLDER_REGEX,
  containsKosmosPlaceholder,
  extractKosmosPlaceholders,
  KosmosPlaceholderManager,
  kosmosPlaceholderManager
} from './kosmosPlaceholders';

// 🔥 USER_INPUT placeholder variable parsing
export {
  UserInputPlaceholderParser,
  userInputPlaceholderParser
} from './userInputPlaceholderParser';
export type {
  UserInputField,
  ParseUserInputResult
} from './userInputPlaceholderParser';

// Explicitly export types to avoid TypeScript isolated modules error
export type {
  McpServerConfig,
  GhcUser,
  GhcTokens,
  ModelModalities,
  ModelLimit,
  ModelConfig,
  ChatSession,
  ChatAgent,
  ChatConfig,
  ProfileV2,
  Profile
} from './types/profile';

// Export functions and constants (runtime values)
export {
  isProfileV2,
  detectProfileVersion,
  isProfile,
  isMcpServerConfig,
  DEFAULT_CHAT_AGENT,
  DEFAULT_PROFILE_V2,
  DEFAULT_MCP_SERVER,
  ChatSessionUtils,
  DEFAULT_CHAT_SESSION
} from './types/profile';