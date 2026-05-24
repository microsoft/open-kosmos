# Tech Doc: Scheduled Chat Runtime Status Unification

## Scope

This change unifies runtime `chatStatus` propagation for all `AgentChat` instances managed by `AgentChatManager`, including `scheduled-silent` instances, while keeping `schedulerExecutionStatus` as separate persisted scheduler metadata.

## Design Summary

### Problem

Current status propagation mixes two mechanisms:

1. `AgentChat.setChatStatus(...)` updates runtime state and tries to emit `agentChat:chatStatusChanged` through `AgentChatOutputPort`.
2. `AgentChatManager` separately polls `instance.getChatStatus()` every 30 seconds to drive idle cleanup.

For scheduled-silent runs, `AgentChatManagerScheduledRunner` intentionally calls `agentChat.setEventSender(null)`, which prevents `AgentChatOutputPort.emitStatus(...)` from delivering renderer status events. As a result, manager ownership of the instance does not imply consistent runtime status propagation.

### Target architecture

#### Source of truth

- `AgentChatRuntimeState.chatStatus` remains the runtime source of truth.

#### Propagation owner

- `AgentChatManager` becomes the authoritative propagation owner for runtime status changes.
- Status propagation is event-driven from managed instances, not polling-based.

#### Renderer-facing contract

- Existing `agentChat:chatStatusChanged` payload shape remains unchanged.
- Renderer consumers (`AgentList`, `ChatView`, `agentChatSessionCacheManager`, etc.) continue using the existing contract.

#### Scheduler-facing contract

- `schedulerExecutionStatus` remains persisted metadata and is not replaced.
- `SchedulesSidepane` and scheduler diagnostics remain metadata-driven.

## Implementation Plan

### 1. Add AgentChat status listeners

File: `src/main/lib/chat/agentChat.ts`

- Add lightweight status listener registration on `AgentChat`.
- Trigger listeners from `setChatStatus(...)` after runtime state updates.
- Clear listeners in `destroy()`.

This makes runtime status changes observable even when `eventSender` is null.

### 2. Add manager-owned renderer status broadcast helper

File: `src/main/lib/chat/agentChatManagerRendererBridge.ts`

- Add `notifyChatStatusChanged(chatId, chatSessionId, chatStatus, agentName)`.
- Keep payload shape aligned with `agentChat:chatStatusChanged`.

### 3. Replace polling-based manager status handling with event-driven listener setup

File: `src/main/lib/chat/agentChatManager.ts`

- Attach a manager status listener for every registered managed instance, regardless of runtime mode.
- On each status event:
  - push `agentChat:chatStatusChanged` through the renderer bridge
  - call `handleStatusChange(...)` so session coordinator logic stays centralized
- Stop using the 30-second polling interval as the primary status path.
- Ensure listener attachment is idempotent per instance.

### 4. Keep scheduled runner focused on scheduler orchestration

File: `src/main/lib/chat/agentChatManagerScheduledRunner.ts`

- Continue using `createAgentWithChatSession(...)` and `registerManagedInstance(...)` from manager.
- Continue setting `eventSender = null` so streaming content is not forwarded.
- Rely on manager-owned status listeners for runtime status propagation.

### 5. Preserve foreground promotion behavior

File: `src/main/lib/chat/agentChatManager.ts`

- When a cached scheduled-silent instance is promoted to interactive on session switch, keep the existing cache creation behavior.
- The cache snapshot must include `instance.getChatStatus()` so the current runtime state is visible immediately.

## Testing Plan

### Unit tests

- `agentChatManager.notifications.test.ts`
  - scheduled-silent managed instances emit `agentChat:chatStatusChanged` through manager even without output-port sender
  - existing interactive notification/read-state behavior remains intact

- `agentChatManagerScheduledRunner.test.ts`
  - scheduled runner still registers `scheduled-silent` instances and does not need renderer sender to complete successfully

### Existing behavior validation

- Interactive sessions still push runtime status normally.
- Scheduled runs still persist `schedulerExecutionStatus` metadata.
- Opening a scheduled session still promotes it to interactive cache behavior without changing persisted schema.

## Risks and Mitigations

### Risk: duplicate status broadcasts

Interactive sessions may have both output-port sender emission and manager-owned bridge emission.

Mitigation:

- Manager status listener setup must be attached once per managed instance.
- Renderer consumers already tolerate repeated `chatStatusChanged` payloads for the same session/status.
- Preserve payload shape and idempotent cache updates.

### Risk: listener leaks across destroyed instances

Mitigation:

- Clear manager-owned listener handles during `disposeManagedInstance(...)`.
- Clear `AgentChat` status listeners during `destroy()`.

### Risk: scheduled sessions create renderer cache side effects while still background

Mitigation:

- Do not create chat-session cache eagerly for scheduled-silent instances.
- Only broadcast runtime status events globally.
- Cache creation remains tied to interactive/current-session flows.