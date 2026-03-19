/**
 * Node.js fs-based Search Engine
 * Uses Node.js file system API for file search
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import micromatch from 'micromatch';
import type { IFileSearchQuery, IFileSearchResult, ISearchComplete, ISearchEngine } from './SearchService';
import {
  prepareQuery,
  compareItemsByFuzzyScore,
  type IItemAccessor,
  type FuzzyScorerCache
} from './fuzzyScorer';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * FileMatchItemAccessor - used to extract scoring information from IFileSearchResult
 */
const FileMatchItemAccessor: IItemAccessor<IFileSearchResult> = {
  getItemLabel: item => path.basename(item.path),
  getItemDescription: item => {
    const dir = path.dirname(item.path);
    return dir === '.' ? '' : dir;
  },
  getItemPath: item => item.path
};

export class NodeFSSearchEngine implements ISearchEngine {
  private scorerCache: FuzzyScorerCache = Object.create(null);

  async search(
    query: IFileSearchQuery,
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<ISearchComplete> {
    const startTime = Date.now();
    const results: IFileSearchResult[] = [];
    let filesScanned = 0;


    try {
      await this.searchDirectory(
        query.folder,
        query.folder,
        query,
        results,
        (count) => { filesScanned = count; },
        onProgress
      );
    } catch (error) {
    }

    const duration = Date.now() - startTime;

    // Sort using VSCode fuzzy scorer
    if (query.pattern && results.length > 0) {
      await this.scoreAndSortResults(results, query.pattern);
    }


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

  private async searchDirectory(
    dir: string,
    rootDir: string,
    query: IFileSearchQuery,
    results: IFileSearchResult[],
    updateFilesScanned: (count: number) => void,
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<void> {
    // Check if max result count is reached
    if (query.maxResults && results.length >= query.maxResults) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // Ignore permission errors, etc.
      return;
    }

    const searchTarget = query.searchTarget || 'both';

    for (const entry of entries) {
      // Check if max result count is reached
      if (query.maxResults && results.length >= query.maxResults) {
        break;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      // Exclude rule check
      if (this.shouldExclude(entry.name, relativePath, query)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check if directory needs to be added to results
        if ((searchTarget === 'folders' || searchTarget === 'both') &&
            this.matchesPattern(entry.name, relativePath, query)) {
          const result: IFileSearchResult = {
            path: relativePath.replace(/\\/g, '/'),
            score: 0, // Temporary score, will be recalculated later by fuzzy scorer
            isDirectory: true
          };

          results.push(result);

          if (onProgress) {
            onProgress(result);
          }
        }

        // Recursively search subdirectories
        await this.searchDirectory(
          fullPath,
          rootDir,
          query,
          results,
          updateFilesScanned,
          onProgress
        );
      } else if (entry.isFile()) {
        updateFilesScanned(results.length + 1);

        // Check if file matches (only when search target includes files)
        if ((searchTarget === 'files' || searchTarget === 'both') &&
            this.matchesPattern(entry.name, relativePath, query)) {
          const result: IFileSearchResult = {
            path: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
            score: 0, // Temporary score, will be recalculated later by fuzzy scorer
            isDirectory: false
          };

          results.push(result);

          if (onProgress) {
            onProgress(result);
          }
        }
      }
    }
  }

  private shouldExclude(
    name: string,
    relativePath: string,
    query: IFileSearchQuery
  ): boolean {
    // Default exclude patterns
    const defaultExcludePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/.vscode/**',
      '**/.idea/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.DS_Store',
      '**/Thumbs.db'
    ];

    // Merge user-provided exclude patterns
    const excludePatterns = query.excludePattern
      ? [...defaultExcludePatterns, ...query.excludePattern.split(',').map(p => p.trim())]
      : defaultExcludePatterns;

    // Use micromatch for advanced pattern matching
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return micromatch.isMatch(normalizedPath, excludePatterns, {
      dot: true,
      nocase: process.platform === 'win32' // Case-insensitive on Windows
    });
  }

  private matchesPattern(
    fileName: string,
    relativePath: string,
    query: IFileSearchQuery
  ): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Check include patterns (if specified)
    if (query.includePattern) {
      const includePatterns = query.includePattern.split(',').map(p => p.trim());
      const matchesInclude = micromatch.isMatch(normalizedPath, includePatterns, {
        dot: true,
        nocase: process.platform === 'win32'
      });
      
      if (!matchesInclude) {
        return false;
      }
    }

    // If no search pattern, match as long as includePattern check passes
    if (!query.pattern) {
      return true;
    }

    const pattern = query.pattern.toLowerCase();
    const fileNameLower = fileName.toLowerCase();
    const relativePathLower = normalizedPath.toLowerCase();

    if (query.fuzzy) {
      // Fuzzy matching: check if each character of pattern appears in order
      return this.fuzzyMatch(fileNameLower, pattern) || this.fuzzyMatch(relativePathLower, pattern);
    } else {
      // Simple contains matching
      return fileNameLower.includes(pattern) || relativePathLower.includes(pattern);
    }
  }

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
   * Score and sort search results using VSCode fuzzy scorer
   */
  private async scoreAndSortResults(
    results: IFileSearchResult[],
    pattern: string
  ): Promise<void> {
    const preparedQuery = prepareQuery(pattern);
    
    // Sort using VSCode's fuzzy scorer
    results.sort((a, b) =>
      compareItemsByFuzzyScore(
        a,
        b,
        preparedQuery,
        true, // Support separator matching
        FileMatchItemAccessor,
        this.scorerCache
      )
    );

  }
}