# PRD: Scheduled Chat Non-Interactive Guard

## Background

Scheduled chat sessions run as unattended background jobs. They do not have a visible user present to answer follow-up questions or respond to interactive UI cards.

Today, the chat runtime already blocks interactive UI in remote IM sessions, but scheduled-silent runs still execute inside the general tool and interaction pipeline. This creates two problems:

1. Background runs can still attempt `request_interactive_input` or other user-blocking interaction flows.
2. The runtime may silently skip those interactions instead of surfacing a clear unattended-execution failure.

The result is unreliable scheduled execution, confusing logs, and low-quality outputs when the agent requires missing input that only a user can provide.

## Goal

Ensure scheduled chat sessions fail fast and explicitly whenever the run requires user interaction.

## Product Requirements

### 1. Scheduled sessions are non-interactive by definition

When a chat session is started by the scheduler as `scheduled-silent`:

- The runtime must not allow interactive UI flows.
- The runtime must not wait for user input.
- The runtime must not continue silently after an interaction requirement is detected.

### 2. Prompt-level guidance must discourage unsupported behavior

For scheduled background runs, the model must be explicitly instructed that:

- `request_interactive_input` is unavailable.
- Plain-text follow-up questions are also not allowed because no user is present.
- If required input is missing, the run should stop and report what needs to be preconfigured.

### 3. Runtime-level enforcement must be authoritative

If any interactive request path is triggered during a scheduled run, the runtime must:

- Record a structured blocked-interaction error.
- Mark the scheduled run as failed.
- Persist a clear failure reason to the scheduled chat session metadata.

### 4. Coverage must include all existing interactive request entry points

The guard must cover:

- `request_interactive_input`
- unified `choice` / `form` request flow
- direct `requestUserInfoInput` flows used by tool post-processing

### 5. Existing remote IM behavior must remain unchanged

Remote IM sessions must continue using the current plain-text-only behavior instead of the new scheduled failure behavior.

## Non-Goals

- Re-enable workspace approval gating
- Add new scheduler UI
- Introduce end-user retry UX for blocked scheduled runs
- Change the semantics of ordinary foreground chat sessions

## Success Criteria

- Scheduled runs no longer block on hidden interaction requests.
- Scheduled runs fail with an explicit unattended-interaction error when input is missing.
- Remote IM sessions still skip interactive UI and continue using plain text.
- Regression tests cover scheduled failure and remote-session compatibility.