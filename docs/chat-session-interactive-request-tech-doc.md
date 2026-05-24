# Chat Session Interactive Request Technical Design

> Version: 1.0.0 | Date: 2026-03-27

## 1. Overview

This document defines the implementation plan for a unified interactive request system in Kosmos chat sessions.

It replaces the current split implementation for:

1. Batch tool approval requests.
2. User info input requests.

It also introduces one new interaction type:

1. Choice requests, including single select and multi select.

The migration does not preserve backward compatibility with the old interaction APIs or renderer surfaces. It does preserve current product capabilities through parity-driven migration and regression coverage.

## 2. Current State

### 2.1 Existing Runtime Paths

Kosmos already has two wait-for-user-input implementations:

1. Approval path:
   [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts), [src/main/main.ts](../src/main/main.ts), [src/preload/main.ts](../src/preload/main.ts), [src/renderer/lib/chat/agentChatSessionCacheManager.ts](../src/renderer/lib/chat/agentChatSessionCacheManager.ts), [src/renderer/components/chat/ApprovalBar.tsx](../src/renderer/components/chat/ApprovalBar.tsx)
2. Info input path:
   [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts), [src/main/main.ts](../src/main/main.ts), [src/preload/main.ts](../src/preload/main.ts), [src/renderer/lib/chat/agentChatSessionCacheManager.ts](../src/renderer/lib/chat/agentChatSessionCacheManager.ts), [src/renderer/components/chat/AskForInfo.tsx](../src/renderer/components/chat/AskForInfo.tsx)

### 2.2 Current Architectural Problems

1. The protocol is split into approval-specific and info-input-specific event pairs.
2. Renderer state is split into `pendingApprovalRequests` and `pendingInfoInputRequest`.
3. UI surfaces are inconsistent: composer-level bar versus content-level overlay.
4. Main-process waiting logic uses global pending-handler maps rather than session-owned interaction state.
5. Approval security validation is currently bypassed by a temporary short-circuit in [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts#L3380).

### 2.3 Current Capability That Must Survive Migration

1. Runtime can pause and wait for input.
2. Approval can batch multiple tool items.
3. Info input supports typed fields, defaults, validation, and skip.
4. Pending state is isolated by chat session.
5. Renderer clears pending state when the response is processed.

## 3. Design Principles

1. One interaction contract for all request types.
2. One pending interaction slot per chat session.
3. Timeline-native rendering.
4. Session-scoped runtime ownership.
5. No backward compatibility layer after migration.
6. Capability parity before deletion of old paths.

## 4. Target Architecture

### 4.1 High-Level Flow

```text
AgentChat or tool runtime needs user input
  -> create InteractiveRequest
  -> persist/emit pending interaction for chatSessionId
  -> renderer timeline renders interaction card
  -> user responds
  -> renderer sends InteractiveResponse
  -> AgentChat resolves session-scoped pending interaction
  -> runtime resumes
  -> pending interaction card is dismissed and summary is stored internally
```

### 4.2 Ownership Model

1. `AgentChat` owns creation and resolution of interactive requests for its session.
2. A dedicated interaction manager owns pending resolvers keyed by `chatSessionId` and `interactionId`.
3. `AgentChatSessionCacheManager` owns frontend cache and visibility for the current session.
4. Timeline rendering owns the user-visible interaction card state.

## 5. Data Model

### 5.1 Shared Types

Recommended new file:

1. `src/shared/types/interactiveRequestTypes.ts`

Recommended model:

```ts
export type InteractiveRequestType = 'approval' | 'choice' | 'form';
export type InteractiveRequestStatus =
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'rejected'
  | 'skipped'
  | 'expired';

export interface InteractiveRequestBase {
  interactionId: string;
  chatId: string;
  chatSessionId: string;
  requestType: InteractiveRequestType;
  status: InteractiveRequestStatus;
  title: string;
  description?: string;
  createdAt: number;
  expiresAt?: number;
  source?: 'assistant' | 'tool' | 'system';
  metadata?: Record<string, unknown>;
}

export interface ApprovalInteractionItem {
  itemId: string;
  toolCallId?: string;
  toolName: string;
  message: string;
  paths: Array<{
    path: string;
    normalizedPath?: string;
  }>;
}

export interface ApprovalInteractionRequest extends InteractiveRequestBase {
  requestType: 'approval';
  items: ApprovalInteractionItem[];
}

export interface ChoiceInteractionOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ChoiceInteractionRequest extends InteractiveRequestBase {
  requestType: 'choice';
  mode: 'single' | 'multi';
  options: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractionField {
  key: string;
  label: string;
  type: 'string' | 'int' | 'double' | 'boolean';
  control?: 'text' | 'textarea' | 'folder' | 'file' | 'number' | 'checkbox' | 'select' | 'multiselect';
  required?: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  description?: string;
}

export interface FormInteractionRequest extends InteractiveRequestBase {
  requestType: 'form';
  fields: FormInteractionField[];
}

export type InteractiveRequest =
  | ApprovalInteractionRequest
  | ChoiceInteractionRequest
  | FormInteractionRequest;

export interface InteractiveResponse {
  interactionId: string;
  chatSessionId: string;
  requestType: InteractiveRequestType;
  action: 'approve' | 'reject' | 'submit' | 'skip' | 'expire';
  approvalItemDecisions?: Array<{
    itemId: string;
    approved: boolean;
  }>;
  selectedValues?: string[];
  formValues?: Record<string, unknown>;
}
```

### 5.2 Chat History Representation

There are two viable options:

1. Extend message model with dedicated interaction payload.
2. Persist interaction request state separately and append summary as a normal assistant or tool message.

Recommended V1 approach:

1. Persist pending and resolved interaction request state in session cache and session file metadata.
2. Do not keep a resolved interaction card rendered in the chat timeline after the user responds.

This avoids a large refactor of the core message rendering model in the first phase.

### 5.3 Dynamic Interaction Schema

The existing `approval` / `choice` / `form` renderer primitives are sufficient for most AI-driven follow-up questions.

The missing capability is not arbitrary UI generation. It is a structured way for the model to declare:

1. what information is missing
2. what input controls are needed
3. how the response should be returned to the paused runtime

Recommended direction:

1. Add a built-in tool named `requestInteractiveInput`.
2. The tool returns or triggers a JSON interaction schema, not HTML, JSX, or free-form UI markup.
3. Main process code maps that schema onto the existing `InteractiveRequest` types.
4. The renderer continues to render only controlled Kosmos card components.

This preserves safety, testability, and renderer consistency.

#### 5.3.1 Design Goals

1. Support dynamic AI-driven follow-up questions such as skill parameter collection.
2. Avoid per-skill hardcoded UI implementations.
3. Avoid parsing assistant prose to infer controls.
4. Reuse the existing `pendingInteractiveRequest` lifecycle and response transport.
5. Keep the renderer limited to trusted, typed primitives.

#### 5.3.2 Non-Goals

1. Arbitrary React, HTML, Markdown-form, or script-generated UI.
2. Renderer execution of model-supplied code.
3. Runtime layout engines that allow unconstrained nesting or custom widgets in V1.

#### 5.3.3 Tool Contract

Recommended built-in tool name:

1. `requestInteractiveInput`

Recommended purpose:

1. Allow the model to request user input during a paused turn, with a default preference for structured collection whenever the ask can be expressed as a choice or form.
2. Express the request in JSON that the main process can validate and normalize.
3. Convert the schema into one existing Kosmos interaction request.

Recommended high-level input shape:

```ts
interface RequestInteractiveInputArgs {
  title: string;
  description?: string;
  source?: 'assistant' | 'tool' | 'system';
  submitLabel?: string;
  skipLabel?: string;
  schema: InteractiveInputSchema;
}
```

#### 5.3.4 Schema Shape

Recommended V1 schema:

```ts
type InteractiveInputSchema =
  | ChoiceInteractiveInputSchema
  | FormInteractiveInputSchema;

interface ChoiceInteractiveInputSchema {
  kind: 'choice';
  mode: 'single' | 'multi';
  options: Array<{
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  minSelections?: number;
  maxSelections?: number;
}

interface FormInteractiveInputSchema {
  kind: 'form';
  fields: Array<{
    key: string;
    label: string;
    control:
      | 'text'
      | 'textarea'
      | 'folder'
      | 'file'
      | 'number'
      | 'checkbox'
      | 'select'
      | 'multiselect';
    required?: boolean;
    placeholder?: string;
    description?: string;
    defaultValue?: string | number | boolean | string[];
    options?: Array<{
      value: string;
      label: string;
      description?: string;
      disabled?: boolean;
    }>;
    minSelections?: number;
    maxSelections?: number;
  }>;
}
```

#### 5.3.5 Example

This schema covers the skill-follow-up scenario shown in chat screenshots, where the assistant asks for a target product, platform, and optional focus areas.

```json
{
  "title": "Configure competitive analysis",
  "description": "Please provide the missing inputs before I continue.",
  "source": "assistant",
  "submitLabel": "Continue",
  "skipLabel": "Skip",
  "schema": {
    "kind": "form",
    "fields": [
      {
        "key": "targetProduct",
        "label": "Target Product",
        "control": "text",
        "required": true,
        "placeholder": "Which competitor should we analyze?"
      },
      {
        "key": "platform",
        "label": "Platform",
        "control": "select",
        "required": true,
        "options": [
          { "value": "ios", "label": "iOS" },
          { "value": "android", "label": "Android" },
          { "value": "desktop", "label": "Desktop" }
        ]
      },
      {
        "key": "focusAreas",
        "label": "Focus Areas",
        "control": "textarea",
        "required": false,
        "placeholder": "Specific features or strategic questions"
      }
    ]
  }
}
```

#### 5.3.6 Mapping Rules

The tool should not introduce a fourth top-level renderer primitive in V1.

Recommended mapping:

1. `schema.kind = 'choice'` maps directly to `ChoiceInteractionRequest`.
2. `schema.kind = 'form'` maps to `FormInteractionRequest`.
3. `control = 'text'` maps to `type: 'string'`.
4. `control = 'textarea'` maps to `type: 'string'`, with renderer styling added later if needed.
5. `control = 'folder'` maps to `type: 'string'` and renders a native folder picker.
6. `control = 'file'` maps to `type: 'string'` and renders a native file picker.
7. `control = 'number'` maps to `type: 'double'` unless integer-only constraints are explicitly added.
8. `control = 'checkbox'` maps to `type: 'boolean'`.
9. `control = 'select'` maps to a form field with explicit `options` rendered by the form card.
10. `control = 'multiselect'` maps to a form field with explicit `options` plus selection-count validation.

Recommended normalization rule:

1. If the interaction is only one enumerated question, prefer emitting a `ChoiceInteractionRequest` instead of a `FormInteractionRequest`.
2. Use `FormInteractionRequest` when one card needs mixed controls such as text + select + textarea.

This keeps renderer primitives limited to `choice` and `form`, while still supporting richer form schemas.

#### 5.3.7 Validation Rules

Main process validation must reject malformed schemas before emitting any pending interaction.

Required checks:

1. `title` must be non-empty.
2. `schema.kind` must be one of the allowed schema kinds.
3. `fields[].key` values must be unique within one request.
4. `choice.options` and select-like field `options` must be non-empty when required.
5. `minSelections` must not exceed `maxSelections`.
6. Unsupported control kinds must be rejected or normalized explicitly.
7. The generated request must still respect one pending interaction per session.

Recommended implementation detail:

1. Use `zod` to validate the tool input and normalize defaults before converting to `InteractiveRequest`.

#### 5.3.8 Execution Model

Recommended runtime sequence:

```text
LLM determines it cannot continue without additional user input
  -> checks whether the missing input can be represented as a choice or form
  -> calls requestInteractiveInput tool with JSON schema
  -> tool validates and normalizes schema
  -> AgentChat converts schema to ChoiceInteractionRequest or FormInteractionRequest
  -> requestUserInteraction(...) pauses the turn
  -> renderer displays the controlled card
  -> user submits
  -> AgentChat resumes the paused turn with structured values
```

The important boundary is that the LLM decides the requested data, but it does not decide how arbitrary UI is rendered.

#### 5.3.9 Why Not Generate Arbitrary UI

Do not allow the model to emit raw UI code.

Reasons:

1. It breaks renderer trust boundaries.
2. It creates inconsistent UX and styling.
3. It is much harder to test and persist.
4. It makes validation and response mapping ambiguous.
5. The existing interaction lifecycle already works well with typed requests.

The correct abstraction is dynamic schema generation, not dynamic code generation.

## 6. Runtime Architecture

### 6.1 Main-Process Interaction Manager

Recommended new module:

1. `src/main/lib/chat/interactiveRequestManager.ts`

Responsibilities:

1. Register pending interactive requests.
2. Resolve responses.
3. Expire requests if configured.
4. Scope all pending resolvers by `chatSessionId` and `interactionId`.
5. Prevent multiple concurrent pending requests in one session.

Recommended API:

```ts
class InteractiveRequestManager {
  createPendingRequest(request: InteractiveRequest): Promise<InteractiveResponse>;
  resolveRequest(response: InteractiveResponse): boolean;
  expireRequest(chatSessionId: string, interactionId: string): boolean;
  clearSession(chatSessionId: string): void;
  getPendingRequest(chatSessionId: string): InteractiveRequest | null;
}
```

This replaces use of global maps such as `__pendingBatchApprovalHandlers` and `__pendingInfoInputHandlers`.

### 6.2 AgentChat Integration

Recommended changes in [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts):

1. Add a unified `requestUserInteraction(request)` method.
2. Refactor existing `requestBatchUserApproval()` to build an `ApprovalInteractionRequest` and call the unified path.
3. Refactor existing `requestUserInfoInput()` to build a `FormInteractionRequest` and call the unified path.
4. Introduce `requestUserChoice()` for new single/multi select flows.
5. Emit one request event to the renderer.
6. On resolution, resume the paused runtime path and emit processed state.

### 6.3 Approval Re-enablement

The current runtime temporarily bypasses outside-workspace validation and approval requests in [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts).

Current behavior:

1. Batch tool execution is auto-approved in `batchValidateAndRequestApproval()`.
2. No approval interactive request is emitted for paths outside the workspace.
3. `SecurityValidator` is not gating this runtime path at execution time.

Target behavior when approval is re-enabled later:

1. Real security validation runs.
2. Requests requiring approval are converted into one approval interaction request.
3. User decisions are mapped back to per-tool-call allow or deny decisions.

Re-enabling this path is a future runtime change, not part of the current shipped behavior.

## 7. IPC Design

### 7.1 New Contract

Replace split IPC methods with one set of interaction methods.

Recommended preload and main contract:

1. `onInteractionRequest(callback)`
2. `sendInteractionResponse(response)`
3. `onInteractionProcessed(callback)`

This can be implemented either in raw preload style or as a new typed IPC contract under [src/shared/ipc](../src/shared/ipc).

Recommended direction:

1. Use a typed IPC contract under `src/shared/ipc/interactiveRequest.ts`.

### 7.2 Event Payloads

Renderer event payload:

```ts
InteractiveRequest
```

Response payload:

```ts
InteractiveResponse
```

Processed payload:

```ts
{
  interactionId: string;
  chatSessionId: string;
  status: 'resolved' | 'rejected' | 'skipped' | 'expired';
  summaryText: string;
}
```

### 7.3 No Backward Compatibility

The approval-specific and info-input-specific IPC methods should be deleted after migration. They should not be retained as aliases.

## 8. Renderer Architecture

### 8.1 Session Cache Changes

Current cache stores separate fields:

1. `pendingApprovalRequests`
2. `pendingInfoInputRequest`

Recommended replacement in [src/renderer/lib/chat/agentChatSessionCacheManager.ts](../src/renderer/lib/chat/agentChatSessionCacheManager.ts):

1. `pendingInteractiveRequest?: InteractiveRequest | null`

Hook replacement:

1. `usePendingInteractiveRequest()`

### 8.2 UI Components

Recommended new components:

1. `src/renderer/components/chat/InteractiveRequestCard.tsx`
2. `src/renderer/components/chat/interactive-request/ApprovalRequestView.tsx`
3. `src/renderer/components/chat/interactive-request/ChoiceRequestView.tsx`
4. `src/renderer/components/chat/interactive-request/FormRequestView.tsx`

Current components that should be retired after migration:

1. [src/renderer/components/chat/ApprovalBar.tsx](../src/renderer/components/chat/ApprovalBar.tsx)
2. [src/renderer/components/chat/AskForInfo.tsx](../src/renderer/components/chat/AskForInfo.tsx)

### 8.3 Rendering Placement

Do not continue rendering interaction UI in:

1. composer-level space in [src/renderer/components/chat/ChatInput.tsx](../src/renderer/components/chat/ChatInput.tsx)
2. global overlay in [src/renderer/components/layout/ContentContainer.tsx](../src/renderer/components/layout/ContentContainer.tsx)

Recommended placement:

1. render the pending interaction card in the message timeline through the chat content rendering chain

Practical V1 approach:

1. `ChatView` reads `usePendingInteractiveRequest()`
2. `ChatViewContent` passes it into `ChatContainer`
3. `ChatContainer` renders one pending interaction block near the latest assistant turn

Approval-specific UX in the implemented renderer:

1. Single-item approval requests expose only per-item `Approve` / `Reject` actions.
2. Multi-item approval requests additionally expose `Approve All` / `Reject All` bulk actions.
3. Approval requests do not render a separate `Continue` button.
4. Once every approval item has a decision, the renderer auto-submits the response.

This minimizes unrelated message model changes while making the experience timeline-native.

### 8.4 Composer Behavior

When a request is pending:

1. normal send should be disabled
2. composer shows a waiting hint
3. interaction controls remain active

Recommended addition to chat status:

1. `waiting_for_interaction`

This lets existing chat UI state handling remain explicit instead of using hidden ad hoc flags.

## 9. Request Lifecycle

### 9.1 States

1. `pending`
2. `submitted`
3. `resolved`
4. `rejected`
5. `skipped`
6. `expired`

### 9.2 Lifecycle Sequence

```text
request created
  -> renderer receives pending interaction
  -> user acts
  -> renderer sends InteractiveResponse
  -> main resolves pending interaction
  -> renderer receives processed event
  -> pending state clears
  -> optional summary is persisted outside the active timeline
  -> paused run resumes or exits based on action
```

### 9.3 Resume Semantics by Type

1. Approval:
   map item decisions to per-tool approval results; continue tool execution pipeline.
2. Choice:
   pass selected values back to requesting logic; continue the paused turn.
3. Form:
   pass structured form values or `null` on skip; continue requesting logic.

## 10. Persistence Strategy

### 10.1 Session Cache

Pending interaction must live in the in-memory session cache for immediate UI updates.

### 10.2 Session File

Recommended persisted data:

1. optional interaction metadata for diagnostics or audit
2. any persisted summary must not be replayed as a duplicate resolved card in the active chat timeline

Pending interaction persistence across full app restart is optional for V1 if the runtime cannot safely resume after restart. If omitted, the product must explicitly clear stale pending state on restored sessions.

Recommended V1 rule:

1. Do not promise crash-safe resume of pending interactions.
2. On session restore, if a request was pending before shutdown, mark it expired and append a summary.

## 11. Migration Plan

### 11.1 Phase 1: Shared Contract and Main Runtime

1. Add shared types.
2. Add typed IPC contract.
3. Add main interaction manager.
4. Refactor `AgentChat` to use unified request path.

### 11.2 Phase 2: Renderer State Consolidation

1. Replace split pending cache fields with unified pending interaction state.
2. Replace split hooks with `usePendingInteractiveRequest()`.
3. Update session cache tests.

### 11.3 Phase 3: Timeline Renderer

1. Add interactive request card components.
2. Render in chat timeline.
3. Lock composer while pending.
4. Remove old composer bar and overlay usage.

### 11.4 Phase 4: Delete Old Paths

Delete:

1. old approval-specific IPC and renderer path
2. old info-input-specific IPC and renderer path
3. old detached UI components if no longer reused internally

Deletion is allowed only after parity and regression tests pass.

## 12. Regression Prevention Strategy

This migration must be guarded by parity-first verification.

### 12.1 Parity Checklist

Before deleting old code, verify:

1. batch approval still supports multiple items
2. approval still maps back to per-tool decisions
3. form fields still support defaults and validation
4. skip still works for form requests
5. session switching still isolates pending interaction correctly
6. processed interaction still clears pending state correctly
7. runtime still blocks until response arrives

### 12.2 Automated Test Requirements

#### Main Process

Add or update tests for:

1. approval request creation and resolution
2. form request creation and resolution
3. choice request creation and resolution
4. rejection and skip paths
5. expiry path if supported
6. session isolation of pending request manager

#### Renderer Cache

Add or update tests for:

1. caching pending interaction for current versus non-current session
2. clearing pending interaction on processed event
3. switching sessions with pending interaction

#### UI Tests

Add or update tests for:

1. approval card rendering and actions
2. single-item approval auto-submit without bulk actions
3. multi-item approval bulk actions and auto-submit
2. choice card rendering and validation
3. form card rendering, default values, validation, and skip
4. composer lock state while pending

### 12.3 Manual Test Matrix

Required manual verification:

1. tool approval request in active session
2. tool approval request in inactive session then switch back
3. form request submit
4. form request skip
5. choice single select
6. choice multi select
7. approval reject path
8. app navigation within same session while request pending

### 12.4 Smoke Test Checklist

Use this checklist for a manual acceptance pass after `npm run build` succeeds.

#### Approval Flow

1. Start a chat session that triggers a tool call requiring workspace-external access.
2. Confirm one pending `approval` card appears inline in the chat timeline instead of above the composer.
3. Confirm a single-item approval request does not show `Approve All` / `Reject All`.
4. Confirm the card shows all requested tools and paths in one interaction.
5. Approve the item and verify the run resumes automatically without a separate `Continue` click.
6. Trigger a multi-item approval request and confirm `Approve All` / `Reject All` are shown.
7. Approve part of the batch and reject the rest.
8. Verify the run resumes automatically without sending another user message.
9. Verify the approval card is dismissed after the response is processed.

#### Approval Session Isolation

1. Trigger an approval request in session A.
2. Switch to session B before responding.
3. Verify session B does not render session A's pending interaction.
4. Switch back to session A.
5. Verify the same pending approval card is still present and actionable.

#### Form Flow

1. Trigger an assistant flow that needs user input and can be represented as a structured form.
2. Verify the pending `form` card renders inline in the timeline.
3. Submit with a required field empty and confirm validation blocks submission.
4. Fill valid values and submit.
5. Verify the run resumes automatically.
6. Verify the form card is dismissed after submission succeeds.

#### Form Skip Flow

1. Trigger the same form request again.
2. Choose `Skip`.
3. Verify the runtime receives a skip result and continues the turn deterministically.
4. Verify the skipped form card is dismissed and does not remain in the timeline.

#### Choice Flow

1. Trigger a single-select choice request.
2. Verify `Continue` stays disabled until one option is selected.
3. Submit one option and verify automatic resume.
4. Trigger a multi-select choice request.
5. Select multiple options and submit.
6. Verify the choice card is dismissed immediately after submission.

#### Composer Locking

1. While any interactive request is pending, verify normal freeform send is blocked by the waiting state.
2. Verify only the interactive card remains actionable for progressing the turn.

#### Refresh / Reopen Behavior

1. With no pending interaction, reopen the same session and confirm old resolved cards do not reappear in the timeline.
2. If pending-interaction restore behavior is exercised, verify stale pending state does not reappear as an actionable old card.

## 13. Logging and Diagnostics

Recommended log fields:

1. `interactionId`
2. `chatId`
3. `chatSessionId`
4. `requestType`
5. `status`
6. `source`
7. `action`
8. `resumeOutcome`

This should make it easy to trace request creation, user response, pending cleanup, and runtime resume.

## 14. Risks and Mitigations

### 14.1 Risk: Regression While Removing Old Paths

Mitigation:

1. parity checklist is explicit
2. old paths are deleted only after automated coverage is in place
3. migration is sequenced by runtime, state, UI, then deletion

### 14.2 Risk: Timeline Rendering Requires Large Message Refactor

Mitigation:

1. V1 uses a timeline-adjacent interaction card inserted by chat container
2. resolved summary is stored as a normal message
3. deeper message-type unification can happen later without blocking the migration

### 14.3 Risk: Runtime Leaks Pending Requests

Mitigation:

1. session-scoped manager owns cleanup
2. explicit processed event clears renderer state
3. session destroy flow clears pending resolver

### 14.4 Risk: Restart During Pending Interaction

Mitigation:

1. do not promise resume across restart in V1
2. expire stale pending request on restore
3. append visible summary so the user understands why the run stopped

## 15. Open Questions

1. Should the pending interaction card be inserted as a synthetic message row or as a dedicated timeline adjunct block?
2. Should choice request support freeform "Other" in V1?
3. Should approval expiry remain visible to the user or be treated as a simple reject path?

## 16. Definition of Done

Implementation is done only when:

1. approval and info input both run through the unified interaction contract
2. choice request is supported
3. old detached UI surfaces are removed from the shipped path
4. runtime no longer uses global pending handler maps
5. approval validation path is no longer short-circuited
6. automated parity tests pass
7. manual test matrix passes