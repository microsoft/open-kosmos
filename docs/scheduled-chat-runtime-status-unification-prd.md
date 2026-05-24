# PRD: Scheduled Chat Runtime Status Unification

## Background

Scheduled chat sessions are created and owned by `AgentChatManager`, but their runtime `chatStatus` does not currently follow the same propagation path as ordinary interactive sessions.

Today:

1. Scheduled runs persist `schedulerExecutionStatus` metadata correctly for scheduler-facing UI.
2. Scheduled runs set `AgentChat` runtime `chatStatus` internally during execution.
3. The renderer-side runtime cache and `agentChat:chatStatusChanged` consumers depend on an event sender attached to the `AgentChat` output port.
4. Scheduled-silent runs intentionally set `eventSender = null`, so their runtime `chatStatus` often never reaches renderer consumers.

This creates inconsistent behavior:

- `SchedulesSidepane` can show running state using `schedulerExecutionStatus`.
- `AgentList` may miss the loading/executing indicator for the same scheduled session.
- Opening a running scheduled session may not reliably hydrate the same runtime busy state semantics used by ordinary sessions.

## Goal

Make runtime `chatStatus` propagation consistent for all managed `AgentChat` instances, including scheduled-silent sessions, without changing persisted session schema.

## Product Requirements

### 1. Runtime `chatStatus` remains runtime-only

- Do not add a persisted `chatStatus` or `chatSessionStatus` field to session metadata.
- Continue using persisted `schedulerExecutionStatus` only for scheduler lifecycle state.
- Continue using runtime `chatStatus` only for live chat-runtime UI state.

### 2. All managed `AgentChat` instances must emit runtime status through `AgentChatManager`

- Every `AgentChat` instance created and registered by `AgentChatManager` must feed status changes into a manager-owned propagation path.
- Status propagation must not depend on whether the instance currently has a renderer event sender attached.

### 3. Scheduled sessions must preserve dual-state semantics

For scheduled sessions:

- `schedulerExecutionStatus` remains the scheduler-facing lifecycle signal.
- `chatStatus` remains the chat-runtime busy/idle signal.
- The two signals must coexist without redefining one in terms of the other.

### 4. Existing interactive behavior must remain unchanged

- Foreground interactive sessions must still update renderer runtime cache and UI controls exactly as before.
- `ChatView`, `ChatInput`, `AgentList`, and any other `chatStatusChanged` consumer should continue using the same event contract.

### 5. Scheduled background execution must continue to avoid streaming content pushes

- Scheduled-silent runs must not start sending streaming chunks or interactive cards to renderer windows merely to get runtime status updates.
- Only runtime status propagation is being unified.

### 6. Opening a running scheduled session must hydrate like a normal session

- When a running scheduled session is switched into the foreground, its current runtime `chatStatus` must be visible to renderer consumers.
- If the session is already managed, the created cache snapshot must reflect the current runtime status.

## Non-Goals

- Persisting runtime `chatStatus`
- Replacing `schedulerExecutionStatus`
- Reworking scheduler completion notification UX
- Changing non-interactive scheduled policy behavior
- Changing message streaming behavior for background scheduled runs

## Success Criteria

- `AgentList` can react to running scheduled sessions using the existing `chatStatusChanged` contract.
- Opening a running scheduled session exposes the same runtime busy state semantics as an ordinary session.
- Scheduled-silent runs still avoid streaming content to renderer.
- Existing interactive session behavior remains unchanged.
- Regression tests cover manager-driven runtime status propagation for scheduled-silent instances.