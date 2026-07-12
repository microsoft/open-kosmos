# Coding Agent Multi-CLI Support — PRD

<!-- Last verified: 2026-06-17 -->

## 1. Background

OpenKosmos exposes a built-in tool `coding_agent` that delegates software-engineering tasks to
an external coding-agent CLI running inside a project directory. The current implementation
(`src/main/lib/mcpRuntime/builtinTools/codingAgentTool.ts`) hardcodes **Claude Code** (the
`claude` CLI): fixed CLI flags, a Claude-specific `stream-json` parser, and a fixed binary
lookup. Users who prefer a different coding-agent CLI cannot switch.

## 2. Goal

Let the user choose which coding-agent CLI the `coding_agent` tool drives, among:

- **Claude Code** (`claude`) — default
- **Codex CLI** (`codex`)
- **Gemini CLI** (`gemini`)
- **GitHub Copilot CLI** (`copilot`)

The choice is configured from a new Settings page, **Settings → Coding CLI**
(`/settings/coding-cli`), and persists at the **profile level** (in `profile.json`).

## 3. Scope

### In scope
- A profile-level setting `codingAgentSettings.cli` (default `claude`).
- A Settings page to pick the default CLI and to view each CLI's availability.
- The `coding_agent` tool resolves the selected CLI at execution time and invokes it.
- **Availability detection only**: OpenKosmos checks whether each CLI binary is on `PATH` and
  reports it. It shows an install hint when missing.
- Returning the CLI's **final response** only.

### Out of scope (explicit non-goals)
- **Installing or updating** any CLI. The user installs/updates the CLIs themselves.
- Authenticating the CLIs (each CLI manages its own auth/login).
- Per-call CLI selection by the LLM (the CLI is an operator preference, not a tool argument).
- Capturing or surfacing the CLI's intermediate tool calls / tool results.
- Changing the `coding_agent` tool's input schema.

## 4. User stories

1. As a user, I open **Settings → Coding CLI**, see the four CLIs with an availability badge
   (Available / Not found) and an install hint for the missing ones, and pick the one I want
   `coding_agent` to use.
2. As a user, when I trigger a coding task and my selected CLI is installed, OpenKosmos runs it in
   my project directory and returns the final result.
3. As a user, if my selected CLI is not installed, OpenKosmos returns a clear error telling me the
   CLI is missing and how to install it — it does not attempt to install anything.

## 5. Functional requirements

- **FR1**: `codingAgentSettings.cli` is persisted per profile and defaults to `claude` when
  unset (migration-safe; existing profiles keep working).
- **FR2**: The Settings page reads the current selection and persists changes immediately.
- **FR3**: The Settings page detects and displays each CLI's availability and resolved path,
  with a manual re-detect action.
- **FR4**: `coding_agent` resolves the selected CLI from the active profile at execution time.
- **FR5**: If the selected CLI binary is not found, `coding_agent` returns a structured error
  including the install hint; it never installs.
- **FR6**: `coding_agent` returns the CLI's final response; intermediate tool calls/results are
  not captured.
- **FR7**: Cancelling the chat (AbortSignal) terminates the spawned CLI child process.
- **FR8**: Existing Claude Code behavior is preserved when `claude` is selected (default).

## 6. UX

- New nav entry **Coding CLI** under Settings (always visible); the in-page master switch
  governs whether the `coding_agent` tool is active.
- The page lists four CLIs as selectable options (single choice). Each row shows:
  - Display name + binary name.
  - Availability badge: ✅ Available (with resolved path) / ❌ Not found.
  - Install hint command (read-only) for missing CLIs.
- A "Re-detect" button refreshes availability.

## 7. Risks / constraints

- The four CLIs differ substantially in non-interactive invocation and output formats; the
  final-only contract is what makes them uniform (see Tech Doc).
- All four run with their "skip approval / auto-approve" flags, consistent with the current
  tool's `--dangerously-skip-permissions` posture. This is a deliberate trust trade-off
  matching today's behavior.
- OpenKosmos does not manage CLI versions; behavior depends on the user's installed CLI version.
