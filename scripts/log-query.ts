#!/usr/bin/env bun
/**
 * log-query.ts — CLI tool for querying OpenKosmos application log files.
 * Run with: bun scripts/log-query.ts [options]
 *
 * Core parse/filter/format logic lives in src/main/lib/doctor/logQuery/ so the
 * Doctor Agent's read_app_logs tool can reuse the exact same implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { selectMostRecentLogFile } from '../src/main/lib/unifiedLogger/LogQueryFileSelection';
import {
  parseLine,
  parseDateTime,
  matchesFilter,
  formatEntry,
  formatStats,
  formatSources,
  formatStalenessHeader,
  type LogEntry,
  type Filters,
} from '../src/main/lib/doctor/logQuery';

// ── Types ──────────────────────────────────────────────────────────────────

interface Options extends Filters {
  stats: boolean;
  sources: boolean;
  tail: boolean;
  dir?: string;
  file?: string;
  limit?: number;
  today: boolean;
  all: boolean;
  help: boolean;
}

// ── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2);
  const opts: Options = {
    stats: false,
    sources: false,
    tail: false,
    today: false,
    all: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--source":
        opts.source = args[++i];
        break;
      case "--level":
        opts.level = args[++i].split(",").map((l) => l.trim().toUpperCase());
        break;
      case "--from":
        opts.from = parseDateTime(args[++i]);
        break;
      case "--to":
        opts.to = parseDateTime(args[++i]);
        break;
      case "--grep":
        opts.grep = args[++i];
        break;
      case "--stats":
        opts.stats = true;
        break;
      case "--sources":
        opts.sources = true;
        break;
      case "--tail":
        opts.tail = true;
        break;
      case "--dir":
        opts.dir = args[++i];
        break;
      case "--file":
        opts.file = args[++i];
        break;
      case "--limit":
        opts.limit = parseInt(args[++i], 10);
        break;
      case "--today":
        opts.today = true;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  // Validate: output modes are mutually exclusive
  const modes = [opts.stats, opts.sources, opts.tail].filter(Boolean).length;
  if (modes > 1) {
    console.error("Error: --stats, --sources, and --tail are mutually exclusive. Pick one.");
    process.exit(1);
  }

  // Validate: file selection conflicts
  if (opts.file && (opts.dir || opts.all)) {
    console.error("Error: --file cannot be combined with --dir or --all.");
    process.exit(1);
  }

  // Require at least one filter or aggregation mode to prevent dumping entire log files
  // (which can easily blow up LLM context windows)
  const hasFilter = opts.source || opts.level || opts.from || opts.to || opts.grep || opts.limit;
  const hasMode = opts.stats || opts.sources || opts.tail;
  if (!hasFilter && !hasMode) {
    console.error(
      "Error: At least one filter (--source, --level, --from, --to, --grep, --limit) " +
      "or mode (--stats, --sources, --tail) is required.\n" +
      "This prevents dumping entire log files which can overwhelm LLM context.\n" +
      "Try: --stats for an overview, or --level error to see errors only."
    );
    process.exit(1);
  }

  // Default: --today unless --from, --file, or --all is specified
  if (!opts.from && !opts.file && !opts.all) {
    opts.today = true;
  }

  return opts;
}

// ── Help ───────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
Usage: bun scripts/log-query.ts [options]

Query and analyze OpenKosmos application log files.

Filters:
  --source <pattern>   Filter by source, supports * glob (e.g. "chat*", "mcp*")
  --level <levels>     Filter by level, comma-separated (e.g. "error,warn")
  --from <time>        Start time (ISO or "YYYY-MM-DD HH:mm")
  --to <time>          End time
  --grep <expr>        Search in message/source/metadata. Supports:
                         plain text    case-insensitive substring match
                         /regex/       regular expression (e.g. /time.*out/i)
                         a,b           OR — match any term
                         a+b           AND — match all terms
                         !term         NOT — exclude lines matching term
                         Combine: "error+mcp,warn+timeout" = (error AND mcp) OR (warn AND timeout)
  --limit <n>          Max entries to output

Modes:
  --stats              Output aggregated statistics
  --sources            List all unique source values
  --tail               Real-time tail mode (poll every 500ms)

File selection:
  --dir <path>         Log directory path (auto-detected if omitted)
  --file <path>        Specific log file path
  --today              Only today's log (default unless --from/--file/--all)
  --all                Query all log files in log directory

Other:
  --help, -h           Show this help

Examples:
  bun scripts/log-query.ts --stats
  bun scripts/log-query.ts --level error,warn --limit 20
  bun scripts/log-query.ts --source "mcp*" --grep "timeout" --all
  bun scripts/log-query.ts --sources --all
  bun scripts/log-query.ts --tail
`.trim());
}

// ── Log directory detection ────────────────────────────────────────────────

function detectLogDir(): string {
  const platform = os.platform();
  const home = os.homedir();

  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      path.join(home, "Library/Application Support/openkosmos-app/logs")
    );
  } else if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    candidates.push(
      path.join(appData, "openkosmos-app/logs")
    );
  } else {
    // Linux / XDG
    const dataDir =
      process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
    candidates.push(
      path.join(dataDir, "openkosmos-app/logs")
    );
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  console.error(
    "Could not auto-detect log directory. Use --dir or --file to specify."
  );
  process.exit(1);
}

function getLogFiles(opts: Options): string[] {
  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`File not found: ${opts.file}`);
      process.exit(1);
    }
    return [opts.file];
  }

  const dir = opts.dir || detectLogDir();
  if (!fs.existsSync(dir)) {
    console.error(`Log directory not found: ${dir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .sort()
    .map((f) => path.join(dir, f));

  if (opts.today) {
    const now = new Date();
    const todayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const todayFiles = files.filter((f) => path.basename(f).includes(todayStr));
    if (todayFiles.length > 0) {
      return [selectMostRecentLogFile(todayFiles)];
    }
    // No today file — fall back to the most recent file
    return files.length > 0 ? [files[files.length - 1]] : [];
  }

  if (!opts.all) {
    // Default: read only the most recent file
    return files.length > 0 ? [files[files.length - 1]] : [];
  }

  return files;
}

// ── Tail mode ──────────────────────────────────────────────────────────────

async function tailMode(opts: Options): Promise<void> {
  const files = getLogFiles({ ...opts, today: true, all: false });
  if (files.length === 0) {
    console.error("No log files found to tail.");
    process.exit(1);
  }

  let filePath = files[files.length - 1];
  let offset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

  process.stderr.write(`Tailing ${filePath} (Ctrl+C to stop)...\n`);

  let count = 0;
  const limit = opts.limit || Infinity;

  const poll = () => {
    // Check if a newer file appeared (date rollover)
    const currentFiles = getLogFiles({ ...opts, today: true, all: false });
    const latestFile = currentFiles[currentFiles.length - 1];
    if (latestFile && latestFile !== filePath) {
      filePath = latestFile;
      offset = 0;
      process.stderr.write(`\nSwitched to ${filePath}\n`);
    }

    if (!fs.existsSync(filePath)) return;

    const stat = fs.statSync(filePath);
    if (stat.size <= offset) {
      if (stat.size < offset) offset = 0; // file was truncated/rotated
      return;
    }

    const buf = Buffer.alloc(stat.size - offset);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = stat.size;

    const chunk = buf.toString("utf-8");
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (count >= limit) {
        process.exit(0);
      }
      const entry = parseLine(line);
      if (!entry) continue;
      if (!matchesFilter(entry, opts)) continue;
      console.log(formatEntry(entry));
      count++;
    }
  };

  setInterval(poll, 500);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  if (opts.tail) {
    tailMode(opts);
    return;
  }

  const files = getLogFiles(opts);
  if (files.length === 0) {
    console.error("No log files found.");
    process.exit(1);
  }

  // Parse all entries
  const entries: LogEntry[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    for (const line of content.split("\n")) {
      const entry = parseLine(line);
      if (!entry) continue;
      if (!matchesFilter(entry, opts)) continue;
      entries.push(entry);
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Print log staleness header
  const header = formatStalenessHeader(entries, files);
  if (header) console.log(header);

  if (opts.stats) {
    console.log(formatStats(entries));
    return;
  }

  if (opts.sources) {
    console.log(formatSources(entries));
    return;
  }

  // Normal output
  const limit = opts.limit || entries.length;
  for (let i = 0; i < Math.min(limit, entries.length); i++) {
    console.log(formatEntry(entries[i]));
  }
}

main();
