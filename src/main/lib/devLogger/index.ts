/**
 * Development Logger - Captures Renderer console logs for debugging
 *
 * Only active in development mode. Captures structured logs from Renderer
 * process via console-message events and writes them to files.
 *
 * This enables Claude Code (or any developer) to see Renderer logs via:
 *   tail -f ~/.config/openkosmos-app/logs/openkosmos-dev-YYYY-MM-DD-HH-mm-ss.log
 */

import type { BrowserWindow, WebContents } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  cleanupOldLogFiles,
  ensureLogDirectoryExists,
  getCurrentLogFileName,
  getDefaultLogDirectory,
  isDevelopmentLogEnvironment,
} from '../unifiedLogger/FileOperations';

// Only enable in development
const isDevelopment = isDevelopmentLogEnvironment();

// Log level from environment, defaults to INFO
type LogLevel = 'DEBUG' | 'VERBOSE' | 'INFO' | 'WARN' | 'ERROR' | 'PERF' | 'SYSTEM';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  VERBOSE: 1,
  PERF: 2,
  INFO: 3,
  SYSTEM: 3,
  WARN: 4,
  ERROR: 5,
};

function getMinLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return 'INFO'; // Default: INFO and above
}

// Structured log entry from Renderer
interface RendererLog {
  __openkosmos_log: true;
  level: LogLevel;
  source: string;
  message: string;
  args?: string;
  timestamp: number;
}

/**
 * Format a log entry for file output
 * Matches unifiedLogger format: {ISO timestamp} {level} [R:{source}] {message} {args}
 */
function formatLogEntry(log: RendererLog): string {
  const timestamp = new Date(log.timestamp).toISOString();
  const level = log.level.padEnd(5);
  const source = `[R:${log.source}]`;
  const args = log.args ? ` ${log.args}` : '';

  return `${timestamp} ${level} ${source} ${log.message}${args}`;
}

/**
 * DevLogger class - manages Renderer log capture
 */
class DevLogger {
  private logBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logDirectory: string;
  private minLevel: LogLevel;
  private isWriting = false;

  // Buffer settings for performance
  private readonly FLUSH_INTERVAL_MS = 500; // Flush every 500ms
  private readonly MAX_BUFFER_SIZE = 100;   // Or when buffer reaches 100 entries

  constructor() {
    this.logDirectory = getDefaultLogDirectory();
    this.minLevel = getMinLogLevel();

    // Ensure log directory exists on startup
    void ensureLogDirectoryExists(this.logDirectory).then(() => cleanupOldLogFiles(this.logDirectory));
  }

  /**
   * Check if a log should be captured based on level
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * Handle a structured log from Renderer
   */
  handleLog(log: RendererLog): void {
    if (!this.shouldLog(log.level)) {
      return;
    }

    const formatted = formatLogEntry(log);
    this.logBuffer.push(formatted);

    // Also output to console for immediate visibility (with color coding)
    const colorCode = this.getColorCode(log.level);
    console.log(`\x1b[${colorCode}m${formatted}\x1b[0m`);

    // Schedule flush
    if (this.logBuffer.length >= this.MAX_BUFFER_SIZE) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Get ANSI color code for log level
   */
  private getColorCode(level: LogLevel): string {
    switch (level) {
      case 'ERROR': return '31';    // Red
      case 'WARN': return '33';     // Yellow
      case 'INFO': return '36';     // Cyan
      case 'DEBUG': return '90';    // Gray
      case 'VERBOSE': return '90';  // Gray
      case 'PERF': return '35';     // Magenta
      case 'SYSTEM': return '32';   // Green
      default: return '0';          // Default
    }
  }

  /**
   * Flush buffered logs to disk
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.logBuffer.length === 0 || this.isWriting) {
      return;
    }

    this.isWriting = true;
    const logsToWrite = this.logBuffer.splice(0);

    try {
      const filePath = path.join(this.logDirectory, getCurrentLogFileName());
      const content = logsToWrite.join('\n') + '\n';
      await fs.appendFile(filePath, content, 'utf8');
    } catch (error) {
      // Re-add logs to buffer if write fails
      this.logBuffer.unshift(...logsToWrite);
      console.error('[DevLogger] Failed to write logs:', error);
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Attach to a BrowserWindow to capture its console messages
   */
  attachToWindow(window: BrowserWindow): void {
    if (!isDevelopment) {
      return;
    }

    const webContents = window.webContents;
    this.attachToWebContents(webContents);
  }

  /**
   * Attach to WebContents to capture console messages
   */
  attachToWebContents(webContents: WebContents): void {
    if (!isDevelopment) {
      return;
    }

    // Use new Electron 35+ event signature
    // Note: Structured logs now arrive via IPC ('logger:rendererLog'), not console-message.
    // This handler captures plain console.log output (non-logger) as a fallback.
    webContents.on('console-message', (event: any) => {
      const message = (event as any).message || '';

      // Fallback: capture plain console.log as INFO level
      // Extract source from message like "[ComponentName] ..." or use generic "Renderer"
      const sourceMatch = message.match(/^\[([^\]]+)\]/);
      const source = sourceMatch ? sourceMatch[1] : 'Renderer';
      const level = (event as any).level || 'info';

      // Map Electron console levels to our LogLevel
      const logLevelMap: Record<string, LogLevel> = {
        'verbose': 'DEBUG',
        'info': 'INFO',
        'warning': 'WARN',
        'error': 'ERROR',
        'debug': 'DEBUG',
      };

      const mappedLevel = logLevelMap[level] || 'INFO';

      // Only log if it meets the minimum level threshold
      if (this.shouldLog(mappedLevel)) {
        const fallbackLog: RendererLog = {
          __openkosmos_log: true,
          level: mappedLevel,
          source,
          message,
          timestamp: Date.now(),
        };
        this.handleLog(fallbackLog);
      }
    });

    console.log('[DevLogger] Attached to WebContents, capturing Renderer logs');
    console.log(`[DevLogger] Log level: ${this.minLevel}, Directory: ${this.logDirectory}`);
  }

  /**
   * Graceful shutdown - flush remaining logs
   */
  async shutdown(): Promise<void> {
    await this.flush();
  }
}

// Singleton instance
let devLoggerInstance: DevLogger | null = null;

/**
 * Get the DevLogger singleton (creates if needed)
 */
export function getDevLogger(): DevLogger | null {
  if (!isDevelopment) {
    return null;
  }

  if (!devLoggerInstance) {
    devLoggerInstance = new DevLogger();
  }

  return devLoggerInstance;
}

/**
 * Attach DevLogger to a BrowserWindow
 * Call this after creating the main window
 */
export function attachDevLoggerToWindow(window: BrowserWindow): void {
  const logger = getDevLogger();
  if (logger) {
    logger.attachToWindow(window);
  }
}

/**
 * Shutdown DevLogger gracefully
 */
export async function shutdownDevLogger(): Promise<void> {
  if (devLoggerInstance) {
    await devLoggerInstance.shutdown();
  }
}

export { DevLogger };
