<!-- Last verified: 2026-07-05 -->
# Log Analysis Guide

## Overview

OpenKosmos logs are written by the main process UnifiedLogger in the user's app data directory. Production runs write to daily files; dev runs write to a per-launch file whose name includes the dev startup timestamp. Use the `log-query.ts` script to search, filter, and analyze logs efficiently.

## Log Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/openkosmos-app/logs/openkosmos-YYYY-MM-DD.log` |
| Windows | `%APPDATA%/openkosmos-app/logs/openkosmos-YYYY-MM-DD.log` |
| Linux | `~/.local/share/openkosmos-app/logs/openkosmos-YYYY-MM-DD.log` |

Dev mode (`NODE_ENV=development` or `--dev`) writes to `openkosmos-dev-YYYY-MM-DD-HH-mm-ss.log` in the same `logs/` directory. On each dev startup, old `openkosmos-dev-*.log` files are removed and a new dev file is used for that launch; production `openkosmos-YYYY-MM-DD.log` files are not deleted by dev cleanup.

UnifiedLogger uses the same cache and flush mechanism in dev and production: logs are cached in memory, full cache objects are written to disk, app exit forces a final flush, and the manual "flush to disk" path writes non-full cache objects. Dev and production differ only in the target log file naming, plus dev mode forwards structured renderer logs to the main process for file persistence.

## Log Format

Each line: `{ISO_TIMESTAMP} {LEVEL} [{SOURCE}] {MESSAGE} {optional JSON metadata}`

- Levels: `DEBUG`, `INFO`, `WARN`, `ERROR`
- Source: module identifier (e.g., `main`, `chat`, `mcp:tool`, `Analytics`, `AppCacheManager`)
- Lines starting with `#` are internal cache object markers (ignored by the query script)

## Adding Logs

Use the shared logger paths so logs are queryable, persisted consistently, and safe for production.

### Main process

Main-process code should import the unified logger with the correct relative path for the file being edited and cache the global logger in a module-level const:

```ts
// Example from a file under src/main/lib/<module>/.
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

logger.info('Agent session started', 'chat:session', {
  chatId,
  agentId,
  messageCount,
});
```

- Use `logger.debug/info/warn/error(message, source, metadata)`.
- `createLogger()` returns the shared main-process logger singleton. Module identity comes from the `source` argument, not from distinct logger instances.
- Keep `source` stable and filterable. Prefer existing prefixes such as `chat:*`, `mcp:*`, `scheduler:*`, `RuntimeManager`, or the owning module name.
- Put structured dimensions in `metadata`: IDs, counts, durations, state names, feature flags, and short error messages.
- Do not place secrets, OAuth tokens, API keys, cookies, full prompts, full model responses, raw tool payloads, file contents, or large serialized objects in logs.

### Renderer process

Renderer code should use the renderer logger:

```ts
import { createLogger } from '@renderer/lib/utilities/logger';

const logger = createLogger('[AgentPage]');

logger.info('Session selected', { chatId, agentId });
logger.debug('Draft changed', { length: draft.length });
```

In development, `src/renderer/lib/utilities/logger.ts` writes human-readable DevTools output and forwards a structured entry through `window.electronAPI.logger.sendLog()`. The main process receives it on `logger:rendererLog` and writes it through the dev logger. In production, renderer logs remain console-only and are not persisted by this bridge.

- Prefer a component or feature prefix such as `[AgentPage]`, `[ChatInput]`, or `[Settings]`.
- Do not call `logger:rendererLog` directly; use `createLogger`.
- Renderer `debug()` and `verbose()` are development-only and do nothing in production builds. Use `info`, `warn`, or `error` for important diagnostics that must remain visible in production consoles.
- Avoid temporary `console.log` debugging. If a log is worth keeping, make it structured and low-volume; if it is not worth keeping, remove it before committing.

### Level selection

| Level | Use for | Avoid for |
|-------|---------|-----------|
| `ERROR` | Operation failures, unhandled exceptions, data corruption, failed persistence, failed external calls after retries | Expected user cancellations or recoverable validation failures |
| `WARN` | Recoverable degradation, fallback paths, retry exhaustion that still returns partial success, unexpected but handled states | Normal startup, successful fallback probing, periodic "healthy" status |
| `INFO` | Low-volume lifecycle events, user-visible state transitions, one-time configuration decisions, completed background actions | Per-item loops, polling ticks, stream chunks, heartbeat/no-op logs |
| `DEBUG` | Local investigation details that are useful only during development | Production-critical diagnostics, high-frequency traces without a guard |

### Performance and volume rules

Application logs run in the Electron main-process environment and can affect UI responsiveness when overused. Before adding a log in an event handler, timer, stream, or loop, estimate daily volume: `(calls per event) x (events per minute) x (minutes per day)`. If a non-error log can exceed roughly 100 entries/day in normal usage, use a lower-volume design.

Required patterns for high-frequency paths:

1. Log only the first occurrence of an unknown event type, not every event.
2. Prefer end-of-operation summaries over per-item logs.
3. Use sampling only when a summary is insufficient.
4. Gate temporary catch-all diagnostics behind a debug flag that is off by default, and add a dated removal TODO.
5. Log scalar fields such as `type`, `id`, `count`, `durationMs`, and `payloadLength`; never stringify full event objects in hot paths.

Periodic jobs should log when they take action, change state, or fail. Do not log "checked and everything is normal" on every interval.

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

**Always check the staleness header.** If logs are days old, they reflect a previous run of the application and may not correspond to the current code. Re-run the application (`npm run dev`) to generate a fresh `openkosmos-dev-YYYY-MM-DD-HH-mm-ss.log` before drawing conclusions.

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
- `R:*` — Renderer process logs forwarded via IPC, such as `R:Renderer` or `R:AgentPage`
