<!-- Last verified: 2026-04-10 -->
# Remote Channel

> Enables external messaging channels (remote IM platform and future platforms) to interact with local OpenKosmos agents via a plugin-based WebSocket relay architecture.

## Key Files

| File | Responsibility | Size |
|------|---------------|------|
| `index.ts` | Module entry: instantiates singleton manager and registers the Teams plugin | 16 |
| `types.ts` | Core plugin contract and canonical attachment union types: `InboundAttachment`, `InboundMessage`, `RemoteChannelPlugin`, etc. | 82 |
| `channelManager.ts` | Singleton orchestrator: plugin registry, channel lifecycle state machine (start/stop/restart), inbound message dedup (LRU, max 1000), outbound chunking | 315 |
| `remoteChannelIPC.ts` | IPC handlers (getConfig, updateConfig, start, stop, getStatus, getAllStatus, bind, unbind, getBindingStatus) and status/binding broadcasters | 170 |
| `credentialStore.ts` | `credentialStore` object: read/write/delete/check credentials encrypted via `electron.safeStorage`; stored as `.enc` files under `{userData}/profiles/{alias}/credentials/` | 60 |
| `agentBridge/index.ts` | Singleton: maps `channelId:userId` keys to local chat sessions, per-session serialization locks, concurrency limit (max 3), attachment content assembly and cleanup scheduling | 370 |
| `agentBridge/attachmentPipeline.ts` | Attachment pipeline: secure filename sanitization, HTTPS-only download, per-session directory storage, bounded-parallel downloads, content-part mapping, supports bearer-auth inline image download, image first-pass compression + 10MB inline guard, image immediate cleanup, session-lifecycle cleanup | 360 |
| `agentBridge/commandHandlers.ts` | Dot-command dispatch: `.new`, `.switch`, `.agent`, `.skill` — resolved before consuming a concurrency slot | 394 |
| `agentBridge/sessionLifecycle.ts` | Session state transitions: `demoteSession`, `demoteOrphanedSessions` (startup scan), `registerRemoteSession`, `markSessionAsRemote`, title updates | 188 |
| `agentBridge/sessionPersistence.ts` | Load/save sessionMap as JSON, 500ms debounce via `createPersistScheduler`, startup pruning | 83 |
| `teams/plugin.ts` | `RemoteChannelPlugin` factory for remote IM; holds `RelayServiceClient` in closure; maps WebSocket statuses to `ChannelStatus` | 144 |
| `teams/wsClient.ts` | `RelayServiceClient`: WebSocket auth handshake (10s timeout), heartbeat (30s interval / 90s timeout), exponential-backoff reconnect (max 30s), bind/unbind with 30s promise timeout | 306 |

## Architecture

```
Renderer ──IPC──► remoteChannelIPC.ts
                        │
                        ▼
              RemoteChannelManager (singleton)
               ├─ Plugin registry (Map)
               ├─ Dedup (activityId, LRU 1000)
               └─ Chunking (textChunkLimit per plugin)
                        │ onInboundMessage
                        ▼
                  AgentBridge (singleton)
               ├─ sessionMap: "channelId:userId" → { chatId, chatSessionId, lastActiveAt }
               ├─ Per-session Promise chain (serialization)
               ├─ Concurrency semaphore (max 3; excess queued, never dropped)
               ├─ Dot-command interception (no concurrency slot)
               └─ agentChatManager.streamMessage(...)
                        │ response text
                        ▼
              RemoteChannelManager (chunking)
                        │ sendText chunks
                        ▼
             Plugin.outbound.sendText(...)
                        │ WebSocket reply
                        ▼
```

**Plugin interface** (`RemoteChannelPlugin`): each plugin exposes `config` (isConfigured/isEnabled), `gateway` (start/stop/bind/unbind), and `outbound` (sendText/sendProactive/sendTyping + `textChunkLimit`). Teams uses a factory function (`createTeamsPlugin`) to scope the `RelayServiceClient` instance in a closure.

**Session lifecycle**: remote sessions carry `source: { type: 'remote', channel }` in their metadata. On unbind or channel stop, `demoteSession` clears `source`, reverting them to ordinary local sessions. On app startup, `demoteOrphanedSessions` scans all chat sessions and demotes any remote sessions not present in the persisted `sessionMap`.

**Credentials**: binding tokens are encrypted with `electron.safeStorage` (platform keychain on macOS/Windows, libsecret on Linux). They are never stored in `profile.json`.

## Common Changes

| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new channel plugin (e.g. Slack) | `types.ts` (if new types needed), new `slack/plugin.ts`, `index.ts` (register) | Implement `RemoteChannelPlugin`; follow Teams factory pattern |
| Modify `.new` / `.switch` / `.agent` / `.skill` command behavior | `agentBridge/commandHandlers.ts` | Commands bypass the concurrency semaphore |
| Modify remote session title updates | `agentBridge/sessionLifecycle.ts` + `chat/agentChatManager.ts` | Keep persisted title changes and any active `AgentChat` runtime title synchronized |
| Adjust remote attachment download/cleanup policy | `agentBridge/attachmentPipeline.ts`, `agentBridge/index.ts` | HTTPS-only download, max 10 attachments, 50MB per file, image first-pass compression + 10MB inline guard, image immediate cleanup + session-lifecycle directory cleanup |
| Change concurrent LLM request limit | `agentBridge/index.ts` — `MAX_CONCURRENCY` constant | Messages over the limit are queued, not rejected |
| Change session TTL or pruning logic | `agentBridge/sessionPersistence.ts`, `agentBridge/types.ts` (`SESSION_TTL`) | Adjust `SESSION_TTL`; no TTL-based cleanup exists for idle sessions currently |
| Update IPC surface (add/remove handlers) | `remoteChannelIPC.ts` + `src/shared/ipc/remoteChannel.ts` | IPC contract is defined in shared; both sides must stay in sync |
| Adjust WebSocket heartbeat or reconnect timing | `teams/wsClient.ts` — top-level constants | `HEARTBEAT_INTERVAL`, `HEARTBEAT_TIMEOUT`, `MAX_RECONNECT_DELAY`, `AUTH_TIMEOUT` |

## Gotchas

- **Concurrency limit (3)**: messages from a given user beyond the limit are queued (not dropped), but the queue can grow without bound under sustained load.
- **Session persistence is debounced 500ms**: a crash between a session map mutation and the scheduled write will lose the latest mapping; the orphan-demotion sweep on next startup is the recovery path.
- **Session map and attachment cleanup are separate**: `SESSION_TTL` still gates `getOrCreateSession`; remote attachments rely on image immediate cleanup plus chat-session deletion cleanup (`chatSessionStore.deleteSession`) and session-lifecycle directory cleanup (no background TTL sweep).
- **Remote session rename is not store-only**: `updateRemoteSessionTitle` must keep any active `AgentChat` runtime title in sync with `chatSessionStore.renameSession(...)`, or the next chat-session save can revert the renamed title.
- **Remote image context budget guard**: image attachments use first-pass compression and a 10MB inline cutoff; oversized images are downgraded to a textual notice instead of embedding base64.
- **Attachment URL is unified**: both file and inline-image attachments use `url`; only inline-image carries required `token` for authenticated download.
- **Credentials require platform encryption**: `safeStorage.isEncryptionAvailable()` can return `false` in headless/CI environments; `credentialStore` will throw on write and silently return `null` on read.
- **IPC contract lives in `@shared/ipc/remoteChannel`**: changes to handler signatures must be reflected there (type-checked at compile time via `connectRenderToMain`).
- **Attachment schema has a single source of truth**: Teams `ForwardedAttachment` aliases `InboundAttachment` from `types.ts`; avoid redefining per-plugin attachment unions.
- **Teams plugin is a factory, not a class**: `createTeamsPlugin` closes over `wsClient`; calling it twice produces two independent instances. `index.ts` calls it exactly once.
- **Auth failure is non-terminal**: `onAuthFailed` clears stale credentials and lets the WebSocket close event trigger exponential-backoff reconnect (not an immediate hard stop).

## Related

- Depends on: [Chat Engine](../chat/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md)
- IPC contract: [IPC Framework](../../../../shared/ipc/ai.prompt.md)
