/**
 * Kosmos Memory usage example
 * Demonstrates how to use ChromaDB vector memory functionality
 *
 * Note: Graph Memory feature has been removed, focusing on production ChromaDB approach
 */

import {
  getKosmosMemory,
  KOSMOS_MEMORY_CONFIG
} from '../index';
import type { Memory } from '../../mem0-core';

/**
 * Vector Memory basic usage example
 */
export class VectorMemoryExample {
  private memory: Memory | null = null;
  private userAlias: string;

  constructor(userAlias: string = 'example_user') {
    this.userAlias = userAlias;
  }

  /**
   * Initialize memory system
   */
  async initialize() {
    try {
      this.memory = await getKosmosMemory(this.userAlias);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add memory to vector database
   */
  async addMemory(content: string, metadata?: any) {
    if (!this.memory) {
      throw new Error('Memory not initialized. Call initialize() first.');
    }
    
    
    const result = await this.memory.add(content, {
      userId: this.userAlias,
      ...metadata
    });
    
    
    return result;
  }

  /**
   * Search related memories
   */
  async searchMemories(query: string, limit: number = 10) {
    if (!this.memory) {
      throw new Error('Memory not initialized. Call initialize() first.');
    }
    
    
    const results = await this.memory.search(query, {
      userId: this.userAlias,
      limit
    });
    
    
    return results;
  }

  /**
   * Get all memories
   */
  async getAllMemories(limit: number = 100) {
    if (!this.memory) {
      throw new Error('Memory not initialized. Call initialize() first.');
    }
    
    
    const memories = await this.memory.getAll({
      userId: this.userAlias,
      limit
    });
    
    
    return memories;
  }

  /**
   * Delete memory
   */
  async deleteMemory(memoryId: string) {
    if (!this.memory) {
      throw new Error('Memory not initialized. Call initialize() first.');
    }
    
    
    const result = await this.memory.delete(memoryId);
    
    
    return result;
  }

  /**
   * Clear all data
   */
  async clearAll() {
    if (!this.memory) {
      throw new Error('Memory not initialized. Call initialize() first.');
    }
    
    
    await this.memory.deleteAll({
      userId: this.userAlias
    });
    
  }

  /**
   * Run complete example
   */
  async runExample() {
    try {

      // 1. Initialize memory system
      await this.initialize();

      // 2. Add some memories
      await this.addMemory('Alice is a software engineer at Google', {
        category: 'personal',
        source: 'example'
      });
      await this.addMemory('Alice loves machine learning and AI', {
        category: 'interests',
        source: 'example'
      });
      await this.addMemory('Google has offices in Mountain View and New York', {
        category: 'facts',
        source: 'example'
      });
      await this.addMemory('Bob works with Alice on AI projects', {
        category: 'relationships',
        source: 'example'
      });

      // 3. Search related memories
      await this.searchMemories('Alice career');

      await this.searchMemories('machine learning AI');

      // 4. Get all memories
      await this.getAllMemories();


    } catch (error) {
      throw error;
    }
  }
}

/**
 * Convenience function to create and run example
 */
export async function runVectorMemoryExample(userAlias: string = 'example_user') {
  const example = new VectorMemoryExample(userAlias);
  await example.runExample();
  return example;
}

// Export default configuration for reference
export { KOSMOS_MEMORY_CONFIG };

/**
 * Usage instructions:
 *
 * 1. Ensure Kosmos application is started and user authentication is completed
 * 2. ChromaDB server will start automatically (managed by ProfileCacheManager)
 * 3. Memory data is stored in user-specific ChromaDB collections
 * 4. All operations go through the main process mem0 system
 *
 * Example usage:
 *
 * const example = new VectorMemoryExample('your_user_alias');
 * await example.runExample();
 *
 * Or use the convenience function:
 *
 * await runVectorMemoryExample('your_user_alias');
 */