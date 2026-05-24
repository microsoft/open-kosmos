# Postmortem: v2.7.10 signing hang

**Date:** 2026-04-22 | **Severity:** P1 (some users unable to sign in) | **Affected:** v2.7.10, users with multiple scheduled tasks who had been offline for several hours or more

## Symptom
After updating to 2.7.10, some users launched the app and were stuck on the "Signing In... Loading your profile..." screen for 12+ minutes.

## Root Cause
The `auth:setCurrentSession` IPC handler synchronously `await`ed `schedulerManager.initialize(userLogin)`, and inside `initialize()`, `await handleColdStartCatchUp()` **sequentially executed** all missed scheduled tasks (including LLM calls).

Blocking chain: Renderer `await setCurrentAuth()` → IPC `await schedulerManager.initialize()` → `await handleColdStartCatchUp()` → `for...of { await executeJob() }` → LLM call (401/timeout) → 12+ min

## Timeline
| Date | Event |
|------|-------|
| 03-02 | `e42dc1bf` feat(scheduler) First introduced `await schedulerManager.initialize()` in the auth handler. At the time, `initialize()` only registered jobs, completing in milliseconds; the `await` was harmless. |
| 04-07 | `fc645a7b` fix(scheduler) Added `handleColdStartCatchUp()` inside `initialize()`, which sequentially executes missed scheduled tasks. This changed `initialize()` execution time from milliseconds to **unpredictable** (depending on the number of missed tasks and per-task LLM call duration), but the `await` in the auth handler was not adjusted. |
| 04-07 | `3b1263f8` PR #463 merged the above changes. PR review focused on scheduler logic correctness and did not assess the performance impact on the auth flow. |
| 04-22 | Users report sign-in hang. |

## Why It Happened
1. **Gradual degradation (boiling frog)**: The `await` was added on 03-02 when `initialize()` was fast. The 04-07 change made `initialize()` slow, but the author focused only on the scheduler module internals and did not examine the calling context.
2. **Blind spot at module boundaries**: The scheduler change was inside `SchedulerManager.ts`, but the impact propagated to the IPC handler in `auth.ts`. Nobody checked "who is awaiting `initialize()`?"
3. **Not reproducible in dev**: Developers typically restart the app frequently (short offline periods, few scheduled tasks), so cold-start catchup either never triggered or completed in seconds. The issue only manifested for real users who had been offline for hours with multiple scheduled tasks.

## Why It Wasn't Caught
1. **No sign-in performance tests**: CI only validated functional correctness (typecheck, unit tests); it did not validate an upper time bound for the sign-in flow.
2. **PR review scope was limited**: The diff in #463 was inside the scheduler module; reviewers did not trace the call chain backwards from `initialize()`.
3. **No IPC handler timeout alerting**: The auth handler blocked for 12 minutes with no warning logs or timeout mechanism.

## Fix
Changed `schedulerManager.initialize()` and `BuddyManager.initialize()` from `await` to fire-and-forget (`.then().catch()`), so the auth handler returns immediately and sign-in is no longer blocked by background initialization. Also `await`ed the init promise in `destroyCurrentSession` before disposing, to avoid a sign-out race condition.

## Lessons (written into CLAUDE.md Prohibited Patterns)
1. **No blocking `await` on the sign-in critical path for non-auth work** — Added to Prohibited Patterns.
2. **No unbounded sequential `await` loops** — Using `for...of { await }` over N network/LLM calls produces O(N × latency) unbounded wall-clock time.
3. **When changing function behavior, all callers must be reviewed** — When `initialize()` changed from "millisecond-level" to "unpredictable," every `await initialize()` site needed re-evaluation.
4. **New IPC Handler Discipline rule** — All IPC handlers that gate UI transitions must return within 100ms.
