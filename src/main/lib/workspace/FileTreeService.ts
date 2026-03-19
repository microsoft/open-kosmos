/**
 * FileTreeService - High-performance file tree service based on ripgrep --files
 *
 * Core advantages:
 * 1. Ultra-fast retrieval: ripgrep --files is 10-100x faster than recursive scanning
 * 2. Smart caching: Supports incremental updates and expiration policies
 * 3. Memory optimized: Stream processing to avoid memory overflow with large file counts
 * 4. Flexible filtering: Supports glob patterns and regular expressions
 * 5. Complete information: Includes file/directory metadata such as size and modification time
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';

// Get ripgrep path (reuses the complete logic from RipgrepSearchEngine)
function getRipgrepPath(): string {
  const fsSync = require('fs');
  
  try {
    // Method 1: Try to get path through @vscode/ripgrep package
    const rgPathFromPackage = require('@vscode/ripgrep').rgPath;
    
    // Check if path is valid
    if (rgPathFromPackage && fsSync.existsSync(rgPathFromPackage)) {
      return rgPathFromPackage;
    }
    
  } catch (error) {
  }
  
  // Method 2: Use process.cwd() as base path
  try {
    const platform = process.platform;
    const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
    
    
    // Possible paths list (using process.cwd() as base)
    const possiblePaths = [
      // Development environment: from current working directory
      path.join(process.cwd(), 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // Electron app: from resources directory
      path.join(process.resourcesPath || process.cwd(), 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // .asar.unpacked directory
      path.join(process.resourcesPath || process.cwd(), 'app.asar.unpacked', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // Relative path from __dirname (after Webpack bundling)
      path.join(__dirname, '..', '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      path.join(__dirname, '..', '..', '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
    ];
    
    // Try each possible path
    for (const testPath of possiblePaths) {
      const normalizedPath = path.normalize(testPath);
      if (fsSync.existsSync(normalizedPath)) {
        return normalizedPath;
      }
    }
    
  } catch (error) {
  }
  
  return '';
}

// Initialize ripgrep path
const rgPath = getRipgrepPath();
if (rgPath) {
} else {
}

/**
 * File tree node
 */
export interface FileTreeNode {
  path: string;           // Relative path
  name: string;           // File/directory name
  isDirectory: boolean;   // Whether it is a directory
  size?: number;          // File size (bytes)
  mtime?: number;         // Modification time (ms)
  children?: FileTreeNode[]; // Children nodes (directories only)
}

/**
 * File tree query options
 */
export interface FileTreeQuery {
  folder: string;              // Workspace root directory (absolute path)
  maxDepth?: number;           // Maximum depth (undefined = unlimited)
  includePattern?: string;     // Include pattern (glob, e.g., "*.ts,*.js")
  excludePattern?: string;     // Exclude pattern (glob, e.g., "node_modules,dist")
  includeHidden?: boolean;     // Whether to include hidden files (default false)
  useGitignore?: boolean;      // Whether to respect .gitignore (default true)
  includeMetadata?: boolean;   // Whether to include file metadata (default false for better performance)
}

/**
 * File tree statistics
 */
export interface FileTreeStats {
  totalFiles: number;
  totalDirectories: number;
  duration: number;          // Build duration (ms)
  cacheHit: boolean;
}

/**
 * File tree result
 */
export interface FileTreeResult {
  root: FileTreeNode;
  flatList: string[];        // Flattened file path list
  stats: FileTreeStats;
}

/**
 * Cache entry
 */
interface CacheEntry {
  result: FileTreeResult;
  timestamp: number;
  query: FileTreeQuery;
}

/**
 * FileTreeService - High-performance file tree service
 */
export class FileTreeService extends EventEmitter {
  private cache = new Map<string, CacheEntry>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes expiration
  private rgPath: string;

  // Large directory protection: file count limit and timeout
  private static readonly MAX_FILES = 100_000;
  private static readonly MAX_SCAN_TIMEOUT_MS = 30_000; // 30 seconds

  constructor() {
    super();
    this.rgPath = rgPath;
    
    if (!this.isAvailable()) {
    } else {
    }
  }

  /**
   * Check if ripgrep is available
   */
  isAvailable(): boolean {
    return Boolean(this.rgPath);
  }

  /**
   * Get file tree
   * @param query Query options
   * @returns File tree result
   */
  async getFileTree(query: FileTreeQuery): Promise<FileTreeResult> {
    const cacheKey = this.getCacheKey(query);
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return {
        ...cached.result,
        stats: {
          ...cached.result.stats,
          cacheHit: true
        }
      };
    }

    const startTime = Date.now();

    try {
      // Use ripgrep --files to get all files
      const files = await this.listFilesWithRipgrep(query);
      

      // Build file tree structure
      const root = await this.buildTree(files, query);
      
      // Collect statistics
      const stats: FileTreeStats = {
        totalFiles: files.length,
        totalDirectories: this.countDirectories(root),
        duration: Date.now() - startTime,
        cacheHit: false
      };

      const result: FileTreeResult = {
        root,
        flatList: files,
        stats
      };

      // Cache result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now(),
        query
      });

      // Set cache expiration cleanup
      setTimeout(() => {
        this.cache.delete(cacheKey);
      }, this.cacheTimeout);

      this.emit('treeBuilt', stats);

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * List all files using ripgrep --files
   *
   * Performance advantages:
   * - ripgrep uses parallel processing and optimized filesystem traversal
   * - Native support for .gitignore and glob patterns
   * - 10-100x faster than Node.js fs.readdir recursion
   */
  private async listFilesWithRipgrep(query: FileTreeQuery): Promise<string[]> {
    if (!this.isAvailable()) {
      throw new Error('Ripgrep is not available');
    }

    const args = this.buildRipgrepArgs(query);
    

    return new Promise((resolve, reject) => {
      const files: string[] = [];
      let truncated = false;
      const rg = spawn(this.rgPath, args, {
        cwd: query.folder,
        shell: false
      });

      let buffer = '';

      // Timeout protection: large directory scanning does not exceed MAX_SCAN_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        truncated = true;
        rg.kill('SIGTERM');
      }, FileTreeService.MAX_SCAN_TIMEOUT_MS);

      rg.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            // Normalize path separators
            files.push(trimmed.replace(/\\/g, '/'));
          }
        }

        // File count limit protection: terminate ripgrep immediately if exceeds MAX_FILES
        if (!truncated && files.length >= FileTreeService.MAX_FILES) {
          truncated = true;
          rg.kill('SIGTERM');
        }
      });

      rg.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.trim()) {
        }
      });

      rg.on('close', (code) => {
        clearTimeout(timeoutHandle);
        // Process remaining buffer
        if (buffer.trim()) {
          files.push(buffer.trim().replace(/\\/g, '/'));
        }

        if (truncated) {
          // Directory too large, return collected files (truncated)
          resolve(files);
          return;
        }
        
        // ripgrep exit codes: 0 = success, 1 = no matches found (still successful)
        if (code === 0 || code === 1) {
          resolve(files);
        } else {
          reject(new Error(`Ripgrep exited with code ${code}`));
        }
      });

      rg.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Build ripgrep command arguments
   */
  private buildRipgrepArgs(query: FileTreeQuery): string[] {
    const args: string[] = [];

    // Core command: list files
    args.push('--files');
    
    // Output format
    args.push('--color=never');
    args.push('--no-messages');
    
    // Symbolic links
    args.push('--follow');
    
    // Hidden files
    if (query.includeHidden) {
      args.push('--hidden');
    }
    
    // Maximum depth
    if (query.maxDepth !== undefined) {
      args.push('--max-depth', String(query.maxDepth));
    }

    // Default exclude patterns (similar to VSCode)
    const defaultExcludes = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.next',
      'coverage',
      '.DS_Store',
      'Thumbs.db',
      '*.log'
    ];

    for (const pattern of defaultExcludes) {
      args.push('--glob', `!${pattern}`);
    }

    // User-defined exclude patterns
    if (query.excludePattern) {
      const patterns = query.excludePattern.split(',').map(p => p.trim());
      for (const pattern of patterns) {
        args.push('--glob', `!${pattern}`);
      }
    }

    // User-defined include patterns
    if (query.includePattern) {
      const patterns = query.includePattern.split(',').map(p => p.trim());
      for (const pattern of patterns) {
        args.push('--glob', pattern);
      }
    }

    return args;
  }

  /**
   * Build tree structure from file list
   */
  private async buildTree(files: string[], query: FileTreeQuery): Promise<FileTreeNode> {
    const root: FileTreeNode = {
      path: '',
      name: path.basename(query.folder),
      isDirectory: true,
      children: []
    };

    // Collect all directories (inferred from file paths)
    const dirSet = new Set<string>();
    for (const file of files) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirSet.add(parts.slice(0, i).join('/'));
      }
    }

    // Asynchronously scan all empty directories (ripgrep --files doesn't return empty directories)
    await this.scanEmptyDirectoriesAsync(query.folder, '', dirSet, query);

    // Create directory node mapping
    const nodeMap = new Map<string, FileTreeNode>();
    nodeMap.set('', root);

    // Create all directory nodes
    const sortedDirs = Array.from(dirSet).sort();
    for (const dirPath of sortedDirs) {
      const parts = dirPath.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      
      const node: FileTreeNode = {
        path: dirPath,
        name,
        isDirectory: true,
        children: []
      };
      
      nodeMap.set(dirPath, node);
      
      const parent = nodeMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }

    // Add file nodes
    for (const filePath of files) {
      const parts = filePath.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      
      const node: FileTreeNode = {
        path: filePath,
        name,
        isDirectory: false
      };
      
      const parent = nodeMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }

    // If metadata is needed, add asynchronously (non-blocking)
    if (query.includeMetadata) {
      this.addMetadataAsync(nodeMap, query.folder);
    }

    return root;
  }

  /**
   * Add file metadata asynchronously (non-blocking)
   */
  private async addMetadataAsync(
    nodeMap: Map<string, FileTreeNode>,
    rootFolder: string
  ): Promise<void> {
    const nodes = Array.from(nodeMap.values());
    
    // Batch processing to avoid opening too many files at once
    const batchSize = 100;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (node) => {
          try {
            const fullPath = path.join(rootFolder, node.path);
            const stats = await fs.stat(fullPath);
            node.size = stats.size;
            node.mtime = stats.mtimeMs;
          } catch (error) {
            // Ignore errors, continue processing other files
          }
        })
      );
    }
    
    this.emit('metadataLoaded');
  }

  /**
   * Count number of directories
   */
  private countDirectories(node: FileTreeNode): number {
    let count = node.isDirectory ? 1 : 0;
    
    if (node.children) {
      for (const child of node.children) {
        count += this.countDirectories(child);
      }
    }
    
    return count;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(query: FileTreeQuery): string {
    return JSON.stringify({
      folder: query.folder,
      maxDepth: query.maxDepth,
      includePattern: query.includePattern,
      excludePattern: query.excludePattern,
      includeHidden: query.includeHidden,
      useGitignore: query.useGitignore
    });
  }

  /**
   * Clear cache
   */
  clearCache(folder?: string): void {
    if (folder) {
      // Clear cache for specific directory
      for (const [key, entry] of this.cache.entries()) {
        if (entry.query.folder === folder) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all caches
      this.cache.clear();
    }
    
  }

  /**
   * Scan empty directories asynchronously
   * ripgrep --files only returns files, not empty directories
   * This method supplements scanning of empty directories (using async fs.readdir to avoid blocking main thread)
   */
  private async scanEmptyDirectoriesAsync(
    rootFolder: string,
    relativePath: string,
    dirSet: Set<string>,
    query: FileTreeQuery,
    currentDepth: number = 0
  ): Promise<void> {
    const fullPath = path.join(rootFolder, relativePath);
    
    // Check if maximum depth limit is exceeded
    if (query.maxDepth !== undefined && currentDepth >= query.maxDepth) {
      return;
    }

    // Directory count limit protection to avoid infinite recursion in huge directories
    if (dirSet.size >= FileTreeService.MAX_FILES) {
      return;
    }
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const subDirPromises: Promise<void>[] = [];

      for (const entry of entries) {
        // Skip hidden files/directories (unless explicitly included)
        if (!query.includeHidden && entry.name.startsWith('.')) {
          continue;
        }
        
        // Skip default excluded directories
        const defaultExcludes = [
          'node_modules', '.git', 'dist', 'build', 'out',
          '.next', 'coverage', '.DS_Store', 'Thumbs.db'
        ];
        if (defaultExcludes.includes(entry.name)) {
          continue;
        }
        
        // Only process directories
        if (entry.isDirectory()) {
          const childRelativePath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
          
          // Add to directory set
          dirSet.add(childRelativePath);

          // Concurrently scan subdirectories recursively
          subDirPromises.push(
            this.scanEmptyDirectoriesAsync(rootFolder, childRelativePath, dirSet, query, currentDepth + 1)
          );
        }
      }

      await Promise.all(subDirPromises);
    } catch (error) {
      // Ignore permission errors, etc.
    }
  }

  /**
   * Get flattened file list (fast retrieval, no tree construction)
   */
  async getFileList(query: FileTreeQuery): Promise<string[]> {
    return await this.listFilesWithRipgrep(query);
  }
}

/**
 * Global singleton
 */
let globalService: FileTreeService | null = null;

export function getFileTreeService(): FileTreeService {
  if (!globalService) {
    globalService = new FileTreeService();
  }
  return globalService;
}

export function disposeFileTreeService(): void {
  if (globalService) {
    globalService.clearCache();
    globalService = null;
  }
}