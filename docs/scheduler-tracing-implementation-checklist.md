# Scheduler Tracing Implementation Checklist

## Overview

This document defines a full-fidelity tracing plan for scheduler runtime diagnostics.
The goal is not minimal logging. The goal is to guarantee that the next reproduction can answer exactly where a scheduled job stopped progressing.

This checklist is designed around the concrete failure shape seen in production:

- Jobs are present in persisted schedule files
- Jobs are enabled
- `SchedulerManager` logs show cron tasks were registered
- The app process remains alive around the expected fire time
- No `executeJob()` entry log appears for the missed occurrence

The tracing below is intended to distinguish these classes of failure:

1. Task was registered and later unregistered
2. Task remained registered but cron callback never fired
3. Cron callback fired but execution was blocked before `executeJob()`
4. `executeJob()` started but failed in persistence or runtime execution
5. External lifecycle events disrupted scheduler state

## Success Criteria

- [x] A future reproduction can prove whether the cron callback arrived
- [x] A future reproduction can prove whether the task was explicitly cleared or disposed
- [x] A future reproduction can correlate scheduler state across init, auth restore, updater handoff, and app shutdown
- [x] Each active task can be traced back to a unique initialization generation and task sequence
- [x] Logs are structured enough to reconstruct the full timeline with `rg 'scheduler\.'`

---

## Phase 1: Runtime Metadata Foundation

### 1.1 Add scheduler runtime generation state

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `schedulerGeneration: number` field
- [x] Add `taskSequence: number` field
- [x] Increment `schedulerGeneration` at the start of every `initialize(alias)`
- [x] Keep `taskSequence` monotonically increasing for every new active task registration
- [x] Include both values in all scheduler logs

**Acceptance Criteria**:

- [x] Every scheduler init has a unique generation id
- [x] Every registered task has a unique task sequence id
- [x] Logs can distinguish tasks registered by different init cycles

### 1.2 Add per-task runtime metadata map

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `taskRuntimeMeta: Map<string, SchedulerTaskRuntimeMeta>` field
- [x] Define `SchedulerTaskRuntimeMeta` with at least:
  - [x] `jobId`
  - [x] `alias`
  - [x] `schedulerGeneration`
  - [x] `taskSequence`
  - [x] `taskKind`
  - [x] `registeredAt`
  - [x] `cronExpression?`
  - [x] `runAt?`
  - [x] `lastTickArrivedAt?`
  - [x] `lastExecuteStartAt?`
  - [x] `lastExecuteEndAt?`
  - [x] `lastExecuteOutcome?`
  - [x] `unregisteredAt?`
  - [x] `lastUnregisterReason?`

**Acceptance Criteria**:

- [x] Every active task has an attached runtime metadata entry
- [x] Metadata is updated when the task fires, executes, and unregisters
- [x] Metadata is printable in heartbeat and teardown logs

---

## Phase 2: Initialization and Lifecycle Tracing

### 2.1 Trace scheduler initialization start and end

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `scheduler.initialize.start` log at the top of `initialize(alias)`
- [x] Include:
  - [x] `alias`
  - [x] `previousAlias`
  - [x] `schedulerGeneration`
  - [x] `previousGeneration`
  - [x] `activeTaskCountBefore`
  - [x] `activeJobIdsBefore`
  - [x] `pid`
  - [x] `uptimeMs`
- [x] Add `scheduler.initialize.jobs-loaded` after `scheduleStore.listJobs(alias)`
- [x] Log full enabled job snapshots:
  - [x] `jobId`
  - [x] `name`
  - [x] `scheduleType`
  - [x] `cronExpression`
  - [x] `runAt`
  - [x] `enabled`
  - [x] `status`
  - [x] `lastRunAt`
- [x] Add `scheduler.initialize.end` after all jobs are registered
- [x] Add `scheduler.initialize.failed` in the catch block with partial state

**Acceptance Criteria**:

- [x] Logs show exactly which generation loaded which jobs
- [x] Logs show which jobs were intended to be active after init
- [x] A failed init still reports how far it progressed

### 2.2 Trace interrupted scheduled session recovery

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `scheduler.recover-interrupted.start`
- [x] Add `scheduler.recover-interrupted.chat-scan` per chat / batch
- [x] Add `scheduler.recover-interrupted.end`
- [x] Add `scheduler.recover-interrupted.failed`
- [x] Include recovered session ids and counts

**Acceptance Criteria**:

- [x] Logs show whether interrupted scheduled sessions were present
- [x] Logs show whether recovery modified scheduler-visible state

### 2.3 Trace scheduler disposal with explicit reasons

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Change `dispose()` signature to accept `reason: string`
- [x] Add `scheduler.dispose.start`
- [x] Include:
  - [x] `reason`
  - [x] `alias`
  - [x] `schedulerGeneration`
  - [x] `activeTaskCountBefore`
  - [x] `activeJobIdsBefore`
  - [x] `taskRuntimeMetaSnapshot`
- [x] Add `scheduler.dispose.end`

**Suggested Reason Values**:

- [x] `app-quit`
- [x] `updater-handoff`
- [x] `auth-destroy-current-session`
- [x] `alias-switch`
- [ ] `window-close`
- [x] `manual-debug`
- [x] `unknown`

**Acceptance Criteria**:

- [x] Every dispose path identifies its caller reason
- [x] Logs reveal whether the task set was cleared during unexpected teardown

---

## Phase 3: Task Registration and Unregistration Tracing

### 3.1 Trace registerJob orchestration

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `scheduler.task.register.start` in `registerJob(job)`
- [x] Include full job snapshot and current generation
- [x] Add `scheduler.task.register.dispatch` before branching into cron vs once

**Acceptance Criteria**:

- [x] Logs show the high-level registration path for every enabled job

### 3.2 Trace cron task registration deeply

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `scheduler.cron.register.before-replace-existing`
- [x] Log whether an existing active task already exists for the same job id
- [x] If it exists, include its previous runtime metadata
- [x] After `cron.schedule(...)`, create and store `SchedulerTaskRuntimeMeta`
- [x] Add `scheduler.cron.registered`
- [x] Include:
  - [x] `jobId`
  - [x] `name`
  - [x] `alias`
  - [x] `cronExpression`
  - [x] `schedulerGeneration`
  - [x] `taskSequence`
  - [x] `registeredAt`
  - [x] `activeTaskCountAfter`
  - [x] `activeTaskKeysAfter`

**Acceptance Criteria**:

- [x] Every cron task registration produces a durable trace record
- [x] Logs can prove whether a task was replaced by a later registration

### 3.3 Trace one-time task registration deeply

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `scheduler.once.register.before-replace-existing`
- [x] Store runtime metadata for timeout-backed tasks
- [x] Add `scheduler.once.registered`
- [x] Include:
  - [x] `jobId`
  - [x] `runAt`
  - [x] `delayMs`
  - [x] `schedulerGeneration`
  - [x] `taskSequence`

**Acceptance Criteria**:

- [x] One-time tasks are observable in the same way as cron tasks

### 3.4 Trace task unregistration with mandatory reason

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Change `unregisterTask(jobId)` to `unregisterTask(jobId, reason)`
- [x] Add `scheduler.task.unregister.start`
- [x] Include previous task runtime metadata
- [x] Add `scheduler.task.unregister.end`
- [x] Update metadata with `unregisteredAt` and `lastUnregisterReason`

**Suggested Reason Values**:

- [x] `re-register-before-cron-register`
- [x] `initialize-clear`
- [x] `dispose`
- [x] `toggle-disable`
- [x] `update-job`
- [x] `delete-job`
- [x] `once-job-completed`
- [x] `once-job-failed`
- [x] `once-job-expired`
- [x] `alias-switch`
- [x] `unknown`

**Acceptance Criteria**:

- [x] No task can disappear silently from `activeTasks`
- [x] Every stop action is attributable to a caller reason

### 3.5 Trace bulk active-task clearing

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Change `clearActiveTasks()` to accept `reason`
- [x] Add `scheduler.tasks.clear.start`
- [x] Add `scheduler.tasks.clear.end`
- [x] Include:
  - [x] `reason`
  - [x] `count`
  - [x] `jobIds`
  - [x] `schedulerGeneration`
  - [x] `taskRuntimeMetaSnapshot`

**Acceptance Criteria**:

- [x] Init-time and dispose-time mass task clearing is fully visible in logs

---

## Phase 4: Cron Callback Arrival Tracing

### 4.1 Trace cron callback entry before executeJob

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] In the `cron.schedule(...)` callback, add `scheduler.cron.tick-arrived` as the first line
- [x] Include:
  - [x] `jobId`
  - [x] `name`
  - [x] `alias`
  - [x] `schedulerGeneration`
  - [x] `taskSequence`
  - [x] `firedAt`
  - [x] `currentUserAlias`
  - [x] `activeTaskExists`
  - [x] `activeTaskCount`
  - [x] `pid`
- [x] Update runtime metadata `lastTickArrivedAt`
- [x] Add `scheduler.cron.tick-dispatch-executeJob` immediately before calling `executeJob()`

**Acceptance Criteria**:

- [x] Future logs can prove whether node-cron ever invoked the callback
- [x] Future logs can distinguish callback arrival from execute dispatch

---

## Phase 5: Execution Chain Tracing

### 5.1 Expand executeJob tracing into step-level events

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Keep the existing `executeJob` summary logs
- [x] Add:
  - [x] `scheduler.execute.start`
  - [x] `scheduler.execute.before-mark-started`
  - [x] `scheduler.execute.after-mark-started`
  - [x] `scheduler.execute.before-runScheduledJob`
  - [x] `scheduler.execute.after-runScheduledJob`
  - [x] `scheduler.execute.before-mark-completed`
  - [x] `scheduler.execute.after-mark-completed`
  - [x] `scheduler.execute.before-mark-failed`
  - [x] `scheduler.execute.after-mark-failed`
  - [x] `scheduler.execute.end`
- [x] Update runtime metadata fields:
  - [x] `lastExecuteStartAt`
  - [x] `lastExecuteEndAt`
  - [x] `lastExecuteOutcome`

**Acceptance Criteria**:

- [x] Execution can be reconstructed step-by-step
- [x] The log shows exactly whether failures happened in persistence, runtime creation, or downstream execution

### 5.2 Trace agent scheduled job runtime handoff

**Files**:

- `src/main/lib/chat/agentChatManager.ts`
- Any scheduled-run helper used by `runScheduledJob(job)`

- [x] Add `scheduler.runtime.runScheduledJob.start`
- [x] Add `scheduler.runtime.runScheduledJob.chatSession-created`
- [x] Add `scheduler.runtime.runScheduledJob.end`
- [x] Include:
  - [x] `jobId`
  - [x] `agentId`
  - [x] `chatId`
  - [x] `chatSessionId`
  - [x] `runtimeMode`
  - [x] `success`
  - [x] `error`

**Acceptance Criteria**:

- [x] Scheduler execution logs correlate cleanly with chat-runtime logs

---

## Phase 6: Persistence Tracing

### 6.1 Trace schedule store initialization and projections

**File**: `src/main/lib/scheduler/scheduleStore.ts`

- [x] Add `scheduler.store.initialize.start`
- [x] Add `scheduler.store.initialize.month-loaded` per month key
- [x] Add `scheduler.store.initialize.end`
- [x] Log month file counts, job counts, and loaded month keys

**Acceptance Criteria**:

- [x] Store initialization no longer behaves like a black box

### 6.2 Trace job execution state persistence

**File**: `src/main/lib/scheduler/scheduleStore.ts`

- [x] Add before/after logs for:
  - [x] `markJobExecutionStarted`
  - [x] `markJobExecutionCompleted`
  - [x] `markJobExecutionFailed`
  - [x] `markJobExpired`
- [x] Include field diffs whenever possible

**Acceptance Criteria**:

- [x] Logs show whether a scheduled run reached persistence checkpoints

---

## Phase 7: Auth and Session Lifecycle Tracing

### 7.1 Trace auth-driven scheduler initialization

**File**: `src/main/startup/ipc/auth.ts`

- [x] Add `scheduler.lifecycle.auth-setCurrentSession.before-init`
- [x] Add `scheduler.lifecycle.auth-setCurrentSession.after-init`
- [x] Include:
  - [x] `userLogin`
  - [x] `trigger`
  - [x] scheduler state summary before and after

**Acceptance Criteria**:

- [x] Logs show which auth restoration flow initialized scheduler

### 7.2 Trace auth-driven scheduler disposal

**File**: `src/main/startup/ipc/auth.ts`

- [x] Add `scheduler.lifecycle.auth-destroyCurrentSession.before-dispose`
- [x] Add `scheduler.lifecycle.auth-destroyCurrentSession.after-dispose`
- [x] Pass an explicit dispose reason

**Acceptance Criteria**:

- [x] Auth teardown paths cannot silently wipe scheduler state

---

## Phase 8: Main Process Lifecycle Tracing

### 8.1 Trace updater and quit handoff paths

**File**: `src/main/main.ts`

- [x] Add scheduler state summaries around:
  - [x] `before-quit`
  - [x] `will-quit`
  - [x] updater handoff path
  - [ ] relaunch path
  - [x] any explicit shutdown cleanup sequence
- [x] Use explicit lifecycle reasons when disposing scheduler

**Acceptance Criteria**:

- [x] A future log shows whether updater handoff or quit paths cleared active tasks

### 8.2 Trace power-monitor events with scheduler state

**File**: `src/main/main.ts`

- [x] Add scheduler state summaries for:
  - [x] `suspend`
  - [x] `resume`
  - [x] `lock-screen`
  - [x] `unlock-screen`

**Acceptance Criteria**:

- [x] Power events are correlated with scheduler state transitions

### 8.3 Trace recovered-unclean-exit context

**Files**:

- Main startup / crash recovery entry points

- [x] Add a startup log linking:
  - [x] `previousSessionId`
  - [x] `currentSessionId`
  - [x] `recoveredCrashDetected`
  - [x] `alias`
  - [x] `schedulerWillInit`

**Acceptance Criteria**:

- [x] Recovery scenarios can be tied directly to scheduler state initialization

---

## Phase 9: Periodic Heartbeat Snapshot

### 9.1 Add scheduler heartbeat timer

**File**: `src/main/lib/scheduler/SchedulerManager.ts`

- [x] Add `startHeartbeat()`
- [x] Add `stopHeartbeat()`
- [x] Start heartbeat after successful initialization
- [x] Stop heartbeat on dispose
- [x] Emit heartbeat every 60 seconds only when there are active tasks

**Heartbeat Payload**:

- [x] `alias`
- [x] `schedulerGeneration`
- [x] `activeTaskCount`
- [x] `activeTaskJobIds`
- [x] `taskRuntimeMeta[]`

**Acceptance Criteria**:

- [x] Logs can prove whether a task remained active up to the expected fire minute

---

## Phase 10: Log Naming and Searchability

### 10.1 Standardize event names

**All scheduler-related files**

- [x] Use structured event names with `scheduler.` prefix
- [x] Standardize on these names at minimum:
  - [x] `scheduler.initialize.start`
  - [x] `scheduler.initialize.jobs-loaded`
  - [x] `scheduler.initialize.end`
  - [x] `scheduler.initialize.failed`
  - [x] `scheduler.task.register.start`
  - [x] `scheduler.cron.registered`
  - [x] `scheduler.once.registered`
  - [x] `scheduler.task.unregister.start`
  - [x] `scheduler.task.unregister.end`
  - [x] `scheduler.tasks.clear.start`
  - [x] `scheduler.tasks.clear.end`
  - [x] `scheduler.cron.tick-arrived`
  - [x] `scheduler.cron.tick-dispatch-executeJob`
  - [x] `scheduler.execute.start`
  - [x] `scheduler.execute.end`
  - [x] `scheduler.dispose.start`
  - [x] `scheduler.dispose.end`
  - [x] `scheduler.heartbeat`
  - [x] `scheduler.lifecycle.auth-setCurrentSession.before-init`
  - [x] `scheduler.lifecycle.auth-destroyCurrentSession.before-dispose`
  - [x] `scheduler.lifecycle.updater-handoff`

**Acceptance Criteria**:

- [x] Full scheduler timeline can be reconstructed with a single grep prefix

---

## Validation Checklist

### Reproduction Validation

- [ ] Reproduce with a minutely cron job and confirm callback arrival logs appear
- [ ] Reproduce with auth restore flow and confirm initialization generation changes are visible
- [ ] Reproduce with updater relaunch flow and confirm dispose reason is visible
- [ ] Reproduce with deliberate app shutdown and confirm active task teardown is logged

### Production-Incident Validation

For a future missed-run incident, the logs must answer all of the following:

- [ ] Which init generation registered the missed job?
- [ ] Was the job still present in `activeTasks` shortly before the missed fire time?
- [ ] Did the cron callback arrive?
- [ ] If not, was the task unregistered or disposed first?
- [ ] If callback arrived, did `executeJob()` start?
- [ ] If `executeJob()` started, where did it fail?
- [ ] Did auth restore, updater handoff, crash recovery, or power events happen in the same window?

### Final Acceptance Standard

- [ ] No future missed run should remain classified only as "registered but did not fire"
- [ ] The new logs must reduce future triage to one of:
  - [ ] task unregistered
  - [ ] callback never arrived
  - [ ] callback arrived but dispatch blocked
  - [ ] execution started but runtime/persistence failed

---

## Suggested Rollout Order

- [x] Step 1: `SchedulerManager` generation + task runtime metadata
- [x] Step 2: cron callback arrival logs
- [x] Step 3: unregister / clear / dispose reason propagation
- [x] Step 4: auth and main-process lifecycle tracing
- [x] Step 5: persistence tracing
- [x] Step 6: heartbeat snapshots

## Related Investigation Context

- User incident profile: `user-a`
- Incident shape: jobs loaded, enabled, and registered; app remained alive around expected fire time; no `executeJob()` entry logs for missed occurrences
- Control case: `demo-user` minute-level cron schedule on app version `2.7.3` fired normally
- Current hypothesis: state-dependent scheduler runtime failure triggered by a specific recovery / updater / session lifecycle sequence rather than a general cron engine failure