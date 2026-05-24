# How Chat Session Management Works

## Document Purpose

This document summarizes how the current Chat Session management mechanism works, how module responsibilities are divided, how data flows, which parts have converged, and which are still evolving — based on the design document `docs/chat-session-single-source-of-truth-architecture.md` and the current code implementation.

Target audience:

- Developers who need to understand the main chat session flow
- Developers who need to troubleshoot read/unread, title, session list sync, and session persistence issues
- Developers who will continue advancing the single source of truth refactoring

---

## 1. Core Conclusions

The current implementation has completed the most important architectural convergence:

1. **The single session source of truth in the main process is `ChatSessionStore`**
2. **The persistence layer `ChatSessionManager` has converged to a repository / persistence layer**
3. **The frontend session list consumes a metadata projection, no longer relying on full session files as the list source of truth**
4. **`readStatus` only exists in metadata / month index, no longer part of `ChatSessionFile`**
5. **`schedulerJobId` and scheduler execution metadata both belong to metadata / month index, not `ChatSessionFile`**
6. **Main-process business writes are now basically unified through `ChatSessionStore`, avoiding old snapshots at multiple points overwriting new state with full-package writes**

In other words, the current system has already transitioned from "multiple modules each holding and writing back session copies" to "store holds canonical state, store drives persistence and synchronization."

---

## 2. Why This Change Was Needed

The problem with the old architecture was not any particular field, but **unclear state ownership**.

Previously, multiple modules could:

- Each hold their own session snapshot
- Modify a few fields based on a local stale snapshot
- Then write the entire package back to the month index or session file

This caused classic problems:

- Stale snapshots overwriting new state
- List metadata inconsistent with full files
- Full frontend refreshes overwriting incremental events
- `readStatus`, `title`, and scheduler state conflicting across different flows

The key to this refactoring was bringing the "source of truth" back into `ChatSessionStore`.

---

## 3. Current Module Responsibilities

## 3.1 `ChatSessionStore`

File: `src/main/lib/chat/chatSessionStore.ts`

This is the **sole state owner of chat sessions in the main process**.

It is responsible for:

- Holding the in-memory canonical state of sessions
- Executing mutations serially per session
- Generating metadata/file snapshots from canonical state
- Driving flushing to `ChatSessionManager`
- Sending incremental events to the renderer
- Providing a unified command API

The core in-memory structures it holds are:

- `sessionsById: Map<string, ChatSessionAggregate>`
- `chatToSessionIds: Map<string, Set<string>>`
- `sessionMutationQueues: Map<string, Promise<void>>`

Where `ChatSessionAggregate` simultaneously contains:

- `metadata`
- `file`
- `runtime`

`runtime` maintains:

- `dirtyMetadata`
- `dirtyFile`
- `revision`
- `persistedRevision`
- `lastAccessedAt`
- `isFlushing`

This is the actual carrier of the single source of truth in the code.

---

## 3.2 `ChatSessionManager`

File: `src/main/lib/userDataADO/chatSessionManager.ts`

The current role has converged to a **repository / persistence layer**.

It is responsible for:

- Reading/writing chat index / month index
- Reading/writing full session files
- Atomic file writes
- Paginated reading of session metadata lists
- Deleting session files and month index entries

It is **no longer responsible for**:

- Business decisions around read/unread
- Business semantics for session copy/fork
- Business semantics for mark all read
- The old main/renderer mutation coordination role
- Frontend branch logic for existence-check + add/update

It can be understood as:

- `ChatSessionStore` decides "what the state should be"
- `ChatSessionManager` is only responsible for "writing that state to disk / reading it back from disk"

---

## 3.3 `AgentChat`

File: `src/main/lib/chat/agentChat.ts`

`AgentChat` is still the chat runtime object, responsible for:

- Message streaming
- Retry / tool call / context management
- Business logic for the currently running session

Its session persistence has now been changed to go through `ChatSessionStore`.

The current implementation of `saveChatSession()` does not write files directly; instead it:

1. Generates a snapshot from the instance's `currentChatSession`
2. Generates a metadata view
3. Calls `chatSessionStore.saveSession(...)`

Therefore, although `AgentChat` still holds runtime session data, **the actual persistence entry point is unified in the store**.

This is much safer than the old architecture, because:

- All actual persistence must go through the store
- The store internally merges into a canonical aggregate before flushing
- The flush path only goes through the repository

But to be clear:

- `AgentChat` still holds the runtime session data object
- So from a pure architecture standpoint, it has not fully degenerated to the ideal final form of "only holding a sessionId, reading from the store in real time"

That is, **the direction is correct, convergence is mostly complete, but it is not the complete final state**.

---

## 3.4 `AgentChatManager`

File: `src/main/lib/chat/agentChatManager.ts`

`AgentChatManager` is responsible for instance lifecycle, and no longer responsible for session persistence truth.

It currently handles:

- `AgentChat` instance caching
- Current active session management
- New session creation / switching / binding
- Foreground/background switching and blur handling
- The timing of unread state transitions between active and idle states
- Coordination of cross-session operations like fork / initialize

Key points that have been switched to the store include:

- `initialize()` is responsible only for runtime initialization, no longer batch-modifying readStatus at startup
- `switchToChatSession(...)` calls `chatSessionStore.ensureLoaded(...)`
- Fork logic uses `chatSessionStore.copySession(...)`
- readStatus updates use `chatSessionStore.setReadStatus(...)`

So it now more resembles:

- A lifecycle manager
- A foreground/background and instance binding coordinator

Rather than a persistence and state truth owner.

---

## 3.5 `ProfileCacheManager`

File: `src/main/lib/userDataADO/profileCacheManager.ts`

`ProfileCacheManager` is still the profile cache owner, but **is no longer the chat session state owner**.

Its current relationship with chat sessions is mainly:

- Notifying the frontend that the profile has changed
- Dynamically assembling `chatSessions` metadata lists for each chat before sending the profile to the frontend
- These metadata lists come from `chatSessionStore.getChatSessionsProjection(...)`
- IPC wrappers for save / delete also ultimately forward to the store

This is very important:

The `profile.chats[].chatSessions` that the frontend currently receives is no longer the truth carried by `profile.json` itself, but rather **a metadata view dynamically projected by the store before the notification is sent**.

This step has also removed the "frontend list source of truth" from historical profile cache copies.

---

## 3.6 Renderer `ProfileDataManager`

File: `src/renderer/lib/userData/profileDataManager.ts`

The frontend mainly consumes two sources:

1. `profile:cacheUpdated`
2. `chatSessionStore:*` incremental events

Where:

- Cold start, full validation, batch refresh: depends on `profile:cacheUpdated`
- Single session create / metadata update / delete: depends on store incremental events

Currently integrated incremental events:

- `chatSessionStore:sessionCreated`
- `chatSessionStore:metadataPatched`
- `chatSessionStore:sessionDeleted`

Although `chatSessionStore:filePatched` is still exposed in preload, the current renderer has no actual main-path consumption of it.

This means the renderer's session list synchronization main path now clearly favors:

- **List only follows metadata**
- **File-level patch is not the list source of truth**

This is exactly in line with the refactoring goals.

---

## 4. Data Model: The Boundary Between Metadata and File

The current system clearly distinguishes two types of data:

## 4.1 Metadata

Metadata is the data that the session list layer cares about, with typical fields including:

- `chatSession_id`
- `title`
- `last_updated`
- `readStatus`
- `schedulerJobId`
- `schedulerExecutionStatus`
- `schedulerStartedAt`
- `schedulerCompletedAt`
- `schedulerError`
- `source`

The persistence location for metadata is:

- `month index`

An additional new metadata management rule needs to be emphasized:

- `schedulerJobId`, like `schedulerExecutionStatus` / `schedulerStartedAt` / `schedulerCompletedAt` / `schedulerError`, uniformly belongs to metadata
- Whether a scheduled session has a scheduling source and its current execution state should be determined from the month index metadata
- `ChatSessionFile` should no longer carry any scheduler truth fields
- If `AgentChat`'s runtime needs this information, it should be hydrated into independent runtime fields through metadata, not stuffed into the file snapshot

## 4.2 Full Session File

The full session file is the data that the details view and runtime care about, containing the complete message chain, context, and business content.

Its persistence location is:

- An independent chat session file

## 4.3 The Most Critical Boundary: `readStatus`

The current rules are very clear:

- `readStatus` **belongs only to metadata**
- `readStatus` **only persists to month index**
- `readStatus` **does not enter `ChatSessionFile`**
- `AgentChat` should not treat any read state in the file as truth

One of the most important design corrections in this refactoring is completely removing read/unread from the full session file semantics.

## 4.4 Additional Boundary That Needs Further Convergence: Scheduler Metadata

In addition to `readStatus`, the scheduling source fields and execution state fields of scheduled chat sessions should also follow the same metadata-only rule.

These fields include:

- `schedulerJobId`
- `schedulerExecutionStatus`
- `schedulerStartedAt`
- `schedulerCompletedAt`
- `schedulerError`

The target rules should be:

- These fields **belong only to metadata**
- These fields **only persist to month index**
- These fields **do not enter `ChatSessionFile`**
- `AgentChat` / `AgentChatManager` should not treat scheduler fields in the file as truth
- The renderer's scheduled session list state should be based on the metadata projection

`schedulerJobId` expresses "whether this session was produced by a scheduler job," which is essentially a list-layer / metadata-layer semantic, not the message content itself; therefore it must also be managed uniformly by the month index, just like `readStatus` and scheduler execution state.

`ChatSessionFile` at most retains fields that are strongly bound to session content; any scheduler metadata should not enter the full session file.

---

## 5. Standard Read Paths in the Main Process

## 5.1 Loading a Single Session

Standard entry: `chatSessionStore.ensureLoaded(alias, chatId, chatSessionId)`

Process:

1. First check `sessionsById`
2. If already in memory, return the aggregate directly
3. If not in memory:
   - Read the month index from `ChatSessionManager.readMonthIndex(...)`
   - Find the metadata in it
   - Read the full file via `ChatSessionManager.getChatSessionFile(...)`
4. Assemble `ChatSessionAggregate` from metadata + file
5. Cache to `sessionsById`
6. Return the aggregate

This ensures:

- The main process can always restore a session's canonical aggregate from the repository
- All subsequent modifications are based on this aggregate

---

## 5.2 Getting the Session List Projection

Standard entry: `chatSessionStore.getChatSessionsProjection(alias, chatId)`

Process:

1. First use `ChatSessionManager.getAllChatSessions(...)` to read the on-disk metadata list
2. Then read the overlay sessions for the current chat that are already loaded in the store
3. Use the in-memory `aggregate.metadata` to overlay the persisted metadata of the same ID
4. Output sorted by `last_updated`

This design is very important.

It gives the list view both:

- Complete cold data restored from disk
- Real-time hot data covered by in-memory truth

That is, **the list sees a projection synthesized from persisted state + in-memory overlay**, not blindly trusting one side.

---

## 6. Standard Write Paths in the Main Process

## 6.1 Create or Save a Session

Unified entry: `chatSessionStore.saveSession(...)`

Semantics:

- If the session doesn't exist, `createSession(...)`
- If it already exists, merge metadata/file into the aggregate, then flush

This has replaced the old pattern:

- Exist -> add/update branch
- Frontend first checks existence then decides which IPC to call

Now the renderer only needs to use one unified save entry.

---

## 6.2 Patch Metadata

Entry: `chatSessionStore.patchMetadata(...)`

Characteristics:

- Only modifies metadata
- Refreshes `last_updated`
- After flushing, only needs to notify metadata patched
- Suitable for metadata-only updates like `readStatus`, `schedulerJobId`, and scheduler execution metadata

---

## 6.3 Patch File

Entry: `chatSessionStore.patchFile(...)`

Characteristics:

- Modifies the full file
- Simultaneously corrects affected fields in metadata, such as `title` and `last_updated`
- After flushing, sends file patched + metadata patched

---

## 6.4 Set Read Status

Entry: `chatSessionStore.setReadStatus(alias, chatId, chatSessionId, readStatus)`

Characteristics:

- Only modifies `metadata.readStatus`
- Only marks `dirtyMetadata`
- After flushing, only sends metadata patched
- Does not touch `ChatSessionFile`

This is currently the cleanest path for read/unread semantics.

---

## 6.5 Rename Session

Entry: `chatSessionStore.renameSession(...)`

Characteristics:

- Simultaneously updates `file.title` and `metadata.title`
- Updates `last_updated`
- After flushing, sends file patched + metadata patched

---

## 6.6 Delete Session

Entry: `chatSessionStore.deleteSession(...)`

Characteristics:

- Already-loaded sessions: deleted serially through the queue
- Not-yet-loaded sessions: repository can be called directly to delete
- After deletion, cleans up `sessionsById` and `chatToSessionIds`
- Notifies renderer `sessionDeleted`

---

## 7. How Concurrency Control Works

This is one of the most critical safety mechanisms of the entire architecture.

## 7.1 Session-Level Mutation Queue

`ChatSessionStore` internally establishes a serial queue per `chatSessionId` via `sessionMutationQueues`.

The effect is:

- Mutations on the same session are strictly serialized
- Different sessions can still run in parallel

This solves one of the most dangerous past issues:

- A updates readStatus
- B updates title
- Both read an old snapshot and concurrently write back the entire package

Multiple business entry points will no longer compete to write the same session's file.

---

## 7.2 Revision / PersistedRevision

Each aggregate maintains:

- `revision`
- `persistedRevision`

On write:

1. Mutation first updates in-memory
2. `revision += 1`
3. Record the target `targetRevision` when flushing
4. After flush completes, only advance `persistedRevision` to that value and clear the dirty flag if the current `aggregate.revision` still equals `targetRevision`

This means:

- If new mutations arrive during a flush
- When that earlier flush completes, it will not incorrectly roll back the updated state to "fully persisted"

It is not designed to invalidate old disk writes, but to let the store correctly know **which revision has been persisted**.

---

## 8. How Flushing Works

Actual flushing occurs in `ChatSessionStore.flushSession(...)`.

Process:

1. Generate `metadataSnapshot` from aggregate
2. Generate `fileSnapshot` from aggregate
3. If creating: use `chatSessionManager.addChatSession(...)`
4. Otherwise: use `chatSessionManager.updateChatSession(...)`
5. After success, decide whether to update dirty state and `persistedRevision` based on revision
6. Trigger auto-select event if necessary

There are two key points here:

### 8.1 Snapshots Can Only Be Exported by the Store

Business modules cannot directly decide "what should be written to disk."

Disk snapshots must be derived from the aggregate.

### 8.2 Repository No Longer Bears Business Coordination

`ChatSessionManager` does not care about:

- Who changed the state
- Why it changed
- Whether an unread event triggered it
- Whether it's foreground/background

It only receives the result exported by the store and executes persistence.

---

## 9. IPC and Frontend-Backend Synchronization Flow

## 9.1 Save IPC

Main process entry: `profile:saveChatSession`

Location: `src/main/main.ts`

Flow:

1. Renderer calls `window.electronAPI.profile.saveChatSession(...)`
2. `main.ts` forwards to `ProfileCacheManager.saveChatSession(...)`
3. `ProfileCacheManager` then calls `chatSessionStore.saveSession(...)`
4. Store updates aggregate, flushes, sends incremental events
5. `ProfileCacheManager` triggers `notifyProfileDataManager(...)`

This means:

- The renderer has only one unified save IPC
- Inside the main process there is only one unified state entry

---

## 9.2 List Sync IPC

There are two chains:

### A. Cold Start / Batch Sync

- `profile:cacheUpdated`
- Sent by `ProfileCacheManager.performNotification(...)`
- Dynamically assembles `chatSessions` projection for each chat before notifying

### B. Hot Update / Incremental Sync

Sent directly by `ChatSessionStore`:

- `chatSessionStore:sessionCreated`
- `chatSessionStore:metadataPatched`
- `chatSessionStore:sessionDeleted`
- `chatSessionStore:filePatched` (not currently used in renderer main path)

The renderer's `ProfileDataManager` mainly merges the list based on metadata-level events.

---

## 10. Why Read/Unread Is Now Much More Stable

After this refactoring, the semantics of read/unread have been greatly simplified.

Current rules:

1. `readStatus` is only in metadata
2. `setReadStatus(...)` only modifies metadata
3. Month index is the only persistence location for read/unread
4. Renderer list only receives metadata events
5. Full session file no longer participates in read state contention

Therefore, the past scenario where:

- Switching to foreground marks as read
- Switching away causes some old file/save flow to change it back to unread

has been structurally eliminated.

Whether read/unread toggles primarily depends on:

- `AgentChatManager`'s judgment of foreground/background state
- Whether `ChatSessionStore.setReadStatus(...)` is called
- Whether the renderer correctly receives metadata patched / profile cache updated

And will no longer be reverse-polluted by stale copies of session files.

---

## 11. Boundary Cases: Fork, Mark-All-Read, Import

## 11.1 Fork

Currently uses `chatSessionStore.copySession(...)`:

- First `ensureLoaded(...)` the source session
- Derive new metadata/file from the aggregate
- Generate a new sessionId
- Set readStatus to `unread` by default
- Flush through `createSession(...)`

This is more aligned with the new architecture than the old repository-level copy, because the semantics are at the store layer.

## 11.2 Initialize

`AgentChatManager.initialize(...)` now only handles runtime initialization:

- Records the current alias
- Prevents duplicate initialization
- Does not batch-clear unread at startup

Read state changes should only be triggered by real business actions, such as:

- User switching to a session
- Session transitioning between active and idle states for unread

## 11.3 Import

After import completes, the old `chatSession:updated` event is no longer used; instead `ProfileCacheManager.forceNotifyProfileDataManager(...)` is triggered, letting the frontend see the import result from the projection again.

---

## 12. What Has Already Landed Relative to the Design Document

The following design goals have clearly been implemented:

- Introduced `ChatSessionStore` as the main-process session source of truth
- Business write entries converged to the store
- `ChatSessionManager` downgraded to a persistence layer
- readStatus only exists in metadata / month index
- Renderer list mainly consumes metadata projection
- Old exist/add/update IPC branches deleted
- `AgentChatManager`'s mark-all-read / copy and other behaviors migrated to the store
- Old `chatSession:updated` main path cleaned up

---

## 13. What Is Not Yet the Final State

Although the refactoring has been very successful, from the perspective of "pure final state," there are still some areas that can continue to converge:

### 13.1 `AgentChat` Still Holds Runtime `currentChatSession`

The current `AgentChat.saveChatSession()` still generates a snapshot from instance state, then hands it to the store.

This is already much safer than the old pattern, but the ideal final state would be more like:

- `AgentChat` holds a lighter runtime reference
- Business modifications apply directly to the store aggregate
- `AgentChat` no longer bears session snapshot assembly responsibilities

### 13.2 `profile:getChatSessions` Paginated IPC Still Goes Directly to Repository

Currently in `main.ts`:

- `profile:getChatSessions`
- `profile:getMoreChatSessions`

Still directly use `ChatSessionManager` to read paginated lists.

This is reasonable for paginated loading, but if further unifying read semantics completely is desired, it can be evaluated whether to abstract a store-level paginated projection capability.

### 13.3 `filePatched` Event Exists, But Renderer Main Path Does Not Consume It

The current system already has file-level incremental event capability, but the frontend main path is more oriented toward metadata list synchronization.

If the details page wants to fully align with store projections in the future, file projection consumption can be further improved.

---

## 14. Rules That Must Be Followed During Development

Any subsequent code involving chat sessions should follow these rules:

## 14.1 Do Not Do This

- First `getChatSessionFile()`
- Locally modify a few fields in the caller
- Then write the entire package back with `updateChatSession(...)`

This is the most dangerous stale snapshot overwrite pattern of the old architecture.

## 14.2 Do This Instead

Prefer using `ChatSessionStore` commands:

- `saveSession(...)`
- `patchMetadata(...)`
- `patchFile(...)`
- `setReadStatus(...)`
- `renameSession(...)`
- `deleteSession(...)`
- `copySession(...)`
- `ensureLoaded(...)`
- `getChatSessionsProjection(...)`

## 14.3 Keep Metadata-Only Field Rules in Mind

- `readStatus` is only in metadata
- `schedulerJobId` is only in metadata
- `schedulerExecutionStatus` / `schedulerStartedAt` / `schedulerCompletedAt` / `schedulerError` are also only in metadata
- These fields are only written to the month index
- Not written to `ChatSessionFile`
- List state is based on the metadata projection

---

## 15. One-Sentence Summary

The current chat session management mechanism can be summarized as:

> **`ChatSessionStore` holds the sole canonical session state in the main process; business modifications update the store first, then the store serially flushes to `ChatSessionManager`; the frontend list consumes the metadata projection through `ProfileCacheManager` and store incremental events; `readStatus`, `schedulerJobId`, and scheduler execution metadata should only exist in month index metadata, not in the full session file.**

This is how chat session management actually works in the current code.
