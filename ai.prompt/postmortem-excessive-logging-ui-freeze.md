# Postmortem: Excessive main-process logging causes UI freeze

<!-- Last verified: 2026-05-14 -->

**Date:** 2026-05-14 | **Severity:** P1 (frequent UI freeze during tool-calling agent chat) | **Affected:** Kosmos 2.7.14, all users running agents with tool calls

## Symptom
Users report the frontend UI freezes (becomes unresponsive for seconds) during agent chat sessions, especially when the agent invokes tools. DevTools console shows rapid-fire `AgentChatSessionCacheManager` callback triggers. Main-process log file grows to 512KB/day with repetitive entries.

## Root Cause
Four independent logging hotspots in the main process collectively produced **44,000+ log entries per day**, overwhelming the logger I/O path and degrading event loop responsiveness:

| Source | Daily volume | Content | Problem |
|--------|-------------|---------|---------|
| `agentChatStreamingService.ts:728` | 37,338 | Every `response.function_call_arguments.delta` token logged at INFO with 500-byte JSON sample | High-frequency streaming event treated as "unknown" and logged per-token |
| `SchedulerManager.ts:1323` | 709 × 4-5KB | Full `taskRuntimeMeta` for all 15 tasks in every heartbeat | Static data repeated every 60s |
| `tokenMonitor.ts:107-178` | 2,100 (3 per min) | "Starting check" + "Token status" + "Token normal" | Normal-path logging — "nothing happened" recorded every minute |
| `TerminalManager.ts:672-720` | 3,968 (2 per min) | "Starting cleanup" + "No instances need cleanup" | No-op result logged every minute |

The streaming log (37K entries) is the primary contributor. During a tool call, hundreds of `function_call_arguments.delta` events arrive within milliseconds. Each triggers `logger.info()` with `JSON.stringify(data).substring(0, 500)` — a synchronous serialization + I/O operation on the main process event loop. This delays IPC message delivery to the renderer, causing streaming messages to batch up and arrive in bursts, triggering callback storms in the renderer.

## Timeline
| Date | Event |
|------|-------|
| ~2026-03 | `agentChatStreamingService.ts` added catch-all logging for `/responses` events during OpenAI Responses API integration. Intent: discover unhandled event types during development. The exclusion list covered `output_text.delta` (known high-frequency) but not `function_call_arguments.delta` (equally high-frequency but overlooked). |
| ~2026-04 | `MainTokenMonitor` and `TerminalManager` added verbose DEBUG logging for operational monitoring. |
| 2026-05-14 | User reports UI freeze. Investigation reveals 37K+ INFO logs/day from streaming alone. |

## Why It Happened
1. **Development logging left in production**: The catch-all `/responses` logger was a debugging aid during API integration. Once the event types were understood, it should have been removed or gated behind a dev flag — but wasn't.
2. **"Log everything" mindset without cost awareness**: Developers added per-cycle DEBUG logs to timers (TokenMonitor, TerminalManager) without considering the aggregate volume. Each individual log seems harmless; collectively they produce 44K entries/day.
3. **No distinction between "something happened" and "nothing happened"**: Logging "No instances need cleanup" or "Token status normal" every 60 seconds provides zero diagnostic value but 100% of the I/O cost.
4. **Incomplete exclusion list**: When `output_text.delta` was excluded from the catch-all logger (recognizing it as high-frequency), `function_call_arguments.delta` (equally high-frequency) was missed — suggesting the exclusion was done reactively rather than systematically.

## Why It Wasn't Caught
1. **No log volume monitoring**: There is no alerting or metric on log entries/second. The 37K entries accumulated silently.
2. **Dev environment doesn't reproduce**: Developers rarely trigger long multi-tool agent sessions locally. Short test chats produce manageable log volumes.
3. **UI freeze is intermittent**: The freeze correlates with tool-call streaming bursts, not constant usage — easy to dismiss as "network lag."

## Fix (commits `a7fc8dab`, `4d8c75eb`)
| File | Change |
|------|--------|
| `agentChatStreamingService.ts` | Added `function_call_arguments.delta` to exclusion list. Changed catch-all to only log **first occurrence** of each unknown event type (deduplicated via `Set`). Removed `dataSample` (500-byte JSON payload). |
| `SchedulerManager.ts` | Removed `taskRuntimeMeta` from heartbeat payload. Only log `activeTaskCount` + job IDs. |
| `tokenMonitor.ts` | Removed all normal-path logs (start check, status check, "token normal"). Only log on: token missing, token expiring soon, token expired, refresh error. |
| `TerminalManager.ts` | Removed "Starting cleanup" and "No instances need cleanup" logs. Only logs when instances are actually cleaned up. Changed `cleanupIntervalMs` from 60s to 300s (matches `idleTimeoutMs`). |
| `agentChatSessionCacheManager.ts` | **Reverted** — initially raised adaptive batch ceiling (threshold 60→150ms, delay 40→80ms) but rolled back because: (1) root cause is logging, not batch params; (2) higher ceiling causes visible text stutter regression. |

**Expected reduction:** ~44,000 log entries/day → near-zero during normal operation. Logger I/O no longer blocks the event loop during streaming.

## Lessons & Rules

### Rule 1: Log events, not heartbeats
Periodic timers should only log when they **do something** (state change, error, action taken). "Everything is normal" is not an event. If you need liveness proof, use a dedicated health-check mechanism, not application logs.

### Rule 2: High-frequency streaming paths must never log per-message
Any code path that fires per-token (streaming deltas, WebSocket frames, animation frames) must not call `logger.*()` unconditionally. If debugging is needed, use:
- Sampling (log 1 in N)
- First-occurrence deduplication
- Aggregate summaries at end-of-stream
- A debug flag that is off by default

### Rule 3: Catch-all loggers need an expiry
"Log everything I don't recognize" is valid during active API integration. Once the integration stabilizes, convert to an allowlist (log only known-important types) or remove entirely. Add a `// TODO: remove after API stabilization` comment with a date when adding such loggers.

### Rule 4: Consider aggregate volume, not individual cost
A single `logger.debug()` is cheap. 4,000 of them per day is not. When adding logging inside `setInterval` or event handlers, multiply: `(calls per interval) × (intervals per hour) × (hours per day)`. If the result exceeds ~100/day for non-error logs, reconsider.

### Rule 5: Never serialize large objects in hot paths
`JSON.stringify(data).substring(0, 500)` in a per-token handler is a hidden O(n) synchronous operation on the event loop. Even if the log is necessary, avoid serializing the full object — log only scalar fields (type, id, length).

### Rule 6: Fix root causes, not symptoms — and validate that symptom-level fixes don't regress UX
During this investigation, the renderer's `AgentChatSessionCacheManager` adaptive batch ceiling was initially raised (threshold 60→150ms, delay 40→80ms) as a "symptom fix" for callback storms. This was **reverted** because:
1. The callback storm was a **secondary effect** of the logging problem (IPC burst delivery after event-loop unblock). Fixing the root cause (logging) eliminates the burst; the original batch parameters work correctly under normal conditions.
2. Raising the batch ceiling introduces a **streaming text stutter regression** — on low-end machines, users would see text appear in 150ms chunks instead of smooth character-by-character flow.
3. Lowering the back-off trigger (100ms→50ms) would cause low-end machines to **permanently stay in degraded mode** since normal React re-render on such machines already takes 30-60ms.

**Lesson:** When a performance problem has a clear root cause (A) and a visible symptom (B), fix A. Only touch B if A alone is insufficient AND you can prove B's fix doesn't degrade the normal-case UX. Never ship a symptom-level fix "just in case" without validating the user experience impact.

## Related
- [Postmortem: v2.7.10 signing hang](postmortem-v2.7.10-signing-hang.md) — same pattern of "background work blocking critical path"
- [arch-main.md](arch-main.md) — main process architecture
- [data-flow.md](data-flow.md) — IPC streaming flow

