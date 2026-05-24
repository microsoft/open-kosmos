<!-- Last verified: 2026-04-27 -->
<!-- Updated: single-owner persistence (Discord model), connection dedup, rate limiting -->
# External Agent

> Standalone service for routing local user messages to external LLM agents via WebSocket. Discord-like model: one WS server on a fixed port, each bot authenticates with its own token. Service layer is the single owner of message persistence.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `externalAgentService.ts` | Singleton service: lifecycle (start/stop), message sending, push accumulation + persistence (single owner), status broadcast to renderer | ~214 LOC |
| `wsServer.ts` | WebSocket server: connection handling, token-based auth, per-IP auth failure blocking, connection rate limiting, connection dedup (close stale for same token), message routing | ~180 LOC |
| `externalAgentIPC.ts` | IPC handler: exposes `getConnectionInfo` (local IPs, port, status) to renderer | ~55 LOC |
| `index.ts` | Module initializer: creates singleton, auto-starts WS server on default port 9527 | ~25 LOC |

## Architecture

### Overview
```
Bot (OpenClaw)                    OpenKosmos
┌─────────────┐    WebSocket    ┌──────────────────────┐
│ plugin.ts   │◄──────────────►│ wsServer.ts          │  auth, rate limit, dedup
│ (reconnect, │                 │                      │
│  dedup)     │                 └──────┬───────────────┘
└─────────────┘                        │
                                ┌──────▼───────────────┐
                                │ externalAgentService  │  accumulate + persist
                                │ (Discord model)       │  (single owner)
                                └──────┬───────────────┘
                                       │ if AgentChat exists
                                ┌──────▼───────────────┐
                                │ agentChat.ts          │  pass-through
                                │  └─ pushReceiver      │  UI streaming + timeout
                                └──────────────────────┘
```

### Data Flow
```
User→Bot: AgentChat → externalAgentChatHandler (fire-and-forget) → ExternalAgentService.sendMessage() → wsServer → Bot

Bot→OpenKosmos: Bot push → wsServer → ExternalAgentService.handlePushMessage() (accumulate)
                                         ├─ AgentChat exists → pushReceiver streams to UI
                                         └─ AgentChat absent → accumulate only
            Bot push_end → ExternalAgentService.handlePushEnd()
                                         ├─ persist via chatSessionStore (always)
                                         ├─ AgentChat.handlePushComplete(skipPersistence=true) (UI cleanup only)
                                         └─ mark unread: AgentChat path → markChatSessionAsUnreadIfNeeded(); offline path → chatSessionStore.setReadStatus()
```

### Initialization
Lazy-loaded via `getExternalAgentService(alias)` in `src/main/startup/lazy.ts`. Triggered by `profileCacheManager` during background service initialization (gated behind `openkosmosFeatureExternalAgent` feature flag). Must not block sign-in.

### Token Model
Each external agent bot has a unique `authToken` (UUID) generated at agent creation time and stored in `profile.chats[].agent.authToken`. The WS server validates incoming tokens against all `source='EXTERNAL'` agents in the cached profile.

### Push Model (Bot→OpenKosmos) — Discord Model
External bots send `push` (streaming text chunks) and `push_end` (completion signal) WS messages.

**Single-owner persistence**: `ExternalAgentService` is the sole accumulator and persister. `AgentChatPushReceiver` handles UI only.

- `handlePushMessage`: Always accumulates to service-layer `pushStreams` Map (keyed by conversationId, stores `{ text, msgId }`). Stable `msgId` is generated on first chunk and shared with PushReceiver for streaming→persistence reconciliation. If AgentChat instance exists, also streams to UI via `pushReceiver.handlePushChunk(text, msgId)`.
- `handlePushEnd`: Takes accumulated text and msgId from `pushStreams`, persists via `chatSessionStore.patchFile` (appends to `chat_history` + `context_history`), then calls `AgentChat.handlePushComplete(skipPersistence=true)` for UI cleanup only. Marks unread: via `agentChatManager` when AgentChat exists, via `chatSessionStore.setReadStatus` when offline.

This design ensures messages survive AgentChat instance destruction (5-min idle timeout on tab switch). All 6 scenarios are covered:

| # | Scenario | Persistence | UI |
|---|----------|------------|-----|
| 1 | User stays in chat | Service persists | PushReceiver streams |
| 2 | User never opened chat | Service persists | None |
| 3 | User left <5min (AgentChat alive) | Service persists | PushReceiver streams to dormant UI |
| 4 | User left >5min (AgentChat destroyed) | Service persists | None |
| 5 | Mid-stream rejoin (AgentChat recreated) | Service persists full "ABCD" | PushReceiver streams partial "CD"; full on reload |
| 6 | AgentChat destroyed mid-stream | Service persists full "ABCD" | No UI for tail chunks |

### Reply Model
User→Bot messages are fire-and-forget via `sendMessage()`. No pending reply listener — all bot responses come through the push model. After successful send, `AgentChat` starts a 2-minute push timeout via `pushReceiver.startOrResetPushTimeout()`. If no push arrives, a timeout system message is shown.

### WS Server Protection
| Mechanism | Config | Close Code |
|-----------|--------|------------|
| Auth failure blocking | 5 consecutive failures per IP | 4008 |
| Connection rate limiting | 5 connections per 5s per IP | 4010 |
| Connection dedup | Same token reconnects close old | 4009 |
| Auth timeout | 10s to authenticate | 1008 |
| Invalid token | Single failure | 4004 |

Auth failure counter has no automatic decay — blocked IPs stay blocked until server restart.

### Bot-Side Plugin (`packages/openclaw-openkosmos-channel/src/plugin.ts`)
- Manages WebSocket lifecycle: connect → auth → receive messages → reconnect on close
- `startAccount` holds its promise open until abort signal (prevents gateway auto-restart)
- `sendReply/sendReplyEnd/sendError` use `activeClients.get(accountId)` (not captured `ws`) to survive reconnects
- Close handler only deletes from `activeClients` if `this` ws is still the active one
- Handles close codes: 4004 (stop), 4009 (stop, replaced), 4010 (backoff)
- Reconnect: exponential backoff with jitter, 1s–30s range. Generation counter prevents stale close handlers from triggering reconnect after fresh-start

### Status Broadcasting
Connection/disconnection events are broadcast to all BrowserWindows via `mainToRender.statusChanged`. The renderer `ExternalAgentConnectionConfig` component subscribes for real-time status display.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change WS port | `index.ts` (DEFAULT_EXTERNAL_AGENT_PORT), `externalAgentIPC.ts` (DEFAULT_EXTERNAL_AGENT_PORT) | Keep both in sync |
| Add new WS message types | `wsServer.ts` (message handler), `externalAgentService.ts` (push routing) | Update `packages/openclaw-openkosmos-channel/src/types.ts` if plugin sends them |
| Change auth model | `wsServer.ts` (token validator), `externalAgentService.ts` (setTokenValidator callback) | Profile schema stores token in `chat.agent.authToken` |
| Change IPC contract | `src/shared/ipc/externalAgent.ts`, `externalAgentIPC.ts`, `src/preload/externalAgent/invoke.ts` | All three must stay in sync |
| Change push persistence | `externalAgentService.ts` (persistPushMessage) | Single owner — do NOT add persistence to AgentChatPushReceiver |
| Change WS protection (rate limit, dedup) | `wsServer.ts` | Update `packages/openclaw-openkosmos-channel/src/plugin.ts` close code handling |

## Gotchas
- **Single persistence owner**: `ExternalAgentService` is the sole persister for push messages. `AgentChatPushReceiver.handlePushComplete(skipPersistence=true)` must always be called with `true` from the service layer. The only path where `skipPersistence=false` fires is the 2-minute timeout safety net in PushReceiver itself.
- The WS server uses `readyState === 1` (numeric) instead of `WebSocket.OPEN` constant because the `ws` library constant is not always available at bundle time.
- `ExternalAgentService` is a singleton. `start()` is guarded by a `starting` flag to prevent duplicate WS servers from concurrent calls.
- Reply listeners no longer exist. The push model (`push`/`push_end`) replaced the old request-reply (`reply`/`reply_end`) pattern.
- `agentChatManager` is statically imported (not dynamic import). All 15+ consumers use static import.
- Bot-side plugin `sendReply` closures must use `activeClients.get()` not the captured `ws` variable — the captured ref goes stale after reconnect.
- Bot-side `startAccount` must hold its promise open. If it resolves, gateway sets `running=false` and triggers auto-restart loop.

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| WS message protocol | `packages/openclaw-openkosmos-channel/src/types.ts`, `src/main/lib/chat/externalAgentChatHandler.ts`, `src/main/lib/chat/agentChatPushReceiver.ts` |
| Push persistence logic | `externalAgentService.ts` only — single owner. Do NOT add persistence to `agentChatPushReceiver.ts` |
| WS close codes | `wsServer.ts`, `packages/openclaw-openkosmos-channel/src/plugin.ts` (close handler) |
| IPC contract types | `src/shared/ipc/externalAgent.ts`, `src/preload/externalAgent/invoke.ts`, `src/renderer/ipc/externalAgent.ts` |
| Feature flag name | `src/main/lib/featureFlags/featureFlagDefinitions.ts`, `src/main/lib/userDataADO/profileCacheManager.ts` |
| Profile schema (authToken) | `src/main/lib/userDataADO/types/profile.ts`, `src/main/lib/userDataADO/profileSanitizer.ts` |

## Related
- Depends on: [UserDataADO](../userDataADO/), [FeatureFlags](../featureFlags/), [UnifiedLogger](../unifiedLogger/), [ChatSessionStore](../chat/chatSessionStore.ts)
- Depended by: [Chat Engine](../chat/ai.prompt.md) (`externalAgentChatHandler.ts`, `agentChatPushReceiver.ts`), [Renderer ExternalAgentConnectionConfig](../../../renderer/components/chat/agent-editor/)
- Bot-side plugin: [openclaw-openkosmos-channel](../../../../packages/openclaw-openkosmos-channel/)
