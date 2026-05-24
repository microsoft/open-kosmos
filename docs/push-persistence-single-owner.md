# Push Message Persistence: Single Owner Problem

## Background

Push messages from External Agent (Bot→Kosmos) need to be persisted to `chatSessionStore`. Two components currently have persistence capability:

- **ExternalAgentService**: writes directly via `chatSessionStore.patchFile`
- **AgentChatPushReceiver**: writes via `host.addMessageToSession` (an AgentChat internal method)

## Current State (Conflicting)

```typescript
// externalAgentService.ts — handlePushEnd()
const agentChat = this.getAgentChatInstance(chatSessionId);
if (agentChat) {
  await agentChat.handlePushComplete(/* skipPersistence */ false);  // ← AgentChat persistence
} else if (accumulatedText) {
  await this.persistPushMessage(...);  // ← Service persistence
}
```

**Two persistence paths, two accumulated text buffers:**

| Component | Accumulation Location | Text Content |
|------|---------|---------|
| ExternalAgentService | `pushStreams` Map | Full text (accumulated from the first chunk) |
| AgentChatPushReceiver | `this.pushAccumulated` | Only text received while AgentChat exists |

## Problem: Text Inconsistency in Mid-stream Scenarios

### Scenario 5: Mid-stream rejoin (AgentChat reconstructed mid-stream)

```
Timeline:
t1: push "AB" → AgentChat does not exist → Service accumulates "AB", PushReceiver does not exist
t2: User opens chat → AgentChat created
t3: push "CD" → Service accumulates "ABCD", PushReceiver accumulates "CD"
t4: push_end → ???
```

- **skipPersistence=false (current)**: PushReceiver persists "CD" (loses "AB")
- **skipPersistence=true (previous)**: Service persists "ABCD" (correct)

### Scenario 6: AgentChat destroyed mid-stream

```
Timeline:
t1: push "AB" → AgentChat exists → Service accumulates "AB", PushReceiver accumulates "AB"
t2: AgentChat idle timeout → destroyed
t3: push "CD" → AgentChat does not exist → Service accumulates "ABCD", PushReceiver does not exist
t4: push_end → Service persists "ABCD" (correct, because no AgentChat → else branch)
```

This scenario happens to be correct, but only because AgentChat is absent and the else branch is taken.

## Motivation for Changing to skipPersistence=false

Luna's comment:
> "avoids AgentChat's own persist overwriting our chatSessionStore write"

The concern is: if Service writes to chatSessionStore first, AgentChat's subsequent `addMessageToSession` write may overwrite it.

## Analysis

Whether this concern is valid depends on whether `addMessageToSession` and `chatSessionStore.patchFile` conflict:

- `addMessageToSession`: an AgentChat internal method that operates on AgentChat's in-memory session and then syncs to disk
- `chatSessionStore.patchFile`: operates directly on disk storage

If both operate on the same file, the later write will indeed overwrite the earlier one. But the solution should not be "let AgentChat handle persistence," because AgentChat's accumulated text may be incomplete (Scenario 5).

## Correct Solution Direction

**Option 3: Service persists the full text via AgentChat.addMessageToSession**

Service is the sole persistence owner, but chooses different write APIs depending on whether AgentChat exists:

```typescript
// handlePushEnd
if (agentChat) {
  await agentChat.handlePushComplete(/* skipPersistence */ true);   // UI cleanup only
  if (accumulatedText) {
    const msg = MessageHelper.createTextMessage(accumulatedText, 'assistant', msgId);
    await agentChat.addMessageToSession(msg);  // in-memory + disk atomic update
  }
} else if (accumulatedText) {
  await this.persistPushMessage(...);  // patchFile — no in-memory state to conflict with
}
```

### Why This Approach Is Correct

1. **When AgentChat exists**: uses `addMessageToSession`, updates in-memory chat_history + triggers `saveChatSession` (full snapshot), memory and disk are atomically consistent
2. **When AgentChat does not exist**: uses `patchFile`, no AgentChat in-memory state, no conflict
3. **PushReceiver handles UI only** (`skipPersistence=true`), does not participate in persistence
4. **Service's pushStreams always has the full text**, does not depend on PushReceiver's pushAccumulated

### Validation Across All Scenarios

| Scenario | Behavior | Result |
|------|------|------|
| Normal (AgentChat present throughout) | complete(true) → addMessageToSession("ABCD") | ✓ |
| Scenario 5 (mid-stream rejoin) | Service has "ABCD" → addMessageToSession("ABCD") | ✓ |
| Scenario 5 variant (no new chunks) | PushReceiver early return → addMessageToSession("AB") | ✓ |
| Scenario 6 (AgentChat destroyed mid-stream) | No AgentChat → patchFile("ABCD") | ✓ |
| Fully offline | No AgentChat → patchFile(full text) | ✓ |

### Verified Items

- [x] `addMessageToSession` implementation: appends to in-memory chat_history + triggers saveChatSession (full JSON snapshot)
- [x] `handlePushComplete(true)` path does not trigger additional persistence
- [x] AgentChat sync mechanism: `saveChatSession` does `JSON.parse(JSON.stringify(currentChatSession))` → `chatSessionStore.saveSession`, which is a full in-memory snapshot
