/**
 * Smart logging system
 * Display all logs in development mode, only important information in production mode
 *
 * In dev mode, sends structured logs to Main process via IPC for file persistence.
 * Human-readable logs go to DevTools console, structured logs go to Main for file output.
 */

const isDevelopment = process.env.NODE_ENV === 'development';

// Log levels for filtering
type LogLevel = 'DEBUG' | 'VERBOSE' | 'INFO' | 'WARN' | 'ERROR' | 'PERF' | 'SYSTEM';

// Structured log entry for Main process to parse
interface StructuredLog {
  __openkosmos_log: true; // Marker for Main to identify our logs
  level: LogLevel;
  source: string; // Module/component name (from prefix)
  message: string; // First argument stringified
  args?: string; // Additional arguments JSON stringified
  timestamp: number;
}

/**
 * Serialize arguments to a readable string
 * Handles objects, arrays, errors, and primitives
 */
function serializeArgs(args: any[]): string {
  if (args.length === 0) return '';

  return args
    .map((arg) => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (arg instanceof Error) {
        return `Error: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 0); // Compact JSON
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

/**
 * Extract clean source name from prefix like "[ChatInput]" or "[Renderer]"
 */
function extractSource(prefix: string): string {
  const match = prefix.match(/\[([^\]]+)\]/);
  return match ? match[1] : prefix;
}

export class Logger {
  private static instance: Logger;
  private prefix: string;
  private source: string;

  constructor(prefix: string = '[App]') {
    this.prefix = prefix;
    this.source = extractSource(prefix);
  }

  static getInstance(prefix?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(prefix);
    }
    return Logger.instance;
  }

  /**
   * Core logging method - outputs structured JSON in dev mode
   */
  private log(level: LogLevel, consoleMethod: 'log' | 'warn' | 'error', emoji: string, args: any[]): void {
    // Serialize args to avoid [object Object] when captured by Main process via console-message event
    const serializedArgs = serializeArgs(args);

    if (isDevelopment) {
      // In dev mode, output human-readable logs to DevTools console
      const consoleArgs = [`${emoji} ${this.prefix}`, serializedArgs];
      console[consoleMethod](...consoleArgs);

      // Send structured JSON to Main process via IPC for file logging
      const [firstArg, ...restArgs] = args;
      const structuredLog: StructuredLog = {
        __openkosmos_log: true,
        level,
        source: this.source,
        message: serializeArgs([firstArg]),
        timestamp: Date.now(),
      };

      if (restArgs.length > 0) {
        structuredLog.args = serializeArgs(restArgs);
      }

      // Send via IPC instead of console.log to avoid duplicate DevTools output
      if (typeof window !== 'undefined' && (window as any).electronAPI?.logger?.sendLog) {
        (window as any).electronAPI.logger.sendLog(structuredLog);
      }
    } else {
      // Production: just human-readable output (no structured logging)
      const consoleArgs = [`${emoji} ${this.prefix}`, serializedArgs];
      console[consoleMethod](...consoleArgs);
    }
  }

  // Always displayed logs - for important information
  info(...args: any[]): void {
    this.log('INFO', 'log', 'ℹ️', args);
  }

  // Always displayed warnings
  warn(...args: any[]): void {
    this.log('WARN', 'warn', '⚠️', args);
  }

  // Always displayed errors
  error(...args: any[]): void {
    this.log('ERROR', 'error', '❌', args);
  }

  // Success messages - also displayed in production mode
  success(...args: any[]): void {
    this.log('INFO', 'log', '✅', args);
  }

  // Debug information - only displayed in development mode
  debug(...args: any[]): void {
    if (isDevelopment) {
      this.log('DEBUG', 'log', '🔍', args);
    }
  }

  // Verbose information - only displayed in development mode
  verbose(...args: any[]): void {
    if (isDevelopment) {
      this.log('VERBOSE', 'log', '📝', args);
    }
  }

  // Performance information - only displayed in development mode
  perf(label: string, fn?: () => void): void {
    if (isDevelopment) {
      if (fn) {
        const start = performance.now();
        fn();
        const duration = performance.now() - start;
        this.log('PERF', 'log', '⚡', [`${label} took ${duration.toFixed(2)}ms`]);
      } else {
        this.log('PERF', 'log', '⚡', [label]);
      }
    }
  }

  // Startup information - also displayed in production mode
  startup(...args: any[]): void {
    this.log('SYSTEM', 'log', '🚀', args);
  }

  // System information - also displayed in production mode
  system(...args: any[]): void {
    this.log('SYSTEM', 'log', '🔧', args);
  }
}

// Create default instance
export const logger = Logger.getInstance('[Renderer]');

// Create specific module log instance
export const createLogger = (prefix: string) => new Logger(prefix);
