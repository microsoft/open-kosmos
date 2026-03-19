/**
 * Memory usage optimization and garbage collection utilities for streaming
 */

export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  utilizationPercent: number;
  isMemoryPressure: boolean;
}

export interface OptimizationConfig {
  gcThreshold: number; // Percentage of heap utilization to trigger GC
  maxContentLength: number; // Maximum content length to keep in memory
  chunkRetentionTime: number; // How long to keep processed chunks (ms)
  enableAutoGC: boolean;
  memoryCheckInterval: number;
}

export interface ContentCache {
  id: string;
  content: string;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  size: number;
}

/**
 * Memory optimizer for streaming content
 */
export class MemoryOptimizer {
  private config: OptimizationConfig;
  private contentCache: Map<string, ContentCache> = new Map();
  private memoryCheckTimer: NodeJS.Timeout | null = null;
  private onMemoryPressureCallback?: () => void;
  private lastGCTime: number = 0;

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = {
      gcThreshold: 80, // 80% heap utilization
      maxContentLength: 100000, // 100KB per content item
      chunkRetentionTime: 30000, // 30 seconds
      enableAutoGC: true,
      memoryCheckInterval: 5000, // Check every 5 seconds
      ...config
    };

    if (this.config.enableAutoGC) {
      this.startMemoryMonitoring();
    }
  }

  /**
   * Get current memory metrics
   */
  getMemoryMetrics(): MemoryMetrics | null {
    if (!(performance as any).memory) {
      return null; // Memory API not available
    }

    const memory = (performance as any).memory;
    const utilizationPercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      utilizationPercent,
      isMemoryPressure: utilizationPercent > this.config.gcThreshold
    };
  }

  /**
   * Store content in optimized cache
   */
  cacheContent(id: string, content: string): void {
    // Don't cache if content is too large
    if (content.length > this.config.maxContentLength) {
      this.evictOldestContent();
      return;
    }

    const now = Date.now();
    const existingCache = this.contentCache.get(id);

    if (existingCache) {
      // Update existing cache
      existingCache.content = content;
      existingCache.lastAccess = now;
      existingCache.accessCount++;
      existingCache.size = this.estimateStringSize(content);
    } else {
      // Create new cache entry
      this.contentCache.set(id, {
        id,
        content,
        timestamp: now,
        accessCount: 1,
        lastAccess: now,
        size: this.estimateStringSize(content)
      });
    }

    // Check if we need to clean up
    this.cleanupExpiredContent();
  }

  /**
   * Retrieve content from cache
   */
  getCachedContent(id: string): string | null {
    const cached = this.contentCache.get(id);
    if (!cached) return null;

    // Update access metrics
    cached.lastAccess = Date.now();
    cached.accessCount++;

    return cached.content;
  }

  /**
   * Remove content from cache
   */
  evictContent(id: string): boolean {
    return this.contentCache.delete(id);
  }

  /**
   * Force garbage collection and cleanup
   */
  forceCleanup(): void {
    this.cleanupExpiredContent();
    this.evictLowPriorityContent();
    
    // Request browser GC if available
    if ((window as any).gc) {
      (window as any).gc();
    }
    
    this.lastGCTime = Date.now();
  }

  /**
   * Set callback for memory pressure events
   */
  onMemoryPressure(callback: () => void): void {
    this.onMemoryPressureCallback = callback;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (this.config.enableAutoGC && !this.memoryCheckTimer) {
      this.startMemoryMonitoring();
    } else if (!this.config.enableAutoGC && this.memoryCheckTimer) {
      this.stopMemoryMonitoring();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalItems: number;
    totalSize: number;
    averageSize: number;
    oldestItem: number;
    mostAccessed: number;
  } {
    const items = Array.from(this.contentCache.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    const averageSize = items.length > 0 ? totalSize / items.length : 0;
    const oldestItem = items.length > 0 ? Math.min(...items.map(item => item.timestamp)) : 0;
    const mostAccessed = items.length > 0 ? Math.max(...items.map(item => item.accessCount)) : 0;

    return {
      totalItems: items.length,
      totalSize,
      averageSize,
      oldestItem,
      mostAccessed
    };
  }

  /**
   * Destroy optimizer and cleanup resources
   */
  destroy(): void {
    this.stopMemoryMonitoring();
    this.contentCache.clear();
    this.onMemoryPressureCallback = undefined;
  }

  /**
   * Private methods
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.memoryCheckInterval);
  }

  private stopMemoryMonitoring(): void {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = null;
    }
  }

  private checkMemoryUsage(): void {
    const metrics = this.getMemoryMetrics();
    if (!metrics) return;

    if (metrics.isMemoryPressure) {
      // Trigger cleanup
      this.forceCleanup();
      
      // Notify callback
      if (this.onMemoryPressureCallback) {
        this.onMemoryPressureCallback();
      }
    }
  }

  private cleanupExpiredContent(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, cached] of this.contentCache) {
      if (now - cached.timestamp > this.config.chunkRetentionTime) {
        expiredIds.push(id);
      }
    }

    expiredIds.forEach(id => this.contentCache.delete(id));
  }

  private evictOldestContent(): void {
    if (this.contentCache.size === 0) return;

    let oldestId = '';
    let oldestTime = Date.now();

    for (const [id, cached] of this.contentCache) {
      if (cached.timestamp < oldestTime) {
        oldestTime = cached.timestamp;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.contentCache.delete(oldestId);
    }
  }

  private evictLowPriorityContent(): void {
    // Sort by access frequency and last access time
    const items = Array.from(this.contentCache.entries())
      .sort(([, a], [, b]) => {
        const aScore = a.accessCount / (Date.now() - a.lastAccess);
        const bScore = b.accessCount / (Date.now() - b.lastAccess);
        return aScore - bScore; // Lower score = lower priority
      });

    // Remove bottom 25% of content
    const removeCount = Math.ceil(items.length * 0.25);
    const toRemove = items.slice(0, removeCount);

    toRemove.forEach(([id]) => this.contentCache.delete(id));
  }

  private estimateStringSize(str: string): number {
    // Rough estimation: 2 bytes per character (UTF-16)
    return str.length * 2;
  }
}

/**
 * Adaptive streaming rate controller with memory awareness
 */
export class AdaptiveStreamingController {
  private memoryOptimizer: MemoryOptimizer;
  private baseDelay: number = 16; // ~60fps
  private currentDelay: number = 16;
  private adaptationFactor: number = 1.0;
  private lastAdaptation: number = Date.now();

  constructor(memoryOptimizer: MemoryOptimizer) {
    this.memoryOptimizer = memoryOptimizer;
    
    // React to memory pressure
    this.memoryOptimizer.onMemoryPressure(() => {
      this.handleMemoryPressure();
    });
  }

  /**
   * Get current streaming delay with adaptive adjustment
   */
  getAdaptiveDelay(): number {
    const metrics = this.memoryOptimizer.getMemoryMetrics();
    
    if (metrics) {
      // Adjust delay based on memory pressure
      const memoryFactor = Math.max(1, metrics.utilizationPercent / 50);
      this.currentDelay = this.baseDelay * this.adaptationFactor * memoryFactor;
    }

    return Math.min(this.currentDelay, 100); // Cap at 100ms (10fps)
  }

  /**
   * Update base configuration
   */
  updateConfig(baseDelay: number): void {
    this.baseDelay = baseDelay;
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): {
    baseDelay: number;
    currentDelay: number;
    adaptationFactor: number;
    memoryMetrics: MemoryMetrics | null;
  } {
    return {
      baseDelay: this.baseDelay,
      currentDelay: this.currentDelay,
      adaptationFactor: this.adaptationFactor,
      memoryMetrics: this.memoryOptimizer.getMemoryMetrics()
    };
  }

  private handleMemoryPressure(): void {
    // Slow down streaming to reduce memory pressure
    this.adaptationFactor = Math.min(this.adaptationFactor * 1.5, 3.0);
    this.lastAdaptation = Date.now();
  }

  /**
   * Reset adaptation factor gradually
   */
  resetAdaptation(): void {
    if (Date.now() - this.lastAdaptation > 5000) { // 5 seconds cooldown
      this.adaptationFactor = Math.max(this.adaptationFactor * 0.9, 1.0);
    }
  }
}

// Export singleton instances
export const memoryOptimizer = new MemoryOptimizer();
export const adaptiveController = new AdaptiveStreamingController(memoryOptimizer);