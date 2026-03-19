/**
 * VSCode MCP Client - Request Handler
 * Handles MCP protocol requests with caching, progress tracking, and error handling
 */

import { EventEmitter } from 'events';
import { McpConnection } from './McpConnection';
import {
  McpTool,
  McpResource,
  McpPrompt,
  ToolCallOptions,
  ProgressCallback,
  CacheEntry,
} from '../types/mcpTypes';
import {
  MCP_METHODS,
  ToolsListRequest,
  ToolsListResult,
  ToolsCallRequest,
  ToolsCallResult,
  ResourcesListRequest,
  ResourcesListResult,
  ResourcesReadRequest,
  ResourcesReadResult,
  PromptsListRequest,
  PromptsListResult,
  PromptsGetRequest,
  PromptsGetResult,
} from '../types/protocolTypes';

// ==================== Cache Configuration ====================

interface CacheConfig {
  toolsListTtl: number;
  resourcesListTtl: number;
  promptsListTtl: number;
  resourceContentTtl: number;
  maxCacheSize: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  toolsListTtl: 300_000,      // 5 minutes
  resourcesListTtl: 60_000,   // 1 minute
  promptsListTtl: 300_000,    // 5 minutes
  resourceContentTtl: 60_000, // 1 minute
  maxCacheSize: 256,
};

// ==================== Request Context ====================

interface RequestContext {
  requestId: string;
  method: string;
  startTime: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

// ==================== Request Handler Implementation ====================

export class McpRequestHandler extends EventEmitter {
  private connection: McpConnection;
  private cacheConfig: CacheConfig;
  private cache = new Map<string, CacheEntry<any>>();
  private activeRequests = new Map<string, RequestContext>();
  private requestIdCounter = 0;

  // Statistics
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
  };

  public static readonly EVENTS = {
    REQUEST_STARTED: 'requestStarted',
    REQUEST_COMPLETED: 'requestCompleted',
    REQUEST_FAILED: 'requestFailed',
    PROGRESS: 'progress',
    CACHE_HIT: 'cacheHit',
    CACHE_MISS: 'cacheMiss',
  } as const;

  constructor(
    connection: McpConnection,
    cacheConfig: Partial<CacheConfig> = {}
  ) {
    super();
    
    this.connection = connection;
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
    
    this.setupConnectionListeners();
  }

  // ==================== Public API ====================

  /**
   * List available tools
   */
  async listTools(options?: { 
    cursor?: string; 
    useCache?: boolean; 
    signal?: AbortSignal 
  }): Promise<McpTool[]> {
    const cacheKey = `tools_list_${options?.cursor || 'default'}`;
    
    if (options?.useCache !== false) {
      const cached = this.getFromCache<McpTool[]>(cacheKey);
      if (cached) {
        this.trackCacheHit(cacheKey);
        return cached;
      }
    }

    this.trackCacheMiss(cacheKey);

    const request: ToolsListRequest = {
      cursor: options?.cursor,
    };

    const result = await this.executeRequest<ToolsListResult>(
      MCP_METHODS.TOOLS_LIST,
      request,
      { signal: options?.signal }
    );

    const tools = result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    // Cache the result
    this.setCache(cacheKey, tools, this.cacheConfig.toolsListTtl);

    return tools;
  }

  /**
   * Call a tool
   */
  async callTool(
    toolName: string,
    args?: Record<string, any>,
    options?: ToolCallOptions
  ): Promise<any> {
    const request: ToolsCallRequest = {
      name: toolName,
      arguments: args,
    };

    const requestId = this.generateRequestId();
    
    if (options?.onProgress) {
      this.activeRequests.set(requestId, {
        requestId,
        method: MCP_METHODS.TOOLS_CALL,
        startTime: Date.now(),
        onProgress: options.onProgress,
        signal: options.signal,
      });
    }

    try {
      const result = await this.executeRequest<ToolsCallResult>(
        MCP_METHODS.TOOLS_CALL,
        request,
        { 
          timeout: options?.timeout,
          signal: options?.signal 
        }
      );

      if (result.isError) {
        throw new Error(`Tool execution failed: ${JSON.stringify(result.content)}`);
      }

      return result.content;

    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * List available resources
   */
  async listResources(options?: { 
    cursor?: string; 
    useCache?: boolean; 
    signal?: AbortSignal 
  }): Promise<McpResource[]> {
    const cacheKey = `resources_list_${options?.cursor || 'default'}`;
    
    if (options?.useCache !== false) {
      const cached = this.getFromCache<McpResource[]>(cacheKey);
      if (cached) {
        this.trackCacheHit(cacheKey);
        return cached;
      }
    }

    this.trackCacheMiss(cacheKey);

    const request: ResourcesListRequest = {
      cursor: options?.cursor,
    };

    const result = await this.executeRequest<ResourcesListResult>(
      MCP_METHODS.RESOURCES_LIST,
      request,
      { signal: options?.signal }
    );

    const resources = result.resources.map(resource => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }));

    // Cache the result
    this.setCache(cacheKey, resources, this.cacheConfig.resourcesListTtl);

    return resources;
  }

  /**
   * Read a resource
   */
  async readResource(
    uri: string,
    options?: { useCache?: boolean; signal?: AbortSignal }
  ): Promise<any> {
    const cacheKey = `resource_${uri}`;
    
    if (options?.useCache !== false) {
      const cached = this.getFromCache<any>(cacheKey);
      if (cached) {
        this.trackCacheHit(cacheKey);
        return cached;
      }
    }

    this.trackCacheMiss(cacheKey);

    const request: ResourcesReadRequest = {
      uri,
    };

    const result = await this.executeRequest<ResourcesReadResult>(
      MCP_METHODS.RESOURCES_READ,
      request,
      { signal: options?.signal }
    );

    // Cache the result
    this.setCache(cacheKey, result.contents, this.cacheConfig.resourceContentTtl);

    return result.contents;
  }

  /**
   * List available prompts
   */
  async listPrompts(options?: { 
    cursor?: string; 
    useCache?: boolean; 
    signal?: AbortSignal 
  }): Promise<McpPrompt[]> {
    const cacheKey = `prompts_list_${options?.cursor || 'default'}`;
    
    if (options?.useCache !== false) {
      const cached = this.getFromCache<McpPrompt[]>(cacheKey);
      if (cached) {
        this.trackCacheHit(cacheKey);
        return cached;
      }
    }

    this.trackCacheMiss(cacheKey);

    const request: PromptsListRequest = {
      cursor: options?.cursor,
    };

    const result = await this.executeRequest<PromptsListResult>(
      MCP_METHODS.PROMPTS_LIST,
      request,
      { signal: options?.signal }
    );

    const prompts = result.prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    }));

    // Cache the result
    this.setCache(cacheKey, prompts, this.cacheConfig.promptsListTtl);

    return prompts;
  }

  /**
   * Get a prompt
   */
  async getPrompt(
    name: string,
    args?: Record<string, any>,
    options?: { signal?: AbortSignal }
  ): Promise<any> {
    const request: PromptsGetRequest = {
      name,
      arguments: args,
    };

    const result = await this.executeRequest<PromptsGetResult>(
      MCP_METHODS.PROMPTS_GET,
      request,
      { signal: options?.signal }
    );

    return result;
  }

  /**
   * Ping the server
   */
  async ping(options?: { signal?: AbortSignal }): Promise<any> {
    return this.executeRequest(
      MCP_METHODS.PING,
      {},
      { signal: options?.signal }
    );
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const regex = new RegExp(pattern);
    for (const key of Array.from(this.cache.keys())) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return {
      size: this.cache.size,
      maxSize: this.cacheConfig.maxCacheSize,
      hits: this.stats.cacheHits,
      misses: this.stats.cacheMisses,
      hitRate: total > 0 ? this.stats.cacheHits / total : 0,
    };
  }

  /**
   * Get request statistics
   */
  getStats(): {
    totalRequests: number;
    activeRequests: number;
    errors: number;
    cacheStats: {
      size: number;
      maxSize: number;
      hits: number;
      misses: number;
      hitRate: number;
    };
  } {
    return {
      totalRequests: this.stats.totalRequests,
      activeRequests: this.activeRequests.size,
      errors: this.stats.errors,
      cacheStats: this.getCacheStats(),
    };
  }

  // ==================== Private Implementation ====================

  private async executeRequest<T>(
    method: string,
    params: any,
    options?: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    if (!this.connection.isConnected) {
      throw new Error('Connection not established');
    }

    this.stats.totalRequests++;
    const startTime = Date.now();

    this.emit(McpRequestHandler.EVENTS.REQUEST_STARTED, {
      method,
      params,
      timestamp: startTime,
    });

    try {
      const result = await this.connection.request<T>(method, params, {
        timeout: options?.timeout,
        signal: options?.signal,
      });

      this.emit(McpRequestHandler.EVENTS.REQUEST_COMPLETED, {
        method,
        params,
        result,
        duration: Date.now() - startTime,
      });

      return result;

    } catch (error) {
      this.stats.errors++;
      
      this.emit(McpRequestHandler.EVENTS.REQUEST_FAILED, {
        method,
        params,
        error,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  private setupConnectionListeners(): void {
    // Clear cache when connection state changes
    this.connection.on('stateChanged', (prevState, newState) => {
      if (newState !== 'running') {
        this.clearCache();
      }
    });

    // Handle notifications that might invalidate cache
    this.connection.on('notification', (notification) => {
      this.handleCacheInvalidation(notification);
    });
  }

  private handleCacheInvalidation(notification: any): void {
    switch (notification.method) {
      case MCP_METHODS.NOTIFICATIONS_TOOLS_LIST_CHANGED:
        this.clearCache('tools_list');
        break;
      
      case MCP_METHODS.NOTIFICATIONS_RESOURCES_LIST_CHANGED:
        this.clearCache('resources_list');
        break;
      
      case MCP_METHODS.NOTIFICATIONS_RESOURCES_UPDATED:
        if (notification.params?.uri) {
          this.clearCache(`resource_${notification.params.uri}`);
        }
        break;
      
      case MCP_METHODS.NOTIFICATIONS_PROMPTS_LIST_CHANGED:
        this.clearCache('prompts_list');
        break;
    }
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  private setCache<T>(key: string, value: T, ttl: number): void {
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.cacheConfig.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });
  }

  private trackCacheHit(key: string): void {
    this.stats.cacheHits++;
    this.emit(McpRequestHandler.EVENTS.CACHE_HIT, { key });
  }

  private trackCacheMiss(key: string): void {
    this.stats.cacheMisses++;
    this.emit(McpRequestHandler.EVENTS.CACHE_MISS, { key });
  }

  private generateRequestId(): string {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }
}