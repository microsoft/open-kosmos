# Scheduled Unread / User Unread Separation and Real-Time Statistics Architecture

## Document Purpose

This document defines the target architecture for Chat Session unread statistics, to resolve the current instability in Schedule badge count criteria, insufficient real-time updates when switching by chat-id, and the mixing of user session unread counts with scheduled session unread counts.

Goals:

1. Explicitly split unread statistics into two categories:
   - `userUnreadCount`
   - `scheduledUnreadCount`
2. All unread aggregation logic uses the main process as the single source of truth.
3. Supports returning correct counts immediately when switching by `chatId`.
4. Supports real-time updates after user reads, new scheduled sessions are generated, sessions are deleted, or session attributes change.
5. Fix the statistics criteria for the Schedule icon badge to:
   - Current `chatId`
   - `scheduled session`
   - `readStatus === 'unread'`
   - Most recent 5-day window

---

## 1. Problem Background

The current Schedule badge count in the renderer comes from temporary frontend scan logic inside `ChatView.tsx`. This logic directly iterates over the current chat's `chatSessions` list and filters for:

- Has `schedulerJobId`
- `readStatus === 'unread'`
- Satisfies the time window condition

Problems with this approach:

1. **Aggregation logic is in the renderer**
   - Real unread changes happen in the main process
   - The renderer can only consume projected metadata
   - Badge update timing is uncontrollable when profile refreshes and incremental events occur

2. **Scattered aggregation responsibilities**
   - The Header badge has its own filtering logic
   - The Schedules sidepane has its own session monitoring logic
   - Chat list / navigation may maintain yet another set of unread criteria

3. **No clear separation model between user unread and scheduled unread**
   - While they can be distinguished by `schedulerJobId` in the state fields
   - The system lacks a unified unread summary concept

4. **No dedicated aggregation layer when switching by chatId**
   - Currently depends on profile projection + renderer recalculation
   - Hard to guarantee consistency when switching chats, marking read, or creating new sessions

---

## 2. Design Principles

### 2.1 Single Source of Truth

All unread summary calculations are authoritative in the main process, provided uniformly by `ChatSessionStore`.

### 2.2 Separate State Changes from Aggregation

- `readStatus` remains the factual field of session metadata
- Unread summary is an aggregated view derived from session metadata
- The aggregated view does not write back to session metadata

### 2.3 Separate User / Scheduled Accounts

Abstracted uniformly into two independent counts:

- `userUnreadCount`
- `scheduledUnreadCount`

The two cannot be interchanged or mixed in the UI.

### 2.4 Chat-Dimension Isolation

Summaries must be strictly counted by `chatId`; when switching chats, only the current chat's summary is consulted.

### 2.5 Renderer Only Consumes Summary

The renderer is not responsible for rescanning session lists to make business decisions; at most it performs display-level processing.

---

## 3. Business Definitions

## 3.1 Session Classification

### User Chat Session

Satisfies the following condition:

- `schedulerJobId` does not exist, is empty, or is a blank string

### Scheduled Chat Session

Satisfies the following condition:

- `schedulerJobId` exists and is non-empty

---

## 3.2 Unread Definition

Session unread determination rule:

- `readStatus === 'unread'`

All other values are treated as non-unread.

---

## 3.3 Statistics Window

### userUnreadCount

Counts all sessions under the current `chatId` satisfying:

- `readStatus === 'unread'`
- Not a scheduled session

`userUnreadCount` **does not apply a time window**.

### scheduledUnreadCount

Counts all sessions under the current `chatId` satisfying:

- `readStatus === 'unread'`
- Is a scheduled session
- Session event time falls within the most recent 5 days

Time field priority:

1. `schedulerCompletedAt`
2. `schedulerStartedAt`
3. `last_updated`

Equivalent logic:

- `eventTime >= now - 5 days`

If the time field cannot be parsed, the session is not counted in `scheduledUnreadCount` by default.

---

## 4. Target Architecture

## 4.1 Layered Structure

### Main Process

1. `AgentChatManager`
   - Responsible for session lifecycle
   - Decides when to mark sessions as read / unread

2. `ChatSessionStore`
   - Session canonical state owner
   - Responsible for metadata/file/runtime aggregation
   - Responsible for unread summary calculation
   - Responsible for unread summary event dispatching

3. `ChatSessionManager`
   - Persistence / repository layer
   - Not responsible for unread summary business definitions

4. `preload`
   - Exposes unread summary query and subscription APIs

### Renderer

1. `ProfileDataManager`
   - Continues to maintain profile cache and session metadata projection
   - Does not carry unread summary business aggregation responsibility

2. `useChatUnreadSummary(chatId)`
   - Chat-level unread summary hook
   - Fetches initial value + subscribes to incremental events

3. Various UI consumers
   - Header schedule badge: uses only `scheduledUnreadCount`
   - Navigation / AgentList ordinary unread: uses only `userUnreadCount`
   - SchedulesSidepane: displays session list, does not directly determine summary criteria

---

## 4.2 Single Aggregation Source of Truth

New main process aggregation object:

```ts
export interface ChatUnreadSummary {
  chatId: string;
  userUnreadCount: number;
  scheduledUnreadCount: number;
  updatedAt: string;
}
```

Description:

- `chatId`: the chat this summary belongs to
- `userUnreadCount`: ordinary session unread count
- `scheduledUnreadCount`: scheduled unread count within 5-day window
- `updatedAt`: summary calculation time, used for debugging and potential debouncing

---

## 5. ChatSessionStore Design

## 5.1 New Responsibilities

Add unread summary-related capabilities to `ChatSessionStore`:

1. Calculate whether a single session is a user unread
2. Calculate whether a single session is a scheduled unread
3. Calculate the complete summary for a given `chatId`
4. Emit summary changed events after session mutations

---

## 5.2 Recommended New APIs

```ts
getUnreadSummary(alias: string, chatId: string): Promise<ChatUnreadSummary>
```

Purpose:

- Get initial value when renderer switches to a chatId

```ts
getUnreadSummarySync(alias: string, chatId: string): ChatUnreadSummary | null
```

Purpose:

- Internal main process reuse
- Avoid repeated awaits in certain event chains

```ts
emitUnreadSummaryChanged(alias: string, summary: ChatUnreadSummary): void
```

Purpose:

- Broadcast to renderer via existing window/webContents

```ts
recomputeUnreadSummaryAndNotify(alias: string, chatId: string): Promise<void>
```

Purpose:

- Called uniformly after all mutations complete

---

## 5.3 Summary Calculation Logic

### 5.3.1 Helper Functions

```ts
function isScheduledSession(session: ChatSessionLike): boolean
```

Rule:

- Returns `true` when `schedulerJobId` is a non-empty string

```ts
function isUnreadSession(session: ChatSessionLike): boolean
```

Rule:

- `readStatus === 'unread'`

```ts
function getScheduledSessionEventTime(session: ChatSessionLike): number | null
```

Rule:

1. Take `schedulerCompletedAt`
2. Otherwise take `schedulerStartedAt`
3. Otherwise take `last_updated`
4. Returns `null` if none can be parsed

```ts
function isInRecentDaysWindow(timestampMs: number, days: number): boolean
```

Rule:

- `timestampMs >= Date.now() - days * 24h`

---

### 5.3.2 Aggregation Implementation Pseudocode

```ts
function buildChatUnreadSummary(alias: string, chatId: string): ChatUnreadSummary {
  const sessions = getChatSessionsProjection(alias, chatId);

  let userUnreadCount = 0;
  let scheduledUnreadCount = 0;

  for (const session of sessions) {
    if (session.readStatus !== 'unread') {
      continue;
    }

    if (isScheduledSession(session)) {
      const eventTime = getScheduledSessionEventTime(session);
      if (eventTime !== null && isInRecentDaysWindow(eventTime, 5)) {
        scheduledUnreadCount += 1;
      }
      continue;
    }

    userUnreadCount += 1;
  }

  return {
    chatId,
    userUnreadCount,
    scheduledUnreadCount,
    updatedAt: new Date().toISOString(),
  };
}
```

---

## 5.4 When to Trigger Summary Recomputation

After any of the following mutations complete, `recomputeUnreadSummaryAndNotify(alias, chatId)` should be triggered:

1. Session created
2. Session deleted
3. `readStatus` changed
4. `schedulerJobId` changed
5. `schedulerCompletedAt` changed
6. `schedulerStartedAt` changed
7. `last_updated` changed (only affects time window of scheduled unread)
8. Metadata changes from `copySession` / `forkSession`

To reduce missed cases, it is recommended to trigger summary events at the unified mutation completion point in `ChatSessionStore`, rather than at individual business entry points.

---

## 6. AgentChatManager Integration Points

`AgentChatManager` is still responsible for read/unread business timing, but is not directly responsible for aggregate counts.

## 6.1 User Switches to a Session

Current flow:

- `switchToChatSession(chatId, chatSessionId)`
- Calls `updateChatSessionReadStatus(chatId, chatSessionId, 'read')`

Target behavior:

1. Session becomes `read`
2. `ChatSessionStore` completes the mutation
3. `ChatSessionStore` automatically recomputes the summary for that `chatId`
4. Renderer receives the new summary event
5. Current chat's user/scheduled unread counts update synchronously

---

## 6.2 Session Becomes Unread After Losing Focus

Current flow:

- `markChatSessionAsUnreadIfNeeded(chatSessionId)`
- Calls `updateChatSessionReadStatus(chatId, chatSessionId, 'unread')`

Target behavior:

1. Session becomes `unread`
2. `ChatSessionStore` automatically recomputes the summary for that `chatId`
3. If the session is a scheduled session, updates `scheduledUnreadCount`
4. If the session is a regular user session, updates `userUnreadCount`

---

## 6.3 Principles

`AgentChatManager` is only responsible for:

- When a session becomes read
- When a session becomes unread

`ChatSessionStore` is responsible for:

- How this read/unread change is projected into the summary

---

## 7. IPC / preload Design

## 7.1 preload Exposed Interface

Recommended additions under `window.electronAPI.profile`:

```ts
getChatUnreadSummary(chatId: string): Promise<{
  success: boolean;
  data?: ChatUnreadSummary;
  error?: string;
}>
```

```ts
onChatUnreadSummaryChanged(
  callback: (payload: { alias: string; summary: ChatUnreadSummary }) => void,
): () => void
```

Description:

- `getChatUnreadSummary` is used for fetching initial values on first load or when switching chatId
- `onChatUnreadSummaryChanged` is used for real-time subscription

---

## 7.2 Event Design

Recommended event name:

- `profile:chatUnreadSummaryChanged`

Payload:

```ts
{
  alias: string;
  summary: {
    chatId: string;
    userUnreadCount: number;
    scheduledUnreadCount: number;
    updatedAt: string;
  };
}
```

Events are emitted only for the **single affected chatId**, not a full summary map.

Advantages:

- Low bandwidth
- Loose coupling
- Easy for renderer to perform partial updates

---

## 8. Renderer Design

## 8.1 New Hook

Add:

```ts
useChatUnreadSummary(chatId: string | null): {
  userUnreadCount: number;
  scheduledUnreadCount: number;
  isLoading: boolean;
}
```

---

## 8.2 Hook Behavior

### Initial Load

When `chatId` changes:

1. Clear the previous chat's loading subscription state
2. Call `getChatUnreadSummary(chatId)` to fetch the initial value
3. Write to local state

### Incremental Updates

Subscribe to `onChatUnreadSummaryChanged`:

- Only process events where `payload.summary.chatId === currentChatId`
- When received, directly overwrite local summary state

### Component Unmount

- Correctly cancel subscriptions
- Avoid events from old chatId contaminating the new chatId

---

## 8.3 Header Usage

`ChatViewHeader` only cares about:

- `scheduledUnreadCount`

Does not care about:

- `userUnreadCount`

The Schedule icon badge number source is fixed as:

- `useChatUnreadSummary(currentChatId).scheduledUnreadCount`

This ensures the Schedule badge never mixes in ordinary user session unread counts.

---

## 8.4 Navigation / AgentList Usage

Ordinary chat unread indicators only care about:

- `userUnreadCount`

Should not use:

- `scheduledUnreadCount`

If AgentList also needs real-time updates in the future, it is recommended to base this on summary events rather than rescanning session metadata.

---

## 9. Relationship with Existing ProfileDataManager

The current frontend depends on two types of sources:

1. `profile:cacheUpdated`
2. `chatSessionStore:*` incremental events

Under the new approach:

- Session list display can continue using profile + metadata projection
- Unread summary no longer depends on `ProfileDataManager` for self-recalculation
- `ProfileDataManager` is not the unread summary owner

This means:

1. List data and summary data come from different sources, but both come from the main process
2. Summary takes priority over renderer local inference
3. The renderer no longer needs to "scan the current `chatSessions` to calculate the badge"

---

## 10. Why Not Continue with Frontend Scanning

Frontend scanning appears to involve smaller changes, but is not the optimal approach, for the following reasons:

1. **Weak real-time performance**
   - Unread changes actually happen in the main process
   - The renderer can only wait for profile projection or event synchronization before recalculating

2. **Criteria easily diverge**
   - Header, Sidepane, and AgentList may end up with 3 different filter conditions

3. **Hard to separate accounts**
   - User unread and scheduled unread need to be consumed separately by multiple UI components
   - If each UI calculates its own, inconsistencies will easily arise later

4. **Uncontrollable performance**
   - As the number of chat sessions grows, switching chats scans all metadata
   - Though each scan may not be heavy, it is not architecturally optimal

Therefore, it is recommended to treat the unread summary as an explicit first-class data projection.

---

## 11. Data Consistency Strategy

## 11.1 Consistency Goals

For any given `chatId`, ensure:

- `userUnreadCount` = current count of all user unread sessions
- `scheduledUnreadCount` = current count of all scheduled unread sessions within the last 5 days

And satisfy eventual consistency + near real-time updates.

---

## 11.2 Event Order

Recommended order:

1. Session mutation lands in `ChatSessionStore`
2. `ChatSessionStore` updates the canonical aggregate
3. `ChatSessionStore` flushes metadata/file
4. `ChatSessionStore` sends session-level incremental events
5. `ChatSessionStore` calculates and sends unread summary event

Steps 4/5 can also be merged into a unified post-mutation event phase, but the summary must be calculated based on the post-mutation state.

---

## 11.3 Cold-Start Consistency

On cold start, do not rely on in-memory cache residuals:

- When renderer first enters a `chatId`, actively call `getChatUnreadSummary(chatId)`
- Main process calculates immediately based on the current `ChatSessionStore` projection
- Startup itself should not be treated as a read event; historical sessions should not be bulk-marked as `read`

This way, even if the frontend misses a certain event, it can re-align when switching chats, and the unread semantics remain driven only by real user view actions or business state changes.

---

## 12. Edge Cases

## 12.1 Scheduled Session Older Than 5 Days

Behavior:

- Even if still `unread`
- Not counted in `scheduledUnreadCount`

Reason:

- The Schedule badge represents "recent scheduled unread"
- Old scheduled unread items should not occupy Header attention indefinitely

---

## 12.2 Session Changes from Scheduled to Regular Session

Behavior:

- Removed from the `scheduledUnreadCount` system
- If still unread, transferred to `userUnreadCount`

---

## 12.3 Session Changes from Regular Session to Scheduled Session

Behavior:

- If unread and within 5 days, transferred from `userUnreadCount` to `scheduledUnreadCount`
- Otherwise removed from `userUnreadCount`, but not necessarily added to `scheduledUnreadCount`

---

## 12.4 Missing Time Fields

If a scheduled session has none of the following available or parseable:

- `schedulerCompletedAt`
- `schedulerStartedAt`
- `last_updated`

Then it is not counted in `scheduledUnreadCount`.

This avoids bad data inflating the badge.

---

## 12.5 Whether the Currently Active Session Counts as Unread

The principle remains consistent with the current read/unread mechanism:

- The session the user has switched into should be marked as `read` as soon as possible after `switchToChatSession(...)`
- Therefore it will typically not continue to count toward the unread summary

---

## 13. Migration Plan

## 13.1 Phase 1: Introduce Summary API Without Changing UI Criteria

Goal:

- Main process first gains `getChatUnreadSummary` and summary changed events
- Renderer adds hook
- Run in parallel with existing frontend scan results for comparison

Benefit:

- Reduces risk of the first round of changes
- Makes it easy to do diff validation in development environments

---

## 13.2 Phase 2: Switch Header to Summary

Goal:

- `ChatViewHeader` changes to consume only `scheduledUnreadCount`
- Remove the existing Schedule badge frontend scan logic from `ChatView.tsx`

Benefit:

- Completes the most important business entry point change first

---

## 13.3 Phase 3: Switch Navigation / AgentList to Summary

Goal:

- Ordinary chat unread UI changes to consume `userUnreadCount`
- Completely remove all session scan unread business logic

---

## 13.4 Phase 4: Converge to Unified Unread Event Model

Goal:

- Make the unread summary event the only unread data entry in the renderer
- Profile incremental events only handle session list display, no longer carrying unread business sync responsibilities

---

## 14. Observability and Debugging Recommendations

Recommended debug logs:

### Main

- `recomputeUnreadSummaryAndNotify`
  - alias
  - chatId
  - userUnreadCount
  - scheduledUnreadCount
  - trigger source

### Renderer

- `useChatUnreadSummary`
  - chatId changed
  - initial summary loaded
  - summary event received

This makes it easy to determine during debugging:

- Whether the session fact was not updated
- Or whether the summary was not recomputed
- Or whether the renderer did not receive the event

---

## 15. Testing Plan

## 15.1 Unit Tests

`ChatSessionStore`:

1. Regular unread sessions only count toward `userUnreadCount`
2. Scheduled unread sessions within 5 days only count toward `scheduledUnreadCount`
3. Scheduled unread sessions older than 5 days are not counted in `scheduledUnreadCount`
4. `read -> unread` conversion correctly increases the summary
5. `unread -> read` conversion correctly decreases the summary
6. Adding/removing `schedulerJobId` correctly migrates between accounts
7. Time field fallback order is correct

---

## 15.2 Integration Tests

1. Switch to chat A, return A's summary
2. Switch to chat B, return B's summary; no residual values from A
3. After user opens a scheduled session, badge decreases immediately
4. After a new scheduled session completes and is marked unread, badge increases immediately
5. After deleting an unread scheduled session, badge decreases immediately

---

## 15.3 UI Tests

1. Schedule badge on Header reflects only scheduled unread
2. User unread on Navigation / AgentList is not affected by scheduled unread
3. Both can coexist under the same chat without interfering with each other

---

## 16. Final Conclusion

The core of this plan is to upgrade unread counts from "several components each scanning the session list to compute a number" to "a chat-level unread summary uniformly derived by the main process."

The final system:

1. `ChatSessionStore` is the sole aggregation source of truth for unread summary
2. Unread summary is explicitly split into:
   - `userUnreadCount`
   - `scheduledUnreadCount`
3. `scheduledUnreadCount` only counts:
   - Current `chatId`
   - Scheduled session
   - `readStatus === 'unread'`
   - Within the last 5 days
4. `userUnreadCount` and `scheduledUnreadCount` are completely separate accounts and must never be mixed
5. Renderer gets real-time data via `getChatUnreadSummary + onChatUnreadSummaryChanged`
6. `ChatViewHeader` only displays `scheduledUnreadCount`
7. Other ordinary unread UI only displays `userUnreadCount`

This plan balances:

- Business accuracy
- Consistency when switching by chatId
- Real-time main-process fact-driven updates
- Maintainability for future architectural convergence
