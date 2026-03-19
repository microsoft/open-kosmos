// src/renderer/lib/memory/MemoryProxyIPC.ts
// MemoryProxyIPC class - runs in the renderer process, communicates with the main process MemoryProxy via IPC
import { MemoryProxy, MemoryItem, MemoryStats, MemoryMetadata, MemoryOperation } from './MemoryProxy';
import { Message } from '../../types/chatTypes';

/**
 * MemoryProxyIPC class - IPC communication wrapper
 * Extends MemoryProxy base class, provides type-safe memory system interface for the renderer process
 * All methods invoke the real MemoryProxy implementation in the main process via IPC
 */
export class MemoryProxyIPC extends MemoryProxy {
  constructor(userAlias: string, agentId: string) {
    super(userAlias, agentId);
  }
  
  /**
   * Initialize memory agent (via IPC)
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    
    if (this.initialized) {
      return;
    }
    
    try {
      // Check IPC interface availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.initialize);
      
      if (!ipcAvailable) {
        throw new Error('Memory proxy IPC interface not available in electronAPI');
      }
      
      // Send initialization request to main process
      
      const result = await (window.electronAPI as any).memoryProxy.initialize(this.userAlias, this.agentId);
      const duration = Date.now() - startTime;
      
      
      if (result.success) {
        this.initialized = true;
      } else {
        throw new Error(result.error || 'Failed to initialize memory proxy through IPC');
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      throw error;
    }
  }
  
  /**
   * Extract facts from conversation messages (via IPC)
   */
  async extractFacts(messages: Message[]): Promise<string[]> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return [];
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.extractFacts);
      
      if (!ipcAvailable) {
        return [];
      }
      
      // Send fact extraction request
      
      const result = await (window.electronAPI as any).memoryProxy.extractFacts(
        this.userAlias,
        this.agentId,
        messages
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const facts = result.data || [];
        return facts;
      } else {
        return [];
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return [];
    }
  }
  
  /**
   * Update memories (via IPC)
   */
  async updateMemories(facts: string[]): Promise<MemoryOperation[]> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return [];
    }
    
    if (facts.length === 0) {
      return [];
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.updateMemories);
      
      if (!ipcAvailable) {
        return [];
      }
      
      // Send memory update request
      
      const result = await (window.electronAPI as any).memoryProxy.updateMemories(
        this.userAlias,
        this.agentId,
        facts
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const operations = result.data || [];
        return operations;
      } else {
        return [];
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return [];
    }
  }
  
  /**
   * Search relevant memories (via IPC)
   */
  async searchRelevantMemories(query: string, limit: number = 5): Promise<MemoryItem[]> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return [];
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.searchMemories);
      
      if (!ipcAvailable) {
        return [];
      }
      
      // Send memory search request
      
      const result = await (window.electronAPI as any).memoryProxy.searchMemories(
        this.userAlias,
        this.agentId,
        query,
        limit
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const memories = result.data || [];
        return memories;
      } else {
        return [];
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return [];
    }
  }
  
  /**
   * Enhance system prompt (via IPC)
   */
  async enhanceSystemPrompt(basePrompt: string, query: string): Promise<string> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return basePrompt;
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.enhanceSystemPrompt);
      
      if (!ipcAvailable) {
        return basePrompt;
      }
      
      // Send system prompt enhancement request
      
      const result = await (window.electronAPI as any).memoryProxy.enhanceSystemPrompt(
        this.userAlias,
        this.agentId,
        basePrompt,
        query
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const enhancedPrompt = result.data || basePrompt;
        const improvementPercent = basePrompt.length > 0 ?
          ((enhancedPrompt.length - basePrompt.length) / basePrompt.length * 100).toFixed(1) : '0';
        
        return enhancedPrompt;
      } else {
        return basePrompt;
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return basePrompt;
    }
  }
  
  /**
   * Get memory statistics (via IPC)
   */
  async getMemoryStats(): Promise<MemoryStats> {
    const startTime = Date.now();
    const defaultStats: MemoryStats = {
      totalMemories: 0,
      userMemories: 0,
      agentMemories: 0,
      sessionMemories: 0
    };
    
    
    if (!this.initialized) {
      return defaultStats;
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.getMemoryStats);
      
      if (!ipcAvailable) {
        return defaultStats;
      }
      
      // Send statistics request
      
      const result = await (window.electronAPI as any).memoryProxy.getMemoryStats(
        this.userAlias,
        this.agentId
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const stats = result.data || defaultStats;
        return stats;
      } else {
        return defaultStats;
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return defaultStats;
    }
  }
  
  /**
   * Manually add memory (via IPC)
   */
  async addMemory(content: string, metadata?: MemoryMetadata): Promise<boolean> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return false;
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.addMemory);
      
      if (!ipcAvailable) {
        return false;
      }
      
      // Send add memory request
      
      const result = await (window.electronAPI as any).memoryProxy.addMemory(
        this.userAlias,
        this.agentId,
        content,
        metadata
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        return result.data || false;
      } else {
        return false;
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return false;
    }
  }
  
  /**
   * Delete memory (via IPC)
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return false;
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.deleteMemory);
      
      if (!ipcAvailable) {
        return false;
      }
      
      // Send delete memory request
      
      const result = await (window.electronAPI as any).memoryProxy.deleteMemory(
        this.userAlias,
        this.agentId,
        memoryId
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        return result.data || false;
      } else {
        return false;
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return false;
    }
  }
  
  /**
   * Get all memories (via IPC)
   */
  async getAllMemories(limit?: number): Promise<MemoryItem[]> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      return [];
    }
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.getAllMemories);
      
      if (!ipcAvailable) {
        return [];
      }
      
      // Send get all memories request
      
      const result = await (window.electronAPI as any).memoryProxy.getAllMemories(
        this.userAlias,
        this.agentId,
        limit
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        const memories = result.data || [];
        return memories;
      } else {
        return [];
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      return [];
    }
  }
  
  /**
   * Search memories (alias for getAllMemories, for compatibility)
   */
  async searchMemories(query: string, limit?: number): Promise<MemoryItem[]> {
    return this.searchRelevantMemories(query, limit);
  }
  
  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check IPC method availability
      const ipcAvailable = !!((window.electronAPI as any)?.memoryProxy?.destroy);
      
      if (ipcAvailable) {
        
        await (window.electronAPI as any).memoryProxy.destroy(this.userAlias, this.agentId);
        
        const duration = Date.now() - startTime;
      } else {
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
    } finally {
      // Reset initialization state regardless
      const wasInitialized = this.initialized;
      this.initialized = false;
      
    }
  }
  
  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if IPC interface is available
   */
  isAvailable(): boolean {
    const available = !!((window.electronAPI as any)?.memoryProxy);
    return available;
  }
  
  /**
   * Get current configuration info
   */
  getConfig() {
    const config = {
      userAlias: this.userAlias,
      agentId: this.agentId,
      initialized: this.initialized,
      ipcAvailable: this.isAvailable()
    };
    
    
    return config;
  }
}

// Export type alias for backward compatibility
export type MemoryAgentIPC = MemoryProxyIPC;