/**
 * Background Process Manager Module
 * Re-exports for async background process execution and management
 */

export * from './types';
export { BackgroundProcessManager, getBackgroundProcessManager } from './BackgroundProcessManager';
export { buildCommandLine, quoteArg } from './commandLineUtils';
