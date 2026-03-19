import { Memory, MemoryGraph } from '../mem0-core/memory';
import { MemoryConfig } from '../mem0-core/types';
import { getKosmosMemoryConfigWithPaths } from './kosmosConfig';

/**
 * Kosmos Memory Manager - Singleton pattern manager
 * 
 * Provides globally unique Memory instance management, supports automatic re-initialization on user switch
 * Ensures each user has independent data storage
 */
export class KosmosMemoryManager {
  private static instance: KosmosMemoryManager | null = null;
  private memoryInstance: Memory | null = null;
  private memoryGraphInstance: MemoryGraph | null = null;
  private currentUserAlias: string | null = null;
  private currentMode: 'production' = 'production'; // Only supports production mode
  private isInitializing: boolean = false;
  private initializationPromise: Promise<Memory> | null = null;

  private constructor() {
    const creationTime = Date.now();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): KosmosMemoryManager {
    const getInstanceStartTime = Date.now();
    
    
    if (!KosmosMemoryManager.instance) {
      KosmosMemoryManager.instance = new KosmosMemoryManager();
      
    } else {
    }
    
    return KosmosMemoryManager.instance;
  }

  /**
   * Initialize Memory instance for the specified user
   * @param userAlias User alias
   * @param mode Running mode
   * @param customConfig Custom configuration (optional)
   * @returns Memory instance
   */
  public async initializeForUser(
    userAlias: string,
    mode: 'production' = 'production', // Only supports production mode
    customConfig?: Partial<MemoryConfig>
  ): Promise<Memory> {
    const initStartTime = Date.now();
    

    if (!userAlias) {
      throw new Error('User alias is required for memory initialization');
    }

    // If currently initializing, wait for completion
    if (this.isInitializing && this.initializationPromise) {
      
      const result = await this.initializationPromise;
      const waitDuration = Date.now() - Date.now();
      
      
      return result;
    }

    // Check if re-initialization is needed
    const needsReinitialize =
      !this.memoryInstance ||
      this.currentUserAlias !== userAlias ||
      this.currentMode !== mode;


    if (!needsReinitialize && this.memoryInstance) {
      const reuseDuration = Date.now() - initStartTime;
      return this.memoryInstance;
    }

    // Start initialization process
    
    this.isInitializing = true;
    this.initializationPromise = this._performInitialization(userAlias, mode, customConfig);

    try {
      const memoryInstance = await this.initializationPromise;
      const totalInitDuration = Date.now() - initStartTime;
      
      
      return memoryInstance;
    } catch (error) {
      const totalInitDuration = Date.now() - initStartTime;
      throw error;
    } finally {
      this.isInitializing = false;
      this.initializationPromise = null;
    }
  }

  /**
   * Perform the actual initialization process
   */
  private async _performInitialization(
    userAlias: string,
    mode: 'production', // Only supports production mode
    customConfig?: Partial<MemoryConfig>
  ): Promise<Memory> {
    const performStartTime = Date.now();
    

    try {
      // Clean up existing instances
      const cleanupStartTime = Date.now();
      
      await this._cleanupInstances();
      const cleanupDuration = Date.now() - cleanupStartTime;
      

      // Get user-specific configuration
      const configStartTime = Date.now();
      
      const config = getKosmosMemoryConfigWithPaths(userAlias, mode);
      const configDuration = Date.now() - configStartTime;
      

      // Apply custom configuration
      const mergeStartTime = Date.now();
      const finalConfig = customConfig ? this._mergeConfigs(config, customConfig) : config;
      const mergeDuration = Date.now() - mergeStartTime;
      

      // Create new Memory instance
      const instanceStartTime = Date.now();
      
      // Only supports production mode, create standard Memory instance
      this.memoryInstance = new Memory(finalConfig);
      
      
      const instanceDuration = Date.now() - instanceStartTime;

      // Update state
      const stateUpdateStartTime = Date.now();
      this.currentUserAlias = userAlias;
      this.currentMode = mode;
      const stateUpdateDuration = Date.now() - stateUpdateStartTime;

      const performDuration = Date.now() - performStartTime;
      

      return this.memoryInstance!;

    } catch (error) {
      const performDuration = Date.now() - performStartTime;
      
      // Clean up failed state
      this.memoryInstance = null;
      this.memoryGraphInstance = null;
      this.currentUserAlias = null;
      
      
      throw new Error(
        `Failed to initialize Kosmos Memory for user ${userAlias}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get the current Memory instance
   * @returns Current Memory instance, or null if not initialized
   */
  public getCurrentMemory(): Memory | null {
    const accessTime = Date.now();
    
    
    return this.memoryInstance;
  }

  /**
   * Get the current MemoryGraph instance (if in graph mode)
   * @returns Current MemoryGraph instance, or null if not in graph mode
   */
  public getCurrentMemoryGraph(): MemoryGraph | null {
    const accessTime = Date.now();
    
    
    return this.memoryGraphInstance;
  }

  /**
   * Get current user alias
   */
  public getCurrentUserAlias(): string | null {
    
    return this.currentUserAlias;
  }

  /**
   * Get current mode
   */
  public getCurrentMode(): string {
    
    return this.currentMode;
  }

  /**
   * Check if initialized for the specified user
   * @param userAlias User alias
   * @returns Whether initialized
   */
  public isInitializedForUser(userAlias: string): boolean {
    const isInitialized = this.memoryInstance !== null && this.currentUserAlias === userAlias;
    
    
    return isInitialized;
  }

  /**
   * Reset Memory instance
   * Used for forced re-initialization or resource cleanup
   */
  public async resetMemory(): Promise<void> {
    const resetStartTime = Date.now();
    
    
    await this._cleanupInstances();
    
    this.currentUserAlias = null;
    this.currentMode = 'production';
    
    const resetDuration = Date.now() - resetStartTime;
    
  }

  /**
   * Clean up existing instances - includes Better-SQLite3 and sqlite-vec connection closing
   */
  private async _cleanupInstances(): Promise<void> {
    const cleanupStartTime = Date.now();
    
    
    try {
      // Clean up Memory instance - close Better-SQLite3 and sqlite-vec connections
      if (this.memoryInstance) {
        try {
          // Access vectorStore and call close() method
          const memory = this.memoryInstance as any;
          if (memory.vectorStore && typeof memory.vectorStore.close === 'function') {
            await memory.vectorStore.close();
          }
          
          // History feature is disabled, no need to close historyStore
        } catch (closeError) {
        }
      }

      // Clean up MemoryGraph instance
      if (this.memoryGraphInstance) {
        try {
          const memoryGraph = this.memoryGraphInstance as any;
          if (memoryGraph.vectorStore && typeof memoryGraph.vectorStore.close === 'function') {
            await memoryGraph.vectorStore.close();
          }
        } catch (closeError) {
        }
      }

      this.memoryInstance = null;
      this.memoryGraphInstance = null;
      
      const cleanupDuration = Date.now() - cleanupStartTime;
      
      
    } catch (error) {
      const cleanupDuration = Date.now() - cleanupStartTime;
      
      
      // Reset instances even on error
      this.memoryInstance = null;
      this.memoryGraphInstance = null;
      
      // Continue execution, don't throw error
    }
  }

  /**
   * Deep merge configuration objects
   */
  private _mergeConfigs(baseConfig: MemoryConfig, customConfig: Partial<MemoryConfig>): MemoryConfig {
    const mergeStartTime = Date.now();
    
    
    const mergedConfig = {
      ...baseConfig,
      ...customConfig,
      vectorStore: {
        ...baseConfig.vectorStore,
        ...customConfig.vectorStore,
        config: {
          ...baseConfig.vectorStore?.config,
          ...customConfig.vectorStore?.config
        }
      },
      llm: {
        ...baseConfig.llm,
        ...customConfig.llm,
        config: {
          ...baseConfig.llm?.config,
          ...customConfig.llm?.config
        }
      },
      embedder: {
        ...baseConfig.embedder,
        ...customConfig.embedder,
        config: {
          ...baseConfig.embedder?.config,
          ...customConfig.embedder?.config
        }
      },
      // History feature is disabled
      graphStore: customConfig.graphStore ? {
        ...baseConfig.graphStore,
        ...customConfig.graphStore,
        config: {
          ...baseConfig.graphStore?.config,
          ...customConfig.graphStore?.config
        }
      } : baseConfig.graphStore
    };
    
    const mergeDuration = Date.now() - mergeStartTime;
    
    
    return mergedConfig;
  }

  /**
   * Get instance status info (for debugging)
   */
  public getStatusInfo(): {
    isInitialized: boolean;
    currentUser: string | null;
    currentMode: string;
    hasMemoryInstance: boolean;
    hasGraphInstance: boolean;
    isInitializing: boolean;
  } {
    const statusTime = Date.now();
    const statusInfo = {
      isInitialized: this.memoryInstance !== null,
      currentUser: this.currentUserAlias,
      currentMode: this.currentMode,
      hasMemoryInstance: this.memoryInstance !== null,
      hasGraphInstance: this.memoryGraphInstance !== null,
      isInitializing: this.isInitializing
    };
    
    
    return statusInfo;
  }
}

// Export convenient global access function
export const kosmosMemoryManager = KosmosMemoryManager.getInstance();