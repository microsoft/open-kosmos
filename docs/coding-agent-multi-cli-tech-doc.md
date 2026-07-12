# Coding Agent Multi-CLI Support — Tech Doc

<!-- Last verified: 2026-06-19 -->

> Implements [coding-agent-multi-cli-prd.md](./coding-agent-multi-cli-prd.md).

## 1. Overview

Refactor the Claude-only `coding_agent` tool into an **adapter-driven** executor. The CLI to
drive is resolved from a new **profile-level** setting `codingAgentSettings.cli`. The whole
feature is governed by a **profile-level master switch** `codingAgentSettings.enabled`
(default **false**): while off, the `coding_agent` tool is neither advertised nor runnable. A new
**Settings → Coding CLI** page hosts the master toggle, edits the setting, and shows per-CLI
availability (the CLI selection is hidden until the master switch is on).

```
settings/coding-cli (renderer)
  -> codingCli IPC (getSettings / updateSettings / detectAvailability)
  -> profileCacheManager.get/updateCodingAgentSettings  -> profile.json
codingCli registry (4 adapters) -> detectAvailability (async shell-free which/where argv)

coding_agent tool (main)
  -> read userAlias from ToolExecutionContext
  -> profileCacheManager.getCodingAgentSettings(alias).cli  (default 'claude')
  -> registry.getAdapter(cli)
  -> spawn(binary, adapter.buildArgs(task), { cwd })
  -> adapter.extractFinal(stdout)  -> final response
```

## 2. Data model (profile-level)

`src/main/lib/userDataADO/types/profile.ts`:

```ts
export type CodingCliId = 'claude' | 'codex' | 'gemini' | 'copilot';

export interface CodingAgentSettings {
  /** Master switch — when false the coding_agent tool is hidden and non-runnable. */
  enabled: boolean;
  /** Default coding CLI used by the coding_agent built-in tool. */
  cli: CodingCliId;
}

export const DEFAULT_CODING_AGENT_SETTINGS: CodingAgentSettings = { enabled: false, cli: 'claude' };

// On ProfileV2:
codingAgentSettings?: CodingAgentSettings;
```

Adding optional fields is migration-safe; missing values are back-filled to the default at
read time (a legacy profile that only stored `cli` back-fills `enabled: false`).
`profileSanitizer.ts` passes the field through; `profileSettingsCrud.ts` provides
`getCodingAgentSettings` (default-fill) and `updateCodingAgentSettings` (partial merge-write under
the per-profile write lock, so `{ enabled }` and `{ cli }` can be saved independently);
`profileCacheManager.ts` exposes both. CRUD + sanitizer needed **no change** for `enabled` — the
default-spread and partial-merge already cover it.

## 3. Adapter layer

New directory `src/main/lib/mcpRuntime/builtinTools/codingCli/`:

```ts
export interface CodingCliAdapter {
  id: CodingCliId;
  displayName: string;   // e.g. "Claude Code"
  binaryName: string;    // e.g. "claude"
  installHint: string;   // e.g. "npm install -g @anthropic-ai/claude-code"
  docsUrl: string;
  /** CLI-specific argv for a single non-interactive task (auto-approve flags included). */
  buildArgs(task: string): string[];
  /** Extract the final response text from full stdout (and stderr fallback). */
  extractFinal(stdout: string, stderr: string): string;
}
```

### Per-CLI invocation (researched from official docs, 2026-06)

| CLI | argv (task last where applicable) | Final extraction |
|-----|-----------------------------------|------------------|
| Claude Code | `-p --output-format json --dangerously-skip-permissions <task>` | JSON: `.result` |
| Codex CLI | `exec --sandbox workspace-write --skip-git-repo-check <task>` | stdout = final message |
| Gemini CLI | `-p <task> --output-format json --yolo` | JSON: `.response` |
| GitHub Copilot CLI | `-p <task> -s --allow-all --no-ask-user` | stdout = final message |

Notes:
- **Claude** `--output-format json` prints a single JSON result object (`.result`).
  `--dangerously-skip-permissions` keeps today's auto-approve posture.
- **Codex** `exec` (without `--json`) streams progress to stderr and prints **only the final
  agent message** to stdout. `--sandbox workspace-write` allows edits; `--skip-git-repo-check`
  avoids the "must be a git repo" failure.
- **Gemini** `--output-format json` returns `{ response, stats }`; `--yolo` auto-approves.
- **Copilot** has **no structured/JSON output**; `-s` suppresses stats/decoration so stdout is
  just the agent's response; `--allow-all` grants unattended permissions and `--no-ask-user`
  prevents the CLI from pausing for additional input.

`extractFinal` is defensive: JSON adapters try `JSON.parse` (whole stdout, then last JSONL
line) and fall back to trimmed raw stdout; on empty stdout they fall back to stderr.

### Registry + availability

```ts
export const CODING_CLI_ADAPTERS: Record<CodingCliId, CodingCliAdapter>;
export function getAdapter(id: CodingCliId): CodingCliAdapter;
export function detectAvailability(adapter): { id; available: boolean; path: string | null };
```

Availability uses `which <binary>` (POSIX) / `where <binary>` (Windows) via async shell-free
`execFile(command, [binaryName], ...)` with a short timeout, generalizing the current
`findCliPath()`. No install/update is ever attempted.

## 4. Executor refactor (`codingAgentTool.ts`)

- `execute(args, options)`:
  1. Validate `task` / `cwd` (unchanged).
  2. Resolve CLI: `profileCacheManager.getCodingAgentSettings(userAlias).cli ?? 'claude'`
     where `userAlias` comes from the captured per-call execution context. Model-supplied `cli`
     is not accepted or honored because CLI selection is an operator preference.
  3. `getAdapter(cli)`; `detectAvailability`; if missing -> structured error with `installHint`.
  4. `executeViaSpawn(adapter, ...)`.
- `executeViaSpawn`:
  - `spawn(command, args, { cwd, shell: false })` — the CLI is spawned **without a shell on every
    platform**. On Windows, npm-installed `.cmd`/`.bat` shims cannot be exec'd directly without a
    shell, so `resolveWindowsNpmShim` reads the shim and extracts the real target it wraps: a
    `.js`/`.mjs`/`.cjs` entry is run as `node <target>` (using the shim directory's bundled
    `node.exe` when present, otherwise `node` on `PATH`), and an `.exe` target is invoked directly.
    An unrecognized shim throws a structured error instead of falling back to `cmd.exe`. `.exe` and
    all non-Windows paths spawn directly. No `cmd` quote/newline normalization is needed because no
    command string is ever handed to a shell.
  - Accumulate stdout (capped at `MAX_OUTPUT_CHARS`) and stderr (diagnostics).
  - **Initial frame + heartbeat**: immediately after `spawn`, an initial partial result with empty
    output is emitted carrying the resolved `cli`, so the view can show the correct CLI name from
    the first frame (the CLI is settings-driven and absent from the tool args, so the streamed
    result is the view's only source of truth). A timer then emits elapsed-time partial frames (no
    content parsing) so the UI is not frozen during long runs.
  - On close: `output = adapter.extractFinal(stdout, stderr)`.
  - **No-response watchdog**: the tool no longer accepts an agent-supplied timeout. It uses the
    unified fixed `TOOL_IDLE_TIMEOUT_MS` (10 minutes) inactivity budget; stdout/stderr chunks
    re-arm the watchdog, and expiry terminates the child process.
  - **Cancellation (new)**: listen to `options.signal` and `child.kill('SIGKILL')` on abort — both
    the central no-response watchdog and a user chat-cancel abort that signal, fixing the earlier
    gap where cancelling the chat left the CLI running. Unlike `execute_command`, `coding_agent`
    registers **no** `ToolExecutionContext.registerCancellationHandler`; the `options.signal`
    listener is its sole teardown path.
- Result type gains `cli: CodingCliId` (`src/shared/types/toolCallArgs/codingAgent.ts`), so the
  UI can show which CLI ran. `CodingAgentToolArgs` intentionally has no `cli` field.
- The tool-call view (`CodingAgentToolCallView.tsx`) titles the panel **`Coding Agent (<display
  name>)`** and labels the running state **`Running <display name>...`**, resolving the display
  name from `result.cli` via the shared `CODING_CLI_DISPLAY_NAMES` map (the resolved
  `cli` rides on the initial + heartbeat partial results, so the correct CLI name shows from the
  first frame during execution too).
  `CODING_CLI_DISPLAY_NAMES` in `src/shared/types/codingCli.ts` is the single source of truth for
  display names, also consumed by the main-process adapters.

The tool's `inputSchema` exposes only `task` and `cwd`, with `additionalProperties: false`:
CLI choice is operator-driven via settings, not a model argument, and timing is governed by the
unified 10-minute no-response budget rather than a model argument.

**Master-switch gating (`builtinToolsManager.ts`).** Registration is **unconditional** — the
metadata is always added in `initialize()` (mirroring `browser`), so toggling the switch mid-session
needs no singleton rebuild. The profile-level master switch is the **sole gate**, mirroring the
`manage_hooks` precedent (`isHooksEnabledForProfile`): a helper `isCodingAgentEnabledForProfile(alias)`
reads `getCodingAgentSettings(alias).enabled`. `shouldExposeTool('coding_agent')` returns that boolean, so
the tool is hidden from every public inventory accessor (`getAllTools`, `getAllToolsInfo`,
`getOpenAIToolDefinitions`, `getStats`) while off. `executeTool` is fail-safe: master switch off →
`coding_agent tool is disabled (enable it in Settings → Coding CLI)`; else delegate. The global system
prompt section is gated by the same master switch (`profileCacheManager.getCodingAgentSettings(alias).enabled`),
so the model is only told about `coding_agent` when the tool is actually exposed.

## 5. IPC (mirrors the generic profile-settings plumbing)

- **Shared contract** `src/shared/ipc/codingCli.ts` via `connectRenderToMain<RenderToMain>('codingCli')`:
  - `getSettings() -> Result<{ enabled: boolean; cli: CodingCliId }>`
  - `updateSettings({ enabled?, cli? }) -> Result`
  - `detectAvailability() -> Result<{ clis: Array<{ id; displayName; binaryName; installHint; docsUrl; available; path }> }>`
- **Main** `codingCliIPC.ts` `registerCodingCliIPC()` binds the three handlers to
  `profileCacheManager` (settings) and the registry (availability); resolves the current alias
  from `profileCacheManager`. Wired in `src/main/startup/ipc/index.ts`.
- **Preload** `src/preload/codingCli/invoke.ts` whitelists the three channels; exposed as
  `window.electronAPI.codingCli.invoke` in `src/preload/main.ts` (+ type declaration).
- **Renderer** `src/renderer/ipc/codingCli.ts` `bindRender(window.electronAPI.codingCli.invoke)`.

The Settings UI calls `mcpClientCacheManager.refresh()` after a successful master-switch toggle:
registration remains unconditional, but `shouldExposeTool('coding_agent')` changes the advertised
tool inventory when `enabled` flips. CLI-selection changes do not require a refresh because the
selected CLI is read from profile settings at execution time.

## 6. Settings UI

Split into the unified three-file settings pattern (container + header + content), matching
`RuntimeSettings*`, `Screenshot*`, etc.:
- `CodingCliSettingsView.tsx` (container): on mount runs `getSettings()` + `detectAvailability()`;
  owns `enabled` / `selectedCli` / `availability` / loading / saving state, `handleSelect` (calls
  `updateSettings({ cli })`), and `handleToggle` (calls `updateSettings({ enabled })`) — both
  optimistic with revert on failure. On a successful toggle it calls
  `mcpClientCacheManager.refresh()` so the renderer Agent tool list reflects `coding_agent`
  appearing/disappearing without a chat switch (mirrors the profile-level Hooks master switch in
  `AgentHooksView`). The route is always registered; the master switch governs availability. Root uses
  `runtime-settings-view`.
- `CodingCliSettingsHeaderView.tsx`: `unified-header` with a `Code2` title and a `btn-action`
  re-detect icon button (`animate-spin` while detecting) that calls back into `loadAvailability`.
  The re-detect button is hidden while the master switch is off (it acts on the hidden CLI list).
- `CodingCliSettingsContentView.tsx`: `content-view-container` > `toolbar-settings-card`. Leads with
  an **Enable Coding Agent** master-toggle card (always shown, mirrors `MemexSettingsContentView`'s
  `toolbar-toggle-wrapper`). The **Default Coding CLI** card is rendered only while `enabled`; each
  CLI is a single-select row reusing Runtime's classes (`runtime-mode-row`, `runtime-component-meta`,
  `runtime-component-tag`, `runtime-status-dot--ok/--off`, `runtime-radio`). Selection is driven by
  the native radio's `onChange`; the name/status block is a `<label htmlFor>` for that radio, and
  the Documentation link sits outside the label so it never changes the selection. Available CLIs
  show the resolved path; missing ones show `Not found` + the install hint. No bespoke CSS — the
  old `CodingCliSettingsView.css` was removed in favor of the shared
  `ContentView.css` / `ToolbarSettingsView.css` / `RuntimeSettings.css`.

`SettingsNavigation.tsx`: add a **Coding CLI** nav item + `'/settings/coding-cli'` active-path
detection (always shown).
`AppRoutes.tsx`: register `<Route path="coding-cli" .../>` (always registered).

## 7. Testing

Target the diff-aware 90% gate (lines/functions/branches/statements):
- **Adapters**: `buildArgs` argv, `extractFinal` for each (valid JSON, JSONL, raw fallback,
  empty-stdout->stderr fallback).
- **Registry**: `getAdapter`, `detectAvailability` (found / not found, POSIX vs Windows command).
- **CRUD**: `getCodingAgentSettings` default-fill + stored value (incl. `enabled` back-fill to
  `false` for legacy `cli`-only profiles); `updateCodingAgentSettings` partial merge for both
  `{ cli }` and `{ enabled }` + write-lock path; sanitizer passthrough.
- **Manager gating**: `shouldExposeTool`/`getAllToolsInfo` hide `coding_agent` when the profile
  switch is off and expose it when on; `executeTool` returns the recoverable disabled message when
  the switch is off.
- **Executor**: CLI resolution (profile / default), availability-missing error, spawn success
  (final extraction), fixed 10-minute no-response watchdog, cancellation kill, output truncation.
- **IPC**: handler success/error branches.
- **View**: master toggle on/off (persist `{ enabled }` + `mcpClientCacheManager.refresh()` +
  revert-on-failure), conditional Default-CLI section, re-detect hidden when off, load, select
  (success / revert-on-failure / throw), re-detect + detecting state, empty/loading states.
  Integration-rendered over the container + header + content split so all three files are
  covered.

## 8. Gotchas

- **Final-only**: do not reintroduce per-token streaming; it diverges across CLIs and Copilot
  cannot provide it. The heartbeat is content-free by design.
- **Codex requires a git repo** unless `--skip-git-repo-check`; the adapter always passes it.
- **Copilot has no JSON output**; never try to JSON-parse its stdout.
- **Availability is detection-only**; never shell out to an installer.
- **Master switch is profile-level and default off**: `DEFAULT_CODING_AGENT_SETTINGS.enabled =
  false`. It gates exposure + execution (`shouldExposeTool` / `executeTool`), not registration, so a
  mid-session enable works without a restart. The settings view must call
  `mcpClientCacheManager.refresh()` after a successful toggle — profile-level switches (unlike
  app-level browser/memex) are not refreshed by `appDataManager.handleConfigUpdate`.
- **Default off**: `DEFAULT_CODING_AGENT_SETTINGS.cli = 'claude'` preserves current behavior.
