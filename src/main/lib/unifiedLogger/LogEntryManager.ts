/**
 * Unified Logger System - Log Entry Manager (Singleton)
 *
 * Class AddLog - Responsible for receiving log requests and managing the pending log queue
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
   * Get singleton instance
   * @param config - Configuration object (only used during first creation)
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
   * Set reference to the cache log manager (dependency injection)
   * @param cacheLogManager - CacheLogManager instance
   */
  public setCacheLogManager(cacheLogManager: any): void {
    this.cacheLogManager = cacheLogManager;
  }

  /**
   * Get reference to the pending cache log queue
   * @returns PendingLogQueue instance
   */
  public getPendingLogQueue(): PendingLogQueue {
    return this.pendingLogQueue;
  }

  /**
   * Main log method
   * @param level - Log level
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public log(level: LogLevel, message: string, source?: string, metadata?: any): void {
    // 1. Check if this log level is enabled
    if (!this.config.LOGGER_LEVELS.includes(level)) {
      return;
    }

    // 2. Console log output - force output even if config disables it, isolated from file output
    try {
      this.outputToConsole(level, message, source, metadata);
    } catch (consoleError) {
      // Ensure console errors do not affect file logging, but attempt to output the error itself
      // Use raw console.error to avoid circular calls
      if (global.console && global.console.error) {
        global.console.error('UnifiedLogger: Failed to write to console:', consoleError);
      }
    }

    // 3-5. Handle file log recording - independent try-catch block ensures console errors do not block file recording
    try {
      // 3. Create LogEntry object
      const logEntry = this.createLogEntry(level, message, source, metadata);

      // 4. Add to the pending cache log queue
      this.pendingLogQueue.enqueue(logEntry);

      // 5. Notify cache log manager that a new log has been added
      if (this.cacheLogManager && typeof this.cacheLogManager.notifyNewLogAdded === 'function') {
        this.cacheLogManager.notifyNewLogAdded();
      }
    } catch (fileError) {
      // File recording failure must be reported
      if (global.console && global.console.error) {
        global.console.error('UnifiedLogger: Failed to process log entry for file system:', fileError);
      }
    }
  }

  /**
   * Safely write to console, ignoring EPIPE errors
   * EPIPE errors occur when the pipe is closed (e.g., during app exit), which should be silently ignored
   * @param fn - console method
   * @param message - Log message
   */
  private safeConsoleWrite(fn: (...args: any[]) => void, message: string): void {
    try {
      fn(message);
    } catch (error: any) {
      // Ignore EPIPE errors - this typically occurs when the pipe closes during app exit
      if (error?.code !== 'EPIPE') {
        // For other errors, try writing directly to process.stderr (if available)
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
   * Output log to console
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
   * Create LogEntry object
   * @param level - Log level
   * @param message - Log message
   * @param source - Log source
   * @param metadata - Metadata
   * @returns Created LogEntry object
   */
  private createLogEntry(level: LogLevel, message: string, source?: string, metadata?: any): LogEntry {
    return createLogEntry(level, message, source, metadata);
  }

  // Convenience methods
  /**
   * Log a DEBUG level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public debug(message: string, source?: string, metadata?: any): void {
    this.log('DEBUG', message, source, metadata);
  }

  /**
   * Log an INFO level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public info(message: string, source?: string, metadata?: any): void {
    this.log('INFO', message, source, metadata);
  }

  /**
   * Log a WARN level entry
   * @param message - Log message
   * @param source - Log source (optional)
   * @param metadata - Metadata (optional)
   */
  public warn(message: string, source?: string, metadata?: any): void {
    this.log('WARN', message, source, metadata);
  }

  /**
   * Log an ERROR level entry
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
   * Get current configuration
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
   * Clear the pending cache queue (use with caution)
   */
  public clearPendingQueue(): void {
    this.pendingLogQueue.clear();
  }

  /**
   * Get detailed information of the pending cache queue (for debugging)
   * @returns Queue detailed information
   */
  public getPendingQueueInfo(): ReturnType<PendingLogQueue['getDetailedInfo']> {
    return this.pendingLogQueue.getDetailedInfo();
  }

  /**
   * Validate LogEntryManager integrity
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
   * Force process all pending cached logs (for app exit)
   */
  public forceProcessPendingLogs(): void {
    try {
      // Keep notifying cache manager until all pending cached logs are processed
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
   * Reset singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    LogEntryManager.instance = undefined as any;
  }

  /**
   * Check if initialized
   * @returns Whether it is initialized
   */
  public static isInitialized(): boolean {
    return LogEntryManager.instance !== undefined;
  }
}