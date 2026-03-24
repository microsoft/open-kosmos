import { MemoryConfig } from '../mem0-core/types';
import { ensureMem0StoragePaths } from '../../userDataADO/pathUtils';

export interface KosmosMemoryConfigOptions {
  userAlias?: string;
  baseDir?: string;
}

/**
 * Kosmos Memory Configuration
 * mem0 configuration optimized for Kosmos application
 * Uses better-sqlite3 + sqlite-vec as vector database, GitHub Copilot as LLM and Embedding service
 */
export const KOSMOS_MEMORY_CONFIG: MemoryConfig = {
  version: "v1.1",
  
  // Embedding configuration - uses Kosmos textLlmEmbedder
  embedder: {
    provider: "kosmos",
    config: {
      model: "text-embedding-3-small", // Used via GitHub Copilot
    },
  },
  
  // Vector database configuration - uses better-sqlite3 + sqlite-vec
  vectorStore: {
    provider: "bettersqlite",
    config: {
      collectionName: "kosmos_memories", // OpenKosmos-specific collection name
      dimension: 1536, // text-embedding-3-small dimension
      persistPath: "./sqlite_db/user_memories.db" // Local storage path
    },
  },
  
  // LLM configuration - uses Kosmos GhcModelApi
  llm: {
    provider: "kosmos",
    config: {
      model: "gpt-4.1", // Used via GitHub Copilot
    },
  },
  
  // History configuration - disabled
  disableHistory: true,
  
  // Graph database configuration - temporarily disabled
  enableGraph: false,
  
  // Custom prompt - optional
  customPrompt: undefined,
};

// Removed development, in-memory mode and graph database configurations
// Only production mode is supported now

/**
 * Convenience function to get configuration
 * Only production mode is supported now
 */
export function getKosmosMemoryConfig(mode: 'production' = 'production'): MemoryConfig {
  // Only return production mode configuration
  return KOSMOS_MEMORY_CONFIG;
}

/**
 * Get dynamic path configuration for a specific user
 * @param userAlias User alias
 * @param mode Runtime mode
 * @param options Additional configuration options
 * @returns Configuration with user-specific paths
 */
export function getKosmosMemoryConfigWithPaths(
  userAlias: string,
  mode: 'production' = 'production', // Only supports production mode
  options?: KosmosMemoryConfigOptions
): MemoryConfig {
  if (!userAlias) {
    throw new Error('User alias is required for production mode');
  }

  // Get base configuration (production mode)
  const baseConfig = getKosmosMemoryConfig();

  // Get user-specific storage paths
  const storagePaths = ensureMem0StoragePaths(userAlias, options?.baseDir);

  // Create user-specific configuration
  const userSpecificConfig: MemoryConfig = {
    ...baseConfig,
    vectorStore: {
      ...baseConfig.vectorStore,
      config: {
        ...baseConfig.vectorStore?.config,
        persistPath: storagePaths.vectorStorePath,
        collectionName: `kosmos_memories_${userAlias}`, // Production mode collection name
        userAlias: userAlias, // Pass user alias to BetterSqliteVectorStore
      }
    },
    // History is disabled, no historyStore configuration needed
  };


  return userSpecificConfig;
}
