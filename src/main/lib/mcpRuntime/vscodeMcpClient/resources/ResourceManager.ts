/**
 * VSCode MCP Client - Resource Management System
 * Advanced resource caching, synchronization, and access control
 */

import { EventEmitter } from 'events';
import {
  McpResource,
  ResourceRequest,
  ResourceContent,
} from '../types/mcpTypes';

// ==================== Resource Management Types ====================

export interface ResourceManagerConfig {
  enableCaching: boolean;
  enableSynchronization: boolean;
  enableAccessControl: boolean;
  maxCacheSize: number;
  maxResourceSize: number;
  cacheTtl: number;
  syncIntervalMs: number;
  enableVersioning: boolean;
  enableCompression: boolean;
  enableEncryption: boolean;
}

const DEFAULT_RESOURCE_CONFIG: ResourceManagerConfig = {
  enableCaching: true,
  enableSynchronization: true,
  enableAccessControl: true,
  maxCacheSize: 500,
  maxResourceSize: 100 * 1024 * 1024, // 100MB
  cacheTtl: 30 * 60 * 1000, // 30 minutes
  syncIntervalMs: 5 * 60 * 1000, // 5 minutes
  enableVersioning: true,
  enableCompression: true,
  enableEncryption: false,
};

// ==================== Resource Metadata ====================

export interface ResourceMetadata {
  id: string;
  uri: string;
  name: string;
  serverId: string;
  mimeType?: string;
  size?: number;
  version: string;
  etag?: string;
  lastModified: number;
  lastAccessed: number;
  accessCount: number;
  description?: string;
  tags: string[];
  permissions: ResourcePermissions;
  cached: boolean;
  compressed: boolean;
  encrypted: boolean;
  checksum?: string;
}

export interface ResourcePermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
  allowedUsers?: string[];
  allowedRoles?: string[];
  requiredPermissions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
}

// ==================== Resource Cache Entry ====================

export interface ResourceCacheEntry {
  metadata: ResourceMetadata;
  content: ResourceContent;
  cachedAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  compressed: boolean;
  originalSize?: number;
}

// ==================== Resource Operations ====================

export interface ResourceOperation {
  id: string;
  type: 'read' | 'write' | 'delete' | 'sync' | 'refresh';
  resourceId: string;
  userId?: string;
  timestamp: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  error?: Error;
  result?: any;
  metadata?: Record<string, any>;
}

export interface BulkOperation {
  id: string;
  type: 'bulk_read' | 'bulk_sync' | 'bulk_refresh';
  resourceIds: string[];
  userId?: string;
  timestamp: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  totalResources: number;
  processedResources: number;
  failedResources: string[];
  results: Map<string, any>;
}

// ==================== Events ====================

export interface ResourceManagerEvents {
  resourceRegistered: { resource: ResourceMetadata };
  resourceUnregistered: { resourceId: string };
  resourceCached: { resourceId: string; size: number };
  resourceEvicted: { resourceId: string; reason: string };
  resourceSynced: { resourceId: string; changes: string[] };
  resourceAccessed: { resourceId: string; userId?: string };
  operationStarted: { operation: ResourceOperation };
  operationCompleted: { operation: ResourceOperation };
  bulkOperationProgress: { operation: BulkOperation };
  cacheCleared: { reason: string };
  permissionDenied: { resourceId: string; userId?: string; operation: string };
}

// ==================== Resource Manager Implementation ====================

export class ResourceManager extends EventEmitter {
  private config: ResourceManagerConfig;
  private resources = new Map<string, ResourceMetadata>();
  private cache = new Map<string, ResourceCacheEntry>();
  private operations = new Map<string, ResourceOperation>();
  private bulkOperations = new Map<string, BulkOperation>();
  private syncTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalResources: 0,
    cachedResources: 0,
    totalCacheSize: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalAccesses: 0,
    syncOperations: 0,
    failedOperations: 0,
  };

  public static readonly EVENTS = {
    RESOURCE_REGISTERED: 'resourceRegistered',
    RESOURCE_UNREGISTERED: 'resourceUnregistered',
    RESOURCE_CACHED: 'resourceCached',
    RESOURCE_EVICTED: 'resourceEvicted',
    RESOURCE_SYNCED: 'resourceSynced',
    RESOURCE_ACCESSED: 'resourceAccessed',
    OPERATION_STARTED: 'operationStarted',
    OPERATION_COMPLETED: 'operationCompleted',
    BULK_OPERATION_PROGRESS: 'bulkOperationProgress',
    CACHE_CLEARED: 'cacheCleared',
    PERMISSION_DENIED: 'permissionDenied',
  } as const;

  constructor(config: Partial<ResourceManagerConfig> = {}) {
    super();
    
    this.config = { ...DEFAULT_RESOURCE_CONFIG, ...config };
    
    if (this.config.enableSynchronization) {
      this.startSyncTimer();
    }
    
    this.startCleanupTimer();
  }

  // ==================== Resource Registration ====================

  /**
   * Register a resource from an MCP server
   */
  registerResource(
    resource: McpResource,
    serverId: string,
    options: {
      permissions?: Partial<ResourcePermissions>;
      tags?: string[];
      version?: string;
    } = {}
  ): string {
    const resourceId = this.generateResourceId(resource.uri, serverId);
    
    // Check if resource already exists
    if (this.resources.has(resourceId)) {
      throw new Error(`Resource ${resource.uri} from server ${serverId} already registered`);
    }

    // Create resource metadata
    const metadata: ResourceMetadata = {
      id: resourceId,
      uri: resource.uri,
      name: resource.name,
      serverId,
      mimeType: resource.mimeType,
      version: options.version || '1.0.0',
      lastModified: Date.now(),
      lastAccessed: 0,
      accessCount: 0,
      description: resource.description,
      tags: options.tags || [],
      permissions: {
        read: true,
        write: false,
        delete: false,
        requiredPermissions: [],
        riskLevel: 'low',
        requiresApproval: false,
        ...options.permissions,
      },
      cached: false,
      compressed: false,
      encrypted: false,
    };

    // Register resource
    this.resources.set(resourceId, metadata);
    this.stats.totalResources++;

    this.emit(ResourceManager.EVENTS.RESOURCE_REGISTERED, { resource: metadata });
    return resourceId;
  }

  /**
   * Unregister a resource
   */
  unregisterResource(resourceId: string): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return false;
    }

    // Remove from cache if present
    if (this.cache.has(resourceId)) {
      const cacheEntry = this.cache.get(resourceId)!;
      this.stats.totalCacheSize -= cacheEntry.size;
      this.stats.cachedResources--;
      this.cache.delete(resourceId);
    }

    // Remove from registry
    this.resources.delete(resourceId);
    this.stats.totalResources--;

    this.emit(ResourceManager.EVENTS.RESOURCE_UNREGISTERED, { resourceId });
    return true;
  }

  // ==================== Resource Access ====================

  /**
   * Read a resource with caching and access control
   */
  async readResource(
    resourceId: string,
    options: {
      userId?: string;
      useCache?: boolean;
      forceFresh?: boolean;
    } = {}
  ): Promise<ResourceContent> {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    // Check permissions
    if (!this.checkReadPermission(resource, options.userId)) {
      this.emit(ResourceManager.EVENTS.PERMISSION_DENIED, {
        resourceId,
        userId: options.userId,
        operation: 'read',
      });
      throw new Error(`Permission denied for resource ${resourceId}`);
    }

    // Create operation
    const operation = this.createOperation('read', resourceId, options.userId);
    this.emit(ResourceManager.EVENTS.OPERATION_STARTED, { operation });

    try {
      let content: ResourceContent;

      // Check cache first (unless force fresh)
      if (!options.forceFresh && (options.useCache !== false) && this.config.enableCaching) {
        const cached = this.getCachedResource(resourceId);
        if (cached) {
          this.stats.cacheHits++;
          content = cached;
        } else {
          this.stats.cacheMisses++;
          content = await this.fetchResourceContent(resource);
          
          // Cache the result
          if (this.shouldCache(resource, content)) {
            await this.cacheResource(resourceId, content);
          }
        }
      } else {
        content = await this.fetchResourceContent(resource);
      }

      // Update access statistics
      resource.lastAccessed = Date.now();
      resource.accessCount++;
      this.stats.totalAccesses++;

      this.emit(ResourceManager.EVENTS.RESOURCE_ACCESSED, { resourceId, userId: options.userId });

      operation.status = 'completed';
      operation.result = { size: content.text?.length || content.blob?.length || 0 };
      this.emit(ResourceManager.EVENTS.OPERATION_COMPLETED, { operation });

      return content;

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error : new Error(String(error));
      this.stats.failedOperations++;
      this.emit(ResourceManager.EVENTS.OPERATION_COMPLETED, { operation });
      throw error;
    }
  }

  /**
   * Bulk read multiple resources
   */
  async readMultipleResources(
    resourceIds: string[],
    options: {
      userId?: string;
      useCache?: boolean;
      forceFresh?: boolean;
      maxConcurrency?: number;
    } = {}
  ): Promise<Map<string, ResourceContent>> {
    const bulkOperation = this.createBulkOperation('bulk_read', resourceIds, options.userId);
    this.emit(ResourceManager.EVENTS.BULK_OPERATION_PROGRESS, { operation: bulkOperation });

    const maxConcurrency = options.maxConcurrency || 5;
    const results = new Map<string, ResourceContent>();
    const errors = new Map<string, Error>();

    // Process resources in batches
    for (let i = 0; i < resourceIds.length; i += maxConcurrency) {
      const batch = resourceIds.slice(i, i + maxConcurrency);
      const batchPromises = batch.map(async (resourceId) => {
        try {
          const content = await this.readResource(resourceId, options);
          results.set(resourceId, content);
          bulkOperation.processedResources++;
        } catch (error) {
          errors.set(resourceId, error instanceof Error ? error : new Error(String(error)));
          bulkOperation.failedResources.push(resourceId);
        }
      });

      await Promise.allSettled(batchPromises);
      this.emit(ResourceManager.EVENTS.BULK_OPERATION_PROGRESS, { operation: bulkOperation });
    }

    bulkOperation.status = bulkOperation.failedResources.length === 0 ? 'completed' : 'failed';
    bulkOperation.results = results;

    return results;
  }

  // ==================== Cache Management ====================

  /**
   * Get cached resource content
   */
  private getCachedResource(resourceId: string): ResourceContent | null {
    const cacheEntry = this.cache.get(resourceId);
    if (!cacheEntry) {
      return null;
    }

    // Check expiration
    if (Date.now() > cacheEntry.expiresAt) {
      this.evictFromCache(resourceId, 'expired');
      return null;
    }

    // Update access info
    cacheEntry.lastAccessed = Date.now();
    cacheEntry.accessCount++;

    return cacheEntry.content;
  }

  /**
   * Cache a resource
   */
  private async cacheResource(resourceId: string, content: ResourceContent): Promise<void> {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return;
    }

    const size = this.calculateContentSize(content);
    
    // Check size limits
    if (size > this.config.maxResourceSize) {
      return; // Don't cache oversized resources
    }

    // Ensure cache capacity
    await this.ensureCacheCapacity(size);

    // Create cache entry
    const cacheEntry: ResourceCacheEntry = {
      metadata: { ...resource },
      content: { ...content },
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.config.cacheTtl,
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
      compressed: false,
      originalSize: size,
    };

    // Apply compression if enabled
    if (this.config.enableCompression && size > 1024) {
      try {
        cacheEntry.content = await this.compressContent(content);
        cacheEntry.compressed = true;
        cacheEntry.size = this.calculateContentSize(cacheEntry.content);
      } catch (error) {
        // Compression failed, use original
      }
    }

    this.cache.set(resourceId, cacheEntry);
    this.stats.cachedResources++;
    this.stats.totalCacheSize += cacheEntry.size;
    resource.cached = true;

    this.emit(ResourceManager.EVENTS.RESOURCE_CACHED, { resourceId, size: cacheEntry.size });
  }

  /**
   * Ensure cache has capacity for new entry
   */
  private async ensureCacheCapacity(requiredSize: number): Promise<void> {
    const maxCacheSize = this.config.maxCacheSize;
    
    // Check entry count limit
    while (this.cache.size >= maxCacheSize) {
      const lruEntry = this.findLRUEntry();
      if (lruEntry) {
        this.evictFromCache(lruEntry, 'capacity');
      } else {
        break;
      }
    }

    // Could add memory-based eviction here if needed
  }

  /**
   * Find least recently used cache entry
   */
  private findLRUEntry(): string | null {
    let lruKey: string | null = null;
    let lruTime = Date.now();

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    return lruKey;
  }

  /**
   * Evict resource from cache
   */
  private evictFromCache(resourceId: string, reason: string): void {
    const cacheEntry = this.cache.get(resourceId);
    if (!cacheEntry) {
      return;
    }

    this.cache.delete(resourceId);
    this.stats.cachedResources--;
    this.stats.totalCacheSize -= cacheEntry.size;

    const resource = this.resources.get(resourceId);
    if (resource) {
      resource.cached = false;
    }

    this.emit(ResourceManager.EVENTS.RESOURCE_EVICTED, { resourceId, reason });
  }

  /**
   * Clear entire cache
   */
  clearCache(reason: string = 'manual'): void {
    for (const resourceId of Array.from(this.cache.keys())) {
      const resource = this.resources.get(resourceId);
      if (resource) {
        resource.cached = false;
      }
    }

    this.cache.clear();
    this.stats.cachedResources = 0;
    this.stats.totalCacheSize = 0;

    this.emit(ResourceManager.EVENTS.CACHE_CLEARED, { reason });
  }

  // ==================== Synchronization ====================

  /**
   * Synchronize resources with servers
   */
  async syncResources(resourceIds?: string[]): Promise<void> {
    const resourcesToSync = resourceIds 
      ? resourceIds.map(id => this.resources.get(id)).filter(Boolean) as ResourceMetadata[]
      : Array.from(this.resources.values());

    for (const resource of resourcesToSync) {
      try {
        await this.syncSingleResource(resource);
      } catch (error) {
      }
    }

    this.stats.syncOperations++;
  }

  /**
   * Sync a single resource
   */
  private async syncSingleResource(resource: ResourceMetadata): Promise<void> {
    // In a real implementation, this would check with the server for updates
    // For now, we'll just mark it as synced
    const changes: string[] = [];
    
    // Mock sync logic - would compare versions, checksums, etc.
    const now = Date.now();
    if (now - resource.lastModified > this.config.syncIntervalMs) {
      changes.push('metadata');
      resource.lastModified = now;
    }

    if (changes.length > 0) {
      this.emit(ResourceManager.EVENTS.RESOURCE_SYNCED, { 
        resourceId: resource.id, 
        changes 
      });

      // Invalidate cache if resource changed
      if (this.cache.has(resource.id)) {
        this.evictFromCache(resource.id, 'sync_update');
      }
    }
  }

  // ==================== Resource Discovery ====================

  /**
   * List resources with filtering
   */
  listResources(filters: {
    serverId?: string;
    mimeType?: string;
    tags?: string[];
    cached?: boolean;
    permissions?: string[];
  } = {}): ResourceMetadata[] {
    const resources = Array.from(this.resources.values());
    
    return resources.filter(resource => {
      if (filters.serverId && resource.serverId !== filters.serverId) return false;
      if (filters.mimeType && resource.mimeType !== filters.mimeType) return false;
      if (filters.cached !== undefined && resource.cached !== filters.cached) return false;
      
      if (filters.tags && filters.tags.length > 0) {
        const hasAllTags = filters.tags.every(tag => resource.tags.includes(tag));
        if (!hasAllTags) return false;
      }
      
      if (filters.permissions && filters.permissions.length > 0) {
        const hasAllPermissions = filters.permissions.every(perm => 
          resource.permissions.requiredPermissions.includes(perm)
        );
        if (!hasAllPermissions) return false;
      }
      
      return true;
    });
  }

  /**
   * Search resources by name or URI
   */
  searchResources(query: string): ResourceMetadata[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.resources.values()).filter(resource => 
      resource.name.toLowerCase().includes(lowerQuery) ||
      resource.uri.toLowerCase().includes(lowerQuery) ||
      (resource.description && resource.description.toLowerCase().includes(lowerQuery)) ||
      resource.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  // ==================== Private Helper Methods ====================

  private async fetchResourceContent(resource: ResourceMetadata): Promise<ResourceContent> {
    // Mock implementation - in real version, this would fetch from the server
    return {
      uri: resource.uri,
      mimeType: resource.mimeType,
      text: `Mock content for ${resource.name}`,
    };
  }

  private checkReadPermission(resource: ResourceMetadata, userId?: string): boolean {
    if (!this.config.enableAccessControl) {
      return true;
    }

    const permissions = resource.permissions;
    
    if (!permissions.read) {
      return false;
    }

    if (userId && permissions.allowedUsers && !permissions.allowedUsers.includes(userId)) {
      return false;
    }

    return true;
  }

  private shouldCache(resource: ResourceMetadata, content: ResourceContent): boolean {
    if (!this.config.enableCaching) {
      return false;
    }

    const size = this.calculateContentSize(content);
    return size <= this.config.maxResourceSize;
  }

  private calculateContentSize(content: ResourceContent): number {
    return (content.text?.length || 0) + (content.blob?.length || 0);
  }

  private async compressContent(content: ResourceContent): Promise<ResourceContent> {
    // Mock compression - in real implementation, would use zlib or similar
    return {
      ...content,
      text: content.text ? `compressed:${content.text}` : undefined,
    };
  }

  private createOperation(
    type: ResourceOperation['type'],
    resourceId: string,
    userId?: string
  ): ResourceOperation {
    const operation: ResourceOperation = {
      id: this.generateOperationId(),
      type,
      resourceId,
      userId,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.operations.set(operation.id, operation);
    return operation;
  }

  private createBulkOperation(
    type: BulkOperation['type'],
    resourceIds: string[],
    userId?: string
  ): BulkOperation {
    const operation: BulkOperation = {
      id: this.generateOperationId(),
      type,
      resourceIds,
      userId,
      timestamp: Date.now(),
      status: 'pending',
      totalResources: resourceIds.length,
      processedResources: 0,
      failedResources: [],
      results: new Map(),
    };

    this.bulkOperations.set(operation.id, operation);
    return operation;
  }

  private generateResourceId(uri: string, serverId: string): string {
    return `${serverId}:${Buffer.from(uri).toString('base64').slice(0, 16)}`;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      this.syncResources().catch(error => {
      });
    }, this.config.syncIntervalMs);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
      this.cleanupCompletedOperations();
    }, 5 * 60 * 1000); // 5 minutes
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.evictFromCache(key, 'expired');
    }
  }

  private cleanupCompletedOperations(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

    for (const [id, op] of Array.from(this.operations.entries())) {
      if (op.timestamp < cutoff && (op.status === 'completed' || op.status === 'failed')) {
        this.operations.delete(id);
      }
    }

    for (const [id, op] of Array.from(this.bulkOperations.entries())) {
      if (op.timestamp < cutoff && (op.status === 'completed' || op.status === 'failed')) {
        this.bulkOperations.delete(id);
      }
    }
  }

  // ==================== Statistics and Info ====================

  getStats(): typeof this.stats & {
    cacheInfo: {
      hitRate: number;
      entries: number;
      totalSize: number;
      averageEntrySize: number;
    };
    operations: {
      active: number;
      completed: number;
      failed: number;
    };
  } {
    const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0 
      ? this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)
      : 0;

    const averageEntrySize = this.stats.cachedResources > 0 
      ? this.stats.totalCacheSize / this.stats.cachedResources 
      : 0;

    const activeOps = Array.from(this.operations.values())
      .filter(op => op.status === 'pending' || op.status === 'in_progress').length;
    
    const completedOps = Array.from(this.operations.values())
      .filter(op => op.status === 'completed').length;
    
    const failedOps = Array.from(this.operations.values())
      .filter(op => op.status === 'failed').length;

    return {
      ...this.stats,
      cacheInfo: {
        hitRate,
        entries: this.cache.size,
        totalSize: this.stats.totalCacheSize,
        averageEntrySize,
      },
      operations: {
        active: activeOps,
        completed: completedOps,
        failed: failedOps,
      },
    };
  }

  // ==================== Disposal ====================

  dispose(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.clearCache('disposal');
    this.resources.clear();
    this.operations.clear();
    this.bulkOperations.clear();
    this.removeAllListeners();
  }
}