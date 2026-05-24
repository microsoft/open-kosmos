# External Agent: Request-Response → Push Model Plan

> **Summary (English):** This document describes the migration of External Agent from a request-response model (user sends → WS forwards → wait for reply/reply_end) to a push model where external bots can proactively push messages to Kosmos via `push`/`push_end` WebSocket messages. Key changes: fire-and-forget sends, `AgentChatPushReceiver` for streaming/persistence, and unread marking on push completion.

## Background

The current External Agent uses a request-response model: user sends message → WS forwards → wait for reply/reply_end → return. The entire flow is synchronously driven by `AgentChat.streamMessage`; external bots can only reply after the user sends a message and cannot proactively push messages.

**Goal**: External bots can proactively push messages to the Kosmos chat interface at any time, without needing the user to trigger a message first.

---

## Key Issue Analysis

### 1. What does AddMessageToSession do? Can we bypass AgentChat for direct persistence?

`AgentChat.AddMessageToSession` delegates to `SessionService.addMessageToSession`, with core operations:
- Adding the message to `currentChatSession.chat_history`
- Adding the message to context history
- Atomically saving the chatSession file to disk

**Can we bypass it?** Bypassing directly is not recommended. `AddMessageToSession` requires AgentChat instance's `currentChatSession` to be initialized. However, we can directly use `profileCacheManager.saveChatSession` + `chatSessionStore` for independent persistence, provided we have the correct chatSession file reference. A simpler approach is to reuse the AgentChat instance.

### 2. What return value does the caller of AgentChatManager.streamMessage expect?

```typescript
{ success: boolean; data?: Message[]; error?: string }
```

The caller (IPC handler) expects a synchronous return result. `streamMessage` also:
- Checks that status must be `idle` before sending
- Sets `sending_response` status
- Checks on completion whether unread marking is needed
- Cleans up the CancellationTokenSource

**What does fire-and-forget break?** If we bypass `streamMessage` directly, nothing breaks — because push messages don't go through this path at all. Push is an independent receive path.

### 3. How does the renderer's agentChatSessionCacheManager handle various chunks?

Receives via IPC event `agentChat:streamingChunk`, dispatches by `chunk.type`:

| type | Required fields | Behavior |
|------|---------|------|
| `content` | `messageId`, `contentDelta.text`, `chatSessionId` | Find/create assistant message, append text |
| `complete` | `complete.messageId`, `complete.hasToolCalls` | Mark `streamingComplete=true`, clear `streamingMessageId` |
| `user_message` | `userMessage.id`, `userMessage.content`, `messageId` | Create user message and add to cache |

**Key insight**: The renderer doesn't care about the message source — as long as it receives a correctly formatted `StreamingChunk`, it can render.

### 4. Can ExternalAgentService directly send streamingChunk via IPC?

**Yes.** `AgentChatOutputPort.emitStreamingChunk` is essentially `webContents.send('agentChat:streamingChunk', chunk)`. `ExternalAgentService` already has the `BrowserWindow.getAllWindows()` pattern (used for `broadcastStatus`), so it can send streamingChunk the same way.

### 5. Can chatStatus be sent from ExternalAgentService?

**Yes.** `emitStatus` is essentially `webContents.send('agentChat:chatStatusChanged', {...})`. However, push messages don't need to change chatStatus to `sending` — when a bot proactively sends a message, the user side has no waiting state, just append the message directly. If a "typing" indicator is needed, a new WS message type `typing` can be used to briefly set `sending` status.

### 6. conversationId → chatId/chatSessionId mapping

Current: `conversationId` is the `chatSessionId` (passed in at `sendMessage`).

In the push model, a bot proactively sending a message needs to know which chat to send to. Options:
- Maintain a `token → chatId` mapping (the corresponding agent's chat is known at token validation time)
- Use `chatSessionStore` to get the most recent active chatSession for that chat
- Or have the bot specify `conversationId` (if it remembers a previous session)

---

## Architecture Overview

### Current Architecture (Request-Response)

```
User Input → AgentChat.streamMessage → externalAgentChatHandler
  → ExternalAgentService.sendMessage → WS → Bot
  → Bot replies → WS reply/reply_end → handler promise resolves
  → AddMessageToSession + emitStreamingChunk → Renderer
```

### New Architecture (Push Model)

**Send Path (user→Bot, unchanged):**
```
User Input → AgentChat.streamMessage → externalAgentChatHandler → WS → Bot
```

**Receive Path (Bot→user, new):**
```
Bot sends WS `push` message
  → ExternalAgentWsServer.onMessage dispatches
  → ExternalAgentService.handlePushMessage
    → Parse token → chatId mapping
    → Get/create chatSessionId
    → Send streamingChunk directly to renderer via IPC
    → Persist message via AgentChat instance or standalone path
```

---

## Detailed Changes

### 1. `src/main/lib/externalAgent/wsServer.ts`

**Add new WS message type `push`:**

```typescript
// Add to ws.on('message') handler:
} else if (msg.type === 'push') {
  // Bot proactively pushes message (no prior user message needed)
  logger.info('[ExternalAgent WS] Received push message', 'onMessage', {
    conversationId: msg.conversationId,
    textLength: msg.text?.length ?? 0
  });
  this.onPushHandler?.(msg.text, msg.conversationId, authToken!);
} else if (msg.type === 'push_end') {
  this.onPushEndHandler?.(msg.conversationId, authToken!);
}
```

**Add handler registration:**
```typescript
private onPushHandler: ((text: string, conversationId: string | undefined, token: string) => void) | null = null;
private onPushEndHandler: ((conversationId: string | undefined, token: string) => void) | null = null;

onPush(handler: (text: string, conversationId: string | undefined, token: string) => void): void {
  this.onPushHandler = handler;
}
onPushEnd(handler: (conversationId: string | undefined, token: string) => void): void {
  this.onPushEndHandler = handler;
}
```

### 2. `src/main/lib/externalAgent/externalAgentService.ts`

**Add push message handling + token→chat mapping:**

```typescript
import { chatSessionStore } from '../chat/chatSessionStore';

// New field
private tokenToChatId = new Map<string, string>(); // built during token validation

// In start()'s setTokenValidator, cache the mapping on successful validation:
this.wsServer.setTokenValidator((token) => {
  const profile = profileCacheManager.getCachedProfile(alias);
  if (!profile) return false;
  const chat = profile.chats.find(
    c => c.agent?.source === 'EXTERNAL' && c.agent?.authToken === token
  );
  if (chat) {
    this.tokenToChatId.set(token, chat.chat_id);
    return true;
  }
  return false;
});

// Register push handler
this.wsServer.onPush((text, conversationId, token) => {
  this.handlePushMessage(text, conversationId, token);
});
this.wsServer.onPushEnd((conversationId, token) => {
  this.handlePushEnd(conversationId, token);
});

// Core methods
private pushState = new Map<string, { msgId: string; accumulated: string }>();

private async handlePushMessage(text: string, conversationId: string | undefined, token: string): Promise<void> {
  const chatId = this.tokenToChatId.get(token);
  if (!chatId || !this.alias) return;

  // Resolve target chatSession
  const chatSessionId = conversationId || await this.getActiveChatSessionId(chatId);
  if (!chatSessionId) return;

  // Get or create push state
  const key = `${chatId}:${chatSessionId}`;
  if (!this.pushState.has(key)) {
    this.pushState.set(key, { msgId: `msg_push_${Date.now()}`, accumulated: '' });
  }
  const state = this.pushState.get(key)!;
  state.accumulated += text;

  // Send streamingChunk directly to all renderer windows
  const chunk: StreamingChunk = {
    chunkId: `chunk_${Date.now()}_push`,
    messageId: state.msgId,
    chatId,
    chatSessionId,
    timestamp: Date.now(),
    type: 'content',
    contentDelta: { text },
  };

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agentChat:streamingChunk', chunk);
    }
  }
}

private async handlePushEnd(conversationId: string | undefined, token: string): Promise<void> {
  const chatId = this.tokenToChatId.get(token);
  if (!chatId || !this.alias) return;

  const chatSessionId = conversationId || await this.getActiveChatSessionId(chatId);
  if (!chatSessionId) return;

  const key = `${chatId}:${chatSessionId}`;
  const state = this.pushState.get(key);
  if (!state) return;

  // Send complete chunk
  const completeChunk: StreamingChunk = {
    chunkId: `chunk_${Date.now()}_complete`,
    messageId: state.msgId,
    chatId,
    chatSessionId,
    timestamp: Date.now(),
    type: 'complete',
    complete: { messageId: state.msgId, hasToolCalls: false },
  };

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agentChat:streamingChunk', completeChunk);
    }
  }

  // Persist message
  await this.persistPushMessage(chatId, chatSessionId, state.msgId, state.accumulated);

  this.pushState.delete(key);
}

private async getActiveChatSessionId(chatId: string): Promise<string | null> {
  if (!this.alias) return null;
  const result = await chatSessionStore.getChatSessionsProjection(this.alias, chatId);
  if (result.sessions.length === 0) return null;
  // Return the most recent session
  return result.sessions[result.sessions.length - 1].chatSession_id;
}

private async persistPushMessage(chatId: string, chatSessionId: string, msgId: string, text: string): Promise<void> {
  // Option A: Get AgentChat instance via AgentChatManager and call AddMessageToSession
  // Option B: Directly operate on chatSessionStore (more decoupled but requires handling file locking)
  // Recommended Option A:
  const { agentChatManager } = await import('../chat/agentChatManager');
  const agentChat = agentChatManager.getRegistry().getInstance(chatSessionId);
  if (agentChat) {
    const msg = MessageHelper.createTextMessage(text, 'assistant', msgId);
    // Need to expose addMessageToSession or add a new public method
    await agentChat.addPushMessage(msg);
  } else {
    // Instance doesn't exist (user hasn't opened this chat), write directly to file
    await chatSessionStore.appendMessage(this.alias!, chatId, chatSessionId, {
      id: msgId,
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    });
  }
}
```

### 3. `src/main/lib/chat/agentChat.ts`

**Add public method for push message persistence:**

```typescript
/**
 * Add a push message from external agent (no user message trigger needed).
 * Used by ExternalAgentService for bot-initiated messages.
 */
async addPushMessage(message: Message): Promise<void> {
  await this.AddMessageToSession(message);
}
```

### 4. `src/shared/ipc/externalAgent.ts`

No new IPC events needed. Push messages reuse the existing `agentChat:streamingChunk` and `agentChat:chatStatusChanged` events.

### 5. `src/main/lib/chat/externalAgentChatHandler.ts`

**No changes needed.** The existing request-response flow remains unchanged. Push is an independent path.

### 6. `src/renderer/lib/chat/agentChatSessionCacheManager.ts`

**No changes needed.** The renderer can already handle `streamingChunk` from any source, as long as the format is correct.

### 7. `src/main/lib/userDataADO/profileCacheManager.ts`

May need to add a method or verify that `chatSessionStore.appendMessage` exists. If it doesn't exist, add it to `chatSessionStore`:

```typescript
async appendMessage(alias: string, chatId: string, chatSessionId: string, message: Message): Promise<void> {
  const sessionFile = await this.loadChatSession(alias, chatId, chatSessionId);
  if (sessionFile) {
    sessionFile.chat_history.push(message);
    await this.saveChatSession(alias, chatId, sessionFile);
  }
}
```

### 8. `src/main/lib/chat/chatSessionStore.ts` (may need addition)

Add `appendMessage` method for offline persistence when the AgentChat instance doesn't exist.

---

## Data Structures and Session Mapping Strategy

### Token → Chat Mapping

```
token (bot auth token)
  → chatId (matched from profile.chats by agent.authToken)
    → chatSessionId (get the most recent session from chatSessionStore, or specified by bot as conversationId)
```

### Push State

```typescript
interface PushMessageState {
  msgId: string;         // ID of the current push message
  accumulated: string;   // Accumulated text content
  startTime: number;     // Timeout protection
}
// Map key: `${chatId}:${chatSessionId}`
```

### New WS Protocol Message Types

Bot → Kosmos:
```json
{ "type": "push", "text": "chunk of text", "conversationId": "optional_session_id" }
{ "type": "push_end", "conversationId": "optional_session_id" }
```

---

## Edge Case Handling

| Scenario | Handling |
|------|---------|
| Bot push but user hasn't opened that chat | No chatSessionId in renderer cache, chunk is ignored. But message is still persisted to disk. Loaded from file when user opens it. Need to send unread marker. |
| Bot push but AgentChat instance not initialized | Use chatSessionStore to write directly to file for persistence |
| Bot push while user is sending message (race condition) | Push and request-response use different messageIds, no conflict. But chatStatus may need coordination — push doesn't change chatStatus |
| push_end timeout not received | Set push state TTL (e.g., 5 minutes), auto-flush and persist accumulated content on timeout |
| Token expired (user deleted the agent) | tokenToChatId mapping will fail on next token validation, push is ignored |
| Multiple renderer windows | Broadcast using `BrowserWindow.getAllWindows()`, consistent with existing `broadcastStatus` |
| conversationId is empty | Automatically use the most recent chatSession for that chat |
| Bot pushes to a chat the user has never conversed in | Need to create chatSession first. Can use `agentChatManager.initializeChatSession` or directly create a session file |

---

## Minimum Viable Changes (MVP)

**Goal**: Enable bots to proactively push messages and display them in the UI, with 4 file changes.

1. **`wsServer.ts`** — Add `push` / `push_end` message handling + handler registration (~30 lines)
2. **`externalAgentService.ts`** — Add `handlePushMessage` / `handlePushEnd` / `persistPushMessage` + token→chatId mapping (~100 lines)
3. **`agentChat.ts`** — Add `addPushMessage` public method (~5 lines)
4. **`chatSessionStore.ts`** (if needed) — Add `appendMessage` (~10 lines)

**Not needed:**
- renderer (already compatible)
- externalAgentChatHandler (request-response path unchanged)
- IPC type definitions (reuse existing streamingChunk events)
- profileCacheManager

**Not included in MVP** (future iterations):
- Unread marking (bot push messages marked as unread)
- Typing indicator (bot sends `typing` → brief `sending` status)
- Push state timeout cleanup
- Notifications (system notifications / sound)
- Bot ability to create new chatSession

---

## Implementation Order

1. `wsServer.ts` — Protocol layer support
2. `externalAgentService.ts` — Business logic
3. `agentChat.ts` — Persistence entry point
4. Test: use wscat to simulate bot sending push messages, verify UI display
5. Iterate: unread, typing, timeout protection
