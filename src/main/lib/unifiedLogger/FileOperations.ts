/**
 * Refactored Logger System - File Operations
 *
 * Utility functions for file operations including writing logs and cleanup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { LogEntry, FileOperationResult } from './types';
import { CacheObject } from './CacheObject';

const PRODUCTION_LOG_FILE_RE = /^openkosmos-\d{4}-\d{2}-\d{2}\.log$/;
const DEV_LOG_FILE_RE = /^openkosmos-dev-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/;

let devStartupLogFileName: string | null = null;

/**
 * Get the default log directory
 * @returns Default log directory path
 */
export function getDefaultLogDirectory(): string {
  // Use electron's app.getPath('userData') if available, otherwise fallback
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch (error) {
    // Fallback for non-electron environments
  }
  const userProfile = os.homedir();
  // Try to get app name from environment or default to 'openkosmos-app'
  const appName = process.env.APP_NAME || 'openkosmos-app';

  // Platform specific headers
  if (process.platform === 'darwin') {
    return path.join(
      userProfile,
      'Library',
      'Application Support',
      appName,
      'logs',
    );
  }
  // Windows & Linux default to APPDATA/Config logic usually, but here sticking to fallback
  return path.join(userProfile, 'AppData', 'Roaming', appName, 'logs');
}

/**
 * Ensure the log directory exists
 * @param logDirectory - Log directory path
 * @returns Whether the directory was successfully created or already exists
 */
export async function ensureLogDirectoryExists(logDirectory: string): Promise<boolean> {
  try {
    await fs.mkdir(logDirectory, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

function formatDatePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTimestampForFileName(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${formatDatePart(date)}-${hours}-${minutes}-${seconds}`;
}

export function isDevelopmentLogEnvironment(): boolean {
  return process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
}

/**
 * Get the production log file name for today
 * @returns Production log file name for today
 */
export function getTodayLogFileName(date: Date = new Date()): string {
  return `openkosmos-${formatDatePart(date)}.log`;
}

export function getDevLogFileName(date: Date = new Date()): string {
  return `openkosmos-dev-${formatLocalTimestampForFileName(date)}.log`;
}

export function getDevStartupLogFileName(date: Date = new Date()): string {
  if (!devStartupLogFileName) {
    devStartupLogFileName = getDevLogFileName(date);
  }
  return devStartupLogFileName;
}

export function resetDevStartupLogFileNameForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDevStartupLogFileNameForTest can only be used in tests');
  }
  devStartupLogFileName = null;
}

export function getCurrentLogFileName(): string {
  return isDevelopmentLogEnvironment()
    ? getDevStartupLogFileName()
    : getTodayLogFileName();
}

/**
 * Get the full log file path
 * @param logDirectory - Log directory
 * @param fileName - File name (optional, defaults to today's file name)
 * @returns Full file path
 */
export function getLogFilePath(logDirectory: string, fileName?: string): string {
  const actualFileName = fileName || getCurrentLogFileName();
  return path.join(logDirectory, actualFileName);
}

/**
 * Format a log entry as a file string
 * @param logEntry - Log entry
 * @returns Formatted string
 */
export function formatLogEntryForFile(logEntry: LogEntry): string {
  const timestamp = logEntry.timestamp.toISOString();
  const level = logEntry.level.padEnd(5);
  const source = logEntry.source ? `[${logEntry.source}]` : '';
  const metadata = logEntry.metadata ? ` ${JSON.stringify(logEntry.metadata)}` : '';

  return `${timestamp} ${level} ${source} ${logEntry.message}${metadata}`;
}

/**
 * Format all logs in a cache object as a file string
 * @param cacheObject - Cache object
 * @returns Formatted string
 */
export function formatCacheObjectForFile(cacheObject: CacheObject): string {
  const header = `\n# Cache Object: ${cacheObject.id} | Created: ${cacheObject.createdAt.toISOString()} | Logs: ${cacheObject.getLength()}\n`;
  const logs = cacheObject.logs.map(formatLogEntryForFile).join('\n');
  return header + logs + '\n';
}

/**
 * Write a cache object to disk
 * @param cacheObject - Cache object to write
 * @param logDirectory - Log directory
 * @returns File operation result
 */
export async function writeCacheObjectToDisk(
  cacheObject: CacheObject,
  logDirectory: string
): Promise<FileOperationResult> {
  const startTime = Date.now();

  try {
    // Ensure log directory exists
    const dirExists = await ensureLogDirectoryExists(logDirectory);
    if (!dirExists) {
      return {
        success: false,
        error: 'Failed to create log directory',
        duration: Date.now() - startTime
      };
    }

    // Get log file path
    const filePath = getLogFilePath(logDirectory);

    // Format cache object content
    const content = formatCacheObjectForFile(cacheObject);

    // Append to file
    await fs.appendFile(filePath, content, 'utf8');

    // Get bytes written
    const bytesWritten = Buffer.byteLength(content, 'utf8');

    return {
      success: true,
      filePath,
      bytesWritten,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Get all log files in the directory
 * @param logDirectory - Log directory
 * @returns Array of log file information
 */
export async function getAllLogFiles(logDirectory: string): Promise<Array<{
  name: string;
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}>> {
  try {
    // Check if directory exists
    await fs.access(logDirectory);

    const files = await fs.readdir(logDirectory);
    const logFiles = files.filter(file => file.endsWith('.log'));

    const fileInfos = await Promise.all(
      logFiles.map(async (fileName) => {
        const filePath = path.join(logDirectory, fileName);
        const stats = await fs.stat(filePath);

        return {
          name: fileName,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
    );

    return fileInfos;
  } catch (error) {
    return [];
  }
}

/**
 * Clean up old log files (keep today's file)
 * @param logDirectory - Log directory
 * @returns Cleanup result
 */
export async function cleanupOldLogFiles(logDirectory: string): Promise<{
  success: boolean;
  deletedFiles: string[];
  totalDeletedSize: number;
  error?: string;
}> {
  try {
    const allFiles = await getAllLogFiles(logDirectory);
    const currentFileName = getCurrentLogFileName();
    const isDevelopment = isDevelopmentLogEnvironment();

    const filesToDelete = allFiles.filter(file => {
      if (isDevelopment) {
        return DEV_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
      }
      return PRODUCTION_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
    });

    if (filesToDelete.length === 0) {
      return {
        success: true,
        deletedFiles: [],
        totalDeletedSize: 0
      };
    }

    let totalDeletedSize = 0;
    const deletedFiles: string[] = [];

    // Delete old files
    for (const file of filesToDelete) {
      try {
        await fs.unlink(file.path);
        deletedFiles.push(file.name);
        totalDeletedSize += file.size;
      } catch (error) {
      }
    }

    return {
      success: true,
      deletedFiles,
      totalDeletedSize
    };
  } catch (error) {
    return {
      success: false,
      deletedFiles: [],
      totalDeletedSize: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check whether log files need cleanup
 * @param logDirectory - Log directory
 * @returns Whether cleanup is needed
 */
export async function needsCleanup(logDirectory: string): Promise<boolean> {
  try {
    const allFiles = await getAllLogFiles(logDirectory);
    const currentFileName = getCurrentLogFileName();
    const isDevelopment = isDevelopmentLogEnvironment();

    return allFiles.some(file => {
      if (isDevelopment) {
        return DEV_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
      }
      return PRODUCTION_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
    });
  } catch (error) {
    return false;
  }
}

/**
 * Get log directory statistics
 * @param logDirectory - Log directory
 * @returns Directory statistics
 */
export async function getLogDirectoryStats(logDirectory: string): Promise<{
  totalFiles: number;
  totalSize: number;
  todayFileExists: boolean;
  todayFileSize: number;
  oldFilesCount: number;
  oldFilesSize: number;
}> {
  try {
    const allFiles = await getAllLogFiles(logDirectory);
    const currentFileName = getCurrentLogFileName();
    const isDevelopment = isDevelopmentLogEnvironment();

    const todayFile = allFiles.find(file => file.name === currentFileName);
    const oldFiles = allFiles.filter(file => {
      if (isDevelopment) {
        return DEV_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
      }
      return PRODUCTION_LOG_FILE_RE.test(file.name) && file.name !== currentFileName;
    });

    const totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);
    const oldFilesSize = oldFiles.reduce((sum, file) => sum + file.size, 0);

    return {
      totalFiles: allFiles.length,
      totalSize,
      todayFileExists: !!todayFile,
      todayFileSize: todayFile ? todayFile.size : 0,
      oldFilesCount: oldFiles.length,
      oldFilesSize
    };
  } catch (error) {
    return {
      totalFiles: 0,
      totalSize: 0,
      todayFileExists: false,
      todayFileSize: 0,
      oldFilesCount: 0,
      oldFilesSize: 0
    };
  }
}

/**
 * Validate the accessibility of the log directory
 * @param logDirectory - Log directory
 * @returns Validation result
 */
export async function validateLogDirectory(logDirectory: string): Promise<{
  exists: boolean;
  writable: boolean;
  readable: boolean;
  error?: string;
}> {
  try {
    // Check if directory exists
    await fs.access(logDirectory, fs.constants.F_OK);

    // Check if readable
    await fs.access(logDirectory, fs.constants.R_OK);

    // Check if writable
    await fs.access(logDirectory, fs.constants.W_OK);

    return {
      exists: true,
      writable: true,
      readable: true
    };
  } catch (error) {
    return {
      exists: false,
      writable: false,
      readable: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
