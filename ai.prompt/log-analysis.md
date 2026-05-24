<!-- Last verified: 2026-04-26 -->
# Log Analysis Guide

## Overview

Kosmos logs are written by the main process UnifiedLogger in the user's app data directory. Production runs write to daily files; dev runs write to a per-launch file whose name includes the dev startup timestamp. Use the `log-query.ts` script to search, filter, and analyze logs efficiently.

## Log Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/openkosmos-app/logs/kosmos-YYYY-MM-DD.log` |
| Windows | `%APPDATA%/openkosmos-app/logs/kosmos-YYYY-MM-DD.log` |
| Linux | `~/.local/share/openkosmos-app/logs/kosmos-YYYY-MM-DD.log` |

Dev mode (`NODE_ENV=development` or `--dev`) writes to `kosmos-dev-YYYY-MM-DD-HH-mm-ss.log` in the same `logs/` directory. On each dev startup, old `kosmos-dev-*.log` files are removed and a new dev file is used for that launch; production `kosmos-YYYY-MM-DD.log` files are not deleted by dev cleanup.

UnifiedLogger uses the same cache and flush mechanism in dev and production: logs are cached in memory, full cache objects are written to disk, app exit forces a final flush, and the manual "flush to disk" path writes non-full cache objects. Dev and production differ only in the target log file naming, plus dev mode forwards structured renderer logs to the main process for file persistence.

## Log Format

Each line: `{ISO_TIMESTAMP} {LEVEL} [{SOURCE}] {MESSAGE} {optional JSON metadata}`

- Levels: `DEBUG`, `INFO`, `WARN`, `ERROR`
- Source: module identifier (e.g., `main`, `chat`, `mcp:tool`, `Analytics`, `AppCacheManager`)
- Lines starting with `#` are internal cache object markers (ignored by the query script)

## Query Script

```bash
bun scripts/log-query.ts [options]
```

### Quick Reference

| Goal | Command |
|------|---------|
| See current log health | `bun scripts/log-query.ts --stats` |
| Discover available sources | `bun scripts/log-query.ts --sources` |
| Errors only | `bun scripts/log-query.ts --level error` |
| Errors + warnings | `bun scripts/log-query.ts --level error,warn` |
| Filter by module | `bun scripts/log-query.ts --source chat` |
| Wildcard source | `bun scripts/log-query.ts --source "mcp*"` |
| Keyword search | `bun scripts/log-query.ts --grep "timeout"` |
| Regex search | `bun scripts/log-query.ts --grep "/time.*out/i"` |
| OR search | `bun scripts/log-query.ts --grep "error,failed,timeout"` |
| AND search | `bun scripts/log-query.ts --grep "error+mcp"` |
| NOT search | `bun scripts/log-query.ts --grep "error+!renderer"` |
| Time range | `bun scripts/log-query.ts --from "2026-04-09 10:00" --to "2026-04-09 11:00"` |
| Limit output | `bun scripts/log-query.ts --level error --limit 20` |
| Watch live | `bun scripts/log-query.ts --tail --source chat` |
| All history | `bun scripts/log-query.ts --all --level error` |

All options can be combined.

## Grep Expression Syntax

`--grep` supports flexible search patterns:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `text` | Case-insensitive substring | `--grep "timeout"` |
| `/regex/flags` | Regular expression | `--grep "/time.*out/i"` |
| `a,b` | OR — match any term | `--grep "error,failed,crash"` |
| `a+b` | AND — match all terms | `--grep "error+mcp"` |
| `!term` | NOT — exclude matches | `--grep "error+!debug"` |
| `a+b,c+d` | Combined — (a AND b) OR (c AND d) | `--grep "error+mcp,timeout+chat"` |

## Log Staleness

The script automatically prints a staleness header before output, showing:
- Which log file(s) were read
- The timestamp of the last log entry
- A warning if logs are more than 1 day old

**Always check the staleness header.** If logs are days old, they reflect a previous run of the application and may not correspond to the current code. Re-run the application (`npm run dev`) to generate a fresh `kosmos-dev-YYYY-MM-DD-HH-mm-ss.log` before drawing conclusions.

## Recommended Analysis Workflow

1. **Get the big picture** — Run `--stats` to see total volume, level distribution, and top sources.
2. **Discover dimensions** — Run `--sources` to see all available source values for filtering.
3. **Narrow down** — Use `--source`, `--level`, `--from`/`--to`, and `--grep` to focus on the area of interest.
4. **Go deeper** — Read the filtered output; use `--grep` to search for specific error messages or IDs.

## Common Scenarios

### App startup failure
```bash
bun scripts/log-query.ts --level error,warn --limit 50
bun scripts/log-query.ts --source "startup*" --level error
```

### Chat / agent error
```bash
bun scripts/log-query.ts --source "chat*" --level error,warn
bun scripts/log-query.ts --grep "session-id-here"
```

### MCP tool issues
```bash
bun scripts/log-query.ts --source "mcp*" --level error,warn
bun scripts/log-query.ts --source "mcp*" --grep "timeout"
```

### Performance investigation
```bash
bun scripts/log-query.ts --stats --from "2026-04-09 10:00" --to "2026-04-09 10:05"
bun scripts/log-query.ts --grep "slow,latency,duration"
```

### Monitor a module in real-time
```bash
bun scripts/log-query.ts --tail --source chat
bun scripts/log-query.ts --tail --level error
```

## Key Source Names

Common source prefixes in the codebase (run `--sources` for the live list):

- `main` — Main process lifecycle, startup
- `chat` / `chat:*` — Chat engine, agent loop
- `mcp` / `mcp:*` — MCP runtime, tool execution
- `AppCacheManager` — Profile/config persistence
- `scheduler` / `scheduler:*` — Scheduled jobs
- `R:Renderer` — Renderer process logs forwarded via IPC
