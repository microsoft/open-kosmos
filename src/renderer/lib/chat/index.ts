// src/renderer/lib/chat/index.ts
// Chat and API module exports - V2 Architecture

// Chat Configuration Operations (V2)
export { chatOps } from './chatOps';
export * from './chatOps';

// Chat Session Operations (V2)
export { chatSessionOps } from './chatSessionOps';
export * from './chatSessionOps';

// Agent Chat Session Cache Manager (V2)
export { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
export * from './agentChatSessionCacheManager';

// Model Management (existing)
export * from '../models/ghcModels';


// V2 Architecture Note:
// - AgentChat and AgentChatManager have been migrated to main process
// - Frontend now uses IPC communication to interact with AgentChat
// - chatOps provides Chat configuration management for V2 profiles
// - chatSessionOps provides ChatSession operations
// - agentChatSessionCacheManager provides unified frontend state management for chat sessions
