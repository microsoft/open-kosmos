/**
 * readAppLogsTool — multi-mode log query tool.
 *
 * Supports three modes:
 *   - stats:   total count + aggregates by level / by source
 *   - sources: list every source value seen in the logs
 *   - entries: return individual entries filtered by source / level / time window / grep
 *
 * Design intent: let the Doctor Agent iterate — start with stats for an overview, then narrow by
 * suspicious source/level, and use grep keywords if needed, until evidence is found or it is sure
 * the logs contain no related clues.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseLine,
  parseDateTime,
  matchesFilter,
  formatEntry,
  formatStalenessHeader,
  formatStats,
  formatSources,
  type LogEntry,
  type Filters,
} from '../logQuery';
import {
  getCurrentLogFileName,
  getDefaultLogDirectory,
  isDevelopmentLogEnvironment,
} from '../../unifiedLogger/FileOperations';

const ENTRIES_DEFAULT_LIMIT = 50;
const ENTRIES_HARD_LIMIT = 200;

const description = `Query OpenKosmos application runtime logs. **This is an iterative tool that requires multiple calls with progressively narrower filters** until you have evidence that explains the Bug, or are confident the logs contain no relevant clues.

## Three modes

- \`stats\`: aggregated overview — total count, distribution by level (ERROR/WARN/INFO/DEBUG), top modules by source (Top 15). **This should almost always be the first call** — extremely low cost, high information density.
- \`sources\`: list all source values that have appeared (deduplicated and sorted). Call this when you don't know which module names to use as a \`source\` filter.
- \`entries\`: return individual log entries (default 50, hard cap 200). Narrow with \`source\` / \`level\` / \`grep\` / \`from\` / \`to\`.

## Filter parameters (apply to all modes)

- \`source\`: module name glob match, supports \`*\` wildcard (e.g. \`"mcp*"\`, \`"*Manager"\`)
- \`level\`: array of values from \`["error","warn","info","debug"]\`
- \`grep\`: expression searched against message + source + metadata (case-insensitive). Syntax:
  - \`"timeout"\` — plain substring
  - \`"/time.*out/i"\` — regex
  - \`"a,b"\` — OR
  - \`"a+b"\` — AND
  - \`"!term"\` — NOT
  - Combined: \`"error+mcp,warn+timeout"\` = (error AND mcp) OR (warn AND timeout)
- \`from\` / \`to\`: time window, ISO 8601 or \`"YYYY-MM-DD HH:mm"\`
- \`scope\`: \`"current"\` (default — only this run's logs: dev mode = this launch's \`openkosmos-dev-*.log\`; prod mode = today's \`openkosmos-YYYY-MM-DD.log\`) or \`"all"\` (across all historical log files, including prior dev launches)

## Usage examples (query goal → parameter form)

- Get today's log overview
  \`{ mode: "stats" }\`

- See all available module names
  \`{ mode: "sources" }\`

- Pull the most recent 30 ERROR entries
  \`{ mode: "entries", level: ["error"], limit: 30 }\`

- See only errors and warnings from MCP-related modules
  \`{ mode: "entries", source: "mcp*", level: ["error","warn"], limit: 30 }\`

- Search for logs containing both "timeout" and "mcp"
  \`{ mode: "entries", grep: "timeout+mcp", limit: 20 }\`

- Search for logs containing "timeout" or "disconnect"
  \`{ mode: "entries", grep: "timeout,disconnect", limit: 20 }\`

- Search for logs containing "error" but **not** "retry"
  \`{ mode: "entries", grep: "error+!retry", limit: 20 }\`

- Match with regex
  \`{ mode: "entries", grep: "/conn(ect|ection).*fail/i", limit: 20 }\`

- Pin a time window
  \`{ mode: "entries", from: "2026-04-22 14:00", to: "2026-04-22 15:00", level: ["error","warn"] }\`

- Query across all historical log files
  \`{ mode: "stats", scope: "all" }\`
  \`{ mode: "entries", scope: "all", grep: "OOM", limit: 30 }\`

- Multi-dimensional narrowing
  \`{ mode: "entries", source: "Mcp*", level: ["error"], grep: "timeout", limit: 20 }\`

## Notes

- When entries mode shows a truncation notice (\`[... N more entries truncated]\`), do not try to pull more — instead narrow the filters (add source, level, or grep) and query again.
- Don't be afraid to call multiple times. Narrowing one dimension per call is more effective than blindly pulling a huge dump of logs.
- If 2–3 consecutive narrowed queries return no related results, conclude "no relevant clues in logs" and proceed to the next phase — don't loop indefinitely.`;

export const readAppLogsToolDef = {
  type: 'function' as const,
  function: {
    name: 'read_app_logs',
    description,
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['stats', 'sources', 'entries'],
          description: `stats = aggregated overview; sources = list of unique source values; entries = actual log lines filtered by the criteria below.`,
        },
        source: {
          type: 'string',
          description: `Glob pattern to filter by source, supports "*" wildcard (e.g. "mcp*", "chat*"). Applies to all modes.`,
        },
        level: {
          type: 'array',
          items: { type: 'string', enum: ['error', 'warn', 'info', 'debug'] },
          description: 'Filter by log levels. Applies to all modes.',
        },
        grep: {
          type: 'string',
          description: `Search expression matched against message + source + metadata (case-insensitive). Syntax: plain text = substring; "/regex/flags" = regex; "a,b" = OR; "a+b" = AND; "!term" = NOT. Combine: "error+mcp,warn+timeout" = (error AND mcp) OR (warn AND timeout). Applies to all modes.`,
        },
        from: {
          type: 'string',
          description: 'Start time (inclusive). ISO 8601 or "YYYY-MM-DD HH:mm".',
        },
        to: {
          type: 'string',
          description: 'End time (inclusive). ISO 8601 or "YYYY-MM-DD HH:mm".',
        },
        limit: {
          type: 'number',
          description:
            `Max entries to return (only applies to mode="entries"). Default ${ENTRIES_DEFAULT_LIMIT}, hard cap ${ENTRIES_HARD_LIMIT}.`,
        },
        scope: {
          type: 'string',
          enum: ['current', 'all'],
          description: `Which log files to query. Default "current" — the current run only (dev: this launch's openkosmos-dev-*.log; prod: today's openkosmos-YYYY-MM-DD.log). "all" = every log file in the directory (including prior dev launches).`,
        },
      },
      required: ['mode'],
    },
  },
};

interface ReadAppLogsArgs {
  mode: 'stats' | 'sources' | 'entries';
  source?: string;
  level?: string[];
  grep?: string;
  from?: string;
  to?: string;
  limit?: number;
  scope?: 'current' | 'all';
}

const VALID_MODES = ['stats', 'sources', 'entries'] as const;
const VALID_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
const VALID_SCOPES = ['current', 'all'] as const;
const KNOWN_KEYS = new Set([
  'mode', 'source', 'level', 'grep', 'from', 'to', 'limit', 'scope',
]);
/** Per-file read cap: 64MB. Files larger than this are skipped with a notice. Prevents OOM when scope='all'. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export async function executeReadAppLogs(args: ReadAppLogsArgs): Promise<string> {
  // 1) Validate inputs: prefer returning a clear error early over letting the LLM see misleading results
  const validation = validateArgs(args);
  if (validation) return validation;

  try {
    const logsDir = getDefaultLogDirectory();
    if (!fs.existsSync(logsDir)) {
      return `No logs directory found at ${logsDir}.`;
    }

    const files = resolveLogFiles(logsDir, args.scope ?? 'current');
    if (files.length === 0) {
      return 'No log files found.';
    }

    const filters = buildFilters(args);

    // 2) Track raw line count and parse-success count to diagnose issues like "format not recognized"
    let totalRawLines = 0;
    let totalParsedEntries = 0;
    const skippedFiles: string[] = [];
    const entries: LogEntry[] = [];

    for (const file of files) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        skippedFiles.push(`${path.basename(file)} (stat failed)`);
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skippedFiles.push(
          `${path.basename(file)} (${Math.round(stat.size / 1024 / 1024)}MB exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB cap)`,
        );
        continue;
      }
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch (err) {
        skippedFiles.push(`${path.basename(file)} (read failed: ${err instanceof Error ? err.message : 'unknown'})`);
        continue;
      }
      for (const line of content.split(/\r?\n/)) {
        if (!line) continue;
        totalRawLines++;
        const entry = parseLine(line);
        if (!entry) continue;
        totalParsedEntries++;
        if (!matchesFilter(entry, filters)) continue;
        entries.push(entry);
      }
    }
    entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 3) Build the header: scope notice + staleness + skipped-files notice + format-anomaly diagnostics
    const headerParts: string[] = [];
    const scopeNotice = buildScopeNotice(args.scope ?? 'current', logsDir, files);
    if (scopeNotice) headerParts.push(scopeNotice);
    const staleness = formatStalenessHeader(entries, files);
    if (staleness) headerParts.push(staleness);
    if (skippedFiles.length > 0) {
      headerParts.push(`[Skipped files] ${skippedFiles.join('; ')}`);
    }
    if (totalRawLines > 0 && totalParsedEntries === 0) {
      headerParts.push(
        `[Warning] Read ${totalRawLines} non-empty lines but parsed 0 valid log entries — log format may not match the expected pattern (timestamp + level + optional [source] + message).`,
      );
    }
    const headerSection = headerParts.length > 0 ? headerParts.join('\n\n') + '\n\n' : '';

    if (args.mode === 'stats') {
      return headerSection + formatStats(entries);
    }
    if (args.mode === 'sources') {
      return headerSection + formatSources(entries);
    }

    // entries mode
    if (entries.length === 0) {
      return headerSection + buildEmptyEntriesHint(args, totalParsedEntries);
    }
    const limit = clampLimit(args.limit);
    const slice = entries.slice(0, limit);
    const body = slice.map(formatEntry).join('\n');
    const truncatedNote =
      entries.length > limit
        ? `\n\n[... ${entries.length - limit} more entries truncated. Narrow filters or use mode="stats" for an overview.]`
        : '';
    return headerSection + body + truncatedNote;
  } catch (err) {
    return `Error reading logs: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Validate every LLM-supplied arg; null = pass, otherwise return an LLM-facing correction message. */
function validateArgs(args: ReadAppLogsArgs): string | null {
  if (!args || typeof args !== 'object') {
    return 'Error: arguments must be an object.';
  }

  // mode
  if (!args.mode || !VALID_MODES.includes(args.mode)) {
    return `Error: "mode" is required and must be one of ${VALID_MODES.map((m) => `"${m}"`).join(' | ')}. Got: ${JSON.stringify(args.mode)}.`;
  }

  // unknown top-level keys (guard against the LLM using stale field names like maxLines)
  const unknown = Object.keys(args).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) {
    return `Error: unknown parameter(s): ${unknown.join(', ')}. Valid keys are: ${[...KNOWN_KEYS].join(', ')}.`;
  }

  // level
  if (args.level !== undefined) {
    if (!Array.isArray(args.level)) {
      return 'Error: "level" must be an array of strings.';
    }
    const upper = args.level.map((l) => String(l).toUpperCase());
    const bad = upper.filter((l) => !VALID_LEVELS.includes(l as typeof VALID_LEVELS[number]));
    if (bad.length > 0) {
      return `Error: invalid level value(s): ${bad.join(', ')}. Valid levels are: ${VALID_LEVELS.join(', ').toLowerCase()}.`;
    }
  }

  // scope
  if (args.scope !== undefined && !VALID_SCOPES.includes(args.scope)) {
    return `Error: "scope" must be one of ${VALID_SCOPES.map((s) => `"${s}"`).join(' | ')}. Got: ${JSON.stringify(args.scope)}.`;
  }

  // from / to
  if (args.from !== undefined) {
    if (typeof args.from !== 'string' || isNaN(parseDateTime(args.from).getTime())) {
      return `Error: "from" is not a recognizable timestamp. Use ISO 8601 (e.g. "2026-04-22T14:00:00Z") or "YYYY-MM-DD HH:mm". Got: ${JSON.stringify(args.from)}.`;
    }
  }
  if (args.to !== undefined) {
    if (typeof args.to !== 'string' || isNaN(parseDateTime(args.to).getTime())) {
      return `Error: "to" is not a recognizable timestamp. Use ISO 8601 or "YYYY-MM-DD HH:mm". Got: ${JSON.stringify(args.to)}.`;
    }
  }
  if (args.from && args.to) {
    const f = parseDateTime(args.from);
    const t = parseDateTime(args.to);
    if (f > t) {
      return `Error: "from" (${args.from}) is later than "to" (${args.to}). Time window is empty.`;
    }
  }

  // grep: validate regex literal up front so buildGrepMatcher doesn't throw a SyntaxError later
  if (args.grep !== undefined) {
    if (typeof args.grep !== 'string' || args.grep.length === 0) {
      return 'Error: "grep" must be a non-empty string.';
    }
    const reMatch = args.grep.match(/^\/(.+)\/([gimsuy]*)$/);
    if (reMatch) {
      try {
        new RegExp(reMatch[1], reMatch[2] || 'i');
      } catch (err) {
        return `Error: invalid regex in "grep": ${err instanceof Error ? err.message : String(err)}. Tip: use plain text (no slashes) for substring match.`;
      }
    }
  }

  // source
  if (args.source !== undefined && (typeof args.source !== 'string' || args.source.length === 0)) {
    return 'Error: "source" must be a non-empty glob string (e.g. "mcp*", "*Manager").';
  }

  // limit
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isFinite(args.limit) || args.limit <= 0) {
      return `Error: "limit" must be a positive number. Got: ${JSON.stringify(args.limit)}.`;
    }
  }

  return null;
}

/** Give the LLM a useful hint when entries mode returns nothing — distinguish "filters too tight" from "logs empty". */
function buildEmptyEntriesHint(args: ReadAppLogsArgs, totalParsed: number): string {
  if (totalParsed === 0) {
    return 'No log entries match the given filters. Note: 0 entries were parsed from the log file(s) — the file may be empty or in an unexpected format.';
  }
  const activeFilters: string[] = [];
  if (args.source) activeFilters.push(`source="${args.source}"`);
  if (args.level && args.level.length > 0) activeFilters.push(`level=[${args.level.join(',')}]`);
  if (args.grep) activeFilters.push(`grep="${args.grep}"`);
  if (args.from) activeFilters.push(`from="${args.from}"`);
  if (args.to) activeFilters.push(`to="${args.to}"`);
  const filterStr = activeFilters.length > 0 ? ` (filters: ${activeFilters.join(', ')})` : '';
  const tips: string[] = [];
  if (args.source) tips.push(`try mode="sources" first to discover available source values`);
  if (args.grep) tips.push(`relax the grep expression`);
  if (args.from || args.to) tips.push(`widen the time window or use scope="all"`);
  if (args.scope !== 'all') tips.push(`try scope="all" to search historical logs`);
  const tipStr = tips.length > 0 ? ` Suggestions: ${tips.join('; ')}.` : '';
  return `No log entries match the given filters${filterStr}. ${totalParsed} total entries scanned.${tipStr}`;
}

function resolveLogFiles(logsDir: string, scope: 'current' | 'all'): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return [];
  }
  const allLogFiles = entries
    .filter((name) => name.endsWith('.log'))
    .sort()
    .map((name) => path.join(logsDir, name));

  if (allLogFiles.length === 0) return [];

  if (scope === 'all') return allLogFiles;

  // scope === 'current': only the file the current run writes to.
  // Dev mode = this launch's openkosmos-dev-*.log; prod = today's openkosmos-YYYY-MM-DD.log.
  // Both come from getCurrentLogFileName(), which already encodes that distinction.
  const currentName = getCurrentLogFileName();
  const currentPath = path.join(logsDir, currentName);
  if (fs.existsSync(currentPath)) return [currentPath];

  // Current run's file may not be flushed to disk yet (very early after startup).
  // In dev that almost never matters because no event is interesting yet; in prod the
  // daily file is created on first write. Fall back to the most recent file by mtime
  // and let the staleness header surface that the LLM is looking at older data.
  const latest = allLogFiles
    .map((f) => ({ f, mtime: safeStatMtime(f) }))
    .sort((a, b) => b.mtime - a.mtime || b.f.localeCompare(a.f))[0];
  return latest ? [latest.f] : [];
}

function safeStatMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Tell the LLM exactly which log slice it's looking at — the "current" scope hides
 * a dev-vs-prod distinction the model needs to reason about (e.g. "no logs about X
 * before this launch" only proves something in prod, where the file aggregates a day).
 */
function buildScopeNotice(scope: 'current' | 'all', logsDir: string, selectedFiles: string[]): string {
  if (scope === 'all') {
    return `[Scope] all — ${selectedFiles.length} log file(s) across history.`;
  }
  const isDev = isDevelopmentLogEnvironment();
  const expected = path.join(logsDir, getCurrentLogFileName());
  const single = selectedFiles[0];
  const usingExpected = single === expected;
  if (isDev) {
    return usingExpected
      ? `[Scope] current (dev) — only this launch's log file. Earlier dev launches won't appear; use scope="all" to include them.`
      : `[Scope] current (dev) — this launch's log file is empty/missing, falling back to the most recent log file by mtime. Use scope="all" to widen.`;
  }
  return usingExpected
    ? `[Scope] current (prod) — today's aggregated log file.`
    : `[Scope] current (prod) — today's log file is missing, falling back to the most recent log file by mtime. Use scope="all" to widen.`;
}

function buildFilters(args: ReadAppLogsArgs): Filters {
  const filters: Filters = {};
  if (args.source) filters.source = args.source;
  if (args.level && args.level.length > 0) {
    filters.level = args.level.map((l) => l.toUpperCase());
  }
  if (args.grep) filters.grep = args.grep;
  if (args.from) filters.from = parseDateTime(args.from);
  if (args.to) filters.to = parseDateTime(args.to);
  return filters;
}

function clampLimit(raw: number | undefined): number {
  if (!raw || raw <= 0) return ENTRIES_DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), ENTRIES_HARD_LIMIT);
}
