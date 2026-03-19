/**
 * Refactored Logger System - Pending Log Queue
 * 
 * Queue for storing log entries that are waiting to be cached
 */

import { LogEntry } from './types';

export class PendingLogQueue {
  private queue: LogEntry[] = [];

  /**
   * Add a log entry to the pending cache queue
   * @param logEntry - Log entry to add
   */
  enqueue(logEntry: LogEntry): void {
    this.queue.push(logEntry);
  }

  /**
   * Dequeue a log entry (FIFO - First In First Out)
   * @returns The first log entry in the queue, or null if the queue is empty
   */
  dequeue(): LogEntry | null {
    if (this.isEmpty()) {
      return null;
    }
    return this.queue.shift() || null;
  }

  /**
   * Check if the queue is empty
   * @returns Whether the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue length
   * @returns Number of log entries in the queue
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Peek at the element at the head of the queue without removing it
   * @returns The log entry at the head of the queue, or null if the queue is empty
   */
  peek(): LogEntry | null {
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
    oldestEntry?: Date;
    newestEntry?: Date;
    memoryUsage: number;
  } {
    const stats = {
      size: this.queue.length,
      isEmpty: this.isEmpty(),
      memoryUsage: this.estimateMemoryUsage()
    };

    if (this.queue.length > 0) {
      const timestamps = this.queue.map(entry => entry.timestamp);
      return {
        ...stats,
        oldestEntry: new Date(Math.min(...timestamps.map(t => t.getTime()))),
        newestEntry: new Date(Math.max(...timestamps.map(t => t.getTime())))
      };
    }

    return stats;
  }

  /**
   * Get log entries within a specified time range (without removing)
   * @param startTime - Start time
   * @param endTime - End time
   * @returns Array of log entries within the time range
   */
  getLogsByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
    return this.queue.filter(entry => 
      entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  /**
   * Get entries of specified log levels (without removing)
   * @param levels - Array of log levels to filter
   * @returns Array of log entries matching the specified levels
   */
  getLogsByLevels(levels: string[]): LogEntry[] {
    return this.queue.filter(entry => levels.includes(entry.level));
  }

  /**
   * Batch dequeue a specified number of log entries
   * @param count - Number of entries to dequeue
   * @returns Array of dequeued log entries
   */
  dequeueBatch(count: number): LogEntry[] {
    if (count <= 0) {
      return [];
    }

    const actualCount = Math.min(count, this.queue.length);
    return this.queue.splice(0, actualCount);
  }

  /**
   * Batch enqueue log entries
   * @param logEntries - Array of log entries to add
   */
  enqueueBatch(logEntries: LogEntry[]): void {
    this.queue.push(...logEntries);
  }

  /**
   * Estimate queue memory usage (bytes)
   * @returns Estimated memory usage
   */
  private estimateMemoryUsage(): number {
    if (this.queue.length === 0) {
      return 0;
    }

    // Estimate the average size of a single LogEntry
    const sampleEntry = this.queue[0];
    const entrySize = JSON.stringify(sampleEntry).length * 2; // Unicode characters are approximately 2 bytes
    
    return this.queue.length * entrySize;
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

    // Validate each log entry
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      if (!entry) {
        errors.push(`Entry at index ${i} is null or undefined`);
        continue;
      }

      if (!entry.id || typeof entry.id !== 'string') {
        errors.push(`Entry at index ${i} has invalid or missing ID`);
      }

      if (!entry.level || typeof entry.level !== 'string') {
        errors.push(`Entry at index ${i} has invalid or missing level`);
      }

      if (!entry.message || typeof entry.message !== 'string') {
        errors.push(`Entry at index ${i} has invalid or missing message`);
      }

      if (!entry.timestamp || !(entry.timestamp instanceof Date)) {
        errors.push(`Entry at index ${i} has invalid or missing timestamp`);
      }
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
    entries: Array<{
      id: string;
      level: string;
      message: string;
      timestamp: Date;
      source?: string;
    }>;
    memoryUsage: number;
    validation: { isValid: boolean; errors: string[] };
  } {
    return {
      size: this.size(),
      isEmpty: this.isEmpty(),
      entries: this.queue.map(entry => ({
        id: entry.id,
        level: entry.level,
        message: entry.message.substring(0, 100) + (entry.message.length > 100 ? '...' : ''),
        timestamp: entry.timestamp,
        source: entry.source
      })),
      memoryUsage: this.estimateMemoryUsage(),
      validation: this.validateIntegrity()
    };
  }
}