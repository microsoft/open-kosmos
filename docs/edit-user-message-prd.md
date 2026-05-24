# Edit User Message PRD

## 1. Background

Kosmos already supports sending a new message and retrying a failed response, but it was missing a clean way to correct an already-sent user prompt in place. The product now needs an edit-and-regenerate workflow that remains linear, supports attachment edits, and respects Kosmos's context-compression model.

The critical architectural fact is that `chat_history` is durable session history, while `context_history` is the currently reconstructable working context. Older user turns may remain in `chat_history` but disappear from `context_history` after compression.

## 2. Problem Statement

Without direct editing, users have to send follow-up corrections such as "ignore the previous prompt" or "use this file instead". That makes the conversation noisy, preserves incorrect prompts in the model context, and makes attachment mistakes awkward to recover from.

At the same time, Kosmos cannot safely allow unconditional historical editing because an older prompt may no longer exist in the active context needed for deterministic regeneration.

## 3. Product Decision

Kosmos will show an inline `Edit` action on all user messages in writable local sessions.

Whether a specific message can actually be edited is decided at click time by a backend precheck:

1. the target user message must still exist in `chat_history`
2. the same message must still exist in `context_history`

If the precheck passes, the message enters inline edit mode. If it fails, Kosmos refuses before entering edit mode and explains that the original editable content has already been compressed out of the active context.

## 4. Scope

### 4.1 In Scope

1. Show `Edit` on all user messages in eligible sessions.
2. Inline editing in place.
3. Both text and attachments are editable.
4. Click-time precheck before entering edit mode.
5. Saving replaces the selected user message, removes all downstream assistant/tool output, and regenerates from the updated message.
6. Warn when downstream tool activity may have already caused external side effects.

### 4.2 Out of Scope

1. Editing assistant messages.
2. Editing tool messages.
3. Editing system messages.
4. Editing read-only remote sessions.
5. Automatic rollback of previously executed external effects.
6. Attachment reordering or per-attachment metadata editing.

## 5. Goals

### 5.1 Product Goals

1. Let users correct prompts without adding cleanup turns.
2. Preserve a single linear branch after correction.
3. Support fixing both text and attachment mistakes.
4. Preserve session integrity under context compression.

### 5.2 User Goals

1. "I want to fix this earlier prompt directly."
2. "I want to add, remove, or replace attachments before regenerating."
3. "I want the old downstream branch replaced, not kept alongside the corrected one."

### 5.3 Non-Goals

1. Historical diff view.
2. Undo or redo for edited prompts.
3. Automatic reversal of file writes, shell commands, network calls, or sent messages.

## 6. Key Constraint

A user message is editable only if it still exists in the active `context_history`.

### 6.1 Why This Constraint Exists

1. `chat_history` alone is not enough to safely regenerate from an old turn.
2. Compression may remove the original turn boundary from `context_history`.
3. Regeneration must start from a trustworthy active context snapshot.

### 6.2 Product Rule

The renderer may show `Edit` broadly, but the backend is the source of truth. A click is allowed only when all of the following are true:

1. the target message is `role === 'user'`
2. the session is writable
3. the session is not in a transient unsafe state such as streaming or replaying
4. the message still exists in both `chat_history` and `context_history`

## 7. User Stories

1. As a user, I want to edit a prior prompt that is still in active context so I can correct it directly.
2. As a user, I want to edit attachments together with the prompt text.
3. As a user, I want Kosmos to reject the action immediately if the prompt is no longer safely editable.
4. As a user, I want downstream responses after the edited prompt to be replaced by regenerated output.

## 8. Experience Summary

### 8.1 Default State

All user messages show an `Edit` action when the session is locally editable and idle.

### 8.2 Enter Edit Mode

When the user clicks `Edit`:

1. Kosmos sends a precheck request to the backend.
2. If the message is still editable, the user bubble enters inline edit mode.
3. Existing text and attachments are preloaded.
4. Downstream content is visually de-emphasized.
5. Save and cancel icon actions replace the normal message action row.

### 8.3 Precheck Failure

If the message has already been compressed out of `context_history`, Kosmos does not enter edit mode. Instead it shows an error explaining that the original editable content is no longer visible in the active context, so the message can no longer be edited.

### 8.4 Save Behavior

On save:

1. validate that the edited message is not empty
2. replace the selected user message
3. truncate all later messages from `chat_history`
4. truncate the corresponding branch in `context_history`
5. persist the updated session
6. regenerate from the edited point

### 8.5 Cancel Behavior

On cancel:

1. discard local draft changes
2. restore the original rendered message
3. leave downstream content unchanged

## 9. UX Requirements

### 9.1 Inline Editing Model

Editing happens in place inside the original user bubble rather than in a modal or in the bottom composer.

### 9.2 Editable Content

The inline editor must support:

1. text edits
2. retaining existing attachments
3. removing existing attachments
4. adding new attachments

### 9.3 Warning for External Side Effects

If later messages contain potentially mutating tool activity, Kosmos should warn:

`Regenerating will not undo external actions that were already executed.`

This is informational and does not block saving.

### 9.4 Availability Rules

Edit must be unavailable when:

1. the session is streaming
2. the session is replaying
3. the session is read-only
4. another inline edit is already active

## 10. Functional Requirements

### 10.1 Must Have

1. Show `Edit` on all eligible user messages.
2. Run a backend precheck before entering edit mode.
3. Refuse immediately when the target prompt is no longer in active context.
4. Support text and attachment editing.
5. Replace the selected user message on save.
6. Remove all later assistant and tool output after that message.
7. Regenerate from the updated message.
8. Preserve the original message when canceling.

### 10.2 Should Have

1. Side-effect warning when applicable.
2. Inline validation for empty drafts.
3. Attachment previews consistent with the normal composer.

### 10.3 Won't Have in MVP

1. Assistant or tool message editing.
2. Attachment ordering controls.
3. Historical visual diff.
4. Rollback of previously executed side effects.

## 11. Data Model Requirements

### 11.1 Message Model

The feature continues to use the existing multipart `Message` model. The edited payload is a full replacement message, not a text patch.

### 11.2 Attachment Semantics

Edit mode merges:

1. retained existing attachment content parts
2. newly added attachment content parts

### 11.3 Retained Attachment Validation

Before save, retained references should still be structurally valid and allowed by existing workspace and security rules.

## 12. Technical Strategy

### 12.1 High-Level Flow

This feature is not just `retry`. It is a mutation flow:

1. validate editability of the selected user message
2. replace that message and truncate all downstream content
3. regenerate from the updated session state

### 12.2 Renderer Strategy

The renderer keeps explicit inline editing state for the selected message and hides the bottom composer while inline editing is active.

### 12.3 Composer Reuse Strategy

The inline editor reuses the existing chat composer attachment pipeline by loading draft state from an existing `Message` and then building a new replacement `Message` for save.

### 12.4 Main Process API

Expose dedicated APIs:

```ts
canEditUserMessage(
  chatSessionId: string,
  messageId: string,
): Promise<{ success: boolean; data?: { canEdit: boolean; error?: string }; error?: string }>

editUserMessage(
  chatSessionId: string,
  messageId: string,
  updatedMessage: Message,
): Promise<{ success: boolean; data?: Message[]; error?: string }>
```

### 12.5 Main Process Validation Logic

Validation must:

1. find the target user message in `chat_history`
2. verify the same message still exists in `context_history`
3. return a compression-specific refusal message if the active context copy is missing

### 12.6 Main Process Mutation Logic

Mutation must:

1. replace the target user message in `chat_history`
2. truncate all later messages in `chat_history`
3. replace the target user message in `context_history`
4. truncate all later messages in `context_history`
5. persist the session
6. restart generation without appending a second user turn

### 12.7 Source of Truth

The backend owns editability, truncation, persistence, and regeneration. The renderer may show optimistic UI state, but the backend remains authoritative.

## 13. Edge Cases

1. If there is no downstream output yet, editing still works and simply regenerates from the updated turn.
2. If the first user message is edited, the session title should be reset to `New Chat`.
3. If the target message has been compressed out of active context, edit must be rejected before entering edit mode.
4. If downstream tools already caused external side effects, Kosmos warns but does not roll them back.

## 14. Success Metrics

1. Lower rate of follow-up correction prompts.
2. High success rate for edit-and-regenerate.
3. No duplicate user-turn insertion after save.
4. No stale downstream branch left behind after edit.
5. Clear refusal path for compressed-away turns.

## 15. Final Recommendation

Implement `Edit user message` as an in-place workflow available on all user messages, with backend precheck guarding safety. The product should prefer broad affordance in the UI, strict validation in the backend, and deterministic truncation plus regeneration from the selected editable turn.
