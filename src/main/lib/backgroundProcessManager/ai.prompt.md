<!-- Last verified: 2026-04-03 -->
# Background Process Manager

> Singleton lifecycle wrapper for async background process execution. Wraps TerminalManager for non-blocking command execution with output capture and session management.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `BackgroundProcessManager.ts` | Singleton manager: spawn, poll, log, kill, list sessions | ~200 LOC |
| `types.ts` | Type definitions for sessions, results, and options | ~70 LOC |
| `index.ts` | Module re-exports | ~10 LOC |

## Architecture

### Design Decisions
- **Thin wrapper**: Does not reinvent process management. Delegates all actual process spawning/management to `TerminalManager` with `persistent: true`.
- **Ring buffer output**: Each session stores up to 1000 lines (max 500 chars each). Oldest lines are evicted when buffer is full.
- **Line-based storage**: Output is split on newlines and stored as discrete lines, not raw character chunks. This enables efficient pagination via offset/limit.
- **Auto-cleanup**: Session data is retained for 5 minutes after process exit, then garbage collected. Cleanup timer uses `.unref()` to not block process exit.

### Session Lifecycle
```
spawn() → running → (exit event) → exited/error → (5 min) → garbage collected
                         ↓
                      kill() → exited (forced)
```

### Session ID Format
`bg_${Date.now()}_${random6chars}` — e.g., `bg_1712134567890_a1b2c3`

### Output Handling
- stdout lines stored as-is
- stderr lines prefixed with `[stderr] `
- Error events logged as `[error] ${message}`

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Increase ring buffer size | `BackgroundProcessManager.ts` (`MAX_OUTPUT_LINES`) | Currently 1000 lines |
| Change cleanup delay | `BackgroundProcessManager.ts` (`SESSION_CLEANUP_DELAY_MS`) | Currently 5 min |
| Add new session metadata | `types.ts` (`BackgroundSessionData`) + `BackgroundProcessManager.ts` | Update spawn() and list() |
| Add new action to manage_process | `manageProcessTool.ts` | Add to action enum, implement case, update schema |

## Gotchas
- ⚠️ `TerminalManager.createInstance()` with `persistent: true` auto-starts the process. The `start()` call in `spawn()` is for consistency but may be redundant for persistent instances.
- ⚠️ Session cleanup timer uses `.unref()` — if you need guaranteed cleanup, consider explicit dispose logic.
- ⚠️ Ring buffer eviction is FIFO. If a process produces output faster than the LLM can read it, old lines are lost.
- ⚠️ `poll()` returns `status: 'error'` with `durationMs: 0` when session not found — callers should check this case.

## Related
- Depends on: [TerminalManager](../terminalManager/), [UnifiedLogger](../unifiedLogger/)
- Depended by: [ExecuteCommandTool](../mcpRuntime/builtinTools/executeCommandTool.ts), [ManageProcessTool](../mcpRuntime/builtinTools/manageProcessTool.ts)
