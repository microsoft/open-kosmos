// src/renderer/lib/memory/MemoryProxy.ts
// MemoryProxy interface definition - defines the core interface for the memory system
// The actual implementation is in the main process; this provides type definitions and interface contracts
import { Message, MessageHelper } from '../../types/chatTypes';

export interface MemoryOperation {
  type: 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';
  memory: string;
  id?: string;
  oldMemory?: string;
  confidence?: number;
}

export interface MemoryItem {
  id: string;
  memory: string;
  score?: number;
  metadata?: {
    userId?: string;
    agentId?: string;
    sessionId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface MemoryStats {
  totalMemories: number;
  userMemories: number;
  agentMemories: number;
  sessionMemories: number;
  lastUpdated?: string;
}

export interface MemoryMetadata {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  source?: string;
  [key: string]: any;
}

/**
 * MemoryProxy interface
 * Defines the core functionality interface of the memory system
 */
export interface IMemoryProxy {
  initialize(): Promise<void>;
  extractFacts(messages: Message[]): Promise<string[]>;
  updateMemories(facts: string[]): Promise<MemoryOperation[]>;
  searchRelevantMemories(query: string, limit?: number): Promise<MemoryItem[]>;
  enhanceSystemPrompt(basePrompt: string, query: string): Promise<string>;
  getMemoryStats(): Promise<MemoryStats>;
  addMemory(content: string, metadata?: MemoryMetadata): Promise<boolean>;
  deleteMemory(memoryId: string): Promise<boolean>;
  getAllMemories(limit?: number): Promise<MemoryItem[]>;
  destroy(): Promise<void>;
  isInitialized(): boolean;
  getConfig(): any;
}

/**
 * MemoryProxy abstract base class
 * Provides the basic structure and default implementation for the memory system
 * Concrete implementation calls the main process via IPC in MemoryProxyIPC
 */
export abstract class MemoryProxy implements IMemoryProxy {
  protected readonly userAlias: string;
  protected readonly agentId: string;
  protected initialized = false;
  
  constructor(userAlias: string, agentId: string) {
    this.userAlias = userAlias;
    this.agentId = agentId;
  }
  
  abstract initialize(): Promise<void>;
  abstract extractFacts(messages: Message[]): Promise<string[]>;
  abstract updateMemories(facts: string[]): Promise<MemoryOperation[]>;
  abstract searchRelevantMemories(query: string, limit?: number): Promise<MemoryItem[]>;
  abstract enhanceSystemPrompt(basePrompt: string, query: string): Promise<string>;
  abstract getMemoryStats(): Promise<MemoryStats>;
  abstract addMemory(content: string, metadata?: MemoryMetadata): Promise<boolean>;
  abstract deleteMemory(memoryId: string): Promise<boolean>;
  abstract getAllMemories(limit?: number): Promise<MemoryItem[]>;
  abstract destroy(): Promise<void>;
  
  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Get current configuration info
   */
  getConfig() {
    return {
      userAlias: this.userAlias,
      agentId: this.agentId,
      initialized: this.initialized
    };
  }
  
  /**
   * Convert messages to standard format
   */
  protected convertMessagesToStandardFormat(messages: Message[]): Array<{role: string, content: string}> {
    return messages.map(msg => ({
      role: msg.role,
      content: MessageHelper.getText(msg) || ''
    })).filter(msg => msg.content.trim().length > 0);
  }
}

/**
 * StubMemoryProxy - stub implementation
 * Provides a basic empty implementation when the memory system is unavailable
 */
export class StubMemoryProxy extends MemoryProxy {
  async initialize(): Promise<void> {
    this.initialized = true;
  }
  
  async extractFacts(messages: Message[]): Promise<string[]> {
    return [];
  }
  
  async updateMemories(facts: string[]): Promise<MemoryOperation[]> {
    return [];
  }
  
  async searchRelevantMemories(query: string, limit: number = 5): Promise<MemoryItem[]> {
    return [];
  }
  
  async enhanceSystemPrompt(basePrompt: string, query: string): Promise<string> {
    return basePrompt;
  }
  
  async getMemoryStats(): Promise<MemoryStats> {
    return {
      totalMemories: 0,
      userMemories: 0,
      agentMemories: 0,
      sessionMemories: 0,
      lastUpdated: new Date().toISOString()
    };
  }
  
  async addMemory(content: string, metadata?: MemoryMetadata): Promise<boolean> {
    return false;
  }
  
  async deleteMemory(memoryId: string): Promise<boolean> {
    return false;
  }
  
  async getAllMemories(limit?: number): Promise<MemoryItem[]> {
    return [];
  }
  
  async destroy(): Promise<void> {
    this.initialized = false;
  }
}