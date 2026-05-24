# How Schedules Management Works

## Document Purpose

This document summarizes how the new Schedule Management should work, how module responsibilities are divided, how data flows, and the boundaries that must be respected during subsequent development — based on the current scheduler implementation and refactoring goals.

This document explicitly adopts the architectural convergence approach consistent with [`docs/truth-of-dev/how-chat-session-management-works.md`](docs/truth-of-dev/how-chat-session-management-works.md):

- There is only one scheduler source of truth in the main process
- The persistence layer only acts as a repository / persistence layer
- The frontend list consumes projections, not raw file details
- No backward compatibility required

Target audience:

- Developers who need to refactor the scheduler module
- Developers who need to understand the schedule settings persistence plan
- Developers who need to handle the boundary between schedule and chat session

---

## 1. Core Conclusions

The core conclusions of the target architecture are as follows:

1. **The single schedule source of truth in the main process should be `ScheduleStore`**
2. **The persistence layer should be extracted from `ProfileCacheManager` and consolidated into `ScheduleSettingsManager`**
3. **Schedule settings will no longer be persisted in `profile.json`; instead, they will be stored in `{UserData}/profiles/{alias}/schedules/YYYYMM.json`**
4. **`SchedulerManager` will no longer own the schedule settings truth; it is only responsible for runtime registration / execution**
5. **The frontend schedule list consumes store projections, not `profile.schedulerJobs`**
6. **Schedule job IDs are unified to `sched_YYYYMMDDHHMMSS_{random}` format; only newly created jobs use the new format, no historical migration**
7. **No backward compatibility; the old `profile.schedulerJobs` path can be removed directly**

In other words, the entire scheduler system must transition from "profile.json owns jobs + runtime manager directly reads/writes profile" to "store owns canonical state, store drives persistence and synchronization."

---

## 2. Why This Change Is Needed

In the current implementation, the source of truth for scheduler settings is scattered across multiple locations and responsibilities:

- [`src/main/lib/userDataADO/profileCacheManager.ts`](src/main/lib/userDataADO/profileCacheManager.ts) owns `profile.schedulerJobs`
- [`src/main/lib/scheduler/SchedulerManager.ts`](src/main/lib/scheduler/SchedulerManager.ts) handles initialization, CRUD, cron/timeout registration, and job execution
- [`src/main/lib/scheduler/SchedulerIPC.ts`](src/main/lib/scheduler/SchedulerIPC.ts) routes IPC directly to the scheduler manager
- [`src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts`](src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts) generates its own job IDs

The main issue with this structure is not any particular field, but **unclear state ownership**:

1. `profile.json` continues to grow in size and responsibility
2. Scheduler settings are tightly coupled to the profile cache lifecycle
3. The runtime executor and persistence are mixed in the same manager
4. The frontend can only rely on profile notifications for updates, lacking schedule-level incremental projections
5. Job ID generation rules are scattered with no unified constraints
6. Once monthly queries, archiving, and pagination are introduced, `profile.schedulerJobs` will become a structural bottleneck

Therefore, the key to this refactoring is not "moving an array to a different location," but bringing the scheduler's **single source of truth** back into an independent store layer.

---

## 3. Current Implementation Overview

Before entering the target design, let's clarify the actual state of the current codebase.

### 3.1 Current `ProfileCacheManager`

File: [`src/main/lib/userDataADO/profileCacheManager.ts`](src/main/lib/userDataADO/profileCacheManager.ts)

Currently it carries the persistence responsibility for scheduler settings:

- `sanitizeProfileV2()` sanitizes `schedulerJobs`
- `ensureV2ProfileIntegrity()` fills in missing `schedulerJobs`
- `getSchedulerJobs()` handles reads
- `addSchedulerJob()` / `updateSchedulerJob()` / `deleteSchedulerJob()` handle writes

This means scheduler settings are currently still part of the profile schema.

### 3.2 Current `SchedulerManager`

File: [`src/main/lib/scheduler/SchedulerManager.ts`](src/main/lib/scheduler/SchedulerManager.ts)

It currently handles both business logic and runtime:

- Reads all jobs from profile during initialization
- Creates / updates / deletes jobs
- Validates cron / runAt
- Registers cron tasks / timeout tasks
- Executes `runScheduledJob(...)` when triggered
- Updates one-time job status

In other words, the current `SchedulerManager` simultaneously acts as:

- Command service
- Runtime orchestrator
- Persistence coordinator

This is very similar to the state before the chat session refactoring.

### 3.3 Current IPC

File: [`src/main/lib/scheduler/SchedulerIPC.ts`](src/main/lib/scheduler/SchedulerIPC.ts)

Currently, renderer schedule CRUD passes through directly to `SchedulerManager`:

- `listJobs`
- `createJob`
- `deleteJob`
- `toggleJob`
- `updateJob`
- `getJobSessions`

Therefore, the renderer sees what the manager exposes, not a store projection.

### 3.4 Current Job ID Generation

File: [`src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts`](src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts)

The current rule has been adjusted to:

- `sched_${YYYYMMDDHHMMSS}_${deviceId}_${random}`

The issues are:

- The time component is not human-readable
- It needs to share a unified device ID segment convention with chat/chatSession
- UI creation entry points and tool creation entry points may easily diverge

### 3.5 Current Boundary with Chat Session

The chat session side has already started converging:

- [`src/main/lib/chat/chatSessionStore.ts`](src/main/lib/chat/chatSessionStore.ts) contains `patchSchedulerMetadata(...)`
- `schedulerJobId`, execution state, start/completion times, and error information are already handled in a metadata-only direction
- [`src/main/lib/chat/agentChatManager.ts`](src/main/lib/chat/agentChatManager.ts)'s `runScheduledJob(...)` creates scheduled sessions and writes scheduler metadata

This direction is correct; no rollback to a file-based approach is needed.

---

## 4. Target Architecture Overview

The target architecture needs to be isomorphic with the chat session management mechanism.

### 4.1 Core Principles

1. **Store is the single source of truth**
2. **Repository only handles reading/writing to disk**
3. **Runtime manager only handles registration and execution**
4. **IPC only calls store commands**
5. **Renderer only consumes projections / incremental events**

### 4.2 New Module Responsibilities

#### `ScheduleStore`

Recommended new file:

- `src/main/lib/scheduler/scheduleStore.ts`

Responsibilities:

- Holds in-memory canonical schedule state
- Executes mutations serially per job
- Generates persistence snapshots
- Drives flushing to `ScheduleSettingsManager`
- Synchronizes register/unregister to the runtime executor
- Sends incremental events to the renderer
- Provides a unified command API

#### `ScheduleSettingsManager`

Recommended new file:

- `src/main/lib/userDataADO/scheduleSettingsManager.ts`

Responsibilities:

- Reads/writes schedule month files
- Atomic file writes
- Reads jobs by month
- Locates month files by jobId
- Deletes jobs / updates jobs / scans months

It is **not responsible for**:

- Business decisions
- Execution registration
- Frontend synchronization semantics
- Job state transition semantics

#### `SchedulerManager`

Retain file: [`src/main/lib/scheduler/SchedulerManager.ts`](src/main/lib/scheduler/SchedulerManager.ts)

But role is adjusted to runtime executor:

- Registers cron / timeout
- Manages active task handles
- Responds to registration changes from the store
- Executes agents when jobs trigger
- Writes execution results back to the store

It **no longer directly reads/writes persistence files**.

#### `ProfileCacheManager`

File: [`src/main/lib/userDataADO/profileCacheManager.ts`](src/main/lib/userDataADO/profileCacheManager.ts)

Must remove its role as scheduler settings owner:

- No longer maintains `profile.schedulerJobs`
- No longer responsible for scheduler jobs sanitize / ensure / CRUD
- No longer acts as the source of truth for the schedule list

---

## 5. Data Model Design

### 5.1 New Persistence Directory

Path:

- `{UserData}/profiles/{alias}/schedules/`

Files are stored by month in the directory:

- `YYYYMM.json`

For example:

- `profiles/yanhu/schedules/202603.json`

### 5.2 Month File Structure

Month file structure:

```json
{
  "schedulerJobs": [
    {
      "id": "sched_20260311234700_etu1gkrni",
      "description": "1",
      "name": "1",
      "scheduleType": "once",
      "runAt": "2026-03-11T16:47:00.000Z",
      "enabled": true,
      "agentId": "chat_1773157314718_eiu0ejcgj",
      "message": "1",
      "status": "pending"
    },
    {
      "id": "sched_20260311234701_jnhslghoe",
      "description": "2",
      "name": "2",
      "scheduleType": "cron",
      "cronExpression": "0 9 * * 1",
      "enabled": true,
      "agentId": "chat_1773157314718_eiu0ejcgj",
      "message": "2",
      "status": "pending"
    }
  ]
}
```

### 5.3 Type Recommendations

Recommended new types:

- `ScheduleMonthFile`
- `PersistedSchedulerJob`
- `ScheduleJobAggregate`
- `ScheduleJobPatch`
- `ScheduleProjection`

Recommended to retain the current `SchedulerJob` semantics, but migrate its ownership from the profile schema to the scheduler module's own type definitions.

### 5.4 `ProfileV2` Changes

File: [`src/main/lib/userDataADO/types/profile.ts`](src/main/lib/userDataADO/types/profile.ts)

Needs to directly remove:

- `schedulerJobs?: SchedulerJob[]`

Because the new goal is:

- `profile.json` no longer carries schedule settings
- Profile schema and scheduler schema are completely decoupled

This is an explicit breaking change, but the requirement explicitly states **no backward compatibility is needed**.

---

## 6. ID Rules

### 6.1 New Rules

Schedule job IDs are unified to:

- `sched_YYYYMMDDHHMMSS_{random}`

For example:

- `sched_20260311234700_etu1gkrni`

### 6.2 Rule Requirements

1. `sched_` fixed prefix
2. Time component must be 14 digits: `YYYYMMDDHHMMSS`
3. Random component should be 8 to 10 characters of base36
4. All job creation entry points must use the same factory function

### 6.3 Implementation Recommendation

Recommended new file:

- `src/main/lib/scheduler/id.ts`

Exports:

- `generateScheduleJobId(date = new Date()): string`

Then replace:

- [`src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts`](src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts)
- Renderer manual creation entry points
- Any future test data construction entry points

It is prohibited to scatter `Date.now()` concatenation logic in business code.

---

## 7. `ScheduleStore` Design

### 7.1 Target Role

`ScheduleStore` is the sole state owner of the scheduler in the main process.

It is responsible for determining:

- What the canonical state of a job is
- Which fields need to be persisted
- Which jobs need to be registered with the runtime
- Which events need to be sent to the renderer

### 7.2 Recommended In-Memory Structure

Recommended to hold:

- `jobsById: Map<string, ScheduleJobAggregate>`
- `jobsByAliasMonth: Map<string, Set<string>>`
- `jobMutationQueues: Map<string, Promise<void>>`
- `monthLoadStates: Map<string, boolean>`

Where `ScheduleJobAggregate` is recommended to include:

- `settings`: persistence fields
- `runtime`: runtime fields
- `persist`: flush state fields

For example:

- `settings`: job snapshot + `alias` + `monthKey`
- `runtime`: `activeRegistrationKind`, `loadedAt`, `lastAccessedAt`
- `persist`: `dirty`, `revision`, `persistedRevision`, `isFlushing`

### 7.3 Recommended Command API

Expose the following unified commands:

- `initialize(alias)`
- `listJobs(alias, agentId?)`
- `getJob(alias, jobId)`
- `createJob(alias, input)`
- `updateJob(alias, jobId, patch)`
- `toggleJob(alias, jobId, enabled)`
- `deleteJob(alias, jobId)`
- `markJobExecutionStarted(alias, jobId, startedAt)`
- `markJobExecutionCompleted(alias, jobId, executedAt)`
- `markJobExecutionFailed(alias, jobId, executedAt, error)`
- `getJobsProjection(alias, options?)`

In principle, no schedule settings write operation should bypass the store.

---

## 8. `ScheduleSettingsManager` Design

### 8.1 Target Role

The role of `ScheduleSettingsManager` should be consistent with the repository layer in the chat session scenario.

It is only responsible for:

- Reading month files
- Writing month files
- Deleting specified jobs from month files
- Scanning the schedules directory
- Locating files by jobId

### 8.2 Recommended Interface

Recommended interface:

- `ensureSchedulesDir(alias)`
- `listScheduleMonths(alias): Promise<string[]>`
- `readScheduleMonth(alias, monthKey): Promise<ScheduleMonthFile>`
- `writeScheduleMonth(alias, monthKey, file): Promise<void>`
- `upsertScheduleJob(alias, monthKey, job): Promise<void>`
- `deleteScheduleJob(alias, monthKey, jobId): Promise<boolean>`
- `findJobLocation(alias, jobId): Promise<{ monthKey: string; job: SchedulerJob } | null>`

### 8.3 Atomic Write Requirements

Must follow the existing userData ADO atomic write approach:

- Write to a temporary file first
- Then rename to overwrite
- Avoid month file corruption

### 8.4 Repository Boundary

The repository must not be responsible for:

- Business logic validation
- Determining whether a task should be enabled
- Triggering runtime registration
- Deciding cross-month migration logic

These should all be decided by the store.

---

## 9. Monthly Archiving Rules

This is one of the rules that must be settled in advance in this design.

### 9.1 Month Key

Uniformly use:

- `YYYYMM`

### 9.2 Once Job Assignment

`once` jobs should be assigned to:

- The month of `runAt`

For example:

- `runAt = 2026-03-11T16:47:00.000Z`
- Persisted to `202603.json`

### 9.3 Cron Job Assignment

`cron` jobs are recommended to be assigned to:

- **The month of creation**

Reason:

- Cron itself has no unique future execution month
- If archived by "next execution month," the file assignment would continuously drift
- Archiving by creation month is most stable

### 9.4 Cross-Month Migration Rules

Cross-month migration is only needed in the following case:

- A `once` job's `runAt` is modified and falls in a different month

In this case, `ScheduleStore` should:

1. Mark the deletion in the old month's aggregate
2. Create the job in the new month's aggregate
3. Sequentially flush both month files
4. Update the in-memory month index

`cron` jobs generally do not need migration.

---

## 10. Standard Read Path

### 10.1 Initialization

Standard entry: `scheduleStore.initialize(alias)`

Recommended process:

1. Ensure the `schedules/` directory exists
2. Scan existing `YYYYMM.json` files
3. Build the month index
4. Not necessary to load all jobs into memory at once
5. Only build a lightweight addressable structure; lazy-load month files on demand

### 10.2 Reading a Single Job

Standard entry: `scheduleStore.getJob(alias, jobId)`

Process:

1. First check `jobsById`
2. If found, return the aggregate directly
3. If not found, use the repository to locate the job's month
4. Read that month's file
5. Hydrate into an aggregate
6. Write to in-memory cache
7. Return the aggregate

### 10.3 Reading Job List Projection

Standard entry: `scheduleStore.getJobsProjection(alias, agentId?)`

Process:

1. Read persisted jobs from the required month files via the repository
2. Merge with already-loaded aggregates in the store as an overlay
3. If `agentId` is provided, filter accordingly
4. Output a sorted projection

Sorting recommendation:

- First by enabled status
- Then by `runAt` / `createdAt` / ID time component
- UI can refine as needed, but the store must at least guarantee a stable order

---

## 11. Standard Write Path

### 11.1 Create Job

Unified entry: `scheduleStore.createJob(alias, input)`

Process:

1. Normalize input
2. Generate a unified job ID
3. Validate `cronExpression` or `runAt`
4. Calculate `monthKey`
5. Create aggregate
6. Flush to the corresponding month file
7. Notify runtime to register
8. Send `jobCreated` event

### 11.2 Update Job

Unified entry: `scheduleStore.updateJob(alias, jobId, patch)`

Characteristics:

- Merge patch internally in the store
- If `once.runAt` crosses a month boundary, execute a move
- After flushing, recalculate runtime registration
- Send `jobPatched` event

### 11.3 Toggle Job

Unified entry: `scheduleStore.toggleJob(alias, jobId, enabled)`

Characteristics:

- Only updates `settings.enabled`
- After flushing, notify runtime to register or unregister
- Renderer is not allowed to directly control runtime handles

### 11.4 Delete Job

Unified entry: `scheduleStore.deleteJob(alias, jobId)`

Characteristics:

- Cancel the runtime task first
- Then delete from the month file
- Clear the in-memory cache
- Send `jobDeleted` event

### 11.5 Execution State Writeback

Unified entries:

- `markJobExecutionStarted(...)`
- `markJobExecutionCompleted(...)`
- `markJobExecutionFailed(...)`

These writebacks should also go through the store, not be written directly to the repository by the runtime manager.

---

## 12. Concurrency Control

### 12.1 Job-Level Mutation Queue

Like chat session, `ScheduleStore` should also establish serial mutation queues per job.

Effect:

- Modifications to the same job are strictly serialized
- Modifications to different jobs are allowed to run in parallel

This avoids:

- UI updating the name
- Runtime simultaneously writing back state
- Results overwriting each other

### 12.2 Revision / PersistedRevision

Each aggregate is recommended to maintain:

- `revision`
- `persistedRevision`
- `dirty`
- `isFlushing`

Process:

1. Mutations first update in-memory
2. `revision += 1`
3. Record `targetRevision` when flushing
4. After flush completes, only advance `persistedRevision` if the current revision still equals `targetRevision`

This prevents new mutations during flush from being incorrectly marked as "already persisted."

### 12.3 Month-Level Write Conflicts

Since multiple jobs may belong to the same month file, an additional month-level write serialization layer is needed.

Recommendation:

- `monthWriteQueues: Map<string, Promise<void>>`
- Key in the form `${alias}:${monthKey}`

Reason:

- Job-level serialization only guarantees single-job safety
- Multiple jobs in the same `YYYYMM.json` flushing concurrently can still cause file overwrites

Therefore, the scheduler scenario needs:

- **Job-level mutation queue**
- **Month-level flush queue**

Two layers of concurrency protection.

---

## 13. New Role of `SchedulerManager`

### 13.1 Role Definition

After refactoring, `SchedulerManager` retains only the runtime executor identity.

It is responsible for:

- Registering cron / timeout based on store projections
- Maintaining `activeTasks`
- Calling [`src/main/lib/chat/agentChatManager.ts`](src/main/lib/chat/agentChatManager.ts) to execute jobs when triggered
- Writing execution results back through the store

### 13.2 What It Is No Longer Responsible For

It is no longer responsible for:

- Schedule settings persistence
- Directly CRUDing jobs
- Initializing jobs from profile
- Directly maintaining job truth

### 13.3 Recommended Interaction Pattern

Recommended that `ScheduleStore` actively drives the runtime:

- `scheduleRuntime.applyJob(jobProjection)`
- `scheduleRuntime.removeJob(jobId)`
- `scheduleRuntime.resetForAlias(alias, projections)`

Rather than having the runtime manager read from the repository itself.

---

## 14. IPC and Frontend-Backend Synchronization

### 14.1 IPC Refactoring Principles

File: [`src/shared/ipc/scheduler.ts`](src/shared/ipc/scheduler.ts)

The interface shape can temporarily remain largely the same, but the main process implementation must be changed to call the store:

- `listJobs` -> `scheduleStore.getJobsProjection(...)`
- `createJob` -> `scheduleStore.createJob(...)`
- `updateJob` -> `scheduleStore.updateJob(...)`
- `toggleJob` -> `scheduleStore.toggleJob(...)`
- `deleteJob` -> `scheduleStore.deleteJob(...)`

### 14.2 `getJobSessions`

File: [`src/main/lib/scheduler/SchedulerIPC.ts`](src/main/lib/scheduler/SchedulerIPC.ts)

This interface can be retained, because it expresses:

- Querying chat sessions associated with a job

But the job source should come from the store, not from the profile.

### 14.3 Recommended Incremental Events

Recommended new events:

- `scheduleStore:jobCreated`
- `scheduleStore:jobPatched`
- `scheduleStore:jobDeleted`

This way the following frontend components no longer need to do a full reload on every change:

- [`src/renderer/components/chat/agent-editor/AgentSchedulesTab.tsx`](src/renderer/components/chat/agent-editor/AgentSchedulesTab.tsx)
- [`src/renderer/components/settings/SchedulesContentView.tsx`](src/renderer/components/settings/SchedulesContentView.tsx)

### 14.4 Renderer Consumption Principles

The renderer should only consume:

- Initial list projections
- Store incremental events

No longer assuming `profile:cacheUpdated` carries schedule settings truth.

---

## 15. Boundary with Chat Session

This is a boundary that must be clearly defined in the design.

### 15.1 Schedule Job Settings Belong to the Scheduler System

These fields belong to schedule settings:

- `id`
- `description`
- `name`
- `scheduleType`
- `cronExpression`
- `runAt`
- `enabled`
- `agentId`
- `message`
- `status`
- `lastRunAt`
- `executedAt`

These fields should only be persisted in:

- `profiles/{alias}/schedules/YYYYMM.json`

### 15.2 Chat Session Metadata Belongs to the Chat Session System

These fields still belong to chat session metadata:

- `schedulerJobId`
- `schedulerExecutionStatus`
- `schedulerStartedAt`
- `schedulerCompletedAt`
- `schedulerError`

These fields should continue to be managed by [`src/main/lib/chat/chatSessionStore.ts`](src/main/lib/chat/chatSessionStore.ts) and only persisted in the chat session month index.

### 15.3 Relationship Between the Two

The relationship between the two sets of data should be:

- A schedule job represents "a planned configuration"
- Chat session metadata represents "a session result generated by a scheduled execution"

Therefore:

- A job's existence does not depend on a session
- A session's display can reference `schedulerJobId`
- The two reference each other, but **cannot be each other's source of truth**

---

## 16. Specific Code Refactoring Points

### 16.1 Existing Logic to Delete / Shrink

#### [`src/main/lib/userDataADO/types/profile.ts`](src/main/lib/userDataADO/types/profile.ts)

Needs to:

- Remove `SchedulerJob`'s ownership from the profile schema
- Remove `ProfileV2.schedulerJobs`

#### [`src/main/lib/userDataADO/profileCacheManager.ts`](src/main/lib/userDataADO/profileCacheManager.ts)

Needs to delete:

- Sanitization of `schedulerJobs` in `sanitizeProfileV2()`
- Back-filling of `schedulerJobs` in `ensureV2ProfileIntegrity()`
- `getSchedulerJobs()`
- `addSchedulerJob()`
- `updateSchedulerJob()`
- `deleteSchedulerJob()`

#### [`src/main/lib/scheduler/SchedulerManager.ts`](src/main/lib/scheduler/SchedulerManager.ts)

Needs to strip out:

- Logic that directly calls `profileCacheManager`
- The source of truth responsibility for CRUD jobs
- Logic that initializes by reading jobs from profile

Retain:

- Active task management
- Cron / timeout registration
- Job execution

#### [`src/main/lib/scheduler/SchedulerIPC.ts`](src/main/lib/scheduler/SchedulerIPC.ts)

Needs to be changed to:

- Only act as an IPC forwarding layer
- All real commands forwarded to `ScheduleStore`

#### [`src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts`](src/main/lib/mcpRuntime/builtinTools/createScheduleTool.ts)

Needs to be changed to:

- No longer locally concatenate job IDs
- Call the unified ID factory
- Ultimately call store commands

### 16.2 Recommended New Files

Recommended new files:

- `src/main/lib/scheduler/scheduleStore.ts`
- `src/main/lib/scheduler/types.ts`
- `src/main/lib/scheduler/id.ts`
- `src/main/lib/userDataADO/scheduleSettingsManager.ts`
- `src/main/lib/userDataADO/scheduleFileOps.ts`

If alignment with existing userData ADO tools is needed, types can continue to be placed in userDataADO types, but **must not be hung back on the profile schema**.

---

## 17. Implementation Order

Recommended implementation order to avoid large-scale simultaneous changes:

### Phase 1: Establish New Persistence Layer

1. Add the `schedules/` directory convention
2. Add month file read/write utilities
3. Add `ScheduleSettingsManager`
4. Establish tests for `YYYYMM.json` persistence

### Phase 2: Establish New Store Truth Layer

1. Add `ScheduleStore`
2. Implement create / update / toggle / delete / list
3. Introduce job queue + month queue
4. Connect store -> repository flush

### Phase 3: Shrink Runtime Manager

1. Change [`src/main/lib/scheduler/SchedulerManager.ts`](src/main/lib/scheduler/SchedulerManager.ts) to runtime-only
2. Have the store drive register / unregister
3. Change execution state writeback to go through the store

### Phase 4: Replace IPC and Frontend Read Paths

1. Modify [`src/main/lib/scheduler/SchedulerIPC.ts`](src/main/lib/scheduler/SchedulerIPC.ts)
2. Modify [`src/shared/ipc/scheduler.ts`](src/shared/ipc/scheduler.ts)
3. Change frontend list to consume store projections
4. Integrate schedule incremental events

### Phase 5: Remove Old Profile Path

1. Remove `schedulerJobs` from [`src/main/lib/userDataADO/types/profile.ts`](src/main/lib/userDataADO/types/profile.ts)
2. Delete scheduler CRUD from [`src/main/lib/userDataADO/profileCacheManager.ts`](src/main/lib/userDataADO/profileCacheManager.ts)
3. Clean up all `profile.schedulerJobs` references

### Phase 6: Unify ID Generation

1. Add unified `generateScheduleJobId()`
2. Replace all entry points
3. Update test snapshots and documentation

---

## 18. Rules That Must Be Followed During Development

### 18.1 Do Not Do This

- Directly read `profile.schedulerJobs`
- Locally modify a job in the caller and then write the whole package back to profile
- Casually modify persistence files inside the runtime manager
- Assume in the renderer that the profile cache is the scheduler source of truth
- Generate job IDs at different entry points separately

### 18.2 Do This Instead

Prefer going through `ScheduleStore` commands:

- `createJob(...)`
- `updateJob(...)`
- `toggleJob(...)`
- `deleteJob(...)`
- `getJobsProjection(...)`
- `markJobExecutionStarted(...)`
- `markJobExecutionCompleted(...)`
- `markJobExecutionFailed(...)`

### 18.3 Keep Boundaries in Mind

- Schedule settings only in `schedules/YYYYMM.json`
- Chat session scheduler metadata only in the chat session month index
- `SchedulerManager` is responsible only for the runtime
- `ScheduleSettingsManager` is responsible only for persistence
- `ScheduleStore` is the scheduler source of truth

---

## 19. One-Sentence Summary

The new schedule management mechanism can be summarized as:

> **`ScheduleStore` holds the sole canonical scheduler state in the main process; business modifications update the store first, then the store serially flushes to `ScheduleSettingsManager`; schedule settings are persisted monthly to `profiles/{alias}/schedules/YYYYMM.json`; `SchedulerManager` is responsible only for runtime registration and execution; `profile.json` no longer carries `schedulerJobs`; `schedulerJobId` and execution result metadata remain exclusively in chat session metadata.**
