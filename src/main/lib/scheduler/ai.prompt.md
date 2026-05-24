<!-- Last verified: 2026-04-30 -->
# Scheduler

> Registers and fires time-based jobs (cron or one-time) that each launch a new chat session against a bound agent.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `SchedulerManager.ts` | Singleton runtime — registers/unregisters `node-cron` tasks and `setTimeout` timers, executes jobs via `agentChatManager.runScheduledJob()`, handles cold-start, system-resume, and heartbeat watchdog catch-up | large (1390 lines) |
| `cronWatchdog.ts` | Heartbeat watchdog helper — detects missed cron occurrences while the process remains alive and requests catch-up execution without duplicating already-started runs | small (128 lines) |
| `scheduleStore.ts` | In-memory cache + persistence layer for `SchedulerJob` records; partitioned by `alias::YYYYMM` month buckets; push-notifies renderer on mutations | large (674 lines) |
| `SchedulerIPC.ts` | IPC handler registration — bridges renderer calls to `SchedulerManager` methods | small (109 lines) |
| `schedulerRuntimeStateStore.ts` | Persists activation timestamps and pending cold-start catch-up entries to `runtime-state.json`; used to detect unclean exits on next boot | medium (208 lines) |
| `cronRecovery.ts` | Pure utility functions: `findMissedCronOccurrence`, `shouldCatchUpMissedOccurrence`, `getColdStartCatchUpBaseline` | small (113 lines) |
| `types.ts` | `SchedulerJob`, `SchedulerJobType` (`cron`/`once`), `SchedulerJobStatus` (`pending`/`completed`/`expired`/`failed`), normalization helpers | small (79 lines) |
| `id.ts` | ID generation (`sched_YYYYMMDDHHMMSS_<suffix>`) and month-key extraction from IDs | tiny (28 lines) |

## Architecture

### Job lifecycle
```
createJob → scheduleStore.createJob → SchedulerManager.registerJob
  ├─ cron  → node-cron.schedule → on tick: executeJob('scheduled')
  └─ once  → setTimeout → on fire: executeJob('scheduled') → unregisterTask('once-job-fired')

executeJob
  → scheduleStore.markJobExecutionStarted
  → agentChatManager.runScheduledJob(job, { chatSessionId?, onReady? })
  → on success: markJobExecutionCompleted (cron stays 'pending'; once becomes 'completed' + disabled)
  → on failure: markJobExecutionFailed   (cron becomes 'failed'; once becomes 'failed' + disabled)
```

### Storage layout
Jobs are partitioned into monthly JSON files under `{userData}/profiles/{alias}/schedules/YYYYMM.json`. The month key for `once` jobs comes from `runAt`; for `cron` jobs it is embedded in the job ID. `runtime-state.json` lives in the same directory.

### Cold-start, resume, and watchdog catch-up
On `initialize()`, `SchedulerManager` reads `SchedulerRuntimeState`. If `isActive === true` at startup the previous session was an unclean exit; the catch-up window opens from `lastActivatedAt`. Missed cron occurrences within `MAX_RESUME_CATCH_UP_DELAY_MS` (6 hours) are executed immediately. Pending catch-ups are checkpointed in `runtime-state.json` so that a crash during catch-up itself is retried on the next boot.

System sleep/resume is handled separately via `handleSystemResume(suspendedAtMs, resumedAtMs)` — called externally from the Electron power-monitor listener.

While the app remains alive, the scheduler heartbeat also runs a watchdog pass. It compares each active cron task's last checked time with `now - HEARTBEAT_INTERVAL_MS`; if `node-cron` missed an occurrence and the job has not already started that occurrence, it executes the job with `triggerSource: 'watchdog-catchup'`.

### IPC push events (main → renderer)
`scheduleStore:jobCreated`, `scheduleStore:jobPatched`, `scheduleStore:jobDeleted` — sent via `BrowserWindow.webContents.send`.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new job field | `types.ts` (`SchedulerJob` + `normalizeSchedulerJob`) → `scheduleStore.ts` (pass-through) | `normalizeSchedulerJob` must handle missing values to preserve backward compat |
| Change catch-up window (6 h limit) | `cronRecovery.ts` (`MAX_RESUME_CATCH_UP_DELAY_MS`) | Affects both system-resume and cold-start paths |
| Add a new IPC endpoint | `SchedulerIPC.ts` + `src/shared/ipc/scheduler.ts` (shared contract) | Follow the `renderToMain.bindMain` pattern |
| Change job status transitions | `SchedulerManager.ts` (`executeJob`) + `scheduleStore.ts` (`markJobExecution*`) | Cron jobs reset to `pending`; once-jobs go terminal and become `enabled: false` |
| Support a new `triggerSource` type | `SchedulerManager.ts` (`executeJob` signature + callers) | Passed through to logging only; not persisted; update watchdog/catch-up tests if it affects recovery |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `SchedulerJob` fields in `types.ts` | `scheduleStore.ts` validation, `normalizeSchedulerJob`, IPC contract in `src/shared/ipc/scheduler.ts`, renderer schedule UI |
| `scheduleSettingsManager` storage paths | `schedulerRuntimeStateStore.ts` (shares same dir via `ensureSchedulesDir`) |
| `agentChatManager.runScheduledJob` signature | `SchedulerManager.executeJob` call site |
| `chatSessionStore.patchSchedulerMetadata` fields | `recoverInterruptedScheduledSessions` in `SchedulerManager.ts` |

## Anti-Patterns
- Do NOT call `scheduleStore` methods directly from outside this module to execute jobs — always go through `SchedulerManager` so runtime task registration stays in sync.
- Do NOT bypass `normalizeSchedulerJob` when reading job data from disk — raw JSON can have missing or wrong-typed fields.
- Do NOT register a new cron task without first calling `unregisterTask` for the same `jobId` — duplicate `node-cron` tasks will silently double-fire.
- Do NOT use `Date.now()` directly in cron tick callbacks — use `new Date().toISOString()` and pass timestamps explicitly so logs are consistent.

## Verification Steps
1. Create a cron job and confirm `activeTasks` contains it (`schedulerManager.getRuntimeDiagnostics()`).
2. Toggle the job off — confirm the cron task is stopped and removed from `activeTasks`.
3. Kill the app while a job is `running`; on next launch confirm the session's `schedulerExecutionStatus` is patched to `failed`.
4. Set `runAt` 2 seconds in the future; confirm `executeJob` fires and the job transitions to `completed`/`enabled: false`.

## Gotchas
- ⚠️ **`initialize()` is called from `auth:setCurrentSession` IPC handler — it MUST NOT block sign-in.** The auth handler was changed to fire-and-forget after v2.7.10 P1 where `handleColdStartCatchUp()` (which runs LLM jobs sequentially) blocked sign-in for 12+ minutes. If you add any new `await` inside `initialize()`, verify the auth handler still returns instantly. See [CLAUDE.md Postmortem: v2.7.10 signing hang](../../../CLAUDE.md#postmortem-v2710-signing-hang).
- ⚠️ **`handleColdStartCatchUp` runs jobs sequentially.** Each `executeColdStartCatchUp` call `await`s an LLM-powered agent chat. If you increase the catch-up window or add more eligible jobs, total cold-start time grows linearly. Consider adding per-job timeouts or parallelism if this becomes an issue again.
- ⚠️ `node-cron` uses the **system timezone** by default; `getSchedulerTimeZone()` reads `Intl.DateTimeFormat` and must be passed explicitly to `CronExpressionParser` in `cronRecovery.ts`.
- ⚠️ `once` jobs become `enabled: false` after execution (success **or** failure). Re-enabling them via `toggleJob` will re-register a new timeout — check that `runAt` is still in the future, otherwise the timeout fires immediately.
- ⚠️ `MAX_TIMEOUT_MS` (2 147 483 647 ms ≈ 24.8 days) caps `setTimeout` for far-future `once` jobs. Jobs beyond this window will never fire; the UI should warn users.
- ⚠️ `schedulerGeneration` is incremented on every `initialize()` call (alias switch or re-login). Stale closures from a previous generation can still hold a reference to the old `job` object — always re-fetch from `scheduleStore` inside the cron callback if the latest state matters.
- ⚠️ The heartbeat watchdog is a safety net for missed `node-cron` callbacks while the process is alive. Keep its one-heartbeat grace window to avoid racing the normal cron callback at the exact minute boundary, and always check `lastRunAt` before executing a missed occurrence so the same occurrence is not recovered twice. Different cron occurrences may still overlap, matching the normal `node-cron` path.
- ⚠️ `scheduleStore` partitions by month via the job ID. Moving a job to a different month (e.g., updating `runAt` across a month boundary) triggers a delete on the old month file and an upsert on the new one — both must succeed for consistency.

## Related
- Depends on: [agentChatManager](../chat/) (`runScheduledJob`), [chatSessionStore](../chat/) (session metadata), [scheduleSettingsManager](../userDataADO/) (file I/O), [profileCacheManager](../userDataADO/ai.prompt.md)
- Depended by: Electron main entry (calls `schedulerManager.initialize` on login, `handleSystemResume` on power events), renderer Scheduler UI (via IPC), MCP built-in `schedule_task` tool
