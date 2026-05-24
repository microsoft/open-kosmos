# AgentChat Refactor Technical Design

> Version: 1.0.3 | Date: 2026-04-06

## 1. Overview

This document defines the technical design for splitting `src/main/lib/chat/agentChat.ts` into smaller implementation modules while preserving current runtime behavior.

The refactor uses a delegation-first approach:

1. `AgentChat` remains the public facade.
2. Logic is extracted into domain services.
3. Existing method behavior is preserved with minimal semantic changes.
4. Tests and documentation are updated as ownership moves.

## 2. Current State

`agentChat.ts` currently contains approximately 4.8K lines and mixes all of the following concerns:

1. Chat identity and lifecycle state.
2. Session creation, save queueing, title generation, edit operations.
3. Prompt assembly, knowledge-source prompt injection, and skill snapshot refresh.
4. Context enrichment, token counting, compression, and memory extraction.
5. Main streaming loop, API call formatting, and tool follow-up flow.
6. Interactive request orchestration.
7. Tool execution, tool result cleanup, and cancellation support.

This concentration creates two architectural problems:

1. The main class is no longer a readable orchestrator.
2. Domain logic can only be reused or tested through a very heavy object graph.

## 3. Design Principles

### 3.1 Preserve External Surface

`AgentChat` will continue to expose the same public methods used by `AgentChatManager` and the rest of the main process.

### 3.2 Extract by Responsibility, Not by Arbitrary Size

Modules should own coherent behavior, not random slices of lines.

### 3.3 Avoid Circular Dependencies

Extracted modules must depend on explicit interfaces or callbacks. They should not import the concrete `AgentChat` class unless unavoidable.

### 3.4 Keep StartChat as the Orchestrator

`startChat()` should remain in `AgentChat`, but its inner implementation should delegate major steps.

## 4. Target Architecture

### 4.1 Core Facade

File: `src/main/lib/chat/agentChat.ts`

Owns:

1. Constructor and state initialization.
2. Basic getters and setters.
3. Turn entry points.
4. Main orchestration loop.
5. Streaming API call wrapper.

Expected retained methods:

1. `constructor(...)`
2. `initialize()`
3. `streamMessage()`
4. `retryChat()`
5. `startChat()`
6. `callWithToolsStreaming()`
7. `makeStreamingApiCall()`
8. `destroy()`

### 4.2 Extracted Modules

| Module | File | Responsibility |
|--------|------|----------------|
| Prompt service | `src/main/lib/chat/agentChatPromptService.ts` | System prompt construction, tool discovery, skill snapshot refresh |
| Session service | `src/main/lib/chat/agentChatSessionService.ts` | Session lifecycle, save queue, title generation, edit mutation |
| Context service | `src/main/lib/chat/agentChatContextService.ts` | Context enhancement, compression, token stats, memory extraction |
| Interaction service | `src/main/lib/chat/agentChatInteractionService.ts` | Approval, form, and choice request lifecycle |
| Tool post-processor | `src/main/lib/chat/agentChatToolPostProcessor.ts` | Tool-result-specific follow-up processing |
| Tool executor | `src/main/lib/chat/agentChatToolExecutor.ts` | Tool execution, cancellation hookup, cleanup of incomplete tool calls |
| Shared internal types | `src/main/lib/chat/agentChatServices.ts` | Narrow interfaces and shared service contracts |

### 4.3 Target End State After Phase 2

The current extraction completed the first structural split, but the design target should go further than file size reduction.

The intended end state is:

1. `AgentChat` becomes a thin facade with constructor wiring, public entry points, read-only getters, and lifecycle teardown.
2. A dedicated turn orchestrator owns the multi-stage conversation loop.
3. A dedicated runtime-state container owns mutable per-session execution state.
4. Renderer and Electron-specific event delivery is hidden behind an output port instead of leaking `WebContents` semantics through the chat engine.
5. Temporary compatibility branches that preserve `Object.create(AgentChat.prototype)` test patterns are removed after tests migrate to supported fixtures.
6. `AgentChatManager` is reduced to lifecycle coordination and no longer mixes registry, notification, unread-state, idle cleanup, and filesystem setup in one class.

This means the architectural success bar is not only “below 2000 lines”, but also “clear ownership between orchestration, state, ports, and domain services”.

### 4.4 Proposed New Runtime Pieces

#### Turn Runner

Proposed file: `src/main/lib/chat/agentChatTurnRunner.ts`

Owns:

1. The end-to-end turn loop currently concentrated inside `startChat()`.
2. Stage sequencing: prepare, compress, stream, normalize tool calls, approve, execute, finalize.
3. Cancellation checks at stage boundaries.
4. Follow-up loop control after tool execution.

Why it exists:

1. The biggest remaining complexity is behavioral, not line-count based.
2. `startChat()` still contains too much embedded workflow logic to qualify as a thin orchestrator.
3. Cancellation and tool follow-up semantics become easier to reason about when modeled as explicit stages.

#### Runtime State Store

Proposed file: `src/main/lib/chat/agentChatRuntimeState.ts`

Owns:

1. Mutable per-session execution state currently stored as many `AgentChat` fields.
2. `chatStatus`, `pendingInteractiveRequest`, `messagesToSave`, `saveChain`, `currentCancellationToken`, `activeToolCancellationHandler`, `toolExecutionNonce`, and similar runtime-only state.
3. Narrow mutation methods so services no longer receive a large number of ad-hoc callback closures.

Why it exists:

1. Current services depend on many lambdas over `AgentChat` fields, which obscures the true state model.
2. A dedicated state object allows clearer invariants, simpler debugging, and better test fixtures.

#### Chat Output Port

Proposed file: `src/main/lib/chat/agentChatOutputPort.ts`

Owns:

1. Status emission.
2. Streaming chunk emission.
3. Interactive request delivery.
4. Any future non-Electron adapter requirements.

Why it exists:

1. The chat engine currently still knows too much about `Electron.WebContents`.
2. Remote sessions, scheduled runs, and future non-renderer consumers need the same core engine with different delivery adapters.

### 4.5 AgentChatManager Follow-Up Target

`AgentChatManager` was intentionally out of scope for the first extraction, but it is part of the architectural end state.

The current file still mixes:

1. instance registry,
2. cancellation source management,
3. session switching and unread-state transitions,
4. idle timer cleanup,
5. window attachment and renderer cache sync,
6. OS notification behavior,
7. session directory filesystem setup.

The follow-up split is now:

1. `AgentChatRegistry` for instance creation, caching, and destruction.
2. `AgentChatSessionCoordinator` for current-session switching, unread/read transitions, idle promotion rules, and lightweight session directory setup.
3. `AgentChatNotificationBridge` for renderer cache pushes, BrowserWindow wiring, and Notification lifecycle.
4. `AgentChatManagerScheduledRunner` for scheduled-silent session creation, scheduler metadata updates, persistence checkpoints, unread marking, notification triggering, and final cleanup.

This is intentionally a 2-3 module split, not a requirement to maximize module count. If the workspace setup logic remains small, it should stay inside the session coordinator rather than becoming a standalone module.

### 4.6 Manager Refactor Completion Scope

The final manager follow-up no longer stops at the renderer bridge.

The delivered target is:

1. Extract `AgentChatManagerRegistry` to own the instance cache, runtime mode registry, and cancellation-source registry.
2. Extract `AgentChatManagerSessionCoordinator` to own current-session pointers, new-chat session mapping, idle timers, pending-unread state, main-window foreground protection, and chat-session directory setup.
3. Extract `AgentChatManagerNotificationBridge` to own BrowserWindow focus wiring, system-notification lifecycle, and direct status/navigation pushes tied to window state.
4. Extract `AgentChatManagerScheduledRunner` to own scheduled-silent execution orchestration, including scheduler-state persistence checkpoints and completion/failure notification flow.
5. Keep read-status persistence decisions and public manager APIs in `AgentChatManager`, but make them delegate to registry, session-coordinator, renderer-bridge, notification-bridge, and scheduled-runner collaborators instead of mutating UI side effects or scheduled execution flow inline.

The success bar for this completion is:

1. `AgentChatManager` no longer directly stores the large registry Maps and Sets for instance runtime state.
2. Session-switching code no longer mutates idle-timer and pending-unread state inline.
3. BrowserWindow wiring and Notification lifecycle no longer live inline inside the singleton manager.
4. Scheduled-silent orchestration no longer lives inline inside the singleton manager.
5. The manager remains the only public singleton facade, so external callers do not change.
6. Existing notification, unread, and scheduled-run semantics remain unchanged.

### 4.7 AgentChat Facade Boundary Result

The current `AgentChat` split removed most domain-heavy responsibilities, but the facade still carries a non-trivial amount of wrapper and glue logic.

The remaining debt is no longer about large domains living in the wrong file. It is about preserving a strict boundary between:

1. public entry points and lifecycle teardown,
2. orchestration-stage delegation,
3. lightweight read-only state access, and
4. historical wrapper helpers that still compose multiple concerns inline.

The resulting follow-up is not another large extraction by theme. It is a boundary-hardening pass that keeps `AgentChat` as the public facade while making the remaining methods visibly shallow.

This pass focuses on:

1. moving multi-step wrapper logic that still combines state reads, orchestration branching, and side-effect dispatch into the already extracted collaborators,
2. reducing facade methods to argument normalization, narrow delegation, and lifecycle-safe error handling,
3. keeping compatibility semantics stable for `streamMessage()`, `retryChat()`, `editUserMessage()`, and teardown paths,
4. avoiding any reintroduction of domain logic into facade-only helpers when future features are added.

This follow-up should not create artificial micro-modules. If a wrapper method is only a few lines after cleanup, it should remain in the facade.

### 4.8 Facade Boundary Hardening Scope

The final `AgentChat`-specific hardening pass is narrower than the earlier service split.

The delivered target is:

1. keep `AgentChat` responsible for public API stability, constructor wiring, and final lifecycle teardown only,
2. move residual multi-branch wrapper behavior into `agentChatTurnRunner.ts`, `agentChatSessionService.ts`, `agentChatOutputPort.ts`, or other already-owned modules based on responsibility,
3. preserve the existing public method names and call sites so `AgentChatManager` and tests do not need another integration rewrite,
4. make facade methods small enough that future reviews can identify behavior changes without reopening the full chat-engine object graph.

The success bar for this hardening pass is:

1. `AgentChat` remains the only public per-session facade, but its methods are visibly coordination-only,
2. new chat-engine features can usually land in extracted collaborators without expanding facade wrappers,
3. `streamMessage()` and `retryChat()` no longer inline their own multi-step turn orchestration scaffolding,
4. there is no remaining undocumented wrapper debt that still mixes multiple domains inside `agentChat.ts`.

## 5. Internal Contracts

To avoid passing the full `AgentChat` object into every service, define a small set of internal interfaces.

### 5.1 Identity and Runtime State

```typescript
export interface AgentChatIdentity {
  currentUserAlias: string;
  chatId: string;
  chatSessionId: string;
}

export interface AgentChatRuntimeState {
  getAgentName(): string;
  getCurrentModelId(): string;
  getCurrentChatSession(): ChatSessionFile | null;
  setCurrentChatSession(next: ChatSessionFile | null): void;
  getEventSender(): Electron.WebContents | null;
  isRemoteSession(): boolean;
}
```

### 5.2 Context and Prompt Dependencies

```typescript
export interface AgentChatPromptDependencies {
  getLatestAgentConfig(): AgentConfig | null;
  getAgentName(): string;
  getCurrentUserAlias(): string;
  getChatId(): string;
  getChatSessionId(): string;
}

export interface AgentChatContextDependencies {
  getChatHistory(): Message[];
  getContextHistory(): Message[];
  replaceContextHistory(messages: Message[]): void;
  markSessionUpdated(): void;
  calculateAndNotifyContext(): Promise<void>;
}
```

### 5.3 Persistence Dependencies

```typescript
export interface AgentChatSessionDependencies {
  getCurrentChatSession(): ChatSessionFile | null;
  setCurrentChatSession(next: ChatSessionFile | null): void;
  getFirstUserMessage(): Message | null;
  setFirstUserMessage(message: Message | null): void;
  getMessagesToSave(): Message[];
  setMessagesToSave(messages: Message[]): void;
  exitNewChatSessionState(): void;
}
```

These interfaces do not need to be perfect on day one, but they should keep service dependencies explicit.

### 5.4 Additional Contracts Required For Phase 2

The current contract set is sufficient for first-pass extraction, but insufficient for the end-state architecture. Phase 2 should add the following contract groups.

#### Turn Runner Contract

```typescript
export interface AgentChatTurnPreparationPort {
  ensureAuthSession(): Promise<void>;
  checkAndCompress(): Promise<void>;
}

export interface AgentChatTurnExecutionPort {
  callWithToolsStreaming(token?: CancellationToken): Promise<StreamingApiResponse>;
  requestApproval(toolCalls: NormalizedToolCall[]): Promise<Map<string, boolean>>;
  executeToolCall(toolCall: NormalizedToolCall, approved?: boolean): Promise<any>;
  postProcessToolResult(toolCall: NormalizedToolCall, toolResult: any): Promise<any>;
}

export interface AgentChatTurnPersistencePort {
  persistMessage(message: Message): Promise<void>;
  finalizeCompletedTurn(): Promise<void>;
  handleTurnFailure(error: unknown): Promise<void>;
}

export interface AgentChatTurnRunnerDeps {
  prepare: AgentChatTurnPreparationPort;
  execute: AgentChatTurnExecutionPort;
  persist: AgentChatTurnPersistencePort;
}
```

The runner should depend on grouped stage ports, not a flat list that merely re-exposes most of `AgentChat` under a new interface name.

#### Runtime State Contract

```typescript
export interface AgentChatRuntimeStatePort {
  readonly chatStatus: ChatStatus;
  readonly pendingInteractiveRequest: InteractiveRequest | null;
  readonly currentCancellationToken: CancellationToken | undefined;
  readonly toolExecutionNonce: number;
  setChatStatus(status: ChatStatus): void;
  setPendingInteractiveRequest(request: InteractiveRequest | null): void;
  bindCancellationToken(token: CancellationToken | undefined): void;
  bumpToolExecutionNonce(): number;
}
```

Prefer readonly state plus explicit mutation methods over generic getter and setter pairs. The goal is to model state transitions, not to recreate a Java-style bean API.

#### Output Port Contract

```typescript
export interface AgentChatOutputPort {
  emitStreamingChunk(chunk: StreamingChunk): void;
  emitStatus(status: ChatStatus): void;
  emitInteractionRequest(request: InteractiveRequest): void;
  emitInteractionProcessed(event: InteractionProcessedEvent): void;
  flush?(): Promise<void>;
}
```

`flush()` is optional in the initial implementation. It exists to reserve space for headless, buffered, or remote delivery strategies without forcing the first adapter to over-engineer streaming semantics.

These contracts should be introduced before attempting to make `AgentChat` a truly thin facade.

### 5.5 Manager Registry Contract

```typescript
export interface AgentChatManagerRegistry {
  getInstance(chatSessionId: string): AgentChat | null;
  setInstance(chatSessionId: string, instance: AgentChat, runtimeMode: AgentChatRuntimeMode): void;
  removeInstance(chatSessionId: string): AgentChat | null;
  getRuntimeMode(chatSessionId: string): AgentChatRuntimeMode | null;
  listCachedSessionIds(): string[];
  getOrCreateCancellationSource(chatSessionId: string): CancellationTokenSource;
  getCancellationSource(chatSessionId: string): CancellationTokenSource | null;
  clearCancellationSource(chatSessionId: string): void;
  disposeAllCancellationSources(): void;
  clearAll(): void;
}
```

The registry contract should own cache mutation and source lifecycle. `AgentChatManager` should not manually touch backing Maps after this split.

### 5.6 Session Coordinator Contract

```typescript
export interface AgentChatManagerSessionCoordinator {
  getCurrentChatSessionId(): string | null;
  getCurrentInstance(): AgentChat | null;
  activateSession(chatSessionId: string, instance: AgentChat): void;
  clearCurrentSession(chatSessionId: string): void;
  getOrCreateNewChatSessionId(chatId: string, generate: () => string): string;
  getNewChatSessionId(chatId: string): string | null;
  exitNewChatSession(chatId: string, chatSessionId: string): {
    success: boolean;
    existingChatSessionId: string | null;
  };
  handleSessionLostFocus(chatSessionId: string, status: ChatStatus | string, runtimeMode: AgentChatRuntimeMode | null): void;
  handleStatusChange(chatSessionId: string, status: ChatStatus | string, runtimeMode: AgentChatRuntimeMode | null): void;
  shouldMarkUnreadAfterCompletion(chatSessionId: string, finalStatus: ChatStatus | string, messagesCount: number): boolean;
  hasPendingUnread(chatSessionId: string): boolean;
  clearPendingUnread(chatSessionId: string): void;
  ensureChatSessionDirectory(currentUserAlias: string | null, chatId: string, chatSessionId: string): Promise<string | null>;
}
```

The coordinator contract should own focus, protection, idle, and new-session semantics. `AgentChatManager` can still decide when to persist unread state or notify the renderer, but it should not be the storage location for those coordination primitives.

## 6. Method Extraction Map

### 6.1 Prompt Service

Source methods in `agentChat.ts`:

1. `getCurrentAvailableTools()`
2. `getLatestCustomSystemPrompt()`
3. `getGlobalSystemPrompt()`
4. `getAgentSpecificSystemPrompt()`
5. `buildSubAgentsSystemPrompt()`
6. `getCombinedSystemPromptForContext()`
7. `refreshSkillSnapshotIfNeeded()`
8. `getCombinedSystemPromptForCurrentTurn()`

Service API:

```typescript
export class AgentChatPromptService {
  constructor(private readonly deps: AgentChatPromptDependencies) {}

  async getCurrentAvailableTools(): Promise<any[]> {}
  getLatestCustomSystemPrompt(): Message[] {}
  getCombinedSystemPromptForContext(): Message[] {}
  async getCombinedSystemPromptForCurrentTurn(): Promise<Message[]> {}
}
```

### 6.2 Session Service

Source methods:

1. `saveChatSession()`
2. `replaceFilePathInSession()`
3. `editUserMessage()`
4. `validateUserMessageEditable()`
5. `createChatSession()`
6. `getSchedulerMetadata()`
7. `generateChatSessionTitle()`
8. `generateFallbackTitle()`
9. `AddMessageToSession()`

Service API:

```typescript
export class AgentChatSessionService {
  async saveChatSession(): Promise<{ success: boolean; error?: string }> {}
  async addMessageToSession(message: Message): Promise<void> {}
  async editUserMessage(...args: any[]): Promise<any> {}
  createChatSession(params: CreateChatSessionParams): void {}
}
```

Naming note:

`AddMessageToSession()` should be renamed to `addMessageToSession()` during extraction. The current capitalized name is inconsistent with the rest of the file.

### 6.3 Context Service

Source methods:

1. `extractFactsFromConversation()`
2. `addMessageToContext()`
3. `enhanceUserMessageContext()`
4. `CheckAndCompress()`
5. `calculateThreeComponentTokens()`
6. `calculateAndNotifyContext()`
7. `notifyContextChange()`

Service API:

```typescript
export class AgentChatContextService {
  async addMessageToContext(message: Message): Promise<void> {}
  async checkAndCompress(): Promise<void> {}
  async calculateThreeComponentTokens(contextHistory?: Message[]): Promise<TokenBreakdown> {}
  async calculateAndNotifyContext(): Promise<void> {}
  async extractFactsFromConversation(): Promise<void> {}
}
```

Naming note:

`CheckAndCompress()` should be normalized to `checkAndCompress()` during extraction.

### 6.4 Interaction Service

Source methods:

1. `buildInteractionId()`
2. `buildInteractionHistoryEntry()`
3. `buildInteractionSummary()`
4. `finalizeInteractiveRequest()`
5. `requestUserInteraction()`
6. `requestApprovalInteraction()`
7. `batchValidateAndRequestApproval()`
8. `requestUserInfoInput()`
9. `requestUserChoice()`

Service API:

```typescript
export class AgentChatInteractionService {
  async requestApprovalInteraction(requests: ApprovalRequestItem[]): Promise<Map<string, boolean>> {}
  async requestUserInfoInput(request: InfoInputRequest): Promise<Record<string, any> | null> {}
  async requestUserChoice(...args: any[]): Promise<string[] | null> {}
}
```

### 6.5 Tool Post-Processor

Source methods:

1. `postProcessToolResult()`
2. `postProcessForRequestInteractiveInputTool()`
3. `postProcessForGetMcpTemplateFromLibraryTool()`
4. `postProcessForGetAgentTemplateFromLibraryTool()`

Service API:

```typescript
export class AgentChatToolPostProcessor {
  async postProcessToolResult(toolCall: any, toolResult: any): Promise<any> {}
}
```

The dispatcher remains a single public entry point. Tool-specific implementations remain private methods on the post-processor service.

### 6.6 Tool Executor

Source methods:

1. `assertExecutionActive()`
2. `invalidateActiveExecution()`
3. `cancelActiveToolExecution()`
4. `registerActiveToolCancellationHandler()`
5. `executeToolCall()`
6. `cleanupIncompleteToolCalls()`

Service API:

```typescript
export class AgentChatToolExecutor {
  assertExecutionActive(token: CancellationToken | undefined, executionNonce: number, stage: string): void {}
  invalidateActiveExecution(): void {}
  async cancelActiveToolExecution(): Promise<void> {}
  async executeToolCall(toolCall: any, approved?: boolean): Promise<any> {}
  async cleanupIncompleteToolCalls(): Promise<void> {}
}
```

## 7. Main Orchestration After Extraction

After the extraction, `startChat()` should still describe the end-to-end turn flow in one place:

```typescript
private async startChat(token?: CancellationToken, callbacks: StartChatCallbacks = {}): Promise<void> {
  this.currentCancellationToken = token;
  this.toolExecutor.invalidateActiveExecution();

  try {
    await this.ensureAuthSession();

    while (requiresFollowUp) {
      token?.throwIfCancellationRequested?.();
      await this.contextService.checkAndCompress();
      this.setChatStatus(ChatStatus.SENDING_RESPONSE);

      const streamingResponse = await this.callWithToolsStreaming(token);
      const response = streamingResponse.message;

      await this.persistAssistantOrToolCallingMessage(response);

      if (hasToolCalls(response)) {
        const approvalMap = await this.interactionService.batchValidateAndRequestApproval(toolCalls);
        await this.executeApprovedToolCalls(toolCalls, approvalMap, token);
      } else {
        await this.contextService.extractFactsFromConversation();
        this.setChatStatus(ChatStatus.IDLE);
        requiresFollowUp = false;
      }
    }
  } catch (error) {
    await this.handleStartChatFailure(error);
    throw error;
  }
}
```

This is the target shape. It is acceptable if the final code differs in helper names, but the method should read like orchestration, not implementation storage.

### 7.1 Updated Target Shape For The Next Iteration

After the current service split, the next iteration should move the loop body itself into a dedicated turn runner so `AgentChat` becomes closer to:

```typescript
private async startChat(token?: CancellationToken, callbacks: StartChatCallbacks = {}): Promise<void> {
  this.runtimeState.setCurrentCancellationToken(token);
  this.turnRunner.beginTurn();

  try {
    await this.turnRunner.run({ token, callbacks });
  } catch (error) {
    await this.turnRunner.handleFailure(error);
    throw error;
  } finally {
    this.runtimeState.setCurrentCancellationToken(undefined);
  }
}
```

This is the shape that best matches the architectural goal. The current `startChat()` is still acceptable as an intermediate state, but not the final one.

## 8. Dependency Wiring

Services should be instantiated once in the `AgentChat` constructor.

Example:

```typescript
this.promptService = new AgentChatPromptService({ ... });
this.sessionService = new AgentChatSessionService({ ... });
this.contextService = new AgentChatContextService({ ... });
this.interactionService = new AgentChatInteractionService({ ... });
this.toolPostProcessor = new AgentChatToolPostProcessor({ ... });
this.toolExecutor = new AgentChatToolExecutor({ ... });
```

Rules:

1. Services may depend on each other only through injected callbacks if needed.
2. Avoid direct cross-service imports unless the dependency is stable and acyclic.
3. The facade owns lifecycle and state; services own domain behavior.

## 9. Migration Plan

The original four-PR plan covered the first extraction wave. The following extension defines the second wave needed to reach the architectural end state.

### 9.1 PR 1: Prompt and Session Extraction

Changes:

1. Add prompt service.
2. Add session service.
3. Delegate from `AgentChat`.
4. Keep method names on `AgentChat` as wrappers temporarily if that reduces diff size.

Expected result:

1. Main file drops by roughly 1.1K to 1.5K lines.
2. No conversation-loop semantics change.
3. Prompt composition and session persistence parity are proven by focused tests.

### 9.2 PR 2: Context Extraction

Changes:

1. Add context service.
2. Move compression, token calculation, and memory extraction.
3. Replace direct field mutation with explicit context service calls.

Expected result:

1. Main file drops further.
2. Context behavior becomes independently testable.
3. Compression and token accounting triggers remain unchanged.

### 9.3 PR 3: Interaction and Tool Post-Processing Extraction

Changes:

1. Move interactive request lifecycle into dedicated service.
2. Move template and interactive-input post-processing into tool post-processor.

Expected result:

1. UI-driven logic no longer mixes with low-level chat loop code.
2. Interactive request persistence and template-driven input collection remain behaviorally identical.

### 9.4 PR 4: Tool Executor Extraction and Final Cleanup

Changes:

1. Move tool execution and cleanup.
2. Normalize helper naming.
3. Remove obsolete wrappers.
4. Update docs and tests.

Expected result:

1. `agentChat.ts` stays below the 2000-line target.
2. Cancellation and tool cleanup semantics are still protected by regression tests.

### 9.5 PR 5: Turn Runner Extraction

Changes:

1. Introduce `agentChatTurnRunner.ts`.
2. Move the `startChat()` loop body into explicit stage methods.
3. Keep `AgentChat.startChat()` as a thin delegating entry point.
4. Preserve current cancellation and follow-up semantics exactly.

Expected result:

1. The largest remaining behavioral hotspot is isolated.
2. The conversation loop becomes independently testable without constructing the full `AgentChat` object.
3. Future work on tool follow-up, compression triggers, or turn-finalization no longer needs to edit the facade.
4. The runner must not retain a direct reference to the concrete `AgentChat` instance.

### 9.6 PR 6: Runtime State Extraction

Changes:

1. Introduce `agentChatRuntimeState.ts`.
2. Move mutable execution-only fields behind an explicit state port.
3. Reduce service constructor callback count by depending on the state port instead.

Expected result:

1. State transitions become explicit and easier to audit.
2. Service boundaries become narrower and more stable.
3. Test fixtures no longer need to partially simulate class field initialization.

### 9.7 PR 7: Output Port And Compatibility Test Migration

Changes:

1. Introduce `agentChatOutputPort.ts` or equivalent adapter.
2. Migrate tests away from `Object.create(AgentChat.prototype)` and own-property method stubs.
3. Remove compatibility branches such as override-save and direct own-property context hooks once tests are migrated.

Expected result:

1. The chat engine is no longer coupled to Electron delivery semantics.
2. `AgentChat` no longer needs transitional wrapper logic for historical tests.
3. The facade can be kept small without hidden legacy branches.

### 9.8 PR 8: AgentChatManager Decomposition

Changes:

1. Split instance registry, unread/session switching, renderer bridging, and notification logic.
2. Preserve public manager APIs so callers do not need a large migration.

Expected result:

1. The main-process chat lifecycle becomes layered rather than manager-centric.
2. Chat engine changes no longer spill into unread-state or notification code reviews.

## 9.9 Regression Control Plan

Refactor work must use an explicit parity-first workflow:

1. Capture the current behavior as baseline tests before extracting a domain with non-trivial side effects.
2. Extract logic behind delegation with minimal internal edits.
3. Run focused tests for the affected domain immediately after extraction.
4. Only after parity is proven may follow-up cleanup or naming normalization happen.

Recommended baseline domains:

1. Prompt assembly and skill snapshot refresh.
2. Session save ordering, including deferred title generation and `saveChain` serialization invariants.
3. Context compression, token counting, and context stats notification.
4. Tool-call execution, tool-result persistence, and truncated-argument error behavior.
5. Cancellation cleanup of incomplete tool calls.
6. Interactive request creation, response handling, and history persistence.

### 9.10 Compatibility Debt Retirement Plan

The current codebase intentionally preserves compatibility for tests that use `Object.create(AgentChat.prototype)` and stub methods as own-properties. This is acceptable only as a transitional measure.

Required retirement plan:

1. Introduce supported test factories that construct `AgentChat` with explicit fake ports and state.
2. Convert existing tests that rely on own-property stubbing of `saveChatSession`, `enhanceUserMessageContext`, and `calculateAndNotifyContext`.
3. Remove compatibility-only branches after the migrated tests prove parity.
4. Do not add new tests that depend on prototype-only construction.

## 10. Testing Strategy

### 10.1 Existing Behavior to Protect

These behaviors must be regression-tested after each extraction phase:

1. User message enters chat history and context history correctly.
2. Deferred session title generation still saves twice when appropriate.
3. Compression still triggers based on current token threshold behavior.
4. Tool calls still pair correctly with `tool` messages.
5. Truncated tool arguments still produce structured error tool results.
6. Cancellation still aborts fetch and cleans up incomplete tool calls.
7. Interactive request history still persists on resolution.
8. Remote session mode still disables interactive UI tooling.
9. Session saves still preserve the existing queueing and serialization behavior enforced by `saveChain`.

### 10.1.1 Mandatory Regression Matrix

At minimum, the following scenarios must be exercised before the refactor is considered safe:

| Scenario | Why it matters | Verification expectation |
|----------|----------------|--------------------------|
| Plain user turn | Protects the default chat path | Assistant reply is persisted and displayable after reload |
| Tool call turn | Protects multi-message pairing semantics | `assistant(tool_calls)` and `tool` messages remain correctly ordered and correlated |
| Truncated tool args | Protects error recovery path | Structured tool error is emitted instead of crashing the turn |
| Cancel during streaming | Protects fetch abort path | Chat returns to idle and no broken partial state remains |
| Cancel during tool execution | Protects cleanup path | Incomplete tool calls are cleaned without corrupting history |
| Interactive choice or form | Protects user-blocking flow | Pending request is emitted, resolved, persisted, and replayable |
| MCP template placeholder flow | Protects tool post-processing | Placeholder replacement and optional user-input flow remain correct |
| Compression threshold hit | Protects context health | Context is compressed and token stats stay coherent |
| Save queue ordering | Protects persistence integrity | Sequential saves remain serialized and deferred title regeneration cannot overtake message persistence |

### 10.2 Suggested Tests

1. Extract unit tests for prompt service prompt composition.
2. Add unit tests for session service message queue behavior.
3. Add unit tests for context service token and compression pathways.
4. Add unit tests for tool post-processor placeholder replacement and skip/submit branches.
5. Add unit tests for interaction history summaries.
6. Add focused tests for tool executor cancellation cleanup.
7. Add turn-runner stage tests covering follow-up loops and idle transition.
8. Add runtime-state tests covering nonce, pending interaction, and status invariants.
9. Add output-port adapter tests for renderer-present and headless modes.

### 10.2.1 Phase-by-Phase Required Tests

Each PR phase has a minimum required test surface:

1. PR 1 must cover prompt composition and session persistence behavior.
2. PR 2 must cover compression triggering, token counting, and context notification updates.
3. PR 3 must cover interactive request lifecycle and template post-processing branches.
4. PR 4 must cover tool execution errors, cancellation, and cleanup of incomplete tool calls.
5. PR 5 must cover full turn orchestration stage ordering and follow-up tool loops.
6. PR 6 must cover runtime-state invariants and state mutation boundaries.
7. PR 7 must replace legacy `Object.create` test coverage with supported fixtures before compatibility branches are removed.
8. PR 8 must cover session switching, unread transitions, idle cleanup, and renderer cache replay in `AgentChatManager` splits.
9. Any PR that touches turn persistence must cover `saveChain` ordering explicitly.

### 10.2.2 Mandatory Test Migration Constraint

No new architectural extraction should introduce additional compatibility wrappers solely to preserve historical test style. If a refactor is blocked by prototype-based test setup, the preferred action is to migrate the test harness first.

### 10.3 Verification Commands

At minimum, each PR should run the relevant project tests or focused Jest suites covering chat engine behavior. The exact command can be narrowed per PR, but the verification bar must include runtime-path coverage, not only typecheck.

Recommended verification sequence for each PR:

1. Run the focused Jest suite for the extracted domain.
2. Run any existing `AgentChat` or chat-engine integration tests impacted by the change.
3. Run lint for touched files if the PR introduces new modules.
4. For high-risk phases, run the relevant chat E2E coverage if available or add focused integration coverage before merging.

### 10.4 Review Checklist

Reviewers should reject the PR if any of the following are true:

1. Logic was both moved and behaviorally rewritten without clear regression coverage.
2. New service boundaries still depend on the full `AgentChat` instance with no explicit contract.
3. Cancellation, tool pairing, or interaction lifecycle changes are not covered by tests.
4. The PR claims no behavior change but does not provide verification evidence.
5. A turn-runner PR retains a concrete `AgentChat` reference or weakens `saveChain` serialization guarantees without coverage.

## 11. Documentation Changes

The following docs must be updated as part of implementation PRs:

1. `src/main/lib/chat/ai.prompt.md`
2. `ai.prompt/arch-main.md` only if the Chat Engine entry materially changes in a way the index should expose

Update guidance:

1. Replace the statement that `agentChat.ts` alone owns the full chat engine implementation.
2. Add the newly introduced service files to the Key Files table.
3. Update `Last verified` date on the module doc when modified.

## 12. Risks and Mitigations

### 12.1 Service Boundary Overreach

Risk:

Services become thin wrappers that still implicitly depend on all `AgentChat` internals.

Mitigation:

1. Introduce explicit internal interfaces.
2. Pass only required state and callbacks.

### 12.2 Hidden State Mutation

Risk:

Extraction breaks behavior because services mutate state in undocumented ways.

Mitigation:

1. Centralize session and context mutations behind explicit methods.
2. Preserve current save ordering and state transitions during extraction.

### 12.3 Naming Churn Creates Noisy Diffs

Risk:

Renaming too much at once makes review difficult.

Mitigation:

1. Prefer move-first, rename-second.
2. Only normalize obvious outliers such as `AddMessageToSession` and `CheckAndCompress` when the surrounding extraction already changes the call site.

### 12.4 Compatibility Layer Becomes Permanent Debt

Risk:

Temporary compatibility branches remain in place indefinitely and block deeper simplification.

Mitigation:

1. Treat compatibility wrappers as explicitly temporary.
2. Tie removal to test-harness migration work in the plan.
3. Reject follow-up refactors that add more own-property compatibility hooks.

### 12.5 Manager-Centric Lifecycle Complexity Persists

Risk:

`AgentChat` becomes cleaner, but `AgentChatManager` remains a large mixed-responsibility entry point and becomes the new bottleneck.

Mitigation:

1. Plan manager decomposition as a first-class follow-up phase, not a vague future cleanup.
2. Keep new lifecycle behavior out of the manager unless it clearly belongs there.

## 13. Completion Criteria

The refactor is considered complete when:

1. `agentChat.ts` is below 2000 lines.
2. Extracted modules compile and are documented.
3. Relevant tests pass.
4. Module docs reflect the new architecture.
5. No known runtime regression remains in the chat flow, tool flow, or interaction flow.
6. The main conversation loop is no longer implemented inline inside `AgentChat.startChat()`.
7. Transitional `Object.create` compatibility branches are removed or formally tracked as remaining debt with an owner and follow-up PR.
8. `AgentChatManager` has a documented decomposition plan, even if delivered in a later sequence.
