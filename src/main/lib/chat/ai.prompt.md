<!-- Last verified: 2026-05-20 -->
# Chat Engine

> Core multi-turn agent conversation engine: one `AgentChat` instance per active chat tab, orchestrated by `AgentChatManager`.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `agentChat.ts` | Chat-session facade and orchestrator; retains the conversation loop and delegates extracted domains | ~1.5K LOC |
| `agentChatTypes.ts` | Shared chat-engine runtime enums and stats types used across facade and services | new |
| `agentChatRuntimeState.ts` | Mutable per-session runtime state: chat status, pending interactions, cancellation token, tool nonce, and save queue chain | new |
| `agentChatOutputPort.ts` | Output adapter for streaming chunks, status events, and interactive request events | new |
| `agentChatTurnRunner.ts` | Stage-based turn orchestrator for compression, streaming, tool follow-up, storage compression, and cancellation cleanup | new |
| `agentChatPromptService.ts` | Prompt assembly, tool discovery, knowledge-source injection, sub-agent prompt text, skill snapshot refresh | new |
| `agentChatSessionService.ts` | Chat session persistence, title generation, edit flow, file-path replacement, message save queue behavior | new |
| `agentChatContextService.ts` | Context-history enrichment, memory read/write integration, compression trigger, token accounting, context-change notifications | new |
| `agentChatInteractionService.ts` | Pending interactive request lifecycle, history summaries, approval bypass flow, unified form and choice requests | new |
| `agentChatToolPostProcessor.ts` | Tool-result-specific post-processing for interactive-input and template placeholder/user-input flows | new |
| `agentChatInteractionPolicy.ts` | Shared interaction-policy enum and blocked-interaction error model for remote/plain-text-only and scheduled/non-interactive runtimes | new |
| `agentChatToolExecutor.ts` | Tool execution context wiring, cancellation handler registration, MCP execution, and incomplete tool-call cleanup | new |
| `agentChatToolReplaySanitizer.ts` | History-level and final-payload tool replay sanitization plus duplicate-tool debug logging | new |
| `agentChatStreamingService.ts` | LLM request assembly, Copilot API streaming, SSE parsing, chunk emission, TTFT analytics reporting, network/cancellation error mapping. When tool search is enabled, filters deferred tools and injects `<available-deferred-tools>` index. | new |
| `agentChatManager.ts` | AgentChat instance lifecycle, cancellation, idle cleanup, notification routing, and scheduler runtime handoff tracing | ~2.0K LOC |
| `externalAgentChatHandler.ts` | External agent message routing: sends user text via WS (fire-and-forget), returns immediately | ~77 LOC |
| `agentChatPushReceiver.ts` | Push stream UI handler: emits streaming chunks to renderer, manages push timeout (2 min), UI-only state. Persistence owned by `ExternalAgentService` (called with `skipPersistence=true`); timeout auto-complete persists as local safety net | ~168 LOC |
| `agentChatManagerRegistry.ts` | Instance/runtime/cancellation registries extracted from `AgentChatManager` | new |
| `agentChatManagerSessionCoordinator.ts` | Current-session tracking, new-session mapping, idle cleanup, unread-on-blur state, foreground protection, and session directory setup | new |
| `agentChatManagerRendererBridge.ts` | Renderer-facing cache, current-session, and runtime chat-status event bridge extracted from `AgentChatManager` | new |
| `agentChatManagerNotificationBridge.ts` | BrowserWindow focus wiring, chat-status pushes, and system-notification lifecycle extracted from `AgentChatManager` | new |
| `agentChatManagerScheduledRunner.ts` | Scheduled-silent session orchestration: scheduler metadata transitions, persistence checkpoints, unread marking, notification triggering, cleanup, and chat-session tracing hooks | new |
| `interactiveRequestManager.ts` | Session-scoped pending interactive request registry used by approval, choice, and form flows | small |
| `agentChatUtilities.ts` | Extracted pure helpers: tool arg normalization, compression threshold check, message formatting for API, image detection, MCP→OpenAI tool conversion | ~1.2K LOC |
| `globalSystemPrompt.ts` | Static global system prompt injected into every agent; workspace/file-operation rules and `{{OPENKOSMOS_*}}` placeholder substitution | ~559 LOC |
| `chatSessionStore.ts` | Persistence layer: read/write chat session JSON files; delegates file I/O to `ChatSessionFileOps` | ~810 LOC |
| `skillSnapshotBuilder.ts` | Builds an immutable skill snapshot attached to a session at send-time so skill edits mid-session don't mutate history | ~168 LOC |
| `toolSearchFilter.ts` | Deferred tool loading filter: `isDeferredTool`, `filterToolsForRequest`, `extractDiscoveredToolNames`, `shouldEnableToolSearch`. Token-accurate: estimation must use filtered tools + deferred index text, not full schemas. See `ai.prompt/tool-search-design.md`. | ~245 LOC |

## Architecture

### Instance Model
`AgentChatManager` is a singleton that maps `chatSessionId → AgentChat`. Each browser tab has exactly one `AgentChat`; switching tabs switches `currentInstance`. Instances idle for >5 min are destroyed and recreated on demand.

`AgentChat` is now refactored toward a facade architecture. Prompt-building, chat-session persistence/edit logic, context/compression logic, interactive request lifecycle, tool-result post-processing, tool execution/cancellation cleanup, Copilot API streaming, per-session runtime state, output dispatch, and the main turn loop now live in dedicated modules while `AgentChat` remains the public per-session entry point. The remaining public turn-entry wrappers (`streamMessage`, `retryChat`) now delegate their multi-step setup through `AgentChatTurnRunner` instead of rebuilding turn orchestration inline.

### Status Flow
```
IDLE → SENDING_RESPONSE → [COMPRESSING_CONTEXT → COMPRESSED_CONTEXT →] RECEIVED_RESPONSE → IDLE
```
All managed `AgentChat` instances, including `scheduled-silent` sessions, must surface runtime `chatStatus` through `AgentChatManager`'s manager-owned listener path. `AgentChatOutputPort` still emits directly when a sender is attached, but sender-less instances must continue to propagate status through the manager bridge so renderer consumers observe the same runtime status model regardless of runtime mode. This runtime `chatStatus` is distinct from persisted `schedulerExecutionStatus` metadata.
Compression is triggered via an **adaptive threshold** based on the model's raw `contextWindowSize` (not `effectiveContextWindow`):

| Model context window | Threshold | First trigger example |
|---|---|---|
| ≥ 500K (e.g., claude-opus-4.7-1m) | 40% | ~400K tokens |
| 200K–499K (e.g., claude 200K) | 50% | ~100K tokens |
| < 200K (e.g., GPT-4o 128K) | 70% | ~90K tokens |

The `tokenUsageRatio` is still computed against `effectiveContextWindow` (context window minus output reserve), but the threshold tier is selected from the raw window size so that the output reserve does not cause unexpected tier demotion. After compression, `context_history` shrinks to `[SUMMARY_MSG, recent_5_msgs]` (~5–15K tokens) — the threshold does not re-fire until substantial new history accumulates, so lower thresholds do not cause compression loops. This "implicit incremental compression" means the previous summary message is simply re-compressed along with new messages on subsequent cycles — no explicit `previousSummary` tracking is needed.

`AgentChatContextService` now estimates compression need from the formatted final-send message view built by `formatMessagesForApi(...)`, rather than only from raw `context_history` token counts. Token estimation uses a **three-pillar approach** to prevent context overflow:
1. **VS Code Copilot alignment**: message overhead constants (+3/msg, +3 completion, +1 name), tool definitions (+16 base, +8/tool, ×1.1 safety, key+value tokenization), tool_calls ×1.5 safety, encoder selection from CAPI model metadata (`o200k_base`/`cl100k_base`).
2. **API Usage anchoring**: after each API response, `usage.prompt_tokens` is fed back via `anchorTokenEstimate()` to compute a `correctionRatio` that calibrates subsequent local estimates against server-side reality.
3. **Model correction factor**: pre-first-API-call, models with known tokenizer gaps (Claude ×1.4, Gemini ×1.1) apply a preset correction factor; this is superseded once API anchoring takes effect.

Output token space is reserved by subtracting `min(maxOutputLength, 20000)` from the context window before threshold comparison.

It still reports additive token components by deriving a formatted-payload total first, then splitting it into approximate `systemPromptTokens` and `contextHistoryTokens` for compatibility with existing consumers. Compression only runs inside the active send / start-chat turn loop and must not run during standalone session initialization. `AgentChat.initialize()` may still kick off context-stat recalculation, but that refresh must remain fire-and-forget so session-open cache hydration is not blocked on token counting or prompt/tool enumeration. `FullModeCompressor` now structurally trims oversized message bodies before summarization, splits large middle-history spans using a conservative token-aware prompt budget, runs first-layer conversation chunk summaries with bounded concurrency, and still keeps merge-stage recursive summarization sequential so chunk ordering remains deterministic. It also re-truncates any single message that would still exceed that prompt budget and recursively re-chunks merge summaries so the second-stage merge cannot fall back to one unbounded prompt. The compression helper in `../llm/contextCompressionLlmSummarizer.ts` owns the structured summary template, output language, and prompt-overhead calculation; that overhead must be computed against the real summary request shape, including both the dedicated system prompt and the generated user prompt. `summaryPromptTokenBudget` is treated as a hard ceiling against that helper-owned request shape. If it is lower than the request overhead, compression fails fast and falls back instead of silently widening the budget. Recursive merge also has a bounded depth limit so pathological sessions fall back instead of triggering unbounded serial LLM calls. `COMPRESSED_CONTEXT` must only be emitted after a shorter context history is actually installed.
If the provider still rejects the payload with an overflow-style `GhcApiError`, `AgentChatTurnRunner` now performs one forced compaction retry before surfacing the failure. This retry is intentionally bounded to a single attempt to avoid infinite retry loops on irreducible sessions.

### Cancellation
Every send creates a `CancellationTokenSource` stored in `AgentChatManager`. `CancellationToken` is threaded through the LLM streaming call and all tool executions. Calling `stopChat` cancels the source; `CancellationError` propagates up and is caught silently.
When cancellation happens while a `choice` or `form` interactive request is pending, `AgentChatManager.cancelChatSession()` must also interrupt the pending request via `interactiveRequestManager` so the turn does not remain blocked waiting for UI input after the chat is already cancelled. Persist this as a distinct `chat-cancelled` interaction resolution instead of collapsing it into renderer-unavailable fallback or explicit user skip semantics.
When cancellation happens during LLM streaming, `AgentChatStreamingService` can raise a `StreamCancellationError` carrying the accumulated partial response. `AgentChatTurnRunner` persists visible partial assistant text before rethrowing the cancellation so session switch, refresh, and restart reload the same text the user already saw. If the partial response has begun emitting tool calls, only the text portion is persisted; unmatched partial tool calls are discarded to avoid orphaned tool-call history. `AgentChatManager.cancelChatSession()` waits for the cancelled turn to unwind to idle before returning so this partial-response save has a chance to drain through the serialized save chain.

### Scheduled Runner Tracing
`AgentChatManager.runScheduledJob()` and `AgentChatManagerScheduledRunner` now emit `scheduler.runtime.*` logs that bridge scheduler execution with chat runtime creation. Preserve the `chatSessionId`, `chatId`, and `runtimeMode='scheduled-silent'` correlation fields when modifying scheduled execution flow.

### Briefing User Identity Injection
`AgentChatManagerScheduledRunner` injects the current user's email (via `aliasToAadAccount`) into briefing messages through `injectBriefingInstructions(message, userEmail)`. The identity is prepended before the briefing prompt so the LLM can attribute action items during scanning, and task-creation instructions filter to only create tasks for the current user. Non-briefing jobs are unaffected.

### Per-Chat Reasoning Effort
`agentChatStreamingService.ts` injects an endpoint-specific reasoning fragment into the outbound request when the active model advertises `capabilities.supports.reasoning_effort`. The persisted choice lives on `chat.agent.reasoningEffort` (see [userDataADO](../userDataADO/ai.prompt.md)) and is plumbed through `agentChat.ts` → `getCurrentModelConfig()` → `AgentChatStreamingServiceDeps.getCurrentModelConfig().reasoningEffort`. The streaming service computes a vendor-aware default via `getDefaultReasoningEffort(modelId, supportedEfforts)` (Claude→high, GPT→medium) and passes both the user's choice and the default to `buildReasoningParams()` (see [LLM](../llm/ai.prompt.md)). When the user has not explicitly chosen a tier, the default is sent — an explicit `reasoning_effort` is **always** included for models that support reasoning, ensuring the wire payload matches the UI's "(default)" label. A diagnostic `🧠 reasoning_effort` log records `model / endpoint / requested / supported / applied` for every send so the actual wire payload can be inspected at runtime.


### Global System Prompt Injection
`getGlobalSystemPromptAsMessages()` prepends a fixed system message to every API call. It enforces the file workspace restriction and `execute_command` safety rules. `{{OPENKOSMOS_*}}` placeholders (e.g. `{{OPENKOSMOS_WORKSPACE_PATH}}`) are resolved by `openkosmosPlaceholderManager` at send-time, not at session creation.

The Task Management section in the global prompt contains a shared baseline instruction (auto-create tasks from action items). PM Studio's interactive confirmation behavior ("ask before creating tasks") is injected by `AgentChatPromptService.getCombinedSystemPromptForContext()` only when `BRAND_NAME === 'pm-studio'` and `interactionPolicy !== 'forbid'`. This ensures scheduled-silent briefing jobs retain automatic task creation.

`AgentChat` also appends session-specific knowledge metadata to the runtime prompt from `chat.agent.knowledge`. The current persisted knowledge contract is limited to the configured Knowledge Base directory. Teams/Outlook briefing source selection is no longer stored on the agent profile and does not participate in chat-time prompt assembly; it is schedule-local state embedded in briefing job messages instead.

### Tool Argument Normalization
LLMs occasionally emit malformed or concatenated JSON in tool-call `arguments`. `normalizeToolCalls()` in `agentChatUtilities.ts` splits these into multiple valid calls and assigns synthetic IDs. This is transparent to the LLM — results are returned under the original IDs.

### Skill Snapshots
Skills are snapshotted via `buildChatSkillSnapshot()` at the moment a message is sent. If the user edits a skill mid-conversation, in-flight and past turns still reference the snapshot, ensuring reproducibility.

### Memory Integration
If `openkosmosFeatureMemory` flag is enabled, `kosmosMemoryManager` enriches the system prompt with semantically similar memories before each LLM call. This is a read-only enrichment; memories are written after the assistant response completes.

### Interactive Requests
`AgentChat` now routes all user-blocking interactions through one model: `approval`, `choice`, and `form`. Each request is stored as the session's `pendingInteractiveRequest`, resolved via `interactiveRequestManager`, and persisted as `interaction_history` on the chat session file. This keeps interactive artifacts visible in the renderer without inserting synthetic assistant messages between `tool_calls` and `tool` results. Current runtime behavior temporarily bypasses outside-workspace path validation and approval requests in `batchValidateAndRequestApproval()`, so tool calls are auto-approved until that gate is re-enabled. Dynamic tool-driven input can now enter the same lifecycle through the `request_interactive_input` built-in tool, which is post-processed into a `choice` or `form` request before the turn resumes.

Interactive availability is now controlled by a runtime interaction policy. Foreground chats use `allow-ui`, remote IM sessions use `plain-text-only`, and scheduled-silent runs use `forbid`. When the policy is `forbid`, interactive requests throw `NonInteractiveRuntimeInteractionError` so unattended scheduled runs fail fast instead of silently skipping hidden input requests.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change knowledge-source prompt or per-turn prompt composition | `agentChatPromptService.ts` + `globalSystemPrompt.ts` | Keep injected prompt content stable unless the product requirement changes |
| Change chat session save, title generation, or edit behavior | `agentChatSessionService.ts` + `chatSessionStore.ts` | Preserve deferred title regeneration and save ordering |
| Change chat session rename behavior | `agentChatManager.ts` + `startup/ipc/profile.ts` + `chatSessionStore.ts` | Keep persisted session metadata and any active in-memory `AgentChat` title in sync |
| Change memory enrichment, memory fact extraction, or context token stats | `agentChatContextService.ts` + `agentChatTurnRunner.ts` | Preserve fire-and-forget context recalculation semantics and fallback token estimation |
| Change approval, form, or choice interaction behavior | `agentChatInteractionService.ts` + `interactiveRequestManager.ts` | Preserve pending request persistence and `interaction_history` summaries |
| Change `request_interactive_input` or template tool post-processing | `agentChatToolPostProcessor.ts` + `agentChatInteractionService.ts` + `agentChatInteractionPolicy.ts` | Keep remote-session plain-text behavior and scheduled non-interactive failure semantics stable |
| Change tool execution, cancellation propagation, or cleanup of partial tool turns | `agentChatToolExecutor.ts` + `agentChatTurnRunner.ts` | Preserve structured parse/truncation errors and cancelled-turn cleanup behavior |
| Change Copilot request formatting, SSE parsing, or network/cancellation mapping | `agentChatStreamingService.ts` + `agentChatTurnRunner.ts` | Preserve `/responses` vs `/chat/completions` protocol differences, first-chunk status transitions, and TTFT dedup invariant (`ttftReportedForTurn`) |
| Change tool search filtering, deferred tool index, or discovery persistence | `toolSearchFilter.ts` + `agentChatStreamingService.ts` + `agentChatContextService.ts` + `builtinToolsManager.ts` | Token estimation in context service must use same `shouldEnableToolSearch(tools, contextWindowSize)` call as streaming service; both must pass `maxContextLength`. See `ai.prompt/tool-search-design.md`. |
| Change runtime chat status, pending interaction storage, or save queue chaining | `agentChatRuntimeState.ts` + `agentChatSessionService.ts` | Preserve `saveChain` serialization and status transition order |
| Change renderer/session cache event delivery | `agentChatOutputPort.ts` + `agentChatManagerRendererBridge.ts` | Preserve IPC event names and payload shape |
| Change instance caching, runtime mode tracking, or cancellation source reuse | `agentChatManagerRegistry.ts` + `agentChatManager.ts` | Preserve per-session instance identity and cancellation cleanup semantics |
| Change current-session switching, new-chat reuse, idle cleanup, or unread-on-blur behavior | `agentChatManagerSessionCoordinator.ts` + `agentChatManager.ts` | Preserve foreground protection and deferred unread marking semantics |
| Change forked-session initialization or session workspace setup | `agentChatManager.ts` + `agentChatManagerSessionCoordinator.ts` | Fork must copy the persisted session JSON and provision the target session workspace directory under `{workspace}/{YYYYMM}/{chatSessionId}` |
| Change BrowserWindow focus wiring, system notifications, or direct chat-status pushes | `agentChatManagerNotificationBridge.ts` + `agentChatManager.ts` | Preserve unread-on-blur semantics, notification click navigation, and Windows notification retention |
| Change scheduled-silent execution, scheduler metadata persistence, or scheduled completion notifications | `agentChatManagerScheduledRunner.ts` + `agentChatManager.ts` | Preserve initial/completed save checkpoints, unread marking, and failure cleanup |
| Add a new `{{OPENKOSMOS_*}}` placeholder | `globalSystemPrompt.ts` + `openkosmosPlaceholders.ts` (userDataADO) | Placeholder must be registered in `openkosmosPlaceholderManager` before use |
| Change compression threshold or preserved messages | `agentChatUtilities.ts` (`checkCompressionNeeds`, `getCompressionThreshold`) + `agentChatContextService.ts` (correction factors, anchoring) + `compression/fullModeCompressor.ts` | Adaptive threshold via `getCompressionThreshold(contextWindowSize)` (≥500K→0.40, ≥200K→0.50, <200K→0.70); correction factors and anchoring in `AgentChatContextService`; output token reserve via `outputTokenReserve` param |
| Add or remove global file-operation rules | `globalSystemPrompt.ts` | Affects every agent; test across all agent types |
| Change approval / choice / form request behavior | `agentChat.ts`, `interactiveRequestManager.ts`, `agentChatManager.ts`, `chatSessionFileOps.ts` | Preserve the request lifecycle: create pending request, wait on response, append interaction history, then continue the turn |
| Modify tool arg normalization logic | `agentChatUtilities.ts` (`normalizeToolCalls`, `normalizeToolArguments`) | Regression-test with malformed LLM output |
| Adjust idle instance timeout | `agentChatManager.ts` (`IDLE_TIMEOUT_MS`) | Currently 5 min; lowering it may cause unnecessary instance churn |

## Gotchas
- ⚠️ `AgentChat` instances are keyed by `chatSessionId`, not `chatId`. A single agent (chatId) can accumulate multiple stale instances if sessions are created rapidly — idle cleanup is the only eviction path.
- ⚠️ `AgentChat` is now a thin facade over lazily-instantiated services and a dedicated turn runner. Public wrapper methods should stay shallow; do not move orchestration logic back into the facade.
- ⚠️ `AgentChat` no longer supports inheritance-based overrides such as `Object.create(AgentChat.prototype)` hook injection. Extend behavior through the extracted services or manager-level composition instead.
- ⚠️ `request_interactive_input` must continue to short-circuit in remote IM sessions. If that guard moves or disappears, the assistant can emit UI-only requests in Teams flows and stall the turn.
- ⚠️ Cancel chat must interrupt any pending interactive request. Cancelling only the main cancellation token is insufficient because the turn may be suspended inside `interactiveRequestManager.createPendingRequest()` rather than inside an abort-aware tool or streaming call.
- ⚠️ When a user clicks `Skip` or cancels an interactive input card, the post-processed tool result must explicitly state that the user declined the request. Returning only an empty payload or bare `status: 'skipped'` is insufficient and can cause the model to immediately re-issue the same interaction.
- ⚠️ Do not collapse renderer-unavailable fallback into a user skip when post-processing `request_interactive_input`. If no active event sender exists, the returned tool result must say the UI receiver was unavailable rather than claiming the user explicitly declined.
- ⚠️ That same distinction must survive persistence: `interaction_history` entries need the fallback/timeout source recorded and summarized accurately, or the renderer timeline and audit trail will drift from the tool result semantics seen by the model.
- ⚠️ Scheduled-silent runs must remain `forbid` for interaction policy. They cannot degrade to silent skip or plain-text follow-up, or unattended jobs will produce unreliable results instead of explicit failures.
- ⚠️ Scheduled-silent runs must keep runtime `chatStatus` and persisted `schedulerExecutionStatus` as separate dimensions. Do not persist `chatStatus` into session metadata to satisfy UI state; manager-driven runtime propagation is the correct layer.
- ⚠️ `executeToolCall()` must keep returning structured tool errors for truncated JSON, invalid JSON, and approval denial. Throwing instead of returning will break the assistant/tool message pairing and can cascade into 400 follow-up API failures.
- ⚠️ `NonInteractiveRuntimeInteractionError` is the one intentional exception to the “do not throw out of tool execution flow” rule. The turn runner must persist a failure tool message first, then rethrow so scheduled execution fails fast.
- ⚠️ Replay sanitization must only preserve the first contiguous tool result for each tool-call id immediately adjacent to its parent `assistant(tool_calls)` message. Cross-turn late tool errors/results and duplicate same-id tool messages must be stripped before API replay, or Claude-compatible endpoints can reject the history with `tool_use` / `tool_result` pairing errors.
- ⚠️ `AgentChatManager.streamMessage()` must reject non-idle sends. Renderer/UI guards are advisory only; the main process is the final boundary that prevents cross-turn user-message insertion while a tool or response turn is still active.
- ⚠️ Forking a chat session is a two-part operation: copy the persisted session record and provision the session workspace directory. Copying only the JSON history will leave `execute_command` and other workspace-scoped tools pointed at a missing `{workspace}/{YYYYMM}/{chatSessionId}` directory. Workspace provisioning failures must abort the fork instead of returning a seemingly usable session.
- ⚠️ `globalSystemPrompt.ts` content is injected on every API call. Changes to it affect all active and future sessions immediately (no versioning). Large additions here directly inflate token usage for every turn.
- ⚠️ `normalizeToolCalls` can split one LLM tool call into N calls with synthetic IDs. Downstream code in `agentChat.ts` that correlates tool results by ID must tolerate these synthetic IDs.
- ⚠️ Do not insert ordinary assistant summary messages for approval/form/choice outcomes while a tool turn is in progress. That can break the `assistant(tool_calls)` → `tool` pairing expected by downstream rendering and replay.
- ⚠️ Outside-workspace validation is currently bypassed in `batchValidateAndRequestApproval()`. If you re-enable `SecurityValidator`, update the runtime flow, renderer UX, and docs together.
- ⚠️ On Windows, `Notification` objects must be kept in `activeNotifications` map or click events are silently dropped due to GC. Do not remove entries before the click handler fires.
- ⚠️ `AgentChatManager` no longer owns the core registry Maps/Sets, BrowserWindow/notification lifecycle, or scheduled-silent orchestration directly. New stateful lifecycle logic should usually land in `agentChatManagerRegistry.ts`, `agentChatManagerSessionCoordinator.ts`, `agentChatManagerNotificationBridge.ts`, or `agentChatManagerScheduledRunner.ts`, not back in the singleton facade.
- ⚠️ Compression uses `claude-haiku-4.5` as a secondary LLM call inside an active chat turn. Auth token failures during compression fall back to truncation — the user sees no error, but conversation context may be degraded.
- ⚠️ Compression gating should follow the formatted final-send payload, not only raw `context_history` message arrays. Tool replay sanitization and payload formatting can materially change real prompt size.
- ⚠️ `COMPRESSED_CONTEXT` is a verified outcome state, not just evidence that a compaction branch executed. If no shorter history is applied, the status must not advance to `COMPRESSED_CONTEXT`.
- ⚠️ Compression must stay inside the active send / start-chat loop. Do not reintroduce standalone initialization-time compaction, or oversized session opens can block renderer cache hydration behind hidden LLM work.
- ⚠️ Context token refresh during `AgentChat.initialize()` must remain non-blocking. If you await it in the open path, large sessions can regress back to the same `Opening chat history...` stall pattern even without compression.
- ⚠️ Token estimation correction factors (Claude ×1.4, Gemini ×1.1) are empirically derived. If API anchoring consistently shows a different ratio, consider updating the preset values. The `correctionRatio` is per-session and resets on session creation.
- ⚠️ `ToolsTokenCalculator` now recursively tokenizes both keys and values of tool definitions (aligned with VS Code Copilot). Modifying tool schema shapes can significantly change token counts.
- ⚠️ Only first-layer conversation chunk summaries are allowed to run concurrently. Merge-stage recursive summarization must remain sequential unless its ordering, retry pressure, and fallback behavior are redesigned together.
- ⚠️ Overflow recovery is bounded to one forced compaction retry in `AgentChatTurnRunner`. Preserve that bound unless you also add explicit retry diagnostics and loop guards, or unrecoverable oversized sessions can get stuck in retry cycles.
- ⚠️ TTFT analytics relies on `turnStartTime` and `ttftReportedForTurn` on `AgentChatStreamingService`. These are set by `AgentChat.streamMessage()` at turn start. If the streaming service instance is replaced mid-turn or `streamMessage` is refactored, ensure the reset still runs before the first `makeStreamingApiCall`.
- ⚠️ `FullModeCompressor` no longer assumes either the raw middle history, any single dense message, or the summary-merge stage is safe in one call. Any future changes must preserve structural pre-trimming, hard prompt-budget enforcement, per-message re-truncation, and recursive merge chunking, or imported giant tool-result sessions can break compression again.
- ⚠️ `AgentChatSessionService.saveChatSession()` still relies on `saveChain` serialization. Any future turn-runner or persistence refactor must preserve this ordering guarantee.
- ⚠️ Chat session rename is not store-only. If a session is active in `AgentChatManager`, its in-memory `currentChatSession.title` must be updated together with the persisted session metadata or the next save can revert the renamed title.

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| Chat message types in `types/` | `src/renderer/lib/chat/agentChatSessionCacheManager.ts`, `src/renderer/components/chat/Message.tsx` |
| `agentChatManager.ts` IPC handlers | `src/main/startup/ipc/agent-chat.ts`, `src/preload/main.ts` |
| External agent routing (`externalAgentChatHandler.ts`, `agentChatPushReceiver.ts`) | `src/main/lib/externalAgent/externalAgentService.ts` (single persistence owner), `src/shared/ipc/externalAgent.ts` |
| Context compression logic | `src/renderer/lib/streaming/` (streaming depends on message format) |
| Session persistence format | `src/main/lib/userDataADO/chatSessionManager.ts` |

## Anti-Patterns
- Do NOT directly access chat session JSON files — always go through `ChatSessionManager` or `ProfileCacheManager`.
- Do NOT send streaming tokens via IPC invoke/handle — use the `mainToRender` push pattern (see `data-flow.md`).
- Do NOT modify message history arrays in place — always create new arrays to avoid stale references in the renderer.

## Verification Steps
1. `npm run build` — ensures build passes
2. `npm run test:unit -- --testPathPattern="src/main/lib/chat"` — run chat unit tests
3. Start app (`npm run dev:wp`), send a message, verify streaming works and message persists after refresh

## Related
- Depends on: [LLM](../llm/ai.prompt.md), [MCP Runtime](../mcpRuntime/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md), [Compression](../compression/), [Token](../token/), [Memory](../mem0/), [Security](../security/), [Cancellation](../cancellation/)
- Depended by: [Chat UI](../../../renderer/components/chat/ai.prompt.md), `src/main/main.ts` (IPC handlers), [SubAgent](../subAgent/)
