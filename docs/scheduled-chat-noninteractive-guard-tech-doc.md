# Tech Doc: Scheduled Chat Non-Interactive Guard

## Scope

This change introduces a unified interaction policy for chat runtimes and applies a hard `forbid` policy to scheduled-silent executions.

## Design Summary

### Interaction policy model

Add a runtime-level policy enum in the chat engine:

- `allow-ui`: normal foreground chat behavior
- `plain-text-only`: UI interactions are unavailable, but the assistant may ask in plain text
- `forbid`: no interactive UI and no user follow-up; execution must fail if interaction is required

Current mapping:

- foreground interactive chat → `allow-ui`
- remote IM session → `plain-text-only`
- scheduled-silent run → `forbid`

### Blocked interaction error

Add a dedicated error type for forbidden interaction attempts:

- `NonInteractiveRuntimeInteractionError`
- code: `NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED`

The error includes structured details:

- active policy
- request type
- optional request title
- human-readable message

## Implementation Plan

### 1. Runtime state in AgentChat

File: `src/main/lib/chat/agentChat.ts`

- Store the active `interactionPolicy` on the session runtime.
- Reset policy to `allow-ui` after each foreground turn.
- Store the latest blocked interaction details for diagnostics.
- Pass the policy into prompt, interaction, and tool-post-processing services.

### 2. Prompt-level guidance

File: `src/main/lib/chat/agentChatPromptService.ts`

- Preserve the existing remote IM prompt warning for `plain-text-only`.
- Add a new scheduled background warning for `forbid`.
- Explicitly tell the model not to use interactive UI or plain-text follow-up questions in scheduled background runs.

### 3. Central enforcement in interaction service

File: `src/main/lib/chat/agentChatInteractionService.ts`

- Before any interactive request is created, validate the active interaction policy.
- Under `forbid`, record the blocked interaction and throw `NonInteractiveRuntimeInteractionError`.
- Apply the same enforcement to direct `requestUserInfoInput(...)` flows.

### 4. Scheduled failure propagation

File: `src/main/lib/chat/agentChatTurnRunner.ts`

- Detect `NonInteractiveRuntimeInteractionError` separately from generic tool failures.
- Persist the tool failure result for chat history continuity.
- Re-throw the error so scheduled execution fails fast instead of continuing.

### 5. Scheduler hookup

File: `src/main/lib/chat/agentChatManagerScheduledRunner.ts`

- Set `interactionPolicy` to `forbid` before executing the scheduled turn.
- Call `streamMessage(...)` with `interactionPolicy: 'forbid'`.

## Testing Plan

### Unit tests

- `agentChatInteractionService.test.ts`
  - `forbid` policy throws `NonInteractiveRuntimeInteractionError`
  - blocked interaction details are reported to the runtime

- `agentChatToolPostProcessor.test.ts`
  - remote IM still skips `request_interactive_input`

- `agentChatManagerScheduledRunner.test.ts`
  - scheduled runner sets `interactionPolicy: 'forbid'`
  - blocked interaction failures mark the run as failed and notify unread completion

- `agentChat.streamMessage.test.ts`
  - remote session still resets to default policy after the turn
  - explicit interaction policy is also reset after the turn

## Risks and Mitigations

### Risk: Throwing from interaction paths could break tool-result pairing

Mitigation:

- The turn runner still persists a tool failure message before re-throwing.
- Only `NonInteractiveRuntimeInteractionError` gets the fail-fast behavior.
- Existing structured tool errors remain unchanged.

### Risk: Future interactive entry points bypass the guard

Mitigation:

- Enforce in the central interaction service instead of only in individual tools.
- Keep scheduled prompt guidance aligned with runtime enforcement.