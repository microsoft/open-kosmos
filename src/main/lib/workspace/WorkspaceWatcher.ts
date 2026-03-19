/**
 * WorkspaceWatcher - Workspace search, file tree service, and file system monitoring
 * Uses ripgrep for high-performance file search and file tree building
 * Integrates FileSystemWatcher for real-time file system monitoring
 */

import { WorkspaceSearchService } from './SearchService';
import type { IFileSearchQuery, ISearchComplete } from './SearchService';
import { FileTreeService } from './FileTreeService';
import type { FileTreeQuery, FileTreeResult } from './FileTreeService';
import { FileSystemWatcher } from './FileSystemWatcher';
import type { FileChange, WatcherOptions, WatcherStats } from './FileSystemWatcher';
import { EventEmitter } from 'events';

/**
 * WorkspaceWatcher - Provides workspace file search, file tree, and file system monitoring capabilities
 *
 * Features:
 * 1. High-performance file search using ripgrep
 * 2. Supports file and directory search
 * 3. Supports fuzzy matching and regex
 * 4. Automatic search result caching
 * 5. High-performance file tree building based on ripgrep --files
 * 6. Real-time file system monitoring and change notifications
 * 7. VSCode-style file change event handling
 */
export class WorkspaceWatcher extends EventEmitter {
  /**
   * File search service
   */
  private searchService: WorkspaceSearchService;
  
  /**
   * File tree service
   */
  private fileTreeService: FileTreeService;

  /**
   * File system watcher
   */
  private fileSystemWatcher: FileSystemWatcher;
  
  constructor() {
    super();
    this.searchService = new WorkspaceSearchService();
    this.fileTreeService = new FileTreeService();
    this.fileSystemWatcher = new FileSystemWatcher();

    // Set up file system watcher event forwarding
    this.setupFileSystemWatcherEvents();
  }
  
  /**
   * Search workspace files
   * @param query Search query
   * @param onProgress Progress callback
   * @returns Search results
   */
  async searchFiles(
    query: IFileSearchQuery,
    onProgress?: (result: any) => void
  ): Promise<ISearchComplete> {
    
    // Use ripgrep search service
    return await this.searchService.fileSearch(query, onProgress);
  }
  
  /**
   * Get file tree
   * @param query File tree query options
   * @returns File tree result
   */
  async getFileTree(query: FileTreeQuery): Promise<FileTreeResult> {
    return await this.fileTreeService.getFileTree(query);
  }
  
  /**
   * Quickly get file list (without building tree structure)
   * @param query File tree query options
   * @returns Array of file paths
   */
  async getFileList(query: FileTreeQuery): Promise<string[]> {
    return await this.fileTreeService.getFileList(query);
  }
  
  /**
   * Clear file tree cache
   * @param folder Optional folder path; if provided, only clears the cache for that folder
   */
  clearFileTreeCache(folder?: string): void {
    this.fileTreeService.clearCache(folder);
  }
  
  // ========== File system monitoring features ==========

  /**
   * Start monitoring workspace file changes (smart monitoring with path validation)
   * @param watchPath Watch path
   * @param options Watch options
   */
  async startFileWatch(watchPath: string, options: WatcherOptions = {}): Promise<void> {
    
    // Validate watch path safety
    if (!this.isValidWatchPath(watchPath)) {
      throw new Error(`Invalid watch path: ${watchPath}. Path must be an absolute path to an existing directory.`);
    }

    // Set default exclude patterns
    const defaultExcludes = [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '.next/**',
      'out/**',
      'coverage/**',
      '.vscode/**',
      '.idea/**',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      'logs/**',
      '.cache/**',
      'tmp/**',
      'temp/**'
    ];

    const watchOptions: WatcherOptions = {
      excludes: [...defaultExcludes, ...(options.excludes || [])],
      includes: options.includes,
      recursive: options.recursive !== false, // Recursive by default
      ignoreInitial: options.ignoreInitial !== false, // Ignore initial scan by default
      ...options
    };


    await this.fileSystemWatcher.startWatch(watchPath, watchOptions);
  }

  /**
   * Validate whether the watch path is valid and safe
   * @param watchPath Path to validate
   */
  private isValidWatchPath(watchPath: string): boolean {
    try {
      // Check if the path is a string
      if (typeof watchPath !== 'string' || !watchPath.trim()) {
        return false;
      }

      // Check if the path is absolute
      const path = require('path');
      if (!path.isAbsolute(watchPath)) {
        return false;
      }

      // Check if the path exists
      const fs = require('fs');
      if (!fs.existsSync(watchPath)) {
        return false;
      }

      // Check if it is a directory
      const stats = fs.statSync(watchPath);
      if (!stats.isDirectory()) {
        return false;
      }

      // Safety check: avoid watching sensitive system directories
      const dangerousPaths = [
        '/System',
        '/Windows',
        '/usr/bin',
        '/usr/sbin',
        '/bin',
        '/sbin'
      ];

      const normalizedPath = path.resolve(watchPath);
      for (const dangerousPath of dangerousPaths) {
        if (normalizedPath.startsWith(dangerousPath)) {
          return false;
        }
      }

      return true;

    } catch (error) {
      return false;
    }
  }

  /**
   * Stop monitoring workspace file changes
   */
  async stopFileWatch(): Promise<void> {
    await this.fileSystemWatcher.stopWatch();
  }

  /**
   * Check if file changes are being monitored
   */
  isWatchingFiles(): boolean {
    return this.fileSystemWatcher.isWatching();
  }

  /**
   * Get file watcher statistics
   */
  getWatcherStats(): WatcherStats {
    return this.fileSystemWatcher.getStats();
  }

  /**
   * Set up file system watcher event forwarding
   */
  private setupFileSystemWatcherEvents(): void {
    // Forward file change events
    this.fileSystemWatcher.on('change', (changes: FileChange[]) => {
      this.emit('fileChanged', changes);
    });

    // Forward error events
    this.fileSystemWatcher.on('error', (errorInfo: { error: Error; path: string }) => {
      this.emit('watchError', errorInfo.error);
    });

    // Forward ready events
    this.fileSystemWatcher.on('ready', (info: { path: string }) => {
      this.emit('watchReady', info);
    });

    // Forward stopped events
    this.fileSystemWatcher.on('stopped', () => {
      this.emit('watchStopped');
    });
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    
    // Stop file system monitoring
    await this.fileSystemWatcher.dispose();
    
    // Clear search cache
    this.searchService.clearCache();
    
    // Clear file tree cache
    this.fileTreeService.clearCache();
    
    // Remove all listeners
    this.removeAllListeners();
  }
}

/**
 * Global WorkspaceWatcher instance
 */
let globalWatcher: WorkspaceWatcher | null = null;

/**
 * Get global WorkspaceWatcher instance
 */
export function getWorkspaceWatcher(): WorkspaceWatcher {
  if (!globalWatcher) {
    globalWatcher = new WorkspaceWatcher();
  }
  return globalWatcher;
}

/**
 * Dispose global WorkspaceWatcher instance
 */
export async function disposeWorkspaceWatcher(): Promise<void> {
  if (globalWatcher) {
    await globalWatcher.dispose();
    globalWatcher = null;
  }
}