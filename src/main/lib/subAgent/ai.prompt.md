<!-- Last verified: 2026-05-21 -->
# Sub-Agent System

> Manages spawning, lifecycle, and scoped execution of task-focused sub-agents from within a parent agent conversation.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `subAgentManager.ts` | Singleton lifecycle manager; enforces parallel/session limits, parent-child tracking, background promotion | ~large |
| `subAgentChat.ts` | Lightweight non-streaming conversation engine; ≤25 turns, 30s timeout, context compression | ~large |
| `subAgentTaskStore.ts` | Persistence layer for sub-agent task records; debounced JSON writes, dual history | ~medium |
| `subAgentTaskWatcherRegistry.ts` | Tracks which tasks have an active frontend viewer; gates streaming chunk emission | small |
| `subAgentTaskTypes.ts` | Types for persisted task files (`SubAgentTaskFile`, `SubAgentTaskMetadata`) | small |
| `subAgentFileManager.ts` | AGENT.md YAML front-matter parse/serialize, CRUD for agents/ directory, Claude Code tool name mapping | ~medium |
| `subAgentMigration.ts` | Profile migration helpers for sub-agent config format changes | small |
| `types.ts` | Runtime types (`SubAgent`, `SubAgentChatOptions`, `SubAgentStepUpdate`) separate from persistence types in `userDataADO/types/profile.ts` | small |

## Architecture
- **SubAgentManager** is a singleton (`getInstance()`). All spawn limits from `SUB_AGENT_LIMITS` in `profile.ts` have been removed (set to `Infinity`); no hard caps on parallel instances, total spawns per session, or background tasks. The system relies on turn budgets and `CancellationToken` cascades for resource protection.
- **SubAgentChat** uses streaming fetch internally (SSE parsing identical to AgentChat) and forwards chunks to the renderer via `SubAgentTaskWatcherRegistry` when a UI panel is actively watching the task. Results are also returned to the parent after the loop completes.
- Context compression in SubAgentChat uses claude-haiku-4.5 summary when message count or token threshold is exceeded; tool results are never discarded (only text messages are summarised).
- Sub-agents **default to the parent's LLM model**, but `AGENT.md` may specify a non-`inherit` `model` override for multi-model collaboration. They still **share the parent's `CancellationToken`** — cancelling the parent auto-terminates all running sub-agents.
- Recursive spawning is explicitly blocked: sub-agents cannot call `sub_agent` or `send_to_subagent`.
- `SubAgentFileManager` maps Claude Code tool shortnames (`Read`, `Write`, `Grep`…) to OpenKosmos built-in IDs (`read_file`, `write_file`…) on import of external AGENT.md files.
- State updates to the renderer are throttled at 100 ms (`STATE_UPDATE_THROTTLE_MS`); up to 30 steps are kept per task (`MAX_STEPS_IN_STATE`).

### Timeouts & Hard Stops
- **Turn budget**: Hardcoded loop guard of 200 turns per sub-agent (`turnCount < 200` in `SubAgentChat`). No configurable `maxTurns` parameter — the limit is a safety bound, not a tuning knob.
- **CancellationToken**: Inherited from parent `AgentChat`. User cancel or parent dispose fires `AbortController.abort()`, killing the in-flight streaming fetch.
- **Auto-background promotion**: After 120s (`AUTO_BACKGROUND_TIMEOUT_MS`), a synchronous sub-agent is promoted to background — does NOT kill the agent, just unblocks the parent.
- **Context compression timeouts**: 20s for message-count compression (haiku), 15s for tool-result summarization (haiku). Both fall back to hard truncation on timeout; neither terminates the sub-agent.
- **No per-LLM-call timeout**: Long streaming calls (60–100s for opus-class models) are normal. The stream actively receives SSE chunks the entire time. Tool execution has its own built-in timeout mechanisms.

### Task Persistence (SubAgentTaskStore)
- **Storage**: `{userData}/profiles/{userAlias}/sub-agent-tasks/{YYYYMM}/{taskId}.json`
- **Task ID**: All tasks use prefix `sa_` (e.g., `sa_1716000000000_abc123`). Background is a state, NOT an ID distinction.
- **Dual history**: `chat_history` (full, for UI replay) vs `context_history` (compressed, for LLM context window). After context compression triggers, `context_history` diverges from `chat_history`.
- **Lifecycle**: `createTask()` → `appendMessage()` (per turn) → `incrementTurnCount()` (per turn) → `completeTask(status, result?, error?)` (on finish)
- **Background promotion**: When a foreground task exceeds 120s, it is promoted to background. The task retains its original ID — only in-memory runtime state changes. `completeTask()` is called when the background execution finishes.
- **Writes**: Debounced at 2s idle; `completeTask()` force-flushes immediately.
- **`executeInBackground`**: Creates a single task, passes `externalTaskId` to the spawn call to avoid creating a duplicate TaskStore entry.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change spawn limits | `src/main/lib/userDataADO/types/profile.ts` (`SUB_AGENT_LIMITS`) | Manager reads constants from there |
| Add fields to sub-agent config | `profile.ts`, `subAgentFileManager.ts` | Update YAML serialization and migration |
| Tune conversation limits (turns/timeout) | `subAgentChat.ts` | Constants near top of file; also check `SUB_AGENT_LIMITS` |
| Import new Claude Code tool name | `subAgentFileManager.ts` (`CLAUDE_TO_OPENKOSMOS_TOOL_MAP`) | Extend the mapping object |
| Expose sub-agent state to renderer | `subAgentManager.ts` + IPC handler in `main.ts` | Use existing `SubAgentRuntimeState` shape |

## Gotchas
- ⚠️ Persistence types (`SubAgentConfig`, `SubAgentRuntimeState`) live in `userDataADO/types/profile.ts`, NOT in `types.ts` here (which holds runtime-only types). Confusing these causes type mismatches.
- ⚠️ SubAgentChat wires streaming chunks to the renderer **only when a watcher is registered** via `SubAgentTaskWatcherRegistry`. Streaming is conditional — do not expect chunks unless the UI panel is open for that task.
- ⚠️ The `sub_agent` built-in tool is declared in `mcpRuntime/builtinTools/` and dispatches through `SubAgentManager`; changes to the tool argument schema must be mirrored in both places.
- ⚠️ Write operations to AGENT.md are serialized via `writeLock` Map (same pattern as `RuntimeManager.installLocks`). Bypassing this can cause file corruption under concurrent spawns.
- ⚠️ **Task ID does NOT distinguish foreground vs background.** All tasks use `sa_` prefix. Background is a runtime state, not an identity. Never create a separate task ID for background promotion.
- ⚠️ `executeInBackground` passes `externalTaskId` to spawn methods with `skipTaskStoreCreate` to avoid double-creating TaskStore entries. If adding a new spawn path, respect this pattern.
- ⚠️ `completeTask()` must be called on ALL exit paths (success, failure, cancellation). Without it, the on-disk status stays "running" forever.

## Related
- Depends on: [Chat Engine](../chat/ai.prompt.md), [MCP Runtime](../mcpRuntime/ai.prompt.md), [Auth](../auth/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md)
- Depended by: MCP built-in tools (`sub_agent`, `send_to_subagent`); [Startup Update](../startupUpdate/ai.prompt.md)
