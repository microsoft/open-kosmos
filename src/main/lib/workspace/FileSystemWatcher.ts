/**
 * File System Watcher
 *
 * Implementation based on VSCode's ParcelWatcher and NodeJS.watcher
 * Provides high-performance file system change monitoring
 * Reference: vs/platform/files/node/watcher/parcel/parcelWatcher.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * File change type (kept in sync with the frontend)
 */
export enum FileChangeType {
  UPDATED = 0,
  ADDED = 1,
  DELETED = 2
}

/**
 * File change event
 */
export interface FileChange {
  type: FileChangeType;
  path: string;
}

/**
 * Watcher options
 */
export interface WatcherOptions {
  /** List of exclude patterns */
  excludes?: string[];
  /** List of include patterns */
  includes?: string[];
  /** Whether to recursively watch subdirectories */
  recursive?: boolean;
  /** Whether to ignore the initial scan */
  ignoreInitial?: boolean;
}

/**
 * Watcher statistics
 */
export interface WatcherStats {
  /** The root path being watched */
  watchedPath: string | null;
  /** Whether watching is active */
  isWatching: boolean;
  /** Time when watching started */
  startTime: number | null;
  /** Number of detected changes */
  changeCount: number;
  /** Time of the last change */
  lastChangeTime: number | null;
  /** Number of errors */
  errorCount: number;
  /** Last error message */
  lastError: string | null;
}

/**
 * File system watcher implementation
 *
 * Built on Node.js fs.watch, following VSCode's design patterns:
 * 1. Event coalescing and deduplication
 * 2. Pattern matching (excludes/includes)
 * 3. Error handling and retries
 * 4. Performance optimizations
 */
export class FileSystemWatcher extends EventEmitter {
  private watchers = new Map<string, fs.FSWatcher>();
  private watchedPath: string | null = null;
  private options: WatcherOptions = {};
  private stats: WatcherStats;

  // Event coalescing
  private pendingChanges = new Map<string, FileChange>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushDelay = 100; // 100ms coalescing delay, shorter than the frontend

  // Pattern matching cache
  private excludeRegexes: RegExp[] = [];
  private includeRegexes: RegExp[] = [];

  constructor() {
    super();
    this.stats = {
      watchedPath: null,
      isWatching: false,
      startTime: null,
      changeCount: 0,
      lastChangeTime: null,
      errorCount: 0,
      lastError: null
    };
  }

  /**
   * Start watching the specified path
   */
  async startWatch(watchPath: string, options: WatcherOptions = {}): Promise<void> {
    // If already watching the same path, return immediately
    if (this.isWatching() && this.watchedPath === watchPath) {
      return;
    }

    // Stop any existing watch
    if (this.isWatching()) {
      await this.stopWatch();
    }

    // Validate path
    if (!fs.existsSync(watchPath)) {
      throw new Error(`Watch path does not exist: ${watchPath}`);
    }

    const stat = await fs.promises.stat(watchPath);
    if (!stat.isDirectory()) {
      throw new Error(`Watch path must be a directory: ${watchPath}`);
    }

    try {

      this.watchedPath = watchPath;
      this.options = {
        recursive: true,
        ignoreInitial: true,
        ...options
      };

      // Compile pattern-matching regular expressions
      this.compilePatterns();

      // Start watching
      await this.setupWatcher(watchPath);

      // Update statistics
      this.stats.watchedPath = watchPath;
      this.stats.isWatching = true;
      this.stats.startTime = Date.now();
      this.stats.changeCount = 0;
      this.stats.lastChangeTime = null;

      this.emit('ready', { path: watchPath });

    } catch (error) {
      this.stats.errorCount++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Stop watching
   */
  async stopWatch(): Promise<void> {
    if (!this.isWatching()) {
      return;
    }


    try {
      // Clear the timer
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      // Close all watchers
      for (const [path, watcher] of this.watchers) {
        try {
          watcher.close();
        } catch (error) {
        }
      }
      this.watchers.clear();

      // Flush remaining changes
      this.flushPendingChanges();

      // Reset state
      this.watchedPath = null;
      this.options = {};
      this.pendingChanges.clear();
      this.excludeRegexes = [];
      this.includeRegexes = [];

      // Update statistics
      this.stats.watchedPath = null;
      this.stats.isWatching = false;
      this.stats.startTime = null;

      this.emit('stopped');

    } catch (error) {
      this.stats.errorCount++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Check whether watching is active
   */
  isWatching(): boolean {
    return this.stats.isWatching && this.watchers.size > 0;
  }

  /**
   * Get watcher statistics
   */
  getStats(): WatcherStats {
    return { ...this.stats };
  }

  /**
   * Set up the watcher
   */
  private async setupWatcher(watchPath: string): Promise<void> {
    try {
      // Use fs.watch to monitor the root directory
      const watcher = fs.watch(
        watchPath,
        { recursive: this.options.recursive },
        (eventType, filename) => {
          this.handleFileSystemEvent(eventType, filename, watchPath);
        }
      );

      watcher.on('error', (error) => {
        this.handleWatcherError(error, watchPath);
      });

      this.watchers.set(watchPath, watcher);

    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle a file system event
   */
  private handleFileSystemEvent(
    eventType: string,
    filename: string | null,
    watchRoot: string
  ): void {
    if (!filename) {
      return;
    }

    const fullPath = path.join(watchRoot, filename);

    // Check whether the path matches the configured patterns
    if (!this.shouldIncludePath(fullPath)) {
      return;
    }

    // Determine the type of change
    let changeType: FileChangeType;

    try {
      const exists = fs.existsSync(fullPath);

      if (eventType === 'rename') {
        changeType = exists ? FileChangeType.ADDED : FileChangeType.DELETED;
      } else if (eventType === 'change') {
        changeType = exists ? FileChangeType.UPDATED : FileChangeType.DELETED;
      } else {
        // Default case
        changeType = exists ? FileChangeType.UPDATED : FileChangeType.DELETED;
      }
    } catch (error) {
      // If the file cannot be accessed, assume it was deleted
      changeType = FileChangeType.DELETED;
    }

    const change: FileChange = {
      type: changeType,
      path: fullPath
    };

    this.addPendingChange(change);
  }

  /**
   * Handle a watcher error
   */
  private handleWatcherError(error: Error, watchPath: string): void {
    this.stats.errorCount++;
    this.stats.lastError = error.message;

    this.emit('error', { error, path: watchPath });
  }

  /**
   * Add a pending change
   */
  private addPendingChange(change: FileChange): void {
    const key = this.normalizePathForKey(change.path);

    // Apply simple coalescing logic
    const existing = this.pendingChanges.get(key);
    if (existing) {
      const merged = this.mergeChanges(existing, change);
      if (merged) {
        this.pendingChanges.set(key, merged);
      } else {
        this.pendingChanges.delete(key);
      }
    } else {
      this.pendingChanges.set(key, change);
    }

    // Schedule flush
    this.scheduleFlush();
  }

  /**
   * Merge two file changes
   */
  private mergeChanges(existing: FileChange, incoming: FileChange): FileChange | null {
    // Basic merge logic (simplified VSCode logic)
    if (existing.type === FileChangeType.ADDED && incoming.type === FileChangeType.DELETED) {
      return null; // CREATE + DELETE = no-op
    }

    if (existing.type === FileChangeType.DELETED && incoming.type === FileChangeType.ADDED) {
      return { type: FileChangeType.UPDATED, path: incoming.path }; // DELETE + CREATE = UPDATE
    }

    // For all other cases, use the latest change
    return incoming;
  }

  /**
   * Schedule a flush
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => this.flushPendingChanges(), this.flushDelay);
  }

  /**
   * Flush pending changes
   */
  private flushPendingChanges(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingChanges.size === 0) {
      return;
    }

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    // Update statistics
    this.stats.changeCount += changes.length;
    this.stats.lastChangeTime = Date.now();

    this.emit('change', changes);
  }

  /**
   * Compile pattern-matching regular expressions
   */
  private compilePatterns(): void {
    this.excludeRegexes = [];
    this.includeRegexes = [];

    // Compile exclude patterns
    if (this.options.excludes) {
      for (const pattern of this.options.excludes) {
        try {
          const regex = this.globToRegex(pattern);
          this.excludeRegexes.push(regex);
        } catch (error) {
        }
      }
    }

    // Compile include patterns
    if (this.options.includes) {
      for (const pattern of this.options.includes) {
        try {
          const regex = this.globToRegex(pattern);
          this.includeRegexes.push(regex);
        } catch (error) {
        }
      }
    }
  }

  /**
   * Convert a glob pattern to a regular expression
   */
  private globToRegex(pattern: string): RegExp {
    // Simple glob-to-regex implementation
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');

    return new RegExp(regexPattern, 'i');
  }

  /**
   * Check whether a path should be included
   */
  private shouldIncludePath(filePath: string): boolean {
    const relativePath = this.watchedPath ?
      path.relative(this.watchedPath, filePath).replace(/\\/g, '/') :
      filePath.replace(/\\/g, '/');

    // Check exclude patterns
    for (const regex of this.excludeRegexes) {
      if (regex.test(relativePath) || regex.test(path.basename(filePath))) {
        return false;
      }
    }

    // If include patterns are present, check them
    if (this.includeRegexes.length > 0) {
      for (const regex of this.includeRegexes) {
        if (regex.test(relativePath) || regex.test(path.basename(filePath))) {
          return true;
        }
      }
      return false; // Include patterns exist but none matched
    }

    return true; // No include patterns — include by default
  }

  /**
   * Normalize a path for use as a map key
   */
  private normalizePathForKey(filePath: string): string {
    return process.platform === 'win32' ?
      filePath.toLowerCase().replace(/\\/g, '/') :
      filePath.replace(/\\/g, '/');
  }

  /**
   * Dispose the watcher
   */
  async dispose(): Promise<void> {
    await this.stopWatch();
    this.removeAllListeners();
  }
}