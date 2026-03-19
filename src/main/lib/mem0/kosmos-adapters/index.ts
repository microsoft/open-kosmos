// Export core mem0 classes and types
export { Memory, MemoryGraph } from '../mem0-core/memory';
export * from '../mem0-core/types';

// Export Kosmos adapters
export { BetterSqliteVectorStore } from './betterSqliteVectorStore';
export { KosmosLLM } from './kosmosLLM';
export { KosmosEmbedder } from './kosmosEmbedder';
export { KosmosNeo4jStore } from './kosmosNeo4jStore';

// Export singleton manager
export { KosmosMemoryManager, kosmosMemoryManager } from './KosmosMemoryManager';

// Export configuration (only supports production mode)
export {
  KOSMOS_MEMORY_CONFIG,
  getKosmosMemoryConfig,
  getKosmosMemoryConfigWithPaths,
  type KosmosMemoryConfigOptions
} from './kosmosConfig';

// ===== Removed legacy backward-compatible functions =====
// Note: Legacy creation functions have been removed, backward compatibility is no longer supported
// Please use the new singleton pattern interface: getKosmosMemory()

// ===== New singleton pattern interface =====

/**
 * Get or create a Kosmos Memory singleton instance for the specified user
 * Note: Only production mode is supported now, using better-sqlite3 + sqlite-vec as local persistent database
 * @param userAlias User alias (required)
 * @param customConfig Custom configuration (optional)
 * @returns Promise of Memory instance
 */
export async function getKosmosMemory(
  userAlias: string,
  customConfig?: Partial<any>
): Promise<import('../mem0-core/memory').Memory> {
  
  if (!userAlias) {
    throw new Error('User alias is a required parameter');
  }
  
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  
  
  const startTime = Date.now();
  try {
    const memoryInstance = await kosmosMemoryManager.initializeForUser(userAlias, 'production', customConfig);
    const duration = Date.now() - startTime;
    
    
    
    return memoryInstance;
  } catch (error) {
    const duration = Date.now() - startTime;
    throw error;
  }
}

/**
 * Get the current Kosmos Memory instance
 * @returns The current Memory instance, or null if not initialized
 */
export function getCurrentKosmosMemory(): import('../mem0-core/memory').Memory | null {
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  return kosmosMemoryManager.getCurrentMemory();
}

// Removed graph mode support - only production mode is supported now
// export function getCurrentKosmosMemoryGraph(): import('../mem0-core/memory').MemoryGraph | null {
//   const { kosmosMemoryManager } = require('./KosmosMemoryManager');
//   return kosmosMemoryManager.getCurrentMemoryGraph();
// }

/**
 * Reset the Kosmos Memory singleton instance
 * Used for forced re-initialization or resource cleanup
 */
export async function resetKosmosMemory(): Promise<void> {
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  return kosmosMemoryManager.resetMemory();
}

/**
 * Check if Memory has been initialized for the specified user
 * @param userAlias User alias
 * @returns Whether initialized
 */
export function isKosmosMemoryInitialized(userAlias: string): boolean {
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  return kosmosMemoryManager.isInitializedForUser(userAlias);
}

/**
 * Get current user alias
 * @returns Current user alias, or null if not initialized
 */
export function getCurrentUserAlias(): string | null {
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  return kosmosMemoryManager.getCurrentUserAlias();
}

/**
 * Get Kosmos Memory Manager status information (for debugging)
 */
export function getKosmosMemoryStatus() {
  const { kosmosMemoryManager } = require('./KosmosMemoryManager');
  return kosmosMemoryManager.getStatusInfo();
}

// ===== Updated existing functions to support user alias =====