/**
 * Unified Logger System - Type Definitions
 *
 * Core types and interfaces for the new three-queue, three-singleton logger architecture
 */

// Log Levels
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Log Entry Interface
export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  source?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

// Configuration Interface
export interface UnifiedLoggerConfig {
  // Maximum cache object capacity
  LOGGER_CACHE_MAX_SIZE: number; // Default dev: 10, production: 10000
  
  // Log directory
  LOGGER_DIRECTORY: string; // Default: user profile directory
  
  // Enabled log levels
  LOGGER_LEVELS: LogLevel[]; // Default: ['DEBUG', 'INFO', 'WARN', 'ERROR']
  
  // Console output
  LOGGER_ENABLE_CONSOLE: boolean; // Default: true
}

// Default Configuration (without environment-dependent values)
export const DEFAULT_UNIFIED_CONFIG: UnifiedLoggerConfig = {
  LOGGER_CACHE_MAX_SIZE: 10, // Default fallback, will be overridden by environment config
  LOGGER_DIRECTORY: '', // Will be set to user profile directory
  LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  LOGGER_ENABLE_CONSOLE: true
};

// Logger Statistics
export interface LoggerStats {
  totalLogsProcessed: number;
  pendingQueueSize: number;
  cacheQueueSize: number;
  pendingSaveQueueSize: number;
  currentCacheObjectSize: number;
  totalFilesWritten: number;
  lastFlushTime?: Date;
  averageProcessingTime: number;
}

// Queue Status
export interface QueueStatus {
  pendingLogQueue: {
    size: number;
    isEmpty: boolean;
  };
  cacheQueue: {
    activeCacheObject: {
      id: string;
      size: number;
      isFull: boolean;
      capacity: number;
    } | null;
  };
  pendingSaveQueue: {
    size: number;
    isEmpty: boolean;
  };
}

// File Operation Result
export interface FileOperationResult {
  success: boolean;
  filePath?: string;
  bytesWritten?: number;
  error?: string;
  duration: number;
}

// Create Log Entry Helper Function
export function createLogEntry(
  level: LogLevel,
  message: string,
  source?: string,
  metadata?: Record<string, any>
): LogEntry {
  return {
    id: generateLogId(),
    level,
    message,
    source,
    metadata,
    timestamp: new Date()
  };
}

// Generate unique log ID
function generateLogId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${timestamp}-${random}`;
}

// Environment detection helper
export function getEnvironmentBasedConfig(): Partial<UnifiedLoggerConfig> {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  return {
    LOGGER_CACHE_MAX_SIZE: isDevelopment ? 10 : 2000,
    LOGGER_ENABLE_CONSOLE: true
  };
}