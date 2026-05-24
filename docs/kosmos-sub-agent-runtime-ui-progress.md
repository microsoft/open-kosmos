# OpenKosmos Sub-Agent Runtime UI Progress Display — Technical Implementation Document

> Version: 1.2.0 | Date: 2026-03-02 | Based on OpenKosmos v1.21.8 Architecture
>
> **Parent Document**: [`docs/kosmos-sub-agent-tech-doc.md`](./kosmos-sub-agent-tech-doc.md) (§4.2 SubAgentChat, §4.3 spawn_subagent, §5.3 ChatView Sub-Agent State Display)
>
> **Scope**: This document is a sub-document of `kosmos-sub-agent-tech-doc.md`, focusing on **real-time UI display of Sub-Agent runtime progress information** (Approach A: Extending `subAgent:stateUpdate` IPC)
>
> **v1.2.0 Change Summary** (Based on Tech Review Revisions):
> - 🔧 Introduced `correlationId` (= `toolCall.id`) to replace `subAgentName` as the Renderer-side matching key, completely resolving parallel same-name sub-agent conflicts
> - 🔧 Added IPC throttling mechanism (100ms throttle); terminal state events are sent immediately
> - 🔧 Removed redundant frontend steps merge logic (backend already handles deduplication), simplifying `SubAgentStepsList`
> - 🔧 Switched to `runtimeState.status` for success/failure determination, replacing fragile string matching
> - 🔧 Changed `summarizeToolArgs()` to a generic approach based on parameter semantics, eliminating hardcoded tool names
> - 🔧 Switched CSS to Tailwind utility classes + `@apply` combinations, consistent with project conventions
> - 🔧 Downgraded §10 persistence-ready design to Future Work appendix (Appendix C); v1 will not implement double buffering or `SubAgentExecutionRecord` construction
> - 🔧 Extended `SubAgentStep.type` to an open union type, reserving `context_compression` / `turn_start` and other future events
> - 🔧 Included `ToolExecutionContext` static global concurrency risk in §8.2 Known Limitations
> - 🔧 Adjusted Phase 4 testing estimate from 0.5 days to 1 day

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [Approach Selection](#2-approach-selection)
3. [Data Model Extensions](#3-data-model-extensions)
4. [Backend Changes — Main Process](#4-backend-changes--main-process)
   - 4.1 [ToolExecutionContext Extension](#41-toolexecutioncontext-extension)
   - 4.2 [SubAgentChatOptions Callback Signature Extension](#42-subagentchatoptions-callback-signature-extension)
   - 4.3 [SubAgentChat Conversation Loop Progress Event Injection](#43-subagentchat-conversation-loop-progress-event-injection)
   - 4.4 [SubAgentManager Assembling Enriched State and Sending IPC](#44-subagentmanager-assembling-enriched-state-and-sending-ipc)
   - 4.5 [SpawnSubAgentTool Passing Through eventSender](#45-spawnsubagenttool-passing-through-eventsender)
5. [Frontend Changes — Renderer Process](#5-frontend-changes--renderer-process)
   - 5.1 [SubAgentToolCallView Real-Time Progress Rendering](#51-subagenttoollcallview-real-time-progress-rendering)
   - 5.2 [ParallelSubAgentsToolCallView Parallel Progress](#52-parallelsubagentstoollcallview-parallel-progress)
6. [End-to-End Data Flow](#6-end-to-end-data-flow)
7. [UI Interaction Design](#7-ui-interaction-design)
8. [Impact Scope and Risk Assessment](#8-impact-scope-and-risk-assessment)
9. [Implementation Steps](#9-implementation-steps)
**Appendices**
- A. [Mapping to Parent Document](#a-mapping-to-parent-document)
- B. [Existing Infrastructure Reuse Table](#b-existing-infrastructure-reuse-table)
- C. [Persistence-Ready Design (Future Work)](#c-persistence-ready-designfuture-work)

---

## 1. Problem Analysis

### 1.1 Current State

Sub-Agents execute via the `spawn_subagent` tool call. The current UI display is **purely binary**:

```
User perspective:
  🤖 Sub-Agent: web-researcher     ⏳ Running    ← May last several minutes with no intermediate info
      Task: xxxxxx
      ...(long blank wait)...
  🤖 Sub-Agent: web-researcher     ✅ Done       ← Complete result appears suddenly
      RESULT: 38,945-byte research report
```

**Root cause**: `SubAgentChat.run()` is a black box returning `Promise<string>` — internally it may run 10+ rounds of tool calls (search, fetch web pages, read files...), but all intermediate data stays in main process memory, invisible to the renderer.

### 1.2 Gap Analysis

| Component | Existing | Missing |
|------|------|------|
| `SubAgentChat.onTurnComplete(turn, text)` callback | ✅ Triggered each turn | ❌ No tool call info (only turn count + text) |
| `SubAgentManager.onProgress(state)` callback | ✅ Parameter defined | ❌ `SpawnSubAgentTool` never passes this callback |
| `SubAgentRuntimeState` data structure | ✅ Defined | ❌ Only has `taskId/name/status/currentTurn`, missing tool + text info |
| `subAgent:stateUpdate` IPC channel | ✅ Defined in preload | ❌ Main process never sends this event |
| `SubAgentToolCallView` component | ✅ Implemented | ❌ No subscription capability, purely passive display |
| `ToolExecutionContext` | ✅ Implemented | ❌ Does not contain `eventSender` (`WebContents`) reference |

### 1.3 Goals

During Sub-Agent execution, **display in real-time** within `SubAgentToolCallView`:

1. **Turn progress**: Current turn / max turns
2. **Tool call log**: Each called tool's name + execution status (running / done / error)
3. **Text summary**: First two lines of the most recent LLM text output

---

## 2. Approach Selection

### 2.1 Approach Comparison

| Dimension | Approach A: Extend stateUpdate IPC | Approach B: Reuse StreamingChunk Pipeline | Approach C: Global BrowserWindow Send |
|------|---------------------------|-------------------------------|------------------------------|
| IPC Channel | Reuse existing `subAgent:stateUpdate` | Reuse `agentChat:streamingChunk` | Create new or obtain globally |
| Data Isolation | Independent channel, no streaming interference | Mixed into parent streaming pipeline | Independent but coupled to Electron API |
| Impact on StreamingChunk | None | Requires extending `type` enum, broad impact | None |
| SubAgentChat Change Volume | Extend callback parameters | Needs eventSender + send chunk | Directly import BrowserWindow |
| Architecture Compliance | ✅ Follows Manager + IPC pattern | ⚠️ Blurs parent/child streaming boundary | ❌ Violates Manager-should-not-operate-UI convention |
| Multi-Window Safety | ✅ Precisely targeted via eventSender | ✅ | ❌ Requires iterating windows |
| Testability | ✅ Callbacks can be mocked | ⚠️ Requires mocking chunk processing chain | ❌ Depends on Electron globals |

### 2.2 Selected Approach

**Approach A: Extend `subAgent:stateUpdate` IPC**

Core idea:

```
SubAgentChat          SubAgentManager           SpawnSubAgentTool        Renderer
    │                      │                          │                    │
    │ onStepUpdate(info) → │                          │                    │
    │                      │ enriched state →          │                    │
    │                      │                  eventSender.send() →         │
    │                      │                          │   subAgent:stateUpdate
    │                      │                          │                    │
    │                      │                          │            SubAgentToolCallView
    │                      │                          │              Subscribe + render progress
```

**Selection rationale**:

1. `subAgent:stateUpdate` channel is already defined in preload; no new IPC channel needed
2. Independent from the parent streaming pipeline, with clear architectural boundaries
3. Minimal intrusion into existing code (no changes to StreamingChunk types)
4. `eventSender` is passed through `ToolExecutionContext`, reusing the existing injection mechanism

---

## 3. Data Model Extensions

### 3.1 SubAgentRuntimeState Extension

> File location: `src/main/lib/userDataADO/types/profile.ts`

```typescript
/**
 * Sub-agent runtime step information 🆕
 * Records each key step during sub-agent execution (tool calls, text output)
 *
 * Designed to be JSON-safe and self-contained, can be serialized to disk directly.
 */
export interface SubAgentStep {
  /**
   * Step type (open union type for future extensibility, e.g., 'context_compression' | 'turn_start')
   */
  type: 'tool_start' | 'tool_done' | 'tool_error' | 'text' | string;
  /** Tool name (when type is tool_*) */
  toolName?: string;
  /** Tool call ID (when type is tool_*, used for deduplication updates) */
  toolCallId?: string;
  /** Brief summary/error message */
  summary?: string;
  /** Timestamp */
  timestamp: number;
  /** Tool arguments summary (brief description of call intent, ≤200 chars, valuable for real-time UI and future persistence replay) */
  toolArgsSummary?: string;
  /** Tool result character count (used to show execution scale) */
  toolResultLength?: number;
  /** Tool execution duration (ms), populated for tool_done/tool_error */
  durationMs?: number;
}

/**
 * Sub-agent runtime state (extended version) - Modified
 * Used to track sub-agent execution progress, pushed to Renderer via IPC for display
 */
export interface SubAgentRuntimeState {
  taskId: string;
  subAgentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  currentTurn: number;
  // ── 🆕 v1.2.0 new fields ──
  /** Correlation ID (= parent toolCall.id), used by Renderer to precisely match stateUpdate with the corresponding ToolCallView */
  correlationId?: string;
  /** Maximum number of turns (used for progress percentage display) */
  maxTurns: number;
  /** Execution step list (in chronological order, keeps most recent MAX_STEPS_IN_STATE entries to prevent IPC message bloat) */
  steps: SubAgentStep[];
  /** Most recent LLM text output snippet (truncated to ≤2 lines, ≤200 characters) */
  lastTextSnippet?: string;
}
```

### 3.2 SubAgentChatOptions Callback Signature Extension

> File location: `src/main/lib/subAgent/types.ts`

```typescript
/**
 * Sub-agent step update information 🆕
 * Called back with this structure each time SubAgentChat executes a tool or receives text
 */
export interface SubAgentStepUpdate {
  /** Current turn */
  turn: number;
  /** Step details */
  step: SubAgentStep;
  /** Latest text snippet (max two lines) */
  lastTextSnippet?: string;
}

export interface SubAgentChatOptions {
  subAgent: SubAgent;
  task: string;
  parentContext?: string;
  cancellationToken: CancellationToken;
  /** Turn complete callback (original signature preserved, backward compatible) */
  onTurnComplete?: (turn: number, lastMessage: string) => void;
  /** 🆕 Step-level progress callback — finer granularity than onTurnComplete, triggered on each tool call start/end */
  onStepUpdate?: (update: SubAgentStepUpdate) => void;
  deliverablesPath?: string;
  currentUserAlias: string;
}
```

### 3.3 ToolExecutionContext Extension

> File location: `src/main/lib/subAgent/types.ts`

```typescript
export interface ToolExecutionContext {
  chatSessionId: string;
  chatId: string;
  userAlias: string;
  cancellationToken: CancellationToken;
  isSubAgent: boolean;
  getSubAgentConfig(name: string): SubAgentConfig | undefined;
  getParentContextSummary(): Promise<string>;
  // ── 🆕 New addition ──
  /** Electron WebContents reference (optional), used to send IPC events to renderer */
  eventSender?: Electron.WebContents;
}
```

**Design decision**: `eventSender` is set as an optional field (`?`):
- Injected when the main AgentChat calls tools (always has a value)
- Not injected when SubAgentChat calls tools (sub-agent's `ToolExecutionContext` has `isSubAgent=true`, no need to send UI events)
- Does not affect type checking of existing tools

### 3.4 Constant Definitions

```typescript
// Recommended to be defined in src/main/lib/subAgent/constants.ts

/** Max steps list length — prevents IPC message bloat from long-running sub-agents */
const MAX_STEPS_IN_STATE = 30;

/** Max characters for lastTextSnippet */
const MAX_TEXT_SNIPPET_CHARS = 200;

/** Max lines for lastTextSnippet */
const MAX_TEXT_SNIPPET_LINES = 2;

/** IPC throttle interval (ms) — prevents burst re-renders in Renderer from rapid tool calls; terminal state events are not subject to this limit */
const STATE_UPDATE_THROTTLE_MS = 100;
```

---

## 4. Backend Changes — Main Process

### 4.1 ToolExecutionContext Extension

> File: `src/main/lib/subAgent/types.ts`
> Change: New `eventSender?` field added to interface (see §3.3)

> File: `src/main/lib/chat/agentChat.ts` (`executeToolCall` method ~line 3599)
> Change: Inject `this.eventSender` into context

```typescript
// agentChat.ts — setExecutionContext call in executeToolCall()
// 🔧 Modification: Added eventSender injection (1-line change)

BuiltinToolsManager.setExecutionContext({
  chatSessionId: this.chatSessionId,
  chatId: this.chatId,
  userAlias: this.currentUserAlias,
  cancellationToken: this.getCancellationToken() ?? CancellationTokenStatic.None,
  isSubAgent: false,
  getSubAgentConfig: (name: string) => this.getSubAgentConfig(name),
  getParentContextSummary: async () => this.getContextSummary(),
  eventSender: this.eventSender ?? undefined,  // 🆕 Pass through WebContents
});
```

**Impact assessment**: Only adds one optional field assignment; existing tools are completely unaffected (no impact if they don't use this field).

---

### 4.2 SubAgentChatOptions Callback Signature Extension

> File: `src/main/lib/subAgent/types.ts`
> Change: Added `SubAgentStepUpdate` interface + `onStepUpdate?` callback (see §3.2)

Backward compatible: `onTurnComplete` is preserved unchanged; `onStepUpdate` is a new optional callback.

---

### 4.3 SubAgentChat Conversation Loop Progress Event Injection

> File: `src/main/lib/subAgent/subAgentChat.ts`

Progress event `onStepUpdate` callbacks are injected at two key locations:

> **Semantic convention**: The `turn` field in `onStepUpdate` represents "the turn currently in progress" (1-based),
> which has a +1 offset from `onTurnComplete`'s `turn` (number of completed turns). This is intentional —
> step events occur during turn execution, while onTurnComplete fires after the turn ends.

#### 4.3.1 `executeToolCalls()` — Before and After Tool Execution

```typescript
// subAgentChat.ts — executeToolCalls() method
// Insert onStepUpdate callback before and after each toolCall in the for loop

private async executeToolCalls(toolCalls: any[]): Promise<Message[]> {
  const results: Message[] = [];

  // ... existing BuiltinToolsManager.setExecutionContext(...) ...

  try {
    for (const toolCall of toolCalls) {
      if (this.options.cancellationToken.isCancellationRequested) { /* ... */ }

      // 🆕 Step update: tool starts executing
      const toolStartTime = Date.now();
      this.options.onStepUpdate?.({
        turn: this.turnCount + 1,
        step: {
          type: 'tool_start',
          toolName: toolCall.function.name,
          toolCallId: toolCall.id,
          toolArgsSummary: this.summarizeToolArgs(toolCall.function.name, toolArgs),
          timestamp: toolStartTime,
        },
      });

      try {
        // ... existing toolArgs parsing + mcpClientManager.executeTool() ...
        const toolResult = await mcpClientManager.executeTool({ toolName, toolArgs });

        // ... existing compressToolResult logic ...

        // 🆕 Step update: tool executed successfully
        const toolEndTime = Date.now();
        this.options.onStepUpdate?.({
          turn: this.turnCount + 1,
          step: {
            type: 'tool_done',
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
            summary: `Result: ${resultContent.length} chars`,
            timestamp: toolEndTime,
            durationMs: toolEndTime - toolStartTime,
            toolResultLength: resultContent.length,
          },
        });

        results.push(MessageHelper.createToolMessage(resultContent, toolCall.id, toolCall.function.name));

      } catch (error) {
        // 🆕 Step update: tool execution failed
        const toolErrorTime = Date.now();
        this.options.onStepUpdate?.({
          turn: this.turnCount + 1,
          step: {
            type: 'tool_error',
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
            summary: error instanceof Error ? error.message : String(error),
            timestamp: toolErrorTime,
            durationMs: toolErrorTime - toolStartTime,
          },
        });

        results.push(/* ... existing error message ... */);
      }
    }
  } finally {
    BuiltinToolsManager.clearExecutionContext();
  }
  return results;
}
```

#### 4.3.2 `run()` Conversation Loop — After LLM Text Output

```typescript
// subAgentChat.ts — run() method
// After response processing (whether tool calls or text-only), send text summary step

// ... Insert before existing this.options.onTurnComplete?.(this.turnCount, response.textContent):

if (response.textContent) {
  // 🆕 Step update: text output (truncated to max two lines)
  const snippet = truncateToLines(response.textContent, 2, 200);
  this.options.onStepUpdate?.({
    turn: this.turnCount + 1,
    step: {
      type: 'text',
      summary: snippet,
      timestamp: Date.now(),
    },
    lastTextSnippet: snippet,
  });
}

this.turnCount++;
this.options.onTurnComplete?.(this.turnCount, response.textContent);
```

#### 4.3.3 Text Truncation Helper Function

```typescript
// subAgentChat.ts — file top-level or utility function area

/**
 * Truncate text to specified number of lines and characters
 * Used for concise text summaries in UI display
 */
function truncateToLines(text: string, maxLines: number, maxChars: number): string {
  if (!text) return '';
  const lines = text.split('\n').filter(l => l.trim());
  const truncatedLines = lines.slice(0, maxLines);
  let result = truncatedLines.join('\n');
  if (result.length > maxChars) {
    result = result.substring(0, maxChars - 3) + '...';
  } else if (lines.length > maxLines) {
    result += '...';
  }
  return result;
}
```

#### 4.3.4 Tool Arguments Summary Helper Function

```typescript
// subAgentChat.ts — as a private method of SubAgentChat

/**
 * Generate a brief human-readable summary of tool call arguments
 *
 * Uses generic matching based on parameter semantics, no hardcoded tool names needed.
 * Prioritizes common parameter names (query/url/path/command etc.), falls back to first string parameter.
 *
 * @returns Brief description (≤200 characters), e.g., "bing_web_search: GitHub Copilot CLI" or "write_file: /src/index.ts"
 */
private summarizeToolArgs(toolName: string, toolArgs: Record<string, unknown>): string {
  const MAX_LEN = 200;
  const PRIORITY_KEYS = ['query', 'url', 'path', 'file_path', 'command', 'content'];
  try {
    const key = PRIORITY_KEYS.find(k => typeof toolArgs[k] === 'string');
    const value = key
      ? String(toolArgs[key])
      : Object.values(toolArgs).find(v => typeof v === 'string') as string | undefined;
    if (value) {
      return truncateToLines(`${toolName}: ${value}`, 1, MAX_LEN);
    }
    return toolName;
  } catch {
    return toolName;
  }
}
```

---

### 4.4 SubAgentManager Assembling Enriched State and Sending IPC

> File: `src/main/lib/subAgent/subAgentManager.ts`

#### 4.4.1 spawnSubAgent Refactoring — Receiving eventSender + Registering onStepUpdate

```typescript
// subAgentManager.ts — spawnSubAgent() method signature extension

public async spawnSubAgent(params: {
  parentSessionId: string;
  parentChatId: string;
  userAlias: string;
  subAgentName: string;
  task: string;
  parentContext?: string;
  cancellationToken: CancellationToken;
  onProgress?: (state: SubAgentRuntimeState) => void;
  eventSender?: Electron.WebContents;  // 🆕 Used to send progress IPC to renderer
  correlationId?: string;              // 🆕 Associated with parent toolCall.id, used for precise Renderer matching
}): Promise<SubAgentTaskResult> {
```

#### 4.4.2 runtimeStates Initialization Extension (with new fields)

```typescript
// In ── 6. Register to tracking table ──, initialize the extended runtimeState:

this.runtimeStates.set(taskId, {
  taskId,
  subAgentName: params.subAgentName,
  status: 'running',
  startTime,
  currentTurn: 0,
  correlationId: params.correlationId,                                         // 🆕
  maxTurns: subAgentConfig.max_turns || SUB_AGENT_LIMITS.DEFAULT_MAX_TURNS,  // 🆕
  steps: [],                                                                   // 🆕
  lastTextSnippet: undefined,                                                  // 🆕
});
```

#### 4.4.3 SubAgentChat Construction — Registering Dual Callbacks

```typescript
// In ── 5. Create SubAgentChat instance ──:

const chat = new SubAgentChat({
  subAgent,
  task: params.task,
  parentContext: params.parentContext,
  deliverablesPath,
  cancellationToken: params.cancellationToken,
  currentUserAlias: params.userAlias,

  // Original callback — preserved
  onTurnComplete: (turn, lastMessage) => {
    const state = this.runtimeStates.get(taskId);
    if (state) {
      state.currentTurn = turn;
      state.status = 'running';
    }
    params.onProgress?.(this.runtimeStates.get(taskId)!);
  },

  // 🆕 Step-level callback — assemble enriched state + send IPC
  onStepUpdate: (update) => {
    const state = this.runtimeStates.get(taskId);
    if (!state) return;

    // Update steps list (deduplicate tool_start → tool_done/tool_error for the same tool using toolCallId)
    if (update.step.type === 'tool_done' || update.step.type === 'tool_error') {
      // Replace the tool_start with the same toolCallId with the completion event
      const existingIdx = state.steps.findIndex(
        s => s.toolCallId === update.step.toolCallId && s.type === 'tool_start'
      );
      if (existingIdx >= 0) {
        state.steps[existingIdx] = update.step;
      } else {
        state.steps.push(update.step);
      }
    } else {
      state.steps.push(update.step);
    }

    // Keep IPC steps list bounded (FIFO eviction)
    if (state.steps.length > MAX_STEPS_IN_STATE) {
      state.steps = state.steps.slice(-MAX_STEPS_IN_STATE);
    }

    // Update text summary
    if (update.lastTextSnippet) {
      state.lastTextSnippet = update.lastTextSnippet;
    }

    // Update turn
    state.currentTurn = update.turn;

    // 🔑 Send IPC to renderer via eventSender (with throttling)
    this.sendStateUpdate(params.eventSender, state);
  },
});
```

#### 4.4.4 sendStateUpdate Helper Method

```typescript
// subAgentManager.ts — new private method

/** Throttle timers (indexed by taskId) */
private stateUpdateThrottles = new Map<string, NodeJS.Timeout>();

/**
 * Safely send sub-agent state update to Renderer
 *
 * Uses safeSend pattern (isDestroyed check) + throttling (100ms):
 * - Does not throw when WebContents is destroyed
 * - Serialization-safe (SubAgentRuntimeState contains only JSON-safe fields)
 * - Terminal state events (completed/failed/cancelled) are sent immediately, not subject to throttling
 *
 * @param force - When true, skips throttling (used for terminal state events)
 */
private sendStateUpdate(
  eventSender: Electron.WebContents | undefined,
  state: SubAgentRuntimeState,
  force = false
): void {
  if (!eventSender) return;

  // Throttle logic: in non-force mode, send at most once per 100ms
  if (!force) {
    const key = state.taskId;
    if (this.stateUpdateThrottles.has(key)) return;
    this.stateUpdateThrottles.set(key, setTimeout(() => {
      this.stateUpdateThrottles.delete(key);
    }, STATE_UPDATE_THROTTLE_MS));
  }

  try {
    if (!eventSender.isDestroyed()) {
      eventSender.send('subAgent:stateUpdate', state);
    }
  } catch (err) {
    // Non-fatal — WebContents may be destroyed at the moment of sending
    getLogger().warn?.(
      `[SubAgentManager] Failed to send stateUpdate: ${err instanceof Error ? err.message : String(err)}`,
      'sendStateUpdate'
    );
  }
}
```

#### 4.4.5 Sending Final State on Completion / Failure + Building Execution Record

```typescript
// spawnSubAgent() — Send terminal state update before returning SubAgentTaskResult

// ── 8. Success — update state and return ──
const runtimeState = this.runtimeStates.get(taskId);
if (runtimeState) {
  runtimeState.status = 'completed';
  runtimeState.endTime = Date.now();
  this.sendStateUpdate(params.eventSender, runtimeState, true);  // 🆕 force=true, send terminal state immediately
}

return {
  subAgentName: params.subAgentName,
  taskId,
  success: true,
  result: this.sanitizeSubAgentResult(resultText),
  turnCount: chat.getTurnCount(),
  durationMs: Date.now() - startTime,
};

// ── Error handling ──
// Same pattern in catch block:
if (runtimeState) {
  runtimeState.status = params.cancellationToken.isCancellationRequested ? 'cancelled' : 'failed';
  runtimeState.endTime = Date.now();
  this.sendStateUpdate(params.eventSender, runtimeState, true);  // 🆕 force=true
}
```

---

### 4.5 SpawnSubAgentTool Passing Through eventSender

> File: `src/main/lib/mcpRuntime/builtinTools/spawnSubAgentTool.ts`

#### 4.5.1 SpawnSubAgentTool.execute() Refactoring

```typescript
// spawnSubAgentTool.ts — SpawnSubAgentTool.execute()
// 🔧 Modification: Extract eventSender from ToolExecutionContext, pass through to SubAgentManager

static async execute(args: {
  sub_agent_name: string;
  task: string;
  share_context?: boolean;
}): Promise<ToolExecutionResult> {
  try {
    const context = BuiltinToolsManager.getExecutionContext();
    if (!context) { /* ... existing error handling ... */ }
    if (context.isSubAgent) { /* ... existing recursion guard ... */ }

    // ... existing subAgentConfig retrieval + parentContext construction ...

    const result = await manager.spawnSubAgent({
      parentSessionId: context.chatSessionId,
      parentChatId: context.chatId,
      userAlias: context.userAlias,
      subAgentName: args.sub_agent_name,
      task: args.task,
      parentContext,
      cancellationToken: context.cancellationToken,
      eventSender: context.eventSender,      // 🆕 Pass through WebContents
      correlationId: toolCall.id,             // 🆕 Pass parent toolCall.id as correlation key
    });

    // ... existing result handling ...
  }
}
```

#### 4.5.2 SpawnMultipleSubAgentsTool.execute() Refactoring

```typescript
// spawnSubAgentTool.ts — SpawnMultipleSubAgentsTool.execute()
// 🔧 Modification: Pass through eventSender as well

// spawnMultipleSubAgents() needs its signature extended synchronously to accept eventSender
const results = await manager.spawnMultipleSubAgents({
  parentSessionId: context.chatSessionId,
  parentChatId: context.chatId,
  userAlias: context.userAlias,
  tasks: args.tasks.map(t => ({
    subAgentName: t.sub_agent_name,
    task: t.task,
  })),
  cancellationToken: context.cancellationToken,
  eventSender: context.eventSender,  // 🆕
  correlationId: toolCall.id,        // 🆕 Parallel scenario needs additional handling, see spawnMultipleSubAgents below
});
```

#### 4.5.3 SubAgentManager.spawnMultipleSubAgents() Pass-Through

```typescript
// subAgentManager.ts — spawnMultipleSubAgents() method
// 🔧 Modification: Receive eventSender and pass through to each spawnSubAgent call

public async spawnMultipleSubAgents(params: {
  // ... existing parameters ...
  eventSender?: Electron.WebContents;  // 🆕
  correlationId?: string;              // 🆕 Parent toolCall.id (used to generate independent correlationId for each subtask)
}): Promise<SubAgentTaskResult[]> {
  // ... In each spawnSubAgent call within Promise.allSettled():
  // In parallel scenarios, each subtask uses `{parentCorrelationId}_{index}` as correlationId
  return this.spawnSubAgent({
    // ... existing parameters ...
    eventSender: params.eventSender,  // 🆕
    correlationId: `${params.correlationId}_${index}`,  // 🆕 Unique per subtask
  });
}
```

---

## 5. Frontend Changes — Renderer Process

### 5.1 SubAgentToolCallView Real-Time Progress Rendering

> File: `src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx`

#### 5.1.1 Subscribing to `subAgent:stateUpdate` IPC

```tsx
// SubAgentToolCallView.tsx — Refactored to support real-time progress

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ToolCallViewProps } from './types';
import { MessageHelper } from '../../../types/chatTypes';
import type { SubAgentRuntimeState, SubAgentStep } from '../../../../shared/types/subAgent';

// ... existing parseArgs function preserved ...

export const SubAgentToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = useMemo(() => parseArgs(toolCall.function.arguments), [toolCall.function.arguments]);
  const subAgentName = (args.sub_agent_name as string) || 'Unknown';
  const task = (args.task as string) || 'No task description';
  const shareContext = args.share_context as boolean | undefined;

  // 🆕 Real-time progress state
  const [runtimeState, setRuntimeState] = useState<SubAgentRuntimeState | null>(null);

  // 🆕 Remember terminal status (used for accurate success/failure determination, replacing fragile string matching)
  const [finalStatus, setFinalStatus] = useState<'completed' | 'failed' | 'cancelled' | null>(null);

  // 🆕 Subscribe to subAgent:stateUpdate IPC, using toolCall.id as correlationId for precise matching
  useEffect(() => {
    // Only subscribe while tool is executing (not completed)
    if (toolResult) return;

    const cleanup = window.electronAPI.subAgent.onStateUpdate((state: SubAgentRuntimeState) => {
      // Use correlationId (= toolCall.id) for precise matching, completely resolving parallel same-name sub-agent conflicts
      if (state.correlationId === toolCall.id) {
        setRuntimeState(state);
        // Remember terminal status
        if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
          setFinalStatus(state.status);
        }
      }
    });

    return cleanup;
  }, [toolCall.id, toolResult]);

  // 🆕 Clear real-time state after tool execution completes (show final result)
  useEffect(() => {
    if (toolResult) {
      setRuntimeState(null);
    }
  }, [toolResult]);

  // ② Parse execution result text
  const resultText = useMemo(() => {
    if (!toolResult) return null;
    return MessageHelper.getText(toolResult);
  }, [toolResult]);

  // ③ Determine execution status — use runtimeState.status for precise determination, not string matching
  const isRunning = toolResult === null;
  const isSuccess = finalStatus === 'completed' || (resultText !== null && finalStatus === null);
  const isError = finalStatus === 'failed' || finalStatus === 'cancelled';

  return (
    <div className="sub-agent-tool-call-view">
      {/* Header — 🔧 Extended: show turn progress */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">🤖</span>
        <span className="sub-agent-tool-label">
          Sub-Agent: <strong>{subAgentName}</strong>
        </span>
        <span className={`sub-agent-status-badge ${isRunning ? 'running' : isSuccess ? 'success' : 'error'}`}>
          {isRunning
            ? runtimeState
              ? `⏳ Turn ${runtimeState.currentTurn}/${runtimeState.maxTurns}`
              : '⏳ Starting...'
            : isSuccess ? '✅ Done' : '❌ Failed'}
        </span>
      </div>

      {/* Task */}
      <div className="sub-agent-tool-task">
        <span className="sub-agent-task-label">Task:</span>
        <span className="sub-agent-task-text">{task}</span>
      </div>

      {shareContext && (
        <div className="sub-agent-context-badge">📋 Context shared with sub-agent</div>
      )}

      {/* 🆕 Real-time progress area (shown only during execution) — using Tailwind for project convention consistency */}
      {isRunning && runtimeState && runtimeState.steps.length > 0 && (
        <div className="mt-2 px-3 py-2 bg-white/[0.03] rounded-md border-l-2 border-blue-400">
          <SubAgentStepsList steps={runtimeState.steps} />
          {runtimeState.lastTextSnippet && (
            <div className="mt-1 pt-1 border-t border-white/[0.06] text-xs text-zinc-400 whitespace-pre-line line-clamp-2">
              💬 {runtimeState.lastTextSnippet}
            </div>
          )}
        </div>
      )}

      {/* Result — preserve original logic */}
      {resultText && (
        <div className="sub-agent-tool-result">
          <div className="sub-agent-result-divider">Result</div>
          <div className="sub-agent-result-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
```

#### 5.1.2 SubAgentStepsList Sub-Component

```tsx
/**
 * Sub-agent steps list component
 * Displays tool call progress and text output
 *
 * Note: The backend SubAgentManager already handles in-place replacement of tool_start → tool_done/tool_error,
 * so the frontend does not need to merge again — just filter and render directly.
 */
const SubAgentStepsList: React.FC<{ steps: SubAgentStep[] }> = ({ steps }) => {
  // Filter out text-type steps (displayed via lastTextSnippet), show only tool calls
  const toolSteps = useMemo(() => steps.filter(s => s.type !== 'text'), [steps]);

  return (
    <div className="flex flex-col gap-0.5">
      {toolSteps.map((step, idx) => (
        <div key={step.toolCallId || idx} className="flex items-center gap-1.5 text-xs text-zinc-400 leading-5">
          <span className="w-3.5 text-center flex-shrink-0">
            {step.type === 'tool_start' && '⏳'}
            {step.type === 'tool_done' && '✓'}
            {step.type === 'tool_error' && '✗'}
          </span>
          <span className="font-mono text-[11px]">{step.toolName}</span>
          {step.type === 'tool_start' && (
            <span className="text-zinc-500 italic text-[11px]">running...</span>
          )}
          {step.durationMs !== undefined && step.type !== 'tool_start' && (
            <span className="text-zinc-500 text-[10px]">({step.durationMs}ms)</span>
          )}
        </div>
      ))}
    </div>
  );
};
```

### 5.2 ParallelSubAgentsToolCallView Parallel Progress

> File: `src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx`

Progress display logic for parallel scenarios:

```tsx
export const ParallelSubAgentsToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = useMemo(() => parseArgs(toolCall.function.arguments), [toolCall.function.arguments]);
  const tasks = (args.tasks as Array<{ sub_agent_name: string; task: string }>) || [];

  // 🆕 Real-time progress state — indexed by correlationId (resolves parallel same-name sub-agent conflicts)
  const [stateMap, setStateMap] = useState<Map<string, SubAgentRuntimeState>>(new Map());

  useEffect(() => {
    if (toolResult) return;

    const cleanup = window.electronAPI.subAgent.onStateUpdate((state: SubAgentRuntimeState) => {
      // In parallel scenarios, correlationId format is `{toolCall.id}_{index}`
      // Match all sub-agents under the current parallel toolCall using toolCall.id prefix
      if (state.correlationId?.startsWith(toolCall.id + '_')) {
        setStateMap(prev => {
          const next = new Map(prev);
          // Use correlationId as key (unique per subtask)
          next.set(state.correlationId!, state);
          return next;
        });
      }
    });

    return cleanup;
  }, [toolCall.id, toolResult]);

  // ... existing resultText parsing logic preserved ...

  return (
    <div className="parallel-sub-agents-tool-call-view">
      {/* Header */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">🤖</span>
        <span className="sub-agent-tool-label">
          Parallel Sub-Agents ({tasks.length} tasks)
        </span>
        {/* ... existing status badge ... */}
      </div>

      {/* Task Cards — 🔧 Enhanced: use correlationId to precisely index each sub-agent's real-time progress */}
      <div className="parallel-tasks-list">
        {tasks.map((task, index) => {
          // correlationId format is `{toolCall.id}_{index}`
          const expectedCorrelationId = `${toolCall.id}_${index}`;
          const agentState = stateMap.get(expectedCorrelationId);
          return (
            <div key={index} className="parallel-task-card">
              <div className="parallel-task-header">
                <strong>{task.sub_agent_name}</strong>
                {/* 🆕 Real-time running status */}
                {!toolResult && agentState && (
                  <span className="parallel-task-status running">
                    ⏳ Turn {agentState.currentTurn}/{agentState.maxTurns}
                  </span>
                )}
                {/* ... existing taskResults status badge ... */}
              </div>
              <div className="parallel-task-description">{task.task}</div>
              {/* 🆕 Steps thumbnail */}
              {!toolResult && agentState && agentState.steps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {agentState.steps
                    .filter(s => s.type !== 'text')
                    .slice(-3)  // Show only the 3 most recent tool calls
                    .map((step, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5 px-1.5 rounded bg-white/5 text-[11px] font-mono text-zinc-400">
                        {step.type === 'tool_start' ? '⏳' : step.type === 'tool_done' ? '✓' : '✗'}
                        {step.toolName}
                      </span>
                    ))
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ... existing resultText display ... */}
    </div>
  );
};
```

### 5.3 Styling Approach

> The project uses **Tailwind CSS** as the primary styling approach. All styles for this feature use Tailwind utility classes directly, with no new custom CSS added.
>
> The code examples above directly use `className` with inline Tailwind classes, such as:
> - `bg-white/[0.03]`: semi-transparent background
> - `border-l-2 border-blue-400`: left accent border
> - `text-xs text-zinc-400`: small-sized secondary text
> - `font-mono text-[11px]`: monospaced font for tool names
> - `line-clamp-2`: text summary truncation

>
> If reusable combined styles are needed, they can be extracted using `@apply` in `src/renderer/styles/`, but the current complexity does not require it.

---

## 6. End-to-End Data Flow

### 6.1 Single Sub-Agent Execution

```
User sends message
  │
  ▼
AgentChat.executeToolCall('spawn_subagent', args)
  │
  ├─ BuiltinToolsManager.setExecutionContext({ ..., eventSender: this.eventSender }) ← 🆕
  │
  ▼
SpawnSubAgentTool.execute(args)
  │
  ├─ context = BuiltinToolsManager.getExecutionContext()
  ├─ context.eventSender ← WebContents reference ← 🆕
  │
  ▼
SubAgentManager.spawnSubAgent({ ..., eventSender: context.eventSender })
  │
  ├─ Construct SubAgentChat({ onStepUpdate: callback }) ← 🆕
  │
  ▼
SubAgentChat.run()
  │
  ├─ ┌─ WHILE LOOP (per turn) ─────────────────────────────────────┐
  │  │  callLLM() → response                                    │
  │  │  │                                                        │
  │  │  ├─ IF hasToolCalls:                                      │
  │  │  │   ├─ onStepUpdate({ type:'tool_start', toolName })  ──┼──▶ SubAgentManager
  │  │  │   │                                                    │     │
  │  │  │   │                                                    │     ├─ Update runtimeStates
  │  │  │   │                                                    │     │
  │  │  │   │                                                    │     ▼
  │  │  │   │                                                    │   eventSender.send('subAgent:stateUpdate', state)  // 100ms throttle
  │  │  │   │                                                    │     │
  │  │  │   │                                                    │     ▼
  │  │  │   │                                                    │   [Renderer] SubAgentToolCallView
  │  │  │   │                                                    │     - Subscribe via useEffect to onStateUpdate
  │  │  │   │                                                    │     - Match precisely by correlationId(=toolCall.id)
  │  │  │   │                                                    │     - setRuntimeState(state)
  │  │  │   │                                                    │     - Render steps list + progress bar
  │  │  │   │                                                    │
  │  │  │   ├─ executeTool()                                     │
  │  │  │   ├─ onStepUpdate({ type:'tool_done', toolName })  ───┼──▶ (same as above)
  │  │  │   │                                                    │
  │  │  ├─ IF textContent:                                       │
  │  │  │   └─ onStepUpdate({ type:'text', snippet })  ─────────┼──▶ (same as above)
  │  │  │                                                        │
  │  │  └─ onTurnComplete(turn, text)                            │
  │  └──────────────────────────────────────────────────────────┘
  │
  ▼
SubAgentChat.run() returns → SubAgentManager returns SubAgentTaskResult
  │
  ├─ sendStateUpdate(eventSender, { status:'completed' }, force=true) ← Terminal state 🆕
  │
  ▼
SpawnSubAgentTool returns ToolExecutionResult
  │
  ▼
AgentChat sends result as tool_result chunk to Renderer
  │
  ▼
SubAgentToolCallView receives toolResult → clears runtimeState → displays final result
```

### 6.2 IPC Message Frequency Estimate

| Scenario | Avg IPC per turn | Typical total turns | Total IPC count |
|------|------------------|---------------|------------|
| Simple task (no tools) | 1 (text) | 1-3 | 1-3 |
| Single tool call | 3 (tool_start + tool_done + text) | 5-10 | 15-30 |
| Multiple tools/turn | 2N+1 (N tools × start+done + text) | 10-20 | 40-100 |
| 5 parallel sub-agents | Same as above × 5 | 10-20 | 200-500 |

**Conclusion**: Maximum ~500 per session, but actual IPC count reduced 50-70% after 100ms throttling. Each payload < 2KB, no pressure on Electron IPC.

---

## 7. UI Interaction Design

### 7.1 Single Sub-Agent Execution (Expected Rendering)

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Sub-Agent: web-researcher       ⏳ Turn 4/25    │
│                                                     │
│ Task: Research the implementation of GitHub Copilot CLI │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ✓ bing_web_search                               │ │
│ │ ✓ fetch_web_content                             │ │
│ │ ✓ fetch_web_content                             │ │
│ │ ⏳ read_file                     running...      │ │
│ │                                                 │ │
│ │ 💬 Analyzed 3 documents, found Copilot CLI is based on... │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 7.2 Parallel Sub-Agent Execution

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Parallel Sub-Agents (3 tasks)     ⏳ Running    │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ web-researcher          ⏳ Turn 3/25            │ │
│ │ Research topic A                                │ │
│ │ [✓ bing_web_search] [⏳ fetch_web_content]      │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ code-reviewer           ⏳ Turn 5/25            │ │
│ │ Review PR #123                                  │ │
│ │ [✓ read_file] [✓ read_file] [⏳ execute_command]│ │
│ ├─────────────────────────────────────────────────┤ │
│ │ doc-writer              ⏳ Turn 1/25            │ │
│ │ Write summary document                          │ │
│ │ (no steps yet)                                  │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 7.3 State Transitions

```
Starting...  →  ⏳ Turn 1/25  →  ⏳ Turn N/25  →  ✅ Done / ❌ Failed
(no runtimeState)  (steps appear gradually)  (steps update)     (show toolResult)
```

- **Starting...**: `toolResult === null` and `runtimeState === null` (SubAgentChat has not yet emitted its first callback)
- **Turn N/M**: `runtimeState` has a value, displaying steps list
- **Done/Failed**: `toolResult` arrives → clear `runtimeState` → display final result

---

## 8. Impact Scope and Risk Assessment

### 8.1 Modified Files List

| File | Change Type | Change Volume | Risk |
|------|---------|--------|------|
| `src/main/lib/subAgent/types.ts` | Extend interfaces | +30 lines | Low — new fields/interfaces, non-breaking |
| `src/main/lib/userDataADO/types/profile.ts` | Extend `SubAgentRuntimeState` | +20 lines | Low — new optional fields |
| `src/main/lib/chat/agentChat.ts` | `executeToolCall()` inject `eventSender` | +1 line | Very low — one optional field assignment |
| `src/main/lib/subAgent/subAgentChat.ts` | `executeToolCalls()` + `run()` inject callbacks | +40 lines | Low — calling optional callbacks, no impact on main logic |
| `src/main/lib/subAgent/subAgentManager.ts` | `spawnSubAgent()` assemble + send IPC | +60 lines | Medium-low — core change point, must ensure `sendStateUpdate` safety |
| `src/main/lib/mcpRuntime/builtinTools/spawnSubAgentTool.ts` | Pass through `eventSender` | +2 lines | Very low — one additional parameter pass-through |
| `src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx` | Subscribe IPC + render steps | +100 lines | Medium — UI logic, needs rendering performance testing |

**Total**: ~7 files, ~270 lines of new code (excluding CSS, all using Tailwind inline classes)

### 8.2 Risk Points and Mitigations

| Risk | Severity | Mitigation |
|------|--------|---------|
| `eventSender` may be destroyed during sub-agent execution (user closes window) | Medium | `isDestroyed()` check + try/catch in `sendStateUpdate` |
| High-frequency IPC causing renderer re-render performance issues | Low | Steps list is bounded (MAX=30); React `useEffect` only triggers on state change |
| Parallel sub-agents with same name (two tasks using the same `subAgentName`) | Medium | Recommend using `taskId` instead of `subAgentName` for matching in the future; short-term: deduplicate in UI using `subAgentName + most recent taskId` |
| `SubAgentRuntimeState.steps[]` serialization overhead | Low | MAX_STEPS_IN_STATE=30, ~100 bytes per entry, total payload < 5KB |
| `onStepUpdate` callback exception affecting main loop | Low | Recommend wrapping with try/catch in `SubAgentManager` callback |

### 8.3 Backward Compatibility

- ✅ `SubAgentChatOptions.onStepUpdate` is an optional addition; behavior is identical to previous version when not provided
- ✅ `ToolExecutionContext.eventSender` is an optional addition; existing tools are unaffected
- ✅ `SubAgentRuntimeState` new fields; older renderer versions (without this file modification) will not error (just `undefined`)
- ✅ `spawnSubAgent()`'s `eventSender` parameter is optional; no IPC is sent when not provided

---

## 9. Implementation Steps

### Phase 1: Data Model + Backend Pipeline (Estimated 1 day)

1. **Extend `SubAgentRuntimeState`**: Add `maxTurns`, `steps[]`, `lastTextSnippet` fields → `profile.ts`
2. **Define `SubAgentStep` interface** → `profile.ts`
3. **Define `SubAgentStepUpdate` interface** + extend `SubAgentChatOptions` → `types.ts`
4. **Extend `ToolExecutionContext`** with `eventSender?` → `types.ts`
5. **AgentChat inject `eventSender`** → `agentChat.ts` executeToolCall() (1 line)

### Phase 2: Callback Injection + IPC Sending (Estimated 1 day)

6. **SubAgentChat inject `onStepUpdate`** callback into `executeToolCalls()` and `run()` → `subAgentChat.ts`
7. **SubAgentChat add `truncateToLines` helper function** → `subAgentChat.ts`
8. **SubAgentManager extend `spawnSubAgent()`**: Receive `eventSender` + register `onStepUpdate` callback + `sendStateUpdate()` → `subAgentManager.ts`
9. **SubAgentManager extend `spawnMultipleSubAgents()`**: Pass through `eventSender` → `subAgentManager.ts`
10. **SpawnSubAgentTool / SpawnMultipleSubAgentsTool pass through `eventSender`** → `spawnSubAgentTool.ts`

### Phase 3: Frontend Rendering (Estimated 1 day)

11. **Refactor `SubAgentToolCallView`**: Subscribe IPC + render steps list in real-time → `SubAgentToolCallView.tsx`
12. **Add `SubAgentStepsList` sub-component** → same file
13. **Refactor `ParallelSubAgentsToolCallView`**: Index progress by correlationId → same file
14. **All styles use Tailwind inline classes**, no new CSS files needed

### Phase 4: Testing and Verification (Estimated 1 day)

15. Manual test: Single sub-agent task execution → verify real-time steps list update
16. Manual test: Parallel sub-agents → verify independent progress per card
17. Manual test: Cancel operation → verify progress stops + correct state
18. Manual test: Long-running execution (>20 turns) → verify steps are bounded, IPC is stable

---

## Appendices

### A. Mapping to Parent Document

| This Document Section | Parent Document `kosmos-sub-agent-tech-doc.md` Section |
|-----------|-------------------------------------------|
| §3.1 SubAgentRuntimeState | §3.1 Data Model — `SubAgentRuntimeState` original definition |
| §3.2 SubAgentChatOptions | §4.2.2 SubAgentChat class design |
| §3.3 ToolExecutionContext | §4.3 spawn_subagent — ToolExecutionContext injection mechanism |
| §4.3 SubAgentChat refactoring | §4.2.3 Conversation loop + §4.2.11 executeToolCalls |
| §4.4 SubAgentManager refactoring | §4.1 SubAgentManager — spawnSubAgent flow |
| §4.5 SpawnSubAgentTool refactoring | §4.3 spawn_subagent built-in tool |
| §5.1 SubAgentToolCallView | §5.3 Sub-agent state display in ChatView |

### B. Existing Infrastructure Reuse Table

| Infrastructure | Location | How This Approach Reuses It |
|---------|------|--------------|
| `subAgent:stateUpdate` IPC channel | `preload.ts` line 1932 | Directly use existing channel + listener |
| `ToolExecutionContext` injection mechanism | `builtinToolsManager.ts` static set/get | Extend interface to add `eventSender` field |
| `eventSender` reference | `agentChat.ts` line 165 | Pass through to SubAgentManager via context |
| `SubAgentRuntimeState` type | `profile.ts` line 134 | Extend with new `correlationId`, `maxTurns`, `steps`, `lastTextSnippet` fields |
| `onTurnComplete` callback | `subAgentChat.ts` → `subAgentManager.ts` | Preserve original + add parallel `onStepUpdate` callback |
| `sendStateUpdate` safeSend pattern | Reference `agentChat.ts` emitStreamingChunk | New implementation of same pattern for safe sending (with 100ms throttle) |

### C. Persistence-Ready Design (Future Work)

> ⚠️ **This appendix is a future planning document, not within the v1.2.0 implementation scope.**
>
> The v1 `SubAgentStep` data structure already includes `toolArgsSummary`, `durationMs`, `toolResultLength` and other fields.
> When persistence is enabled in the future, data can be extracted directly from `SubAgentRuntimeState.steps` without modifying the data model.

#### C.1 Design Goals

**Current phase** (v1.2.0 implementation scope):
- Sub-Agent runtime progress is pushed to UI via IPC, existing only in memory
- After execution completes, the final result is stored in the parent session file as `tool_result`
- Intermediate steps (tool call traces, text snippets) are lost when the process exits

**Future phase** (persistence goals):
- Able to add disk writing with **zero data model changes**
- Complete sub-agent execution traces can be reviewed retrospectively (which tools were called, duration per step, parameter/result summaries)
- Support expanding sub-agent execution details in historical sessions from the UI

#### C.2 Suggested SubAgentExecutionRecord Snapshot Structure

```typescript
export interface SubAgentExecutionRecord {
  taskId: string;
  subAgentName: string;
  task: string;
  parentChatId: string;
  parentSessionId: string;
  inheritedModel: string;
  startTime: number;
  endTime: number;
  totalTurns: number;
  maxTurns: number;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  /** All execution steps (reuses SubAgentStep interface, bounded ≤500) */
  steps: SubAgentStep[];
  finalResultLength?: number;
  error?: string;
}
```

#### C.3 Persistence Strategy Options

| Strategy | Storage Location | Pros | Cons | Recommended Scenario |
|------|---------|------|------|---------|
| **A. Embed in parent session** | `chatSessions/{sessionId}.json` | Data managed alongside session | Single message bloat | Few steps (≤50) |
| **B. Separate files** ✅ | `{userData}/profiles/{alias}/subAgentRecords/{taskId}.json` | No impact on session loading; lazy-loadable | Needs cleanup logic | Recommended |
| **C. SQLite** | `subAgentRecords.db` | Efficient queries | Schema maintenance | Statistical analysis needed |

**Recommended Strategy B**: Consistent with the `chatSessions/` pattern; `ChatView` can load on demand asynchronously via `taskId`.

#### C.4 Estimated Effort

| Item | Estimated Code Volume |
|------|-----------|
| `persistExecutionRecord()` implementation | ~30 lines |
| IPC `subAgent:getExecutionRecord(taskId)` | ~50 lines |
| Renderer lazy-load UI | ~100 lines |
| Historical session expand sub-agent details | ~80 lines |
| Execution record cleanup strategy | ~20 lines |
| **Total** | **~280 lines** |
