import { Memory, MemoryGraph } from '../mem0-core/memory';
import { MemoryConfig } from '../mem0-core/types';

/**
 * Kosmos Memory Manager status information interface
 */
export interface KosmosMemoryStatus {
  isInitialized: boolean;
  currentUser: string | null;
  currentMode: string;
  hasMemoryInstance: boolean;
  hasGraphInstance: boolean;
  isInitializing: boolean;
}

/**
 * Kosmos Memory configuration options interface
 */
export interface KosmosMemoryConfigOptions {
  userAlias?: string;
  baseDir?: string;
}

/**
 * Kosmos Memory instance type
 */
export type KosmosMemoryInstance = Memory;

/**
 * Kosmos Memory Graph instance type
 */
export type KosmosMemoryGraphInstance = MemoryGraph;

/**
 * Supported runtime modes (only production mode is supported now)
 */
export type KosmosMemoryMode = 'production';

/**
 * Singleton initialization options
 */
export interface SingletonInitOptions {
  userAlias: string;
  mode?: KosmosMemoryMode;
  customConfig?: Partial<MemoryConfig>;
  forceReinitialize?: boolean;
}

/**
 * Memory path configuration interface
 */
export interface MemoryPathConfig {
  basePath: string;
  vectorStorePath: string;
  historyDirectory: string;
  historyDbPath: string;
}

/**
 * Singleton manager interface
 */
export interface IKosmosMemoryManager {
  initializeForUser(
    userAlias: string,
    mode?: KosmosMemoryMode,
    customConfig?: Partial<MemoryConfig>
  ): Promise<Memory>;
  
  getCurrentMemory(): Memory | null;
  // Removed graph mode support
  // getCurrentMemoryGraph(): MemoryGraph | null;
  getCurrentUserAlias(): string | null;
  getCurrentMode(): string;
  
  isInitializedForUser(userAlias: string): boolean;
  resetMemory(): Promise<void>;
  getStatusInfo(): KosmosMemoryStatus;
}

/**
 * Neo4j configuration interface
 */
export interface Neo4jConfig {
  url?: string;
  username?: string;
  password?: string;
}

/**
 * Event type definitions
 */
export type MemoryManagerEvent = 
  | 'initialized'
  | 'user-switched'
  | 'reset'
  | 'error';

/**
 * Event handler interface
 */
export interface MemoryManagerEventHandler {
  (event: MemoryManagerEvent, data?: any): void;
}

/**
 * Vector store provider type
 */
export type VectorStoreProvider = 'chroma' | 'memory';

/**
 * LLM provider type
 */
export type LLMProvider = 'kosmos' | 'openai';

/**
 * Embedding provider type
 */
export type EmbeddingProvider = 'kosmos' | 'openai';

/**
 * History store provider type
 */
export type HistoryStoreProvider = 'sqlite' | 'dummy';

/**
 * Graph store provider type
 */
export type GraphStoreProvider = 'neo4j';

/**
 * Complete configuration providers interface
 */
export interface ConfigProviders {
  vectorStore: VectorStoreProvider;
  llm: LLMProvider;
  embedder: EmbeddingProvider;
  historyStore?: HistoryStoreProvider;
  graphStore?: GraphStoreProvider;
}

/**
 * Mode to configuration mapping type
 */
export type ModeConfigMap = {
  [K in KosmosMemoryMode]: MemoryConfig;
};

/**
 * Export all core types for convenient external use
 */
export type {
  MemoryConfig
} from '../mem0-core/types';

export type {
  Memory,
  MemoryGraph
} from '../mem0-core/memory';