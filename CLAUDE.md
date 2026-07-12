# CLAUDE.md

## Project
OpenKosmos AI Studio — A desktop AI assistant that lets users create, configure, and chat with AI agents. Agents can execute tools (web search, file operations, shell commands, browser automation) via Model Context Protocol (MCP), persist local profiles and chat history, and spawn sub-agents for parallel tasks.

**Tech Stack:** Electron 35 + React 18 + TypeScript 5, Webpack 5, TailwindCSS 4, lucide-react icons, Vercel AI SDK 5.x (streaming), `@modelcontextprotocol/sdk`, better-sqlite3 (local persistence), Monaco Editor, Playwright (browser automation).

**Architecture:** Electron multi-process model — main process (Node.js: auth, chat engine, MCP runtime, data persistence, voice) + renderer process (React SPA: chat UI, agent editor, settings) + preload scripts (type-safe IPC bridge). The app is built as OpenKosmos-only.

## Commands

A list of useful package.json scripts:

#### During development, after modifying code, the following commands can be used for verification (run as needed)

- `npm run build:vite` Full project build (note: this uses Vite)
- `npm run typecheck` Run TypeScript type checking
- `npm run test` Run vitest unit tests

### Other commands, generally not needed

```bash
npm run dev             # Full Vite development mode (main + renderer watch + electron), defaults to openkosmos. Note: manually kill the process when done
npm run build           # Only used for final app release builds in the pipeline (note: this uses Webpack, will be replaced by Vite in the future)
npm run test:e2e        # Run Playwright E2E tests
```

## Context Loading Guide
Before starting a task, read the corresponding document based on the task type:

| Task Type | Read File |
|-----------|-----------|
| Understand main-process architecture | [arch-main.md](ai.prompt/arch-main.md) |
| Understand renderer-process architecture | [arch-render.md](ai.prompt/arch-render.md) |
| Understand data flow / IPC / streaming | [data-flow.md](ai.prompt/data-flow.md) |
| Git / testing / release workflows | [workflows.md](ai.prompt/workflows.md) |
| Modify a specific module | The `ai.prompt.md` in that module's directory (if it exists) |
| Analyze / debug via runtime logs | [log-analysis.md](ai.prompt/log-analysis.md) |

After entering a module directory, check whether an `ai.prompt.md` exists and read it first if present.

## Pre-Task Checklist
Before starting any code change:
1. Identify the target module(s). Read each module's `ai.prompt.md` if it exists.
2. If the change spans multiple modules, read [arch-main.md](ai.prompt/arch-main.md) and/or [arch-render.md](ai.prompt/arch-render.md) first depending on the process.
3. Run `npm run check:impact -- <files-you-plan-to-change>` to see affected modules. Read their `ai.prompt.md` files.
4. Check the **Co-Change Map** in each involved module's `ai.prompt.md` — it lists files that must be updated together.
5. If touching IPC channels, read [data-flow.md](ai.prompt/data-flow.md) and the IPC module's [ai.prompt.md](src/shared/ipc/ai.prompt.md).

## Log Analysis
When developing and debugging locally or troubleshooting, use scripts to view logs for auxiliary analysis.
See [log-analysis.md](ai.prompt/log-analysis.md) for full usage.

## Adding Logs
When adding diagnostics, use the shared logging paths instead of ad-hoc console output. See [log-analysis.md](ai.prompt/log-analysis.md#adding-logs) for detailed examples.

- Main process: use a named import (`import { createLogger } from ...`) from `src/main/lib/unifiedLogger` with the correct relative path for the file being edited, cache the global logger in a module-level const, and call `logger.debug/info/warn/error(message, source, metadata)`. Main-process module identity comes from the `source` argument, not from separate logger instances.
- Renderer process: use `import { createLogger } from '@renderer/lib/utilities/logger'`; in dev mode it writes human-readable DevTools output and forwards structured logs to the main-process dev logger through `logger:rendererLog`.
- Pick stable source names that match the module or feature (`chat:*`, `mcp:*`, `scheduler:*`, `R:<Component>` after renderer forwarding) so `bun scripts/log-query.ts --source ...` remains useful.
- Put diagnostic dimensions in structured metadata, not in long interpolated strings. Log scalar IDs, counts, durations, state names, and error messages; never log tokens, credentials, full prompts, full tool payloads, or large objects.
- Choose levels intentionally: `error` for failed operations that need attention, `warn` for degraded or recoverable behavior, `info` for low-volume lifecycle events, and `debug` only for opt-in/local diagnostics. Renderer `debug()` is development-only and is silent in production builds.
- Do not add unconditional logs to hot paths such as streaming deltas, WebSocket frames, render loops, timers, or per-token handlers. Use first-occurrence dedupe, sampling, end-of-operation summaries, or a debug flag that is off by default.
- Periodic jobs should log state changes, actions taken, and failures. Do not log "nothing happened" heartbeats.

## Development Harness
OpenKosmos includes a development logging harness that captures main-process logs and structured renderer logs into local files so AI coding assistants can inspect runtime behavior while developing and debugging. Prefer this harness over ad-hoc `console.log` edits when investigating issues.

- Start the app in dev mode with `npm run dev`.
- Dev runs write per-launch logs named `openkosmos-dev-YYYY-MM-DD-HH-mm-ss.log` in the normal app logs directory; production runs continue to use daily `openkosmos-YYYY-MM-DD.log` files.
- If the app is still running, flush in-memory logs to disk before analyzing a runtime issue so the log file is complete. From the renderer/devtools context, call `await window.electronAPI.logger.manualFlush()`; it invokes `logger:manualFlush` and `flushToDisk()` in the main process.
- Use `bun scripts/log-query.ts --stats`, `--sources`, `--level`, `--source`, `--grep`, `--tail`, and `--all` to inspect logs. `--today` selects the newest same-day log; use `--all` or an explicit file when you need multiple same-day logs.
- Always check the staleness header before drawing conclusions. If logs are stale, rerun the app to generate a fresh dev harness log.
- For renderer behavior, rely on structured renderer logs forwarded through `logger:rendererLog` and source names such as `R:Renderer` or `R:AgentPage` rather than adding temporary renderer-only debug output.

## Prohibited Patterns
- **English only — no Chinese text anywhere.** This is a global open-source project. All code, comments, documentation, commit messages, PR descriptions, scripts, config files, and any other text must be written entirely in English. No Chinese characters in any file — including inline comments, JSDoc, README files, CSS comments, log messages, error strings, and `ai.prompt.md` files. The only exceptions are: (1) functional code that must contain Chinese for correctness (e.g., Whisper model language prompts, language-detection regex patterns, i18n/l10n string values); (2) test fixtures that validate Chinese text handling.
- **No new npm dependencies without checking.** Before adding a dependency, search existing `package.json` for similar functionality. Prefer what's already installed.
- **No schema-breaking changes to JSON persistence.** Files under `{userData}/profiles/` use JSON. Adding fields is safe; renaming or removing fields requires a migration path in code.
- **No renderer component file > 500 lines.** Long components inevitably accumulate scattered `useState` and become unmaintainable. Split components, extract hooks, or lift state into atoms instead. See [arch-render.md §8 State Management](ai.prompt/arch-render.md#8-state-management--must-read-before-changing-renderer-code) — **mandatory reading before any renderer state/component change** (covers atom naming `*.atom.ts`, placement rules, and props-vs-atom-vs-context decision).
- **No new file-length allowlist entries.** The legacy entries in `scripts/file-length-allowlist.json` are debt, not a bypass mechanism. If the File Length gate fails for a new or changed file, split the file, extract components/hooks/helpers, or reduce growth in an existing allowlisted file. Do **not** add paths to any `allowlist` field to make the gate pass.
- **No new test-coverage allowlist entries.** The `allowlist` in `scripts/coverage-threshold-config.json` must not grow. If the Coverage gate fails, add meaningful tests or use a surgical `/* v8 ignore next */` only for truly unreachable code. Do **not** add paths to the coverage allowlist to make the gate pass.
- **No blocking `await` on the sign-in critical path for non-auth work.** The `auth:setCurrentSession` IPC handler is the sign-in gate — the renderer shows "Signing In..." until it returns. Any `await` in this handler directly adds to perceived sign-in time. Background services (scheduler, buddy, sync) must be fire-and-forget (`.then().catch()`, not `await`). See [Postmortem: v2.7.10 signing hang](#postmortem-v2710-signing-hang).
- **No unbounded sequential `await` loops over network/LLM calls.** A `for...of` with `await` over N items that each hit the network has O(N × latency) wall-clock time with no upper bound. Use `Promise.allSettled` with per-item timeouts, or run them fire-and-forget. This applies especially to cold-start catch-up, bulk sync, and batch operations.

## IPC Handler Discipline
IPC handlers that gate UI transitions (auth, navigation, window lifecycle) are **critical-path code**. Before adding an `await` to any IPC handler:
1. Ask: "Does the renderer block on this handler's response?" If yes, the `await` directly degrades UX.
2. Ask: "Can this work fail or take unbounded time?" If yes, it must not be `await`ed on the critical path.
3. Ask: "Does the user need to see the result before the UI can proceed?" If no, fire-and-forget.

Rule of thumb: IPC handlers that return `{ success: true }` to unblock a UI transition should complete in < 100ms. Everything else goes to background.

## Post-Change Verification
After every code change, before considering work done:
1. Run `npm run check:impact -- <changed-files>` — read any flagged `ai.prompt.md` to check for missed co-changes.
2. Run `npm test` if the changed modules have `__tests__/` directories.
3. Run `npm run build:vite` to verify TypeScript compilation and Vite bundling pass.

## Test Coverage Requirements ⚠️ CRITICAL

CI enforces a **diff-aware, per-file coverage gate** (`scripts/check-coverage.js`, config `scripts/coverage-threshold-config.json`). It compares `origin/main...HEAD` and, for **every** PR-changed source file matching `src/**/*.{ts,tsx}`, requires **≥ 90% on all four metrics — lines, functions, branches, AND statements**. A changed file with no coverage data scores 0% and fails. Branches is usually the hardest metric: cover every `if/else`, `?:`, `??`, `||`, and `&&` arm, not just the happy path.

**Vendored / third-party code copied into `src/` is OUR code and MUST be tested to the same 90% threshold.** Copying a file from an upstream project into our tree (e.g. `src/main/lib/memex/vendor/**`) transfers full ownership: it ships in our bundle, runs in our process, and is our responsibility to test. "It's upstream code, we didn't write it" is **not** a valid reason to skip tests. Test it like any first-party file — drive the real code (prefer integration-style tests over on-disk temp dirs / fakes rather than mocks) until every reachable branch is covered.

**The allowlist is NOT an escape hatch — never use it to make a red gate green.** The `allowlist` in `coverage-threshold-config.json` exempts a file entirely, so adding an entry to silence a coverage failure is **forbidden** and must be rejected in review. CI also gates against new coverage allowlist entries. The allowlist is reserved exclusively for already-approved legacy files where coverage is **genuinely infeasible to obtain under Vitest** — e.g. thin wrappers over native modules, Electron-only, or OS APIs that cannot execute in the test runner. "We don't want to write tests for this" never qualifies.

**For provably-unreachable lines, use a surgical `/* v8 ignore next */`, not the allowlist.** When a specific branch is dead code (e.g. a defensive `|| []` fallback on a Map that a prior loop populates for every key), annotate **that line** with `/* v8 ignore next */` (or `next N`) plus a comment explaining why it is unreachable. This keeps every other branch in the file fully gated, unlike the allowlist which removes the whole file from the gate. Reach for this only after confirming the branch is truly impossible to hit from a test — never to paper over a path you simply didn't test.

To debug a failing gate locally: run `npx vitest run --coverage` (writes `coverage/coverage-final.json`), then `node scripts/check-coverage.js --base-ref origin/main --head-ref HEAD`. It prints each failing file with its per-metric percentages.

## Conventions
- Branch: `user/<alias>/<feature>`
- Commit: `type(scope): description` (types: feat, fix, docs, style, refactor, test, chore)
- PR title: English, under 70 chars

## Documentation Maintenance ⚠️ CRITICAL

All `ai.prompt.md` files follow a unified template (see any existing one for reference).

### When to update
After making code changes, you **must** check:
1. Does the modified module have an `ai.prompt.md`? If so, is the content still accurate? If not, **update it in the same commit**.
2. Do the changes affect the global architecture (added/removed modules, changed data flow)? If so, update the corresponding documents under `ai.prompt/`.
3. Update the `<!-- Last verified: YYYY-MM-DD -->` comment at the top of any `ai.prompt.md` you modify.

After creating a new `ai.prompt.md`, or when an existing module doc should now be referenced from the global index, update the module table in [arch-main.md](ai.prompt/arch-main.md) or [arch-render.md](ai.prompt/arch-render.md) (whichever process the module belongs to) to add or fix the Docs link.

### What to include
Each `ai.prompt.md` must contain: **Key Files** (table with file, responsibility, size), **Architecture** (design decisions, state flow, interaction protocols — only what's NOT obvious from code), **Common Changes** (step-by-step for frequent modification scenarios), **Gotchas** (traps, pitfalls, historical bugs), **Related** (dependencies with Markdown links to other `ai.prompt.md` files).

Code changes without documentation updates are incomplete. These documents are the foundation for team AI collaboration.

## Contact
For development access or questions, use the public support channels documented in `SUPPORT.md`.

---

## Postmortem: v2.7.10 signing hang

See [ai.prompt/postmortem-v2.7.10-signing-hang.md](ai.prompt/postmortem-v2.7.10-signing-hang.md) for full details. Summary: `auth:setCurrentSession` blocked on `await schedulerManager.initialize()` which ran sequential LLM jobs for 12+ minutes during cold-start catch-up.

## Postmortem: Claude model token estimation underestimated by 42% causing context overflow

See [ai.prompt/postmortem-token-estimation-overflow.md](ai.prompt/postmortem-token-estimation-overflow.md) for full details. Summary: Token estimation used GPT tokenizer for Claude models, underestimating by 42%; the 85% compression threshold was never triggered, and the overflow recovery regex did not match Claude's error format — both layers of defense failed simultaneously. Fix: three-pillar approach (VS Code Copilot alignment + API Usage anchoring + model correction factor).

## Postmortem: correctionRatio collapse after compression causes context overflow

See [ai.prompt/postmortem-correction-ratio-collapse.md](ai.prompt/postmortem-correction-ratio-collapse.md) for full details. Summary: After context compression, `anchorTokenEstimate` compared post-compression API prompt_tokens against a stale pre-compression `lastLocalEstimate`, collapsing `correctionRatio` to 0.0289. All subsequent estimates were divided by 34×, permanently disabling compression for the session. Fix: call `calculateThreeComponentTokens()` after compression to refresh `lastLocalEstimate` before the API response anchors the ratio.

## Postmortem: Excessive main-process logging causes UI freeze

See [ai.prompt/postmortem-excessive-logging-ui-freeze.md](ai.prompt/postmortem-excessive-logging-ui-freeze.md) for full details. Summary: Four logging hotspots (streaming catch-all, scheduler heartbeat, token monitor, terminal cleanup) produced 44K+ entries/day; the streaming logger alone fired 37K times with synchronous JSON serialization, blocking the event loop and causing IPC burst delivery that froze the renderer. Fix: silence normal-path logs, deduplicate unknown-type logs, remove payload serialization from hot paths.

## Postmortem: Bing image/web search returns irrelevant or zero aggregated results

See [ai.prompt/postmortem-bing-search-parallel-degradation.md](ai.prompt/postmortem-bing-search-parallel-degradation.md) for full details. Summary: `bing_image_search` and `bing_web_search` ran every query in a single call as unbounded parallel `Promise.allSettled`, each launching its own headless Chromium and all sharing ONE hardcoded `storageState` file in `os.tmpdir()`. The same-IP burst triggered Bing anti-bot degraded pages while the state-file read/write/delete race tore cookies between contexts, so exactly one query "won" (~8-10 results) and every other query returned exactly 1 junk result — aggregated output contained none of the intended images. Fix (both tools): one shared browser per call, a fresh isolated `browser.newContext()` per query with NO persisted `storageState`, bounded concurrency (2), and a retry-once when a query yields ≤1 result.

## Findings: Microsoft SSO browser extension cannot work in Electron (removed)

See [ai.prompt/embedded-browser-sso-findings.md](ai.prompt/embedded-browser-sso-findings.md) for full details. Summary: the embedded browser briefly bundled the Microsoft Single Sign On Chrome extension; inspection of its real source showed its only mechanism is Chrome native messaging (`chrome.runtime.sendNativeMessage` → `com.microsoft.browsercore`), which Electron does not support (issue #40380, "Not planned"). The extension loads but its SSO flow fails on the first call, so it and all its wiring were removed. Do not re-add a store extension for SSO — implement auth at the Electron `session` layer instead.

## Postmortem: sub-agent fails on 2nd turn with 400 "Unknown parameter: 'input[N].tool_calls'"

See [ai.prompt/postmortem-subagent-responses-toolcalls-400.md](ai.prompt/postmortem-subagent-responses-toolcalls-400.md) for full details. Summary: `SubAgentLLMClient.callLLM` sent `/chat/completions`-shaped messages (`assistant.tool_calls` + `role:'tool'`) straight into `requestBody.input` for the `/responses` endpoint, which rejects them. Turn 1 (no tool history) passed; the first tool call made turn 2's payload contain an `assistant(+tool_calls)` message, so every tool-using sub-agent on a `/responses` model (GPT-5.x — the parent's default) failed deterministically with 400. Root cause was forked wire-format logic: the sub-agent transport reimplemented `formatMessagesForApi` but never ported its `/responses` `function_call` / `function_call_output` conversion. Fix: new shared `src/main/lib/chat/responsesInputConverter.ts` (single source of truth) consumed by the sub-agent transport; `agentChatUtilities.ts` migration onto it tracked as follow-up.

## Postmortem: empty mcp_servers leaked all tools instead of none

See [ai.prompt/postmortem-mcp-empty-servers-all-tools.md](ai.prompt/postmortem-mcp-empty-servers-all-tools.md) for full details. Summary: `AgentChatPromptService.getCurrentAvailableTools()` gated its per-server filter behind `if (mcp_servers.length > 0)` and fell back to `return allTools` for an empty array — treating "no servers configured" as "all servers", the inverse of the data model (`mcp_servers: []` = no tools; a `{name, tools: []}` entry = all of that server; `builtin-tools` is a normal server under the same rules). The buggy line is latent on `origin/main`; it became reachable in this PR only after the Agent-editor Save no-op fix restored working saves, so unselecting every server finally persisted `mcp_servers: []`. Fix: always run the filter loop (empty → `[]`), drop the all-tools fallback. A **third layer** then surfaced: with 0 tools correctly withheld, the agent still *hallucinated* tool use because the static `getGlobalSystemPrompt()` unconditionally documents the whole builtin tool manual every turn — the model emitted `<function_calls>` as plain text and fabricated results. Fix: thread the real available-tool count into `getCombinedSystemPromptForContext(availableToolCount?)` and, when it is `0`, inject a `NO_TOOLS_AVAILABLE_REMINDER` overriding the manual (partial-tools case is deferred debt). Lessons: an empty allowlist grants nothing — never `return allTools` on empty; don't conflate inner `tools: []` (all of a server) with outer `mcp_servers: []` (no servers); and withholding a tool from the API is not enough while the prompt still *describes* it.

## Postmortem: app-managed Python venv missing pip breaks `python -m pip`

See [ai.prompt/postmortem-app-managed-python-pip-unavailable.md](ai.prompt/postmortem-app-managed-python-pip-unavailable.md) for full details. Summary: app-managed runtime exposed `pip` as a shim to `uv pip`, but the model naturally tried `python3 -m pip install ...`; the venv had been created without pip seeding, so the interpreter reported `No module named pip`. Fix: create/rebuild venvs with `uv venv --seed`, non-destructively repair existing venvs via `uv pip install pip setuptools wheel --python <venvPython>`, make `execute_command` wait for Python shims in internal mode, and retry once after repairing missing pip.

## Postmortem: `rolldownOptions` typo silently disabled main-process entry, dumping userData into `%APPDATA%\Electron\`

See [ai.prompt/postmortem-vite-rolldown-options-typo.md](ai.prompt/postmortem-vite-rolldown-options-typo.md) for full details. Summary: `electron.vite.config.ts` used `build.rolldownOptions` in the main + renderer blocks under the mistaken belief that Vite 8's Rolldown backend renamed the key — but Vite still exposes only `build.rollupOptions`, so the entire block (including `input: { main: 'src/main/bootstrap.ts' }`, the `@nut-tree-fork/*` external, and the renderer's `screenshot.html` entry) was silently discarded. `electron-vite` v6 fell back to `findLibEntry` and bundled `src/main/main.ts` as the entry, so the `bootstrap.ts → bootstrapUserData.ts` chain that calls `app.setName()` / `app.setPath('userData', ...)` never reached the bundle; Electron booted with the default app name `"Electron"` and every dev launch wrote profiles/logs/python-venv/bun/native-modules under `%APPDATA%\Electron\` instead of `openkosmos-app`. Introduced by commit `e1b4219d4` ("Rename rollupOptions → rolldownOptions for Vite 8 Rolldown backend"). Fix: rename `rolldownOptions` → `rollupOptions` in both blocks. Prevention: Vite `build.*` accepts unknown keys silently — verify config field names against `node_modules/vite/dist/node/index.d.ts`; after any change to `electron.vite.config.ts`, grep the built `dist-vite/main/main.js` for `"Setting App Name"` (or the sourcemap's `sources[]` for `bootstrap.ts`) to confirm the intended entry chain is bundled.
