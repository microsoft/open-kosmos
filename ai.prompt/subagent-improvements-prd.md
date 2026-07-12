# PRD: Sub-Agent System Improvements

<!-- Last verified: 2026-06-29 -->

## 1. Background & Problem Statement

OpenKosmos Sub-Agent system allows a parent agent to delegate tasks to specialized child agents. After deep benchmarking against Claude Code's implementation, we identified gaps organized into three batches.

### 1.1 Key Gaps (Full Inventory)

| # | Gap | Priority | Status | Impact |
|---|-----|----------|--------|--------|
| 1 | **No ad-hoc dynamic spawn** | P0 | ✅ Done (Batch 1) | LLM can't create one-off workers |
| 2 | **Silent failure on missing MCP/Skill** | P0 | ✅ Done (Batch 1) | Parent LLM unaware of reduced capabilities |
| 3 | **Shared deliverables directory** | P1 | ✅ Done (Batch 1) | File collisions between parallel sub-agents |
| 4 | **No background/async execution** | P0 | ✅ Done (Batch 2) | Parent blocked during sub-agent execution |
| 5 | **No partial result extraction** | P2 | ✅ Done (Batch 2) | Timeout = total work loss |
| 6 | **No inter-agent communication** | P1 | ✅ Done (Batch 2) | Can't build multi-agent workflows |
| 7 | **No auto-background promotion** | P0 | ✅ Done (Batch 3) | Long sync agents still block parent |
| 8 | **No parent→child messaging** | P1 | ✅ Done (Batch 3) | Can't send follow-up instructions to running agents |
| 9 | **No fork mode (cache sharing)** | P1 | 🔲 Future | High token cost for parallel sub-agents |
| 10 | **No agent resume** | P2 | 🔲 Future | Can't continue interrupted agents |
| 11 | **No thinking budget control** | P3 | 🔲 Future | Sub-agents waste tokens on extended thinking |
| 12 | **No auto-wake on result ready** | P1 | ✅ Done (Batch 4.1) | Parent must wait for user message to see results |
| 13 | **No transcript persistence** | P2 | 🔲 Planned (Batch 4) | Sub-agent conversations lost on crash; no debug/audit |
| 14 | **No session→task lifecycle binding** | P0 | 🔲 Planned (Batch 4) | Orphan sub-agents run indefinitely after session delete |

### 1.2 Scope

- **Batch 1 (Completed):** #1 Ad-hoc spawn, #2 Failure transparency, #3 Deliverables isolation
- **Batch 2 (Completed):** #4 Background execution, #5 Partial result extraction, #6 Inter-agent communication (child→parent)
- **Batch 3 (Completed):** #7 Auto-background promotion (120s), #8 Parent→child bidirectional messaging
- **Batch 4 (In Progress):** #12 Auto-wake on result ready is delivered; #13 Transcript persistence and #14 Session→task lifecycle binding remain planned
- **Future:** #9 Fork mode, #10 Agent resume, #11 Thinking budget

---

## 2. Design Principles

1. **Orchestrator, not Code Agent** — OpenKosmos delegates code editing to external CLI agents. Sub-agent improvements focus on information retrieval, analysis, document generation, and tool orchestration.
2. **Scoped inheritance by default** — Ad-hoc spawn inherits the parent agent's MCP tools by default and can narrow to a strict subset; no capability escalation.
3. **Transparent failures** — The parent LLM must always know when a sub-agent is operating with reduced capabilities.
4. **Flat output structure** — Sub-agent deliverables should be directly visible to users without navigating hidden directories.
5. **Non-blocking by default** — Long-running sub-agents should not lock up the parent agent's conversation loop.
6. **Aligned with Claude Code** — Where applicable, follow Claude Code's battle-tested patterns (120s timeout, independent AbortController, system-message injection).

---

## 3. Batch 1 — Completed Features

### 3.1 Ad-Hoc Dynamic Spawn ✅

**Tools added:** `sub_agent` (ad-hoc spawn tool)

- LLM can create one-off workers with inline `{ description, prompt, system_prompt?, tools?, model?, run_in_background?, no_auto_promote? }`
- `tools` narrows the inherited parent MCP tool set when supplied and is enforced as a strict subset of the parent's available tools
- Cannot declare new MCP servers, cannot spawn nested sub-agents
- Add `run_in_background: true` to run without blocking; results arrive as a `<task-notification>` on the parent's next turn

### 3.2 Failure Transparency ✅

- When `tools` is supplied, every requested name is validated against the parent's available tool set before the sub-agent starts
- Any name outside that set fails the spawn fast with an explicit `Requested tools not available in parent agent: …` error returned to the parent LLM — the parent is always informed

### 3.3 Deliverables Directory Isolation ✅

- Path: `{workspace}/{YYYYMM}/{sessionId}/{safeName}-{shortTaskId}/`
- Each sub-agent gets an isolated subdirectory
- Ad-hoc agents use `adhoc-{taskId}/`
- No migration needed — only new spawns use isolated paths

---

## 4. Batch 2 — Completed Features

### 4.1 Background/Async Execution ✅

- `run_in_background: true` parameter on the `sub_agent` tool
- Fire-and-forget via `SubAgentManager.spawnSubAgentAsync()` with independent `AbortController`
- Results queued in `resultQueue` and injected as `<task-notification>` user message at parent's next LLM turn
- `get_subagent_status` tool for polling running/completed background tasks
- Background badge in `SubAgentToolCallView` UI

### 4.2 Partial Result Extraction ✅

- `SubAgentChat.extractPartialResult()` reverse-scans `contextHistory` for last assistant text
- On timeout/cancel: partial result included in `SubAgentTaskResult.partialResult`
- Formatted as `success: true` with `⚠️` prefix — parent LLM gets something to work with

### 4.3 Inter-Agent Communication (Child→Parent) ✅

- `notify_parent` tool — only available when `isSubAgent=true`
- `SubAgentManager.handleNotification()` queues notifications
- Drained and injected alongside background results at parent's next turn
- Notification types: `info`, `warning`, `need_input`

---

## 5. Batch 3 — Planned Features

### 5.1 Auto-Background Promotion (P0)

#### Problem
Even with `run_in_background` available, the LLM must explicitly opt in. If it misjudges task duration and uses sync mode, a 5-minute sub-agent still locks the parent for 5 minutes.

Claude Code solves this with **automatic promotion after 120 seconds** — controlled by `CLAUDE_AUTO_BACKGROUND_TASKS` flag.

#### Solution

When a sync sub-agent exceeds **120 seconds** of execution time:

1. **Automatic promotion**: SubAgentManager detaches from the awaiting Promise, converts to background task
2. **Immediate return**: Parent gets `{ success: true, data: "⏱️ Sub-agent promoted to background after 120s. Results at next turn." }`
3. **Continued execution**: Sub-agent continues running on its independent AbortController
4. **Result delivery**: Same as explicit `run_in_background` — queued and injected at next turn
5. **UI notification**: Renderer shows "Moved to background" badge

```
Parent turn (sync spawn)
  └─ await spawnAdhocSubAgent()
       ├── ... 120 seconds pass ...
       ├── AUTO-PROMOTE: detach, register as backgroundTask
       └── return partial status to parent immediately

(Sub-agent continues in background → result injected at next turn)
```

#### Configuration
- Timeout: **120 seconds** (aligned with Claude Code)
- Controllable via `SUB_AGENT_LIMITS.AUTO_BACKGROUND_TIMEOUT_MS: 120_000`
- Disabled for sub-agents spawned with `run_in_background: false, no_auto_promote: true` (explicit opt-out)

---

### 5.2 Bidirectional Communication — Parent→Child (P1)

#### Problem
After Batch 2, sub-agents can notify the parent (`notify_parent`). But the parent has no way to send follow-up instructions to a running background sub-agent. If the parent realizes it needs to redirect the agent's focus ("also check X" or "stop researching Y, focus on Z"), it can only cancel and re-spawn.

Claude Code solves this with `SendMessage(to: name)`, where background workers receive mid-turn messages via a pending-message queue.

#### Solution

New tool: `send_to_subagent`

```typescript
{
  name: 'send_to_subagent',
  inputSchema: {
    type: 'object',
    required: ['task_id', 'message'],
    properties: {
      task_id: { type: 'string', description: 'Background sub-agent task ID' },
      message: { type: 'string', description: 'Message/instruction to send' }
    }
  }
}
```

**Mechanism:**
1. Parent calls `send_to_subagent({ task_id: "sa_bg_xxx", message: "Also check competitor pricing" })`
2. `SubAgentManager.sendMessageToSubAgent(taskId, message)` pushes to `pendingMessages` queue on the background task
3. `SubAgentChat` drains `pendingMessages` at each tool-call boundary (between turns)
4. Message injected as user message: `"[Parent instruction]: Also check competitor pricing"`
5. Sub-agent incorporates in its next LLM turn

#### Constraints
- Only works for **background** sub-agents (sync agents are blocking, parent can't act)
- If sub-agent has already completed, return error: "Sub-agent already finished"

---

## 6. Batch 4 — In Progress Features

### 6.1 Auto-Wake on Result Ready (P1) ✅ Delivered

#### Problem
When a background sub-agent completes, the result is queued in `resultQueue`. The parent only drains results when the **user sends a new message** (triggering a new LLM turn). If the user is waiting for the sub-agent to finish, they have no way to know it's done — they must send a message like "any updates?" to trigger the drain.

Claude Code solves this with a push-based notification queue that auto-triggers a new turn when the parent is idle.

#### Solution

When a background sub-agent completes and the parent session is idle:
1. `SubAgentManager.enqueueResult()` emits an event `subAgentResultReady { parentSessionId }`
2. `AgentChatManager` listens for this event (debounced 500ms — coalesce multiple completions)
3. Checks: parent session exists? `chatStatus === IDLE`? (auto-wake is always on — no feature-flag gate)
4. Creates a **synthetic user message** (`<task-notification-trigger/>`) with `metadata.synthetic = true`
5. Calls `streamMessage()` with `emitUserMessage: false` and `persistUserMessage: false` — user never sees the trigger and it is never written to chat history
6. Normal turn flow: `drainBackgroundSubAgentResults()` picks up the results → LLM processes → responds to user
7. Only the real `<task-notification>` is persisted into context after the result drain succeeds

```
SubAgentManager.enqueueResult(parentSessionId, result)
  │
  └── emit 'subAgentResultReady' { parentSessionId }
         │
         ▼ (debounced 500ms)
AgentChatManager (listener)
  │
  ├── instance = registry.getInstance(parentSessionId)
  ├── guard: instance exists? status === IDLE?
  │
  └── YES → streamMessage(parentSessionId, syntheticTrigger, { emitUserMessage: false, persistUserMessage: false })
                │
                ▼ (normal turn flow)
         drainBackgroundSubAgentResults() → <task-notification> user message
                │
                ▼
         LLM sees results → responds to user
```

#### Configuration
- Auto-wake is **baseline behavior** — always on, no feature flag gate. (The original `openkosmosFeatureSubAgentAutoWake` flag was removed; it defaulted off in production and silently suppressed result delivery.)
- Debounce: 500ms (multiple completions in quick succession only trigger one turn)
- Recursion guard: synthetic turns that spawn new background agents do NOT trigger auto-wake on their own turn end (prevent infinite loop)

#### Constraints
- Only triggers when session is IDLE (not mid-turn)
- Session must still exist in registry (not disposed/destroyed)
- Maximum 1 pending auto-wake per session (prevent queue flooding)
- Auto-wake turns count toward normal rate limits

---

### 6.2 Sub-Agent Task Persistence & Streaming Rendering (P2)

#### Problem
Sub-agent conversations are purely in-memory (`SubAgentChat.contextHistory`). When:
- The process crashes mid-run → all progress lost
- Debugging a sub-agent's reasoning → impossible without reproduction
- Auditing what a sub-agent did → only the final result string survives (in parent's history)
- User wants to watch a sub-agent's execution in real-time → no rendering pipeline

#### Solution

A full E2E pipeline mirroring the chat session architecture:

**Backend — `SubAgentTaskStore` (parallels `ChatSessionStore`):**
- Persists each sub-agent run as a `SubAgentTaskFile` (.json) with dual history:
  - `chat_history[]` — full uncompressed messages for UI rendering
  - `context_history[]` — compressed version sent to LLM API
- Written after each turn completes (debounced 2s), final flush on completion/failure
- Storage: `{userData}/profiles/{userAlias}/sub-agent-tasks/{YYYY-MM}/{taskId}.json`
- 30-day auto-purge (by month directory)

**Streaming — Real-time rendering (parallels `agentChat:streamingChunk`):**
- New IPC namespace: `subAgentTask:streamingChunk` (keyed by `taskId`)
- `SubAgentTaskWatcherRegistry` — only emits when UI panel is actively viewing the task
- Same chunk types: `content`, `tool_call`, `tool_result`, `complete`

**Frontend — `SubAgentTaskCacheManager` (parallels `AgentChatSessionCacheManager`):**
- `SubAgentTaskCache` per task: `messages[]`, `streamingMessageId`, `status`
- Direct message update callbacks for smooth streaming (same pattern as chat)
- React hooks: `useSubAgentTaskMessages(taskId)`, `useSubAgentTaskStatus(taskId)`

**Loading flow:**
1. User opens sub-agent task panel → IPC `subAgentTask:open({ taskId })`
2. Backend loads from disk (or in-memory if running) → `subAgentTask:cacheCreated`
3. If task still running → register watcher → streaming chunks flow in real-time
4. If task completed → static snapshot rendered immediately

#### Key Design Decisions
- **JSON not JSONL** — aligned with `ChatSessionFile` format; context compression requires full rewrite
- **Conditional streaming** — only emit when UI is watching (prevents IPC spam for background tasks)
- **Dual history** — sub-agents also compress context near window limit; `chat_history` preserves full display
- **Same Message type** — sub-agent messages use the same `Message` interface as chat sessions (tooling reuse)

---

### 6.3 Session→Task Lifecycle Binding (P0)

#### Problem
When a chat session is destroyed (`disposeManagedInstance()`), its running sub-agent tasks continue indefinitely:
- Running sub-agents consume resources (LLM API calls, tool executions)
- Completed results queue into `resultQueue` with no parent to drain them (memory leak)
- `parentChildMap`, `backgroundTasks`, `notificationQueue` entries become orphaned

This is a **correctness bug** in the current implementation.

#### Invariant

```
1 AgentChat Session (parentSessionId) contains N SubAgent Tasks

Session DELETE → CASCADE: cancel all running tasks + purge all queues
Task DELETE/CANCEL → no effect on session
```

#### Solution

Add `cancelAllForSession(parentSessionId)` to `SubAgentManager`, called from `AgentChatManager.disposeManagedInstance()`:

```typescript
// SubAgentManager
public cancelAllForSession(parentSessionId: string): void {
  // 1. Cancel all running instances for this session
  const taskIds = this.parentChildMap.get(parentSessionId);
  if (taskIds) {
    for (const taskId of taskIds) {
      const chat = this.activeInstances.get(taskId);
      if (chat) {
        chat.cancel();  // graceful shutdown
        chat.dispose();
      }
      this.activeInstances.delete(taskId);
      this.runtimeStates.delete(taskId);
      // Clean up throttle timers
      const timer = this.stateUpdateThrottles.get(taskId);
      if (timer) clearTimeout(timer);
      this.stateUpdateThrottles.delete(taskId);
      this.pendingStateUpdates.delete(taskId);
    }
  }

  // 2. Purge all queues for this session
  this.resultQueue.delete(parentSessionId);
  this.notificationQueue.delete(parentSessionId);
  this.parentChildMap.delete(parentSessionId);
  this.spawnCountMap.delete(parentSessionId);

  // 3. Clean backgroundTasks entries
  for (const [taskId, task] of this.backgroundTasks) {
    if (task.parentSessionId === parentSessionId) {
      this.backgroundTasks.delete(taskId);
    }
  }
}
```

**Integration point:**
```typescript
// AgentChatManager.disposeManagedInstance() — add at end of existing cleanup
SubAgentManager.getInstance().cancelAllForSession(chatSessionId);
```

---

## 7. Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Ad-hoc spawn adoption | >60% of sub-agent spawns use ad-hoc mode within 30 days | Measuring |
| Failure transparency | 0 cases of "silent tool unavailability" in production | ✅ Achieved |
| Deliverables collision | 0 file overwrites between parallel sub-agents | ✅ Achieved |
| Background adoption | >40% of spawns use `run_in_background: true` within 30 days | Measuring |
| Partial result recovery | >80% of timed-out agents produce usable partial results | Measuring |
| Auto-promote triggers | >30% of long-running sync agents auto-promote | Measuring |
| Parent→child messages | >10% of background agents receive follow-up instructions | Measuring |
| Auto-wake latency | <2s from sub-agent completion to parent turn start | Measuring |
| Orphan tasks after session delete | 0 running tasks after parent session disposed | Planned |
| Transcript crash recovery | >95% of sub-agent runs have complete transcript on disk | Planned |

---

## 7. Out of Scope (Future)

| Feature | Reason for deferral |
|---------|-------------------|
| **Fork mode / prompt cache sharing** | Requires byte-identical API prefix construction; depends on model provider cache semantics. High value but high complexity. |
| **Agent resume from disk** | Requires transcript persistence to disk + replay. Complex state reconstruction. |
| **Thinking budget control** | Depends on model API support for `thinkingConfig` passthrough. Low effort once API supports it. |
| **Permission modes** | OpenKosmos sub-agents don't directly edit code; lower urgency than Claude Code. |
| **Agent-scoped MCP lifecycle** | Sub-agents currently share parent's MCP connections. Separate lifecycle adds complexity for marginal isolation gain. |
| **Worktree isolation** | OpenKosmos is not a coding tool; git-level isolation is overkill for document/research tasks. Code editing delegated to dedicated code agents. |
