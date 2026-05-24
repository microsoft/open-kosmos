/**
 * Unified Terminal Instance Manager — module exports.
 */

// Main interfaces and types
export * from './types';

// Platform configuration manager
export { PlatformConfigManager } from './PlatformConfigManager';

// Terminal instance implementation
export { TerminalInstance } from './TerminalInstance';

// Terminal manager (recommended primary interface)
export { TerminalManager, getTerminalManager } from './TerminalManager';

// Convenience functions
export { createExecuteCommandAdapter, createMcpTransportAdapter } from './adapters';