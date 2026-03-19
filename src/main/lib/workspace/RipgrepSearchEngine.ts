/**
 * Ripgrep Search Engine (Migrated from VSCode)
 * Uses @vscode/ripgrep NPM package for high-performance file search
 * 
 * Core features:
 * 1. Zero configuration - automatically obtains prebuilt binaries via @vscode/ripgrep
 * 2. Cross-platform - supports Windows, macOS, Linux
 * 3. Electron optimized - automatically handles .asar packaging
 * 4. High-performance - based on Rust ripgrep engine
 * 5. VSCode-level Fuzzy Scoring - complete fuzzy matching and sorting algorithm
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { IFileSearchQuery, IFileSearchResult, ISearchComplete, ISearchEngine } from './SearchService';
import {
  prepareQuery,
  compareItemsByFuzzyScore,
  type IPreparedQuery,
  type IItemAccessor,
  type FuzzyScorerCache
} from './fuzzyScorer';

/**
 * Get ripgrep binary path
 * Supports development and packaged environments
 */
function getRipgrepPath(): string {
  try {
    // Method 1: Try to get the path via @vscode/ripgrep package
    const rgPathFromPackage = require('@vscode/ripgrep').rgPath;
    
    // Check if the path is valid
    if (rgPathFromPackage && fs.existsSync(rgPathFromPackage)) {
      return rgPathFromPackage;
    }
    
  } catch (error) {
  }
  
  // Method 2: Use process.cwd() as the base path
  try {
    const platform = process.platform;
    const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
    
    
    // List of possible paths (using process.cwd() as base)
    const possiblePaths = [
      // Development environment: from current working directory
      path.join(process.cwd(), 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // Electron app: from resources directory
      path.join(process.resourcesPath || process.cwd(), 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // .asar.unpacked directory
      path.join(process.resourcesPath || process.cwd(), 'app.asar.unpacked', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      // From __dirname relative path (after Webpack bundling)
      path.join(__dirname, '..', '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      path.join(__dirname, '..', '..', '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
    ];
    
    // Try each possible path
    for (const testPath of possiblePaths) {
      const normalizedPath = path.normalize(testPath);
      if (fs.existsSync(normalizedPath)) {
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
 * File Match Item Accessor for Fuzzy Scoring
 * Defines how to extract label, description, and path from search results
 */
const FileMatchItemAccessor: IItemAccessor<IFileSearchResult> = {
  getItemLabel(match: IFileSearchResult): string {
    return path.basename(match.path); // Filename, e.g. "myFile.txt"
  },

  getItemDescription(match: IFileSearchResult): string {
    return path.dirname(match.path); // Directory, e.g. "some/path/to/file"
  },

  getItemPath(match: IFileSearchResult): string {
    return match.path; // Full relative path
  }
};

/**
 * Ripgrep search engine
 * Uses VSCode's ripgrep integration + Fuzzy Scoring
 */
export class RipgrepSearchEngine implements ISearchEngine {
  private rgPath: string;
  private scorerCache: FuzzyScorerCache = {};

  constructor() {
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
   * Execute file search
   */
  async search(
    query: IFileSearchQuery,
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<ISearchComplete> {
    if (!this.isAvailable()) {
      throw new Error(
        'Ripgrep is not available. @vscode/ripgrep package may not be installed correctly.'
      );
    }

    // Validate folder parameter
    if (!query.folder) {
      throw new Error('Search folder is required for ripgrep search. Please provide a valid workspace path.');
    }

    const startTime = Date.now();
    const results: IFileSearchResult[] = [];
    let filesScanned = 0;


    const searchTarget = query.searchTarget || 'both';

    try {
      // Search files (if needed)
      if (searchTarget === 'files' || searchTarget === 'both') {
        await this.searchFiles(query, results, onProgress, (count) => { filesScanned = count; });
      }

      // Search directories (if needed)
      if (searchTarget === 'folders' || searchTarget === 'both') {
        await this.searchDirectories(query, results, onProgress);
      }


      // Use VSCode's Fuzzy Scorer for scoring and sorting
      if (query.pattern && results.length > 0) {
        await this.scoreAndSortResults(results, query.pattern);
      }

      // Output sorted results (top 10)
      results.slice(0, 10).forEach((result, index) => {
      });

      // Limit result count
      if (query.maxResults && results.length > query.maxResults) {
        results.splice(query.maxResults);
      }

    } catch (error) {
      throw error;
    }

    const duration = Date.now() - startTime;


    return {
      results,
      limitHit: query.maxResults ? results.length >= query.maxResults : false,
      stats: {
        duration,
        filesScanned,
        cacheHit: false
      }
    };
  }

  /**
   * Score and sort results using VSCode Fuzzy Scorer
   */
  private async scoreAndSortResults(results: IFileSearchResult[], pattern: string): Promise<void> {
    // Prepare query
    const preparedQuery: IPreparedQuery = prepareQuery(pattern);
    

    // Sort using VSCode's comparison function
    results.sort((a, b) => 
      compareItemsByFuzzyScore(
        a,
        b,
        preparedQuery,
        true, // allowNonContiguousMatches
        FileMatchItemAccessor,
        this.scorerCache
      )
    );

    // Store scores in results (for debugging and display)
    // Note: compareItemsByFuzzyScore already considers all factors, no need to recalculate
    // But for compatibility, we keep the score field
    results.forEach((result, index) => {
      // Assign score based on sort position (higher position = higher score)
      result.score = 1000 - index;
    });
  }

  /**
   * Search files
   */
  private async searchFiles(
    query: IFileSearchQuery,
    results: IFileSearchResult[],
    onProgress?: (result: IFileSearchResult) => void,
    updateFilesScanned?: (count: number) => void
  ): Promise<void> {
    const rgArgs = this.buildRipgrepArgs(query, false);
    
    await this.executeRipgrep(
      rgArgs,
      query,
      results,
      false,
      onProgress,
      updateFilesScanned
    );
  }

  /**
   * Search directories
   * Extract unique directories by analyzing file paths
   */
  private async searchDirectories(
    query: IFileSearchQuery,
    results: IFileSearchResult[],
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<void> {
    // Use ripgrep to list all files, then extract directories
    const rgArgs = this.buildRipgrepArgs(query, true);
    const allPaths: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const rg = spawn(this.rgPath, rgArgs, {
        cwd: query.folder,
        shell: false
      });

      let buffer = '';

      rg.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            allPaths.push(line.trim());
          }
        }
      });

      rg.stderr.on('data', (data: Buffer) => {
      });

      rg.on('close', () => resolve());
      rg.on('error', (error) => reject(error));
    });

    // Extract unique directory paths
    const directories = new Set<string>();
    for (const filePath of allPaths) {
      // Fix: support Windows and Unix path separators
      const normalizedPath = filePath.replace(/\\/g, '/');
      const parts = normalizedPath.split('/');
      // Add all parent directories
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/');
        if (dirPath && !directories.has(dirPath)) {
          directories.add(dirPath);
        }
      }
    }

    // Filter matching directories and add to results
    for (const dirPath of directories) {
      if (query.maxResults && results.length >= query.maxResults) {
        break;
      }

      const dirName = path.basename(dirPath);
      if (this.matchesDirectoryPattern(dirName, dirPath, query)) {
        const result: IFileSearchResult = {
          path: dirPath.replace(/\\/g, '/'),
          score: 0, // Will be calculated by fuzzy scorer
          isDirectory: true
        };

        results.push(result);

        if (onProgress) {
          onProgress(result);
        }
      }
    }
  }

  /**
   * Execute ripgrep command
   */
  private async executeRipgrep(
    rgArgs: string[],
    query: IFileSearchQuery,
    results: IFileSearchResult[],
    isDirectory: boolean,
    onProgress?: (result: IFileSearchResult) => void,
    updateFilesScanned?: (count: number) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const rg: ChildProcess = spawn(this.rgPath, rgArgs, {
        cwd: query.folder,
        shell: false
      });

      let buffer = '';

      rg.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            if (updateFilesScanned) {
              updateFilesScanned(results.length + 1);
            }
            
            const result: IFileSearchResult = {
              path: line.trim().replace(/\\/g, '/'),
              score: 0, // Will be calculated by fuzzy scorer
              isDirectory
            };

            results.push(result);

            if (onProgress) {
              onProgress(result);
            }

            // Check if max result count is reached
            if (query.maxResults && results.length >= query.maxResults) {
              rg.kill();
              resolve();
              return;
            }
          }
        }
      });

      rg.stderr?.on('data', (data: Buffer) => {
        const errorMsg = data.toString();
        // Only log non-empty error messages
        if (errorMsg.trim()) {
        }
      });

      rg.on('close', (code) => {
        // ripgrep return codes: 0 = match found, 1 = no match found, 2+ = error
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(new Error(`Ripgrep exited with code ${code}`));
        }
      });

      rg.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Build ripgrep command arguments
   * Core optimization: use --glob for path pattern matching pre-filter
   */
  private buildRipgrepArgs(query: IFileSearchQuery, forDirectoryExtraction: boolean = false): string[] {
    const args: string[] = [];

    // Base command: list files
    args.push('--files');
    
    // Output format
    args.push('--color=never'); // Disable color output
    args.push('--no-messages'); // Disable error messages
    
    // Symbolic link handling
    args.push('--follow'); // Follow symbolic links
    
    // Hidden files
    args.push('--hidden'); // Search hidden files (files starting with .)

    // Default exclude patterns (similar to VSCode)
    const defaultExcludes = [
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
      'Thumbs.db',
      '*.log'
    ];

    for (const pattern of defaultExcludes) {
      args.push('--glob', `!${pattern}`);
    }

    // User-defined exclude patterns
    if (query.excludePattern) {
      const excludePatterns = query.excludePattern.split(',').map(p => p.trim());
      for (const pattern of excludePatterns) {
        args.push('--glob', `!${pattern}`);
      }
    }

    // Key improvement: use --iglob for case-insensitive path matching pre-filter
    if (query.pattern && !forDirectoryExtraction) {
      const globPatterns = this.buildGlobPatterns(query.pattern, query.fuzzy);
      
      for (const globPattern of globPatterns) {
        // Use --iglob instead of --glob to ensure case-insensitive matching
        args.push('--iglob', globPattern);
      }
    }

    // User-defined include patterns (highest priority)
    if (query.includePattern) {
      const includePatterns = query.includePattern.split(',').map(p => p.trim());
      for (const pattern of includePatterns) {
        args.push('--glob', pattern);
      }
    }

    return args;
  }

  /**
   * Build glob patterns for path matching
   *
   * Key fix:
   * 1. Use --iglob parameter to ensure case-insensitive matching
   * 2. Use simple *pattern* format
   * 3. No need to provide case variants (--iglob handles this)
   */
  private buildGlobPatterns(pattern: string, fuzzy: boolean = true): string[] {
    const patterns: string[] = [];
    
    if (fuzzy) {
      // Simple fuzzy matching: only add wildcards at start and end
      // e.g.: 'license' -> '*license*'
      // Used with --iglob, can match LICENSE, license, License, etc.
      patterns.push(`**/*${pattern}*`);     // Any depth
      patterns.push(`*${pattern}*`);        // Current directory
    } else {
      // Exact matching (contains)
      patterns.push(`**/*${pattern}*`);
      patterns.push(`*${pattern}*`);
    }
    
    return patterns;
  }

  /**
   * Check if directory matches pattern
   */
  private matchesDirectoryPattern(dirName: string, dirPath: string, query: IFileSearchQuery): boolean {
    if (!query.pattern) {
      return true;
    }

    const pattern = query.pattern.toLowerCase();
    const dirNameLower = dirName.toLowerCase();
    const dirPathLower = dirPath.toLowerCase();

    if (query.fuzzy) {
      return this.fuzzyMatch(dirNameLower, pattern) || this.fuzzyMatch(dirPathLower, pattern);
    } else {
      return dirNameLower.includes(pattern) || dirPathLower.includes(pattern);
    }
  }

  /**
   * Simple fuzzy matching algorithm (for pre-filtering)
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
}