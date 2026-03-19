/**
 * Unified Terminal Instance Manager Module Exports
 */

// Main interfaces and types
export * from './types';

// Platform configuration manager
export { PlatformConfigManager } from './PlatformConfigManager';

// Terminal instance implementation
export { TerminalInstance } from './TerminalInstance';

// Terminal manager (recommended main interface)
export { TerminalManager, getTerminalManager } from './TerminalManager';

// Convenience functions
export { createExecuteCommandAdapter, createMcpTransportAdapter } from './adapters';