# Computer Use PRD

> Version: 1.0.0 | Date: 2026-06-19

## 1. Background

OpenKosmos agents can already read files, run commands, drive an in-app embedded browser, and
call MCP tools. They cannot operate the native applications a user actually works in -- Office,
mail clients, design tools, internal desktop apps, or any GUI that exposes no API, MCP server,
or web surface.

Industry assistants now ship this capability. Anthropic's Claude Computer Use (API beta) and
OpenAI's Computer Use (`computer` tool / former Operator, now folded into the ChatGPT agent and
the unified Codex desktop app) both let a model see the screen and drive mouse/keyboard. The
reference screenshots from the Codex desktop app show the exact shape of the consumer feature:
two macOS permissions -- **Accessibility** ("access app interfaces") and **Screenshots**
("know where to click") -- plus a control panel with an **Any App** master switch and an
**Always-allowed apps** whitelist.

This PRD defines the equivalent capability for OpenKosmos: an opt-in feature that lets an agent
control the real local desktop, gated and supervised, so users can delegate tasks that span
arbitrary native apps.

## 2. Problem Statement

OpenKosmos needs a way for an agent to complete tasks in native desktop applications that have no
programmable interface, while keeping the user in control and the blast radius bounded.

The feature must:

1. let an agent perceive the real screen (screenshots) and the foreground app's UI;
2. let an agent perform real mouse and keyboard input against any application;
3. operate on the user's real machine (not a blank sandbox), because the goal is the user's own
   apps, data, and logged-in sessions -- a sandbox cannot reach them;
4. stay off by default, require explicit OS permissions, and keep the user in the loop for
   consequential actions;
5. remain isolated from prompt-injection content that appears on screen.

### 2.1 Why not a sandbox

A blank sandbox/VM has none of the user's apps, files, or login state, so it cannot accomplish
"operate my apps." A persistent personal VM gets closer but is out of scope here. The product
goal -- control the apps already on the user's machine -- inherently requires real-machine control.
Safety is therefore delivered by **authorization layering, default confirmation, and isolation**,
not by isolation of the execution environment. This mirrors the Codex desktop app, which runs on
the real machine behind Accessibility + Screenshots permissions and an Any-App / always-allowed
control model.

## 3. Product Decision

OpenKosmos will add an opt-in **Computer Use** feature: a profile-level master switch plus an
agent-facing built-in `computer_use` tool that captures the screen and dispatches synthetic
mouse/keyboard input to native applications on the user's machine.

When enabled (and OS permissions granted), the feature provides:

1. a Settings -> Computer Use control surface with an **Any App** master switch, OS-permission
   status/prompts, and an **Always-allowed apps** whitelist;
2. an agent-facing `computer_use` built-in tool exposing screenshot perception and a bounded set
   of input actions;
3. default human confirmation before each high-impact or non-whitelisted action, reusing the
   existing in-chat interactive-request (approval/choice) surface;
4. an action/audit trail of what the agent did.

When disabled, the Settings entry shows the off state, the built-in tool is absent from the
advertised inventory, and any direct invocation returns a disabled-settings error.

Browser automation is explicitly **not** part of this feature; it is already delivered by the
embedded browser (`browser` tool). Computer Use targets native, non-browser applications.

## 4. Goals

### 4.1 Product Goals

1. Let agents complete tasks in arbitrary native desktop apps that expose no API.
2. Keep the user in control: explicit opt-in, OS-level permission gates, default confirmation,
   and a visible action trail.
3. Provide a provider-agnostic perception/action loop that works with the app's existing vision
   capable models rather than a single vendor's proprietary computer-use endpoint.
4. Keep the feature secure-by-default: off switch, permission gates, per-app whitelist, and
   prompt-injection isolation.
5. Reuse existing OpenKosmos infrastructure (screenshot capture, built-in tool gating, interactive
   approval, cancellation) instead of building parallel systems.

### 4.2 User Goals

1. As a user, I can enable or disable Computer Use from Settings -> Computer Use.
2. As a user, I am told exactly which OS permissions are required and can jump to grant them.
3. As a user, I can let the agent act on any app, or restrict it to an explicit allowlist.
4. As a user, I am asked to confirm before the agent does something consequential.
5. As a user, I can watch/inspect what the agent did and stop it at any time.
6. As a user, disabling the feature immediately removes the agent tool.

## 5. Non-Goals

1. Browser automation (owned by the embedded browser `browser` tool).
2. Running the agent in an isolated sandbox/VM desktop (a different safety model; may be a future
   option but is not this feature).
3. Shipping or fine-tuning a bespoke GUI-grounding model; the feature uses the app's configured
   vision-capable models through normal tool calling.
4. Mobile/Android control.
5. Unattended, fully autonomous operation of irreversible actions with no confirmation path.
6. Recording or exfiltrating screen content beyond what a single action step requires.

## 6. Scope

### 6.1 In Scope

1. Profile-level `computerUse` settings in `profile.json` (master switch + control layering),
   defaulting to disabled, mirroring the `browser`/`memex` switch pattern.
2. A Settings -> Computer Use surface: master switch, OS permission status + prompts, and an
   always-allowed apps whitelist.
3. A main-process `ComputerUseManager` owning permission checks, screen capture, coordinate
   mapping, app/window enumeration + focus, and synthetic input dispatch.
4. An agent-facing `computer_use` built-in tool with a bounded action set, gated by the same
   setting at both advertise and execute time.
5. Vision-injected screenshot results (same payload shape the embedded browser already uses).
6. Default confirmation for high-impact / non-whitelisted actions via the existing interactive
   request model, plus cancellation via the chat `AbortSignal`.
7. macOS Accessibility + Screen Recording permission handling; Windows support without those
   specific prompts, except Windows ARM64 where the current native input driver is unavailable and
   the feature must be hidden/blocked.
8. A native synthetic-input dependency (OS-wide mouse/keyboard), packaged correctly for Electron.
9. Documentation, an `ai.prompt.md` for the new module, and tests.

### 6.2 Out of Scope

1. Web-page automation, OAuth/SSO flows, and protocol-handler links.
2. Sandboxed/VM desktop execution.
3. Cross-device or remote-machine control.
4. Persisting screen recordings or building a macro recorder.
5. Linux as a first-class target in v1 (best-effort only).

## 7. Functional Requirements

### 7.1 Must Have

1. The Computer Use setting must default to disabled and persist in `profile.json`.
2. When disabled, running on an unsupported platform, invoked from a scheduled/non-interactive run (including background sub-agent
   auto-wake parent turns), or called without an active local main-agent execution context, the
   `computer_use` tool must be absent or direct execution must return a recoverable
   disabled/unsupported/unavailable error.
3. When enabled but the required OS permission is missing, the tool must return a structured
   permission-required error (not throw), and the Settings surface must show how to grant it.
4. The tool must support, at minimum: capture screenshot, enumerate displays/windows, focus a
   window, move mouse, click / double-click / right-click, drag, scroll, type text, press key,
   and key-combo (hotkey), plus wait.
5. Screenshot results must be returned as a vision-compatible image payload so the model sees the
   screen; raw base64 must be scrubbed from the persisted transcript.
6. Coordinates returned by the model must be mapped deterministically from screenshot-image space
   to physical screen coordinates, accounting for display scale factor and multi-display layout.
7. Before any high-impact or non-whitelisted action, the tool must request user confirmation and
   must not dispatch input until a server-issued, action-bound confirmation id is approved through
   the interactive UI; rejection, timeout, remote-session unavailability, model-supplied confirmation
   flags, or free-form custom choice text alone must abort the action. Allowlist checks must use the
   current OS foreground app, not a stale screenshot/focus cache. Confirmation text that includes
   model/tool-provided values must display those values as inert text, not executable HTML.
8. All actions must honor the chat cancellation token and stop promptly when the turn is canceled.
9. Every dispatched action must be recorded in an action/audit trail tied to the chat session.
10. Disabling the setting must immediately remove the tool from the advertised inventory (live
    refresh, no chat restart required).

### 7.2 Should Have

1. An **Always-allowed apps** whitelist that suppresses per-action confirmation for trusted apps
   while still confirming high-impact verbs (publish/delete/pay/etc.). In v1, raw coordinate pointer
   actions still require confirmation because screenshot-only targeting cannot prove which control is
   under the coordinate, and standalone activation/destructive keys still require confirmation whether
   the model sends them as `press_key` or a single-key `hotkey`.
2. The screenshot should be annotated with its capture dimensions so the model can ground
   coordinates reliably.
3. The feature should expose the foreground app/window identity to the model with each screenshot.
4. Optional accessibility-tree enrichment (macOS AX / Windows UIAutomation) to improve targeting
   precision beyond pixel coordinates.
5. A visible in-chat indication while Computer Use is actively driving the machine.

## 8. Acceptance Criteria

The feature is accepted when all of the following are true:

1. Settings -> Computer Use controls the tool inventory, direct execution, and the master/whitelist
   state consistently, and defaults to off.
2. With the feature off, no agent can see or run `computer_use`.
3. With the feature on and permissions granted, an agent can screenshot the desktop, focus a
   target app, and perform mouse/keyboard actions that visibly affect that app.
4. High-impact or non-whitelisted actions block on user confirmation; rejection/timeout/cancel
   prevents the input from being dispatched.
5. Missing OS permissions yield a structured, recoverable error and a Settings path to fix it.
6. Coordinate mapping is correct on a HiDPI display and with a secondary display attached.
7. Tests cover setting-gated inventory/execution, unsupported-platform, remote-session, and
   non-interactive runtime gating, permission-missing handling, coordinate mapping, foreground
   allowlist refresh, confirmation gating, and cancellation.
8. Type checking (`npm run typecheck`) and the Vite build (`npm run build:vite`) pass.

## 9. Risks

1. **Prompt injection**: on-screen text/images can hijack the agent. Mitigations: treat all screen
   content as untrusted, default confirmation, high-impact verb guard, per-app whitelist, off by
   default.
2. **Real-machine blast radius**: actions affect the user's real apps and data. Mitigations:
   confirmation gating, audit trail, cancellation, and clear visibility.
3. **OS permission friction**: macOS Accessibility + Screen Recording require explicit grants and
   (Screen Recording) an app restart; this is unavoidable and must be communicated clearly.
4. **Native dependency**: OS-wide synthetic input needs a native module, which adds packaging and
   platform-maintenance surface. Windows ARM64 is explicitly unsupported until the input driver
   ships a compatible addon (see Tech Doc section 8 (packaging)).
5. **Coordinate fragility**: pixel grounding is sensitive to scaling/resolution; mitigated by
   dimension annotation, scale-factor mapping, and optional accessibility enrichment.
6. **Cross-platform parity**: macOS and Windows differ in permissions and input APIs; Linux is
   best-effort.

## 10. Final Product Statement

OpenKosmos will ship an opt-in Computer Use feature that lets agents operate the user's real native
applications through screenshots and synthetic mouse/keyboard input. It is disabled by default,
gated behind explicit OS permissions and a profile master switch, confirms high-impact and
non-whitelisted actions through the existing interactive-request surface, records an action trail,
and is fully cancelable -- delivering real-machine capability with layered authorization rather
than sandbox isolation. Browser automation remains the separate embedded-browser feature.
