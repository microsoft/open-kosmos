/**
 * Smart logging system
 * Display all logs in development mode, only important information in production mode
 */

const isDevelopment = process.env.NODE_ENV === 'development';

export class Logger {
  private static instance: Logger;
  private prefix: string;

  constructor(prefix: string = '[App]') {
    this.prefix = prefix;
  }

  static getInstance(prefix?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(prefix);
    }
    return Logger.instance;
  }

  // Always displayed logs - for important information
  info(...args: any[]): void {
    console.log(`ℹ️ ${this.prefix}`, ...args);
  }

  // Always displayed warnings
  warn(...args: any[]): void {
    console.warn(`⚠️ ${this.prefix}`, ...args);
  }

  // Always displayed errors
  error(...args: any[]): void {
    console.error(`❌ ${this.prefix}`, ...args);
  }

  // Success messages - also displayed in production mode
  success(...args: any[]): void {
    console.log(`✅ ${this.prefix}`, ...args);
  }

  // Debug information - only displayed in development mode
  debug(...args: any[]): void {
    if (isDevelopment) {
      console.log(`🔍 ${this.prefix}`, ...args);
    }
  }

  // Verbose information - only displayed in development mode
  verbose(...args: any[]): void {
    if (isDevelopment) {
      console.log(`📝 ${this.prefix}`, ...args);
    }
  }

  // Performance information - only displayed in development mode
  perf(label: string, fn?: () => void): void {
    if (isDevelopment) {
      if (fn) {
        console.time(`⚡ ${this.prefix} ${label}`);
        fn();
        console.timeEnd(`⚡ ${this.prefix} ${label}`);
      } else {
        console.log(`⚡ ${this.prefix} ${label}`);
      }
    }
  }

  // Startup information - also displayed in production mode
  startup(...args: any[]): void {
    console.log(`🚀 ${this.prefix}`, ...args);
  }

  // System information - also displayed in production mode
  system(...args: any[]): void {
    console.log(`🔧 ${this.prefix}`, ...args);
  }
}

// Create default instance
export const logger = Logger.getInstance('[Renderer]');

// Create specific module log instance
export const createLogger = (prefix: string) => new Logger(prefix);
