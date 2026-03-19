/**
 * Workspace Search Service
 * Provides file search functionality with support for multiple search engines
 */

export type SearchTarget = 'files' | 'folders' | 'both';

export interface IFileSearchQuery {
  pattern?: string;                    // Search pattern
  folder: string;                      // Search directory (absolute path)
  includePattern?: string;             // Include pattern (glob)
  excludePattern?: string;             // Exclude pattern (glob)
  maxResults?: number;                 // Max results
  useGitignore?: boolean;              // Whether to use .gitignore
  fuzzy?: boolean;                     // Whether to use fuzzy matching
  cacheKey?: string;                   // Cache key
  searchTarget?: SearchTarget;         // Search target: files (files only) | folders (folders only) | both (files + folders, default)
}

export interface IFileSearchResult {
  path: string;                        // File/directory path (relative to workspace)
  score?: number;                      // Match score (used for sorting)
  isDirectory?: boolean;               // Whether it is a directory
}

export interface ISearchComplete {
  results: IFileSearchResult[];
  limitHit?: boolean;                  // Whether the result count limit was reached
  stats?: {
    duration: number;                  // Search duration (milliseconds)
    filesScanned: number;              // Number of files scanned
    cacheHit: boolean;                 // Whether cache was hit
  };
}

export interface ISearchEngine {
  search(
    query: IFileSearchQuery,
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<ISearchComplete>;
}

export class WorkspaceSearchService {
  private cache = new Map<string, ISearchComplete>();
  private cacheTimeout = 60000; // 1 minute
  private ripgrepEngine?: any;
  private useRipgrep = true; // Prefer Ripgrep

  constructor() {
    // Try to initialize Ripgrep engine
    this.initializeRipgrep();
  }

  /**
   * Initialize Ripgrep search engine
   */
  private async initializeRipgrep(): Promise<void> {
    try {
      const { RipgrepSearchEngine } = await import('./RipgrepSearchEngine');
      this.ripgrepEngine = new RipgrepSearchEngine();
      
      if (this.ripgrepEngine.isAvailable()) {
      } else {
        this.ripgrepEngine = null;
        this.useRipgrep = false;
      }
    } catch (error) {
      this.ripgrepEngine = null;
      this.useRipgrep = false;
    }
  }

  async fileSearch(
    query: IFileSearchQuery,
    onProgress?: (result: IFileSearchResult) => void
  ): Promise<ISearchComplete> {

    // 1. Check cache
    if (query.cacheKey && this.cache.has(query.cacheKey)) {
      const cached = this.cache.get(query.cacheKey)!;
      return {
        ...cached,
        stats: {
          ...cached.stats!,
          cacheHit: true
        }
      };
    }

    // 2. Select search engine
    const engine = await this.getSearchEngine();

    // 3. Execute search
    const results = await engine.search(query, onProgress);

    // 4. Cache results
    if (query.cacheKey) {
      this.cache.set(query.cacheKey, results);
      setTimeout(() => {
        this.cache.delete(query.cacheKey!);
      }, this.cacheTimeout);
    }


    return results;
  }

  private async getSearchEngine(): Promise<ISearchEngine> {
    // Strategy: prefer Ripgrep, fall back to Node.js fs
    
    // 1. If not yet initialized, wait for initialization to complete
    if (this.useRipgrep && !this.ripgrepEngine) {
      await this.initializeRipgrep();
    }
    
    // 2. Prefer Ripgrep (if available)
    if (this.useRipgrep && this.ripgrepEngine && this.ripgrepEngine.isAvailable()) {
      return this.ripgrepEngine;
    }
    
    // 3. Fall back to Node.js fs search engine
    const { NodeFSSearchEngine } = await import('./NodeFSSearchEngine');
    return new NodeFSSearchEngine();
  }

  clearCache(cacheKey?: string): void {
    if (cacheKey) {
      this.cache.delete(cacheKey);
    } else {
      this.cache.clear();
    }
  }
}