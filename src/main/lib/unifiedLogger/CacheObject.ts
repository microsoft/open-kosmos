/**
 * Refactored Logger System - Cache Object
 * 
 * Represents a cache object that holds log entries in memory
 */

import { LogEntry } from './types';

export class CacheObject {
  id: string;
  logs: LogEntry[] = [];
  maxCapacity: number;
  createdAt: Date;
  lastUpdated: Date;

  constructor(maxCapacity: number) {
    this.id = this.generateId();
    this.maxCapacity = maxCapacity;
    this.createdAt = new Date();
    this.lastUpdated = new Date();
  }

  /**
   * Add a log to the cache
   * @param logEntry - Log entry to add
   * @returns Whether the addition was successful
   */
  addLog(logEntry: LogEntry): boolean {
    if (this.isFull()) {
      return false;
    }

    this.logs.push(logEntry);
    this.lastUpdated = new Date();
    return true;
  }

  /**
   * Check if full
   * @returns Whether the cache has reached maximum capacity
   */
  isFull(): boolean {
    return this.logs.length >= this.maxCapacity;
  }

  /**
   * Check if empty
   * @returns Whether the cache is empty
   */
  isEmpty(): boolean {
    return this.logs.length === 0;
  }

  /**
   * Get current length
   * @returns Number of log entries currently in the cache
   */
  getLength(): number {
    return this.logs.length;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.logs = [];
    this.lastUpdated = new Date();
  }

  /**
   * Get detailed cache object information
   * @returns Cache object statistics
   */
  getStats(): {
    id: string;
    currentSize: number;
    maxCapacity: number;
    utilization: number;
    createdAt: Date;
    lastUpdated: Date;
    isEmpty: boolean;
    isFull: boolean;
  } {
    return {
      id: this.id,
      currentSize: this.logs.length,
      maxCapacity: this.maxCapacity,
      utilization: (this.logs.length / this.maxCapacity) * 100,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
      isEmpty: this.isEmpty(),
      isFull: this.isFull()
    };
  }

  /**
   * Get logs within a specified time range from the cache
   * @param startTime - Start time
   * @param endTime - End time
   * @returns Array of log entries within the time range
   */
  getLogsByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
    return this.logs.filter(log => 
      log.timestamp >= startTime && log.timestamp <= endTime
    );
  }

  /**
   * Get logs of specified levels from the cache
   * @param levels - Array of log levels to filter
   * @returns Array of log entries matching the specified levels
   */
  getLogsByLevels(levels: string[]): LogEntry[] {
    return this.logs.filter(log => levels.includes(log.level));
  }

  /**
   * Clone cache object (deep copy of log data)
   * @returns New cache object instance
   */
  clone(): CacheObject {
    const clonedCache = new CacheObject(this.maxCapacity);
    clonedCache.id = this.id + '_clone';
    clonedCache.logs = this.logs.map(log => ({ ...log }));
    clonedCache.createdAt = new Date(this.createdAt);
    clonedCache.lastUpdated = new Date(this.lastUpdated);
    return clonedCache;
  }

  /**
   * Generate a unique cache object ID
   * @returns Unique identifier
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 8);
    return `cache-${timestamp}-${random}`;
  }

  /**
   * Validate cache object integrity
   * @returns Validation result
   */
  validateIntegrity(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.id) {
      errors.push('Cache object ID is missing');
    }

    if (this.maxCapacity <= 0) {
      errors.push('Max capacity must be greater than 0');
    }

    if (this.logs.length > this.maxCapacity) {
      errors.push(`Current size (${this.logs.length}) exceeds max capacity (${this.maxCapacity})`);
    }

    if (!this.createdAt || !this.lastUpdated) {
      errors.push('Timestamp information is missing');
    }

    if (this.lastUpdated < this.createdAt) {
      errors.push('Last updated time cannot be before created time');
    }

    // Validate each log entry
    for (let i = 0; i < this.logs.length; i++) {
      const log = this.logs[i];
      if (!log.id || !log.level || !log.message || !log.timestamp) {
        errors.push(`Log entry at index ${i} is missing required fields`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}