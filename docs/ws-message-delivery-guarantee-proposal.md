# WebSocket Message Delivery Guarantee Proposal

## 1. Problem Background

Kosmos (Electron desktop app) communicates with external agents (OpenClaw, Hermes, etc.) via WebSocket:

- **Kosmos is the WS server** (local port 9527), agent plugins are WS clients
- Agents deliver bot replies to Kosmos via `push` / `push_end` messages
- **Problem**: When the user closes Kosmos or the network disconnects, the WS connection is interrupted and the agent's reply messages are lost. Users cannot see bot replies from the offline period after reopening Kosmos.

### Current Behavior

```
User sends message → Kosmos WS → Plugin → OpenClaw processes → Plugin sends push → WS disconnects → message lost
                                                                    ↑
                                                              plugin only logs warn, doesn't throw
                                                              OpenClaw thinks delivery succeeded
```

### Fundamental Difference from Discord

| | Discord | Kosmos |
|---|---------|--------|
| Delivery method | REST API (HTTP POST) | WebSocket push |
| Persistence | Discord cloud server | Client local disk |
| Availability | Always online | Desktop app, can close at any time |
| Disconnect impact | None (REST is stateless) | Message loss |

---

## 2. Industry Research

### 2.1 Discord Gateway RESUME

Discord clients receive event streams via WebSocket and use seq + session_id + RESUME for reconnection recovery:

- **Each event carries `s` (sequence number)**, monotonically increasing
- Client records the last received `s`
- After disconnect, sends `RESUME { token, session_id, seq: lastSeq }`
- Server replays events with `seq > lastSeq` from the replay buffer
- **Replay buffer is limited** (approximately 500 entries or a few minutes); beyond that, returns `INVALID_SESSION`, requiring the client to fully re-IDENTIFY
- **session_id has an expiration time** (expires after approximately 30 seconds without heartbeat)

**Pros**: Simple, mature, well-suited for event streams  
**Cons**: Replay buffer is limited, cannot recover from long-term disconnections  
**Suitable for**: Real-time event streams, brief disconnections

### 2.2 Slack RTM (Real Time Messaging)

- Each message carries a `reply_to` id, allowing the client to confirm whether a message has been processed
- After disconnect, reconnects via `rtm.connect`
- **Does not support RESUME** — after disconnect, must call the Web API (`conversations.history`) to fetch missed messages
- Hybrid mode: WS for real-time push, REST API for history backfill

**Pros**: REST fallback, resilient to disconnections  
**Cons**: Requires additional HTTP API  
**Suitable for**: Scenarios with cloud storage fallback

### 2.3 Telegram MTProto

- Each message has a unique `msg_id` (timestamp-based)
- Client fetches updates during disconnection via `updates.getDifference(pts, date, qts)`
- Server maintains complete message history
- **Acknowledgment mechanism**: `msgs_ack` message confirms receipt

**Pros**: Reliable, supports recovery from arbitrary-length disconnections  
**Cons**: Depends on complete server-side storage, high complexity  
**Suitable for**: IM systems where messages must not be lost

### 2.4 MQTT QoS

- **QoS 0**: At most once (fire-and-forget) — our current state
- **QoS 1**: At least once (send → ACK, resend if no ACK) — **most suitable for us**
- **QoS 2**: Exactly once (four-way handshake) — overly complex

QoS 1 flow:
```
Sender: PUBLISH(msgId=1) → store in pending queue
Receiver: receives → processes → replies PUBACK(msgId=1)
Sender: receives PUBACK → remove from pending queue
Sender: no PUBACK received → resend after reconnect
```

**Pros**: Simple, reliable, industry standard  
**Cons**: May deliver duplicates (receiver must deduplicate)  
**Suitable for**: IoT, message push — **matches our scenario very well**

### 2.5 Solution Comparison

| Solution | Complexity | Reliability | Dependencies | Suitable for Us? |
|------|--------|--------|------|-----------|
| Discord RESUME (seq + replay buffer) | Medium | Medium (buffer limited) | None | ⭐⭐⭐ |
| Slack hybrid (WS + REST backfill) | High | High | Requires REST API | ⭐⭐ |
| Telegram (full server-side storage) | High | Highest | Server storage | ⭐ |
| MQTT QoS 1 (ACK + resend) | Low | High | None | ⭐⭐⭐⭐ |

---

## 3. Recommended Solution: MQTT QoS 1 Style + Seq Tracking

Combining MQTT QoS 1's ACK resend mechanism with Discord's seq tracking to design a lightweight message delivery guarantee solution.

### Core Principles

1. **Sender (Plugin) persistence** — persist message to disk before sending, only clear after ACK
2. **Receiver (Kosmos) acknowledgment** — send ACK upon receiving a message
3. **Resend on reconnect** — resend unACK'd messages after reconnection
4. **Receiver deduplication based on seq** — messages with `seq <= lastReceivedSeq` are ACK'd without reprocessing

---

## 4. Detailed Technical Design

### 4.1 WS Protocol Changes

#### New Message Types (Client → Server, i.e., Plugin → Kosmos)

Existing messages remain unchanged; add `seq` and `msgId` fields:

```typescript
// Change: push message adds seq
interface PushMessage {
  type: 'push';
  text: string;
  conversationId: string;
  seq: number;        // New: monotonically increasing sequence number (per-account)
}

// Change: push_end message adds seq
interface PushEndMessage {
  type: 'push_end';
  conversationId: string;
  seq: number;        // New
}
```

#### New Message Types (Server → Client, i.e., Kosmos → Plugin)

```typescript
// New: message acknowledgment
interface AckMessage {
  type: 'ack';
  seq: number;        // Confirms the seq received
}

// New: return lastSeq on successful authentication
interface AuthSuccessMessage {
  type: 'auth_success';
  lastSeq?: number;   // New: the last seq Kosmos recorded (for resume)
}
```

#### New Message Types (Client → Server, optional)

```typescript
// New: actively request resume (optional, auth_success already includes lastSeq)
interface ResumeMessage {
  type: 'resume';
  lastSeq: number;    // Client requests resend from after this seq
}
```

### 4.2 Plugin-Side Changes (WS Client)

#### Seq Management

```
Each account maintains an incrementing seq counter (starting at 0)
Increment seq++ each time push/push_end is sent
Persist seq to disk (to avoid reset on restart)
```

#### Persistent Queue (Pending Queue)

```
Data structure: Map<seq, { type, text, conversationId, msgId, timestamp }>
Storage location: jsonl file under OpenClaw data directory (per-account)
                  e.g.: ~/.openclaw/plugins/kosmos/pending-<accountId>.jsonl

Lifecycle:
  1. Before sending: write message to pending queue
  2. Sent successfully + received ACK: remove from pending queue
  3. WS disconnects: pending queue remains on disk
  4. After reconnect: read pending queue, compare with Kosmos's returned lastSeq, resend messages with seq > lastSeq
```

#### Reconnect Resend Logic

```
1. WS connection established
2. Send auth { token }
3. Receive auth_success { lastSeq: N }
4. Find messages in pending queue with seq > N
5. Resend them one by one in seq order
6. Wait for ACK before sending the next one (serial resend to avoid out-of-order)
7. Enter normal mode after all resends are complete
```

### 4.3 Kosmos-Side Changes (WS Server)

#### Seq Tracking

```
Each authenticated connection (per-token) maintains lastReceivedSeq
When receiving push/push_end:
  - If msg.seq <= lastReceivedSeq: duplicate message, send ack but don't process
  - If msg.seq == lastReceivedSeq + 1: normal processing, update lastReceivedSeq, send ack
  - If msg.seq > lastReceivedSeq + 1: seq gap, return error { seq, reason: 'seq_gap' }, don't process
    (Plugin should resend in order from pending queue upon receiving seq_gap)
```

#### lastSeq Persistence

```
Storage location: chatSessionStore or a dedicated seq-tracking file
                  e.g.: ~/.kosmos/external-agents/<agentId>/last-seq.json

Content: { lastReceivedSeq: number, updatedAt: timestamp }

Timing: write to disk each time lastReceivedSeq is updated
```

#### Resume Handling

```
On successful authentication:
  1. Read lastReceivedSeq for that token
  2. Return auth_success { lastSeq: lastReceivedSeq }
  3. Plugin decides whether to resend based on lastSeq
```

#### Deduplication

```
Deduplicate based on seq: messages with seq <= lastReceivedSeq are ACK'd directly without reprocessing.
No additional msgId deduplication mechanism needed, since seq is monotonically increasing and persisted per-account.
```

### 4.4 Persistence Strategy

| Data | Storage Location | Format | Expiry Policy |
|------|---------|------|---------|
| Plugin pending queue | `~/.openclaw/plugins/kosmos/pending-<accountId>.jsonl` | JSONL | Delete after ACK; auto-clean entries older than 24h |
| Plugin seq counter | `~/.openclaw/plugins/kosmos/seq-<accountId>.json` | JSON | Never expires |
| Kosmos lastReceivedSeq | `~/.kosmos/external-agents/<agentId>/last-seq.json` | JSON | Never expires |

### 4.5 Edge Case Handling

#### Duplicate Messages
- Plugin uses the same seq when resending
- Kosmos deduplicates via `seq <= lastReceivedSeq`
- Deduplication is entirely based on seq, no additional ID mechanism needed

#### Out-of-Order Messages
- In normal mode, seq is strictly increasing, no out-of-order possible
- In resend mode, messages are sent serially, no out-of-order possible
- If a gap occurs (seq jump), Kosmos returns seq_gap error and Plugin resends in order

#### Seq Overflow
- Uses JavaScript number (max safe integer 2^53 - 1 ≈ 9×10^15)
- At 100 messages per second, usable for approximately 2.85 million years — no overflow handling needed

#### Plugin Restart
- seq counter restored from disk
- pending queue restored from disk
- Normal resume flow after reconnect

#### Kosmos Restart
- lastReceivedSeq restored from disk
- Plugin reconnects after restart, follows normal resume flow

#### Multiple Agents Concurrently
- seq and pending queue are per-account, different agents don't affect each other
- Kosmos-side lastReceivedSeq is also per-token

#### Oversized Messages
- pending queue entries exceeding a certain size (e.g., 1MB) are truncated or rejected
- Consistent with existing textChunkLimit

---

## 5. Impact Assessment on Existing Code

### Plugin Side (`packages/openclaw-kosmos-channel/src/plugin.ts`)

| Change | Scope | Complexity |
|------|---------|--------|
| Add seq field to push/push_end messages | `sendReply`, `sendReplyEnd`, `sendText` | Low |
| Add new PendingQueue class | New file | Medium |
| Add new SeqCounter class | New file | Low |
| Add lastSeq handling to auth_success | `ws.on('message')` | Low |
| Add replay logic after reconnect | `connect()` function | Medium |
| ACK handling | `ws.on('message')` | Low |

### Kosmos Side

| File | Changes | Complexity |
|------|------|--------|
| `wsServer.ts` | Parse seq, send ACK, return lastSeq in auth_success, seq gap detection | Medium |
| `externalAgentService.ts` | Seq tracking, deduplication, lastSeq persistence | Medium |
| `types.ts` (new or modified) | Add seq field to message types | Low |

### Backward Compatibility

- seq and msgId fields are required
- Messages without these fields are treated as protocol errors; return error and close connection
- Plugin and Kosmos must be upgraded simultaneously

---

## 6. Implementation Priority

| Phase | Content | Value |
|------|------|------|
| P0 | Plugin-side pending queue + reconnect resend | Solves the core message loss problem |
| P0 | Kosmos-side ACK + lastSeq persistence + seq deduplication | Works with Plugin resend |
| P1 | Expiry cleanup, monitoring metrics | Operational observability |

---

## 7. Feasibility Investigation Conclusions (2026-04-28)

### 7.1 Plugin-Side Disk Persistence: Feasible, but Requires Agreement

- OpenClaw Plugin SDK does not encapsulate a persistence API (no KV store, no data directory concept)
- But Plugin is regular Node.js code and can use the `fs` module to read/write files directly (same as using the `ws` module)
- **Technically feasible** — pending queue and seq counter can be persisted to disk
- Operational issues to resolve:
  - The directory where Plugin writes files needs to be agreed upon (e.g., under `process.cwd()`, specified via environment variable, or provided by OpenClaw as a data path)
  - Whether OpenClaw upgrades/redeployments preserve the plugin data directory (depends on deployment method: Docker volume mount vs. bare metal vs. container rebuild)
- **Conclusion**: pending queue persistence is feasible, but depends on operational-level data directory persistence guarantees

### 7.2 deliver Callback Does Not Support Error Propagation and Retry

- The `deliver` callback in `dispatchInboundReplyWithBase` is async but operates in fire-and-forget mode
- Thrown errors only go through the `onDispatchError` callback (only console.error + sends error message), with no retry mechanism
- OpenClaw upper layer does not know about delivery failure — `sendReply` only `log.warn` when it detects WS disconnection, does not throw
- **Impact**: Even with a pending queue, Plugin cannot notify OpenClaw to pause or retry on delivery failure

### 7.3 Streaming Display Depends on OpenClaw Block Granularity

- Kosmos-side streaming chain is complete: push chunk → handlePushChunk → emitStreamingChunk → IPC → renderer (25-30ms adaptive batching)
- But OpenClaw's `bufferedBlockDispatcher` dispatches at block (paragraph) level, not token level
- The user seeing "a whole block appear at once" is OpenClaw-side behavior, not a Kosmos-side issue
- **Impact**: Offline resend does not need to preserve streaming experience. Only full text needs to be sent during resend (push + push_end), no streaming replay needed

### 7.4 Plugin Lifecycle

- Plugin continues running after Kosmos is closed (runs on OpenClaw server)
- Plugin continuously attempts WS reconnection (exponential backoff)
- Plugin can use Node.js fs to persist pending queue to disk
- **Impact**: Plugin can restore pending queue from disk after restart, provided the data directory is preserved during redeployment

### 7.5 Account and Token Relationship

- account = an agent ID in OpenClaw, each account has one token
- account and token have a one-to-one relationship
- **Impact**: seq per-account and lastReceivedSeq per-token are the same granularity, no risk of false seq gap reports

### 7.6 Conclusions

**This solution is technically feasible.** The Plugin side can use Node.js fs to persist the pending queue.

Remaining blockers:

1. deliver callback does not support error propagation (OpenClaw does not know about delivery failure), requires refactoring or a workaround
2. Plugin data directory persistence requires operational guarantees (determined by deployment method)

**Optional paths:**

| Path | Description | Reliability |
|------|------|--------|
| A. This solution (MQTT QoS 1 + Seq) | Plugin fs persists pending queue + ACK + resend | High (depends on operational data directory guarantees) |
| B. Cloud Relay solution | See [ws-message-delivery-guarantee-cloud-proposal.md](ws-message-delivery-guarantee-cloud-proposal.md) | Highest (cloud always online) |

The two solutions are not mutually exclusive. Solution A can be implemented first to quickly resolve message loss, then migrated to B once cloud infrastructure is available.

---

## 8. Original Open Questions (Partially Answered)

1. ~~**Pending queue size limit**~~ → In-memory pending queue recommended limit: 100 entries or 5MB (memory should not be too large)
2. **Resend strategy** — Serial one-by-one resend, recommend keeping unchanged
3. ~~**Heartbeat and timeout**~~ → No additional heartbeat needed, WS close event is sufficient
4. **Multiple Kosmos instances** — If the user runs Kosmos on multiple machines, does the seq space need to be isolated? (Currently already isolated per-account)
5. ~~**Seq granularity for streaming chunks**~~ → Assign seq only to push_end with full text. Offline resend does not need streaming experience
