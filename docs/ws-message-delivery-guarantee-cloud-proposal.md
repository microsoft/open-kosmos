# WebSocket Message Delivery Guarantee Proposal: Cloud Relay

## 1. Problem Background

Same as [ws-message-delivery-guarantee-proposal.md](ws-message-delivery-guarantee-proposal.md) §1.

Core contradiction: OpenKosmos Desktop is the ultimate persistence endpoint for messages, but it is a desktop app that can be closed at any time. Bot replies have nowhere to go.

## 2. Proposal Overview

Introduce the OpenKosmos Cloud Relay service as a message relay and persistence layer. The Bot delivers to the cloud (always online), and the Desktop pulls/syncs from the cloud.

```
Bot (OpenClaw)                 OpenKosmos Cloud                    OpenKosmos Desktop
┌─────────────┐   REST POST   ┌──────────────────┐   WS/SSE   ┌─────────────┐
│ plugin.ts   │──────────────►│ Message Store    │◄──────────►│ Pull + Sync │
│             │               │ (persistent,     │            │ (view only) │
└─────────────┘               │  always online)  │            └─────────────┘
                               └──────────────────┘
```

This is the standard architecture used by Discord, Slack, and Telegram. Message delivery reliability no longer depends on whether the client is online.

## 3. Industry Comparison

| | Discord | Slack | OpenKosmos Cloud (this proposal) |
|---|---------|-------|------------------------------|
| Bot delivery method | REST POST `/channels/{id}/messages` | REST POST `chat.postMessage` | REST POST `/api/messages` |
| Persistence | Discord cloud | Slack cloud | OpenKosmos Cloud |
| Client message retrieval | Gateway WS push + REST pull | RTM WS push + REST pull | WS push + REST pull |
| Offline messages | Retained in cloud, pushed via Gateway when back online | Retained in cloud, pulled when back online | Retained in cloud, synced when back online |
| ACK / seq mechanism | Not needed (REST stateless) | Not needed | Not needed |

## 4. Architecture Design

### 4.1 Components

```
┌─────────────────────────────────────────────────────────┐
│ OpenKosmos Cloud                                            │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ REST API    │  │ Message Store│  │ Push Gateway  │  │
│  │ (receive    │  │ (persistent) │  │ (real-time    │  │
│  │  delivery)  │  │              │  │  push)        │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│         └────────────────┴───────────────────┘          │
└─────────────────────────────────────────────────────────┘
         ▲ REST POST                    │ WS/SSE
         │                              ▼
   ┌─────┴─────┐                 ┌──────────────┐
   │ Plugin    │                 │ OpenKosmos       │
   │ (Bot side)│                 │ Desktop      │
   └───────────┘                 └──────────────┘
```

**REST API** — Receives messages delivered by the Bot, writes to Message Store, notifies Push Gateway.

**Message Store** — Message persistence. Organized by account + conversation. Supports time/cursor-based paginated queries.

**Push Gateway** — When Desktop is online, pushes new messages in real time via WS or SSE. When Desktop is offline, no push occurs; messages wait in the Store.

### 4.2 Message Delivery Flow (Bot → Desktop)

```
1. Bot finishes processing user request and generates a reply
2. Plugin calls REST API: POST /api/messages
   {
     accountId: "xxx",
     conversationId: "conv-1",
     text: "bot reply",
     role: "assistant"
   }
3. Cloud REST API:
   a. Writes to Message Store (returns 200 only after successful persistence)
   b. Returns { messageId, timestamp }
   c. Notifies Push Gateway of new message
4. Push Gateway:
   a. Checks if the account's Desktop is online (has an active WS connection)
   b. Online → push { type: "new_message", messageId, conversationId, text }
   c. Offline → do nothing (message is already in the Store)
5. Desktop:
   a. Online: receives push, updates UI + local cache
   b. Offline → comes online: pulls messages since lastSyncTimestamp, merges to local
```

### 4.3 Message Delivery Flow (Desktop → Bot)

```
1. User types a message in Desktop
2. Desktop calls REST API: POST /api/messages
   { accountId, conversationId, text, role: "user" }
3. Cloud persists + pushes to Plugin via Push Gateway
4. Plugin receives and hands off to OpenClaw for processing
```

### 4.4 Streaming Replies

Bot replies are typically LLM streaming output. Two approaches:

**Option A: Cloud aggregation before delivery (simple)**

```
Plugin accumulates LLM streaming output locally
After completion, POSTs /api/messages in one shot (full text)
Desktop receives the complete message
```

- Pros: Simplest approach; Cloud only handles complete messages
- Cons: User doesn't see the streaming typewriter effect (acceptable for external agents — user may not be watching)

**Option B: Streaming relay (better experience)**

```
Plugin → Cloud: POST /api/streams { accountId, conversationId }
  Returns { streamId }

Plugin → Cloud: POST /api/streams/{streamId}/chunks  (sent one by one)
  { text: "chunk content" }
Cloud → Desktop: WS push { type: "stream_chunk", streamId, text }

Plugin → Cloud: POST /api/streams/{streamId}/end
Cloud: Aggregates all chunks into a complete message, writes to Message Store
Cloud → Desktop: WS push { type: "stream_end", streamId, messageId }
```

- Pros: Preserves streaming experience
- Cons: Higher complexity; Cloud must manage stream state

**Recommendation**: Implement Option A first, add Option B later as needed. External agent replies typically happen in the background (the user may have switched away after sending a message), so streaming UX is not a core requirement.

### 4.5 Desktop Sync Mechanism

Desktop needs to sync messages on startup and after recovering from offline.

```
Desktop maintains lastSyncTimestamp (per-account, persisted locally)

Sync flow:
1. Desktop starts / WS reconnect succeeds
2. GET /api/messages?accountId=xxx&after=lastSyncTimestamp&limit=100
3. Group by conversationId, merge into local chatSessionStore
4. Update lastSyncTimestamp
5. Mark conversations with new messages as unread

Incremental sync (while online):
- Push Gateway pushes new messages; Desktop writes to local in real time
- Update lastSyncTimestamp
```

### 4.6 Message IDs and Deduplication

```
Cloud generates a globally unique messageId (UUID or snowflake) for each message.
Desktop deduplicates locally using messageId — the same messageId is never written twice.
No seq, ACK, or pending queue needed.
```

### 4.7 Authentication

```
Plugin → Cloud: Uses agent authToken (consistent with existing WS auth)
Desktop → Cloud: Uses user's auth session token

Cloud validation:
- Plugin requests: verify authToken belongs to an external agent of that account
- Desktop requests: verify session token belongs to the owner of that account
```

## 5. Impact on Existing Code

### 5.1 Code That Can Be Removed

| Module | Notes |
|--------|-------|
| `wsServer.ts` | Local WS server no longer needed (Desktop no longer receives Bot messages directly) |
| `externalAgentService.ts` push handling | pushStreams, handlePushMessage, handlePushEnd no longer needed |
| `agentChatPushReceiver.ts` | No longer needed (or simplified to only handle complete messages pushed from Cloud) |
| `plugin.ts` WS client | Replaced by REST client, greatly simplified |
| Connection dedup, rate limit, generation counter | No longer needed (REST is stateless) |

### 5.2 New Code Required

| Module | Notes |
|--------|-------|
| OpenKosmos Cloud service | REST API + Message Store + Push Gateway (new project) |
| Desktop sync client | Startup sync + real-time push reception + local merge |
| Plugin REST client | Replaces existing WS client; POSTs messages to Cloud |

### 5.3 Code That Can Be Kept

| Module | Notes |
|--------|-------|
| `chatSessionStore` | Local cache layer unchanged; data source shifts from WS push to Cloud sync |
| `agentChatManager` | AgentChat instance management unchanged; message source changes |
| UI layer | Chat UI largely unchanged; data source shifts from local to local cache + Cloud |

## 6. Comparison with MQTT QoS 1 Proposal

| | MQTT QoS 1 + Seq (Plugin persistence) | Cloud Relay (this proposal) |
|---|------|------|
| Complexity (Plugin side) | High: pending queue + seq + ACK + retry | Low: REST POST, fail with error on failure |
| Complexity (OpenKosmos side) | High: seq tracking + dedup + lastSeq persistence | Medium: sync client + local merge |
| New infrastructure | None | Cloud service (requires deployment and ops) |
| Offline reliability | Depends on Plugin persistence capability (unverified) | Cloud always online, inherently reliable |
| Streaming support | Native (existing WS push mechanism) | Requires additional design (Option B) |
| Multi-device support | Not supported (messages local to single Desktop) | Native support |
| Privacy | Messages stay local | Messages pass through cloud (requires encryption or compliance review) |
| Operational cost | None | Present (Cloud service availability, monitoring, scaling) |

## 7. Decisions Pending

1. **Cloud vs. Plugin persistence?** — This is an architectural direction choice, not a technical detail. The Cloud approach is more reliable and standard, but requires infrastructure investment. The MQTT QoS 1 approach needs no new infrastructure, but reliability is limited by the Plugin's persistence capability.
2. **Priority of streaming experience** — If the typewriter effect for external agent replies is a hard requirement, the Cloud approach needs Option B (streaming relay), increasing complexity. If not a hard requirement, Option A (aggregate then deliver) is sufficient.
3. **Privacy requirements** — Can messages pass through the cloud? If there are strict data residency requirements, the Cloud approach needs additional encryption/compliance design.
4. **Timeline** — A Cloud service needs design, development, deployment, and operations. If the message loss problem needs a quick fix, the MQTT QoS 1 approach can serve as a short-term solution first, with Cloud as the long-term target.
