# CLAUDE.md

## Project
OpenKosmos AI Studio — A desktop AI assistant that lets users create, configure, and chat with AI agents. Agents can execute tools (web search, file operations, shell commands, browser automation) via Model Context Protocol (MCP), maintain long-term memory, and spawn sub-agents for parallel tasks.

**Tech Stack:** Electron 35 + React 18 + TypeScript 5, Webpack 5, TailwindCSS 3, Radix UI, Vercel AI SDK 5.x (streaming), `@modelcontextprotocol/sdk`, Monaco Editor, Playwright (browser automation).

**Architecture:** Electron multi-process model — main process (Node.js: auth, chat engine, MCP runtime, data persistence, voice) + renderer process (React SPA: chat UI, agent editor, settings) + preload scripts (type-safe IPC bridge). The `openkosmos` brand is the default; npm scripts select the brand via `--brand=<name>`, with `BRAND` as the lower-level environment fallback.

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

For all brand-aware npm scripts, omit `--brand` only when you intentionally want the default `openkosmos` brand.

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

## Development Harness
Kosmos includes a development logging harness that captures main-process logs and structured renderer logs into local files so AI coding assistants can inspect runtime behavior while developing and debugging. Prefer this harness over ad-hoc `console.log` edits when investigating issues.

- Start the app in dev mode: `npm run dev` for Kosmos.
- Dev runs write per-launch logs named `openkosmos-dev-YYYY-MM-DD-HH-mm-ss.log` in the normal app logs directory; production runs continue to use daily `openkosmos-YYYY-MM-DD.log` files.
- If the app is still running, flush in-memory logs to disk before analyzing a runtime issue so the log file is complete. From the renderer/devtools context, call `await window.electronAPI.logger.manualFlush()`; it invokes `logger:manualFlush` and `flushToDisk()` in the main process.
- Use `bun scripts/log-query.ts --stats`, `--sources`, `--level`, `--source`, `--grep`, `--tail`, and `--all` to inspect logs. `--today` selects the newest same-day log; use `--all` or an explicit file when you need multiple same-day logs.
- Always check the staleness header before drawing conclusions. If logs are stale, rerun the app to generate a fresh dev harness log.
- For renderer behavior, rely on structured renderer logs forwarded through `logger:rendererLog` and source names such as `R:Renderer` rather than adding temporary renderer-only debug output.

## Prohibited Patterns
- **English only — no Chinese text anywhere.** This is a global open-source project. All code, comments, documentation, commit messages, PR descriptions, scripts, config files, and any other text must be written entirely in English. No Chinese characters in any file — including inline comments, JSDoc, README files, CSS comments, log messages, error strings, and `ai.prompt.md` files. The only exceptions are: (1) functional code that must contain Chinese for correctness (e.g., Whisper model language prompts, language-detection regex patterns, i18n/l10n string values); (2) test fixtures that validate Chinese text handling.
- **No new npm dependencies without checking.** Before adding a dependency, search existing `package.json` for similar functionality. Prefer what's already installed.
- **No schema-breaking changes to JSON persistence.** Files under `{userData}/profiles/` use JSON. Adding fields is safe; renaming or removing fields requires a migration path in code.
- **No renderer component file > 500 lines.** Long components inevitably accumulate scattered `useState` and become unmaintainable. Split components, extract hooks, or lift state into atoms instead. See [arch-render.md §8 State Management](ai.prompt/arch-render.md#8-state-management--must-read-before-changing-renderer-code) — **mandatory reading before any renderer state/component change** (covers atom naming `*.atom.ts`, placement rules, and props-vs-atom-vs-context decision).
- **No blocking `await` on the sign-in critical path for non-auth work.** The `auth:setCurrentSession` IPC handler is the sign-in gate — the renderer shows "Signing In..." until it returns. Any `await` in this handler directly adds to perceived sign-in time. Background services (scheduler, buddy, plugins, sync) must be fire-and-forget (`.then().catch()`, not `await`). See [Postmortem: v2.7.10 signing hang](#postmortem-v2710-signing-hang).
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
3. Run `npm run build` to verify TypeScript compilation and webpack bundling pass.

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
For development access or questions, contact: yanhu@microsoft.com

---

## Postmortem: v2.7.10 signing hang

See [ai.prompt/postmortem-v2.7.10-signing-hang.md](ai.prompt/postmortem-v2.7.10-signing-hang.md) for full details. Summary: `auth:setCurrentSession` blocked on `await schedulerManager.initialize()` which ran sequential LLM jobs for 12+ minutes during cold-start catch-up.

## Postmortem: Claude model token estimation underestimated by 42% causing context overflow

See [ai.prompt/postmortem-token-estimation-overflow.md](ai.prompt/postmortem-token-estimation-overflow.md) for full details. Summary: Token estimation used GPT tokenizer for Claude models, underestimating by 42%; the 85% compression threshold was never triggered, and the overflow recovery regex did not match Claude's error format — both layers of defense failed simultaneously. Fix: three-pillar approach (VS Code Copilot alignment + API Usage anchoring + model correction factor).

## Postmortem: Excessive main-process logging causes UI freeze

See [ai.prompt/postmortem-excessive-logging-ui-freeze.md](ai.prompt/postmortem-excessive-logging-ui-freeze.md) for full details. Summary: Four logging hotspots (streaming catch-all, scheduler heartbeat, token monitor, terminal cleanup) produced 44K+ entries/day; the streaming logger alone fired 37K times with synchronous JSON serialization, blocking the event loop and causing IPC burst delivery that froze the renderer. Fix: silence normal-path logs, deduplicate unknown-type logs, remove payload serialization from hot paths.
