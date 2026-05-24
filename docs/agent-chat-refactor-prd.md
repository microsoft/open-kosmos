# AgentChat Refactor PRD

## 1. Background

`src/main/lib/chat/agentChat.ts` is the core main-process chat engine for Kosmos agent conversations. It currently owns multiple responsibilities at once:

1. Chat session lifecycle and persistence.
2. System prompt construction and skill snapshot refresh.
3. Context enhancement, token accounting, and compression.
4. Main conversation loop and streaming API orchestration.
5. Tool execution, tool result post-processing, and cancellation handling.
6. Interactive request flows for approval, choice, and form input.

The file has grown to roughly 4.8K lines. This size is now a product delivery problem rather than a code-style issue:

1. It is slow to review and risky to modify.
2. Multiple unrelated features now collide in the same file, increasing regression risk.
3. Onboarding cost is high because contributors must understand too much incidental behavior before making targeted changes.
4. Future features like approval re-enablement, richer template post-processing, and tool execution changes will continue to make the file larger.

## 2. Problem Statement

We need to reduce the size and complexity of `agentChat.ts` so that:

1. The main file does not exceed 2000 lines.
2. Responsibilities are split into stable modules with explicit ownership.
3. The observable runtime behavior remains unchanged.
4. Future work in one subdomain does not require editing the entire chat engine.

This is a refactor and maintainability project, not a user-facing feature launch. The success condition is lower structural risk without changing product behavior.

## 3. Goals

### 3.1 Primary Goals

1. Reduce `agentChat.ts` to an orchestration-focused file below 2000 lines.
2. Extract coherent subdomains into dedicated modules with narrow APIs.
3. Preserve all current runtime behavior, event names, persistence schema, and cancellation semantics.
4. Make future changes to prompts, sessions, context compression, interactions, and tool execution independently reviewable.
5. Evolve the first-pass service split into a stable layered architecture where orchestration, mutable runtime state, and delivery adapters are separated.

### 3.2 Secondary Goals

1. Improve testability by moving logic into smaller services that can be exercised independently.
2. Make `startChat()` readable as the high-level conversation pipeline instead of a mixed implementation dump.
3. Reduce accidental coupling between interactive UI flows and low-level tool execution.
4. Remove transitional test-compatibility shims after migrating to supported chat-engine fixtures.
5. Prevent `AgentChatManager` from becoming the next monolithic bottleneck after `AgentChat` is reduced.

## 4. Non-Goals

1. No change to user-facing chat behavior.
2. No schema migration for chat session files unless already required by existing logic.
3. No IPC contract changes between main and renderer.
4. No feature redesign for memory, compression, or tool approvals.
5. No rewrite of `AgentChatManager` in this project unless a minimal compatibility edit is required.

Note:

The first extraction wave does not rewrite `AgentChatManager`, but the overall architecture plan must document the follow-up decomposition path so the refactor does not stop at file-size cleanup.

## 5. Scope

### 5.1 In Scope

1. Refactor `src/main/lib/chat/agentChat.ts` into smaller implementation modules.
2. Add any shared internal types required to support the extraction.
3. Update module documentation under `src/main/lib/chat/ai.prompt.md` if the architecture description changes.
4. Add or update tests that protect the extracted behavior.

### 5.2 Out of Scope

1. Reworking renderer chat UI behavior.
2. Changing MCP tool contracts.
3. Re-enabling currently bypassed approval validation logic.
4. Changing compression thresholds or memory heuristics.
5. General cleanup of unrelated large files.

## 6. User and Developer Impact

### 6.1 End User Impact

There should be no intentional user-visible behavior change. End users should continue to see:

1. The same streaming behavior.
2. The same tool execution flow.
3. The same interactive request lifecycle.
4. The same session persistence and title generation behavior.

### 6.2 Developer Impact

After the refactor:

1. Prompt work should happen in a dedicated prompt module.
2. Session persistence work should happen in a dedicated session module.
3. Context compression and token logic should happen in a dedicated context module.
4. Tool post-processing and interactive request flows should no longer require editing the main conversation loop.

## 7. Product Decision

`AgentChat` will remain the public per-session chat engine facade, but most implementation logic will move into submodules. The public entry points remain on `AgentChat`; internal behavior is delegated.

The resulting `AgentChat` file should primarily contain:

1. Constructor and core state.
2. Basic getters and setters.
3. `streamMessage()` and `retryChat()`.
4. `startChat()` as the conversation orchestrator.
5. API call wrappers such as `callWithToolsStreaming()` and `makeStreamingApiCall()`.
6. Thin delegations to extracted services.

This decision is now extended:

1. The current service split is the first milestone, not the final architecture.
2. The next milestone should extract the turn runner, runtime state container, and output port so the facade stops carrying hidden orchestration and delivery concerns.
3. Compatibility branches kept only for old test patterns are treated as temporary debt, not part of the target design.
4. The next manager milestone should extract registry state and session coordination so `AgentChatManager` stops acting as a mutable state warehouse.
5. After the manager split, the next `AgentChat` milestone should harden the remaining facade boundary so wrapper methods stay coordination-only rather than growing back into mixed-domain glue.

## 8. Target Module Split

### 8.1 Prompt and Runtime Context Module

Proposed file: `src/main/lib/chat/agentChatPromptService.ts`

Owns:

1. Tool discovery for the current agent.
2. Global, custom, and agent-specific system prompt assembly.
3. Knowledge base, workspace, and sub-agent prompt sections.
4. Skill snapshot refresh before a turn.

Expected extracted methods:

1. `getCurrentAvailableTools()`
2. `getLatestCustomSystemPrompt()`
3. `getGlobalSystemPrompt()`
4. `getAgentSpecificSystemPrompt()`
5. `buildSubAgentsSystemPrompt()`
6. `getCombinedSystemPromptForContext()`
7. `refreshSkillSnapshotIfNeeded()`
8. `getCombinedSystemPromptForCurrentTurn()`

### 8.2 Session and Persistence Module

Proposed file: `src/main/lib/chat/agentChatSessionService.ts`

Owns:

1. Chat session creation and metadata hydration.
2. Save queue handling and persistence writes.
3. Title generation and fallback title behavior.
4. User message edit validation and session mutation helpers.

Expected extracted methods:

1. `saveChatSession()`
2. `replaceFilePathInSession()`
3. `editUserMessage()`
4. `validateUserMessageEditable()`
5. `createChatSession()`
6. `getSchedulerMetadata()`
7. `generateChatSessionTitle()`
8. `generateFallbackTitle()`
9. `AddMessageToSession()`

### 8.3 Context and Compression Module

Proposed file: `src/main/lib/chat/agentChatContextService.ts`

Owns:

1. Context history mutation.
2. User message context enhancement.
3. Token accounting.
4. Compression checks and compressed-context replacement.
5. Memory extraction after a completed turn.
6. Context stats caching and listener notification support.

Expected extracted methods:

1. `extractFactsFromConversation()`
2. `addMessageToContext()`
3. `enhanceUserMessageContext()`
4. `CheckAndCompress()`
5. `calculateThreeComponentTokens()`
6. `calculateAndNotifyContext()`
7. `notifyContextChange()`

### 8.4 Interactive Request Module

Proposed file: `src/main/lib/chat/agentChatInteractionService.ts`

Owns:

1. Request ID generation.
2. History entry creation and summary text.
3. Pending interactive request lifecycle.
4. Approval, choice, and form request orchestration.

Expected extracted methods:

1. `buildInteractionId()`
2. `buildInteractionHistoryEntry()`
3. `buildInteractionSummary()`
4. `finalizeInteractiveRequest()`
5. `requestUserInteraction()`
6. `requestApprovalInteraction()`
7. `batchValidateAndRequestApproval()`
8. `requestUserInfoInput()`
9. `requestUserChoice()`

### 8.5 Tool Post-Processing Module

Proposed file: `src/main/lib/chat/agentChatToolPostProcessor.ts`

Owns:

1. Tool-specific post-processing dispatch.
2. `request_interactive_input` conversion into the unified interaction flow.
3. MCP template placeholder replacement and user input collection.
4. Agent template workspace placeholder processing.

Expected extracted methods:

1. `postProcessToolResult()`
2. `postProcessForRequestInteractiveInputTool()`
3. `postProcessForGetMcpTemplateFromLibraryTool()`
4. `postProcessForGetAgentTemplateFromLibraryTool()`

### 8.6 Tool Execution Module

Proposed file: `src/main/lib/chat/agentChatToolExecutor.ts`

Owns:

1. Tool argument parsing and truncation handling.
2. Tool execution context setup for builtin tools and MCP.
3. Cancellation registration and abort propagation.
4. Cleanup of incomplete tool calls after cancellation.

Expected extracted methods:

1. `assertExecutionActive()`
2. `invalidateActiveExecution()`
3. `cancelActiveToolExecution()`
4. `registerActiveToolCancellationHandler()`
5. `executeToolCall()`
6. `cleanupIncompleteToolCalls()`

## 9. Phased Delivery Plan

### Phase 1: Low-Risk Extractions

1. Extract prompt service.
2. Extract session service.
3. Extract context service.

Expected outcome:

1. Large immediate line-count reduction.
2. No changes to the main conversation loop shape.
3. Low regression risk because these areas already have coherent boundaries.

### Phase 2: Medium-Risk Extractions

1. Extract tool post-processor.
2. Extract interaction service.

Expected outcome:

1. `AgentChat` stops owning template-specific and UI-specific branches.
2. The request lifecycle becomes easier to reason about and test.

### Phase 3: High-Risk Extraction

1. Extract tool executor and cancellation cleanup.

Expected outcome:

1. The most sensitive runtime logic is isolated behind a narrow API.
2. `startChat()` becomes a readable orchestration method rather than a full implementation body.

### Phase 4: Turn Runner and Runtime State

1. Extract the multi-stage turn loop into a dedicated turn runner module.
2. Move mutable execution-only fields into an explicit runtime state container.
3. Keep `AgentChat.startChat()` as a thin entry point that delegates to the runner.

Expected outcome:

1. The remaining complexity is reduced at the behavioral level, not only by line count.
2. Cancellation, follow-up loops, and turn-finalization become stage-based and easier to test.
3. Service dependencies shift from ad-hoc closures to a stable state contract.
4. Turn Runner is introduced behind narrow stage ports rather than as a renamed sink for most `AgentChat` methods.

### Phase 5: Output Port and Compatibility Debt Removal

1. Introduce a delivery adapter or output port for streaming chunks, status changes, and interaction events.
2. Migrate tests away from `Object.create(AgentChat.prototype)` and own-property method stubs.
3. Remove compatibility-only branches once the supported fixture model is in place.

Expected outcome:

1. The chat engine no longer leaks `Electron.WebContents` semantics across domain services.
2. The facade becomes structurally clean rather than structurally split but historically constrained.

### Phase 6: AgentChatManager Decomposition

1. Split instance registry from unread-state, notification, and renderer synchronization logic.
2. Preserve public behavior while reducing lifecycle coupling.

Expected outcome:

1. The refactor no longer leaves a second monolith in the chat stack.
2. Future chat-engine changes can be reviewed independently from session-switching and notification code.
3. The target split should remain pragmatic at 2-3 modules; very small workspace-setup logic should stay colocated instead of being forced into its own micro-module.
4. This phase should land `AgentChatManagerRegistry` for instance/runtime/cancellation storage and `AgentChatManagerSessionCoordinator` for current-session, new-session, idle, unread, and foreground-protection semantics.
5. The manager follow-up should close by landing `AgentChatManagerNotificationBridge` so BrowserWindow focus wiring, system notifications, and direct status/navigation side effects no longer live inline in `AgentChatManager`.
6. Scheduled-silent execution should land in a dedicated `AgentChatManagerScheduledRunner` so scheduler metadata updates, persistence checkpoints, and completion/failure cleanup no longer live inline in `AgentChatManager`.

### Phase 7: Facade Boundary Hardening

1. Keep `AgentChat` as the only public per-session facade while reducing the remaining wrapper and glue logic inside the file.
2. Move residual multi-step wrapper behavior into already extracted collaborators such as the turn runner, session service, and output port.
3. Preserve public entry points and manager call sites while making facade methods obviously shallow.

Expected outcome:

1. Future feature work no longer expands `agentChat.ts` through convenience wrappers that mix multiple domains.
2. Reviews can reason about facade changes as API-surface or lifecycle changes instead of re-reading hidden orchestration logic.
3. The chat-engine architecture remains stable after the large extraction phases instead of slowly regressing toward a soft monolith.
4. `streamMessage()` and `retryChat()` delegate their multi-step entry flow through the turn runner instead of reassembling turn orchestration inline.

## 10. Acceptance Criteria

1. `src/main/lib/chat/agentChat.ts` is below 2000 lines after the refactor.
2. Public behavior remains unchanged for standard chat turns, tool turns, cancellations, and interactive flows.
3. No IPC event names or persisted session field names change.
4. The extracted modules have clear ownership and no circular dependency back into `AgentChat` implementation details.
5. `src/main/lib/chat/ai.prompt.md` is updated if the architecture description becomes outdated.
6. Every extraction PR includes regression verification evidence for the affected runtime paths.
7. The core conversation loop is no longer implemented inline as a large method body inside `AgentChat`.
8. Prototype-based compatibility wrappers are removed or explicitly tracked as remaining debt with a defined removal phase.
9. `AgentChatManager` delegates registry, session coordination, renderer synchronization, and notification/window side effects to dedicated collaborators.
10. `AgentChatManager` no longer directly owns registry Maps/Sets for instance, cancellation, new-session, idle, and pending-unread state.
11. Remaining `AgentChat` wrapper debt is resolved through dedicated boundary hardening instead of being left as implicit cleanup.
12. Scheduled-silent job execution is delegated through a dedicated runner instead of living inline in `AgentChatManager`.

## 10.1 Regression Gate

The refactor cannot be considered successful if the file gets smaller but runtime behavior becomes less reliable. The project therefore adopts a hard regression gate:

1. No extraction PR may merge without proving parity for the paths it touches.
2. Regression verification must be attached to each PR, not deferred to the final PR.
3. A failing regression test blocks the refactor, even if the architectural change is otherwise correct.

Required protected behaviors:

1. Basic user turn: user message persists, assistant response streams, session remains readable after reload.
2. Tool turn: `assistant(tool_calls)` and `tool` messages remain correctly paired in history and renderer updates.
3. Cancellation: in-flight streaming or tool execution cancellation does not leave broken orphan state.
4. Interactive requests: approval, choice, and form flows still persist pending state and resolution history correctly.
5. Compression and memory side effects: context compression, context stats, and fact extraction continue to happen on the same trigger conditions.
6. Template post-processing: MCP and agent template placeholder flows still produce the same user-facing outcomes.
7. Stop behavior: cancellation pushes idle promptly and late tool results are dropped after cancellation.
8. Save ordering: `saveChain` serialization semantics remain intact so deferred title generation or follow-up saves cannot overtake earlier message persistence.
9. Session coordination: current-session reuse, new-session ID reuse, idle cleanup, and unread-on-blur behavior remain unchanged after the manager split.
10. Registry lifecycle: cancellation source reuse and cleanup remain unchanged across `streamMessage`, `retryChat`, and `editUserMessage`.
11. Notification lifecycle: focus-loss unread marking, system notification delivery, and notification-click navigation remain unchanged after extracting the notification bridge.
12. Scheduled lifecycle: scheduler metadata transitions, initial/completed persistence checkpoints, unread marking, and final disposal remain unchanged after extracting the scheduled runner.

## 10.2 PR Merge Policy

Each refactor PR must satisfy all of the following:

1. Scope only one extraction phase or a tightly related subset.
2. Add or update tests before or alongside the code move.
3. Include a short regression checklist in the PR description with pass or fail evidence.
4. Preserve existing public APIs and event names unless a separate approved change explicitly says otherwise.
5. Leave the codebase in a releasable state; no temporary broken delegation layers may be merged.
6. Do not add new compatibility wrappers solely to preserve historical prototype-based tests.
7. A turn-runner PR must not hold a direct reference to the concrete `AgentChat` instance when a narrower port can be used.

## 11. Success Metrics

1. Main file line count reduced from about 4.8K to below 2K.
2. Each new submodule stays within a reasonable size target, ideally below 1.2K lines.
3. Feature PRs touching prompts, sessions, context, or tool post-processing can land without editing the main conversation file.
4. Review diffs become smaller and more domain-focused.
5. Chat engine tests can be written against supported fixtures and ports instead of partial prototype objects.
6. Session lifecycle or renderer notification changes no longer require editing both `AgentChat` and a manager monolith in the same PR.
7. Small chat-engine follow-up features usually land in extracted collaborators rather than adding new mixed-domain wrapper logic back into `agentChat.ts`.
8. BrowserWindow focus wiring and system-notification behavior can be tested without reaching through the full singleton manager object graph.
9. Scheduled-silent execution can be tested without reaching through the full singleton manager object graph.

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Behavioral drift during extraction | High | Keep `AgentChat` as facade and extract with delegation-first changes before any logic rewrite |
| Cancellation semantics regress | High | Leave tool executor extraction for the last phase and add focused regression tests |
| Interactive request ordering changes | High | Preserve existing request lifecycle and event order, especially around `assistant(tool_calls)` to `tool` pairing |
| Service boundaries leak full `AgentChat` object | Medium | Introduce narrow dependency interfaces rather than passing the full class into every module |
| Refactor stops halfway and leaves mixed ownership | Medium | Land in phased PRs, each producing a clean ownership boundary |
| Compatibility shims become permanent | Medium | Migrate tests to supported fixtures and remove shims in an explicit later phase |
| `AgentChatManager` becomes the new bottleneck | Medium | Plan and deliver manager decomposition after facade and runner extraction |

## 12.1 Regression Mitigation Strategy

To control regression risk throughout the project:

1. Establish a behavior baseline before the first extraction PR using the current implementation and existing test fixtures.
2. For every extracted domain, add focused tests around the exact methods being moved before large rewrites begin.
3. Prefer move-first delegation and only then simplify internals, so behavior changes and structure changes are not mixed in the same PR.
4. Preserve call ordering in `startChat()` until dedicated regression coverage exists for the affected branch.
5. Keep high-risk work, especially tool executor and cancellation cleanup, for the last phase after lower-risk extractions have already reduced blast radius.
6. Treat stop-and-cancel behavior as a first-class regression axis, not a side effect of generic cancellation coverage.
7. Migrate old prototype-based tests before removing the compatibility branches they currently rely on.
8. Treat `saveChain` ordering as a first-class regression axis whenever turn orchestration or session persistence boundaries move.
9. When decomposing `AgentChatManager`, introduce direct unit tests for registry and session coordination instead of relying only on singleton-manager integration coverage.
10. After the manager split, guard against facade regressions by treating new wrapper growth in `AgentChat` as an architectural regression, not harmless convenience code.

## 13. Open Implementation Constraints

These are constraints, not open product questions:

1. `AgentChatManager` compatibility must be preserved.
2. Current chat session save behavior, including deferred title regeneration, must not regress.
3. Existing prompt text content and tool normalization behavior must remain the same unless explicitly moved verbatim.
4. Approval validation is currently bypassed; the refactor must not accidentally re-enable it.
5. Stop semantics must continue to push idle promptly without waiting for active tool completion.
6. External MCP abort is best-effort only; the refactor must not imply rollback guarantees that the runtime does not have.
7. Session persistence must preserve existing `saveChain` queue semantics across any turn-runner or persistence-boundary extraction.
8. `AgentChat` must remain the only public per-session API surface even if internal wrapper cleanup continues in later phases.

## 14. Rollout Strategy

This work should land as internal refactor PRs with normal CI verification. No feature flag or staged rollout is required because there is no intentional user-facing change.

Recommended PR slicing:

1. PR 1: Prompt service + session service.
2. PR 2: Context service + tests.
3. PR 3: Tool post-processor + interaction service.
4. PR 4: Tool executor + cancellation cleanup + final `AgentChat` reduction.
5. PR 5: Turn runner extraction + stage-based orchestration tests.
6. PR 6: Runtime state extraction + supported fixture migration.
7. PR 7: Output port extraction + compatibility wrapper removal.
8. PR 8: `AgentChatManagerRegistry` + `AgentChatManagerSessionCoordinator` extraction + manager regression tests.
9. PR 9: `AgentChatManagerNotificationBridge` extraction + manager notification regression tests.
10. PR 10: `AgentChatManagerScheduledRunner` extraction + scheduled lifecycle regression tests.
11. PR 11: Facade boundary hardening for residual `AgentChat` wrapper/glue logic.
