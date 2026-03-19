/**
 * Refactored Logger System - Pending Save Queue
 * 
 * Queue for storing cache objects that are waiting to be saved to disk
 */

import { CacheObject } from './CacheObject';

export class PendingSaveQueue {
  private queue: CacheObject[] = [];

  /**
   * Add a cache object pending save
   * @param cacheObject - Cache object to add to the save queue
   */
  enqueue(cacheObject: CacheObject): void {
    this.queue.push(cacheObject);
  }

  /**
   * Get the next cache object pending save (FIFO - First In First Out)
   * @returns The first cache object in the queue, or null if the queue is empty
   */
  dequeue(): CacheObject | null {
    if (this.isEmpty()) {
      return null;
    }
    return this.queue.shift() || null;
  }

  /**
   * Check if there are objects pending save
   * @returns Whether the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue length
   * @returns Number of cache objects in the queue
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Peek at the cache object at the head of the queue without removing it
   * @returns The cache object at the head of the queue, or null if the queue is empty
   */
  peek(): CacheObject | null {
    if (this.isEmpty()) {
      return null;
    }
    return this.queue[0];
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get queue statistics
   * @returns Queue statistics
   */
  getStats(): {
    size: number;
    isEmpty: boolean;
    totalLogs: number;
    totalMemoryUsage: number;
    oldestCacheObject?: Date;
    newestCacheObject?: Date;
  } {
    const totalLogs = this.queue.reduce((sum, cache) => sum + cache.getLength(), 0);
    const totalMemoryUsage = this.estimateMemoryUsage();

    const stats = {
      size: this.queue.length,
      isEmpty: this.isEmpty(),
      totalLogs,
      totalMemoryUsage
    };

    if (this.queue.length > 0) {
      const timestamps = this.queue.map(cache => cache.createdAt);
      return {
        ...stats,
        oldestCacheObject: new Date(Math.min(...timestamps.map(t => t.getTime()))),
        newestCacheObject: new Date(Math.max(...timestamps.map(t => t.getTime())))
      };
    }

    return stats;
  }

  /**
   * Get detailed information of all cache objects pending save
   * @returns Array of cache object information
   */
  getAllCacheInfo(): Array<{
    id: string;
    logCount: number;
    capacity: number;
    utilization: number;
    createdAt: Date;
    lastUpdated: Date;
  }> {
    return this.queue.map(cache => {
      const stats = cache.getStats();
      return {
        id: stats.id,
        logCount: stats.currentSize,
        capacity: stats.maxCapacity,
        utilization: stats.utilization,
        createdAt: stats.createdAt,
        lastUpdated: stats.lastUpdated
      };
    });
  }

  /**
   * Batch dequeue a specified number of cache objects
   * @param count - Number of cache objects to dequeue
   * @returns Array of dequeued cache objects
   */
  dequeueBatch(count: number): CacheObject[] {
    if (count <= 0) {
      return [];
    }

    const actualCount = Math.min(count, this.queue.length);
    return this.queue.splice(0, actualCount);
  }

  /**
   * Batch enqueue cache objects
   * @param cacheObjects - Array of cache objects to add
   */
  enqueueBatch(cacheObjects: CacheObject[]): void {
    this.queue.push(...cacheObjects);
  }

  /**
   * Find a cache object by ID
   * @param id - Cache object ID
   * @returns The found cache object, or null if not found
   */
  findById(id: string): CacheObject | null {
    return this.queue.find(cache => cache.id === id) || null;
  }

  /**
   * Remove a cache object by ID
   * @param id - ID of the cache object to remove
   * @returns Whether the removal was successful
   */
  removeById(id: string): boolean {
    const index = this.queue.findIndex(cache => cache.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get cache objects created within a specified time range
   * @param startTime - Start time
   * @param endTime - End time
   * @returns Array of cache objects within the time range
   */
  getCachesByTimeRange(startTime: Date, endTime: Date): CacheObject[] {
    return this.queue.filter(cache => 
      cache.createdAt >= startTime && cache.createdAt <= endTime
    );
  }

  /**
   * Get cache objects with utilization within a specified range
   * @param minUtilization - Minimum utilization (0-100)
   * @param maxUtilization - Maximum utilization (0-100)
   * @returns Array of cache objects within the utilization range
   */
  getCachesByUtilization(minUtilization: number, maxUtilization: number): CacheObject[] {
    return this.queue.filter(cache => {
      const stats = cache.getStats();
      return stats.utilization >= minUtilization && stats.utilization <= maxUtilization;
    });
  }

  /**
   * Estimate queue memory usage (bytes)
   * @returns Estimated memory usage
   */
  private estimateMemoryUsage(): number {
    if (this.queue.length === 0) {
      return 0;
    }

    // Estimate memory usage for each cache object
    let totalMemory = 0;
    for (const cache of this.queue) {
      // Base object overhead
      totalMemory += 200; // Estimated overhead of the object itself
      
      // Log data
      for (const log of cache.logs) {
        const logSize = JSON.stringify(log).length * 2; // Unicode characters are approximately 2 bytes
        totalMemory += logSize;
      }
    }

    return totalMemory;
  }

  /**
   * Validate queue integrity
   * @returns Validation result
   */
  validateIntegrity(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check the queue itself
    if (!Array.isArray(this.queue)) {
      errors.push('Queue is not an array');
      return { isValid: false, errors };
    }

    // Validate each cache object
    for (let i = 0; i < this.queue.length; i++) {
      const cache = this.queue[i];
      if (!cache) {
        errors.push(`Cache object at index ${i} is null or undefined`);
        continue;
      }

      if (!(cache instanceof CacheObject)) {
        errors.push(`Object at index ${i} is not a CacheObject instance`);
        continue;
      }

      // Validate cache object integrity
      const cacheValidation = cache.validateIntegrity();
      if (!cacheValidation.isValid) {
        errors.push(`Cache object at index ${i} failed validation: ${cacheValidation.errors.join(', ')}`);
      }
    }

    // Check for duplicate IDs
    const ids = this.queue.map(cache => cache.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      errors.push('Duplicate cache object IDs found in queue');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get detailed queue information (for debugging)
   * @returns Detailed queue information
   */
  getDetailedInfo(): {
    size: number;
    isEmpty: boolean;
    totalLogs: number;
    cacheObjects: Array<{
      id: string;
      logCount: number;
      capacity: number;
      utilization: number;
      createdAt: Date;
      memoryUsage: number;
    }>;
    totalMemoryUsage: number;
    validation: { isValid: boolean; errors: string[] };
  } {
    const cacheObjects = this.queue.map(cache => {
      const stats = cache.getStats();
      return {
        id: stats.id,
        logCount: stats.currentSize,
        capacity: stats.maxCapacity,
        utilization: stats.utilization,
        createdAt: stats.createdAt,
        memoryUsage: JSON.stringify(cache.logs).length * 2 // Estimate
      };
    });

    return {
      size: this.size(),
      isEmpty: this.isEmpty(),
      totalLogs: this.queue.reduce((sum, cache) => sum + cache.getLength(), 0),
      cacheObjects,
      totalMemoryUsage: this.estimateMemoryUsage(),
      validation: this.validateIntegrity()
    };
  }
}