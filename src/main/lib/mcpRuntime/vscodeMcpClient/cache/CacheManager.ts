/**
 * VSCode MCP Client - Intelligent Cache Manager
 * LRU cache with TTL, smart invalidation, and memory management
 */

import { EventEmitter } from 'events';
import { CacheEntry, CacheStats } from '../types/mcpTypes';

// ==================== Cache Configuration ====================

export interface CacheConfig {
  maxSize: number;
  defaultTtl: number;
  maxMemoryMB: number;
  cleanupIntervalMs: number;
  enableCompression: boolean;
  persistToDisk: boolean;
  diskCachePath?: string;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 1000,
  defaultTtl: 5 * 60 * 1000, // 5 minutes
  maxMemoryMB: 50,
  cleanupIntervalMs: 60 * 1000, // 1 minute
  enableCompression: false,
  persistToDisk: false,
};

// ==================== Cache Key Types ====================

export type CacheKeyType = 
  | 'tools'
  | 'resources'
  | 'prompts'
  | 'resource-content'
  | 'tool-result'
  | 'server-info';

export interface CacheKey {
  type: CacheKeyType;
  serverId: string;
  identifier: string;
  version?: string;
  nonce?: string;
}

// ==================== LRU Node ====================

class LRUNode<T> {
  public key: string;
  public value: CacheEntry<T>;
  public prev: LRUNode<T> | null = null;
  public next: LRUNode<T> | null = null;
  public memorySize: number;

  constructor(key: string, value: CacheEntry<T>, memorySize: number) {
    this.key = key;
    this.value = value;
    this.memorySize = memorySize;
  }
}

// ==================== Smart Cache Manager ====================

export class CacheManager extends EventEmitter {
  private config: CacheConfig;
  private cache = new Map<string, LRUNode<any>>();
  private head: LRUNode<any> | null = null;
  private tail: LRUNode<any> | null = null;
  private currentMemoryBytes = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    entries: 0,
    memoryUsage: 0,
  };

  // Events
  public static readonly EVENTS = {
    CACHE_HIT: 'cacheHit',
    CACHE_MISS: 'cacheMiss',
    CACHE_EVICTED: 'cacheEvicted',
    CACHE_CLEARED: 'cacheCleared',
    MEMORY_WARNING: 'memoryWarning',
  } as const;

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.startCleanupTimer();
  }

  // ==================== Core Cache Operations ====================

  /**
   * Get value from cache
   */
  get<T>(cacheKey: CacheKey): T | null {
    const key = this.buildKey(cacheKey);
    const node = this.cache.get(key);

    if (!node) {
      this.stats.misses++;
      this.emit(CacheManager.EVENTS.CACHE_MISS, { key: cacheKey });
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now > node.value.timestamp + node.value.ttl) {
      this.delete(cacheKey);
      this.stats.misses++;
      this.emit(CacheManager.EVENTS.CACHE_MISS, { key: cacheKey, reason: 'expired' });
      return null;
    }

    // Move to head (most recently used)
    this.moveToHead(node);
    this.stats.hits++;
    this.emit(CacheManager.EVENTS.CACHE_HIT, { key: cacheKey });

    return node.value.value;
  }

  /**
   * Set value in cache
   */
  set<T>(cacheKey: CacheKey, value: T, ttl?: number): void {
    const key = this.buildKey(cacheKey);
    const effectiveTtl = ttl || this.config.defaultTtl;
    const memorySize = this.calculateMemorySize(value);

    // Check if we need to make room
    this.ensureCapacity(memorySize);

    const cacheEntry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: effectiveTtl,
      nonce: cacheKey.nonce,
    };

    const existingNode = this.cache.get(key);
    if (existingNode) {
      // Update existing entry
      this.currentMemoryBytes -= existingNode.memorySize;
      existingNode.value = cacheEntry;
      existingNode.memorySize = memorySize;
      this.currentMemoryBytes += memorySize;
      this.moveToHead(existingNode);
    } else {
      // Add new entry
      const newNode = new LRUNode(key, cacheEntry, memorySize);
      this.cache.set(key, newNode);
      this.addToHead(newNode);
      this.currentMemoryBytes += memorySize;
      this.stats.entries++;
    }

    this.updateStats();
  }

  /**
   * Delete value from cache
   */
  delete(cacheKey: CacheKey): boolean {
    const key = this.buildKey(cacheKey);
    const node = this.cache.get(key);

    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.cache.delete(key);
    this.currentMemoryBytes -= node.memorySize;
    this.stats.entries--;
    this.updateStats();

    return true;
  }

  /**
   * Check if key exists in cache
   */
  has(cacheKey: CacheKey): boolean {
    const key = this.buildKey(cacheKey);
    const node = this.cache.get(key);

    if (!node) {
      return false;
    }

    // Check TTL
    const now = Date.now();
    if (now > node.value.timestamp + node.value.ttl) {
      this.delete(cacheKey);
      return false;
    }

    return true;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentMemoryBytes = 0;
    this.stats.entries = 0;
    this.updateStats();
    this.emit(CacheManager.EVENTS.CACHE_CLEARED);
  }

  // ==================== Smart Invalidation ====================

  /**
   * Invalidate cache entries by pattern
   */
  invalidateByPattern(pattern: Partial<CacheKey>): number {
    let invalidated = 0;
    const keysToDelete: string[] = [];

    for (const [key, node] of Array.from(this.cache.entries())) {
      const parsedKey = this.parseKey(key);
      if (this.matchesPattern(parsedKey, pattern)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const node = this.cache.get(key);
      if (node) {
        this.removeNode(node);
        this.cache.delete(key);
        this.currentMemoryBytes -= node.memorySize;
        this.stats.entries--;
        invalidated++;
      }
    }

    this.updateStats();
    return invalidated;
  }

  /**
   * Invalidate all cache entries for a server
   */
  invalidateServer(serverId: string): number {
    return this.invalidateByPattern({ serverId });
  }

  /**
   * Invalidate cache entries by type
   */
  invalidateByType(type: CacheKeyType, serverId?: string): number {
    const pattern: Partial<CacheKey> = { type };
    if (serverId) {
      pattern.serverId = serverId;
    }
    return this.invalidateByPattern(pattern);
  }

  // ==================== Memory Management ====================

  /**
   * Ensure we have capacity for new entry
   */
  private ensureCapacity(requiredBytes: number): void {
    const maxBytes = this.config.maxMemoryMB * 1024 * 1024;

    // Check size limit
    while (this.stats.entries >= this.config.maxSize) {
      this.evictLRU();
    }

    // Check memory limit
    while (this.currentMemoryBytes + requiredBytes > maxBytes) {
      if (!this.evictLRU()) {
        break; // No more entries to evict
      }
    }

    // Emit warning if still over memory limit
    if (this.currentMemoryBytes + requiredBytes > maxBytes * 0.9) {
      this.emit(CacheManager.EVENTS.MEMORY_WARNING, {
        currentMB: this.currentMemoryBytes / (1024 * 1024),
        maxMB: this.config.maxMemoryMB,
      });
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): boolean {
    if (!this.tail) {
      return false;
    }

    const evictedKey = this.parseKey(this.tail.key);
    this.removeNode(this.tail);
    this.cache.delete(this.tail.key);
    this.currentMemoryBytes -= this.tail.memorySize;
    this.stats.entries--;

    this.emit(CacheManager.EVENTS.CACHE_EVICTED, { key: evictedKey });
    return true;
  }

  /**
   * Calculate memory size of value
   */
  private calculateMemorySize(value: any): number {
    // Simple approximation - could be improved with more accurate calculation
    const json = JSON.stringify(value);
    return json.length * 2; // Rough estimate for UTF-16
  }

  // ==================== LRU List Operations ====================

  private addToHead(node: LRUNode<any>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<any>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LRUNode<any>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  // ==================== Key Management ====================

  private buildKey(cacheKey: CacheKey): string {
    const parts = [
      cacheKey.type,
      cacheKey.serverId,
      cacheKey.identifier,
    ];

    if (cacheKey.version) {
      parts.push(`v:${cacheKey.version}`);
    }

    if (cacheKey.nonce) {
      parts.push(`n:${cacheKey.nonce}`);
    }

    return parts.join('|');
  }

  private parseKey(key: string): CacheKey {
    const parts = key.split('|');
    const parsed: CacheKey = {
      type: parts[0] as CacheKeyType,
      serverId: parts[1],
      identifier: parts[2],
    };

    for (let i = 3; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('v:')) {
        parsed.version = part.substring(2);
      } else if (part.startsWith('n:')) {
        parsed.nonce = part.substring(2);
      }
    }

    return parsed;
  }

  private matchesPattern(key: CacheKey, pattern: Partial<CacheKey>): boolean {
    if (pattern.type && key.type !== pattern.type) return false;
    if (pattern.serverId && key.serverId !== pattern.serverId) return false;
    if (pattern.identifier && key.identifier !== pattern.identifier) return false;
    if (pattern.version && key.version !== pattern.version) return false;
    if (pattern.nonce && key.nonce !== pattern.nonce) return false;
    return true;
  }

  // ==================== Cleanup and Maintenance ====================

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, node] of Array.from(this.cache.entries())) {
      if (now > node.value.timestamp + node.value.ttl) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const node = this.cache.get(key);
      if (node) {
        this.removeNode(node);
        this.cache.delete(key);
        this.currentMemoryBytes -= node.memorySize;
        this.stats.entries--;
      }
    }

    if (expiredKeys.length > 0) {
      this.updateStats();
    }
  }

  // ==================== Statistics and Info ====================

  private updateStats(): void {
    this.stats.memoryUsage = this.currentMemoryBytes;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getInfo(): {
    config: CacheConfig;
    stats: CacheStats;
    memoryUsageMB: number;
    fillRatio: number;
  } {
    return {
      config: { ...this.config },
      stats: this.getStats(),
      memoryUsageMB: this.currentMemoryBytes / (1024 * 1024),
      fillRatio: this.stats.entries / this.config.maxSize,
    };
  }

  // ==================== Disposal ====================

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.clear();
    this.removeAllListeners();
  }
}