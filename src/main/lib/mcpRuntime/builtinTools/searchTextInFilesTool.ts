/**
 * SearchTextInFilesTool - Built-in file content text search tool (literal / regex)
 * Core functionality: Search text content within files, does not search filenames or path names
 * Key features:
 *  - workspaceRoot (required) used for global scanning or resolving relative paths
 *  - Supports literal (case-insensitive) and /regex/ patterns (auto-adds i flag)
 *  - Simple glob filtering: *, *.ext, **\/*.ext (no complex wildcard parsing)
 *  - Context lines 0~2, returns aggregated "match block" results (matched lines prefixed with '>')
 *  - Resource limits: files<=80, fileSize<=512KB, matchBlocks/file<=5, totalMatchLines<=300, timeout=4s
 *  - Ignored directories: .git, node_modules, dist, build, coverage, .cache, out
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Limit constants
const MAX_FILES = 80;                   // Maximum number of files to traverse per search
const MAX_FILE_SIZE_KB = 512;           // Maximum file size allowed for scanning (KB)
const MAX_MATCHES_PER_FILE = 5;         // Number of match blocks allowed per file
const MAX_TOTAL_MATCHES = 300;          // Global upper limit for matched lines
const TIMEOUT_MS = 4000;                // Search timeout (milliseconds)
const LINE_TRUNCATE = 500;              // Single line truncation length to avoid overly long output
const MAX_INPUT_PATHS = 10;             // Maximum number of paths allowed in the paths parameter
const IGNORED_DIRS = new Set(['.git','node_modules','dist','build','coverage','.cache','out']); // Directories skipped during traversal

export interface SearchTextInFilesToolArgs {
  patterns: string[];     // Required: substring or /regex/ collection (searched sequentially)
  workspaceRoot: string;  // Required: search root directory (absolute path), used for global scanning or resolving relative paths
  description?: string;   // Optional: Operation description for UI display
  path?: string;          // Optional: single file/directory (relative to workspaceRoot)
  paths?: string[];       // Optional: multiple paths (relative to workspaceRoot, takes priority over path)
  fileGlob?: string;      // Optional: *  | *.ext | **/*.ext
  context?: number;       // Optional: 0~2, default 1
}

export interface SearchTextInFilesMatchBlock {
  startLine: number;     // First line of match block (including context)
  endLine: number;       // Last line of match block (including context)
  lines: string[];       // Each formatted result line; ">" indicates a matched line, " " indicates a context line, e.g. "> 0012: matched" / "  0011: context"
  matchCount: number;    // Actual number of matched lines within the block
}

export interface SearchTextInFilesFileResult {
  file: string;                  // Relative to root or absolute (if no root)
  matches: SearchTextInFilesMatchBlock[];
}

export interface SearchTextInFilesPatternResult {
  pattern: string;               // Currently executed pattern
  results: SearchTextInFilesFileResult[]; // List of matched files
  filesScanned: number;          // Number of files traversed for this pattern
  totalMatches: number;          // Total number of matched lines for this pattern
  durationMs: number;            // Execution duration for a single pattern
  warnings?: string[];           // Non-fatal warnings at the pattern level
}

export interface SearchTextInFilesToolResult {
  success: boolean;               // Whether a fatal error was encountered
  patterns: string[];             // List of patterns actually used for searching
  paths: string[] | null;         // Final list of paths used for searching: relative to root, null if global scan
  fileGlob?: string;              // Active simple glob filter (undefined if validation failed)
  patternResults: SearchTextInFilesPatternResult[]; // Search results grouped by pattern
  errors?: string[];              // Global-level non-fatal warnings/info messages
  timestamp: string;              // Execution completion time (ISO string)
}

export class SearchTextInFilesTool {
  
  /**
   * Execute file content search tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: SearchTextInFilesToolArgs): Promise<SearchTextInFilesToolResult> {

    // 1. Argument validation
    // Basic parameter type and required field validation
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid arguments provided');
    }

    const normalizedPatterns = validation.normalizedPatterns || [];

    // Pre-trim and extract caller arguments for easier use with semantic variable names
    const {
      context: inputContext,
      workspaceRoot: inputWorkspaceRoot,
      fileGlob,
      path: singlePath,
      paths: multiplePaths
    } = {
      context: args.context,
      workspaceRoot: args.workspaceRoot,
      fileGlob: args.fileGlob,
      path: args.path,
      paths: args.paths
    };

    const errors: string[] = [];
    const start = Date.now();

    if (validation.removedEntries && validation.removedEntries > 0) {
      errors.push('patterns list contained invalid or duplicate entries that were removed');
    }

    let context = 1; // Default context: 1 line
    if (inputContext !== undefined) {
      if (!Number.isInteger(inputContext) || inputContext < 0) {
        errors.push('context invalid, defaulted to 1');
      } else if (inputContext > 2) {
        errors.push('context >2 capped to 2');
        context = 2;
      } else {
        context = inputContext;
      }
    }

    // 2. Resolve paths
    // Normalize workspaceRoot: keep null if empty, resolve to absolute path if non-empty
    let workspaceRoot: string | null = null;
    if (typeof inputWorkspaceRoot === 'string' && inputWorkspaceRoot.trim()) {
      workspaceRoot = path.resolve(inputWorkspaceRoot.trim());
    }

    // Resolve path/paths -> absolute path set; throw error if all missing and no workspaceRoot
    const resolvedTargets = await this.resolveTargets({ ...args, path: singlePath, paths: multiplePaths }, workspaceRoot, errors);
    if (resolvedTargets.length === 0 && !workspaceRoot) {
      throw new Error('Provide workspaceRoot for global/relative search or specify at least one absolute path');
    }

    // Simple glob support: restricted to controlled patterns, warning given if not supported
    let normalizedGlob: string | undefined;
    if (fileGlob) {
      const trimmedGlob = fileGlob.trim();
      if (this.isSupportedSimpleGlob(trimmedGlob)) normalizedGlob = trimmedGlob;
      else errors.push(`Unsupported fileGlob ignored: ${fileGlob}`);
    }

    try {
      const effectiveRoots = resolvedTargets.length > 0 ? resolvedTargets : (workspaceRoot ? [{ abs: workspaceRoot, rel: '', isFile: false }] : []);
      const patternResults: SearchTextInFilesPatternResult[] = [];

      // Execute search for each pattern sequentially and append results
      for (const pattern of normalizedPatterns) {
        const patternStart = Date.now();
        const patternWarnings: string[] = [];
        // 3. Build matcher - supports literal and regex patterns
        const { isRegex, regex, literal } = this.buildMatcher(pattern);

        const patternResultsForFiles: SearchTextInFilesFileResult[] = [];
        let totalMatches = 0;
        let filesScanned = 0;
        const visitedFiles = new Set<string>();
        const timeoutAt = patternStart + TIMEOUT_MS;

        // 4. Traverse targets - apply resource limits and glob filtering
        for (const target of effectiveRoots) {
          if (Date.now() > timeoutAt) { patternWarnings.push('Search timeout reached'); break; }
          if (target.isFile) {
            await this.processFile(target.abs, target.rel || path.basename(target.abs), workspaceRoot, {
              isRegex, regex, literal, context, results: patternResultsForFiles, errors: patternWarnings, visitedFiles,
              counters: { totalMatchesRef: () => totalMatches, incMatches: (c:number)=> { totalMatches += c; }, filesScannedRef: () => filesScanned, incFiles: ()=> { filesScanned++; } },
              control: { timeoutAt, fileGlob: normalizedGlob }
            });
            if (totalMatches >= MAX_TOTAL_MATCHES) { patternWarnings.push('Global match limit reached'); break; }
          } else {
            await this.walkDirectory(target.abs, target.rel, workspaceRoot, {
              isRegex, regex, literal, context, results: patternResultsForFiles, errors: patternWarnings, visitedFiles,
              counters: { totalMatchesRef: () => totalMatches, incMatches: (c:number)=> { totalMatches += c; }, filesScannedRef: () => filesScanned, incFiles: ()=> { filesScanned++; } },
              control: { timeoutAt, fileGlob: normalizedGlob }
            });
            if (totalMatches >= MAX_TOTAL_MATCHES) { patternWarnings.push('Global match limit reached'); break; }
          }
        }

        patternResults.push({
          pattern,
          results: patternResultsForFiles,
          filesScanned,
          totalMatches,
          durationMs: Date.now() - patternStart,
          warnings: patternWarnings.length > 0 ? patternWarnings : undefined
        });

      }

      const totalDuration = Date.now() - start;
      const totalMatchesAcrossPatterns = patternResults.reduce((sum, item) => sum + item.totalMatches, 0);
      const totalFilesWithMatches = patternResults.reduce((sum, item) => sum + item.results.length, 0);

      // 5. Process search results - aggregate output structure
      const output: SearchTextInFilesToolResult = {
        success: true,
        patterns: normalizedPatterns,
        paths: resolvedTargets.length > 0 ? resolvedTargets.map(t => t.rel || (workspaceRoot ? '.' : t.abs)) : (workspaceRoot ? null : []),
        fileGlob: normalizedGlob,
        patternResults,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };


      return output;
    } catch (error) {
      throw new Error(`search_text_in_files execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolve path/paths arguments into a deduplicated set of absolute paths
   */
  private static async resolveTargets(args: SearchTextInFilesToolArgs, workspaceRoot: string | null, errors: string[]): Promise<Array<{abs: string; rel: string; isFile: boolean}>> {
    // Resolve path/paths -> absolute paths. paths takes priority; relative paths require workspaceRoot; deduplicated using Set
    let rawList: string[] = [];
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      rawList = args.paths.slice(0, MAX_INPUT_PATHS);
      if (args.paths.length > MAX_INPUT_PATHS) errors.push(`paths truncated to first ${MAX_INPUT_PATHS}`);
      if (args.path) errors.push('path ignored because paths provided');
    } else if (args.path) {
      rawList = [args.path];
    }

    const results: Array<{abs: string; rel: string; isFile: boolean}> = [];
    const seen = new Set<string>();

    for (const pItem of rawList) {
      const trimmed = pItem.trim();
      if (!trimmed) continue;
      // Convert to absolute path: use directly if absolute, rely on workspaceRoot for relative
      let abs: string;
      if (path.isAbsolute(trimmed)) {
        abs = path.normalize(trimmed);
      } else {
        if (!workspaceRoot) {
          errors.push(`Relative path without workspaceRoot skipped: ${pItem}`);
          continue;
        }
        abs = path.resolve(workspaceRoot, trimmed);
      }
      // If workspaceRoot is set, ensure target is still under that root directory
      if (workspaceRoot) {
        const normRoot = path.resolve(workspaceRoot) + path.sep;
        const normAbs = path.resolve(abs) + path.sep;
        if (!normAbs.startsWith(normRoot)) { errors.push(`Path outside workspace skipped: ${pItem}`); continue; }
      }
      try {
        // Read file info to distinguish file/directory and generate dedup key
        const st = await fs.stat(abs);
        const rel = workspaceRoot ? path.relative(workspaceRoot, abs).replace(/\\/g, '/') : abs.replace(/\\/g, '/');
        const key = abs + '|' + (st.isFile()? 'f':'d');
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ abs, rel, isFile: st.isFile() });
      } catch {
        errors.push(`Path not found skipped: ${pItem}`);
      }
    }
    return results;
  }

  /**
   * Check whether glob is a supported simple pattern
   */
  private static isSupportedSimpleGlob(glob: string): boolean {
    // Validate whether it's a supported simple glob (performance-safe, no complex pattern expansion)
    if (glob === '*') return true;
    if (/^\*\.[A-Za-z0-9_]+$/.test(glob)) return true;
    if (/^\*\*[\\\/]\*\.[A-Za-z0-9_]+$/.test(glob)) return true;
    return false;
  }

  /**
   * Build a regex or literal matcher based on the pattern
   */
  private static buildMatcher(pattern: string): { isRegex: boolean; regex: RegExp | null; literal: string | null } {
    // Pattern parsing: /xxx/ -> RegExp(i), otherwise treated as literal with unified lowerCase; falls back to literal on failure
    const trimmed = pattern.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
      const inner = trimmed.slice(1, -1);
      try { return { isRegex: true, regex: new RegExp(inner, 'i'), literal: null }; }
      catch { return { isRegex: false, regex: null, literal: trimmed.toLowerCase() }; }
    }
    return { isRegex: false, regex: null, literal: trimmed.toLowerCase() };
  }

  /**
   * Recursively traverse directory and execute search on matching files
   */
  private static async walkDirectory(dirAbs: string, rel: string, workspaceRoot: string | null, ctx: any): Promise<void> {
    // Directory recursion: skip ignored dirs -> deep traversal -> early stop (file count/match count/timeout) -> call processFile for files
    const { errors, counters, control } = ctx;
    if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
    let entries: any[] = [];
    try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); }
    catch { errors.push(`Cannot read directory: ${rel || '.'}`); return; }

    for (const ent of entries) {
      if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
      const name = ent.name;
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        const subAbs = path.join(dirAbs, name);
        const subRel = workspaceRoot ? path.relative(workspaceRoot, subAbs).replace(/\\/g, '/') : subAbs.replace(/\\/g, '/');
        await this.walkDirectory(subAbs, subRel, workspaceRoot, ctx);
        if (counters.filesScannedRef() >= MAX_FILES) { errors.push('File scan limit reached'); return; }
        if (counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) return;
      } else if (ent.isFile()) {
        if (counters.filesScannedRef() >= MAX_FILES) { errors.push('File scan limit reached'); return; }
        const fileAbs = path.join(dirAbs, name);
        const fileRel = workspaceRoot ? path.relative(workspaceRoot, fileAbs).replace(/\\/g, '/') : fileAbs.replace(/\\/g, '/');
        if (this.shouldSkipByGlob(fileRel, ctx.control.fileGlob)) continue;
        await this.processFile(fileAbs, fileRel, workspaceRoot, ctx);
        if (counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) return;
      }
    }
  }

  /**
   * Determine whether a file should be skipped based on simple glob
   */
  private static shouldSkipByGlob(relFile: string, glob?: string | null): boolean {
    // Simple glob filtering: returns true if not matching (indicating skip)
    if (!glob) return false;
    if (glob === '*') return false;
    if (/^\*\.[A-Za-z0-9_]+$/.test(glob)) { const ext = glob.slice(1); return !relFile.endsWith(ext); }
    if (/^\*\*[\\\/]\*\.[A-Za-z0-9_]+$/.test(glob)) { const ext = glob.substring(glob.lastIndexOf('.')); return !relFile.endsWith(ext); }
    return false;
  }

  /**
   * Execute matching on a single file and generate result blocks
   */
  private static async processFile(abs: string, rel: string, workspaceRoot: string | null, ctx: any): Promise<void> {
    // Single file: size/binary/timeout filtering -> line matching -> aggregate blocks -> update counters
    const { isRegex, regex, literal, context, results, errors, visitedFiles, counters, control } = ctx;
    if (visitedFiles.has(abs)) return;
    visitedFiles.add(abs);
    if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
    counters.incFiles();
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return;
      if (stat.size > MAX_FILE_SIZE_KB * 1024) return;
    } catch { return; }

    let content: string;
    try { content = await fs.readFile(abs, 'utf8'); }
    catch { errors.push(`Cannot read file: ${rel}`); return; }
    if (content.includes('\0')) return; // Simple binary detection

    const lines = content.split(/\r?\n/);
    const matchLineNumbers: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); break; }
      const raw = lines[i];
      let isMatch = false;
      if (isRegex && regex) { regex.lastIndex = 0; isMatch = regex.test(raw); }
      else if (literal) { isMatch = raw.toLowerCase().includes(literal); }
      if (isMatch) matchLineNumbers.push(i + 1);
      if (matchLineNumbers.length + counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) break;
    }
    if (matchLineNumbers.length === 0) return;

    const blocks: SearchTextInFilesMatchBlock[] = [];
    let current: number[] = [];
    for (let idx = 0; idx < matchLineNumbers.length; idx++) {
      const lineNo = matchLineNumbers[idx];
      if (current.length === 0) current.push(lineNo);
      else {
        const prev = current[current.length - 1];
        if (lineNo <= prev + 1) current.push(lineNo);
        else {
          blocks.push(this.buildBlock(current, lines, context));
          if (blocks.length >= MAX_MATCHES_PER_FILE) break;
          current = [lineNo];
        }
      }
    }
    if (current.length > 0 && blocks.length < MAX_MATCHES_PER_FILE) blocks.push(this.buildBlock(current, lines, context));
    if (blocks.length === 0) return;

    let fileMatches = 0; blocks.forEach(b => { fileMatches += b.matchCount; });
    counters.incMatches(fileMatches);
    results.push({ file: rel.replace(/\\/g, '/'), matches: blocks });
  }

  /**
   * Assemble consecutive matched lines into result blocks with context
   */
  private static buildBlock(lineNumbers: number[], allLines: string[], context: number): SearchTextInFilesMatchBlock {
    // Build match block: expand context -> truncate long lines -> mark prefix/line number
    const start = Math.max(1, lineNumbers[0] - context);
    const end = Math.min(allLines.length, lineNumbers[lineNumbers.length - 1] + context);
    const matchSet = new Set(lineNumbers);
    const formatted: string[] = [];
    for (let ln = start; ln <= end; ln++) {
      let text = allLines[ln - 1] ?? '';
      if (text.length > LINE_TRUNCATE) text = text.slice(0, LINE_TRUNCATE) + ' [truncated...]';
      const prefix = matchSet.has(ln) ? '>' : ' ';
      const lineNoStr = ln.toString().padStart(4, ' ');
      formatted.push(`${prefix} ${lineNoStr}: ${text}`);
    }
    return { startLine: start, endLine: end, lines: formatted, matchCount: lineNumbers.length };
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_text_in_files',
      description: 'Search text content INSIDE files (not filenames or paths) for one or more literal (case-insensitive) or /regex/ patterns. REQUIRES workspaceRoot (absolute path) to define search scope. Optional path/paths specify subdirectories/files (relative to workspaceRoot). Omit path/paths to scan entire workspace. Supported globs: *, *.ext, **/*.ext. Limits: files=80 fileSize<=512KB matchesPerFile=5 totalMatches=300 timeout=4s. context=0-2 (default 1).',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being searched (for UI display). E.g., "Finding error handlers", "Searching for API endpoints"'
          },
          patterns: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            description: 'List of search patterns. Use /regex/ for regex entries; otherwise literal substring (case-insensitive).'
          },
          workspaceRoot: {
            type: 'string',
            description: 'REQUIRED: Workspace root directory (absolute path). Defines search scope. If path/paths omitted, scans entire workspace.'
          },
          path: {
            type: 'string',
            description: 'Optional single file or directory (relative to workspaceRoot). Ignored if paths provided.'
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional multiple files/dirs (relative to workspaceRoot). Max 10. Takes priority over path.'
          },
          fileGlob: {
            type: 'string',
            description: 'Optional simple glob (*, *.ext, **/*.ext) applied only to directory traversal.'
          },
          context: {
            type: 'number',
            minimum: 0,
            maximum: 2,
            description: 'Context lines before/after match (0-2, default 1).'
          },
        },
        required: ['description', 'patterns', 'workspaceRoot']
      }
    };
  }

  /**
   * Argument validation and normalization, returns trimmed patterns, context lines, and workspaceRoot
   */
  private static validateArgs(args: SearchTextInFilesToolArgs): { isValid: boolean; error?: string; normalizedPatterns?: string[]; removedEntries?: number } {
    // Defensive check: ensure the arguments object exists
    if (!args || typeof args !== 'object') {
      return { isValid: false, error: 'Arguments object required' };
    }

    // patterns is a required string array
    if (!Array.isArray(args.patterns)) {
      return { isValid: false, error: 'patterns is required and must be an array' };
    }

    // workspaceRoot is a required non-empty string
    if (typeof args.workspaceRoot !== 'string' || !args.workspaceRoot.trim()) {
      return { isValid: false, error: 'workspaceRoot is required and must be a non-empty string' };
    }

    const normalizedPatterns = Array.from(new Set(
      args.patterns
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(item => item.length > 0)
    ));

    if (normalizedPatterns.length === 0) {
      return { isValid: false, error: 'patterns must contain at least one non-empty string' };
    }

    // context, if provided, only accepts non-negative integers
    if (args.context !== undefined && (!Number.isInteger(args.context) || args.context < 0)) {
      return { isValid: false, error: 'context must be an integer >= 0 when provided' };
    }

    const removedEntries = args.patterns.length - normalizedPatterns.length;

    return {
      isValid: true,
      normalizedPatterns,
      removedEntries: removedEntries > 0 ? removedEntries : undefined
    };
  }
}