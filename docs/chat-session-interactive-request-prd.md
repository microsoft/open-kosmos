# Chat Session Interactive Request PRD

## 1. Background

Kosmos chat sessions already support two limited forms of user interaction during an agent run:

1. Tool approval requests for security-sensitive operations.
2. Info collection requests for selected setup flows.

These capabilities prove that the runtime can pause and wait for user input, but the product experience is fragmented:

1. Approval was rendered near the composer before migration.
2. Info collection is rendered as a page-level overlay.
3. Assistant questions, pending state, and user responses are not modeled as one unified chat interaction system.

The result is inconsistent UX, duplicated protocol logic, and higher regression risk whenever a new interactive flow is introduced.

This PRD defines a single Chat Session interaction model that supports:

1. Choice requests: single select and multi select.
2. Approval requests.
3. Form requests.

The design explicitly does not require backward compatibility with the current split implementation. It does require full capability parity for existing approval and info collection flows after migration.

## 2. Problem Statement

Kosmos lacks a unified product model for assistant-driven interaction during a chat turn.

Current issues:

1. The same concept, "the assistant needs user input to continue", appears in different UI surfaces.
2. Existing flows are implemented as separate protocols instead of one interaction contract.
3. Pending interaction state is not represented as a first-class chat experience.
4. The product cannot add new request types cleanly without repeating transport, cache, UI, and lifecycle logic.
5. Regression risk is high because approval and form collection are maintained separately.

## 3. Product Decision

Kosmos will introduce a unified Chat Session Interactive Request model.

Product rules:

1. Any runtime pause that needs user input is represented as an interactive request.
2. Interactive requests are rendered in the chat timeline, not as detached UI surfaces.
3. Assistant intent and interaction UI are shown together as one coherent chat experience.
4. A chat session can have at most one pending interactive request at a time.
5. User response resumes the paused turn automatically.
6. Existing approval and info collection capabilities must migrate onto the new model with no product regression.
7. No backward compatibility layer is required once migration is complete.

## 4. Scope

### 4.1 In Scope

1. Define a unified interaction request model for approval, choice, and form.
2. Replace current approval-specific and info-input-specific runtime protocols.
3. Move interaction rendering into the message timeline.
4. Persist interaction state and interaction response summaries at chat-session scope.
5. Add request lifecycle states and resume semantics.
6. Migrate all existing approval and info collection entry points.
7. Define regression gates to guarantee parity after migration.

### 4.2 Out of Scope

1. Supporting multiple simultaneous pending requests in one session.
2. Preserving the old approval bar and overlay UI after migration.
3. General-purpose backward compatibility for old IPC contracts.
4. Redesigning unrelated chat rendering systems.
5. Building a public SDK contract for third-party MCP servers in the same phase.

## 5. Goals

### 5.1 Product Goals

1. Make all user-input pauses feel native to the chat session.
2. Reduce implementation duplication across approval, choice, and form flows.
3. Make interaction behavior deterministic and easy to reason about.
4. Ensure migration does not regress existing approval or info collection use cases.

### 5.2 User Goals

1. "When the assistant needs my input, I should see a clear question in the chat."
2. "When I answer, the task should continue automatically."
3. "I should be able to understand what is waiting for me and why."
4. "My response should be reflected immediately in the run outcome without extra clicks or extra messages."

### 5.3 Non-Goals

1. Maintaining old detached interaction surfaces.
2. Supporting interaction requests from arbitrary external protocols before the unified model is complete.
3. Solving every possible multi-step wizard scenario in V1.

## 6. User Stories

1. As a user, when a tool needs approval, I want the assistant to explain the risk and let me approve or reject in the chat.
2. As a user, when the assistant needs me to choose one or more options, I want the choices presented inline in the current session.
3. As a user, when the assistant needs structured information, I want to fill a form and continue the same run.
4. As a user, after I respond, I want the paused run to continue without sending another message.
5. As a developer, I want one interaction framework so new request types can reuse the same lifecycle and test coverage.

## 7. Experience Principles

### 7.1 Timeline Native

Interactive requests must appear as part of the message flow.

Each request contains:

1. Assistant question or explanation.
2. A structured interaction card.
3. The active pending state for the current pause.

### 7.2 Clear Pause Semantics

When a request is pending:

1. The current run is paused.
2. The composer is visually locked for normal sending.
3. The user is told the run is waiting for input.

### 7.3 Automatic Resume

After submit, approve, reject, or skip:

1. The response is sent to the runtime.
2. The paused turn resumes automatically.
3. The user does not need to send an extra message.

### 7.4 Dismiss After Completion

Interactive requests are visible only while the runtime is waiting for input.

After submit, approve, reject, or skip:

1. The pending card is dismissed from the chat UI.
2. The user should not see stale resolved cards repeated in the timeline.
3. Optional internal summaries may still be stored for diagnostics or audit.

### 7.5 Single Pending Request

One session has at most one pending interactive request at a time.

Batch approval remains allowed, but it is represented as one interaction request containing multiple approval items.

## 8. Request Types

### 8.1 Approval

Used when the system requires explicit consent to continue.

Required behaviors:

1. Show risk context and affected targets.
2. Support approve and reject.
3. Support optional expiry handling.
4. Preserve existing batch-approval capability.
5. Auto-submit once every approval item has a decision.
6. Show `Approve All` / `Reject All` only when the request contains more than one approval item.

### 8.2 Choice

Used when the assistant needs the user to choose from enumerated options.

Supported modes:

1. Single select.
2. Multi select.

Required behaviors:

1. Show option labels and optional descriptions.
2. Validate required selection count before continue.
3. Return structured selected values to the runtime.

### 8.3 Form

Used when the assistant needs structured user input.

Required behaviors:

1. Support text, numeric, boolean, and domain-specific field subtypes.
2. Support validation and default values.
3. Support continue and optional skip.
4. Preserve current info collection use cases.

## 9. Functional Requirements

### 9.1 Must Have

1. A unified interaction request model.
2. Timeline rendering for all interaction types.
3. Session-scoped pending interaction state.
4. Automatic runtime resume after user response.
5. Processed interactive requests are dismissed from the timeline immediately after completion.
6. Full migration of current approval flows.
7. Full migration of current info collection flows.
8. New choice request support.
9. At-most-one pending interaction per session.

### 9.2 Should Have

1. Expiry handling for approval requests.
2. Generic request metadata for analytics and debugging.
3. Logs that make pending and resolved interaction state easy to trace.

### 9.3 Won't Have in V1

1. Parallel pending interactions in one session.
2. Backward compatibility with old split interaction APIs.
3. Direct third-party external protocol support beyond the Kosmos runtime migration path.

## 10. Migration Requirements

This migration intentionally removes the old split implementation instead of preserving it.

However, removing old code does not permit regressions. The new system must preserve all current product capabilities that users rely on today.

### 10.1 Existing Capability Parity Matrix

The migrated system must preserve:

1. Batch approval of multiple tool requests.
2. Session isolation for pending approval state.
3. Session isolation for pending info input state.
4. Automatic cleanup after response processed.
5. Form field validation and default values.
6. Skip path for info collection flows.
7. Current ability for runtime to block and wait for user input.

### 10.2 Migration Rule

The old approval-specific and info-input-specific paths can be deleted only after the unified interaction path satisfies the parity matrix and passes defined regression tests.

## 11. Regression Prevention Requirements

The project must treat this migration as a capability consolidation, not a greenfield rewrite.

### 11.1 No Regression Definition

Regression means any loss or behavior break in currently supported approval or info collection functionality, including:

1. Requests no longer appearing in the current session.
2. Responses not resuming the paused turn.
3. Session switching causing the wrong request to render.
4. Existing form validation becoming weaker.
5. Batch approval items not being individually actionable.
6. Processed requests not being removed correctly.

### 11.2 Required Safeguards

1. Parity checklist must be explicit in implementation.
2. Existing behaviors must be covered by automated tests before deleting old code paths.
3. New interaction rendering must be verified across session switching and app refresh scenarios where applicable.
4. Approval expiry behavior must remain deterministic if kept.

## 12. Success Criteria

1. Approval, choice, and form requests all render through one session interaction model.
2. Existing approval flows retain full behavior after migration.
3. Existing info collection flows retain full behavior after migration.
4. User response resumes the paused run automatically.
5. Pending interaction state is visible while waiting, and processed interaction cards are dismissed after completion.
6. The old detached UI surfaces are fully removed.

## 13. Acceptance Criteria

The feature is accepted only if all of the following are true:

1. A tool approval request appears inline in the current chat session and can be approved or rejected.
2. A form request appears inline in the current chat session and can be submitted or skipped.
3. A new choice request supports both single and multi select.
4. Session switching preserves correct pending interaction visibility.
5. On response, the runtime resumes automatically with the returned structured payload.
6. Existing approval and form scenarios pass parity tests.
7. No old approval bar or global info overlay remains in the shipped path.

## 14. Rollout Notes

This should ship as a unified replacement, not a permanent dual-stack solution.

Recommended rollout sequence:

1. Land the unified data model and runtime contract.
2. Land timeline-native renderer and session-state migration.
3. Add parity tests for migrated approval and form flows.
4. Delete old split flows.

## 15. Open Questions

1. Should resolved interaction summaries be represented as assistant messages, tool messages, or a dedicated interaction-result message type?
2. Should approval expiry remain product-visible in V1 or become runtime-only behavior?
3. When an interaction is pending, should user freeform message send be fully disabled or converted into a cancel-and-restart flow?