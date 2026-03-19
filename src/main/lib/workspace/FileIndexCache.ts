/**
 * File Index Cache
 * Incremental file index cache (deprecated - no longer used)
 * @deprecated This module is no longer used. Use ripgrep search instead.
 */

import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import type { IFileSearchResult } from './SearchService';

// Locally defined types (no longer imported from WorkspaceWatcher)
interface IFileChange {
  type: FileChangeType;
  path: string;
}

enum FileChangeType {
  UPDATED = 0,
  ADDED = 1,
  DELETED = 2
}

export interface FileIndexEntry {
  path: string;                // Relative path
  name: string;                // Filename/directory name
  directory: string;           // Containing directory
  extension: string;           // File extension (empty for directories)
  size: number;                // File size
  mtime: number;               // Modification time
  isDirectory?: boolean;       // Whether it is a directory
}

export class FileIndexCache extends EventEmitter {
  private index = new Map<string, FileIndexEntry>();
  private directoryIndex = new Map<string, FileIndexEntry>();
  private isIndexing = false;
  private indexingProgress = 0;
  
  constructor(private workspaceRoot: string) {
    super();
  }

  /**
   * Build complete index
   */
  async buildIndex(): Promise<void> {
    if (this.isIndexing) {
      return;
    }

    this.isIndexing = true;
    this.indexingProgress = 0;
    this.index.clear();
    this.directoryIndex.clear();

    const startTime = Date.now();

    try {
      await this.scanDirectory(this.workspaceRoot, this.workspaceRoot);
      
      const duration = Date.now() - startTime;

      this.emit('indexComplete', {
        fileCount: this.index.size,
        directoryCount: this.directoryIndex.size,
        duration
      });
    } catch (error) {
      this.emit('indexError', error);
    } finally {
      this.isIndexing = false;
      this.indexingProgress = 100;
    }
  }

  /**
   * Recursively scan directory
   */
  private async scanDirectory(dir: string, rootDir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Exclude rules
      if (this.shouldExclude(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      const normalizedPath = relativePath.replace(/\\/g, '/');

      if (entry.isDirectory()) {
        // Add directory to index
        try {
          const stats = await fs.promises.stat(fullPath);
          this.directoryIndex.set(normalizedPath, {
            path: normalizedPath,
            name: entry.name,
            directory: path.dirname(normalizedPath),
            extension: '',
            size: 0,
            mtime: stats.mtimeMs,
            isDirectory: true
          });
        } catch (error) {
        }

        // Recursively scan subdirectories
        await this.scanDirectory(fullPath, rootDir);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.promises.stat(fullPath);
          
          this.index.set(normalizedPath, {
            path: normalizedPath,
            name: entry.name,
            directory: path.dirname(normalizedPath),
            extension: path.extname(entry.name).toLowerCase().slice(1),
            size: stats.size,
            mtime: stats.mtimeMs,
            isDirectory: false
          });
        } catch (error) {
        }
      }
    }
  }

  /**
   * Handle file change events (incremental update)
   */
  async handleFileChanges(changes: IFileChange[]): Promise<void> {

    for (const change of changes) {
      const normalizedPath = change.path.replace(/\\/g, '/');
      
      switch (change.type) {
        case 0: // UPDATED
          await this.updateFile(normalizedPath);
          break;
        case 1: // ADDED
          await this.addFile(normalizedPath);
          break;
        case 2: // DELETED
          this.deleteFile(normalizedPath);
          break;
      }
    }

    this.emit('indexUpdated', {
      changesProcessed: changes.length,
      totalFiles: this.index.size
    });
  }

  /**
   * Add file to index
   */
  private async addFile(relativePath: string): Promise<void> {
    try {
      const fullPath = path.join(this.workspaceRoot, relativePath);
      const stats = await fs.promises.stat(fullPath);
      
      if (!stats.isFile()) {
        return;
      }

      const fileName = path.basename(relativePath);
      
      this.index.set(relativePath, {
        path: relativePath,
        name: fileName,
        directory: path.dirname(relativePath),
        extension: path.extname(fileName).toLowerCase().slice(1),
        size: stats.size,
        mtime: stats.mtimeMs
      });

    } catch (error) {
    }
  }

  /**
   * Update file index
   */
  private async updateFile(relativePath: string): Promise<void> {
    // Same logic as add
    await this.addFile(relativePath);
  }

  /**
   * Delete file from index
   */
  private deleteFile(relativePath: string): void {
    this.index.delete(relativePath);
  }

  /**
   * Search files and/or directories
   * Strategy: take top maxResults from files and directories separately, merge, sort, then take final top maxResults
   */
  search(
    pattern?: string,
    options?: {
      maxResults?: number;
      fuzzy?: boolean;
      includePattern?: string;
      excludePattern?: string;
      searchTarget?: 'files' | 'folders' | 'both';
    }
  ): IFileSearchResult[] {
    const maxResults = options?.maxResults || 100;
    const searchTarget = options?.searchTarget || 'both';
    

    // Phase 1: collect candidate results from files and directories separately
    const fileResults: IFileSearchResult[] = [];
    const directoryResults: IFileSearchResult[] = [];

    // Search files
    if (searchTarget === 'files' || searchTarget === 'both') {
      for (const entry of this.index.values()) {
        // Check if matches pattern
        if (pattern && !this.matchesPattern(entry, pattern, options?.fuzzy)) {
          continue;
        }

        // Check include/exclude patterns
        if (options?.includePattern && !entry.path.includes(options.includePattern)) {
          continue;
        }
        if (options?.excludePattern && entry.path.includes(options.excludePattern)) {
          continue;
        }

        fileResults.push({
          path: entry.path,
          score: this.calculateScore(entry, pattern),
          isDirectory: false
        });
      }
      
      // Sort file results and take top maxResults
      fileResults.sort((a, b) => (b.score || 0) - (a.score || 0));
      fileResults.splice(maxResults); // Keep only the first maxResults items
    }

    // Search directories
    if (searchTarget === 'folders' || searchTarget === 'both') {
      for (const entry of this.directoryIndex.values()) {
        // Check if matches pattern
        if (pattern && !this.matchesPattern(entry, pattern, options?.fuzzy)) {
          continue;
        }

        // Check include/exclude patterns
        if (options?.includePattern && !entry.path.includes(options.includePattern)) {
          continue;
        }
        if (options?.excludePattern && entry.path.includes(options.excludePattern)) {
          continue;
        }

        directoryResults.push({
          path: entry.path,
          score: this.calculateScore(entry, pattern),
          isDirectory: true
        });
      }
      
      // Sort directory results and take top maxResults
      directoryResults.sort((a, b) => (b.score || 0) - (a.score || 0));
      directoryResults.splice(maxResults); // Keep only the first maxResults items
    }

    // Phase 2: merge top results from files and directories, sort again, take final top maxResults
    const allResults = [...fileResults, ...directoryResults];
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    // Limit final result count
    const results = allResults.slice(0, maxResults);
    

    return results;
  }

  /**
   * Match pattern
   */
  private matchesPattern(entry: FileIndexEntry, pattern: string, fuzzy?: boolean): boolean {
    const patternLower = pattern.toLowerCase();
    const fileNameLower = entry.name.toLowerCase();
    const pathLower = entry.path.toLowerCase();

    if (fuzzy) {
      return this.fuzzyMatch(fileNameLower, patternLower) || 
             this.fuzzyMatch(pathLower, patternLower);
    } else {
      return fileNameLower.includes(patternLower) || 
             pathLower.includes(patternLower);
    }
  }

  /**
   * Fuzzy matching
   */
  private fuzzyMatch(text: string, pattern: string): boolean {
    let patternIndex = 0;
    for (let i = 0; i < text.length && patternIndex < pattern.length; i++) {
      if (text[i] === pattern[patternIndex]) {
        patternIndex++;
      }
    }
    return patternIndex === pattern.length;
  }

  /**
   * Calculate match score
   */
  private calculateScore(entry: FileIndexEntry, pattern?: string): number {
    if (!pattern) {
      return 0;
    }

    const patternLower = pattern.toLowerCase();
    const fileNameLower = entry.name.toLowerCase();

    // Exact match
    if (fileNameLower === patternLower) {
      return 100;
    }

    // Filename prefix match
    if (fileNameLower.startsWith(patternLower)) {
      return 90;
    }

    // Filename contains
    if (fileNameLower.includes(patternLower)) {
      return 80;
    }

    // Path contains
    if (entry.path.toLowerCase().includes(patternLower)) {
      return 70;
    }

    return 0;
  }

  /**
   * Whether to exclude
   */
  private shouldExclude(name: string): boolean {
    const excludePatterns = [
      'node_modules',
      '.git',
      '.vscode',
      '.idea',
      'dist',
      'build',
      'out',
      '.next',
      'coverage',
      '.DS_Store',
      'Thumbs.db'
    ];

    return excludePatterns.includes(name) || name.startsWith('.');
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalFiles: number;
    totalDirectories: number;
    isIndexing: boolean;
    progress: number;
  } {
    return {
      totalFiles: this.index.size,
      totalDirectories: this.directoryIndex.size,
      isIndexing: this.isIndexing,
      progress: this.indexingProgress
    };
  }

  /**
   * Clear index
   */
  clear(): void {
    this.index.clear();
    this.directoryIndex.clear();
  }
}