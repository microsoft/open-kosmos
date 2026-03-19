/**
 * SearchFilesTool - Built-in filename and path search tool
 * Core functionality: Search filenames, file paths, directory names, directory paths (does not search file content)
 *
 * Key features:
 *  - Uses ripgrep for high-performance file/directory search
 *  - Pattern support: simple string matching, glob patterns (*.ts, **\/*.tsx)
 *  - Supports fuzzy matching (fuzzy=true, character order matching) and exact matching
 *  - Supports searching files, directories, or both
 *  - Automatically uses VSCode-style Fuzzy Scoring for sorting
 *  - workspaceRoot (required) specifies the search root directory - search scope is entirely controlled by this parameter
 *  - Search scope: only searches within the specified workspaceRoot, does not automatically associate with chatId's workspace
 *  - Resource limits: maxResults (default 50), timeout=10s
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import { getWorkspaceWatcher } from '../../workspace/WorkspaceWatcher';
import type { IFileSearchQuery } from '../../workspace/SearchService';

// Limit constants
const DEFAULT_MAX_RESULTS = 50;     // Default maximum results
const MAX_RESULTS_LIMIT = 200;      // Maximum results upper limit
const SEARCH_TIMEOUT_MS = 10000;    // Search timeout (10 seconds)

export interface SearchFilesToolArgs {
  pattern: string;              // Required: search pattern (filename/path fragment, supports glob: *.ts, **/*.tsx)
  workspaceRoot: string;        // Required: workspace root directory (absolute path), search scope controlled by this parameter
  description?: string;         // Optional: Operation description for UI display
  searchTarget?: 'files' | 'folders' | 'both';  // Optional: search target (default 'both')
  maxResults?: number;          // Optional: maximum results (default 50, upper limit 200)
  fuzzy?: boolean;              // Optional: whether to enable fuzzy matching (default true)
  includePattern?: string;      // Optional: include pattern (comma-separated)
  excludePattern?: string;      // Optional: exclude pattern (comma-separated)
}

export interface SearchFilesFileResult {
  path: string;                 // Path relative to workspaceRoot
  score?: number;               // Match score (used for sorting)
  isDirectory?: boolean;        // Whether it is a directory
}

export interface SearchFilesToolResult {
  success: boolean;             // Whether successful
  pattern: string;              // Search pattern
  workspaceRoot: string;        // Workspace root directory
  searchTarget: 'files' | 'folders' | 'both';  // Search target
  results: SearchFilesFileResult[];  // Search results
  limitHit: boolean;            // Whether the result count limit was reached
  stats?: {
    duration: number;           // Search duration (milliseconds)
    filesScanned: number;       // Number of files scanned
    cacheHit: boolean;          // Whether cache was hit
  };
  errors?: string[];            // Non-fatal warnings/info messages
  timestamp: string;            // Execution completion time (ISO string)
}

export class SearchFilesTool {
  
  /**
   * Execute file/directory search tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: SearchFilesToolArgs): Promise<SearchFilesToolResult> {

    // 1. Argument validation
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid arguments provided');
    }

    const errors: string[] = [];
    const start = Date.now();

    // 2. Normalize parameters
    const pattern = args.pattern.trim();
    const workspaceRoot = args.workspaceRoot.trim();
    const searchTarget = args.searchTarget || 'both';
    const fuzzy = args.fuzzy !== false; // Enable fuzzy matching by default
    let maxResults = args.maxResults || DEFAULT_MAX_RESULTS;

    // Limit maximum results
    if (maxResults > MAX_RESULTS_LIMIT) {
      errors.push(`maxResults capped to ${MAX_RESULTS_LIMIT}`);
      maxResults = MAX_RESULTS_LIMIT;
    }

    try {
      // 3. Build search query
      const query: IFileSearchQuery = {
        folder: workspaceRoot,
        pattern,
        maxResults,
        fuzzy,
        searchTarget,
        includePattern: args.includePattern,
        excludePattern: args.excludePattern
      };

      // 4. Execute search (using WorkspaceWatcher)
      const watcher = getWorkspaceWatcher();
      
      // Set timeout
      const searchPromise = watcher.searchFiles(query);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS);
      });

      const searchResult = await Promise.race([searchPromise, timeoutPromise]);

      // 5. Process search results
      const results: SearchFilesFileResult[] = searchResult.results.map(result => ({
        path: result.path,
        score: result.score,
        isDirectory: result.isDirectory
      }));

      const duration = Date.now() - start;

      const output: SearchFilesToolResult = {
        success: true,
        pattern,
        workspaceRoot,
        searchTarget,
        results,
        limitHit: searchResult.limitHit || false,
        stats: searchResult.stats ? {
          duration: searchResult.stats.duration,
          filesScanned: searchResult.stats.filesScanned,
          cacheHit: searchResult.stats.cacheHit
        } : {
          duration,
          filesScanned: results.length,
          cacheHit: false
        },
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };

      return output;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`search_files execution failed: ${errorMessage}`);
    }
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_files',
      description: 'Search for files and directories by filename or path (NOT file content). Uses ripgrep for high-performance search. Pattern supports: simple text (case-insensitive), glob patterns (*.ts, **/*.tsx). Fuzzy matching enabled by default (matches chars in order). Returns relative paths sorted by VSCode-style fuzzy scoring. IMPORTANT: workspaceRoot (absolute path) is REQUIRED and defines search scope - does NOT auto-use chatId workspace. Supports filtering by file/folder type. Limits: maxResults=50 (max 200), timeout=10s.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being searched (for UI display). E.g., "Finding config files", "Searching for components"'
          },
          pattern: {
            type: 'string',
            description: 'Search pattern (filename or path fragment). Supports: simple text (case-insensitive), glob patterns (*.ts, **/*.tsx). Examples: "readme" (fuzzy match), "src/app" (path match), "*.ts" (glob pattern for TypeScript files)'
          },
          workspaceRoot: {
            type: 'string',
            description: 'REQUIRED: Workspace root directory (absolute path). Defines search scope - all results are relative to this path. Does NOT auto-use chatId workspace, must be explicitly provided.'
          },
          searchTarget: {
            type: 'string',
            enum: ['files', 'folders', 'both'],
            description: 'Search target: "files" (files only), "folders" (directories only), "both" (default). Use "folders" to find directories.'
          },
          maxResults: {
            type: 'number',
            minimum: 1,
            maximum: 200,
            description: 'Maximum number of results (default 50, max 200).'
          },
          fuzzy: {
            type: 'boolean',
            description: 'Enable fuzzy matching (default true). When true, matches files/folders with characters in order.'
          },
          includePattern: {
            type: 'string',
            description: 'Optional include pattern (comma-separated). Example: "*.ts,*.tsx" to include only TypeScript files.'
          },
          excludePattern: {
            type: 'string',
            description: 'Optional exclude pattern (comma-separated). Example: "test,spec" to exclude test files. Default excludes: node_modules, .git, dist, build.'
          }
        },
        required: ['description', 'pattern', 'workspaceRoot']
      }
    };
  }

  /**
   * Argument validation and normalization
   */
  private static validateArgs(args: SearchFilesToolArgs): { isValid: boolean; error?: string } {
    // Defensive check: ensure the arguments object exists
    if (!args || typeof args !== 'object') {
      return { isValid: false, error: 'Arguments object required' };
    }

    // pattern is a required non-empty string
    if (typeof args.pattern !== 'string' || !args.pattern.trim()) {
      return { isValid: false, error: 'pattern is required and must be a non-empty string' };
    }

    // workspaceRoot is a required non-empty string
    if (typeof args.workspaceRoot !== 'string' || !args.workspaceRoot.trim()) {
      return { isValid: false, error: 'workspaceRoot is required and must be a non-empty string' };
    }

    // Verify workspaceRoot is an absolute path
    const path = require('path');
    if (!path.isAbsolute(args.workspaceRoot)) {
      return { isValid: false, error: 'workspaceRoot must be an absolute path' };
    }

    // Verify workspaceRoot exists
    const fs = require('fs');
    if (!fs.existsSync(args.workspaceRoot)) {
      return { isValid: false, error: 'workspaceRoot does not exist' };
    }

    // Validate searchTarget enum value
    if (args.searchTarget && !['files', 'folders', 'both'].includes(args.searchTarget)) {
      return { isValid: false, error: 'searchTarget must be "files", "folders", or "both"' };
    }

    // Validate maxResults range
    if (args.maxResults !== undefined) {
      if (!Number.isInteger(args.maxResults) || args.maxResults < 1) {
        return { isValid: false, error: 'maxResults must be a positive integer' };
      }
    }

    return { isValid: true };
  }
}