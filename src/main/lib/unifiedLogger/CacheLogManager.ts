/**
 * Unified Logger System - Cache Log Manager (Singleton)
 *
 * Class CacheLog - Responsible for managing the caching of log entries
 */

import { UnifiedLoggerConfig } from './types';
import { CacheObject } from './CacheObject';
import { PendingLogQueue } from './PendingLogQueue';
import { PendingSaveQueue } from './PendingSaveQueue';

export class CacheLogManager {
  private static instance: CacheLogManager;
  private currentCacheObject: CacheObject; // Global cache object variable a
  private pendingLogQueue: PendingLogQueue;
  private pendingSaveQueue: PendingSaveQueue;
  private saveLogManager: any; // Will be set via dependency injection
  private maxCapacity: number; // Obtained from environment variable
  private config: UnifiedLoggerConfig;

  private constructor(config: UnifiedLoggerConfig, pendingLogQueue: PendingLogQueue) {
    this.config = config;
    this.maxCapacity = config.LOGGER_CACHE_MAX_SIZE;
    this.pendingLogQueue = pendingLogQueue;
    this.pendingSaveQueue = new PendingSaveQueue();
    
    // Initialize an empty cache object A
    this.currentCacheObject = new CacheObject(this.maxCapacity);
  }

  /**
   * Get singleton instance
   * @param config - Configuration object (only used during first creation)
   * @param pendingLogQueue - Pending cache log queue (only used during first creation)
   * @returns CacheLogManager instance
   */
  public static getInstance(config?: UnifiedLoggerConfig, pendingLogQueue?: PendingLogQueue): CacheLogManager {
    if (!CacheLogManager.instance) {
      if (!config || !pendingLogQueue) {
        throw new Error('Configuration and pending log queue are required for first-time initialization');
      }
      CacheLogManager.instance = new CacheLogManager(config, pendingLogQueue);
    }
    return CacheLogManager.instance;
  }

  /**
   * Set reference to the save log manager (dependency injection)
   * @param saveLogManager - SaveLogManager instance
   */
  public setSaveLogManager(saveLogManager: any): void {
    this.saveLogManager = saveLogManager;
  }

  /**
   * Get reference to the pending save queue
   * @returns PendingSaveQueue instance
   */
  public getPendingSaveQueue(): PendingSaveQueue {
    return this.pendingSaveQueue;
  }

  /**
   * Receive notification from AddLog, triggering the cache log method
   */
  public notifyNewLogAdded(): void {
    try {
      this.cacheLogEntries();
    } catch (error) {
    }
  }

  /**
   * Core caching logic
   */
  private cacheLogEntries(): void {
    // While(cache object a.Length is less than max capacity && pending cache log queue is not empty)
    while (!this.currentCacheObject.isFull() && !this.pendingLogQueue.isEmpty()) {
      // Sequentially dequeue logEntry from cache log queue and store in a
      const logEntry = this.pendingLogQueue.dequeue();
      if (logEntry) {
        const added = this.currentCacheObject.addLog(logEntry);
        if (!added) {
          // If addition fails, re-enqueue the log
          this.pendingLogQueue.enqueue(logEntry);
          break;
        }
      }
    }

    // If a reaches the preset maximum capacity
    if (this.currentCacheObject.isFull()) {
      // Add a to the pending save queue
      this.pendingSaveQueue.enqueue(this.currentCacheObject);

      // a = new CacheObject B
      this.currentCacheObject = new CacheObject(this.maxCapacity);

      // Notify SaveLog that there are objects pending save
      if (this.saveLogManager && typeof this.saveLogManager.notifyPendingSaveAvailable === 'function') {
        this.saveLogManager.notifyPendingSaveAvailable();
      }
    }
  }

  /**
   * Manually trigger flush (for "logs to disk" and app shutdown)
   */
  public forceFlush(): void {
    try {
      // Manually add cache objects that "have not reached capacity && are non-empty" to the pending save queue
      if (!this.currentCacheObject.isEmpty()) {
        this.pendingSaveQueue.enqueue(this.currentCacheObject);
        this.currentCacheObject = new CacheObject(this.maxCapacity);

        // Stop caching, notify SaveLog
        if (this.saveLogManager && typeof this.saveLogManager.notifyPendingSaveAvailable === 'function') {
          this.saveLogManager.notifyPendingSaveAvailable();
        }
      }
    } catch (error) {
    }
  }

  /**
   * Get current active cache object information
   * @returns Current cache object statistics
   */
  public getCurrentCacheObjectInfo(): ReturnType<CacheObject['getStats']> {
    return this.currentCacheObject.getStats();
  }

  /**
   * Get statistics
   * @returns Statistics object
   */
  public getStats(): {
    currentCacheObjectSize: number;
    currentCacheObjectCapacity: number;
    currentCacheObjectUtilization: number;
    pendingSaveQueueSize: number;
    pendingSaveQueueStats: ReturnType<PendingSaveQueue['getStats']>;
    totalCachedObjects: number;
    maxCapacity: number;
  } {
    const currentStats = this.currentCacheObject.getStats();
    const saveQueueStats = this.pendingSaveQueue.getStats();

    return {
      currentCacheObjectSize: currentStats.currentSize,
      currentCacheObjectCapacity: currentStats.maxCapacity,
      currentCacheObjectUtilization: currentStats.utilization,
      pendingSaveQueueSize: this.pendingSaveQueue.size(),
      pendingSaveQueueStats: saveQueueStats,
      totalCachedObjects: this.pendingSaveQueue.size() + (this.currentCacheObject.isEmpty() ? 0 : 1),
      maxCapacity: this.maxCapacity
    };
  }

  /**
   * Update configuration
   * @param newConfig - New configuration object
   */
  public updateConfig(newConfig: Partial<UnifiedLoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // If max capacity changed, need to create a new cache object
    if (newConfig.LOGGER_CACHE_MAX_SIZE && newConfig.LOGGER_CACHE_MAX_SIZE !== this.maxCapacity) {
      this.maxCapacity = newConfig.LOGGER_CACHE_MAX_SIZE;
      
      // If current cache object is not empty, move it to the pending save queue first
      if (!this.currentCacheObject.isEmpty()) {
        this.pendingSaveQueue.enqueue(this.currentCacheObject);
      }
      
      // Create new cache object
      this.currentCacheObject = new CacheObject(this.maxCapacity);
      
      // Notify save manager
      if (this.saveLogManager && typeof this.saveLogManager.notifyPendingSaveAvailable === 'function') {
        this.saveLogManager.notifyPendingSaveAvailable();
      }
    }
  }

  /**
   * Get current configuration
   * @returns Current configuration object
   */
  public getConfig(): UnifiedLoggerConfig {
    return { ...this.config };
  }

  /**
   * Clear all caches (use with caution)
   */
  public clearAllCaches(): void {
    this.currentCacheObject.clear();
    this.pendingSaveQueue.clear();
  }

  /**
   * Get detailed information of the pending save queue (for debugging)
   * @returns Queue detailed information
   */
  public getPendingSaveQueueInfo(): ReturnType<PendingSaveQueue['getDetailedInfo']> {
    return this.pendingSaveQueue.getDetailedInfo();
  }

  /**
   * Validate CacheLogManager integrity
   * @returns Validation result
   */
  public validateIntegrity(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.currentCacheObject) {
      errors.push('Current cache object is not initialized');
    } else {
      const cacheValidation = this.currentCacheObject.validateIntegrity();
      if (!cacheValidation.isValid) {
        errors.push(`Current cache object validation failed: ${cacheValidation.errors.join(', ')}`);
      }
    }

    if (!this.pendingSaveQueue) {
      errors.push('Pending save queue is not initialized');
    } else {
      const queueValidation = this.pendingSaveQueue.validateIntegrity();
      if (!queueValidation.isValid) {
        errors.push(`Pending save queue validation failed: ${queueValidation.errors.join(', ')}`);
      }
    }

    if (!this.pendingLogQueue) {
      errors.push('Pending log queue reference is not set');
    }

    if (!this.config) {
      errors.push('Configuration is not set');
    }

    if (typeof this.maxCapacity !== 'number' || this.maxCapacity <= 0) {
      errors.push('Invalid max capacity');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get detailed debug information
   * @returns Detailed debug information
   */
  public getDetailedInfo(): {
    currentCacheObject: ReturnType<CacheObject['getStats']>;
    pendingSaveQueue: ReturnType<PendingSaveQueue['getDetailedInfo']>;
    stats: ReturnType<CacheLogManager['getStats']>;
    validation: ReturnType<CacheLogManager['validateIntegrity']>;
  } {
    return {
      currentCacheObject: this.getCurrentCacheObjectInfo(),
      pendingSaveQueue: this.getPendingSaveQueueInfo(),
      stats: this.getStats(),
      validation: this.validateIntegrity()
    };
  }

  /**
   * Reset singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    CacheLogManager.instance = undefined as any;
  }

  /**
   * Check if initialized
   * @returns Whether it is initialized
   */
  public static isInitialized(): boolean {
    return CacheLogManager.instance !== undefined;
  }
}