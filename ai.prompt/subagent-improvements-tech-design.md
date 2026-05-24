# Tech Design: Sub-Agent System Improvements

<!-- Last verified: 2026-05-21 -->

## 1. Overview

This document covers the technical design for sub-agent system improvements in three batches:

- **Batch 1 (Completed):** Ad-hoc dynamic spawn, failure transparency, deliverables directory isolation
- **Batch 2 (Completed):** Background async execution, partial result extraction, inter-agent communication (child→parent)
- **Batch 3 (Completed):** Auto-background promotion (120s), bidirectional communication (parent→child)
- **Batch 4 (Planned):** Auto-wake on idle, transcript persistence, session→task lifecycle binding

See [subagent-improvements-prd.md](subagent-improvements-prd.md) for requirements.

---

## 2. Batch 1 — Completed Implementation

### 2.1 Architecture Impact (Delivered)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Batch 1 — Files Changed                              │
├─────────────────────────────────────────────────────────────────────────┤
│  src/main/lib/mcpRuntime/builtinTools/subAgentTool.ts             [NEW] │
│  src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts   [MODIFY] │
│  src/main/lib/mcpRuntime/mcpClientManager.ts                   [MODIFY] │
│  src/main/lib/subAgent/subAgentManager.ts                      [MODIFY] │
│  src/main/lib/subAgent/subAgentChat.ts                         [MODIFY] │
│  src/main/lib/subAgent/types.ts                                [MODIFY] │
│  src/main/lib/userDataADO/types/profile.ts                     [MODIFY] │
│  src/main/lib/chat/agentChatPromptService.ts                   [MODIFY] │
│  src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx    │
│                                                                [MODIFY] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Methods Added (Batch 1)

| Method | File | Purpose |
|--------|------|---------|
| `spawnAdhocSubAgent()` | `subAgentManager.ts` | Build synthetic config, validate tool subset, execute |
| `validateToolAvailability()` | `subAgentManager.ts` | Check MCP connectivity + skill installation |
| `deriveDeliverablesPath(name, taskId)` | `subAgentManager.ts` | Generate `{safeName}-{shortTaskId}` subdirectory |
| `SpawnSubAgentTool.execute()` | `subAgentTool.ts` | Unified tool entry point with recursion guard; `subagent_type` selects named vs ad-hoc |

---

## 3. Batch 2 — Completed Implementation

### 3.1 Key Methods Added (Batch 2)

| Method | File | Purpose |
|--------|------|---------|
| `extractPartialResult()` | `subAgentChat.ts` | Reverse-scan contextHistory for last assistant text (capped 10K chars) |
| `spawnSubAgentAsync()` | `subAgentManager.ts` | Fire-and-forget spawn with independent AbortController |
| `executeInBackground()` | `subAgentManager.ts` | Delegates to sync spawn methods with synthetic CancellationToken |
| `enqueueResult()` | `subAgentManager.ts` | Push completed result to `resultQueue` |
| `drainResults()` | `subAgentManager.ts` | Atomically pop and return queued results for a session |
| `handleNotification()` | `subAgentManager.ts` | Queue sub-agent→parent notifications (cap: 5) |
| `drainNotifications()` | `subAgentManager.ts` | Atomically pop and return queued notifications |
| `getBackgroundTaskStatus()` | `subAgentManager.ts` | Return status of all background tasks for a session |
| `drainBackgroundSubAgentResults()` | `agentChat.ts` | Drain results+notifications, set on promptService |
| `setBackgroundResultContexts()` | `agentChatPromptService.ts` | Store contexts for injection; drained after use |

### 3.2 Data Structures (Batch 2)

```typescript
// SubAgentManager — added in Batch 2
private backgroundTasks: Map<string, BackgroundSubAgentTask> = new Map();
private resultQueue: Map<string, SubAgentTaskResult[]> = new Map();
private notificationQueue: Map<string, SubAgentNotification[]> = new Map();

// Types (profile.ts)
interface BackgroundSubAgentTask {
  taskId: string;
  parentSessionId: string;
  subAgentName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
}

interface SubAgentNotification {
  taskId: string;
  subAgentName: string;
  type: 'info' | 'warning' | 'need_input';
  message: string;
  timestamp: number;
}

// SUB_AGENT_LIMITS — added
MAX_BACKGROUND_TASKS: Infinity  // no hard cap
```

### 3.3 Background Execution Flow

```
Parent LLM → sub_agent({ run_in_background: true })
  → SubAgentTool.execute()
    → manager.spawnSubAgentAsync()
      ├── Register in backgroundTasks Map
      ├── void executeInBackground(taskId, params, abortController)
      └── return { taskId, status: 'launched' }
    → immediate tool result to parent

executeInBackground():
  ├── Create synthetic CancellationToken wrapping AbortController
  ├── Call spawnSubAgent() / spawnAdhocSubAgent() with synthetic token
  ├── On success: enqueueResult(parentSessionId, result)
  ├── On failure: extractPartialResult() → enqueueResult(...)
  └── Cleanup: activeInstances.delete, backgroundTasks.delete

Parent's next LLM turn:
  AgentChat.getCombinedSystemPromptForCurrentTurn()
    → drainBackgroundSubAgentResults()
      → SubAgentManager.drainResults(sessionId)
      → SubAgentManager.drainNotifications(sessionId)
      → format as <task-notification> user message → push to context_history
    → LLM sees notification in conversation flow (recency bias)
```

### 3.4 Tool Registrations (Batch 2)

| Tool | Available to | Purpose |
|------|-------------|---------|
| `get_subagent_status` | Parent agent | Check background task progress |
| `notify_parent` | Sub-agent only (isSubAgent=true) | Send notification to parent |
| `send_to_subagent` | Parent agent (blocked for sub-agents) | Send follow-up instruction to background sub-agent |

### 3.5 Test Coverage (Batch 2)

- `subAgentManager.test.ts`: 104 tests (+spawnSubAgentAsync, background tasks, drainResults, drainNotifications, notification cap, getBackgroundTaskStatus)
- `subAgentTool.test.ts`: tests covering run_in_background, partial result, recursion guard, no-context, named and ad-hoc modes
- **Total: 374 tests passing, 91-98% line coverage on Batch 2 code**

---

## 4. Batch 3 — Detailed Design

### 4.1 Auto-Background Promotion (120s Timeout)

#### 4.1.1 Core Mechanism

Currently, `spawnSubAgent()` blocks via `await chat.run()` inside a `Promise.race` with the existing timeout. To implement auto-promotion, we transform the blocking path into a **race with a promotion timer**:

```typescript
// In SubAgentManager.spawnSubAgent() — modified sync path
const AUTO_PROMOTE_MS = SUB_AGENT_LIMITS.AUTO_BACKGROUND_TIMEOUT_MS; // 120_000

const chatPromise = chat.run();
const promotionTimer = new Promise<'PROMOTE'>((resolve) =>
  setTimeout(() => resolve('PROMOTE'), AUTO_PROMOTE_MS)
);

const raceResult = await Promise.race([chatPromise, promotionTimer]);

if (raceResult === 'PROMOTE') {
  // ── Auto-promote to background ──
  return this.promoteToBackground(taskId, chat, params);
}

// Normal sync completion
return { success: true, result: raceResult, ... };
```

#### 4.1.2 `promoteToBackground()` Method

```typescript
private promoteToBackground(
  taskId: string,
  chat: SubAgentChat,
  params: SpawnSubAgentParams,
): SubAgentTaskResult {
  // 1. Create independent AbortController (detach from parent's CancellationToken)
  const abortController = new AbortController();

  // 2. Register as background task
  this.backgroundTasks.set(taskId, {
    taskId,
    parentSessionId: params.parentSessionId,
    subAgentName: params.subAgentName,
    status: 'running',
    startTime: Date.now() - AUTO_PROMOTE_MS, // reflect actual start
  });

  // 3. Fire-and-forget: let chat.run() promise settle naturally
  void chatPromise.then(
    (result) => this.enqueueResult(params.parentSessionId, { success: true, result, ... }),
    (error) => {
      const partial = chat.extractPartialResult();
      this.enqueueResult(params.parentSessionId, { success: false, error: ..., partialResult: partial, ... });
    }
  ).finally(() => {
    chat.dispose();
    this.activeInstances.delete(taskId);
    this.backgroundTasks.delete(taskId);
  });

  // 4. Emit IPC event for UI update
  params.eventSender?.send('subAgent:autoPromoted', { taskId, subAgentName: params.subAgentName });

  // 5. Return immediately to unblock parent
  const partialResult = chat.extractPartialResult();
  return {
    success: true,
    subAgentName: params.subAgentName,
    taskId,
    result: `⏱️ Sub-agent "${params.subAgentName}" auto-promoted to background after 120s. ` +
      `Results will be delivered at your next turn. Use get_subagent_status to check progress.` +
      (partialResult ? `\n\nPartial progress so far:\n${partialResult.slice(0, 2000)}` : ''),
    turnCount: chat.getTurnCount(),
    durationMs: Date.now() - (Date.now() - AUTO_PROMOTE_MS),
    autoPromoted: true,
  };
}
```

#### 4.1.3 Opt-Out

Add `no_auto_promote?: boolean` to spawn tool schemas. When explicitly `true`, skip the promotion timer and use existing behavior (await until timeout/completion).

#### 4.1.4 Type Changes

```typescript
// profile.ts
interface SubAgentTaskResult {
  // ... existing fields
  autoPromoted?: boolean; // true if auto-promoted from sync to background
}

// SUB_AGENT_LIMITS
AUTO_BACKGROUND_TIMEOUT_MS: 120_000
```

#### 4.1.5 UI Impact

- `SubAgentToolCallView`: detect `autoPromoted` in result → show "⏱️ Auto-promoted to background" badge
- IPC event `subAgent:autoPromoted` → renderer can show toast notification

#### 4.1.6 Files to Modify

| File | Change |
|------|--------|
| `subAgentManager.ts` | Add `promoteToBackground()`, modify sync path with promotion race |
| `profile.ts` | Add `AUTO_BACKGROUND_TIMEOUT_MS`, `autoPromoted` field |
| `subAgentTool.ts` | Pass through `no_auto_promote` param |
| `builtinToolsManager.ts` | Add `no_auto_promote` to schema |
| `SubAgentToolCallView.tsx` | Handle `autoPromoted` badge |

---

### 4.2 Bidirectional Communication — `send_to_subagent` Tool

#### 4.2.1 Core Architecture

```
Parent LLM Turn N:
  tool_call: send_to_subagent({ task_id: "sa_bg_xxx", message: "Also check X" })
    → SubAgentManager.sendMessageToSubAgent(taskId, message)
      → backgroundTask.pendingMessages.push(message)
    → return { success: true, data: "Message delivered" }

Background SubAgentChat (between turns):
  → drainPendingMessages()
  → Inject as user message: "[Parent instruction]: Also check X"
  → Sub-agent LLM incorporates in next turn
```

#### 4.2.2 Data Structure Changes

```typescript
// BackgroundSubAgentTask — extended
interface BackgroundSubAgentTask {
  taskId: string;
  parentSessionId: string;
  subAgentName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  pendingMessages: string[];  // NEW: parent→child message queue
}
```

#### 4.2.3 SubAgentManager Methods

```typescript
public sendMessageToSubAgent(taskId: string, message: string): { success: boolean; error?: string } {
  const task = this.backgroundTasks.get(taskId);
  if (!task) return { success: false, error: 'Task not found' };
  if (task.status !== 'running') return { success: false, error: `Task is ${task.status}` };

  task.pendingMessages.push(message);
  return { success: true };
}
```

#### 4.2.4 SubAgentChat Message Drain

In `SubAgentChat`, at each tool-call boundary (after `executeToolCalls()` returns, before next LLM call):

```typescript
private drainPendingMessages(): void {
  const task = SubAgentManager.getInstance().getBackgroundTask(this.taskId);
  if (!task?.pendingMessages?.length) return;

  const messages = task.pendingMessages.splice(0); // atomically drain
  for (const msg of messages) {
    this.contextHistory.push(
      MessageHelper.createTextMessage(
        `[Parent instruction]: ${msg}`,
        'user',
        `parent-msg-${Date.now()}`
      )
    );
  }
}
```

#### 4.2.5 Tool Registration

```typescript
// In builtinToolsManager.ts — only for parent agents (NOT sub-agents)
this.tools.set('send_to_subagent', {
  name: 'send_to_subagent',
  description: 'Send a message/instruction to a running background sub-agent. ' +
    'The sub-agent will incorporate it at its next turn.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Background sub-agent task ID' },
      message: { type: 'string', description: 'Message or instruction to send' }
    },
    required: ['task_id', 'message']
  }
});
```

#### 4.2.6 System Prompt Guidance Update

Add to `buildSubAgentsSystemPrompt()`:

```
### Communicating with Background Agents
Use `send_to_subagent({ task_id, message })` to send follow-up instructions to running background agents.
- Only works for background agents (not sync agents)
- Use for: corrections, additional requirements, focus redirection
- The agent will incorporate your message at its next turn
```

#### 4.2.7 Files to Modify

| File | Change |
|------|--------|
| `subAgentManager.ts` | Add `sendMessageToSubAgent()`, `getBackgroundTask()`, extend `BackgroundSubAgentTask` with `pendingMessages` |
| `subAgentChat.ts` | Add `drainPendingMessages()` call between turns |
| `builtinToolsManager.ts` | Register `send_to_subagent` tool + dispatch |
| `profile.ts` | Extend `BackgroundSubAgentTask` type |
| `agentChatPromptService.ts` | Update system prompt guidance |

---

## 5. Data Flow — Batch 3 Combined

```
Parent LLM Turn N (sync spawn)
  │
  ├─ tool_call: sub_agent({ task: "long research..." })
  │     → await spawnSubAgent()  [blocking]
  │           │
  │           ├── ... 120s passes ...
  │           ├── AUTO-PROMOTE: promoteToBackground()
  │           │     → register in backgroundTasks (with pendingMessages: [])
  │           │     → fire-and-forget: chatPromise.then(enqueueResult)
  │           │     → return immediately with "auto-promoted" result
  │           │
  │           └── Parent turn completes
  │
  └─ Parent continues normally

Parent LLM Turn N+1
  │
  ├─ Sees auto-promote message in previous tool result
  ├─ tool_call: send_to_subagent({ task_id: "sa_xxx", message: "Also check pricing data" })
  │     → pendingMessages.push("Also check pricing data")
  │     → return success
  │
  └─ Parent continues

Background SubAgentChat (next tool boundary)
  │
  ├─ drainPendingMessages()
  │     → inject "[Parent instruction]: Also check pricing data" as user message
  ├─ LLM incorporates instruction
  └─ Eventually completes → enqueueResult()

Parent LLM Turn N+2
  │
  ├─ drainBackgroundSubAgentResults() → <task-notification> user message injection
  └─ Parent processes full result (including pricing data)
```

---

## 6. Implementation Order — Batch 3

```
Phase 1 — Auto-Background Promotion    [~2 days]
  ├─ promoteToBackground() method                           [0.5d]
  ├─ Modify sync spawn path with 120s race                 [0.5d]
  ├─ no_auto_promote opt-out param                         [0.5d]
  └─ UI: auto-promoted badge + IPC event                   [0.5d]

Phase 2 — Parent→Child Messaging        [~3 days]
  ├─ sendMessageToSubAgent() + pendingMessages queue        [0.5d]
  ├─ SubAgentChat.drainPendingMessages() integration        [1d]
  ├─ send_to_subagent tool registration + dispatch          [0.5d]
  └─ Tests + system prompt update                           [1d]
```

Total Batch 3 estimate: **~5 days**

---

## 7. Backward Compatibility

| Change | Compatibility |
|--------|--------------|
| Auto-promote at 120s | Transparent — parent gets result faster (no longer blocks) |
| `no_auto_promote` param | Optional, default allows promotion |
| `send_to_subagent` tool | Additive — new tool, no existing behavior change |
| `pendingMessages` on BackgroundSubAgentTask | New field, default `[]`, no migration needed |
| `autoPromoted` on SubAgentTaskResult | Optional field, existing consumers unaffected |

---

## 8. Testing Strategy — Batch 3

### 8.1 Unit Tests

| Test | File |
|------|------|
| Sync spawn auto-promotes after 120s | `subAgentManager.test.ts` |
| `promoteToBackground()` registers in backgroundTasks | `subAgentManager.test.ts` |
| `no_auto_promote: true` skips promotion | `subAgentManager.test.ts` |
| Promoted task result queued after completion | `subAgentManager.test.ts` |
| `sendMessageToSubAgent()` pushes to queue | `subAgentManager.test.ts` |
| Message rejected when task not running | `subAgentManager.test.ts` |
| `drainPendingMessages()` injects user messages | `subAgentChat.test.ts` |
| `send_to_subagent` tool blocked for sub-agents | `builtinToolsManager.test.ts` |

### 8.2 Integration Tests

- Sync spawn → 120s → auto-promote → result at next turn
- Send message to running background agent → agent incorporates
- Send message to completed agent → error returned
- Auto-promote + partial result extraction combined

---

## 9. Claude Code Comparison — Design Decisions

### Where We Deliberately Diverge

| Claude Code Approach | OpenKosmos Decision | Rationale |
|---------------------|-----------------|-----------|
| Single `Agent` tool for everything | Single `sub_agent` tool (unified in Batch 3.5) | Aligned — `subagent_type` selects named vs ad-hoc |
| No explicit resource limits | No hard numeric limits (Infinity); turn budget and cancellation token remain | Desktop app is adequately protected by turn budgets and the AbortController cascade |
| Worktree isolation (git branch) | Directory isolation (deliverables subdirectory) | OpenKosmos is not a Code Agent; git isolation overkill for research tasks |
| 120s auto-background always on | 120s auto-promote with opt-out | Same timeout, but allow explicit sync for short tasks |
| `SendMessage(to: name)` peer routing | `send_to_subagent(task_id, message)` parent→child only | Simpler; peer-to-peer deferred until swarm mode needed |
| tmux-based multi-process swarm | Same-process Promise.allSettled | Electron app; IPC overhead of multi-process not justified |
| Push notification (auto-wake idle parent) | 🔲 Batch 4: auto-wake via synthetic user message | Same concept, adapted for Electron chat turn model |
| Disk transcript (JSONL sidechain) | 🔲 Batch 4: JSONL file per sub-agent task | Aligned approach |

### Where We Converge

| Claude Code Feature | OpenKosmos Status | Alignment |
|--------------------|---------------|-----------|
| Fire-and-forget background execution | ✅ Batch 2 | Aligned |
| Independent AbortController for background | ✅ Batch 2 | Aligned |
| User-message injection for results | ✅ Batch 2 | Aligned (`<task-notification>` user message) |
| 120s auto-background timeout | ✅ Batch 3 | Aligned |
| Parent→child messaging | ✅ Batch 3 | Simplified (task_id vs name) |
| Partial result extraction | ✅ Batch 2 | Aligned |
| Unified single tool | ✅ Batch 3.5 | Aligned (`sub_agent` ≈ CC's `Agent`) |
| Push notification (auto-wake) | 🔲 Batch 4 | Planned |
| Disk transcript persistence | 🔲 Batch 4 | Planned |

---

## 10. Future Considerations

| Future Feature | Design Accommodation |
|----------------|---------------------|
| **Fork mode** | `backgroundTasks` Map structure can later support shared-prefix fork groups |
| **Agent resume** | Batch 4 transcript persistence provides the foundation — replay from JSONL |
| **Thinking budget** | `SubAgentChatOptions` can add `thinkingConfig` field when model API supports it |
| **Named agent swarm** | `pendingMessages` queue pattern extends naturally to peer-to-peer routing |
| **Admin governance** | All features gated by `kosmosFeatureSubAgent` flag |

---

## 11. Batch 4 — Detailed Design

### 11.1 Auto-Wake on Result Ready

#### 11.1.1 Problem

Background sub-agent results sit in `resultQueue` until the user sends a message. The user has no signal that results are ready — they must poll via conversation.

#### 11.1.2 Architecture

```
SubAgentManager.enqueueResult(parentSessionId, result)
  │
  ├── [existing] push to resultQueue
  └── [new] this.emit('subAgentResultReady', { parentSessionId })
         │
         ▼
AgentChatManager (event listener, debounced 500ms)
  │
  ├── instance = registry.getInstance(parentSessionId)
  ├── GUARD: instance exists?
  ├── GUARD: chatStatus === IDLE?
  ├── GUARD: no pending auto-wake already queued?
  ├── GUARD: not inside a synthetic turn (recursion)?
  │
  └── streamMessage(parentSessionId, syntheticTrigger, { emitUserMessage: false })
         │
         ▼
  Normal turn: drainBackgroundSubAgentResults() → LLM → response to user
```

#### 11.1.3 Synthetic Trigger Message

```typescript
const triggerMessage: UserMessage = {
  role: 'user',
  content: '<task-notification-trigger/>',
  metadata: {
    synthetic: true,
    purpose: 'auto-wake',
    timestamp: Date.now(),
  },
};
```

**Lifecycle:**
1. Injected into context → triggers turn
2. `drainBackgroundSubAgentResults()` runs → injects real `<task-notification>` user message
3. After drain succeeds, synthetic trigger is **removed** from `contextHistory` (cleanup)
4. LLM only sees the `<task-notification>` content, not the trigger

#### 11.1.4 Event Emission

`SubAgentManager` extends `EventEmitter`:

```typescript
import { EventEmitter } from 'events';

export class SubAgentManager extends EventEmitter {
  // ...existing code...

  public enqueueResult(parentSessionId: string, result: SubAgentTaskResult): void {
    // ...existing push to resultQueue...
    this.emit('subAgentResultReady', { parentSessionId });
  }
}
```

#### 11.1.5 AgentChatManager Listener

```typescript
// In AgentChatManager — called during initialization
private pendingAutoWakes = new Set<string>();  // prevent duplicate wakes

private setupAutoWakeListener(): void {
  const manager = SubAgentManager.getInstance();

  const debouncedHandler = debounce((event: { parentSessionId: string }) => {
    const { parentSessionId } = event;

    // Guards
    if (this.pendingAutoWakes.has(parentSessionId)) return;
    const instance = this.registry.getInstance(parentSessionId);
    if (!instance) return;
    if (instance.chatStatus !== ChatStatus.IDLE) return;
    if (!isFeatureEnabled('kosmosFeatureSubAgentAutoWake')) return;

    // Mark pending to prevent double-trigger
    this.pendingAutoWakes.add(parentSessionId);

    const trigger = MessageHelper.createTextMessage(
      '<task-notification-trigger/>',
      'user'
    );
    trigger.metadata = { synthetic: true, purpose: 'auto-wake' };

    this.streamMessage(parentSessionId, trigger, { emitUserMessage: false })
      .finally(() => {
        this.pendingAutoWakes.delete(parentSessionId);
      });
  }, 500);

  manager.on('subAgentResultReady', debouncedHandler);
}
```

#### 11.1.6 Recursion Prevention

A synthetic auto-wake turn could itself spawn a background agent. To prevent infinite auto-wake loops:

```typescript
// In AgentChat — track whether current turn is synthetic
private isSyntheticTurn = false;

// In drainBackgroundSubAgentResults():
if (this.isSyntheticTurn) {
  // Drain results (so LLM sees them), but mark context
  // so AgentChatManager's listener ignores completions from this turn
}
```

The simpler approach: the debounce + `pendingAutoWakes` Set naturally prevents re-triggering while a synthetic turn is in progress.

#### 11.1.7 Files to Modify

| File | Change |
|------|--------|
| `subAgentManager.ts` | Extend `EventEmitter`, emit `subAgentResultReady` in `enqueueResult()` |
| `agentChatManager.ts` | Add `setupAutoWakeListener()`, `pendingAutoWakes` Set, debounced handler |
| `agentChat.ts` | Mark synthetic trigger messages, clean up after drain |
| `featureFlags.ts` | Add `kosmosFeatureSubAgentAutoWake` flag |

---

### 11.2 Sub-Agent Task Persistence & Streaming Rendering

#### 11.2.1 Design Philosophy

Sub-agent tasks need the same E2E architecture as chat sessions:
- **Dual history** — `chat_history` (full, for UI display) + `context_history` (compressed, for API)
- **Disk persistence** — survive crashes, support re-opening completed tasks
- **Streaming rendering** — real-time token-by-token display in frontend (same fidelity as main chat)
- **Frontend cache** — `SubAgentTaskCache` paralleling `AgentChatSessionCache`

This is NOT a simple JSONL dump — it's a full parallel data pipeline mirroring `ChatSessionFile` → `AgentChat` → IPC → `AgentChatSessionCacheManager` → React.

#### 11.2.2 Disk Persistence — `SubAgentTaskFile`

**Storage layout (aligned with chat session pattern):**
```
{userData}/profiles/{userAlias}/sub-agent-tasks/
  └── {YYYY-MM}/
      └── {taskId}.json          ← single JSON file per task
```

**File schema:**
```typescript
interface SubAgentTaskFile {
  taskId: string;
  subAgentName: string;
  parentSessionId: string;
  parentChatId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  model: string;
  contextAccess: string;
  isAdhoc: boolean;
  turnCount: number;
  result?: string;
  error?: string;

  // Dual history — same pattern as ChatSessionFile
  chat_history: Message[];       // Full uncompressed history for UI display
  context_history: Message[];    // Compressed history sent to LLM API
}
```

**Why JSON not JSONL:**
- Aligned with `ChatSessionFile` format (single JSON per session)
- Enables atomic read/write via `ChatSessionFileOps`-style ops
- Context history compression requires full-file rewrite anyway (summary replaces messages)
- Crash safety via write-to-temp + atomic rename (same as chat sessions)

**Write timing:**
- After each turn completes (tool results resolved, before next LLM call)
- On completion/failure/cancel (final write with footer fields)
- Debounced: max once per 2 seconds during active execution (prevent disk thrashing)

#### 11.2.3 Backend Architecture — `SubAgentTaskStore`

Parallels `ChatSessionStore`:

```typescript
// src/main/lib/subAgent/subAgentTaskStore.ts — NEW

interface SubAgentTaskAggregate {
  taskId: string;
  parentSessionId: string;
  file: SubAgentTaskFile;
  runtime: {
    loaded: boolean;
    dirty: boolean;
    revision: number;
    persistedRevision: number;
    lastAccessedAt: number;
  };
}

class SubAgentTaskStore {
  private static instance: SubAgentTaskStore;
  private tasksById: Map<string, SubAgentTaskAggregate> = new Map();
  private sessionToTaskIds: Map<string, Set<string>> = new Map();  // parent → children
  private flushQueue: Map<string, Promise<void>> = new Map();       // per-task mutex

  // Write operations
  createTask(taskId: string, metadata: Omit<SubAgentTaskFile, 'chat_history' | 'context_history'>): void;
  appendMessage(taskId: string, msg: Message, target: 'both' | 'context_only'): void;
  replaceContextHistory(taskId: string, compressed: Message[]): void;  // after compression
  completeTask(taskId: string, status: string, result?: string, error?: string): void;
  
  // Read operations
  getTaskFile(taskId: string): SubAgentTaskFile | null;
  listTasksForSession(parentSessionId: string): SubAgentTaskFile[];
  
  // Persistence
  flush(taskId: string): Promise<void>;             // write to disk
  flushIfDirty(taskId: string): Promise<void>;      // conditional
  loadFromDisk(taskId: string): Promise<SubAgentTaskFile | null>;
  
  // Cleanup
  deleteTasksForSession(parentSessionId: string): void;  // cascade on session delete
  purgeOlderThan(days: number): Promise<number>;         // retention policy
}
```

#### 11.2.4 SubAgentChat Integration

```typescript
// SubAgentChat — modified to write to SubAgentTaskStore

class SubAgentChat {
  private taskStore = SubAgentTaskStore.getInstance();

  async initialize(): Promise<void> {
    // Create task entry on spawn
    this.taskStore.createTask(this.taskId, {
      taskId: this.taskId,
      subAgentName: this.subAgentName,
      parentSessionId: this.options.parentSessionId,
      parentChatId: this.options.parentChatId,
      startTime: Date.now(),
      status: 'running',
      model: this.model,
      contextAccess: this.options.contextAccess || 'isolated',
      isAdhoc: this.options.isAdhoc || false,
      turnCount: 0,
    });
  }

  // Message append — dual write (same as AgentChat pattern)
  private appendMessage(msg: Message): void {
    this.contextHistory.push(msg);
    this.chatHistory.push(msg);
    this.taskStore.appendMessage(this.taskId, msg, 'both');
    
    // Also emit streaming chunk to frontend (if task is being watched)
    this.emitStreamingChunk(msg);
  }

  // After context compression — only context_history changes
  private onContextCompressed(compressed: Message[]): void {
    this.contextHistory = compressed;
    this.taskStore.replaceContextHistory(this.taskId, compressed);
  }

  // On completion
  private onComplete(result: string): void {
    this.taskStore.completeTask(this.taskId, 'completed', result);
  }
}
```

#### 11.2.5 Streaming to Frontend — IPC Channels

New IPC namespace `subAgentTask:*` paralleling `agentChat:*`:

| Channel | Payload | Purpose |
|---------|---------|---------|
| `subAgentTask:streamingChunk` | `SubAgentStreamingChunk` | Per-token/tool streaming |
| `subAgentTask:statusChanged` | `{ taskId, status, ... }` | Status transitions |
| `subAgentTask:cacheCreated` | `{ taskId, initialData: SubAgentTaskFile }` | Task opened in UI |
| `subAgentTask:cacheDestroyed` | `{ taskId }` | Task view closed |

```typescript
// Streaming chunk (mirrors StreamingChunk but keyed by taskId)
interface SubAgentStreamingChunk {
  chunkId: string;
  messageId: string;
  taskId: string;           // routing key (instead of chatSessionId)
  timestamp: number;
  type: 'content' | 'tool_call' | 'tool_result' | 'complete' | 'turn_start';
  contentDelta?: { text: string };
  toolCallDelta?: { index: number; id: string; function: { name: string; arguments: string } };
  toolResult?: { tool_call_id: string; tool_name: string; content: string; isError?: boolean };
  complete?: { messageId: string; hasToolCalls: boolean };
}
```

**Emission from SubAgentChat:**
```typescript
// SubAgentChat — streaming output
private emitStreamingChunk(chunk: SubAgentStreamingChunk): void {
  // Only emit if someone is watching (retain mode)
  const watcher = SubAgentTaskWatcherRegistry.getWatcher(this.taskId);
  if (watcher) {
    watcher.eventSender.send('subAgentTask:streamingChunk', chunk);
  }
}
```

**Watcher registry** (prevents streaming to no-one):
```typescript
// src/main/lib/subAgent/subAgentTaskWatcherRegistry.ts — NEW
// Tracks which tasks have an active frontend viewer
class SubAgentTaskWatcherRegistry {
  private watchers: Map<string, { eventSender: WebContents }> = new Map();
  
  watch(taskId: string, eventSender: WebContents): void;
  unwatch(taskId: string): void;
  getWatcher(taskId: string): { eventSender: WebContents } | undefined;
}
```

#### 11.2.6 Frontend Cache — `SubAgentTaskCacheManager`

Parallels `AgentChatSessionCacheManager`:

```typescript
// src/renderer/lib/subAgent/subAgentTaskCacheManager.ts — NEW

interface SubAgentTaskCache {
  taskId: string;
  parentSessionId: string;
  subAgentName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  messages: Message[];                   // Flat array from chat_history
  streamingMessageId: string | null;     // Currently streaming message
  model: string;
  startTime: number;
  endTime?: number;
  turnCount: number;
}

class SubAgentTaskCacheManager {
  private static instance: SubAgentTaskCacheManager;
  private taskCaches: Map<string, SubAgentTaskCache> = new Map();
  private directMessageUpdateCallbacks: Map<string, Set<DirectMessageUpdateCallback>> = new Map();

  // IPC handlers (registered once on init)
  handleStreamingChunk(chunk: SubAgentStreamingChunk): void;  // same logic as chat session
  handleCacheCreated(taskId: string, initialData: SubAgentTaskFile): void;
  handleCacheDestroyed(taskId: string): void;
  handleStatusChanged(taskId: string, status: string): void;

  // React subscription hooks
  getTaskCache(taskId: string): SubAgentTaskCache | null;
  subscribeToTask(taskId: string, callback: () => void): () => void;
  registerDirectMessageUpdate(taskId: string, cb: DirectMessageUpdateCallback): () => void;
}
```

**React hooks:**
```typescript
// src/renderer/hooks/useSubAgentTask.ts — NEW
function useSubAgentTaskMessages(taskId: string): Message[];
function useSubAgentTaskStatus(taskId: string): SubAgentTaskCache['status'];
function useSubAgentTaskStreamingMessage(taskId: string): { messages: Message[]; streamingMessageId: string | null };
```

#### 11.2.7 Task Loading Flow (User Opens a Sub-Agent Task View)

```
User clicks sub-agent task in UI
  │
  ▼
Renderer: IPC call → subAgentTask:open({ taskId })
  │
  ▼
Main process: SubAgentTaskStore.loadFromDisk(taskId) or getTaskFile(taskId)
  │
  ├── If task is still running: register watcher (start streaming to this renderer)
  └── Return full SubAgentTaskFile
  │
  ▼
Main process: eventSender.send('subAgentTask:cacheCreated', { taskId, initialData })
  │
  ▼
Renderer: SubAgentTaskCacheManager.handleCacheCreated(taskId, initialData)
  │
  ├── Create SubAgentTaskCache { messages: initialData.chat_history, ... }
  └── notify subscribers → React re-renders
  │
  ▼ (if task still running)
Main: SubAgentChat emits subAgentTask:streamingChunk per token
  → Renderer: handleStreamingChunk() updates cache.messages in-place
  → directMessageUpdateCallbacks fire → React re-renders per token
```

#### 11.2.8 Relationship to Chat Session Architecture

| Chat Session Component | Sub-Agent Task Equivalent |
|----------------------|--------------------------|
| `ChatSessionFile` (.json) | `SubAgentTaskFile` (.json) |
| `ChatSessionStore` (singleton, in-memory) | `SubAgentTaskStore` (singleton, in-memory) |
| `AgentChat.chatHistory[]` + `contextHistory[]` | `SubAgentChat.chatHistory[]` + `contextHistory[]` |
| `AgentChatOutputPort` (WebContents.send) | `SubAgentTaskWatcherRegistry` (conditional emit) |
| `agentChat:streamingChunk` IPC | `subAgentTask:streamingChunk` IPC |
| `AgentChatSessionCacheManager` | `SubAgentTaskCacheManager` |
| `ChatSessionCache.messages[]` | `SubAgentTaskCache.messages[]` |
| `useMessages()` hook | `useSubAgentTaskMessages(taskId)` hook |
| `agentChat:chatSessionCacheCreated` | `subAgentTask:cacheCreated` |

#### 11.2.9 Key Differences from Chat Sessions

| Aspect | Chat Session | Sub-Agent Task |
|--------|-------------|----------------|
| **Lifecycle owner** | User (create/delete manually) | System (created by spawn, auto-cleaned) |
| **Streaming always on** | Yes (always has active renderer) | Conditional (only when UI panel open) |
| **Context compression** | Same LLM compresses own history | Same — sub-agent compresses own context |
| **Retention** | Indefinite (user manages) | 30-day auto-purge |
| **Index structure** | Two-level (chat → month → sessions) | One-level (month → taskId files) |
| **Status machine** | IDLE → SENDING → RECEIVED → IDLE | running → completed/failed/cancelled |

#### 11.2.10 Cleanup Strategy

```typescript
// Retention: 30 days (configurable)
// Triggered: app startup (fire-and-forget)
// Method: delete entire month directory if all files in it are beyond cutoff

async function purgeOldTasks(userAlias: string): Promise<number> {
  const baseDir = path.join(getUserDataPath(), 'profiles', userAlias, 'sub-agent-tasks');
  const cutoffMonth = getMonthString(Date.now() - RETENTION_DAYS * 86400000);
  const months = await readdir(baseDir).catch(() => []);
  let deleted = 0;
  for (const month of months) {
    if (month < cutoffMonth) {
      await rm(path.join(baseDir, month), { recursive: true, force: true });
      deleted++;
    }
  }
  return deleted;
}
```

#### 11.2.11 Files to Create/Modify

| File | Action |
|------|--------|
| `subAgent/subAgentTaskStore.ts` | **CREATE** — persistence layer (parallels ChatSessionStore) |
| `subAgent/subAgentTaskTypes.ts` | **CREATE** — `SubAgentTaskFile`, `SubAgentStreamingChunk` types |
| `subAgent/subAgentTaskWatcherRegistry.ts` | **CREATE** — tracks which tasks have active UI viewers |
| `subAgent/subAgentTaskCleaner.ts` | **CREATE** — 30-day retention purge |
| `subAgent/subAgentChat.ts` | Add dual history (`chatHistory` + `contextHistory`), emit streaming chunks |
| `subAgent/subAgentManager.ts` | Pass task store to SubAgentChat, wire watcher on UI open |
| `shared/types/subAgentStreamingTypes.ts` | **CREATE** — `SubAgentStreamingChunk` shared type |
| `shared/ipc/channels.ts` | Add `subAgentTask:*` channel definitions |
| `renderer/lib/subAgent/subAgentTaskCacheManager.ts` | **CREATE** — frontend cache (parallels AgentChatSessionCacheManager) |
| `renderer/hooks/useSubAgentTask.ts` | **CREATE** — React subscription hooks |
| `preload/subAgentTaskBridge.ts` | **CREATE** — IPC bridge for sub-agent task channels |

---


### 11.3 Session→Task Lifecycle Binding

#### 11.3.1 The Bug

`AgentChatManager.disposeManagedInstance(chatSessionId)` cleans up:
- ✅ Status change listeners
- ✅ Interactive request manager
- ✅ Deferred tools context
- ✅ Session coordinator
- ❌ **Sub-agent tasks** — orphaned, keep running

#### 11.3.2 Fix

```typescript
// agentChatManager.ts — disposeManagedInstance() — add at end
SubAgentManager.getInstance().cancelAllForSession(chatSessionId);
```

```typescript
// subAgentManager.ts — NEW method
public cancelAllForSession(parentSessionId: string): void {
  // 1. Cancel all running chat instances
  const taskIds = this.parentChildMap.get(parentSessionId);
  if (taskIds) {
    for (const taskId of taskIds) {
      const chat = this.activeInstances.get(taskId);
      if (chat) {
        chat.cancel();
        chat.dispose();
      }
      this.activeInstances.delete(taskId);
      this.runtimeStates.delete(taskId);
      const timer = this.stateUpdateThrottles.get(taskId);
      if (timer) clearTimeout(timer);
      this.stateUpdateThrottles.delete(taskId);
      this.pendingStateUpdates.delete(taskId);
    }
  }

  // 2. Purge queues
  this.resultQueue.delete(parentSessionId);
  this.notificationQueue.delete(parentSessionId);
  this.parentChildMap.delete(parentSessionId);
  this.spawnCountMap.delete(parentSessionId);

  // 3. Clean backgroundTasks
  for (const [taskId, task] of this.backgroundTasks) {
    if (task.parentSessionId === parentSessionId) {
      this.backgroundTasks.delete(taskId);
    }
  }

  logger.info('[SubAgentManager] Cancelled all tasks for session', 'cancelAllForSession', {
    parentSessionId,
    cancelledCount: taskIds?.size || 0,
  });
}
```

#### 11.3.3 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Session disposed while sub-agent mid-turn | `chat.cancel()` triggers CancellationToken → graceful shutdown |
| Session disposed, sub-agent in tool execution | Tool execution aborts, partial result lost (acceptable — session is gone) |
| Session disposed, auto-wake in-flight | `pendingAutoWakes.delete(parentSessionId)` in dispose |
| Multiple rapid dispose calls | `parentChildMap.delete()` is idempotent, safe for re-entry |

#### 11.3.4 Files to Modify

| File | Change |
|------|--------|
| `subAgentManager.ts` | Add `cancelAllForSession()` method |
| `agentChatManager.ts` | Call `cancelAllForSession(chatSessionId)` in `disposeManagedInstance()` |

---

## 12. Batch 4 — Data Flow

```
Background SubAgent completes
  │
  ├── SubAgentManager.enqueueResult(parentSessionId, result)
  │     ├── resultQueue.push(result)
  │     └── this.emit('subAgentResultReady', { parentSessionId })
  │
  ▼ (500ms debounce)
AgentChatManager auto-wake listener
  │
  ├── GUARD: instance exists? IDLE? no pending wake? feature enabled?
  ├── Inject synthetic trigger message (metadata.synthetic=true)
  └── streamMessage(chatSessionId, trigger, { emitUserMessage: false })
        │
        ▼
AgentChat.streamMessage() → normal turn flow
  │
  ├── drainBackgroundSubAgentResults()
  │     → <task-notification> user message injected
  │     → synthetic trigger removed from contextHistory
  ├── LLM sees task-notification → processes results → responds
  └── setChatStatus(IDLE)
        │
        (user sees response in chat UI without having sent anything)


Session Deletion:
  AgentChatManager.disposeManagedInstance(chatSessionId)
    │
    ├── ...existing cleanup...
    ├── pendingAutoWakes.delete(chatSessionId)  // cancel pending wake
    └── SubAgentManager.cancelAllForSession(chatSessionId)
          ├── cancel + dispose all running SubAgentChats
          ├── purge resultQueue, notificationQueue
          └── purge parentChildMap, backgroundTasks
```

---

## 13. Batch 4 — Implementation Order

```
Phase 1 — Session→Task Lifecycle (P0 bug fix)            [~0.5 day]
  └─ cancelAllForSession() + integration in disposeManagedInstance()

Phase 2 — Sub-Agent Task Persistence Layer                [~3 days]
  ├─ SubAgentTaskFile type + SubAgentTaskStore singleton    [1d]
  ├─ SubAgentChat dual history (chatHistory + contextHistory) [0.5d]
  ├─ Write integration (createTask/appendMessage/complete)   [0.5d]
  ├─ Load from disk + cleanup                               [0.5d]
  └─ Tests                                                  [0.5d]

Phase 3 — Streaming to Frontend                           [~3 days]
  ├─ SubAgentStreamingChunk type + IPC channels             [0.5d]
  ├─ SubAgentTaskWatcherRegistry (conditional emit)         [0.5d]
  ├─ SubAgentChat streaming emission integration            [0.5d]
  ├─ SubAgentTaskCacheManager (renderer singleton)          [1d]
  ├─ React hooks (useSubAgentTaskMessages, etc.)            [0.25d]
  └─ Preload bridge + tests                                 [0.25d]

Phase 4 — Auto-Wake on Idle                               [~1.5 days]
  ├─ SubAgentManager extends EventEmitter + emit             [0.25d]
  ├─ AgentChatManager listener + debounce + guards           [0.5d]
  ├─ Synthetic trigger injection + cleanup                   [0.5d]
  └─ Feature flag + tests                                    [0.25d]
```

Total Batch 4 estimate: **~8 days**

---

## 14. Batch 4 — Testing Strategy

### Unit Tests

| Test | File |
|------|------|
| `cancelAllForSession()` cancels running instances | `subAgentManager.test.ts` |
| `cancelAllForSession()` purges all queues | `subAgentManager.test.ts` |
| `cancelAllForSession()` idempotent for deleted session | `subAgentManager.test.ts` |
| `enqueueResult()` emits `subAgentResultReady` | `subAgentManager.test.ts` |
| Auto-wake triggers when session IDLE | `agentChatManager.test.ts` |
| Auto-wake skipped when session not IDLE | `agentChatManager.test.ts` |
| Auto-wake debounces multiple completions | `agentChatManager.test.ts` |
| Auto-wake skipped when session disposed | `agentChatManager.test.ts` |
| Synthetic trigger removed after drain | `agentChat.test.ts` |
| `SubAgentTaskStore.createTask()` persists to disk | `subAgentTaskStore.test.ts` |
| `SubAgentTaskStore.appendMessage()` writes to both histories | `subAgentTaskStore.test.ts` |
| `SubAgentTaskStore.replaceContextHistory()` only changes context | `subAgentTaskStore.test.ts` |
| `SubAgentTaskStore.loadFromDisk()` returns full file | `subAgentTaskStore.test.ts` |
| `SubAgentTaskStore.purgeOlderThan()` deletes old months | `subAgentTaskStore.test.ts` |
| Watcher registry: emit only when watched | `subAgentTaskWatcherRegistry.test.ts` |
| `SubAgentTaskCacheManager.handleStreamingChunk()` updates messages | `subAgentTaskCacheManager.test.ts` |
| `SubAgentTaskCacheManager.handleCacheCreated()` loads snapshot | `subAgentTaskCacheManager.test.ts` |

### Integration Tests

- Session dispose → all running sub-agents cancelled → no orphans
- Background agent completes → auto-wake fires → user sees response without sending message
- Multiple agents complete within 500ms → single auto-wake turn
- Sub-agent runs → task file persisted → reload from disk matches in-memory
- User opens running sub-agent task → streaming chunks flow to renderer
- Sub-agent crash mid-run → partial task file on disk → loadable with messages up to crash point
- Context compression in sub-agent → chat_history unchanged, context_history compressed
