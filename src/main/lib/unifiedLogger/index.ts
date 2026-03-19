/**
 * Unified Logger System - Main Export File
 *
 * Provides the same API as the old advancedLogger for seamless replacement
 */

// Types and Interfaces
export * from './types';
export type {
  LogLevel,
  LogEntry,
  UnifiedLoggerConfig,
  LoggerStats,
  QueueStatus,
  FileOperationResult
} from './types';

// Core Components (export for advanced usage)
export { CacheObject } from './CacheObject';
export { PendingLogQueue } from './PendingLogQueue';
export { PendingSaveQueue } from './PendingSaveQueue';
export { LogEntryManager } from './LogEntryManager';
export { CacheLogManager } from './CacheLogManager';
export { SaveLogManager } from './SaveLogManager';
export * as FileOperations from './FileOperations';

import { LogLevel, UnifiedLoggerConfig, DEFAULT_UNIFIED_CONFIG, getEnvironmentBasedConfig, LoggerStats, QueueStatus } from './types';
import { LogEntryManager } from './LogEntryManager';
import { CacheLogManager } from './CacheLogManager';
import { SaveLogManager } from './SaveLogManager';
import { getDefaultLogDirectory } from './FileOperations';

// Main Logger Interface
export interface UnifiedLogger {
  // Log recording methods
  debug(message: string, source?: string, metadata?: any): void;
  info(message: string, source?: string, metadata?: any): void;
  warn(message: string, source?: string, metadata?: any): void;
  error(message: string, source?: string, metadata?: any): void;

  // Manual operations
  flushToDisk(): Promise<void>;        // Manual "logs to disk"
  handleAppExit(): Promise<void>;      // App shutdown handling

  // Status queries
  getStats(): LoggerStats;
  getQueueStatus(): QueueStatus;

  // Configuration
  updateConfig(newConfig: Partial<UnifiedLoggerConfig>): void;
  getConfig(): UnifiedLoggerConfig;

  // Legacy compatibility methods
  log(level: LogLevel, message: string, source?: string, metadata?: any): void;
  initialize?(): void;
  isInitialized?: boolean;
  shutdown?(): Promise<void>;
}

// Internal logger implementation
class UnifiedLoggerImpl implements UnifiedLogger {
  private logEntryManager: LogEntryManager;
  private cacheLogManager: CacheLogManager;
  private saveLogManager: SaveLogManager;
  private config: UnifiedLoggerConfig;
  public isInitialized: boolean = false;

  constructor(config: Partial<UnifiedLoggerConfig> = {}) {
    // Merge with defaults and environment-based config
    // Environment config should override defaults, user config should override everything
    const envConfig = getEnvironmentBasedConfig();
    
    this.config = {
      ...DEFAULT_UNIFIED_CONFIG,
      ...envConfig,
      ...config
    };

    // Set default log directory if not provided
    if (!this.config.LOGGER_DIRECTORY) {
      this.config.LOGGER_DIRECTORY = getDefaultLogDirectory();
    }

    // Initialize the three singleton managers
    this.logEntryManager = LogEntryManager.getInstance(this.config);
    this.cacheLogManager = CacheLogManager.getInstance(
      this.config, 
      this.logEntryManager.getPendingLogQueue()
    );
    this.saveLogManager = SaveLogManager.getInstance(
      this.config,
      this.cacheLogManager.getPendingSaveQueue()
    );

    // Set up dependency injection
    this.logEntryManager.setCacheLogManager(this.cacheLogManager);
    this.cacheLogManager.setSaveLogManager(this.saveLogManager);

    this.isInitialized = true;
  }

  // Log recording methods
  debug(message: string, source?: string, metadata?: any): void {
    this.logEntryManager.debug(message, source, metadata);
  }

  info(message: string, source?: string, metadata?: any): void {
    this.logEntryManager.info(message, source, metadata);
  }

  warn(message: string, source?: string, metadata?: any): void {
    this.logEntryManager.warn(message, source, metadata);
  }

  error(message: string, source?: string, metadata?: any): void {
    this.logEntryManager.error(message, source, metadata);
  }

  log(level: LogLevel, message: string, source?: string, metadata?: any): void {
    this.logEntryManager.log(level, message, source, metadata);
  }

  // Manual operations
  async flushToDisk(): Promise<void> {
    // 1. Force process all pending cached logs
    this.logEntryManager.forceProcessPendingLogs();
    // 2. Force flush current cache object (including unfull ones)
    this.cacheLogManager.forceFlush();
    // 3. Save all pending cache objects
    await this.saveLogManager.manualSave();
  }

  async handleAppExit(): Promise<void> {
    // 1. Force process all pending cached logs
    this.logEntryManager.forceProcessPendingLogs();
    // 2. Force flush current cache object (including unfull ones)
    this.cacheLogManager.forceFlush();
    // 3. Save all pending cache objects
    await this.saveLogManager.manualSave();
    // 4. Wait for all save operations to complete
    await this.saveLogManager.waitForSaveComplete(5000);
  }

  // Status queries
  getStats(): LoggerStats {
    const logEntryStats = this.logEntryManager.getStats();
    const cacheStats = this.cacheLogManager.getStats();
    const saveStats = this.saveLogManager.getSaveStats();

    return {
      totalLogsProcessed: saveStats.totalCacheObjectsSaved * this.config.LOGGER_CACHE_MAX_SIZE + cacheStats.currentCacheObjectSize,
      pendingQueueSize: logEntryStats.pendingQueueSize,
      cacheQueueSize: cacheStats.currentCacheObjectSize,
      pendingSaveQueueSize: cacheStats.pendingSaveQueueSize,
      currentCacheObjectSize: cacheStats.currentCacheObjectSize,
      totalFilesWritten: saveStats.totalFilesWritten,
      lastFlushTime: saveStats.lastSaveTime,
      averageProcessingTime: saveStats.averageSaveTime
    };
  }

  getQueueStatus(): QueueStatus {
    const cacheStats = this.cacheLogManager.getCurrentCacheObjectInfo();
    
    return {
      pendingLogQueue: {
        size: this.logEntryManager.getStats().pendingQueueSize,
        isEmpty: this.logEntryManager.getStats().pendingQueueSize === 0
      },
      cacheQueue: {
        activeCacheObject: {
          id: cacheStats.id,
          size: cacheStats.currentSize,
          isFull: cacheStats.isFull,
          capacity: cacheStats.maxCapacity
        }
      },
      pendingSaveQueue: {
        size: this.cacheLogManager.getStats().pendingSaveQueueSize,
        isEmpty: this.cacheLogManager.getStats().pendingSaveQueueSize === 0
      }
    };
  }

  // Configuration
  updateConfig(newConfig: Partial<UnifiedLoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logEntryManager.updateConfig(this.config);
    this.cacheLogManager.updateConfig(this.config);
    this.saveLogManager.updateConfig(this.config);
  }

  getConfig(): UnifiedLoggerConfig {
    return { ...this.config };
  }

  // Legacy compatibility
  initialize(): void {
    // Already initialized in constructor, but kept for compatibility
    this.isInitialized = true;
  }

  async shutdown(): Promise<void> {
    await this.handleAppExit();
  }
}

// Global singleton logger instance
let globalLogger: UnifiedLogger | null = null;

/**
 * Reset the global logger (for testing or config changes)
 */
export function resetGlobalLogger(): void {
  globalLogger = null;
}

/**
 * Get or create the global singleton logger instance
 */
export function getGlobalLogger(config?: Partial<UnifiedLoggerConfig>): UnifiedLogger {
  if (!globalLogger) {
    globalLogger = new UnifiedLoggerImpl(config);
  } else if (config) {
    // If logger exists but new config is provided, recreate the logger
    // This ensures that important config changes (like cache size) take effect
    globalLogger = new UnifiedLoggerImpl(config);
  }
  return globalLogger;
}

/**
 * Initialize the global logger if not already initialized
 */
export function initializeGlobalLogger(config?: Partial<UnifiedLoggerConfig>): UnifiedLogger {
  const logger = getGlobalLogger(config);
  if (logger.initialize && !logger.isInitialized) {
    logger.initialize();
  }
  return logger;
}

/**
 * Quick start function to create and initialize a logger (uses global singleton)
 */
export function createLogger(config?: Partial<UnifiedLoggerConfig>): UnifiedLogger {
  return initializeGlobalLogger(config);
}

/**
 * Create a logger with console-only output (uses global singleton)
 */
export function createConsoleLogger(): UnifiedLogger {
  return initializeGlobalLogger({
    LOGGER_ENABLE_CONSOLE: true,
    LOGGER_CACHE_MAX_SIZE: 10,
    LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR']
  });
}

/**
 * Create a logger optimized for high-performance scenarios (uses global singleton)
 */
export function createHighPerformanceLogger(logDirectory?: string): UnifiedLogger {
  return initializeGlobalLogger({
    LOGGER_CACHE_MAX_SIZE: 10000,
    LOGGER_ENABLE_CONSOLE: true,
    LOGGER_DIRECTORY: logDirectory || undefined,
    LOGGER_LEVELS: ['INFO', 'WARN', 'ERROR'] // Skip DEBUG for performance
  });
}

/**
 * Create a logger optimized for debugging with detailed output (uses global singleton)
 */
export function createDebugLogger(): UnifiedLogger {
  return initializeGlobalLogger({
    LOGGER_CACHE_MAX_SIZE: 100,
    LOGGER_ENABLE_CONSOLE: true,
    LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'] // All levels
  });
}

/**
 * Check if the global logger is initialized
 */
export function isGlobalLoggerInitialized(): boolean {
  return globalLogger !== null && globalLogger.isInitialized === true;
}

/**
 * Get the unified logger instance (main interface function)
 */
export function getUnifiedLogger(config?: Partial<UnifiedLoggerConfig>): UnifiedLogger {
  return getGlobalLogger(config);
}

/**
 * Legacy compatibility - still support getRefactoredLogger
 */
export function getRefactoredLogger(config?: Partial<UnifiedLoggerConfig>): UnifiedLogger {
  return getGlobalLogger(config);
}

// Export the global logger getter as default export for convenience
export default getGlobalLogger;

// Legacy compatibility - export some types that might be expected
export type LoggerConfig = UnifiedLoggerConfig; // Alias for compatibility
export type MainLogger = UnifiedLogger; // Alias for compatibility
export type RefactoredLoggerConfig = UnifiedLoggerConfig; // Legacy compatibility
export type RefactoredLogger = UnifiedLogger; // Legacy compatibility

// For compatibility with old system
export const DEFAULT_CONFIG = DEFAULT_UNIFIED_CONFIG;
export const DEFAULT_REFACTORED_CONFIG = DEFAULT_UNIFIED_CONFIG; // Legacy compatibility