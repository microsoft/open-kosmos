/**
 * Unified Logger System - Log Entry Manager (Singleton)
 *
 * Class add-log - Responsible for receiving log requests and managing the pending log queue
 */

import { LogEntry, LogLevel, UnifiedLoggerConfig, createLogEntry } from './types';
import { PendingLogQueue } from './PendingLogQueue';

export class LogEntryManager {
  private static instance: LogEntryManager;
  private pendingLogQueue: PendingLogQueue;
  private config: UnifiedLoggerConfig;
  private cacheLogManager: any; // Will be set via dependency injection

  private constructor(config: UnifiedLoggerConfig) {
    this.config = config;
    this.pendingLogQueue = new PendingLogQueue();
  }

  /**
   * Get the singleton instance
   * @param config - Configuration object (only used on first creation)
   * @returns LogEntryManager instance
   */
  public static getInstance(config?: UnifiedLoggerConfig): LogEntryManager {
    if (!LogEntryManager.instance) {
      if (!config) {
        throw new Error('Configuration is required for first-time initialization');
      }
      LogEntryManager.instance = new LogEntryManager(config);
    }
    return LogEntryManager.instance;
  }

  /**
   * Set the reference to the cache log manager (dependency injection)
   * @param cacheLogManager - CacheLogManager instance
   */
  public setCacheLogManager(cacheLogManager: any): void {
    this.cacheLogManager = cacheLogManager;
  }

  /**
   * Get a reference to the pending log queue
   * @returns PendingLogQueue instance
   */
  public getPendingLogQueue(): PendingLogQueue {
    return this.pendingLogQueue;
  }

  /**
   * Primary log method
   * @param level - Log level
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public log(level: LogLevel, message: string, source?: string, metadata?: any): void {
    // 1. Check whether this log level is enabled
    if (!this.config.LOGGER_LEVELS.includes(level)) {
      return;
    }

    // 2. Output to console — forced even if disabled in config, isolated from file output
    try {
      this.outputToConsole(level, message, source, metadata);
    } catch (consoleError) {
      // Ensure console errors do not affect file logging, but try to output the error itself
      // Use raw console.error to avoid circular calls
      if (global.console && global.console.error) {
        global.console.error('UnifiedLogger: Failed to write to console:', consoleError);
      }
    }

    // 3-5. Handle file logging — independent try-catch ensures console errors don't block file logging
    try {
      // 3. Create a LogEntry object
      const logEntry = this.createLogEntry(level, message, source, metadata);

      // 4. Add to the pending log queue
      this.pendingLogQueue.enqueue(logEntry);

      // 5. Notify the cache log manager that a new log has been added
      if (this.cacheLogManager && typeof this.cacheLogManager.notifyNewLogAdded === 'function') {
        this.cacheLogManager.notifyNewLogAdded();
      }
    } catch (fileError) {
      // File logging failure must be reported
      if (global.console && global.console.error) {
        global.console.error('UnifiedLogger: Failed to process log entry for file system:', fileError);
      }
    }
  }

  /**
   * Safely write to the console, ignoring EPIPE errors.
   * EPIPE errors occur when a pipe is closed (e.g., when the app exits), and should be silently ignored.
   * @param fn - console method
   * @param message - Log message
   */
  private safeConsoleWrite(fn: (...args: any[]) => void, message: string): void {
    try {
      fn(message);
    } catch (error: any) {
      // Ignore EPIPE errors — these typically occur when a pipe is closed during app exit
      if (error?.code !== 'EPIPE') {
        // For other errors, try writing to process.stderr directly (if available)
        try {
          if (process.stderr?.writable) {
            process.stderr.write(`[UnifiedLogger] Console write error: ${error?.message || error}\n`);
          }
        } catch {
          // If stderr is also unavailable, silently ignore
        }
      }
    }
  }

  /**
   * Output a log entry to the console
   * @param level - Log level
   * @param message - Log message
   * @param source - Log source
   * @param metadata - Metadata
   */
  private outputToConsole(level: LogLevel, message: string, source?: string, metadata?: any): void {
    const timestamp = new Date().toISOString();
    const sourceStr = source ? `[${source}]` : '';
    const metadataStr = metadata ? ` ${JSON.stringify(metadata)}` : '';

    const logMessage = `${timestamp} [${level}]${sourceStr} ${message}${metadataStr}`;

    switch (level) {
      case 'DEBUG':
        this.safeConsoleWrite(console.debug.bind(console), logMessage);
        break;
      case 'INFO':
        this.safeConsoleWrite(console.info.bind(console), logMessage);
        break;
      case 'WARN':
        this.safeConsoleWrite(console.warn.bind(console), logMessage);
        break;
      case 'ERROR':
        this.safeConsoleWrite(console.error.bind(console), logMessage);
        break;
      default:
        this.safeConsoleWrite(console.log.bind(console), logMessage);
    }
  }

  /**
   * Create a LogEntry object
   * @param level - Log level
   * @param message - Log message
   * @param source - Log source
   * @param metadata - Metadata
   * @returns The created LogEntry object
   */
  private createLogEntry(level: LogLevel, message: string, source?: string, metadata?: any): LogEntry {
    return createLogEntry(level, message, source, metadata);
  }

  // Convenience methods
  /**
   * Log a DEBUG-level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public debug(message: string, source?: string, metadata?: any): void {
    this.log('DEBUG', message, source, metadata);
  }

  /**
   * Log an INFO-level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public info(message: string, source?: string, metadata?: any): void {
    this.log('INFO', message, source, metadata);
  }

  /**
   * Log a WARN-level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public warn(message: string, source?: string, metadata?: any): void {
    this.log('WARN', message, source, metadata);
  }

  /**
   * Log an ERROR-level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public error(message: string, source?: string, metadata?: any): void {
    this.log('ERROR', message, source, metadata);
  }

  /**
   * Update configuration
   * @param newConfig - New configuration object
   */
  public updateConfig(newConfig: Partial<UnifiedLoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get the current configuration
   * @returns Current configuration object
   */
  public getConfig(): UnifiedLoggerConfig {
    return { ...this.config };
  }

  /**
   * Get statistics
   * @returns Statistics object
   */
  public getStats(): {
    pendingQueueSize: number;
    pendingQueueStats: ReturnType<PendingLogQueue['getStats']>;
    configuredLevels: LogLevel[];
    consoleEnabled: boolean;
  } {
    return {
      pendingQueueSize: this.pendingLogQueue.size(),
      pendingQueueStats: this.pendingLogQueue.getStats(),
      configuredLevels: [...this.config.LOGGER_LEVELS],
      consoleEnabled: this.config.LOGGER_ENABLE_CONSOLE
    };
  }

  /**
   * Clear the pending log queue (use with caution)
   */
  public clearPendingQueue(): void {
    this.pendingLogQueue.clear();
  }

  /**
   * Get detailed information about the pending log queue (for debugging)
   * @returns Queue detailed information
   */
  public getPendingQueueInfo(): ReturnType<PendingLogQueue['getDetailedInfo']> {
    return this.pendingLogQueue.getDetailedInfo();
  }

  /**
   * Validate the integrity of LogEntryManager
   * @returns Validation result
   */
  public validateIntegrity(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.pendingLogQueue) {
      errors.push('Pending log queue is not initialized');
    } else {
      const queueValidation = this.pendingLogQueue.validateIntegrity();
      if (!queueValidation.isValid) {
        errors.push(`Pending queue validation failed: ${queueValidation.errors.join(', ')}`);
      }
    }

    if (!this.config) {
      errors.push('Configuration is not set');
    } else {
      if (!Array.isArray(this.config.LOGGER_LEVELS) || this.config.LOGGER_LEVELS.length === 0) {
        errors.push('Invalid or empty logger levels configuration');
      }

      if (typeof this.config.LOGGER_ENABLE_CONSOLE !== 'boolean') {
        errors.push('Invalid console enable configuration');
      }

      if (typeof this.config.LOGGER_CACHE_MAX_SIZE !== 'number' || this.config.LOGGER_CACHE_MAX_SIZE <= 0) {
        errors.push('Invalid cache max size configuration');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Force processing of all pending logs (used when the app is shutting down)
   */
  public forceProcessPendingLogs(): void {
    try {
      // Keep notifying the cache manager until all pending logs are processed
      if (this.cacheLogManager && typeof this.cacheLogManager.notifyNewLogAdded === 'function') {
        while (!this.pendingLogQueue.isEmpty()) {
          this.cacheLogManager.notifyNewLogAdded();
          // Prevent infinite loop
          if (this.pendingLogQueue.size() > 10000) {
            break;
          }
        }
      }
    } catch (error) {
    }
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    LogEntryManager.instance = undefined as any;
  }

  /**
   * Check whether the manager has been initialized
   * @returns Whether it is initialized
   */
  public static isInitialized(): boolean {
    return LogEntryManager.instance !== undefined;
  }
}