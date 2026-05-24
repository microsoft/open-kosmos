# Changelog

This file records all notable changes to Kosmos.app.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Features

### Improvements

### Bug Fixes

### Security

## [2.8.6] - 2026-05-21

### Bug Fixes
- Fix safety filter false positives blocking normal message formatting
- Fix context compression producing invalid message structure
- Fix interactive request cards (schedule, confirm) not rendering after recent refactor

### Deprecations
- Removed replay feature

## [2.8.5] - 2026-05-20

### Improvements
- Optimized atom external() with early bail-out to avoid redundant re-renders

### Bug Fixes
- Fix Teams channel message deep links not opening the correct thread
- Fix dialog not closeable via ESC key or clicking outside
- Fix channel message sourceLink missing webUrl for thread-level navigation

## [2.8.4] - 2026-05-20

### Features
- Agent now asks for user confirmation before creating tasks

### Improvements
- PM Studio task board improvements and calendar webLink support
- Improved dueDate auto-detection rules for task creation

### Bug Fixes
- Fix file preview not showing during streaming when filePath arrives after content
- Fix render loop (Maximum update depth exceeded) caused by unbatched lifecycle notifications
- Fix ChatInput not centered in New Chat view
- Fix dismissed tasks incorrectly setting completedAt timestamp
- Fix briefing missing user identity for task attribution filtering
- Fix orphaned tool results remaining after context compression
- Fix error bar not clearing after successful message retry
- Fix tasks toggle button position on macOS title bar
- Fix aggressive sourceLink deduplication removing valid links

## [2.8.3] - 2026-05-18

### Features
- Restrict Task feature to PM Studio only

### Improvements
- Convert GitHub skill search to async to unblock the event loop
- Use immer for immutable session cache updates

### Bug Fixes
- Fix reasoning effort selector CSS lost during merge
- Fix uv full path resolution in venv creation on fresh install
- Fix legacy tools not registered in tools Map for FRE setup

## [2.8.2] - 2026-05-17

### Features
- Improve briefing and import task prompt instructions for better task generation quality

### Bug Fixes
- Fix UserTaskManager not being initialized when restoring auth from cache

## [2.8.1] - 2026-05-15

### Features

- **User Tasks: replace tags with customFields and dynamic field definitions**
  - Tasks now support flexible custom fields instead of fixed tags, with agent-configurable field schemas.

## [2.8.0] - 2026-05-15

### Features

- **User Tasks: personal task management with Task Board V2**
  - Full task lifecycle (create/update/delete/list) with time-based sections, inline details, and tag filters.

- **Chat: deferred tool loading via tool_search**
  - Load tools on-demand to reduce initial prompt size and improve response latency.

- **Chat: per-chat reasoning effort selector for Copilot models**
  - Allow users to choose reasoning effort level per conversation.

- **MCP: generic OAuth support for non-Microsoft MCP servers**
  - Enable OAuth authentication flows for third-party MCP server connections.

- **MCP: integrate Agency CLI for M365 MCP servers**
  - One-click setup and management of M365 MCP server instances.

- **ADO: browser auth and work item links**
  - Browser-based Azure DevOps authentication and clickable work item links.

- **Agent: duplicate with independent knowledge and scheduled tasks**
  - Clone agents including their knowledge base and schedules as independent copies.

- **Chat: jump-to-latest floating button during streaming**
  - Show a floating button to scroll back to latest message when scrolled away.

- **Menu: Copy Path option in workspace and generated file menus**
  - Copy file paths from workspace explorer and generated file cards.

- **Scheduler: per-job toggle to disable Teams completion notifications**
  - Opt out of Teams notifications on a per-schedule basis.

- **Teams: react/modify tools, inline image download, and channel reply flattening**
  - Message reactions, editing, image downloads, and flat reply views.

- **Compression: optimize context compression for 1M token models**
  - Reduce unnecessary summarization passes for large-context models.

### Improvements

- **Builtin tools: unified facade for skill/MCP/agent management**
  - Replace 14 legacy tools with 5 unified facade tools for cleaner tool surface.

- **Chat: optimized ChatInput textarea resize and MentionHighlight**
  - Reduce unnecessary re-renders during typing and mention highlighting.

### Bug Fixes

- **Performance: reduce excessive main-process logging causing UI freeze**
  - Throttle high-frequency log writes that blocked the event loop.

- **Models: prevent incomplete remote model list from overwriting local cache**
  - Guard against partial API responses replacing a complete local model list.

- **Token: align estimation with VS Code Copilot and add model correction factors**
  - Fix token count drift with per-model correction multipliers.

- **PM Studio: set default mcp_servers and skills for agent creation**
  - Fix missing defaults when creating new agents in PM Studio brand.

- **Builtin tools: restore legacy tool dispatch for FRE and renderer callers**
  - Fix regression where first-run experience tool calls failed.

- **Scheduler: prevent duplicate resume-catchup runs and disable jobs on agent archive**
  - Stop redundant catch-up passes and respect archived agents.

- **Chat session: exclude scheduler sessions from pagination count**
  - Fix session list pagination counting hidden scheduler sessions.

- **Chat: surface tool limit exceeded error in ErrorBar**
  - Show visible error when tool call limits are hit.

- **Skills: prevent search box from clearing when filter yields zero results**
  - Keep search input intact when no skills match the filter.

- **Renderer: scroll selected model into view when dropdown opens**
  - Fix model selector not showing currently selected model.

### Security

- Bump ip-address, express-rate-limit, axios, hono, fast-xml-builder, fast-uri, mermaid, protobufjs to address known vulnerabilities.

## [2.7.15] - 2026-05-14

### Bug Fixes

- **Performance: reduce excessive main-process logging causing UI freeze**
  - Throttle high-frequency log writes that blocked the main process event loop and froze the UI.

## [2.7.14] - 2026-05-14

### Features

- **User Tasks: Task Board V2 with time-based sections, inline details, and filters**
  - Redesign task board with Today/Upcoming/Overdue sections, inline detail panel, and tag filters.

- **Chat: deferred tool loading via tool_search**
  - Load tools on-demand via search to reduce initial prompt size and improve latency.

- **Chat: per-chat reasoning effort selector for Copilot models**
  - Allow users to choose reasoning effort level per conversation for supported models.

- **MCP: generic OAuth support for non-Microsoft MCP servers**
  - Enable OAuth authentication flows for third-party MCP server connections.

- **ADO: add browser auth and work item links**
  - Support browser-based Azure DevOps authentication and clickable work item links.

- **Agent: duplicate agent with independent knowledge and scheduled tasks**
  - Clone agents including their knowledge base and schedules as independent copies.

### Improvements

- **Builtin tools: unified facade tools for skill/MCP/agent management**
  - Replace 14 legacy tools with 5 unified facade tools for cleaner tool surface.

- **Chat: optimize ChatInput textarea resize and MentionHighlight performance**
  - Reduce unnecessary re-renders during typing and mention highlighting.

- **Chat: extract ChatRenderItem and reorganize message components**
  - Improve code organization for message rendering pipeline.

### Bug Fixes

- **PM Studio: set default mcp_servers and skills for agent creation**
  - Fix missing defaults when creating new agents in PM Studio brand.

- **Builtin tools: restore legacy tool dispatch for FRE and renderer callers**
  - Fix regression where first-run experience and renderer tool calls failed.

- **PM Studio: add default built-in skills when creating project agent**
  - Ensure project agents have expected skill set on creation.

- **Renderer: scroll selected model into view when dropdown opens**
  - Fix model selector not showing the currently selected model in viewport.

### Security

- Bump ip-address, express-rate-limit, axios, hono, fast-xml-builder, fast-uri, mermaid, protobufjs to address known vulnerabilities.

## [2.7.13] - 2026-05-12

### Features

- **Compression: optimize context compression for 1M token models**
  - Improve compression strategies for large-context models to reduce token waste.

- **MCP: integrate Agency CLI for M365 MCP servers**
  - Add Agency CLI manager to bootstrap and manage M365 MCP server instances.

- **User Tasks: add personal task management module with right sidepane UI**
  - Ship a built-in task manager with create/update/delete/list tools and a sidepane view.

- **Chat: add jump-to-latest floating button when scrolled away during streaming**
  - Show a floating button to quickly scroll back to the latest message.

- **Menu: add Copy Path option to workspace and generated file menus**
  - Allow users to copy file paths from workspace explorer and generated file cards.

- **Scheduler: add per-job toggle to disable Teams completion notifications**
  - Let users opt out of Teams notifications on a per-schedule basis.

- **Teams: add react/modify tools, inline image download, and channel reply flattening**
  - Expand Teams integration with message reactions, editing, image downloads, and flat reply views.

- **CI: add per-glob override with allowlist to file length checker**
  - Support granular file length limits via glob-based allowlist overrides.

### Improvements

- **Renderer: extract message rendering state into atoms and ChatSide component**
  - Reduce props drilling by lifting message state into Jotai atoms.

- **Renderer: remove props drilling and replace CustomEvent bridges with atoms**
  - Replace legacy CustomEvent patterns with atom-based state management.

- **Renderer: extract buddy/viewer/skill-dialog state into atoms and normalize naming**
  - Standardize atom file naming (`*.atom.ts`) and centralize UI state.

- **Renderer: extract overlay dialogs into atom-driven components**
  - Move overlay logic out of monolithic layout files into standalone components.

- **Renderer: eliminate props drilling in layout → chat component tree**
  - Simplify component interfaces by removing deeply threaded props.

- **Types: narrow Message type to discriminated union per role**
  - Improve type safety by using discriminated unions for message roles.

### Bug Fixes

- **Models: prevent incomplete remote model list from overwriting local cache**
  - Guard against partial API responses replacing a complete local model list.

- **Token: align token estimation with VS Code Copilot and add model correction factors**
  - Fix token count drift by applying per-model correction multipliers.

- **Scheduler: prevent duplicate resume-catchup runs and disable jobs on agent archive**
  - Stop scheduler from firing redundant catch-up passes and respect archived agents.

- **Chat session: exclude scheduler sessions from pagination count**
  - Fix session list pagination to not count hidden scheduler-owned sessions.

- **Chat: surface tool limit exceeded error in ErrorBar instead of silent failure**
  - Show a visible error when tool call limits are hit rather than failing silently.

- **Skills: prevent search box from clearing when filter yields zero results**
  - Keep search input intact when no skills match the current filter.

### Security

## [2.7.12] - 2026-05-05

### Features

- **Teams Graph tools: enhance reliability and branding suffix**
  - Improve Graph API tool coverage, branding suffix handling, and `list_teams_chats` reliability.

- **Analytics: add TTFT telemetry for chat and LLM API layers**
  - Capture time-to-first-token metrics across the chat pipeline and LLM API layer.

- **Chat: pause auto-scroll when user scrolls up during streaming**
  - Respect user scroll intent and avoid forcing scroll-to-bottom while a response is streaming.

- **Scheduler: notify bound Teams user on job completion**
  - Send Teams notifications to bound users when scheduled jobs finish.

- **PraestoClaw: add Kosmos channel adapter**
  - Introduce the PraestoClaw channel adapter for Kosmos.

- **Hermes & WorkPilot: add platform adapters**
  - Add Hermes and WorkPilot platform adapters to expand external integrations.

- **External agent: unify bot→Kosmos messaging to push model**
  - Standardize external bot-to-Kosmos messaging on a push-based delivery model.

- **Doctor: add in-app self-diagnosis subsystem**
  - Ship an in-app diagnostics surface to help users identify environment and runtime issues.

- **Sub-agent: support multi-model collaboration**
  - Enable sub-agents to collaborate across multiple models within a single workflow.

- **Eval: support multi-turn evaluation**
  - Add multi-turn evaluation support to the evaluation harness.

- **Azure CLI: add built-in execute tool**
  - Add an Azure CLI built-in execute tool gated by a read-only command allowlist.

- **OpenClaw: Kosmos × OpenClaw channel plugin**
  - Add the OpenClaw channel plugin integration for Kosmos.

### Improvements

- **Builtin tools: remove `send_teams_message` feature flag**
  - Promote `send_teams_message` to a default-on capability.

- **Azure CLI: remove feature flag and add read-only command allowlist**
  - Promote the Azure CLI integration to default-on while restricting it to a read-only command allowlist.

- **Renderer: extract `useAvailableModels` hook for shared model loading**
  - Centralize model-loading logic into a shared hook to reduce duplication across renderer surfaces.

- **Build: upgrade to Vite 8 + electron-vite 6 + TypeScript 6**
  - Modernize the build toolchain by upgrading core build dependencies.

- **Imports: remove unused dynamic `import()` and add mixed-import check**
  - Clean up unused dynamic imports and enforce a mixed-import lint check.

- **Build: replace `vite-plugin-monaco-editor` with custom worker plugin**
  - Drop the third-party Monaco plugin in favor of an internal worker plugin.

- **Tests: migrate from Jest to Vitest 4.x**
  - Migrate the test suite from Jest to Vitest 4.x for faster runs and unified tooling.

- **Codebase: replace `uuid` with native `crypto.randomUUID()`**
  - Drop the `uuid` dependency in favor of the platform-native UUID generator.

### Bug Fixes

- **Build: supply preload entries via `lib.entry` for vite build**
  - Fix the preload bundling path so vite picks up the correct entries.

- **Chat: propagate AbortSignal to builtin tools and force idle on cancel**
  - Forward cancellation through to builtin tool execution and ensure chat returns to idle on cancel.

- **Runtime: strip `npm_config_prefix` from subprocess environments**
  - Prevent inherited `npm_config_prefix` from leaking into spawned subprocesses.

- **Chat: clear `messagesToSave` buffer on cancellation and edit-resend**
  - Avoid persisting stale buffered messages after cancel or edit-resend.

- **Debug: redact PII from debug info zip before download**
  - Strip PII from the debug bundle before users download it.

- **Scheduler: recover missed cron ticks**
  - Catch up on cron ticks missed during sleep or process restart.

- **Chat: preserve user message in cache after post-persistence API errors**
  - Keep the user's message available locally if a post-persistence API call fails.

- **Chat: persist partial assistant reply when streaming is cancelled**
  - Save the partial streamed reply when the user cancels mid-stream.

- **Chat: show `present_deliverables` cards with correct existence state**
  - Render deliverable cards using the actual file existence state.

- **Safety: block credential-destructive commands in `ExecuteCommandTool`**
  - Reject credential-destructive shell commands at the execute-command tool boundary.

- **Azure-bot: add missing uuid dependency**
  - Restore the missing `uuid` dependency for the azure-bot package.

- **Tests: use tmpdir for `RuntimeManager` test to avoid stale directory**
  - Isolate the `RuntimeManager` test in a tmpdir to prevent stale-state failures.

- **Logging: preserve unified logger singleton**
  - Ensure the unified logger singleton is preserved across module boundaries.

- **Logging: make manual flush await disk write**
  - Have manual log flushes wait for the disk write to complete.

- **Logging: isolate dev log files**
  - Separate dev log files from production logs to prevent cross-contamination.

- **Address list search filter review**
  - Apply zero-result deselect, scoped persistence, and doc sync to the list search filter.

- **Runtime: wait for internal runtime shims before MCP server connect**
  - Defer MCP server connection until internal runtime shims are ready.

- **Terminal manager: prevent Windows CWD-first resolution from shadowing internal runtime shims**
  - Stop the Windows CWD-first lookup from masking bundled internal runtime shims.

### Security

- **ExecuteCommandTool: block credential-destructive commands**
  - Add a safety check to reject credential-destructive shell commands.

- **Debug bundle: redact PII before download**
  - Sanitize PII from the debug info zip before it leaves the device.

### Documentation

- **AI: document development log harness**
  - Add documentation for the development log harness.

- **Review prompt: require whole-project review context**
  - Update review prompt guidance to require whole-project context.

- **Review prompt: add cross-platform compatibility check for 4 target platforms**
  - Extend the review prompt with a cross-platform compatibility checklist.

- **Review prompt: enhance with logging check, open questions, and PR posting**
  - Add logging checks, open-questions handling, and PR posting steps to the review prompt.

### Others

- **Deps: bump uuid from 11.1.0 to 14.0.0**
  - Bump `uuid` to 14.0.0 prior to its later removal in favor of `crypto.randomUUID()`.

## [2.7.11] - 2026-04-23

### Features

- **Settings: add list search filters across settings surfaces**
  - Add a reusable search box and wire filtering into Settings and Agent Settings list views for faster navigation.

- **PM Studio: add Agent Library entry from project agent creation**
  - Expose the Agent Library from the PM Project Agent creation flow so users can start from existing agent templates.

### Improvements

- **Repository workflow: tighten review and git automation prompts**
  - Refine repository prompt guidance for code review, git workflow, and release automation consistency.

- **Dependencies: refresh development axios version**
  - Bump the development axios dependency from 1.13.5 to 1.15.1.

### Bug Fixes

- **Agent settings: avoid render-phase route updates during editing**
  - Prevent route mutations from firing during render in the agent settings editing flow to eliminate the React warning fixed by `#554`.

- **Buddy: gate the buddy UI behind its feature flag**
  - Prevent buddy entry points from appearing when `kosmosFeatureBuddy` is disabled.

- **Layout: stop right-panel clipping outside the app window**
  - Remove the `overflow: unset` behavior that allowed the right-side panel to render beyond the window bounds.

- **Buddy roster: refresh cards after rename**
  - Reload roster state after a buddy rename so collection cards update immediately.

- **Chat context: use structured token counting for image messages**
  - Fix image message token accounting to use the structured counting path.

- **Authentication: unblock sign-in from scheduler cold-start work**
  - Keep sign-in responsive by moving scheduler cold-start catch-up off the critical authentication path.

### Security

- No security-only commits were included in this release window.

### Documentation

- **Architecture notes: document the signing-hang and content-overflow regressions**
  - Add postmortems and prompt documentation updates to capture recent renderer and startup lessons.

### Others

- **Tests: add regression coverage for auth concurrency, buddy flag gating, and agent library navigation**
  - Expand targeted regression tests around the release-window fixes and UI entry-point changes.

## [2.7.10] - 2026-04-20

### Features

- **Plugin system: add Claude Code-compatible plugin support**
  - Introduce a Claude Code-compatible plugin system to expand external integration options.

- **Chat workflows: enhance session forking and terminal execution handling**
  - Improve chat session forking flows and terminal command execution behavior for interactive workflows.

### Improvements

- **Chat input: continue modularization and state separation groundwork**
  - Extract ChatInput sub-components and move shared state handling onto atom-based primitives for clearer ownership.

- **Layout: split app shell into smaller stateful units**
  - Extract `AppLayoutContent`, `UserMenu`, and left-sidebar state atoms to reduce renderer component complexity.

- **Browser control: reorganize project paths and oversized modules**
  - Rename browser control subproject paths and split large browser-control modules into smaller units.

- **LLM flow: refocus system prompt polishing behavior**
  - Refine the system prompt polishing flow to better match the intended LLM editing path.

### Bug Fixes

- **Security: remove unused open-browser IPC path with command-injection risk**
  - Delete the unused `openBrowserUrl` IPC handler to eliminate an avoidable command injection surface.

- **Agent editor: restore multiline system prompt tips**
  - Fix the agent editor so multiline system prompt tips render again as expected.

- **Chat: improve message handling and inline compose-state isolation**
  - Tighten chat message state handling and restore isolation between concurrent compose surfaces.

### Security

- No additional security-only commits were included beyond the IPC hardening fix listed above.

## [2.7.9] - 2026-04-17

### Features

- **Browser control: add Kosmos browser automation subproject**
  - Add the `Kosmos-browser-control` subproject and related browser automation assets for the broader control workflow.
- **Buddy: replace slash command entry with an egg icon entry point**
  - Update the Buddy entry flow to use the new icon-based launch point instead of the `/buddy` command.
- **Coding agent: add foreground mode with streaming CLI output**
  - Introduce foreground execution mode so coding-agent CLI output streams directly while the task is running.
- **Inline preview: improve readability and panel behavior**
  - Fix bullet rendering, increase font sizes, add panel resizing, and remove duplicate button behavior issues.
- **Teams: extend chat listing metadata and max result cap**
  - Add truncation metadata to `list_teams_chats` and raise the maximum results cap for larger result sets.

### Improvements

- **Build and UI: refresh shared dependencies and styling foundations**
  - Update multiple build dependencies, upgrade renderer Tailwind CSS to v4, and refine settings and chat styling details.
- **Preload and build: continue modularization and typecheck hardening**
  - Isolate preload scripts under `src/preload`, modernize TypeScript configuration, and add typecheck CI coverage.
- **Dashboard analytics: rename last-7d ranking queries**
  - Rename dashboard query assets for clearer ranking-oriented semantics.

### Bug Fixes

- **Chat and LLM: fix tool-result cleanup and GPT-5 token parameters**
  - Remove orphaned tool results that could trigger 400 errors and use `max_completion_tokens` for GPT-5 and o-series models.
- **Electron compatibility: upgrade better-sqlite3 for Electron 39**
  - Update `better-sqlite3` to v12 to restore compatibility with the newer Electron runtime.
- **CI tests: harden mocks for IPC and agent chat output coverage**
  - Fix CI instability by adding the missing `isDestroyed` mock and allowlisting `ipc/index.ts` in test coverage.

### Security

### Documentation

- No documentation-only commits were included in this release window.

### Others

- **Repository maintenance: align maintain access and code owners**
  - Keep repository ACL and ownership settings aligned for maintainers.
- **Repository hygiene: remove trailing whitespace**
  - Apply a small cleanup commit to remove leftover trailing whitespace.

## [2.7.8] - 2026-04-10

### Features

- **Memex: add per-agent memory isolation support**
  - Introduce per-agent Memex memory handling to keep memory context scoped by agent.

### Improvements

- **CI: remove temporary baseline validation test artifact**
  - Revert the temporary dummy test baseline change to keep the test suite clean.

### Bug Fixes

- **Chat: exclude scheduled sessions from agent list search**
  - Prevent scheduled sessions from appearing in agent list and conversation search results.
- **Memex: harden feature flag gating across process boundaries**
  - Tighten feature flag checks in main and renderer paths to avoid inconsistent Memex activation.

### Security

## [2.7.7] - 2026-04-10

### Features

- **Browser auth: prefer external Edge login for Teams flows**
  - Add an external-Edge-first visible login path and tighten related chat request visibility for Teams authentication scenarios.
- **Chat: surface scheduled sessions in sidebar search and lists**
  - Make scheduled sessions easier to discover from the sidebar and search results.
- **Diagnostics: add log query tool and AI prompt documentation**
  - Introduce a log query tool and the supporting AI prompt documentation for troubleshooting workflows.
- **Evaluation: support eval endpoint for the agentic evaluation system**
  - Extend the evaluation path to support the dedicated Agentic eval endpoint.

### Improvements

- **Vite: accelerate development cold starts**
  - Improve local startup performance with SWC, dependency pre-optimization, and warmup tuning.
- **Chat: remove legacy Teams mention flow from chat input**
  - Simplify chat input behavior by fully removing the old Teams-chat mention entry path.

### Bug Fixes

- **Chat: harden interactive input fallback behavior**
  - Improve selection fallback semantics, keep say-hi visibility aligned, and interrupt interactive requests correctly during cancellation.
- **Browser auth: stabilize visible Teams login behavior**
  - Fix visible-login handling so browser authentication consistently prefers the intended external Edge flow.
- **Chat: keep scheduled runtime and session status snapshots in sync**
  - Fix mismatches between scheduled runtime state, session rename updates, and surfaced chat status.
- **MCP: tighten Teams chat search filtering**
  - Filter Teams chat results more defensively so only valid matches are surfaced.
- **Skill IPC: harden Windows skill artifact selection**
  - Fix a Windows regression in skill artifact picking.
- **Remote channel: fall back when Mermaid content is unsupported in Teams**
  - Replace unsupported Mermaid rendering with a fallback notice for Teams surfaces.
- **Skills: split device skill import entry points**
  - Fix device skill loading by separating import entry points.
- **Chat: emphasize agent names instead of unread badges**
  - Replace the unread badge signal with name emphasis to avoid misleading session state.

### Documentation

- **Dashboard: add alias lists to user query documentation**
  - Expand dashboard docs with alias list coverage for user queries.
- **Prompts: align Teams briefing workflow with the project-focused flow**
  - Update prompt docs so the Teams and Outlook briefing flow matches the current scheduling experience.

### Security

## [2.7.6] - 2026-04-09

### Features

- **Scheduler: move briefing setup into schedule templates**
  - Move briefing configuration into reusable schedule templates so recurring briefing setup follows the scheduler flow directly.
- **Chat: persist API token usage and model on assistant messages**
  - Store assistant response token usage and resolved model metadata with messages for later inspection and analytics.
- **Compression: add bounded concurrent chunk summaries**
  - Add concurrent chunk summarization with explicit bounds to improve long-context compression throughput safely.

### Improvements

- **Workspace: remove Connected Knowledge Sources panel from the sidepane**
  - Simplify the workspace sidepane by removing the Connected Knowledge Sources panel from that surface.

### Bug Fixes

- **Chat: enforce non-interactive scheduled runs**
  - Prevent scheduled runs from falling back into interactive execution paths.
- **Chat: keep session initialization non-blocking**
  - Avoid blocking chat startup while session initialization work is still completing.
- **Chat: harden context compression and overflow recovery**
  - Improve compression fallback handling so overflow recovery remains stable under large payloads.
- **Chat: keep inline edit failures in the error bar flow**
  - Preserve inline edit failure reporting in the dedicated error bar channel instead of leaking into normal chat output.

### Documentation

- **Prompts: remove agent settings from briefing workflows**
  - Clean up briefing workflow prompt docs by removing obsolete agent settings guidance.

### Security

## [2.7.5] - 2026-04-08

### Features

- **Attachments: expand MIME type coverage for remote file attachments**
  - Add broader MIME detection so more remote file types can be attached and processed correctly.

### Improvements

- **Chat: harden tool replay sanitization**
  - Tighten replay sanitization for restored tool outputs to keep follow-up turns consistent.

### Bug Fixes

- **Build: harden Windows ARM64 sharp packaging and split release jobs by architecture**
  - Fix Windows ARM64 packaging reliability for `sharp` and separate release jobs by target architecture.
- **Chat: unify unread badge state handling**
  - Fix inconsistent unread badge state transitions in chat surfaces.
- **Renderer: correct builtin agent dropdown anchoring**
  - Fix the builtin agent menu anchor so dropdown positioning stays aligned.
- **Agent menu: allow duplicate for all agent types**
  - Restore duplicate-agent support across all agent types.
- **Scheduler: gate manual run navigation on session readiness**
  - Prevent manual-run navigation from opening before the target session is ready.

### Security

### Documentation

- **Commands: update webpack development command docs**
  - Refresh the documented Webpack development commands to match the current workflow.

## [2.7.4] - 2026-04-08

### Features

- **Process management: async background process execution and manage_process tool**
  - Add support for executing long-running background processes and a new `manage_process` tool for lifecycle management.
- **CI: add file-length enforcement pipeline and pre-commit hook**
  - Introduce automated file-length checks in CI and a pre-commit hook to prevent oversized files from being committed.

### Improvements

- **Scheduler: remove global schedules settings page**
  - Simplify the scheduler UI by removing the standalone global schedules settings page in favor of per-agent schedule management.

### Bug Fixes

- **Agent page: harden startup primary agent selection**
  - Fix edge cases in primary agent selection during startup to prevent blank or incorrect agent being shown.
- **Agent page: restore primary agent startup session routing**
  - Ensure the correct chat session is loaded when navigating to the primary agent on startup.
- **Knowledge base: harden file tree refresh and navigation recovery**
  - Fix file tree refresh and navigation recovery to prevent stale or broken tree states.
- **Scheduler: add end-to-end scheduler tracing**
  - Improve scheduler observability with full tracing from trigger to execution.
- **Chat: enforce idle-only send boundaries**
  - Prevent message submission while the chat engine is still processing a prior turn.
- **Chat: prevent stale tool result replay after cancellation**
  - Fix an issue where cancelled tool results could replay on subsequent turns.
- **Scheduler: correct schedule tool card navigation**
  - Fix navigation from schedule tool cards to point to the correct schedule detail.
- **Teams: improve pastHours recall for chat listing and search**
  - Widen the recall window for Teams chat listing and search to surface more relevant conversations.
- **Teams: limit selector chats to recent weekly activity**
  - Restrict the Teams chat selector to show only chats with recent weekly activity for a cleaner list.
- **Scheduler: recover missed cron runs after cold starts and enrich crash diagnostics**
  - Catch up on skipped cron executions after app restarts and add richer crash diagnostic data.
- **Tests: mock process.platform and RuntimeManager for CI compatibility**
  - Fix test failures on CI by properly mocking platform-specific modules.

### Security

- **Dependencies: bump picomatch and vite for security patches**
  - Update `picomatch` and `vite` to address known vulnerabilities.

## [2.7.3] - 2026-04-06

### Features

- **Agent defaults: bootstrap built-in tools and skills for custom agents**
  - Add default built-in tools and skills for newly created custom agents and introduce a versioned migration path so existing agents can receive the same baseline safely.
- **Chat: add code-block copy actions in assistant messages**
  - Add copy buttons to rendered code blocks so users can copy generated code directly from chat responses.
- **Remote collaboration: support sending files to the Teams bot flow**
  - Extend the remote control workflow to send files through the Teams bot path for collaboration scenarios.

### Improvements

- **Architecture: continue modularization of startup, chat, and profile flows**
  - Split `main.ts` into dedicated IPC and startup modules, extract AgentChat into focused service layers, finalize manager and facade decomposition, and break the profile cache manager into smaller cohesive modules.
- **Dependencies and runtime: refresh core packages for security and platform alignment**
  - Update Electron and multiple runtime and build dependencies including `convict`, `path-to-regexp`, `serialize-javascript`, `terser-webpack-plugin`, `lodash`, `handlebars`, and `brace-expansion`.
- **Builtin tools: retire deprecated Google search built-ins**
  - Deprecate and unregister legacy Google web and image search builtin tools to keep the default tool catalog aligned with current support.

### Bug Fixes

- **Profile migration: restore regressed agent knowledge delivery directories**
  - Add Migration V2 to re-normalize agent knowledge state and recover delivery-directory data that could regress after prior profile changes.
- **Chat: surface schedule cards in assistant responses again**
  - Restore schedule card rendering in assistant messages so scheduling-related outputs remain visible in chat.
- **Tests: harden the renderer Jest environment**
  - Fix renderer test-environment instability to improve local and CI validation reliability.

### Documentation

- **Review workflow: add a dedicated code-review prompt guide**
  - Document repository code-review guidance in the dedicated prompt file to keep review expectations explicit for contributors and agents.

### Others

- **Security and maintenance: keep release dependencies current without functional API changes**
  - Include dependency maintenance commits and non-conventional maintenance work that support this patch release without introducing breaking changes.

### Security

## [2.7.2] - 2026-04-04

### Features

- **Microsoft Graph: align Teams auth-mode routing across tool flows**
  - Route Teams chat listing, reading, and send-message flows through the updated auth-mode client selection path so Microsoft Graph access stays consistent across Teams tooling.

### Improvements

- **Office file reading: handle encrypted Office documents more robustly**
  - Extend Office document extraction and XML parsing so encrypted or protected SharePoint and local Office files degrade more gracefully and recover more readable content.

### Bug Fixes

- **MCP: correct consent-dialog routing and auth dismissal handling**
  - Fix consent dialog routing so interactive authentication stays on the right path and dismissed consent flows return the correct state.
- **Chat: suppress duplicate notifications after session refocus**
  - Prevent chat notifications from re-firing when a session regains focus, reducing noisy notification behavior during active use.
- **Microsoft Graph: persist browser auth cache and restore region fallback**
  - Keep browser authentication cache state across runs and restore region fallback handling so Microsoft Graph sign-in is more reliable after restarts and partial auth failures.

### Security

## [2.7.1] - 2026-04-03

### Features

- **Skills: expand builtin document and design capabilities**
  - Add builtin `docx`, `pptx`, and `frontend-design` skills so agents can cover more document-processing and UI-design workflows out of the box.
- **Agent: add prompt-driven briefing setup**
  - Introduce a prompt-based briefing setup flow to streamline agent briefing configuration.
- **Teams: add chat type filtering to the listing workflow**
  - Add chat type filtering support to the Teams listing tool so agent flows can target narrower collaboration scopes.

### Improvements

- **Teams: route selector IPC through the builtin listing tool**
  - Refactor selector IPC handling to reuse the builtin Teams listing path and keep the selection flow more consistent.

### Bug Fixes

### Others

- **Teams: add coverage for chat type filtering behavior**
  - Add test coverage for Teams chat type filtering to protect the new filtering workflow.

### Security

## [2.7.0] - 2026-04-03

### Features

- **Teams and Outlook: expand agent knowledge sources and scheduling workflows**
  - Add Teams and Outlook data-source selection, briefing scheduling support, and @mention-aware chat flows for agent knowledge and collaboration scenarios.
- **Logging: introduce a unified logger pipeline with dev-mode capture**
  - Add the unified logger system, DevLogger integration, and renderer log capture to improve diagnostics across development and runtime flows.
- **Sync: enrich commit metadata and push controls**
  - Include device identifiers in sync commit messages and add conditional commit support during sync pushes.

### Improvements

- **Architecture: continue the ESM migration and sync IPC modularization**
  - Move more runtime code from CommonJS-style imports to ESM syntax and extract sync IPC handlers into a dedicated module with merge support.
- **Build and tooling: align the app with the Vite-based packaging path**
  - Enable build and pack flows through the Vite system and modernize the linting stack around the ESLint v9 flat config.
- **Chat: simplify tool-result image handling**
  - Remove the first-pass compression step from tool-result image injection to reduce unnecessary processing in agent chat flows.

### Bug Fixes

- **Teams: restore message delivery when redirects downgrade the request method**
  - Fix Teams send-message failures caused by redirect handling that changed the HTTP method unexpectedly.
- **Logging: harden structured log capture and file output**
  - Fix IPC log forwarding, argument ordering, object serialization, and mojibake issues so logs remain readable and complete.
- **App startup and tests: improve renderer bootstrap and CI stability**
  - Add retry logic for development `loadURL` startup and replace timing-based E2E waits with more robust synchronization patterns.
- **Identifiers and text capture: normalize IDs and recover encoded selections**
  - Unify scheduler, chat, and session ID formats and recover CJK text that was previously corrupted during selection-hook decoding.

### Documentation

- **Release and development workflow docs: keep tooling guidance aligned**
  - Refresh repository guidance alongside the build, lint, logging, and collaboration workflow changes included in this release.

### Others

- **Runtime and lint housekeeping: reduce obsolete local tooling**
  - Disable the remote-control interactive UI path and remove outdated local formatting and hook setup where the new build and lint flow no longer depends on them.

### Security

## [1.29.1] - 2026-03-30

### Features

### Improvements

### Bug Fixes

- **MCP: switch online Microsoft sign-in to external browser flow only**
  - Remove native broker usage from the MCP interactive authentication path, keep the browser loopback flow as the default, and align the related runtime documentation and tests.

### Security

## [1.29.0] - 2026-03-30

### Features

- **Browser Control: add CDP mode selection and exclusivity safeguards**
  - Add a CDP browser-control mode with a mode selector and mutual-exclusion handling so incompatible control paths cannot be enabled at the same time.

### Improvements

- **Interactive Requests: unify structured input control schema**
  - Refactor chat interaction request handling so structured user-input controls share one schema and a more consistent rendering path.
- **Chat: add structured input cards for interactive request flows**
  - Consolidate chat interaction requests around structured input cards to improve consistency across follow-up prompts and responses.

### Bug Fixes

- **MCP: add online OAuth authentication flow support**
  - Fix MCP authentication flows by supporting online OAuth consent and callback handling in the chat experience.
- **Chat: improve interactive authentication command flow**
  - Make interactive auth command execution clearer and more resilient during multi-step consent flows.
- **Chat: refine inline edit confirmation behavior**
  - Fix inline-edit confirmation behavior so message edits feel more predictable and less error-prone.
- **Chat: stabilize latest-message scroll restoration on session switches**
  - Preserve the latest scroll position more reliably when changing between chat sessions.
- **Chat: improve execute-command interactive feedback**
  - Improve status and progress feedback for interactive execute-command runs so users can better track in-flight actions.

### Others

- **Release: prepare version 1.29.0 artifacts**
  - Bump application metadata and lockfile state for the 1.29.0 release.

### Security

## [1.28.1] - 2026-03-27

### Features

### Improvements

### Bug Fixes

- **Debug: include profile schedules in debug exports**
  - Extend the debug export payload so profile schedule data is included for diagnostics and support workflows.
- **Chat: restore user message action alignment**
  - Fix the chat action layout so user message controls align correctly again in the conversation view.

### Security

## [1.28.0] - 2026-03-26

### Features

- **Skills: expand discovery, installation, and removal flows**
  - Add `search_skills`, public skill registration, globally installed skill discovery, ClawHub as a fourth search source, and uninstall and agent-removal workflows with unified activation behavior.
- **Sync: improve external knowledge-base onboarding**
  - Detect external knowledge bases before sync push, copy them into the managed workspace, and add sync auto-setup workflow coverage.
- **Chat: refresh skill snapshots and add developer file-path actions**
  - Refresh next-turn skill snapshots in chat flows and add a dev-only action for copying file paths from chat sessions.
- **Layout: add draggable left sidebar resizing** (#326)
  - Let users resize the left sidebar within guarded width bounds for a more flexible workspace layout.
- **Azure Bot and CI: extend deployment and health-check support**
  - Add Azure Bot deployment workflow support and ARM-based health checks for the Azure Bot service.

### Improvements

- **Skills: simplify the builtin tool surface and acquisition pipeline**
  - Consolidate legacy skill install tools, normalize builtin tool naming, and remove obsolete device-import and unapplied-skill flows.
- **Skills: replace GitHub tree indexing with ZIP extraction**
  - Switch remote skill content acquisition to ZIP download and JSZip extraction to reduce API coupling and improve reliability.
- **Build and dependencies: modernize project infrastructure**
  - Initialize the Vite compile system and refresh packaged and development dependencies including `fast-xml-parser`, `@aws-sdk/xml-builder`, `flatted`, and `picomatch`.
- **UI and remote control: refine supporting workflows**
  - Improve Mermaid viewing behavior and continue streamlining remote-control Teams app generation and bind and unbind flows.

### Bug Fixes

- **Models: restore Gemini model visibility in the selector**
  - Fix Gemini model availability in the model picker and standardize related logging.
- **Chat: resolve layout, overlay, and file-flow regressions**
  - Fix narrow assistant-message clipping, stabilize mention overlay positioning and menu coverage, and unify generated-file-card and knowledge-base move behavior.
- **Preview: harden file overwrite handling**
  - Fix file-save overwrite behavior and improve the corresponding user feedback.
- **Skills: validate installed artifacts more strictly**
  - Restore the settings-driven install flow and reject invalid skill artifact states earlier.
- **Remote Channel: recover Teams binding state after reconnects**
  - Improve reconnection handling for Teams bindings after remote-channel interruptions.
- **Scheduler and MCP: improve release readiness diagnostics**
  - Add startup diagnostics for schedule registration and smoke coverage for builtin tool execution paths.

### Documentation

- **Skills: update search-source and installation guidance**
  - Clarify search source labels and remove outdated `install_skill_for_current_agent` references from technical documentation.

### Others

- **Testing and access control: keep release support files aligned**
  - Add search-skills unit coverage and update repository access and collaborator assignment records.

### Security

## [1.27.1] - 2026-03-23

### Features

### Improvements

### Bug Fixes

- **Release Build: restore native binary install fallbacks for shared npm config**
  - Add Sharp mirror configuration and prebuilt-binary preferences back to the shared npm configuration to reduce source-build failures during release preparation and packaging.

### Security

## [1.27.0] - 2026-03-22

### Features

- **Chat: add session starring, search, and safe message editing workflows**
  - Introduce starred chat sessions, sidebar search, latest-message regeneration, and guarded historical message editing controls.
- **Analytics: expand chat and skill usage telemetry**
  - Track daily chat session activations along with skill installation and invocation events.
- **Browser Control: add native server update detection and in-place update UI** (#308)
  - Surface native server update availability directly in the app and guide users through in-place updates.

### Improvements

- **Remote Channel Settings: refine Teams pairing layout and copy** (#310)
  - Align the remote-channel settings UI with the unified card layout and simplify the Teams configuration flow.
- **Chat UI: polish menus and message action styling**
  - Unify adaptive dropdown sizing and positioning and align message action controls with the chat session visual system.

### Bug Fixes

- **Remote Channel: harden Teams pairing recovery and environment-driven relay configuration**
  - Clean up stale bindings, add recovery mode for pairing errors, auto-save bound-agent selection, and manage the relay URL from environment settings.
- **Feature Flags: enable the remote channel in production by default**
  - Ensure production builds expose the remote channel without manual flag overrides.
- **Chat: stabilize activity, cancellation, notifications, and session navigation behavior**
  - Improve activity-slot rendering, stop active tool executions immediately on cancel, keep blurred-session notifications accurate, and scroll searched sessions into view reliably.
- **MCP: improve connection failure feedback**
  - Make MCP connection failure toasts clearer and more actionable.

### Documentation

- **Analytics: add dashboard and telemetry query documentation**
  - Document top-50 analytics queries, daily alias usage, engaged-user metrics, and chat session activation telemetry.

### Security

## [1.26.9] - 2026-03-19

### Features

### Improvements

- **Dependencies: bump `fast-xml-parser` and `@aws-sdk/xml-builder`** (#304)
  - Refresh XML parsing and AWS XML builder dependencies in the packaged app.

### Bug Fixes

- **Scheduler: improve schedule error reporting and notice copy**
  - Clarify scheduler failure messages and refine the user-facing notice text.

### Security

## [1.26.8] - 2026-03-19

### Features
- **Debug: add crash capture and debug export workflow**
  - Add a dedicated crash-capture path and export tooling to improve field diagnostics
- **Scheduler: add on-demand schedule runs** (#303)
  - Let users manually trigger scheduled sessions without waiting for the next cron execution
- **Scheduler: support multi-time daily schedules in the UI** (#301)
  - Expand schedule configuration to support multiple execution times in a single day
- **Chat: add inline file preview panel** (#298)
  - Show attached file content in a side panel without leaving the conversation flow
- **Remote Control: add typing indicator and `.skill` command for Teams remote sessions** (#299)
  - Improve the Teams remote-session experience with better presence feedback and command support

### Improvements
- **Chat: add overlay scrollbar for the chat session list on hover** (#307)
  - Refine chat list usability while keeping the idle layout visually clean
- **Remote Control: split test and production environments** (#306)
  - Separate remote-control environments more clearly for safer configuration and deployment handling

### Bug Fixes
- **Chat: prefer markdown links for external URLs**
  - Keep external links consistently formatted in markdown output
- **Workspace: improve knowledge base import feedback and conflict handling**
  - Clarify import results and handle duplicate or conflicting content more reliably
- **Scheduler: recover recent missed cron runs after resume**
  - Catch up recent runs after the app resumes instead of silently skipping them
- **Chat Sessions: refresh imported sessions in the agent list**
  - Update the session list immediately after imports complete
- **Chat: import a single session JSON file and auto-open the imported chat**
  - Streamline single-session import flows by opening the restored chat directly
- **First Run Experience: refresh PM Studio onboarding video downloads**
  - Fix stale onboarding media so the latest PM Studio assets are used
- **Runtime: fix native server version reading and bump the extension to 1.1.0** (#302)
  - Correct runtime version detection used by the native server integration
- **E2E: replace dynamic `require('electron')` usage in test fixtures** (#300)
  - Stabilize Electron test fixtures by using the supported import pattern
- **Chat: prevent table content from overflowing the right edge** (#295)
  - Keep wide table output readable within the chat viewport

### Others
- **Access Control: grant repository write access to additional maintainers**
  - Update ACL entries for repository collaborators

### Security

## [1.26.7] - 2026-03-18

### Features
- **Microsoft 365: add persistent auth approval and app-level auth mode settings**
  - Let users persist browser-auth approval preferences and configure Microsoft 365 auth behavior at the app level

### Improvements
- **Performance: make sync status checks on demand on the settings page** (#285)
  - Reduce unnecessary work when opening settings and improve perceived responsiveness
- **Main Process: extract IPC handlers from `main.ts`** (#286)
  - Continue modularizing Electron main-process wiring to keep startup and maintenance costs under control
- **Release: align the prepare-release script with the English changelog format**
  - Keep automated release preparation compatible with the current changelog structure

### Bug Fixes
- **Chat: skip truncated tool calls before execution** (#297)
  - Prevent incomplete tool-call payloads from being executed during chat processing
- **Chat: sanitize malformed tool-call arguments during history replay** (#296)
  - Make restored conversations more resilient when replaying invalid serialized tool arguments
- **Chat: correct Responses API image input formatting** (#294)
  - Fix image payload construction for responses-based multimodal requests
- **MCP: surface transport startup failures during initialization** (#293)
  - Expose startup errors earlier when MCP transports fail to initialize
- **Terminal Manager: bypass internal Node shims for Windows ARM MCP servers** (#292)
  - Improve compatibility for MCP servers launched on Windows ARM environments
- **Settings: refine Microsoft 365 authorization copy**
  - Clarify user-facing authorization messaging in settings flows
- **Microsoft Graph: add token lifetime diagnostics for browser auth**
  - Improve diagnostics around token reuse and expiration handling
- **Microsoft Graph: enforce full browser auth readiness before cache reuse**
  - Avoid reusing cached auth state before the browser-auth flow is fully ready
- **Tests: fix `SubAgentToolCallView` coverage for the required `executionStatus` prop** (#290)
  - Keep the test suite aligned with the updated tool-call view contract

### Documentation
- **Azure Bot: add a production deployment guide** (#291)
  - Document the production deployment path for the Azure bot integration
- **Dashboard: add PM Studio DAU and engaged-user queries**
  - Capture reusable dashboard queries for PM Studio usage reporting
- **Dashboard: add engaged-user dashboard queries**
  - Expand internal analytics documentation for engaged-user reporting

### Security

## [1.26.6] - 2026-03-16

### Features
- **Remote Control: add multi-brand support** (#284)
  - Support brand-specific remote channel behavior and Teams app assets across Kosmos and PM Studio

### Improvements
- **Testing: add PR unit test workflow and fix test mock paths** (#269)
  - Introduce pull request unit test automation and align mocked module paths for CI reliability
- **Access Control: grant repository write access for `chfen`**
  - Update the repository ACL configuration for the additional maintainer

### Bug Fixes
- **Chat: improve interrupted tool call recovery in persisted sessions** (#288)
  - Keep interrupted tool call state handling consistent when reopening existing chat sessions
- **Schedule: allow opening scheduled sessions during execution** (#287)
  - Let users open a scheduled session while its run is still in progress
- **Scheduled Sessions: correct interrupted run status in the side pane** (#289)
  - Prevent interrupted scheduled chat sessions from appearing as if they are still running

## [1.26.5] - 2026-03-15

### Improvements
- **Dependencies: bump `flatted` from `3.3.3` to `3.4.1`** (#273)
  - Update the development dependency to the latest patched release

### Bug Fixes
- **MCP: improve VS Code MCP config discovery** (#283)
  - Make VS Code MCP configuration detection more reliable across supported locations
- **Chat: make ChatInput auto-expand from 3 to 8 lines** (#282)
  - Grow the input area more naturally for longer prompts without forcing early scrolling
- **Chat: add cross-platform multiline input shortcuts** (#281)
  - Align multiline compose behavior across macOS and other desktop platforms
- **Chat: preserve multiline message formatting** (#280)
  - Keep user-entered line breaks intact when sending chat messages
- **M365 Auth: prevent duplicate authentication dialogs** (#279)
  - Avoid opening repeated Microsoft 365 sign-in prompts during auth flows
- **PM Project Agent: keep the workspace side pane closed for new chats** (#278)
  - Preserve the expected side pane state when starting a fresh project-agent chat
- **Agent Library: route installed agents to a new chat** (#277)
  - Send users directly into a new chat after installing an agent from the library
- **Agent: restore custom-agent back navigation to new chat** (#276)
  - Fix the back-navigation flow after entering custom agent settings
- **Chat Sidebar: align session list scroll loading feedback** (#275)
  - Keep loading feedback consistent with the session list scroll behavior
- **Settings: add a macOS title bar spacer on the settings page** (#274)
  - Prevent controls from colliding with native macOS traffic lights

### Documentation
- **Microsoft Graph: clarify the current auth architecture and client paths**
  - Document the updated M365 authentication flow and the relevant code locations

## [1.26.4] - 2026-03-13

### Features
- **Analytics: add user behavior tracking metrics** (#271)
  - Record additional behavior telemetry to improve analytics coverage
- **M365 Teams: add direct chat target resolution support**
  - Resolve Teams chat targets more reliably for agent-driven message workflows
- **Browser Control: auto-restart the browser during enable when already running** (#268)
  - Recover more cleanly when browser control is enabled while the browser is already open
- **Profile Sync: add cross-OS path portability support** (#262)
  - Normalize profile workspace paths so synced profiles move cleanly across operating systems

### Improvements
- **Dependencies: bump `tar` from `7.5.10` to `7.5.11`** (#251)
  - Pull in the latest dependency update for the packaged application

### Bug Fixes
- **Auth: raise the M365 consent dialog above the auth overlay** (#272)
  - Keep the consent prompt visible and actionable during sign-in
- **macOS: fix sidebar toggle alignment with native traffic lights on zoom and fullscreen** (#270)
  - Preserve correct layout alignment across native window states
- **M365 Auth: serialize browser authentication across resource flows**
  - Prevent concurrent browser auth flows from racing each other
- **M365 Teams: improve direct chat lookup and development send gating**
  - Tighten direct chat resolution and restrict development-only send behavior

## [1.26.3] - 2026-03-13

### Bug Fixes
- **M365 Auth: fix BrowserAuthProvider Skype token typing for webpack builds**
  - Type the cached Skype API token as `string | null` so the rejected-token path can clear it safely
  - Resolve the TypeScript nullability compile failure in the browser auth flow

## [1.26.2] - 2026-03-13

### Features
- **M365 Auth: add a user consent dialog before browser authorization** (#267)
  - Prompt users for explicit consent before starting browser-based M365 access
  - Update the consent dialog copy to English for a consistent localized experience
- **M365 Teams: align chatsvc tools with the agent workflow**
  - Add chatsvc-based unread filtering, chat lookup, local search, and self-chat resolution
  - Expose `send_teams_message` and improve Teams chat tool schemas, outputs, and calendar range handling
- **Analytics: attach `userAlias` to telemetry events** (#264)
  - Persist the last known alias so startup telemetry can include it automatically

### Bug Fixes
- **Playwright: harden browser install and recovery flows across packaged app and search tools**
  - Improve bundled CLI fallback behavior, cache lock cleanup, and install retry handling
  - Route web and image search tools through the managed Playwright launcher to recover from stale browser installs
- **Startup: prevent auth and profile sync deadlocks on first launch**
  - Reorder auth/profile initialization and add renderer fallback hydration for missed profile pushes
- **Chat: reduce MCP image payload bloat during automatic injection**
  - Strip raw base64 payloads, deduplicate repeated tool images, and compress screenshots more aggressively before vision injection
- **Notifications: fix app branding on Windows and macOS** (#265)
  - Use branded app identifiers and titles so notifications show the correct sender name
- **PM Agent: refine project agent card copy**
  - Update onboarding wording to better match the project-focused PM agent creation flow

### Security
- **M365 Teams: harden send-message authentication and disable the send tool by default**
  - Validate browser Teams tokens against the active Kosmos user across related auth flows
  - Verify sent-message delivery by immediate chat readback before reporting success
  - Gate `send_teams_message` behind a dedicated feature flag that is disabled by default

### Others
- **Testing: add Playwright runtime validation scripts and focused Teams/M365 regression coverage**
  - Add internal node and Bun/Playwright diagnostic scripts plus regression tests for Teams account matching, self-chat detection, and send verification

## [1.26.1] - 2026-03-12

### Features
- **Azure Bot: migrate persistence from local JSON files to Redis** (#260)
  - Replace local file-based storage with Redis-backed persistence for bot data
- **Layout: add cross-platform sidebar toggle with native macOS title bar integration** (#259)
  - Persist window layout state across sessions
- **Chat: enhance say-hi onboarding with cards and streamlined knowledge base actions** (#261)
  - Improve greeting interactions and simplify onboarding-related actions

### Improvements
- **Chat: unify greeting configuration and refine onboarding behavior** (#263)
  - Consolidate say-hi configuration flows for a more consistent first-run experience

### Bug Fixes
- **Project Agent Creation: keep sidebar expanded after agent creation**
  - Preserve sidebar visibility after completing the project agent creation flow

### Security

## [1.26.0] - 2026-03-11

### Features
- **Schedules: Complete scheduler rollout and management flow**
  - Enable scheduler in production through feature flags
  - Add empty state actions for schedule views
  - Support schedule persistence, editing flow, and terminology unification
  - Auto-open the schedules side pane from related notifications
- **Chat: Expand scheduled session awareness and notifications**
  - Add unread badge and unread summary pipeline for scheduled sessions
  - Add system notifications for background session completion
- **Remote Channel: Extend agent and remote control capabilities**
  - Add connection secret auth and security hardening
  - Add `.agent` and `.switch` commands plus unbind support and binding sync
  - Add `remote_control` tool and refactor AgentBridge into modules
- **Viewer: Add fullscreen presentation mode for file previews**

### Bug Fixes
- **Notifications: Preserve scheduled session navigation across platforms**
  - Fix Windows system notification click routing to the correct chat session
  - Preserve scheduled session navigation targets from system notifications
- **Chat Session: Preserve unread state and routing consistency**
  - Preserve unread state on startup
  - Align scheduled unread state with title colors
  - Preserve notification target session routing
- **Sync and Build: Improve refresh and production reliability**
  - Re-initialize `agentChatManager` after profile pull
  - Invalidate cache and refresh renderer after profile pull
  - Prevent `react-refresh` and Babel dev transforms from leaking into production bundles

### Improvements
- **Scheduler and Chat Session: Consolidate monthly metadata architecture**
  - Move schedules to monthly store architecture
  - Move scheduler metadata, job metadata, and execution state into month index metadata
  - Remove legacy session file sanitation and unify session state around the store
- **Notifications: Refine notification naming behavior**
  - Adjust chat session name marker in notifications

### Others
- **Dependencies**
  - Bump `express-rate-limit` from `8.2.1` to `8.3.0`
  - Bump `hono` from `4.12.5` to `4.12.7`

## [1.25.6] - 2026-03-07

### Features
- **Page Zoom: Rebase page zoom to main and complete app-level config** (#234)
  - Add comprehensive page zoom functionality with app-level configuration support
- **Remote Control: Add remote channel system for Teams integration** (#236)
  - Introduce remote channel system enabling Teams integration capabilities
- **Browser Control: Add browser control support on macOS** (#237)
  - Enable browser control functionality on macOS platform

### Bug Fixes
- **Auth: Prevent duplicate Teams Web tabs in browser auth flow**
  - Fix issue where multiple Teams Web tabs were opened during browser authentication

### Improvements
- **Auth: Merge Phase D+E+F into unified browser login flow**
  - Consolidate multiple authentication phases into a single streamlined browser login flow
- **Auth: Decompose BrowserAuthProvider into single-responsibility modules**
  - Refactor BrowserAuthProvider into focused, maintainable single-responsibility modules

### Documentation
- **MicrosoftGraph: Add comprehensive README and auto-close browser after token extraction**
  - Add detailed documentation for microsoftGraph module
  - Implement automatic browser closure after successful token extraction

## [1.25.5] - 2026-03-06

### Features
- **Main: Add native right-click context menu for editable fields** (#229)
  - Provide system-native cut/copy/paste/select-all context menu in text inputs

### Bug Fixes
- **Chat: Prevent SharePoint URLs from being misdetected as Windows file paths** (#232)
  - Fix incorrect path detection for SharePoint URLs in chat messages
- **Workspace: Clean untracked files after git reset --hard during pull** (#230)
  - Ensure workspace sync removes stale untracked files after hard reset
- **Startup: Cleanup playwright-profiles directory and legacy session state files on launch** (#235)
  - Remove playwright-profiles dir and legacy token cache files at startup to prevent lock/corruption issues

### Improvements
- **Auth: Replace disk-cached browser auth with CDP-first in-memory token extraction** (#231)
  - Eliminate on-disk token caching in BrowserAuthProvider for security compliance
  - Use CDP-based in-memory cookie extraction as primary authentication strategy
- **Auth: Remove Edge profile seed from BrowserAuthProvider** (#233)
  - Strip Edge profile seeding logic for cleaner, more secure auth flow

### Security
- **Auth: Remove Edge profile seeding from BrowserAuthProvider** (#233)
  - Eliminate Edge browser profile reading to comply with security policies

### Others
- **Auth: Remove Edge profile copier module entirely**
  - Delete deprecated Edge profile copier module and related code
- **Auth: Add security notice prohibiting Edge profile reading and disk token caching**
  - Document security policy against reading Edge profiles and caching tokens to disk

## [1.25.4] - 2026-03-05

### Features
- **Chat: Make say-hi message suggestions clickable action items** (#228)
  - Convert greeting message suggestions into interactive clickable action items
- **KnowledgeBase: Implement move-to-knowledgebase with file path replacement across all layers** (#225)
  - Add move-to-knowledgebase functionality with automatic file path replacement support

### Bug Fixes
- **Settings: Improve sync repository creation UX** (#220)
  - Enhance user experience for sync repository creation workflow

### Improvements
- **KnowledgeBase: Remove SharePoint auto-search from knowledge base configuration view** (#227)
  - Simplify knowledge base configuration by removing automatic SharePoint search
- **MicrosoftGraph: Simplify MSAL auth to browser-only strategy and eliminate duplicate browser windows** (#226)
  - Streamline MSAL authentication to use browser-only strategy
  - Fix duplicate browser window issue during authentication
- **KnowledgeBase: Refactor knowledge base UI with context menu and boundary detection** (#224)
  - Add context menu support and improve boundary detection in knowledge base UI

### Others
- **Dependencies: Bump hono from 4.12.2 to 4.12.5** (#215)
- **Dependencies: Bump @hono/node-server from 1.19.9 to 1.19.10** (#216)
- **Dependencies: Bump tar from 7.5.9 to 7.5.10** (#223)

## [1.25.3] - 2026-03-05

### Features
- **Auth: Add AAD account derivation from alias and Edge profile seeding** (#222)
  - Derive AAD account name from user alias for Microsoft Graph authentication
  - Add Edge browser profile copier for seeding authentication cookies
  - Add alias utility functions with unit tests
- **SharePoint: Highlight Office app notice in summarize step with platform-specific messaging** (#221)
  - Add platform-specific messaging for Office app installation notice
  - Improve SharePoint document search overlay UI
- **Auth: Add MSAL three-strategy authentication progress overlay UI** (#219)
  - Add progress overlay UI showing MSAL authentication strategy execution
  - Support three authentication strategies with visual feedback

## [1.25.2] - 2026-03-04

### Bug Fixes
- **Scheduler: Always register scheduler IPC handlers regardless of feature flag** (#211)
  - Fix scheduler IPC handlers not registering when feature flag is disabled
- **Chat: Fix renamed chat session title being reset on subsequent messages** (#213)
  - Resolve issue where renamed chat session titles reverted on new messages
- **Settings: Fix navigation list overflow not scrollable**
  - Fix settings navigation list not being scrollable when items overflow

### Improvements
- **Auth: Rename CdpAuthProvider to BrowserAuthProvider, move Python venv to userData, and fix MSAL auth issues** (#214)
  - Rename CdpAuthProvider to BrowserAuthProvider for clearer naming
  - Move Python virtual environment to userData directory
  - Fix various MSAL authentication issues

### Others
- **Auth: Revert temporary skip of Node.js MSAL broker**
  - Revert temporary change that skipped Node.js MSAL broker for Python auth testing

## [1.25.1] - 2026-03-04

### Features
- **Sub-Agent: Implement Sub-Agent system** (#206)
  - Add complete Sub-Agent system for delegating tasks to specialized child agents
- **Sync: Add profile sync feature with GitHub repository integration** (#205)
  - Enable user profile synchronization via GitHub repository backend
- **Chat: Add kosmosFeatureChatReplay feature flag for replay button**
  - Introduce feature flag to control chat replay button visibility

### Bug Fixes
- **Playwright: Use playwright-core in dependencies for packaged app CDP auth** (#212)
  - Fix CDP authentication by switching to playwright-core for production builds

### Improvements
- **SubAgent: Migrate chatTypes imports to @shared path alias and optimize renderer build config**
  - Consolidate chatTypes imports under @shared alias and improve webpack renderer configuration

### Documentation
- **Dashboard: Add cloud_RoleInstance filter to exclude test instance**
  - Filter out test instances from DAU dashboard queries for accurate metrics

## [1.25.0] - 2026-03-04

### Features
- **Auth: Implement MSAL 3-strategy authentication with CDP browser fallback and Teams Graph builtin tools** (#210)
  - Add 3-strategy MSAL authentication: native broker, CDP browser extraction, and interactive popup
  - Integrate CDP-based browser cookie extraction as fallback authentication method
  - Add Teams Graph built-in tools for listing chats and reading chat messages
- **Scheduler: Add scheduler tools, session linking, feature flag, and improved prompt guidance** (#204)
  - Add scheduler built-in tools with session linking capability
  - Introduce feature flag support for scheduler functionality
  - Improve prompt guidance for scheduled task management
- **Scheduler: Add cron-based scheduled task system with built-in tool and management UI** (#194)
  - Implement cron-based task scheduling engine
  - Add built-in tool for creating and managing scheduled tasks
  - Provide management UI for viewing and controlling scheduled tasks

### Bug Fixes
- **Chat: Fix file existence check race condition during file replacement**
  - Resolve race condition when checking file existence during concurrent file replacement operations
- **E2E: Re-implement flaky StartupPage fix and Windows-only CI** (#207)
  - Re-implement StartupPage test stabilization with Windows-only CI configuration

### Improvements
- **Types: Unify duplicated type definitions into src/shared/types/** (#209)
  - Consolidate scattered type definitions into a centralized shared types directory

### Others
- **Deps: Bump underscore from 1.13.7 to 1.13.8** (#208)
  - Update underscore dependency to patch version for security and stability
- **ACL: Add liangzeng with Write permission**
  - Grant Write access to liangzeng in ACL configuration

## [1.24.0] - 2026-03-02

### Features
- **Microsoft Graph: Implement 7 Teams Graph API built-in tools** (#203)
  - Add Teams channel messaging, team listing, and channel management tools
  - Integrate Teams Graph API into the built-in tool system

### Bug Fixes
- **macOS: Remove keychain-access-groups entitlement that prevents app launch**
  - Fix app launch failure caused by invalid keychain-access-groups entitlement on macOS

### Improvements
- **Microsoft Graph: Consolidate SharePoint module into microsoftGraph**
  - Merge standalone sharepoint module into the unified microsoftGraph module structure
- **Microsoft Graph: Rename SharePointAuthManager to MsalAuthManager** (#202)
  - Generalize auth manager naming to reflect broader Microsoft Graph API usage
- **SharePoint: Defer summary processing to add-to-knowledge-base phase** (#201)
  - Optimize document processing by deferring summary generation until knowledge base ingestion

### Documentation
- **Auth: Document macOS Node.js native broker incompatibility with Electron**
  - Add documentation explaining MSAL native broker limitations on macOS with Electron

## [1.23.4] - 2026-03-02

### Features
- **Settings: Add configurable Microsoft Graph API Client ID with Settings UI** (#198)
  - Allow users to configure a custom Graph API Client ID through the settings interface

### Bug Fixes
- **Auth: Invalidate cached token when graphClientId changes** (#200)
  - Ensure stale tokens are cleared when the Graph Client ID configuration is updated
- **Auth: Resolve graphClientId dynamically on each auth attempt** (#199)
  - Fix static graphClientId resolution to support runtime configuration changes
- **Auth: Add keychain-access-groups entitlement for MSAL native broker on macOS** (#197)
  - Enable proper keychain access for MSAL native broker authentication on macOS
- **E2E: Disable analytics reporting in E2E test scenarios** (#196)
  - Prevent analytics events from being sent during end-to-end testing

## [1.23.3] - 2026-03-02

### Features
- **Runtime: Add Git installation status detection in Runtime Settings** (#173)
  - Display Git availability and version info in the runtime settings panel

### Bug Fixes
- **SharePoint: Add retry logic with exponential backoff to msal[broker] pip install**
  - Retry up to 3 times (1s → 2s → 4s delays) to handle transient failures such as exit code null
  - Prevents intermittent `[AUTH_PYTHON_DEPS]` errors during Python dependency installation

### Improvements
- **SharePoint: Migrate SharePointAuthManager logging from console.* to unifiedLogger**
  - All diagnostic logs (Node.js broker status, Python fallback details) now appear in production log files
  - Enables root cause analysis for Node.js broker failures on Mac ARM in packaged builds

### Tests
- **SharePoint: Update authentication tests for retry behavior**
  - Add test for retry-after-transient-failure scenario (exit code null → success on retry)
  - Update install failure test to verify all 3 retry attempts are exhausted

## [1.23.2] - 2026-03-02

### Features
- **SharePoint: Implement dual-strategy MSAL broker authentication with Python fallback**
  - Add Python MSAL broker as cross-platform fallback when native Node.js broker is unavailable
  - Integrate TerminalManager for Python broker auth to resolve -42000 error
  - Fix MSAL native broker loading failure in packaged Electron builds
  - Include SharePoint Python resources in electron-builder extra resources

### Bug Fixes
- **SharePoint: Fix background tasks persisting after Skip/Close in SharePointDocumentSearchOverlay**
  - Ensure background document processing tasks are properly cancelled when overlay is dismissed

### Tests
- **SharePoint: Add unit tests for dual-strategy authentication**
  - Add comprehensive test coverage for SharePointAuthManager dual-strategy auth flow

## [1.23.1] - 2026-03-01

### Features
- **Models: Sync latest GHC model list and add Claude Opus 4.6 1M to Kosmos used models**
  - Update model catalog with newest GitHub Copilot models including Claude Opus 4.6 1M

### Improvements
- **LLM: Replace static GHC model list with dynamic fetch and push-based sync architecture**
  - Migrate from hardcoded model list to dynamic fetching with push-based synchronization
- **LLM: Replace static KOSMOS_USED_MODEL_IDS with dynamic pattern matching**
  - Use regex-based pattern matching instead of static model ID list for better maintainability

### Bug Fixes
- **Compression: Ensure tool_use/tool_result pairing integrity after compression**
  - Fix issue where message compression could break tool call/result pairing

### Documentation
- **README/ACL: Add PM STUDIO dev guide and grant write access to new members**
  - Update project documentation and access control configuration

## [1.23.0] - 2026-02-28

### Features
- **Agent: Add archive and restore agent functionality**
  - Allow users to archive agents for decluttering and restore them when needed
  - Add ArchivedAgentsView with full archive management UI

- **Chat: Add "Add to Agent Knowledge" menu item to file attachment menus**
  - Enable users to quickly add file attachments to agent knowledge base directly from chat

- **Apply-to-Agents: Add Select All checkbox to MCP and Skill agent selection dialogs**
  - Add dynamic label checkbox for bulk agent selection in MCP and Skill dialogs

- **SharePoint: Add document search overlay with native Office extraction and LLM summaries**
  - Implement SharePoint document search overlay for knowledge base integration
  - Support native Office file extraction and LLM-powered document summaries

- **Screenshot: Implement window detection for screenshot capture**
  - Add window detection functionality to the screenshot feature

### Improvements
- **Settings: Clean up Archived Agents header and unify navigation icon**
  - Refine settings navigation with unified icon style and cleaner header layout

- **Analytics: Remove legacy SQLite and self-hosted analytics system**
  - Clean up deprecated analytics infrastructure for a lighter codebase

### Bug Fixes
- **LLM: Use max_prompt_tokens as context limit to fix context overflow issue**
  - Resolve context window overflow by properly using max_prompt_tokens parameter

- **SharePoint: Improve auth error messages with actionable guidance**
  - Provide clearer error messages with actionable steps for SharePoint authentication issues

- **SharePoint: Fix search input focus issue on Windows**
  - Resolve input focus behavior inconsistency on Windows platform

- **UI: Show file-not-found error instead of infinite loading spinner**
  - Display proper error state when referenced file is missing

- **Analytics: Exclude system suspend time from app usage duration**
  - Ensure accurate usage tracking by excluding OS suspend/sleep periods

- **Analytics: Disable analytics in E2E pipeline to prevent polluting production data**
  - Guard analytics from test-generated data during CI pipelines

- **CI: Move DISABLE_ANALYTICS from step-level to job-level env**
  - Fix CI configuration for consistent analytics disabling across all steps

- **E2E: Resolve flaky StartupPage element check race condition; run on Windows only**
  - Fix intermittent test failures due to element check timing issues

### Documentation
- **Dashboard: Update DAU queries with platform filtering**
  - Improve analytics dashboard queries with platform-specific filtering support

- **DevOps: Add Application Insights general configuration guide**
  - Provide setup and configuration documentation for Application Insights integration

### Build
- Bump minimatch from 10.2.2 to 10.2.4 in /updater/win
- Bump bn.js dependency
- Bump hono from 4.12.0 to 4.12.2

### Reverts
- Revert owned OAuth-related changes for stability (multiple revert cycles)
- Revert MIT license addition

## [1.22.0] - 2026-02-26

### Features
- **SharePoint: Add knowledge base auto-search with native broker authentication**
  - Implement SharePoint document search overlay for agent knowledge base
  - Add SharePoint client with URL parsing, authentication management, and text extraction
  - Support native broker authentication for seamless SharePoint integration
  - Add SharePoint file icon component for document type visualization

- **Workspace: Enable hidden files visibility in file tree**
  - Allow users to view hidden files and directories in the workspace explorer
  - Improve file tree completeness for development workflows

### Improvements
- **Testing: Add Playwright E2E testing framework (Phase 1-4)**
  - Implement comprehensive E2E test suite with 20 test cases
  - Add CI integration for automated end-to-end testing
  - Include auth helpers, navigation utilities, and fixture support

### Bug Fixes
- **Browser Control: Fix preload naming, MCP image filter, and UI state**
  - Resolve preload script naming inconsistencies
  - Fix MCP image filter functionality
  - Correct UI state management issues in browser control

### Reverts
- **Auth: Revert owned OAuth app support with feature flag**
  - Revert OAuth app feature flag implementation for stability

### Documentation
- **Prompts: Add release note generation prompt template**
  - Add standardized release automation prompt for consistent release workflows

## [1.21.8] - 2026-02-24

### Features
- **Workspace: Implement lazy-loading file tree with large directory protection**
  - Add lazy-loading file tree for improved performance with large directories
  - Implement protection mechanism to prevent UI freezing when loading large folders
  - Support progressive directory expansion with on-demand child loading

- **Agent: Add filesystem-based skill discovery from knowledge base**
  - Enable automatic skill discovery from agent knowledge base filesystem
  - Support dynamic skill loading from file-based knowledge sources
  - Enhance agent capabilities with discoverable skill system

### Improvements
- **UI: Improve workspace explorer sidepane layout and alignment**
  - Refine workspace explorer sidepane visual layout
  - Optimize component alignment for better user experience
  - Enhance overall workspace navigation interface design

- **UI: Reorganize chat input button layout**
  - Refactor chat input button positioning and organization
  - Improve button accessibility and visual consistency
  - Streamline chat interface controls

- **UI: Refactor chat content layout with centered max-width design**
  - Implement centered max-width layout for chat content
  - Improve readability with optimized content width constraints
  - Enhance visual hierarchy in chat interface

- **Workspace: Simplify directory children retrieval and improve code clarity**
  - Refactor directory children retrieval logic for better maintainability
  - Improve code readability and reduce complexity
  - Optimize file tree traversal performance

### Bug Fixes
- **Workspace: Improve file tree refresh behavior and UX**
  - Fix file tree refresh issues to ensure accurate state updates
  - Enhance user experience during file tree operations
  - Resolve edge cases in file tree state management

- **Voice: Fix whisper setup hang when base model already exists**
  - Resolve hang issue during Whisper setup when base model is present
  - Improve setup flow reliability and error handling
  - Ensure smooth voice input initialization process

- **Build: Revert preload.ts to fix TypeScript compilation errors**
  - Fix TypeScript compilation errors in preload.ts
  - Restore stable build configuration
  - Ensure consistent build process across environments

### Documentation
- **I18n: Translate Chinese comments to English in workspace files**
  - Convert all Chinese comments to English in workspace-related files
  - Improve code documentation consistency
  - Enhance international developer experience

## [1.21.7] - 2026-02-23

### Features
- **Voice Input: Implement global voice input config and cache-based native module loading** (#155)
  - Add whisper-addon (~127MB) and sherpa-onnx (~13MB) on-demand download UI in settings
  - Migrate voice input to app-level configuration with global enable toggle
  - Support sequential setup steps with progress bar and cancel button
  - Auto-download base model when enabling voice input
  - Fix macOS rpath issue for native addon dynamic library loading
  - Hide mic button when voice input is disabled in AppConfig
- **Browser Control: Add Chrome/Edge browser support** (#90)
  - Implement browser control HTTP server for update.xml/CRX delivery
  - Add browser install and native server download confirmation dialogs
  - Support browser preference configuration (Chrome/Edge) in user profile
  - Write selectedBrowser.json to native-server directory with runtime notification
  - Add Edge-specific restart sequence for extension loading
- **OAuth: Add owned OAuth app support with feature flag** (#91)
  - Implement Kosmos-owned OAuth configuration with custom CLIENT_ID
  - Support dynamic OAuth config selection based on kosmosUseOwnedOAuth flag
  - Add token consistency validation for owned OAuth mode
  - Skip Copilot Token API when using owned OAuth (GitHub token used directly)
- **Chat: Implement chat session replay feature with UI controls** (#159)
  - Add replay state management with isReplaying flag
  - Add Play/Stop button in ChatViewHeader for replay control
  - Support progressive message rendering with configurable speed control
  - Disable send button during replay to prevent interference

### Improvements
- **Screenshot: Migrate screenshot settings from profile to app level** (#158)
  - Move screenshotSettings from ProfileV2 to AppConfig for global configuration
  - Add automatic migration from first profile's settings
  - Update all components to consume app-level screenshot data
- **Bundle Size: Add PR bundle size check GitHub Actions workflow** (#157)
  - Automated bundle size comparison for pull requests
  - Track and report bundle size changes in CI/CD pipeline

### Documentation
- **Translate Chinese comments to English in feature flags** (#d3694a7)
  - Convert all Chinese comments to English in featureFlagDefinitions.ts
  - Maintain consistent English documentation across feature flag system
- **Translate Chinese comments to English in chat components** (#160)
  - Convert inline comments in ChatContainer, ChatInput, ChatViewHeader
  - Update agentChatSessionCacheManager documentation to English
  - Remove emoji markers from comments for professional codebase

### Bug Fixes
- **Whisper: Relocate model storage to assets subdirectory** (#156)
  - Fix model storage path organization for better asset management

## [1.21.6] - 2026-02-22

### Improvements
- **Reduce installer size by lazy-loading large dependencies** (#154)
  - Move mermaid (65MB) and monaco-editor (75MB) to devDependencies to exclude from packaged node_modules
  - Fix webpack splitChunks configuration: remove enforce:true that defeated dynamic imports
  - Add dedicated cacheGroups for mermaid/monaco async chunks for true code-splitting
  - Move @kutalia/whisper-node-addon (127MB) and sherpa-onnx (13MB) to optionalDependencies
  - Create NativeModuleManager for on-demand downloading of native modules from CDN
  - Update whisper and TTS services to use NativeModuleManager with fallback strategy
  - Add IPC handlers for native module management (getStatus, ensureDownloaded, cancelDownload, deleteModule)
  - **Expected installer size reduction: macOS arm64 DMG ~238 MB → ~80 MB**

## [1.21.5] - 2026-02-22

### Bug Fixes
- Remove domestic mirror config from .npmrc to fix Mac CI dmg-builder 404 (#153)
  - Remove electron_mirror and electron_builder_binaries_mirror from .npmrc
  - CI runs overseas, using npmmirror.com causes new binary dmg-builder@1.2.0 download 404 error
  - Domestic mirror config kept in .npmrc.local for local development use

## [1.21.4] - 2026-02-22

### Bug Fixes
- Remove deprecated publisherName from Windows build config (#152)
  - Clean up electron-builder Windows configuration
  - Remove unsupported publisherName property to prevent build warnings

## [1.21.3] - 2026-02-21

### New Features
- Add runtime version selector with auto-fetched version lists (#147)
- Update GitHub Copilot model list with latest AI models (#138)

### Improvements
- Optimize build size with platform-specific packaging and lazy loading (#151)
- Redesign About and Settings pages with unified card layout (#143)
- Redesign runtime settings interface with card-based layout (#139)
- Update settings icons and remove experimental badge (#145)
- Improve runtime environment labels and descriptions (#146)

### Bug Fixes
- Fix pinned Python version matching for uninstall and UI display (#148)

### Documentation
- Add comprehensive settings page development guide (#144)
- Add profile-level config development guide and translate comments to English (#150)
- Add app-level config development guide (#149)

### Dependency Updates
- Bump hono from 4.11.7 to 4.12.0 (#142)
- Bump fast-xml-parser and @aws-sdk/xml-builder (#141)
- Bump minimatch and rimraf in /updater/win (#140)
- Bump tar and electron-builder (#137)

## [1.21.2] - 2026-02-15

### Bug Fixes
- Fix screenshot.html loading failure in production build (#136)
  - Fix loadFile query parameter handling to prevent URL encoding issues
  - Use loadFile's query option instead of appending params to file path
  - Improve permission dialog message with restart requirement warning
  - Add debug logging for capture status and permission checks

### Documentation
- Add comprehensive inline documentation for ensureV2ProfileIntegrity (#135)
  - Document method overview explaining one-time migration and field completion
  - Add modification guidelines including deep copy principle and two-phase loop structure
  - Clarify variable naming conventions for better code maintainability
  - Explain relationship with sanitizeProfileV2 and when to use each
  - Add standard pattern for adding new agent fields

## [1.21.1] - 2026-02-15

### Bug Fixes
- Fix knowledgeBase path not initialized issue (#134, #133)
  - Resolve initialization failure for knowledgeBase path in profile configuration
  - Ensure proper path initialization during profile setup
  - Improve profile data integrity and reliability

## [1.21.0] - 2026-02-15

### New Features
- Add move to agent knowledge feature in file tree context menu (#128, #127)
- Add apply skill to agents dialog in settings page (#126)
- Allow applying MCP and skills to IN-LIBRARY agents (#124)
- Add built-in skills badge and sort functionality (#122)
- Implement built-in skills management system (#121)
- Add built-in skills installation during FRE setup (#120)
- Implement startup update overlay with smart merge strategy for library resources (#119)
- Add ability to install skill from file card (#118)
- Add .skill file format support and YAML front matter parsing (#115)
- Improve file attachment menu with preview and open options (#114)
- Add file path extraction and preview for assistant messages (#113)
- Enable screenshot feature for production environment (#112)
- Add description parameter to read/search builtin tools (#110)
- Unify presented files card styling and enhance file type icons (#111)
- Add present tool for final deliverables (#100)
- Enhance overlay file viewer with auto file size detection and preview hints (#98)
- Replace react-syntax-highlighter with Monaco Editor for readonly file viewing (#97)
- Add in-app file editing with Monaco Editor and enhance file viewer UI (#96)
- Add rich file viewer with HTML/Markdown/JSON rendering support (#94)
- Integrate overlay file viewer for workspace file clicks (#93)
- Add real-time content preview for write_file tool call (#85)
- Add TTS (Text-to-Speech) functionality (#84)
- Add screenshot settings and FRE with shortcut toggle support (#87)
- Add intelligent VPN fix suggestions for Claude model errors (#82)
- Add active user tracking via Application Insights (#81)
- Add attachment preview with overlay viewers (#79)
- Add overlay file viewer component with multi-format support (#78)
- Add settings for screenshot (#73)
- Integrate Azure Application Insights with dual-write support (#68)
- Implement smart requirements fix and real-time status refresh in agent library (#64)
- Implement unified attach menu for file and screenshot attachments (#61)

### Improvements
- Rename chat session directory to deliverables directory (#117)
- Improve file explorer empty state messages (#108)
- Move PresentedFilesCard inside Message component (#107)
- Rename mention syntax from @workspace to @knowledge-base and @chat-session (#105)
- Implement knowledge base and chat session file separation with enhanced directory management (#104)
- Introduce knowledgeBase field and rename workspace terminology (#103)
- Move overlay file viewer action buttons to header (#95)
- Improve error messages with status codes and debugging context (#92)
- Unify file type icons with reusable SVG component (#80)
- Rename ImageViewer to OverlayImageViewer for clarity (#74)
- Internationalize Chat Input UI text and optimize file drag functionality (#72)
- Enforce headless-only mode and improve browser check reliability for Playwright (#71)
- Update wording for app update button (#66)
- Remove devOnly property, unify with defaultValue dynamic logic for dev environment restrictions (#60)
- Remove ChatTurn abstraction, simplify message rendering architecture (#48)

### Bug Fixes
- Fix race condition in frontend notification timing for profile cache (#131)
- Fix maximum update depth exceeded error by removing flushSync (#130)
- Fix requirements install result check and macOS zip extraction for skills (#125)
- Support flat zip structure extraction for skills (#123)
- Fix Windows path separator inconsistency issues
- Fix screenshot capture window unexpected zoom (#99)
- Fix JSX syntax error in settings navigation
- Fix Voice Input issues (#86)
- Fix screenshot-related issues (#88)
- Improve terminated error handling and user feedback (#83)
- Fix markdown rendering issues (#70)
- Fix Claude model not showing loading indicator in agentic loop (#69)
- Fix subsequent assistant messages not showing loading indicator in agentic loop (#67)
- Fix loading indicator displaying as gray box during sending_response status (#63)
- Add description parameter to version check commands (#62)

### Refactor
- Rename 'present' tool to 'present_deliverables' (#129)
- Remove old implementation of screenshot UI (#75)

### Dependencies
- Bump fast-xml-parser, @aws-sdk/client-sagemaker and @aws-sdk/credential-providers (#89)
- Bump axios from 1.13.2 to 1.13.5 (#77)
- Remove useless type shim that is now mismatched with current electron version (#76)

## [1.20.18] - 2026-02-07

### Improvements
- Refactor macOS packaging workflow to create ZIP from DMG instead of repacking stapled app
  - Extract .app from DMG and create ZIP, ensuring identical content between ZIP and DMG distributions
  - Resolve Gatekeeper verification issues in auto-update by guaranteeing ZIP contains the exact same signed, notarized, and stapled .app
  - Completely rewrite repack-zip.js script with DMG mounting capabilities
  - Add comprehensive code signature and notarization verification
  - Add blockmap generation for differential updates
  - Improve error handling and logging throughout the process

## [1.20.17] - 2026-02-07

### Bug Fixes
- Fix GitHub release creation in parallel build jobs
  - Add gh release create command before artifact upload to ensure release exists
  - Use --verify-tag flag to validate tag existence
  - Prevent race conditions when multiple jobs try to upload artifacts simultaneously
  - Add fallback handling for already existing releases

## [1.20.16] - 2026-02-07

### Bug Fixes
- Fix macOS build process to prevent uploading un-notarized ZIP files
  - Add `--publish=never` flag to prevent premature uploads before notarization stapling
  - Ensure ZIP files are only published after successful notarization and stapling
- Fix app-builder binary path resolution for blockmap generation
  - Resolve platform-specific app-builder binary paths correctly
  - Support both arm64 and x64 architectures on macOS
  - Improve error handling when binary is not found

## [1.20.15] - 2026-02-07

### Bug Fixes
- Fix macOS auto-update with regenerated latest-mac.yml after stapling
  - Add `--publish=never` flag to electron-builder DMG commands to prevent premature publish
  - Regenerate latest-mac.yml with correct SHA512 hashes for both DMG and ZIP after stapling
  - Improve blockmap generation using app-builder-bin directly
  - Ensure latest-mac.yml is uploaded to GitHub release for proper auto-update
  - Resolve auto-updater verification failures due to mismatched hashes

### Improvements
- Update app description to KOSMOS AI STUDIO

## [1.20.14] - 2026-02-06

### Improvements
- Simplify toast duration and remove countdown display (#58)
  - Remove countdown timer from toast notifications
  - Streamline toast notification UX
  - Improve code simplicity and maintainability

## [1.20.13] - 2026-02-06

### New Features
- Add "Apply to Agents" dialogs for MCP servers/skills and improve VSCode MCP import tooltips (#56)
  - Allow applying MCP servers and skills to multiple agents at once
  - Enhanced tooltip experience for VSCode MCP imports
- Add Mermaid diagram rendering support (#55)
  - Render Mermaid diagrams directly in chat messages
  - Support for flowcharts, sequence diagrams, and more
- Add rename option to chat session context menu (#54)
  - Easily rename chat sessions from context menu
- Add Claude Opus 4.6 model and set as system default (#52)
  - Latest Claude Opus 4.6 model integration
  - Set as default model for improved performance
- Add workspace paste-to-workspace feature with AI-powered file naming
  - Intelligent file naming suggestions based on content
  - Seamless integration with workspace file tree
- Enhance workspace menu with add files/folder/paste options
  - Improved user experience for adding content to workspace
- Enhance file tree context menu with delete and reveal functionality
  - Quick access to file operations
- Integrate screenshot core editor functionality (#43)
  - Advanced screenshot editing capabilities
  - Comprehensive annotation and markup tools

### Bug Fixes
- Enable cyclic keyboard navigation for context menu lists (#53)
  - Improve keyboard navigation for better UX
- Fix macOS auto-update 'App Damaged' error by repacking ZIP after stapling (#51)
  - Resolve "App is damaged" error on macOS auto-updates
  - Repack ZIP archive after notarization stapling
- Fix mention autocomplete not replacing typed text (#50)
  - Resolve issue where autocomplete suggestions weren't replacing user input
- Fix browser control bugs (#45)
  - Improve browser automation stability and reliability
- Fix whisper-node-addon loading issues on macOS (#42)
  - Resolve native addon loading problems on macOS platform

### Improvements
- Remove dark mode implementation from renderer components (#57)
  - Simplify codebase by removing unused dark mode code
- Speed up screenshot image loading (#49)
  - Enhanced performance for screenshot loading
- Optimize screenshot send to main process (#47)
  - Enhanced performance for screenshot data transfer
- Improve macOS installer appearance and layout
  - Better DMG background and visual presentation
- Improve Toolbar: Search Agents Refactor & Mac Optimizations (#44)
  - Enhanced search functionality
  - Better macOS integration and performance

### Dependencies
- Bump @modelcontextprotocol/sdk from 1.25.2 to 1.26.0 (#46)
  - Update MCP SDK to latest version

## [1.20.12] - 2026-02-03

### Improvements
- Patch release with minor updates and optimizations

## [1.20.11] - 2026-02-03

### New Features
- Add voice input functionality (#34)
  - Enable voice input feature with devOnly flag
  - Integrate voice input capabilities into chat interface
- Add retry chat functionality for failed API calls
  - Implement retry mechanism for failed chat operations
  - Enhance error handling with user-friendly messages
- Add browser control capabilities (#35)
  - Integrate browser automation and control features
- Add truncated JSON detection and append_to_file tool
  - Handle large content with append functionality
  - Detect and manage truncated JSON responses

### Bug Fixes
- Fix retry chat targeting wrong agent instance
  - Resolve agent instance targeting issue in retry operations
- Fix toolbar window flicker on show (#40)
  - Eliminate visual flicker when showing toolbar window
- Fix dialog file picker defaulting to All Files filter on Windows
  - Improve file selection experience on Windows platform
- Fix streaming update loss on session cache destruction
  - Prevent loss of streaming updates during cache cleanup
- Fix streaming completion not triggering UI update
  - Ensure UI updates correctly reflect streaming completion
- Fix Windows 8.3 short path causing wrong extraction directory
  - Resolve updater path issue on Windows

### Improvements
- Replace toast error notifications with dedicated ErrorBar component
  - Enhance error display with dedicated UI component
  - Improve user experience with better error visualization
- Unify file write operations into single write_file tool
  - Consolidate file operations for better consistency
  - Simplify tool interface for file writing
- Optimize Mac/Multi-screen support & Improve selection stability (#39)
  - Enhance toolbar behavior on macOS
  - Improve stability across multiple displays
- Optimize Windows startup performance with lazy loading
  - Implement lazy loading strategy for faster startup
  - Reduce initial load time on Windows

### Documentation
- Add feature flag documentation and refactor devOnly usage
  - Comprehensive documentation for feature flag system
  - Clarify devOnly flag usage patterns

### Security
- Bump lodash from 4.17.21 to 4.17.23 (#26)
- Bump hono from 4.11.4 to 4.11.7 (#28)

### Others
- Change NODE_ENV default to development in env example
- Update issue template for JIT access
- Update JIT access policy configuration
- Add new team members with write access
- Bump eslint and related plugins (#31)

## [1.20.10] - 2026-02-01

### Improvements
- Optimize Windows startup performance with lazy loading
  - Implement lazy loading strategy to improve Windows application startup time
  - Enhance user experience with faster initial load

### Security
- Bump lodash from 4.17.21 to 4.17.23
- Bump hono from 4.11.4 to 4.11.7

### Others
- Bump eslint, @typescript-eslint/eslint-plugin, @typescript-eslint/parser and eslint-plugin-react-hooks

## [1.20.9] - 2026-02-01

### New Features
- Implement feature flags system with IPC integration
  - Add comprehensive feature flag management system for runtime feature control
  - Enable dynamic feature toggling through IPC communication
  - Support feature flag definitions with platform-specific checks
- Add Windows native updater with GUI progress display
  - Implement lightweight Windows native updater stub
  - Add visual updater for Windows with GUI progress display

### Bug Fixes
- Hide console window during Windows update process
  - Improve user experience by preventing console window flash during updates

### Improvements
- Align MCP client initialization with VS Code behavior
  - Standardize MCP client initialization to match VS Code's approach
  - Improve compatibility and consistency with VS Code MCP integration
- Reorganize updater modules by platform
  - Refactor updater architecture for better maintainability
  - Remove visual updater feature and improve standalone updater
- Streamline feature flag system
  - Standardize feature flag naming convention
  - Migrate screenshot control from environment variable to feature flag
  - Centralize memory feature platform checks via feature flag
  - Migrate toolbar visibility to feature flag system
  - Enhance toolbar visibility control with runtime state management

### Documentation
- Improve macOS and Windows updater documentation
  - Add comprehensive documentation for updater system
  - Include platform-specific setup and usage instructions

### Others
- Add hot update testing script for CDN update system validation

### Security

## [1.20.8] - 2026-02-01

### New Features

### Improvements

### Bug Fixes

### Security

## [1.20.8] - 2026-01-30

### Documentation
- Improve product description and remove video card in tutorial view
  - Update product description to emphasize persistent AI coworker concept
  - Remove video description card overlay from tutorial view
  - Refine messaging to focus on context-aware collaboration

### Improvements
- Adjust video description card spacing in tutorial view
  - Optimize visual layout and spacing for better user experience

### Security

## [1.20.7] - 2026-01-30

### Improvements
- Improve video player responsiveness in tutorial view
  - Replace fixed dimensions with responsive width/height: 100%
  - Enhance tutorial video viewing experience across different screen sizes

## [1.20.6] - 2026-01-30

### New Features
- Add agent identity information to system prompt
  - Include agent name and role awareness in agent-specific system prompt
  - Help AI understand when users ask about the agent itself
  - Add workspace context as part of agent's knowledge base
  - Improve agent self-awareness and contextual understanding

### Bug Fixes
- Fix Windows path handling for FRE video assets
  - Improve cross-platform file path compatibility
  - Ensure proper video asset loading on Windows platform

### Security

## [1.20.5] - 2026-01-30

### New Features

### Improvements

### Bug Fixes

### Security

## [1.20.4] - 2026-01-30

### New Features
- Add TAVILY_API_KEY environment variable support
  - Add TAVILY_API_KEY to webpack DefinePlugin configuration
  - Expose environment variable to main process for Tavily search integration

### Security

## [1.20.3] - 2026-01-30

### New Features
- Add default system prompt for PM Project Agent
  - Implement comprehensive Senior PM AI Co-pilot prompt defining role and capabilities
  - Include core capabilities: backlog management, documentation, and strategic brainstorming
  - Add privacy-first principles and context-grounded operations guidelines
  - Replace empty system prompt with professional default for new project agents

### Security

## [1.20.2] - 2026-01-30

### Bug Fixes
- Restrict IN-LIBRARY agent editing permissions to read-only
  - Changed IN-LIBRARY agent editing behavior from partially editable to fully read-only (except workspace file management)
  - Ensures library agents maintain their publisher-defined configurations
  - Users can duplicate the agent to create an editable copy if customization is needed
  - Only workspace file management remains available for library agents

### Security

## [1.20.1] - 2026-01-30

### New Features
- Add Tavily API key support
- Add placeholder processing support for url field in MCP configuration
- Add local video support for FRE tutorial
- Add assistant say-hi message for greeting display
- Add project agent say-hi message and UI improvements
- Add empty state UI with file/folder addition capabilities for workspace

### Improvements
- Update tutorial welcome screen copy and layout
- Move switch workspace button to dropdown menu
- Translate workspace UI text from Chinese to English

### Bug Fixes
- Fix workspace explorer and assistant message persistence issues

### Dependency Updates
- Upgrade playwright and add Tavily API support

## [1.20.0] - 2026-01-29

### New Features
- **PM Studio:** Add PM Project Agent creation workflow with comprehensive UI
  - Implement two-step creation process: agent setup and workspace configuration
  - Add route integration for PM Studio branding-specific agent creation
  - Create comprehensive styling for project agent creation interface
  - Add workspace configuration view with file explorer and drag-drop support
  - Integrate PM Agent settings inheritance for quick project setup
- **FRE:** Implement First Agent Tutorial view for PM Studio brand
  - Add FreFirstAgentTutorialView component with video tutorial and action buttons
  - Add post-setup tutorial flow for PM Studio brand (Kosmos skips directly)
  - Update CSP policy to allow YouTube video embeds for tutorial content
- **FRE:** Implement create project agent navigation flow
  - Add useNavigate hook and profileDataManager integration to FreOverlay
  - Navigate to PM Project creation view after completing FRE tutorial
- **Agent Workspace:** Add comprehensive file management features
  - Implement multi-select delete functionality for files and folders
  - Add drag-and-drop file upload to AgentWorkspaceTab
  - Add files and folders upload functionality with dropdown menu
  - Add file size metadata to workspace file tree
  - Support batch file/folder deletion with confirmation dialog
- **Agent:** Enable partial editing for library agents
  - Allow library agents to edit model, workspace files, MCP servers, and skills
  - Keep avatar, name, workspace path, system prompt, and context read-only
  - Add isFromLibrary prop for fine-grained permission control
- **Agent:** Support ON-DEVICE agent renaming with primaryAgent sync
  - Enable name editing for ON-DEVICE agents while keeping IN-LIBRARY agents read-only
  - Add automatic primaryAgent sync when renamed agent is the primary one
  - Implement agent image cache cleanup on rename to prevent stale data
- **Resources:** Add unique identifiers to library resources
  - Add unique 'id' field to all agents, MCP servers, and skills in library files
  - Update PM Agent version from 1.1.10 to 1.1.11 and model to claude-opus-4.5
  - Update pm-studio-mcp version to 1.2.1 with new environment variables
  - Add studio-design-mcp server with design inspiration tools
  - Expand skills library with 10+ new skills

### Improvements
- **UI:** Enhance PM project agent UX and prompt structure
  - Hide primary agent badge in AgentList while preserving isPrimaryAgent logic
  - Refactor PM project agent initial prompt with clearer step-by-step structure
  - Update navigation button labels to "New Project Agent" for PM Studio mode
- **FRE:** Remove Journeys Agent installation and optimize UI layout
  - Remove Journeys Agent installation step from PM Agent setup flow
  - Adjust welcome title font size from 32px to 26px for better fit
  - Fix workspace tab layout with flexbox and scroll overflow handling
- **FRE:** Enlarge tutorial dialog and video dimensions
  - Increase dialog width from 896px to 1180px for better visibility
  - Expand video section and player dimensions for improved viewing experience
- **Workspace:** Implement agent-based workspace path naming strategy
  - Add getDefaultAgentWorkspacePath function for new agent workspace creation
  - Implement agent-{name}-{source} directory naming convention
- **Workspace:** Enhance workspace explorer auto-open and folder icon display
  - Auto-open workspace explorer sidepane when workspace has content
  - Add folder icon to workspace configuration header for better visual clarity
- **Workspace:** Enhance PM project agent workspace configuration UX
  - Add conditional initial prompt based on workspace content state
  - Implement dynamic button text reflecting workspace setup status
  - Unify UI styles with AgentWorkspaceTab for consistency
- **UI:** Simplify project agent creation interface
  - Remove emoji picker component and avatar selection functionality
  - Update PM Agent settings inheritance to exclude model configuration
  - Ensure new project agents always use system default model
- **UI:** Consolidate project agent creation styles
  - Merge PmProjectAgentCreation.css into AgentChatCreation.css
  - Reduce total CSS lines from 601 to 261 through style consolidation
- **UI:** Implement conditional Kobi visibility in pm-studio navigation
  - Kobi now visible only when selected or has active non-idle sessions
  - Maintain backward compatibility with kosmos branding (Kobi always visible)
- **UI:** Move New Agent button to top of navigation section
  - Relocate New Agent button from footer to header position for better accessibility
- **UI:** Enhance workspace folder empty state with visual redesign
  - Replace basic empty message with skills-empty-state inspired design
  - Add large folder icon and structured content layout with action buttons
- **Agent Workspace:** Add unsaved workspace path protection
  - Track saved workspace path state separately from current input value
  - Disable Add/Delete file operations when workspace path has unsaved changes
  - Add visual warning hint prompting users to save workspace path first
- **Agent Workspace:** Improve save button visibility with warning color
  - Replace icon-based save button with text-based button for better clarity
  - Add dynamic red warning color when unsaved changes exist
- **Agent Editor:** Extract workspace config to dedicated tab
  - Add new AgentWorkspaceTab component for workspace path management
  - Remove workspace field from AgentBasicTab to improve separation of concerns
- **Navigation:** Redirect to workspace tab after agent creation
  - Update navigation path from /settings to /settings/workspace
  - Ensure users land directly on workspace settings tab

### Bug Fixes
- **Playwright:** Migrate to chromium-headless-shell and improve version detection
  - Switch from full chromium to chromium-headless-shell in search tools
  - Use Playwright API for accurate browser version detection
  - Improve logging to distinguish between headless shell and full browser
- **Agent:** Temporarily disable file security validation
  - Add early return to skip file validation security check as temporary workaround
- **Chat:** Prioritize text content over images in clipboard paste handling
  - Add text content detection before image processing in paste handler
  - Fix table paste issue from Excel/Word that contains both text and image formats
- **Styles:** Fix excessive line spacing in message display
  - Change white-space from pre-wrap to normal in message container
  - Allow ReactMarkdown to handle line breaks properly
- **Styles:** Fix message content hidden when attachments present
  - Resolve layout issues when message contains file attachments
- **ACL:** Add juntongliu as Write member
  - Update team member access permissions in ACL configuration

### Security

## [1.19.31] - 2026-01-26

### New Features
- **FRE:** Implement modular First Run Experience components with improved UI
  - Add FreWelcomeView component for welcome screen with user display logic
  - Split FreOverlay into modular view components for better maintainability
  - Improve welcome view UI design and user information presentation

### Improvements
- **Assets:** Add brand logo icons for design-agent and pm-agent
  - Include logo icons for design-agent and pm-agent brands
  - Enhance brand asset library completeness

### Bug Fixes
- **MCP:** Prevent env config mutation affecting UI display
  - Fix issue where MCP environment configuration mutations affected UI rendering
  - Ensure proper isolation between configuration and display logic

## [1.19.30] - 2026-01-26

### Improvements
- **CI/CD:** Simplify GitHub secrets references and enhance environment validation
  - Simplify PM Studio secrets naming from KOSMOS_PM_STUDIO_* to direct variable names
  - Add environment variable validation checks for Windows (PowerShell) builds
  - Add environment variable validation checks for Linux/macOS (Bash) builds
  - Enhance .env.local verification with detailed variable status reporting
  - Improve debugging capabilities for CI/CD pipeline configuration issues

## [1.19.29] - 2026-01-26

### Documentation
- **Architecture:** Add Kosmos architecture documentation with layered design diagrams
  - Add comprehensive architecture documentation including layered architecture diagram
  - Add data flow architecture showing component interactions
  - Add core module relationship diagram and directory structure overview
  - Add technology stack summary and design principles documentation
  - Include HTML and PPT versions for presentation purposes

## [1.19.28] - 2026-01-26

### Improvements
- **CI/CD:** Add PM Studio environment variables to CI/CD pipeline
  - Configure PM Studio specific environment settings in release workflow
  - Enhance multi-brand build support in GitHub Actions

## [1.19.27] - 2026-01-26

### New Features
- **Placeholder:** Add PM Studio environment variable placeholders
  - Add placeholder support for PM Studio environment configuration
  - Enable dynamic environment variable substitution

## [1.19.26] - 2026-01-25

### New Features
- **LLM:** Update GitHub Copilot models configuration
  - Add latest model configurations and capabilities
  - Enhance model selection options
- **LLM:** Change default model to Claude Opus 4.5
  - Update default model for improved performance
  - Optimize model selection strategy
- **Compression:** Add SKILL.md tool call preservation feature
  - Preserve tool call information in SKILL.md files
  - Enhance compression algorithm capabilities
- **MCP:** Add safe HTML reading tool with structure-first approach
  - Implement safe HTML content reading functionality
  - Prioritize document structure in HTML parsing
- **Branding:** Add Send Feedback menu item to user profile menu
  - Enable users to submit feedback directly from profile menu
  - Improve user feedback collection mechanism
- **Settings:** Enhance About page with real-time update status integration
  - Display real-time application update status
  - Integrate update information into About page
- **Settings:** Add About page with brand info and version display
  - Show comprehensive brand and version information
  - Enhance application transparency
- **Memory:** Restrict context enhancement to dev environment only
  - Limit memory context enhancement to development mode
  - Optimize production performance
- **Chat:** Add Alt+Enter shortcut for newline in textarea
  - Support multi-line input with keyboard shortcut
  - Improve chat input user experience
- **Chat:** Convert mention syntax to markdown format before sending
  - Transform mention syntax for better compatibility
  - Standardize message format
- **UI:** Implement dynamic width adjustment for LeftNavigation component
  - Add responsive width adjustment for navigation
  - Enhance UI flexibility

### Improvements
- **LLM:** Migrate internal LLM calls to claude-haiku-4.5 and remove deprecated models
  - Replace deprecated model references with claude-haiku-4.5
  - Clean up obsolete model configurations
  - Improve internal LLM call consistency
- **Builtin Tools:** Optimize read_file tool with streaming pagination to prevent memory overflow
  - Implement streaming pagination for large files
  - Prevent memory overflow issues
  - Enhance file reading performance
- **Renderer:** Fix inline code rendering in markdown components
  - Improve code block rendering quality
  - Optimize markdown display
- **Settings:** Reorder Runtime navigation item position
  - Adjust navigation item order for better UX
  - Improve settings page organization
- **FRE:** Unify FRE completion behavior for KOSMOS and PM Studio
  - Standardize first-run experience across brands
  - Improve onboarding consistency
- **UI:** Improve window and input area responsive design
  - Enhance responsive layout behavior
  - Optimize UI for different screen sizes
- **Chat:** Standardize workspace mention format with @workspace: prefix
  - Unify workspace mention syntax
  - Improve mention consistency
- **Chat:** Increase textarea height to display 2 lines
  - Enlarge input area for better visibility
  - Improve text editing experience
- **UI:** Rename Demo badge to Example badge
  - Update badge terminology for clarity
  - Improve labeling consistency

### Bug Fixes
- **Update:** Refactor update installation to use UpdateProvider method
  - Fix update installation mechanism
  - Improve update reliability
- **UI:** Remove temporary update button display override
  - Clean up temporary UI override code
  - Restore normal update button behavior
- **UI:** Hide Kosmos attribution text for Kosmos brand
  - Fix brand-specific attribution display
  - Improve brand consistency
- **Chat:** Fix ChatView route sync issues after FRE completion and app startup
  - Resolve route synchronization problems
  - Ensure proper navigation after setup
- **Avatar:** Add version-based cache busting for agent avatars
  - Prevent avatar caching issues
  - Ensure latest avatars are displayed
- **Chat:** Fix mention highlight breaking on paths with spaces
  - Resolve mention parsing issues with spaces
  - Improve path handling in mentions
- **Chat:** Improve @mention context menu path display format
  - Enhance path display in mention menus
  - Improve visual clarity
- **Chat:** Prevent horizontal scrollbar in assistant message with wide content
  - Fix layout overflow issues
  - Improve message container responsiveness
- **Terminal:** Fix PowerShell command quoting for commands with inline arguments
  - Correct command argument handling in PowerShell
  - Ensure proper quoting for complex commands

### Style
- **Markdown:** Update inline code background color in light mode
  - Adjust inline code styling for better visibility
  - Improve light mode appearance
- **Chat:** Refactor ChatSession more button styles and layout
  - Optimize button styling and positioning
  - Enhance visual design
- **Markdown:** Improve table responsive layout and text wrapping
  - Enhance table display on different screen sizes
  - Improve text wrapping in table cells
- **UI:** Refactor chat input textarea padding and height calculation
  - Optimize input area layout
  - Improve spacing and dimensions

### Security

## [1.19.25] - 2026-01-22

### New Features
- **Chat:** Add #skill:{name} mention support in chat input
  - Enable users to reference skills directly in chat messages using @ mentions
  - Improve skill discovery and accessibility in conversations
- **Updater:** Add multi-brand executable support for Windows updater
  - Support multiple brand executables in Windows update process
  - Enable flexible brand-specific update configurations
- **FRE:** Add primary agent auto-selection for KOSMOS brand
  - Automatically select primary agent during first run experience
  - Improve onboarding flow for KOSMOS brand users

### Improvements
- **Agent:** Move primaryAgent auto-selection from backend to frontend
  - Relocate agent selection logic for better user experience control
  - Improve frontend state management for primary agent
- **Chat:** Improve input placeholder with feature hints
  - Update placeholder text to guide users on available features
  - Enhance discoverability of chat capabilities

### Bug Fixes
- **i18n:** Change at-mention toast messages from Chinese to English
  - Internationalize toast notifications for at-mention features
  - Ensure consistent English language throughout the application
- **Chat:** Fix at-mention file/folder selection in ChatInput
  - Resolve issues with file and folder selection via @ mentions
  - Improve reliability of context menu interactions
- **Terminal:** Fix PowerShell command quoting for commands with inline arguments
  - Correct command argument handling in PowerShell execution
  - Ensure proper quoting for complex command strings

## [1.19.24] - 2026-01-22

### Improvements
- **FRE:** Redesign FreOverlay setup page per Figma specification
  - Implement new visual design and layout for first run experience
  - Enhance user onboarding flow with improved UI/UX

### Bug Fixes
- **FRE:** Restore FRE detection logic and remove debug code
  - Fix first run experience detection mechanism
  - Clean up development debugging artifacts
- **FRE:** Show Windows title bar during FRE overlay
  - Ensure proper window chrome display during setup flow

### Others
- **FRE:** Force display FRE View for development debugging
  - Add development utility for FRE testing

## [1.19.23] - 2026-01-22

### New Features
- **FRE:** Add Journeys Agent installation with remote asset import
  - Implement remote asset fetching and installation for Journeys Agent
  - Enable automatic agent configuration during first run experience
- **Agent:** Add import agent assets from zip package
  - Support importing agent configurations and resources from zip files
  - Enhance agent deployment flexibility with package-based installation

### Improvements
- **Agent Chat:** Remove deprecated switchToChat API and unify with startNewChatFor
  - Consolidate chat switching logic into single unified method
  - Improve code maintainability and reduce API surface

## [1.19.22] - 2026-01-22

### Bug Fixes
- **Build:** Fix Windows install path to use brandName instead of productName
  - Update `getAppInstallPath()` in updateManager to use `BRAND_NAME` for Windows
  - Prevents path issues when productName contains spaces (e.g., "PM Studio" → "pm-studio")
  - Ensures Windows update path matches electron-builder NSIS install directory

### Improvements
- **Build:** Add executableName config to prevent spaces in Windows exe filename
  - Configure `executableName` in electron-builder to use `filenamePrefix`
  - Prevents "PM Studio.exe" issues, uses "PM-Studio.exe" instead
  - Resolves CMD parsing errors and update failures on Windows

### Documentation
- **Build:** Add comprehensive multi-brand configuration documentation
  - Document Windows/macOS installation paths in electron-builder.config.js
  - Add path configuration comments to brand config.json files
  - Document User Data Path resolution in bootstrap.ts
  - Add detailed ZIP update flow documentation in updateManager.ts

## [1.19.21] - 2026-01-22

### Improvements
- **CI/CD:** Add brand parameter to macOS build commands
  - Add --brand=kosmos parameter to macOS ARM64 and x64 build commands for Kosmos brand
  - Add --brand=pm-studio parameter to macOS ARM64 and x64 build commands for PM-Studio brand
  - Ensure proper brand-specific configuration during macOS builds

## [1.19.20] - 2026-01-21

### Improvements
- **CI/CD:** Add ZIP file and blockmap upload for macOS auto-update
  - Add notarization input artifact download step for all macOS builds (Kosmos/PM-Studio ARM64/x64)
  - Add ZIP file upload logic for ARM64 and x64 builds
  - Add blockmap file upload for DMG and ZIP files
  - Support auto-update functionality on macOS platform

## [1.19.19] - 2026-01-21

### Bug Fixes
- **CI/CD:** Preserve symlinks in macOS artifact uploads using tar
  - GitHub Actions artifact upload doesn't preserve symlinks, causing Electron Framework.framework to expand from ~159MB to ~477MB
  - Add tar packaging step before artifact upload for all macOS builds (kosmos arm64/x64, pm-studio arm64/x64)
  - Add tar extraction step after artifact download in packaging jobs to restore symlink structure
  - Add symlink verification logging for Electron Framework

## [1.19.18] - 2026-01-21

### Improvements
- **CI/CD:** Enable code signing and notarization for macOS builds
  - Replace build-only mode with full build+sign+notarize workflow
  - Add Apple signing environment variables (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, CSC_LINK, CSC_KEY_PASSWORD)
  - Use npm run dist:mac:arm64/x64 instead of manual electron-builder commands
  - Add artifact upload steps for macOS app and notarization submission-id
  - Apply changes to all 4 macOS build jobs (Kosmos/PM-Studio arm64/x64)

## [1.19.17] - 2026-01-21

### Improvements
- **CI/CD:** Re-enable macOS notarization and packaging pipeline stages
  - Re-enable notarize-macos-kosmos, package-macos-kosmos jobs
  - Re-enable notarize-macos-pm-studio-x64, package-macos-pm-studio-x64 jobs
  - Add detailed logging for notarization and packaging stages
  - Add DMG creation debug logging and output analysis
  - Update validate/notify job dependencies to wait for package stages
  - Add artifact upload for package debugging analysis

### Others
- **Access Control:** Upgrade team member permissions from Read to Write
  - Update team member access permissions in ACL configuration
- **GitHub:** Update repository access control and branch protection policies
  - Improve repository governance and security settings

## [1.19.16] - 2026-01-21

### New Features

### Improvements
- **CI/CD:** Add BRAND environment variable to release workflow builds
  - Add BRAND=kosmos for kosmos build jobs
  - Add BRAND=pm-studio for pm-studio build jobs
  - Improve multi-brand build identification in CI/CD pipeline

### Bug Fixes

### Security

## [1.19.15] - 2026-01-21

### New Features

### Improvements
- **CI/CD:** Simplify macOS build workflow for debugging
  - Remove notarization and packaging steps for macOS builds
  - Add detailed logging for electron-builder configuration
  - Upload build artifacts for analysis instead of publishing
  - Temporarily disable multi-stage pipeline to isolate build issues
  - Update job dependencies to reflect simplified workflow

### Bug Fixes

### Security

## [1.19.14] - 2026-01-21

### New Features

### Improvements

### Bug Fixes
- **CI/CD:** Add electron-builder config file parameter to GitHub Actions workflow
  - Add --config electron-builder.config.js parameter to electron-builder commands in release workflow
  - Ensure proper configuration loading for DMG packaging on both arm64 and x64 architectures
  - Fix electron-builder commands to use explicit configuration file reference
  - Improve build consistency across all macOS build jobs

### Security

## [1.19.13] - 2026-01-21

### Improvements
- **CI/CD:** Upgrade deprecated macOS runners and simplify build targets
  - Update GitHub Actions workflow to use latest macOS runners
  - Simplify build target configuration for better maintainability
  - Improve build pipeline reliability and performance

### Others
- **Access Control:** Update maintainer permissions in ACL configuration
  - Update team member access permissions
  - Improve repository access control management

## [1.19.12] - 2026-01-21

### Improvements
- **CI/CD:** Remove timeout limits for macOS build jobs
  - Remove 30-minute timeout constraints from macOS build workflows
  - Allow longer build times when needed for notarization and signing processes
  - Improve build reliability by preventing premature timeout failures

### Dependency Updates
- **Security:** Update diff dependency from 4.0.2 to 4.0.4
  - Bump diff package to latest version for security improvements
  - Address potential security vulnerabilities in diff processing

### Bug Fixes

### Security

## [1.19.11] - 2026-01-21

### Bug Fixes
- **CI/CD:** Replace architecture-specific build commands with dedicated npm scripts
  - Fix CI/CD pipeline by replacing direct architecture flags with npm scripts
  - Improve build workflow maintainability and cross-platform compatibility
  - Enhance build process reliability and error handling

### Security

## [1.19.10] - 2026-01-20

### New Features
- **CI/CD:** Add macOS x64 build pipeline for both KOSMOS and PM-Studio brands
  - Implement dual-architecture support for broader macOS compatibility
  - Enable x64 builds alongside existing arm64 builds for comprehensive coverage
- **Authentication:** Add automatic device code clipboard copy on sign-in
  - Automatically copy device authentication codes to clipboard for user convenience
  - Streamline the GitHub OAuth authentication flow
- **Authentication:** Integrate Microsoft SSO for GitHub authorization flow
  - Add Microsoft Single Sign-On integration for enhanced authentication options
  - Improve user authentication experience with enterprise SSO support

### Improvements
- **CI/CD:** Optimize macOS build workflow to arm64 architecture only
  - Streamline build process by focusing on primary arm64 architecture
  - Reduce build complexity and improve pipeline efficiency
- **CI/CD:** Optimize GitHub Actions release workflow structure
  - Refactor workflow organization for better maintainability
  - Enhance release pipeline structure and configuration management

### Bug Fixes
- **Authentication:** Make user email optional in validation
  - Fix validation logic to properly handle cases where email is not provided
  - Improve authentication flexibility for different user scenarios
- **Authentication:** Fix cache cleanup and state management during user sign-out
  - Ensure proper cleanup of cached data when users sign out
  - Improve state management consistency during logout process

### Security

## [1.19.9] - 2026-01-20

### Improvements
- **CI/CD:** Restructure release workflow with multi-arch support
  - Reorganize GitHub Actions release workflow architecture
  - Enhance multi-architecture build support and configuration
  - Improve build process efficiency and maintainability
  - Optimize release pipeline for better cross-platform compatibility

### Bug Fixes

### Security

## [1.19.8] - 2026-01-20

### New Features
- **FRE:** Add brand-specific installation flow for Kosmos and PM Studio
  - Implement brand detection via isPmStudioBrand() helper function
  - Skip MCP Servers, Skills, and PM Agent installation for Kosmos brand
  - Conditionally render setup steps based on brand configuration
  - Optimize FRE flow to only install PM Studio specific components when needed
  - Maintain backward compatibility with PM Studio's full installation workflow

### Improvements

### Bug Fixes

### Security

## [1.19.7] - 2026-01-20

### New Features
- **FRE:** Add runtime mode configuration in setup flow
  - Implement runtime mode selection during first run experience
  - Allow users to choose between internal and system runtime modes
- **Runtime:** Change default runtime mode to system
  - Set system runtime mode as default for better compatibility
  - Improve runtime initialization and configuration

### Bug Fixes
- **CI/CD:** Add retry mechanism for macOS build hdiutil resize failures
  - Implement 3-attempt retry logic with 15-second delays between retries
  - Add automatic cleanup of failed build artifacts before retry
  - Apply retry mechanism to both kosmos and pm-studio brand builds
  - Resolve intermittent hdiutil resize failures during DMG creation

## [1.19.6] - 2026-01-20

### Improvements
- **CI/CD:** Simplify release workflow dependency installation
  - Optimize GitHub Actions workflow dependency management
  - Streamline npm installation process in CI/CD pipeline
  - Reduce build time and improve workflow efficiency

### Others
- **Dependencies:** Refactor @noble/hashes dependency structure
  - Restructure @noble/hashes package dependency organization
  - Improve dependency management and maintainability
  - Optimize package structure for better compatibility

## [1.19.5] - 2026-01-20

### Improvements
- **Update Manager:** Improve brand configuration handling in update manager
  - Replace process.env.BRAND_CONFIG with imported BRAND_CONFIG constant
  - Remove TypeScript @ts-ignore suppressions for cleaner code
  - Add dynamic multi-brand support for app installation paths
  - Use BRAND_CONFIG.productName for cross-platform installation directory resolution
  - Improve code maintainability and type safety

## [1.19.4] - 2026-01-20

### Bug Fixes
- **Logger:** Prevent EPIPE errors during app shutdown
  - Add global EPIPE/EIO error handlers for stdout/stderr streams in main.ts
  - Implement safeConsoleWrite method in LogEntryManager to catch console write errors
  - Extend safeConsole utility to handle EPIPE errors in addition to EIO errors
  - Ensure graceful handling of closed pipe scenarios during application exit
- **CI/CD:** Resolve npm ci package-lock.json sync issues
  - Replace conditional dry-run check with proactive cache cleanup
  - Clear npm cache, remove node_modules and package-lock.json before install
  - Regenerate package-lock.json using npm install --package-lock-only
  - Remove --prefer-offline flag to ensure fresh dependency resolution
  - Apply fix to all 6 CI jobs (Windows/macOS for KOSMOS and PM-Studio)

## [1.19.3] - 2026-01-19

### New Features
- **FRE:** Add avatar field support for agent configuration
  - Implement avatar field in agent profile structure
  - Enable custom avatar configuration during first run experience
- **Agent:** Add avatar support for agent profile
  - Support custom avatar images for agent profiles
  - Enhance agent visual customization capabilities
- **UI:** Add copy functionality for tool call sections
  - Implement copy button for tool call content
  - Improve user interaction with tool outputs
- **Cache:** Implement Quick Start image caching with auto-invalidation
  - Add automatic image caching for quick start resources
  - Implement cache invalidation mechanism for stale content
- **Chat:** Add chat session download to Downloads folder
  - Enable exporting chat sessions to local Downloads directory
  - Provide session backup and export functionality
- **Chat:** Enhance file attachment display with deletion status tracking
  - Show deletion status for file attachments
  - Improve file attachment management in chat
- **Chat:** Add file path extraction for history messages
  - Extract and display file paths from chat history
  - Enhance file reference capabilities in messages
- **MCP:** Add CreateFileTool and WriteFileTool for direct file operations
  - Implement direct file creation capability
  - Add direct file writing functionality for MCP tools
- **Terminal:** Implement unified terminal instance manager with cross-platform support
  - Create unified terminal management system
  - Support consistent terminal operations across platforms
- **MCP:** Enhance error reporting with stderr capture and persistent toast notifications
  - Capture and display stderr output from MCP servers
  - Add persistent toast notifications for connection errors

### Improvements
- **Runtime:** Optimize runtime setup by reusing local python/bun/uv
  - Detect and reuse existing local runtime installations
  - Reduce setup time and avoid redundant downloads
- **Windows:** Optimize Windows Startup Speed
  - Implement startup performance optimizations for Windows
  - Reduce application launch time on Windows platform
- **FRE:** Relax Python version requirement to 3.10.0
  - Lower Python version requirement from 3.11 to 3.10
  - Improve compatibility with existing Python installations
- **Runtime:** Implement fast Python version discovery for FRE
  - Add rapid Python version detection during setup
  - Optimize first run experience initialization
- **UI:** Improve text selection visibility in tool call sections
  - Enhance text selection contrast and visibility
  - Improve readability when selecting tool call content
- **UI:** Improve code block text selection visibility
  - Optimize code block selection styling
  - Enhance user experience when copying code
- **UI:** Refactor inline code and code block styling system
  - Unify code styling across the application
  - Improve code display consistency
- **Styles:** Centralize font system and remove redundant CSS rules
  - Consolidate font definitions into single system
  - Clean up duplicate and unused CSS styles
- **MCP:** Improve toast auto-dismiss logic for connection status changes
  - Smart auto-dismiss for transient connection states
  - Keep important error messages visible longer
- **MCP:** Improve error diagnostics and logging system
  - Enhanced error messages with contextual information
  - Improved debugging capabilities for MCP issues
- **MCP:** Add connection failure notification with auto-retry support
  - Notify users of connection failures
  - Implement automatic retry mechanism for failed connections
- **MCP:** Replace toast progress bar with countdown timer
  - Show countdown timer for auto-dismissing notifications
  - Improve user awareness of notification timing
- **Chat:** Change quick starts list from dynamic card count to horizontal scroll
  - Implement horizontal scrolling for quick start cards
  - Improve space utilization and browsing experience
- **Config:** Separate product name and user data directory naming
  - Decouple product display name from data directory
  - Improve flexibility in product branding
- **Toolbar:** Disable toolbar functionality and UI for non-kosmos brands
  - Add brand-specific feature control
  - Disable toolbar for non-kosmos branded versions
- **Docs:** Add unified data structure refactoring proposal
  - Document data structure improvements
  - Propose standardized data organization
- **Docs:** Add nested code block formatting rules
  - Define formatting standards for nested code blocks
  - Improve documentation clarity

### Bug Fixes
- **Runtime:** Correct UV Python installation path on Windows
  - Fix incorrect UV Python path resolution on Windows
  - Ensure proper Python environment setup
- **Runtime:** Add timeout protection and enhanced logging for uv python list
  - Prevent hanging during Python version detection
  - Add detailed logging for troubleshooting
- **UI:** Fix window minimum size and chat textarea height
  - Correct minimum window dimensions
  - Fix chat input area height calculation
- **UI:** Hide update button for ON-DEVICE items
  - Hide inappropriate update button for local items
  - Improve UI consistency for device-stored resources
- **MCP:** Fix MCP server status display issue during reconnection
  - Correct status indicators during reconnect attempts
  - Improve connection state visualization
- **Chat:** Fix file attachment path regression
  - Restore correct file path handling for attachments
  - Fix file attachment display issues

### Documentation
- **Refactor:** Add unified data structure refactoring proposal
  - Comprehensive data structure improvement plan
  - Migration strategy documentation

### Security

## [1.19.2] - 2026-01-15

### Improvements
- **CI/CD:** Improve macOS release workflow with gh cli upload
  - Replace electron-builder publish with gh cli for better reliability
  - Add automatic upload of DMG, blockmap, and latest-mac.yml files
  - Support --clobber flag to handle existing release assets
  - Improve error handling with explicit fallback messages
- **Runtime:** Refactor runtime installation to main process direct execution
  - Remove subprocess spawning to avoid Electron app execution issues
  - Implement direct download and extraction methods for Bun and uv
  - Add HTTP redirect handling for GitHub release downloads
  - Support cross-platform archive extraction (zip and tar.gz)
  - Improve error handling and resource cleanup in installation flow
  - Enhance logging for better debugging and monitoring

### Bug Fixes

### Security

## [1.19.1] - 2026-01-15

### Improvements
- **CI/CD:** Improve DMG packaging and publishing workflow
  - Use --prepackaged option to create DMG from existing .app without repackaging
  - Add automatic .app file path detection and validation
  - Replace custom npm scripts with direct electron-builder commands
  - Add BRAND environment variable for better context
  - Improve error handling with explicit validation checks
  - Apply same improvements to both kosmos and pm-studio workflows

## [1.19.0] - 2026-01-15

### New Features
- Add PM Studio MCP Server and PM Agent auto-installation
  - Implement automatic installation flow for PM Studio MCP Server during FRE setup
  - Add PM Agent auto-setup and configuration during first run experience
  - Enhance FRE workflow with multi-server support and UTF-8 handling improvements
- Add automatic Playwright browser installation check
  - Implement builtin tools with automatic browser installation detection
  - Ensure Playwright browsers are available before executing browser automation tasks
- Implement internal runtime mode as default with automatic FRE setup
  - Set internal runtime as default mode for better out-of-box experience
  - Add automatic First Run Experience (FRE) setup workflow
  - Remove PM Agent setup flow from FRE overlay for streamlined onboarding
- Enhance Python runtime management with uv integration
  - Integrate uv for improved Python environment management
  - Add Python runtime version control and dependency management
  - Optimize MCP command execution with enhanced runtime support

### Improvements
- Enhance FRE setup reliability and debugging
  - Improve error handling and logging in FRE setup process
  - Add UTF-8 encoding support for better cross-platform compatibility
  - Enhance multi-server setup workflow reliability
- Split RuntimeSettings into modular components
  - Create RuntimeSettingsView, RuntimeSettingsContentView, RuntimeSettingsHeaderView
  - Improve code maintainability and component reusability
  - Enhance settings UI organization and structure
- Enhance internal runtime PATH management with bin directory priority
  - Prioritize internal runtime bin directories in PATH configuration
  - Improve runtime executable discovery and resolution
  - Optimize environment variable setup for better runtime isolation
- Centralize environment variable management in TerminalInstance
  - Consolidate environment variable logic in terminal management
  - Improve cross-platform environment setup consistency
  - Enhance terminal process environment configuration
- Simplify environment management and remove shim generation
  - Remove unnecessary shim generation complexity
  - Streamline runtime environment configuration
  - Reduce maintenance overhead and improve reliability

### Bug Fixes
- Fix terminal PATH case-sensitivity in Windows env setup (#19)
  - Resolve Windows PATH environment variable case-sensitivity issues
  - Ensure consistent PATH handling across different Windows configurations
  - Improve terminal environment setup reliability on Windows
- Fix macOS menu template array index out of bounds error (#18)
  - Resolve menu template indexing issues on macOS
  - Prevent application crashes from invalid menu configurations
  - Enhance macOS menu system stability

### Build
- Remove dmg background configuration
  - Simplify macOS DMG build configuration
  - Remove custom background image setup for DMG installer
  - Streamline build process for macOS distribution

### Others
- Update icon (#20)
  - Refresh application icon design
  - Update icon assets for better visual consistency

## [1.18.17] - 2026-01-14

### New Features
- Add built-in runtime management support (Bun & uv)
  - Implement internal runtime management system
  - Add Bun and uv runtime integration
  - Support Python version control
  - Add PATH shims management
  - Optimize MCP command execution
  - Configure bun cache directory path

### Improvements
- Standardize product naming and app identifiers
  - Update kosmos productName from 'KOSMOS' to 'kosmos-app' for consistency
  - Update pm-studio productName from 'PM Studio' to 'pm-studio-app' for consistency
  - Update pm-studio appId from 'com.pmstudio.app' to 'com.pm-studio.app' with hyphen notation
  - Add optional sqlite-vec-linux-arm64 dependency in package-lock.json

### Bug Fixes

### Security

## [1.18.16] - 2026-01-14

### New Features

### Improvements
- **Assets:** Reorganize brand icon resources and clean up legacy files
  - Remove legacy Kosmos brand icon files from brands/kosmos/assets/
  - Remove duplicate PM Studio iconset and legacy naming conventions
  - Update PM Studio icon assets with optimized versions
  - Add centralized icon resources in resources/icons/
  - Update brand configuration files for Kosmos and PM Studio
  - Optimize icon generation script for PM Studio
- **UI:** Update quick start card description text color
  - Improve visual consistency and readability

### Bug Fixes

### Documentation
- **Auth:** Update GitHub Copilot authentication instructions
  - Improve setup documentation clarity

### Security

## [1.18.15] - 2026-01-14

### New Features

### Improvements
- **CI/CD:** Replace BRAND environment variable with explicit --brand flag in release workflow
  - Remove BRAND environment variable from all build jobs for kosmos and pm-studio
  - Use explicit --brand=kosmos and --brand=pm-studio flags in build commands
  - Hardcode brand paths in verification scripts for better clarity and maintainability
  - Add explicit shell: powershell declarations for Windows jobs to ensure consistent behavior
  - Improve workflow maintainability by reducing environment variable complexity

### Bug Fixes

### Security

## [1.18.14] - 2026-01-14

### New Features

### Improvements
- **CI/CD:** Split macOS notarization into three-stage workflow
  - Split macOS build into three separate jobs for better timeout handling
  - Stage 1: Build, sign and submit notarization without waiting (30min timeout)
  - Stage 2: Wait for notarization completion with dedicated job (150min timeout)
  - Stage 3: Staple ticket, create DMG and publish to GitHub Release (30min timeout)
  - Add standalone scripts for notarization waiting ([`scripts/wait-notarization.js`](scripts/wait-notarization.js:1)) and stapling ([`scripts/staple-app.js`](scripts/staple-app.js:1))
  - Save submission-id.txt for cross-job communication via artifacts
  - Keep temporary zip file for verification when not waiting
  - Update job dependencies to ensure correct execution order

### Bug Fixes

### Security

## [1.18.13] - 2026-01-14

### New Features

### Improvements

### Bug Fixes
- **macOS Signing:** Fix CI notarization flow to resolve Gatekeeper warning
  - Change `APPLE_NOTARIZE_WAIT` from `false` to `true` to ensure complete notarization flow
  - Full flow: codesign → notarize (wait for completion) → staple → package DMG/ZIP
  - Fix "Apple could not verify KOSMOS is free of malware" warning encountered by users after download
  - See [docs/macos-notarization-fix.md](docs/macos-notarization-fix.md) for details

### Security

## [1.18.12] - 2026-01-14

### New Features

### Improvements
- **CI/CD:** Split multi-brand release workflow into separate jobs
  - Refactor from matrix strategy to brand-specific jobs (build-windows-kosmos, build-windows-pm-studio, build-macos-kosmos, build-macos-pm-studio)
  - Improve job isolation for better debugging and independent failure handling
  - Enhance build log clarity by separating brand-specific build processes
  - Update job dependencies in validate and notify steps to reflect new architecture
  - Maintain all original build steps and configurations for each brand

### Bug Fixes

### Security

## [1.18.11] - 2026-01-14

### New Features

### Improvements
- **CI/CD:** Add brand parameter support to build and publish commands
  - Add --brand parameter to npm run build commands for Windows and macOS
  - Add --brand parameter to dist:publish commands for both platforms
  - Ensure brand-specific configurations are properly passed during CI/CD pipeline
  - Improve build workflow flexibility for multi-brand support

### Bug Fixes

### Security

## [1.18.10] - 2026-01-14

### New Features

### Improvements
- **CI/CD:** Optimize notarization to prevent GitHub Actions timeout
  - Add 60-minute timeout for macOS build job
  - Add APPLE_NOTARIZE_WAIT environment variable to skip waiting
  - Modify notarization script to support submit-only mode
  - Improve logging to show wait status and submission ID

### Bug Fixes

### Security

## [1.18.9] - 2026-01-14

### New Features

### Improvements

### Bug Fixes
- **CI/CD:** Resolve @vscode/ripgrep 403 error in GitHub Actions
  - Add GITHUB_TOKEN to npm ci steps to avoid API rate limits
  - Add --prefer-offline and --no-audit flags to optimize installation
  - Apply fix to both Windows and macOS build workflows
  - Add comprehensive documentation in docs/ci-ripgrep-fix.md

### Security

## [1.18.8] - 2026-01-14

### New Features

### Improvements
- **Build:** Reorganize notarization script helper functions
  - Restructure function definitions in notarize.js for better code readability
  - Move getNotarizationLog and stapleApp functions before main export
  - Improve logical flow and maintainability of notarization workflow

### Bug Fixes

### Security

## [1.18.7] - 2026-01-14

### Improvements
- Improve notarization polling mechanism to prevent timeout issues
  - Replace synchronous `--wait` approach with manual status polling
  - Implement 30-second polling interval with 30-minute maximum wait time
  - Add detailed logging for each polling attempt with elapsed time
  - Enhance error handling and retry logic for network issues
  - Improve notarization reliability and reduce timeout failures

## [1.18.6] - 2026-01-14

### New Features
- Implement multiple branding support (#15)
  - Add support for managing multiple brand configurations
  - Enable brand-specific customization and theming

### Improvements
- Replace @electron/notarize with direct notarytool usage
  - Refactor build script to use notarytool directly instead of deprecated @electron/notarize
  - Improve notarization reliability and performance
  - Streamline macOS code signing workflow

### Bug Fixes

### Others
- Bump hono from 4.11.3 to 4.11.4 (#16)
  - Update hono dependency for bug fixes and performance improvements

## [1.18.5] - 2026-01-14

### Bug Fixes
- **Build:** Improve notarytool credential validation
  - Remove unsupported --limit flag from notarytool history command
  - Increase timeout from 30s to 60s for better reliability
  - Add handling for 'no submissions' case to properly validate credentials
  - Improve error detection for valid credentials with empty submission history

## [1.18.4] - 2026-01-14

### Improvements
- **Build:** Optimize mac build targets and enhance notarization
  - Remove x64 architecture build targets, focus on arm64 only
  - Add credential validation before notarization process
  - Implement validateCredentials helper with xcrun notarytool check
  - Improve error messages for credential validation failures

## [1.18.3] - 2026-01-13

### Bug Fixes
- **Build:** Disable built-in notarize and use afterSign script instead
  - Switch from electron-builder's built-in notarization to custom script approach
  - Improve macOS notarization reliability and error handling
  - Enhance build process flexibility for macOS distribution

## [1.18.2] - 2026-01-13

### New Features
- **Build:** Enable macOS code signing and notarization
  - Add macOS code signing configuration support
  - Implement notarization workflow for macOS builds
  - Enhance build security and distribution capability

### Improvements
- **Icons:** Add PM Studio icon generation system
  - Implement icon generation script for PM Studio
  - Support multiple icon sizes and formats
  - Streamline icon asset management workflow

### Bug Fixes

### Others

## [1.18.1] - 2026-01-13

### New Features
- **LLM:** Upgrade default model to claude-sonnet-4.5
  - Set claude-sonnet-4.5 as new default model for enhanced performance
- **Agent:** Add zero_states and prompts support for agent library
  - Enable agent zero states configuration for initial display
  - Add support for custom prompts in agent library structure
- **Chat:** Add Zero States component for empty chat experience
  - Implement ChatZeroStates component for better empty state UX
  - Display agent quick start cards and initial prompts

### Improvements
- **Fetcher:** Extract cache-busting URL utility and apply to all CDN requests
  - Create reusable getCacheBustedUrl function
  - Apply cache-busting to agent, MCP, and skill library fetchers
- **Chat:** Rename ChatContentView to ChatViewContent
  - Update component naming for better consistency
- **GHC Config:** Cleanup unused config and update default model
  - Remove deprecated configuration options
  - Update default model references

### Bug Fixes
- **IPC:** Prevent WebContents access after window destruction
  - Add safety checks before accessing window.webContents
  - Fix potential crashes on window close
- **Profile Sync:** Fix remote version update not reflecting in frontend UI
  - Ensure remoteVersion changes trigger UI updates
  - Fix profile sync data flow issues
- **Config:** Migrate development CDN URL from internal to public endpoint
  - Update CDN configuration for better accessibility

### Others
- **UI:** Optimize quick start card image dimensions
  - Adjust image sizing for better visual consistency
- **Agent:** Update PM Agent quick_starts image URLs
  - Update asset references to latest versions
- **Dependencies:** Upgrade dependencies to latest versions
  - Bump @modelcontextprotocol/sdk from 1.24.0 to 1.25.2
  - Bump @smithy/config-resolver from 4.2.2 to 4.4.5
  - Bump react-router and react-router-dom to latest versions

## [1.18.0] - 2026-01-12

### New Features
- **Agent:** Add Update button for MCP servers and Skills with version comparison
  - Implement agent update navigation from chat header
  - Add chat session idle check for agent Update button
  - Add periodic remote library check and profile remoteVersion update
  - Add remoteVersion field to track CDN library versions
- **Agent:** Implement agent duplication functionality
  - Add duplicate agent dialog interaction and UI
  - Add duplicate option for library agents in dropdown menu
- **Agent:** Add workspace configuration support for agents
  - Preserve local workspace when fetching agent config from library
- **Agent:** Implement Custom Agent creation flow with dedicated view
  - Add AgentChatCreationView for new agent creation
  - Add AgentBasicTab for custom agent configuration
- **MCP:** Add configurable prompt URLs for MCP and Agent libraries
  - Differentiate Kobi prompt URLs based on install/update scenarios
- **MCP:** Support automatic KOSMOS variable substitution in MCP config
  - Add ENV merge logic for get_mcp_config_from_lib tool
  - Add version comparison validation for update_mcp_by_config tool
  - Add update_mcp_by_config builtin tool for updating installed MCP servers
  - Implement smart version and source handling for server updates
  - Add version and source badges to MCP server card
  - Implement install/update button logic for MCP Library detail page
- **Skills:** Add update functionality for ON-DEVICE skills
  - Enhance Add from device workflow with version support and smart refresh
- **UI:** Implement custom Windows title bar with Claude-style menu and native controls
  - Update Windows title bar to warm orange theme
  - Add Kobi Agent protection and Windows ARM compatibility
  - Add Built-in badge for Kobi Agent in navigation
  - Add categorized emoji selection with tabbed navigation
- **Chat:** Implement ChatSession fork and improve delete workflow
  - Implement auto-cleanup of associated resources on chat deletion
  - Migrate ChatSession management to independent chatSessionManager
- **Storage:** Implement auto-cleanup of associated resources on chat deletion
- **Terminal:** Implement unified terminal instance manager with cross-platform support
  - Adjust timeout limits for ExecuteCommandTool and VSCodeTransport
  - Enhance shell environment loading for version managers
- **Navigation:** Implement active state for New Agent navigation item
  - Add tab-level URL routing for agent settings view
  - Add smart back navigation from settings page

### Improvements
- **Agent:** Refactor agent editing from modal to dedicated route view
  - Remove deprecated AgentChatEditor component
  - Align AgentChatEditingView styles with AgentChatEditor modal
  - Unify agent editing view header with consistent design system
  - Add tab header to AgentMcpServersTab with summary and actions
  - Add consistent tab header to AgentSkillsTab
  - Refactor System Prompt tab header with nav-consistent styling
- **MCP:** Convert MCP Library from modal to dedicated page view
  - Refactor VSCode importer from modal to route-based architecture
  - Replace McpServerEditor with AddNewMcpServerView components
  - Remove hardcoded requirements check and implement async validation
  - Reorder MCP library detail sections and add requirements warning
  - Implement requirements checking system for MCP Library View
  - Update header title from 'Add from MCP Library' to 'MCP Library'
- **Skills:** Refactor skill modules into dedicated directory
  - Convert SkillLibraryView from modal to routed page
  - Refactor Add from Skill Library button logic for enhanced safety
  - Unify skill management logic and eliminate code duplication
- **Settings:** Restructure settings page with left navigation and content container layout
  - Redesign settings navigation and toolbar settings components
  - Migrate menu state management from AppLayout to SettingsPage
  - Extract dropdown menu components from AppLayout
  - Remove MCP, Skills, Memory entries from left navigation
- **UI:** Improve copy button icons and text localization
  - Fix long text overflow in message containers
  - Enhance primary agent badge and fix menu auto-close
  - Improve agent model dropdown consistency and UX
  - Enhance ChatInput model dropdown layout and remove header
  - Enhance UserInputModal width and contact link visibility
  - Add comprehensive user input handling for MCP server configuration
- **Chat:** Implement ChatSession list auto-refresh after Fork operation
  - Auto-scroll to top when new session is added
  - Improve chat sessions infinite scroll UX with pull-to-load
  - Centralize MCP server operations in mcpClientManager
  - Move runtime state management from profileCacheManager to mcpClientManager
  - Remove deprecated startNewChat method and unify to startNewChatFor
- **Routing:** Implement Router Migration and Basic Routes
  - Unify skill routes to /settings/skills
  - Improve file picker filter defaults and localization
- **AutoUpdate:** Change periodic check interval unit and improve error handling
  - Add agent update button and optimize assets library check timing
- **Style:** Update ChatInput button icons with new design
  - Update copy button icons to stroke style
  - Optimize toolbar style

### Bug Fixes
- **MCP:** Fix prompt URL not configured error in MCP Library view
  - Fix KOSMOS placeholder not being applied when no USER_INPUT fields
  - Fix ENV update rule to clear ENV when not provided
  - Inherit ENV config when override installing from MCP Library
- **Profile:** Add version/source fields validation in ensureV2ProfileIntegrity
- **Agent:** Fix maximum update depth exceeded error on checkbox click
  - Fix skills count to only include actually available skills
  - Inherit workspace when updating or overwriting agent
  - Fix create button validation and unify button style
  - Fix primary badge display issue for non-primary Kobi agent
  - Fix routing and state sync issues when deleting active agent
  - Optimize agent library fetching and update mechanisms
  - Improve agent installation update and overwrite flow
- **UI:** Fix .server-actions CSS pollution in AgentMcpServersTab
  - Unify delete MCP confirmation dialog with delete skill style
  - Remove unnecessary "User cancelled the operation" toast messages
  - Fix edit agent menu tab routing in ChatInput
  - Fix dropdown menus overflow at window bottom
- **Chat:** Prevent training data time hallucination in temporal handling
  - Simplify global system prompt dependency setup guides
- **Workspace:** Auto-create workspace directories to prevent missing path issues
- **Terminal:** Improve terminal process stability with invalid working directory
  - Fix ExecuteCommandTool command parsing and execution failures
- **File:** Resolve file path issue in contextIsolation environment
  - Fix image file reading from file dialog
  - Resolve file attachment path regression
- **Routes:** Fix CreateCustomAgentView routing and navigation issues
- **Update:** Fix update manager initialization timing issue
- **MCP Events:** Remove duplicate MCP event listeners in SettingsPage
  - Remove duplicate event listeners causing double file selector and overlapping views
- **Styles:** Fix thinking-content and tool-calls-section responsive to window width
  - Unify page layout to work with WindowsTitleBar
- **Emoji:** Sync selected emoji and category when currentEmoji prop changes
- **Navigation:** Separate Kobi Agent display below Divider when not primary
  - Ensure chat session state syncs to renderer on page refresh
  - Move WindowsTitleBar to App level for global display

### Documentation
- Add Kobi Agent system prompt example documentation
- Add comprehensive Chinese comments for Install/Update button logic

### Others
- Disable toolbar feature by default
- Migrate inline styles to CSS file and simplify toolbar settings UI
- Consolidate example profiles into single profile.json
- Rebrand app title from KOSMOS to Kosmos AI Studio

## [1.17.11] - 2025-12-22

### New Features
- **Memory:** Disable Memory feature on Windows ARM platform
  - Add platform detection to disable memory functionality on Windows ARM64
  - Prevent incompatibility issues with sqlite-vec on Windows ARM architecture

### Improvements
- **Chat:** Remove FINAL_SUMMARY marker dependency for message classification
  - Simplify message classification logic by removing marker-based approach
  - Improve code maintainability and reduce complexity
- **Builtin Tools:** Rename Kosmos agent visibility tools to Kobi
  - Update tool naming convention for better brand consistency
  - Rename related functions and references across the codebase
- **Memory:** Simplify fact extraction to use only user messages
  - Optimize memory extraction by focusing on user input only
  - Reduce noise from assistant responses in memory storage
- **Memory:** Rename memory database file from memories.db to user_memories.db
  - Improve database file naming clarity
  - Better reflect the purpose of storing user-specific memories

## [1.17.10] - 2025-12-21

### Bug Fixes
- **CI/CD:** Fix electron-rebuild version detection failure in CI pipeline
  - Add `scripts/rebuild-native.js` to dynamically read Electron version from package.json
  - Fix "Unable to find electron's version number" error in postinstall hook
  - Replace Windows PowerShell script with cross-platform Node.js solution
  - Replace macOS shell script with unified rebuild approach

### Improvements
- **Build:** Unify native module rebuild across all platforms
  - Use single `rebuild-native.js` script for Windows, macOS, and Linux
  - Remove platform-specific rebuild scripts (`rebuild-native-windows.ps1`, `rebuild-native.sh`)
  - Simplify npm scripts by removing `rebuild:windows` and `rebuild:mac` commands
  - Eliminate UTF-8 encoding issues in CI environments

## [1.17.9] - 2025-12-20

### Bug Fixes
- **CI/CD:** Fix PowerShell syntax errors in Windows native rebuild script
  - Remove broken try-catch blocks causing parser errors (missing Catch/Finally)
  - Simplify script structure to align with Mac rebuild-native.sh approach
  - Use `$LASTEXITCODE` for proper command result checking instead of try-catch
  - Reduce steps from 6 to 5 by removing redundant verification step
  - Rebuild all native modules instead of only better-sqlite3 for consistency

### Documentation
- **Memory System:** Update comments to specify Better-SQLite3 and sqlite-vec usage

## [1.17.8] - 2025-12-20

### New Features

### Improvements
- Standardize native module rebuild to use @electron/rebuild only
  - Update CI/CD workflows to use official @electron/rebuild instead of deprecated electron-rebuild
  - Simplify Windows PowerShell script to use single correct rebuild method
  - Simplify macOS shell script to eliminate fallback methods
  - Update package.json scripts to use @electron/rebuild as primary tool
  - Upgrade Node.js version from 18 to 22 in CI/CD workflows for consistency
  - Update documentation to reflect @electron/rebuild as the only correct method

### Bug Fixes

### Security

## [1.17.7] - 2025-12-20

### Bug Fixes
- **CI/CD:** Fix PowerShell syntax error in Windows native rebuild script
  - Replace bash-style `||` operator with PowerShell-compatible syntax
  - Use `$LASTEXITCODE` check for proper error handling
  - Fix CI/CD pipeline failure on Windows PowerShell 5.x environments

## [1.17.6] - 2025-12-20

### New Features

### Improvements

### Bug Fixes
- Fix sqlite-vec dynamic library loading issue in macOS CI/CD builds
  - Add sqlite-vec packages to asarUnpack configuration in package.json
  - Implement dual-loading strategy with fallback to direct path resolution
  - Add getSqliteVecDirectPath function for production environment support
  - Enhance error handling with proper TypeScript error type handling
  - Support cross-platform dynamic library loading for all sqlite-vec platforms
  - Fix vec0.dylib loading failure in packaged Electron applications

### Security

## [1.17.5] - 2025-12-20

### New Features

### Improvements

### Bug Fixes
- Fix Windows PowerShell emoji encoding issues in CI/CD pipeline
  - Replace emoji characters with ASCII text alternatives to prevent PowerShell parsing errors
  - Fix ✅ symbols with [OK] status indicators across all Windows build steps
  - Replace ⚠️ warning symbols with [WARN] text in error handling blocks
  - Convert ❌ error symbols to [ERROR] text for failure notifications
  - Replace 📋 info symbols with [INFO] for backup and informational messages
  - Convert 📄 file symbols to [FILE] for file content display
  - Fix ✔️ checkmark with [OK] in package-lock.json regeneration step
  - Resolve 'string missing terminator' PowerShell syntax errors caused by UTF-8 emoji encoding

### Security

## [1.17.4] - 2025-12-20

### Bug Fixes
- **CI/CD:** Resolve Windows CI/CD npm ci EUSAGE error with package-lock sync

## [1.17.3] - 2025-12-20

### New Features

### Improvements

### Bug Fixes
- Fix Windows CI/CD npm config invalid options error
  - Remove invalid npm config set commands for msvs_version and python
  - Use GitHub Actions environment variables instead of npm config
  - Optimize Windows build tools detection to prioritize pre-installed tools
  - Add smarter SDK installation logic that only installs when needed
  - Fix environment variable persistence across CI/CD steps
  - Update documentation with detailed fix explanation

### Security

## [1.17.2] - 2025-12-20

### New Features
- Add Windows-specific native modules rebuild script
  - Create scripts/rebuild-native-windows.ps1 with multiple retry strategies
  - Add comprehensive Windows build environment setup and validation
  - Implement automatic better-sqlite3 functionality testing
- Add comprehensive CI/CD pipeline documentation
  - Create docs/WINDOWS_CI_FIX.md with complete fix analysis and solutions
  - Document Windows native modules compilation issues and resolutions

### Improvements
- Enhance Windows CI/CD pipeline build process
  - Improve Windows SDK and Visual Studio Build Tools setup
  - Add comprehensive build environment validation steps
  - Optimize native modules rebuild process with multiple fallback strategies
- Optimize macOS CI/CD pipeline dependency management
  - Add automatic package-lock.json synchronization check
  - Implement intelligent lock file regeneration for dependency conflicts
  - Enhance build stability with better error handling

### Bug Fixes
- Fix Windows CI/CD npm error code 1 for electron-rebuild better-sqlite3
  - Resolve native modules compilation failures in Windows environment
  - Add multiple rebuild strategies: electron-rebuild → npm rebuild → reinstall
  - Implement comprehensive error handling with continue-on-error mechanism
- Fix macOS CI/CD package-lock.json synchronization issues
  - Resolve npm ci failures caused by dependency version mismatches
  - Add automatic lock file validation and regeneration process
  - Fix missing dependencies from lock file errors
- Improve cross-platform build stability and error recovery
  - Add detailed logging and status reporting for troubleshooting
  - Implement graceful fallback mechanisms for build failures
  - Enhance native modules compatibility across Windows and macOS

### Security

## [1.17.1] - 2025-12-20

### New Features

### Improvements

### Bug Fixes
- Fix electron-rebuild command not found error in macOS CI/CD pipeline
  - Add electron-rebuild package to devDependencies with version ^3.2.9
  - Update postinstall script to use npx and include error handling fallback
  - Enhance GitHub Actions workflow with dedicated native modules rebuild steps
  - Add comprehensive debugging output and environment checks for both platforms
  - Implement graceful error handling to prevent build failures on rebuild issues

### Security

## [1.17.0] - 2025-12-20

### New Features
- Add Gemini-style collapsible thinking section for tool calls
  - Implement collapsible thinking section with tool calls display
  - Add dynamic icons and state management for thinking status
  - Enhance thinking section loading state display with auto-scroll and layout stability
- Add MCP library version and contact fields to MCP library view
  - Enhance MCP server library with additional metadata support
  - Improve MCP server management and discovery capabilities

### Improvements
- Migrate vector store from LibSQL to better-sqlite3 + sqlite-vec
  - Replace LibSQL dependency with better-sqlite3 for enhanced cross-platform compatibility
  - Integrate sqlite-vec for improved vector similarity calculations
  - Add debug logging for vector operations and memory management
- Remove sqlite3 dependency and ensure cross-platform better-sqlite3 support
  - Complete migration from sqlite3 to better-sqlite3 for unified database operations
  - Rebuild better-sqlite3 for correct Node.js version compatibility
  - Add Windows ARM64 support through better-sqlite3 integration
- Optimize streaming message updates with adaptive batching
  - Implement adaptive batching for streaming message rendering
  - Optimize file path extraction with async backend caching
  - Improve streaming message performance and responsiveness
- Enhance chat history conversion logic and status determination
  - Optimize structured chat history architecture and rendering
  - Improve chat history management with structured rendering approach
  - Enhance message classification with FINAL_SUMMARY markers

### Bug Fixes
- Fix vector similarity calculation and add debug logging
  - Correct vector similarity computation algorithms
  - Add comprehensive debug logging for troubleshooting
  - Improve memory management for vector operations
- Fix FINAL_SUMMARY tag placement and handling
  - Add critical prohibition rules for FINAL_SUMMARY tag placement
  - Improve FINAL_SUMMARY marker handling and cleanup in chat messages
  - Ensure thinking sections always render regardless of content
- Fix code block styling and dark theme visibility
  - Improve code block styling for better readability
  - Enhance dark theme visibility and contrast
  - Optimize message container spacing layout

### Refactoring
- Reorganize MCP and skill library configurations
  - Restructure asset fetching configurations for better maintainability
  - Improve MCP and skill library management architecture
  - Enhance configuration modularity and organization

### Security

## [1.16.2] - 2025-12-15

### New Features
- Implement Google-style multi-row image gallery with fixed height and dynamic width
  - Add responsive image gallery layout for better visual presentation
  - Optimize image display with consistent height and adaptive width

### Improvements
- Optimize startup performance with lazy loading mechanisms
  - Implement lazy loading strategies to improve application boot time
  - Enhance resource loading efficiency for better user experience
- Overhaul markdown rendering system with unified styling
  - Migrate inline styles to CSS for better maintainability
  - Consolidate table styles and remove redundant MessageTable.css
  - Improve markdown table styling and layout consistency
- Improve message layout and spacing consistency
  - Enhance message component visual hierarchy and spacing
  - Optimize message display for better readability

### Bug Fixes

### Security

## [1.16.1] - 2025-12-14

### New Features
- Add new GPT-5.x series models (GPT-5.1, GPT-5.1-Codex variants, GPT-5.2) with advanced capabilities
- Update Claude models to latest versions (Sonnet 4, Sonnet 4.5, Haiku 4.5, Opus 4.1/4.5)
- Add Gemini models (2.5 Pro, 3 Pro Preview) with enhanced context windows and vision support

### Improvements
- Update GitHub Copilot model configurations with latest API changes
- Reorganize model categories to include new Claude, GPT, and Gemini groupings
- Synchronize TypeScript model definitions with latest JSON configuration schema
- Update model capabilities including vision support, thinking budgets, and token limits

### Bug Fixes
- Remove deprecated models (GPT-4.1 standalone entry, older GPT-4o versions)

### Security

## [1.16.0] - 2025-12-14

### New Features
- Add First Run Experience (FRE) overlay with PM Agent setup integration
  - Implement FRE overlay UI matching Kosmos design system
  - Add freDone field for First Run Experience tracking
- Enhance agent chat management with session support and primary agent system
  - Add set_primary_agent builtin tool functionality
  - Add Kosmos Agent visibility tools and management system
  - Prevent primary agent from being deleted or hidden
- Add comprehensive builtin tools for agent and MCP management
  - Implement agent initialization logic improvements in ProfileDataProvider
  - Add hideKosmosAgent field with UI integration

### Improvements
- Update development environment setup documentation
  - Update uv version requirement to 0.6.17 for better compatibility
  - Improve PM agent setup guide with version requirements and formatting
  - Add uv 0.6.x LTS version requirement and update instructions
  - Relax Python version requirement from 3.10 to >=3.10 for broader compatibility
- Enhance updater and version management systems
  - Add version check for updater auto-update functionality
  - Improve old version cleanup mechanism in auto-update process
  - Unify local cache filename with remote CDN file naming
- Optimize user interface and experience
  - Improve agent initialization and setup message formatting
  - Enhance Python setup guide with version check logic

### Bug Fixes
- Fix Windows update EBUSY error with overlay strategy implementation
  - Resolve update installation conflicts on Windows platform
  - Implement safer update overlay mechanism

### Security

### Documentation
- Comprehensive update to setup guides and environment configuration
  - Standardize Python and uv installation procedures
  - Improve developer onboarding documentation

## [1.15.13] - 2025-12-10

### New Features
- Add toggle_mcp_by_name builtin tool
  - Implement MCP server toggle functionality by name
  - Enable dynamic MCP server management through built-in tools

### Improvements
- Simplify setup guides for Windows and macOS only
  - Streamline installation documentation for primary platforms
  - Remove outdated platform-specific configurations
- Reorganize prompt files into setup directory
  - Restructure example files for better organization
  - Improve documentation accessibility and maintenance

### Bug Fixes

### Security

## [1.15.12] - 2025-12-10

### New Features
- Enhance fetchWebContent tool and update Playwright to v1.57.0
  - Upgrade Playwright browser automation library to latest version
  - Improve web content fetching reliability and performance
- Add runtime environment setup guides to global system prompt
  - Include comprehensive environment configuration instructions
  - Enhance AI assistant's ability to guide users through setup processes

### Improvements
- Remove localStorage persistence and disable cursor display in streaming
  - Clean up streaming state management by removing redundant localStorage usage
  - Disable cursor display for improved streaming message rendering
- Simplify streaming state management in chat components
  - Refactor streaming architecture for better maintainability
  - Optimize chat component state handling during message streaming

## [1.15.11] - 2025-12-09

### New Features
- Implement macOS standard window behavior
  - Add native macOS window controls and behavior patterns
  - Enhance cross-platform user experience consistency
- Add example skill templates for PM Agent and Skill Creator
  - Provide ready-to-use skill templates for common use cases
  - Streamline skill creation and management workflow

### Bug Fixes
- Fix spinning animation not working on Windows
  - Resolve platform-specific animation rendering issues
  - Ensure consistent UI feedback across all platforms
- Fix cursor persistence after content streaming completion
  - Resolve cursor display issues in streaming message content
  - Improve streaming message UI state management
- Enhance image processing and add clipboard copy functionality
  - Improve image handling and processing capabilities
  - Add convenient clipboard operations for images
- Fix code block horizontal scrolling display issue
  - Resolve code block layout problems in message content
  - Improve code readability and display formatting

### Improvements
- Simplify ReadFileTool by removing unused metadata parameters
  - Clean up file reading tool implementation
  - Remove unnecessary metadata handling for better performance

## [1.15.10] - 2025-12-09

### New Features
- Add skill and agent management tools
  - Implement builtin tools for managing skills
  - Implement builtin tools for managing agents
- Add builtin tools for MCP server management
  - Support MCP server configuration and control through builtin tools

### Improvements
- Increase tool execution timeout to 1 hour
  - Extended timeout for long-running MCP tool operations
  - Enhanced system stability for complex tool executions

### Bug Fixes
- Improve path resolution and parameter detection in file security validator
  - Enhanced path normalization logic
  - Improved security parameter detection accuracy
  - Better handling of edge cases in file path validation

### Security

## [1.15.9] - 2025-12-08

### Improvements
- Migrate from Azure CDN to Kosmos CDN infrastructure
  - Update CDN base URL from Azure edge-cloud-resource-static to cdn.kosmos-ai.com
  - Apply new CDN configuration across mcpLibraryFetcher, skillLibraryFetcher, updateManager, and updaterFetcher
  - Ensure consistent CDN endpoint usage across all asset fetching modules

### CI/CD
- Simplify GitHub Actions environment configuration
  - Remove deprecated GPT model preset configurations from release workflow
  - Migrate from GitHub Secrets to Repository Variables for non-sensitive configs
  - Reduce environment variables to essential CDN URLs and configurations
  - Streamline .env.local generation process in CI/CD pipeline

## [1.15.8] - 2025-12-07

### Others
- Update production CDN URL configuration

## [1.15.7] - 2025-12-07

### New Features
- Add fullscreen restarting overlay for app update
  - Display immersive overlay during application restart process
  - Improve user experience with clear visual feedback during updates
- Add UpdaterFetcher for auto-downloading updater binary
  - Automatically download platform-specific updater binaries
  - Support seamless updater distribution across platforms
- Implement silent auto-update mechanism with cross-platform updater
  - Enable background update downloads without user interruption
  - Support both macOS and Windows platforms
- Optimize auto-update check mechanism and internationalize error messages
  - Improve update detection reliability
  - Provide localized error messages for better user understanding
- Enhance release workflow with source code cleanup and zip artifact support
  - Add comprehensive source code cleanup before release
  - Include source code as zip artifact in releases

### Improvements
- Simplify update dialog UI text and show current version
  - Display current version information in update dialog
  - Streamline dialog content for better clarity
- Simplify update dialog to unified 2-step flow
  - Consolidate update process into intuitive two-step workflow
  - Reduce user confusion during update process
- Simplify update dialog UI for downloaded state
  - Optimize dialog appearance when update is ready to install
- Replace toast notification with inline update button
  - Move update notification to inline button in UI
  - Provide more accessible update trigger
- Migrate updater and cache paths to userData directory
  - Store updater binaries and cache in user data directory
  - Improve application data organization
- Optimize artifact naming configuration
  - Standardize build artifact naming conventions
- Refactor CDN configuration management and internationalize error messages
  - Centralize CDN URL configuration for assets fetching
  - Convert error messages to English for better global compatibility

### Bug Fixes
- Use hardcoded install path to prevent dev environment issues
  - Fix update installation path resolution in development mode
  - Ensure consistent update behavior across environments
- Add symlink support and preserve file permissions in updater
  - Handle symbolic links correctly during update process
  - Maintain file permissions after update installation

### CI/CD
- Remove source code cleanup job from release workflow
  - Streamline release pipeline by removing redundant cleanup step

## [1.15.6] - 2025-12-05

### Improvements
- Optimize artifact naming configuration
  - Move artifactName to platform-level (mac/win) for consistency
  - Remove redundant dmg.artifactName (inherited from mac)
  - Remove zip.artifactName (not commonly used)
  - Standardize naming: KOSMOS-{version}-{platform}-{arch}.{ext}

## [1.15.5] - 2025-12-05

### New Features
- Enhance release workflow with source code cleanup and zip artifact support
  - Add comprehensive source code cleanup before release
  - Include source code as zip artifact in releases
  - Improve release package organization and distribution

### Improvements

### Bug Fixes

### Security

## [1.15.4] - 2025-12-05

### Improvements
- Refactor CDN configuration management
  - Centralize CDN URL configuration for assets fetching
  - Improve configuration modularity and maintainability
- Internationalize error messages
  - Convert error messages to English for better global compatibility
  - Enhance error message consistency across the application

## [1.15.3] - 2025-12-04

### Improvements
- Add macOS entitlements configuration for Hardened Runtime
  - Add entitlements.mac.plist with required permissions
  - Enable JIT compilation and unsigned executable memory support
  - Configure network, file, device, and Apple Events permissions
- Add DMG background image for macOS installer
- Improve entitlements file validation in GitHub Actions workflow
  - Add file existence check before validation
  - Enhance error messages with directory listing
  - Add better error handling for file readability checks

## [1.15.2] - 2025-12-04

### Improvements
- Remove macOS code signing and notarization configuration
  - Clean up Apple Developer Certificate configuration from .env.example
  - Disable code signing setup in GitHub Actions workflow
  - Simplify notarize.js script to skip all notarization processes
  - Allow building macOS apps without requiring Apple Developer credentials

## [1.15.1] - 2025-12-04

### New Features
- Initialize Kosmos Studio application with complete infrastructure
  - Complete Electron application setup with TypeScript and React
  - Implement comprehensive authentication system with GitHub Copilot integration
  - Add MCP (Model Context Protocol) runtime and client management
  - Implement intelligent memory management system with mem0 integration
  - Add workspace and file management functionality
  - Implement chat session management with AI agents
  - Add built-in tools system (search, file operations, command execution)
  - Implement skills management system with library support

### Improvements
- Add comprehensive GitHub governance and automation infrastructure
  - Setup CI/CD pipelines for macOS and Windows builds
  - Configure code signing and notarization workflows
  - Add automated release management system
  - Implement security policies and access controls

### Bug Fixes
- Fix MCP client timeout issues
  - Increase timeout values for MCP client operations
  - Improve connection stability and error handling
  - Enhance retry mechanism for failed connections

### Documentation
- Update repository URLs to new GitHub organization
- Add comprehensive setup and configuration guides
- Add JIT access templates and compliance documentation

### Security

## [1.15.0] - 2025-12-02

### New Features
- Implement comprehensive skills management system
  - Add skill library feature with remote fetching and installation
  - Add skill import from local device via zip file
  - Implement skill version management and update functionality
  - Add skills navigation and UI components
  - Add skills management UI with dropdown menus and file operations
  - Add skills badge to chat header with click-to-manage functionality
  - Enhance skill library installation validation and metadata handling
- Add Skills selection menu item to agent edit dropdown
- Integrate skills management with cross-view navigation
- Add skills tab to agent editor
- Add skills instructions to agent-specific system prompt
- Add whitelist mechanism for skills directory access
- Add Skills view module with folder explorer and file viewer
- Add YAML front matter parsing and GFM table support for markdown files
- Add HTML rendering support in markdown messages
- Add dual search tools for file search and content search
  - Add searchFilesTool for file name and path searching
  - Add searchTextInFilesTool for content searching within files

### Improvements
- Restrict skill folder explorer menu to dev mode only
- Fix layout overflow and container structure for MCP and skills modules
- Unify app shortcut name to KOSMOS

### Bug Fixes
- Fix sandbox write EIO error
- Fix token auto-refresh mechanism
- Fix chat switching and builtin MCP server persistence issues
- Fix IMAGE_REGISTRY tag detection in streaming messages
  - Improve tag parsing logic for streaming content
  - Ensure proper image display during message streaming

### Documentation
- Add markdown line break formatting rules to system prompt

### Refactoring
- Rename searchFilesTool to searchTextInFilesTool for clarity

### Security

## [1.14.2] - 2025-11-30

### New Features
- Add fullscreen image viewer with keyboard navigation support
  - Implement ImageViewer component for fullscreen image display
  - Add context menu support for gallery images
  - Enable keyboard shortcuts (ESC to close, arrow keys to navigate)
- Add scroll synchronization to image gallery navigation
  - Implement automatic scrolling when navigating between images
  - Ensure selected image is always visible in the gallery

### Improvements
- Simplify image display system with unified gallery component
  - Refactor image rendering logic for better maintainability
  - Consolidate image display components into ImageGallery
  - Optimize image loading and caching strategy

### Bug Fixes
- Fix streaming message rendering with IMAGE_REGISTRY tag
  - Resolve image display issues during message streaming
  - Ensure proper image tag parsing and rendering
- Fix tool execution status for historical messages
  - Correct tool call status display in message history
  - Improve tool execution state persistence
- Fix tool call arguments parsing for empty parameters
  - Handle edge cases when tool arguments are missing or empty
  - Improve argument validation and error handling
- Fix tool argument parsing and simplify datetime tool
  - Streamline datetime tool implementation
  - Enhance argument parsing robustness
- Fix layout jump issue during tool calls rendering
  - Prevent UI layout shifts when tool calls are displayed
  - Stabilize message container height during streaming
- Fix textarea height and streaming message layout issues
  - Resolve input area height calculation problems
  - Fix message layout inconsistencies during streaming

### Security

## [1.14.1] - 2025-11-30

### New Features
- Migrate Bing search tools to playwright browser automation
  - Implement browser-based Bing web search functionality
  - Implement browser-based Bing image search functionality
  - Enhance search tool reliability and anti-detection capabilities

### Bug Fixes
- Restore complete validation logic to fix SSO window auto-dismiss issue
  - Fix startup validation flow causing premature window dismissal
  - Ensure proper authentication state validation before proceeding

### Documentation
- Enhance automation prompt documentation
  - Improve release automation workflow documentation
  - Add comprehensive execution guidelines

## [1.14.0] - 2025-11-29

### New Features
- Implement batch tool approval system and cancellation token mechanism
  - Add SecurityValidator batch risk assessment for tool calls
  - Implement CancellationToken mechanism to support conversation interruption
  - Support multi-tool batch approval and interactive feedback
- Implement centralized tool execution state management
  - Add tool call state tracking and synchronization system
  - Implement real-time tool execution status display
- Implement new streaming message architecture and streamingMessageId tracking
  - Unify streaming message processing architecture
  - Add streamingMessageId for precise message tracking
  - Optimize streaming data transfer and rendering performance
- Add datetime tool and refactor type definitions
  - Implement built-in datetime tool to replace system injection
  - Refactor tool type definitions to improve type safety
- Add file path existence validation mechanism to Message component
  - Implement smart file path recognition and validation
  - Add file-not-found hint functionality
- Optimize Agent chat session list interaction experience
  - Enhance session list responsiveness and smoothness
  - Optimize session switching animation
- Implement file tree expand state persistence and optimize loading icons
  - Add local storage for file tree expand state
  - Optimize loading state icon display

### Improvements
- Optimize Agent action buttons display logic
  - Refactor button display conditions and interaction logic
  - Improve button response speed and user experience
- Optimize batch request mechanism for tool approval workflow
  - Simplify batch approval process
  - Improve approval efficiency and user experience
- Refactor file tree context menu, elevate to AppLayout unified management
  - Unify context menu management architecture
  - Optimize menu component reusability
- Refactor file browser to tree view mode
  - Completely refactor file browser UI architecture
  - Implement tree view expand/collapse functionality
  - Improve file browsing performance for large projects
- Refactor ChatInput model selector state management
  - Optimize model selector state synchronization
  - Improve selector interaction responsiveness
- Refactor state management architecture, unify currentChatId management
  - Unify frontend state management entry point
  - Simplify state update and synchronization logic
- Clean up comments and optimize user message cache logic
  - Remove outdated comments and debug code
  - Optimize message caching strategy
- Simplify streaming architecture, remove StreamingMessageManager
  - Remove redundant StreamingMessageManager class
  - Unify streaming message processing architecture
- Implement unified chat session management architecture
  - Refactor session management into unified interface
  - Optimize session switching and state synchronization
- Improve agent chat component and session management
  - Optimize component structure and performance
  - Enhance session management functionality
- Refactor chat session cache management system
  - Refactor caching strategy and data structures
  - Improve cache hit rate and performance
- Refactor time retrieval mechanism, use tool instead of auto-injection
  - Migrate from system prompt to tool call
  - Improve time information accuracy and flexibility

### Bug Fixes
- Fix file path recognition unable to handle paths with spaces
  - Improve path parsing regular expressions
  - Support file paths containing spaces and special characters
- Remove file tree depth limit, support displaying all directory levels
  - Remove hardcoded depth limit
  - Implement full directory tree display
- Fix tool call argument streaming accumulation logic
  - Fix data loss during argument accumulation
  - Optimize argument assembly logic
- Fix streaming startup delay, achieve instant rendering
  - Optimize streaming render start timing
  - Reduce first-byte rendering latency
- Fix tool call streaming display and state management issues
  - Fix state inconsistency during tool calls
  - Optimize tool call streaming display logic

### Documentation
- Enforce English for commit descriptions
  - Update commit convention documentation
  - Standardize codebase commit language

### Security

## [1.13.20] - 2025-11-24

### New Features
- Implement intelligent memory management for AgentChat instances
  - Add state-based automatic cleanup for idle instances, releasing memory after 5 minutes of inactivity
  - Implement ChatSession focus management with protection for Current and New Chat
  - Add periodic state checker polling every 30 seconds to trigger cleanup logic
  - Implement handleSessionLostFocus mechanism — idle sessions losing focus immediately enter cleanup countdown
- Enhance chat system conversation cancellation and state management
  - Add CancellationToken support to AgentChatManager and AgentChat for precise conversation cancellation
  - Add cancel button and onCancelChat callback handling to ChatView component
  - Extend preload.ts IPC API with cancelChat and cancelChatSession methods
- Enhance streaming architecture and ChatId filtering mechanism
  - Unify StreamingChunk type definition across main and renderer processes, add chatId field for frontend filtering
  - Implement AgentChat-level streaming data filtering to prevent data cross-contamination between chats

### Improvements
- Optimize real-time display of chat session status and rendering performance
  - Add real-time loading icons in AgentList showing running state of each ChatSession
  - Optimize key generation strategy in Message component and ChatContainer to avoid unnecessary re-renders
  - Extend ChatStatus event type definitions in preload.ts with chatSessionId and timestamp fields
- Refactor Session switching to frontend pull-based mode
  - Remove AgentChatManager's active push of Chat Status, switch to frontend active polling
  - Add agentChat:getChatStatusInfo IPC interface in main.ts for frontend to actively fetch status
  - Refactor NavigationSection Session switching to a genuine two-step process (backend switches first, then frontend)
- Optimize AgentChatManager's cancellation token management and chat state tracking
- Optimize ChatSession selection and state synchronization in NavigationSection
- Optimize instance teardown flow, unify cleanup of timers and state checker resources

### Bug Fixes
- Fix ChatStatus event interception, ensure background ChatSession state updates can be received by frontend
- Fix Agent initialization and ContextBadge Token display issues
  - Add getCurrentContextTokenUsage method to AgentChatManager to support active context stats polling
  - Fix AgentPage initialization failure when no chatSessionId is present, support auto-calling startNewChatFor
  - Refactor ContextBadge component from passive listening to hybrid active-pull + listening mode
  - Resolve ContextBadge Token data not updating after Session switch
- Fix state desync during Session switching
  - Fix ChatView not resetting chatStatus when switching Session, causing stale state display
  - Resolve root cause of incorrect frontend UI state after Session switch
- Fix frontend/backend state desync after new conversation creation
  - Add AgentChat.exitNewChatSessionState() method to automatically exit new session state after first message is saved
  - Resolve root cause of subsequent operation failures due to frontend currentChatSessionId being null
- Fix ChatSession switching and event notification isolation issues
  - Implement backend event filtering at ChatSessionId level to prevent background Sessions from interfering with foreground display
  - Add safeEmitEvent unified event dispatch method to ensure only active Chat sends notifications
  - Resolve frontend receiving state changes and tool approval requests from historical Sessions

### Security

## [1.13.19] - 2025-11-22

### New Features
- Enhance anti-hallucination mechanism for time processing, improve AI time awareness accuracy
- Add time reference handling rules and calculation guidance functionality

### Improvements
- Optimize message code block rendering logic, improve code display quality
- Upgrade Electron dependency from 28.3.3 to 35.7.5, enhance application stability and security
- Upgrade glob dependency from 10.3.10 to 10.5.0, optimize file matching performance

### Bug Fixes
- Optimize macOS icon dimensions to comply with system design specifications, improve visual experience

### Security

## [1.13.18] - 2025-11-21

### New Features

### Improvements
- Minimize launch page and optimize SVG rendering quality
- Refactor icon asset directory structure and optimize build configuration
- Refactor delete confirmation dialog to AppLayout level and optimize navigation scroll experience
- Unify header toolbar icon size to 24x24
- Unify tool status icon styles and optimize navigation spacing
- Optimize chat session title generation mechanism, improve user experience
- Optimize ChatViewHeader icon display

### Bug Fixes
- Fix messages not loading when switching ChatSession for the first time
- Fix data truncation in the final stage of streaming output
- Fix UI icon display and file path extraction issues

### Documentation
- Optimize Markdown heading syntax description, improve system prompt accuracy

### Security

## [1.13.17] - 2025-11-21

### New Features
- Add complete package size optimization guide (docs/package-size-optimization.md)
- Add on-demand loading implementation guide (docs/lazy-loading-guide.md), covering both code lazy-loading and plugin download approaches

### Improvements
- Remove @xenova/transformers dependency, reducing package size by 50–80 MB
- Add sharp image processing library to replace transformers image functionality
- Enhance electron-builder file exclusion rules, removing source maps, test files, docs, and other non-essential files
- Enable maximum compression level to optimize installer size
- Enable delta update package support, improving incremental update efficiency
- Expected overall reduction of 60–80 MB in installer size, improving startup speed by ~40%

### Bug Fixes

### Security

## [1.13.16] - 2025-11-20

### New Features
- Add structured response formatting specification to improve AI response quality and readability
- Optimize UI component interaction experience and data synchronization, enhance interface responsiveness
- Implement Agent secondary ChatSession list expansion, improve session management experience
- Support new GitHub Copilot models and dynamic API endpoints, expand model selection range
- Implement model data cache management and backend centralization architecture, improve system performance
- Enhance Agent editor change tracking and user experience, optimize configuration workflow
- Enhance Toast notification system to support structured message content, improve user feedback
- Implement empty session state optimization and scrollbar interaction enhancement, improve interface usability
- Add unified Edit Agent entry menu, simplify Agent management operations
- Optimize user interaction experience for MCP server add operations, improve MCP functionality
- Complete MCP server library fetch and display functionality, add MCP server library feature

### Improvements
- Optimize AgentList UI display and interaction experience, improve visual design
- Optimize tool call status icons and display styles, enhance status visualization
- Optimize message layout spacing and style details, improve readability
- Refactor message component layout structure, optimize style system architecture
- Simplify auto-update progress display, improve update experience
- Hide system messages to simplify interface, reduce interface complexity
- Remove Agent Role field to simplify configuration, optimize configuration workflow

### Bug Fixes
- Fix Enter key sending messages directly when using Mac Pinyin input method, improve Mac user experience
- Fix Agent switching logic abnormality after chat deletion, ensure state consistency
- Fix tool call message display issues, improve message rendering logic
- Fix sandbox environment write EIO error, improve system stability
- Fix token auto-refresh mechanism, ensure continuous authentication validity
- Fix macOS code signing skip causing notarization failure, improve build workflow
- Fix macOS notarization failure, optimize entitlements configuration
- Fix Windows CI/CD pipeline electron-builder configuration error
- Fix Mac CI/CD build failure, resolve dependency sync issue
- Fix macOS notarization configuration causing CI/CD build failure

### Security
- Update dependencies to fix security vulnerabilities, including on-headers, compression, tmp, and other dependencies
- Enhance certificate type detection and add GitHub Secrets configuration documentation
- Improve macOS local build and signing test tools, enhance build security

## [1.13.15] - 2025-11-18

### New Features
- Create docs/local-build-test.md with comprehensive local testing guide
  - Detailed prerequisites and environment configuration instructions
  - Three local testing approaches (full build, quick test, act-simulated CI/CD)
  - Common troubleshooting commands and solutions
  - Best practice recommendations
- Create scripts/verify-build.sh automated verification script
  - Check if the application exists
  - Verify code signing validity
  - Detect signing type (Developer ID vs adhoc)
  - Verify Hardened Runtime configuration
  - Check entitlements configuration
  - Test Gatekeeper compatibility
  - List generated DMG files
- Create electron-builder.test.yml test configuration
  - Skip notarization to save time
  - Output to release-test directory to avoid polluting official builds
  - Support x64 and arm64 architectures
- Update package.json to add test scripts
  - npm run test:build — quick local build test
  - npm run test:build:verify — build and verify

### Improvements
- Update .gitignore
  - Ignore release-test/ test build output
  - Ignore .secrets local test credentials
- Update README.md
  - Add local testing instructions to the Building for Production section
  - Guide developers to perform local verification before committing

### Bug Fixes
- Fix macOS code signing skip causing notarization failure
  - Remove identity: null configuration from package.json to restore normal code signing workflow
  - identity: null causes electron-builder to skip code signing
  - Unsigned apps cannot pass Apple notarization process
- Enhance signing check mechanism in scripts/notarize.js
  - Check if app is correctly signed before notarization
  - Detect adhoc signing (unsigned) and skip notarization
  - Avoid notarization failure for unsigned apps
  - Ensure code signing is correctly executed in CI/CD environment before notarization

### Security

## [1.13.14] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix macOS notarization failure — optimize entitlements configuration
  - Remove permission configurations from entitlements.mac.plist that do not meet notarization requirements
    - Remove app-sandbox disable configuration (causes notarization failure)
    - Remove debugging-related permissions (debugger, get-task-allow)
    - Remove insecure permissions (disable-executable-page-protection, etc.)
    - Remove temporary exception permissions and personal information access permissions
  - Retain necessary Hardened Runtime permissions
    - JIT compilation support
    - Unsigned executable memory support
    - Library validation disabled (required for Node.js native modules)
  - Retain necessary feature permissions
    - Network access (client and server)
    - File access (user-selected and downloads directory)
    - Device access (camera and microphone)
    - Apple Events automation
  - Add identity: null in package.json mac configuration to ensure builds do not fail when no certificate is present

### Security

## [1.13.13] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix macOS notarization failure
  - Add missing @electron/notarize dependency
  - scripts/notarize.js depends on this package for app notarization
  - Fix module-not-found error during CI/CD build process
  - Update package-lock.json to ensure dependency sync

### Security

## [1.13.12] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix Windows CI/CD pipeline electron-builder configuration error
  - Move afterSign configuration from inside the mac object to the top-level build configuration
  - Resolve issue where electron-builder 24.13.3 does not support afterSign as a mac sub-property
  - Fix configuration validation error during build process

### Security

## [1.13.11] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix Mac CI/CD build failure
  - Fix npm ci failure caused by package-lock.json not being in sync with package.json
  - Resolve dependency installation error due to missing on-headers@1.0.2
  - Run npm install to regenerate package-lock.json and ensure dependency consistency

### Security

## [1.13.10] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix macOS notarization configuration causing CI/CD build failure
  - Disable electron-builder automatic notarization and use custom script instead
  - Create scripts/notarize.js to implement environment variable checks and graceful degradation
  - Fix parsing error caused by notarytool returning non-JSON response
  - Support skipping notarization for local builds; CI/CD environment automatically performs notarization
  - Update documentation to describe new notarization configuration and workflow

### Security
- Update dependencies to fix security vulnerabilities
  - Update on-headers and compression packages
  - Update tmp from 0.2.3 to 0.2.4
  - Update prismjs and react-syntax-highlighter
  - Update ai from 4.3.19 to 5.0.52
  - Update js-yaml from 3.14.1 to 3.14.2

## [1.13.9] - 2025-11-18

### New Features

### Improvements

### Bug Fixes
- Fix inconsistent Apple Developer certificate configuration variable naming
  - Rename APPLE_ID_PASSWORD in .env.example to APPLE_APP_SPECIFIC_PASSWORD for consistency
  - Update corresponding environment variable references in GitHub Actions workflow to ensure CI/CD works correctly
  - Improve environment variable comments, clearly noting that this is the app-specific password used for notarization
  - Standardize naming conventions for Apple notarization-related environment variables for better consistency

### Security

## [1.13.8] - 2025-11-17

### New Features

### Improvements

### Bug Fixes
- Fix macOS CI/CD code signing issues
  - Clean extended attributes from entitlements.mac.plist to avoid 'cannot read entitlement data' error
  - Add file attribute cleanup step in CI workflow to ensure code signing executes correctly
  - Update .gitignore to include important build configuration files to prevent accidental exclusion
  - Add build/entitlements.mac.plist file to resolve macOS app permission configuration issues
  - Optimize GitHub Actions release workflow to enhance macOS build stability

### Security

## [1.13.7] - 2025-11-17

### New Features

### Improvements
- Optimize GitHub Actions release workflow configuration
  - Improve macOS code signing trigger conditions, support ENABLE_CODE_SIGNING variable control and automatic triggering on tag push
  - Optimize environment file creation process, merge multiple echo commands into a single block for improved execution efficiency
  - Fix CSC_IDENTITY_AUTO_DISCOVERY boolean value logic, use correct variable check syntax

### Bug Fixes

### Security

## [1.13.6] - 2025-11-17

### New Features

### Improvements

### Bug Fixes
- Fix GitHub Actions condition syntax errors
  - Fix expression syntax issues in macOS code signing condition checks
  - Remove unnecessary ${{ }} expression wrapping, switch to direct conditional syntax
  - Standardize condition syntax across GitHub Actions workflows

### Security

## [1.13.5] - 2025-11-17

### New Features

### Improvements

### Bug Fixes
- Fix GitHub Actions workflow expression syntax errors
  - Fix expression syntax issues in macOS code signing condition checks
  - Fix expression syntax issues for CSC_IDENTITY_AUTO_DISCOVERY environment variable
  - Replace direct secrets checks with correct empty-value check syntax (!= '')

### Security

## [1.13.4] - 2025-11-17

### New Features
- Complete macOS code signing and notarization configuration
  - Enhance macOS app signing process, improve application security and system compatibility
  - Complete notarization configuration to ensure apps can be properly distributed and run on macOS

### Improvements

### Bug Fixes
- Fix MCP server connection state management and reconnect mechanism
  - Optimize MCP server connection state tracking, improve connection stability
  - Improve reconnect logic, reduce connection failures and unexpected disconnections
  - Enhance connection state synchronization, ensure frontend/backend state consistency

### Security

## [1.13.3] - 2025-11-13

### New Features

### Improvements

### Bug Fixes
- Improve file path recognition regular expressions to increase path recognition accuracy
  - Improve Windows path regex to support more precise file path matching
  - Extend Unix path regex to support more system directories such as Applications, Library, System, etc.
  - Remove word boundary restrictions, improve character class matching, increase path recognition accuracy

### Security

## [1.13.2] - 2025-11-13

### New Features
- Implement CancellationToken mechanism for conversation cancellation
- Add workspace file link functionality improvements
- Add file attachment card interaction enhancements, support clicking to directly open files
- Implement smart recognition and quick actions for file paths in AI response messages
- Optimize file tree file click behavior

### Improvements
- Optimize cancel button style implementation
- Unify interface element border-radius styles
- Optimize message component visual hierarchy and spacing design
- Refactor tool call block border and border-radius display logic
- Optimize file path display to plain text format
- Refactor streaming message transmission architecture to unified chunk mode
- Refactor context compression mechanism to improve code structure
- Optimize streaming rendering performance, achieve ultra-fast typewriter effect
- Restrict file path recognition to specific file types only

### Bug Fixes
- Complete conversation cancellation mechanism and state management
- Fix automatic reset issue in chat state management
- Fix tool call streaming rendering display anomalies
- Fix file attachment name display issue on Mac

### Security
- Add project maintainer member access control

## [1.13.1] - 2025-11-10

### New Features
- Implement single-user auto-login to optimize startup experience
- Enhance CommandParser path recognition for specific commands

### Improvements
- Refactor chat API method naming to improve semantic clarity
- Refactor tool methods and optimize type definitions
- Remove duplicate method implementations in AgentChat
- Optimize AgentChat code structure, remove redundant methods
- Refactor AgentChat architecture, extract tool methods into independent modules
- Optimize time information delivery, migrate from System Prompt to user messages

### Bug Fixes
- Fix SelectionHook cleanup issue on application exit
- Fix webpack build including test files
- Enhance Windows command switch recognition rules

### Security
- Revert to v1.13.0 and clean up subsequent documents

## [1.13.0] - 2025-11-09

### New Features
- Add search tool priority configuration, support user-defined search tool execution order
- Add intelligent Token calculation system and context compression optimization
- Add Agent Context Enhancement configuration system, improve agent intelligence level
- Add high-performance file system monitoring and intelligent workspace management
- Add MCP tool path security validation and code block display optimization

### Improvements
- Enhance search tool priority configuration with user-specified support, providing more flexible search strategies
- Implement smooth typewriter effect and intelligent rendering optimization, significantly improve user experience
- Improve AgentList component accessibility and keyboard navigation, enhance usability
- Optimize chat compression mechanism performance configuration, improve system response speed
- Optimize chat session state management and UI sync logic, enhance interface stability
- Enhance chat loading state display and compression functionality, improve user feedback experience
- Enhance image storage compression mechanism, optimize dual history sync and compatibility
- Improve context menu keyboard interaction experience, improve operational convenience
- Refactor chat state management system, comprehensively optimize user experience
- Refactor FullModeCompressor into a general task compressor, improve code reusability
- Migrate VSCode Copilot Chat Full Mode compression algorithm to independent module

### Bug Fixes
- Fix streaming state message metadata display issues
- Fix loading message display issue when switching windows, and fix duplicate message metadata display
- Fix cursor display issue when tool calls have no text content
- Fix missing style import in ApprovalBar component

### Security
- Optimize command parser performance and long string handling, enhance system security
- Clean up debug logs and development output from the project, reduce information leakage risk
- Optimize chat interface loading state display layout, improve interface security

## [1.12.0] - 2025-11-06

### New Features
- Add complete Toolbar feature set (#39)
  - Implement communication mechanism between independent toolbar window and main window
  - Add toolbar quick actions and status display
  - Integrate seamless interaction between toolbar and main application

### Improvements
- Complete style system modular refactoring, improve code maintainability
  - Delete legacy monolithic style files (chat.css, components.css, mcp.css, toolbar.css) — 3000+ lines total
  - Add 33 modular CSS files, implement component-level style management
  - Refactor style file organization structure, unify styles directory as root styles directory
  - Update style import paths in 56 components, standardize style import conventions
  - Covers all core modules including Chat, MCP, Memory, Agent, Layout, etc.
- Optimize UI component visual design and user experience
  - Unify font stack to cross-platform system fonts (-apple-system, BlinkMacSystemFont, Segoe UI, etc.)
  - Optimize chat input area, message tables, scrollbars, and other UI details
  - Unify visual style of Header component, sidebar, and navigation bar
  - Optimize interaction experience of Agent editor and MCP configuration interface
  - Refactor left navigation bar and agent page UI components
  - Improve cross-platform font rendering consistency, improve macOS and Linux display
- Optimize workspace and file management functionality
  - Optimize workspace explorer interaction experience and visual design
  - Optimize sidebar interaction experience and session management logic
  - Refactor Agent editor state management and view isolation
- Enhance MCP tool functionality
  - Optimize Google web search and image search tools, enhance anti-detection capabilities
  - Refactor Google search tool to avoid website blocking
  - Optimize Google web search tool parallel execution and debugging functionality
  - Optimize Google search tool browser efficiency
  - Refactor MCP configuration management and UI components
- Optimize chat functionality and styles
  - Optimize chat container scrollbar style
  - Optimize chat input area visual design
  - Refactor chat component styles into modular CSS architecture
  - Optimize image streaming rendering format
- Refactor Memory component styles and functionality
  - Refactor style file structure and optimize delete button icon
  - Unify Badge and text styles for MCP and Memory-related components
  - Refactor MCP component styles to modular architecture
- Refactor sidebar and navigation components
  - Refactor sidebar style system, unify Sidepane component design
  - Unify Header component button styles and icon sizes
  - Unify Header component style design

### Bug Fixes
- Fix Google search page jitter/error issue
  - Add isPageStable() function to verify page URL stability through multiple checks

### Security

## [1.11.2] - 2025-10-30

### New Features
- Add tool path access control and user approval mechanism
  - Implement SecurityValidator for tool call risk assessment and approval decision logic
  - Add ApprovalBar component for tool call approval UI interaction
  - Support multi-tool batch approval and interactive feedback
- Add built-in MCP tool functionality
  - Add Google web search tool google_web_search
  - Add Google image search tool google_image_search
  - Add download and save tool download_and_save_as

### Improvements
- Refactor security validation architecture for unified management
  - Move FileSecurityValidator from utilities directory to security directory
  - Refactor SecurityValidator to remove redundant security check logic and simplify validation flow
  - Update builtinTools security validation reference paths
- Refactor tool call approval workflow and lifecycle management
  - Refactor agentChat to implement complete tool approval lifecycle management and state synchronization
  - Enhance main.ts and preload.ts IPC communication to support approval event delivery
- Optimize UI components and interaction experience
  - Refactor ChatView component message rendering and approval workflow handling logic
  - Improve Message component by streamlining code structure for better maintainability
  - Refactor chat.css stylesheet to optimize approval bar visual hierarchy and responsive layout
  - Improve AppLayout and ContentContainer layout style support
  - Improve ChatInput component input state management
- Refactor chat system architecture
  - Refactor message saving and memory extraction workflow, optimize session switching logic
  - Optimize workspace and command execution system prompts
- Optimize performance and storage
  - Add protection for first user message and optimize compression timing
  - Implement image rendering performance optimization with placeholder display functionality
- Code cleanup and refactoring
  - Remove compression module from renderer process
  - Clean up unused streaming infrastructure
  - Clean up AgentChat legacy code in renderer process

### Bug Fixes
- Fix debug code in Google image search tool

### Security
- Implement tool path access control and user approval mechanism to prevent unauthorized file system access
- Enhance SecurityValidator tool call risk assessment capability
- Add security-validation-refactor.md document to record refactoring process and architecture changes

## [1.11.1] - 2025-10-28

### New Features
- Add AI assistant module and GitHub Copilot API integration

### Improvements
- Optimize model management architecture, remove redundant cache
- Enhance AgentChat and LLM debug logging system
- Enhance auto-update error handling and user prompts

### Bug Fixes

### Security

## [1.11.0] - 2025-10-28

### New Features
- Add Agent tool call workspace permission validation module
  - Implement SecurityValidator for unified permission validation when Agent executes tools
  - Provide validateWorkspaceAccess method to verify whether a file path is within the workspace scope
  - Integrate FileSecurityValidator for path traversal attack protection
  - Support normalization of relative and absolute paths
  - Implement cross-platform path separator unification (Windows/Unix compatible)
  - Provide batch path validation, sub-path checking, relative path retrieval, and other utility methods
- Add Bing image search built-in tool
- Add intelligent compression mechanism and image storage optimization
- Add intelligent context compression and Token management system
- Add real-time event push and display optimization for tool call messages
- Add multi-modal message processing and Vision API support
- Add file/folder list loading for context menu default options
- Add complete Workspace file browser module
- Add Workspace switching functionality
- Add Read Office File tool to support reading PDF, Word, and PPT files
- Add hot reload for development environment and Claude CLI support

### Improvements
- Refactor image format instructions to global system prompt
  - Migrate internal image format instructions from agentChat.ts to globalSystemPrompt.ts for unified management
  - Integrate complete IMAGE_DISPLAY rules and usage examples into the global system prompt
- Optimize image segment rendering to adapt to main process architecture
- Refactor AgentChat message retrieval interface and new chat workflow
  - Add getDisplayMessages interface to replace getAllMessages and getSystemMessages
  - Optimize message loading flow, clearly distinguish between display messages and complete messages
  - Adjust new chat execution order: clear history before fetching system messages
  - Mark legacy interface as deprecated, use getDisplayMessages for UI display content
- Refactor System Prompt architecture, optimize context injection mechanism
- Refactor AgentChat to main process architecture and implement IPC communication
- Refactor AgentChat to identity-driven architecture with dynamic configuration retrieval
- Refactor file tree to breadcrumb navigation view
- Rename chatspace module to workspace and optimize related functionality
- Merge hot reload documentation into a unified guide
- Support classification and display of Office attachments in Read Office File tool
- Enhance execute_command built-in tool

### Bug Fixes
- Fix issue where frontend was not notified to update context stats when creating a new chat
- Fix AgentChat memory functionality diagnostics and userAlias validation issues
- Fix AgentPage using getAllMessagesAsync to retrieve complete message list
- Fix MCP Server Editor validation messages being obscured by modal dialog
- Fix Read Office File tool ignoring page numbers when reading Word files

### Security
- Enhance workspace security policy in Agent System Prompt
  - Add detailed workspace security policy description in agent-specific system prompt
  - Clearly require all file operations to be restricted to the workspace directory when no path is specified
  - Prohibit path traversal attacks and access to system directories outside the workspace
  - Define allowed and prohibited file operation types and path formats
  - Prohibit all file operations and prompt user to configure when workspace is not set
  - Apply secure fallback policy to prohibit file operations when configuration errors occur
  - Enhance logging to track security policy application status

## [1.10.0] - 2025-10-22

### New Features
- Implement Chatspace file tree context menu functionality
  - Add main process IPC handlers openPath and showInFolder for system-level file operations
  - Add preload API interfaces to expose file open and file manager display functionality
  - Implement file tree node context menu component ContextMenu, using Portal rendering to avoid occlusion
  - Support right-click to open files (system default program) and right-click to show directories in file manager
- Implement Chatspace file drag-and-drop upload functionality
  - Add main process file copy IPC handler, support recursive copying of files and directories
  - Add preload API interface copyPath for safe file system operations
  - Implement drag-and-drop upload in Chatspace Explorer, support dropping files/directories
  - Add drag visual feedback with blue border highlight and semi-transparent overlay hint
  - Implement automatic deduplication detection to prevent overwriting files with the same name
  - Add drag animation effects to improve user experience
- Implement Chatspace file tree cache management mechanism
  - Add IPC communication interface to support file tree cache management operations
  - Add synchronous empty directory scan to fix ripgrep's inability to detect empty directories
  - Implement selective cache cleanup by path
- Implement Chatspace default path auto-setup mechanism
- Add @workspace context reference functionality
- Add workspace directory search functionality
- Implement VSCode-style workspace file search functionality
- Add MCP built-in tools execute_command and search_files
- Add GitHub Issue creation assistant prompt document

### Improvements
- Refactor naming: rename workspace to chatspace to more accurately reflect functionality
- Optimize Chatspace file tree retrieval performance using ripgrep --files instead of recursive traversal
- Optimize file tree node format to ensure empty directories also include a children array
- Enhance Chatspace Explorer refresh functionality: clear cache before reloading
- Migrate to VSCode ripgrep search solution and refactor search architecture
- Unify icon system and font size between ContextMenu and FileTreeExplorer
- Optimize file click interaction, remove useless toast notifications
- Improve absolute path building logic, correctly handle root directory and sub-path concatenation
- Automatically clear cache and refresh file tree display after successful upload
- Enhance workspace context injection to prevent LLM from tampering with or fabricating workspace values
- Extend MCP search_files tool search pattern support

### Bug Fixes
- Fix Memory batch clear functionality, support one-click deletion of all memories
- Fix user message width display logic
- Fix message content overflow and line break issues
- Fix visual flicker on card switching in ChatSessionsSidepane
- Enhance MCP tool_calls parsing robustness
- Add token limit for MCP configuration formatting to support long environment variables

### Security

## [1.9.5] - 2025-10-13

### New Features
- Add one-click copy functionality for chat messages
  - Add handleCopyMessage function to handle message copy logic
  - Add copy button UI components for user, assistant, and system messages
  - Implement async copy mechanism based on navigator.clipboard with toast notification
  - Add message-action-btn universal button style supporting hover and active effects
- Add quick edit entry for system messages, improve user editing efficiency
- Add MCP Tools quick access button, optimize tool access experience
- Implement Agent name duplicate check functionality to prevent configuration conflicts

### Improvements
- Implement MCP tool name conflict detection and visual warning system
  - Add Built-in superscript badge for built-in MCP servers
  - Optimize Tool card layout with icon and name on the same line
  - Optimize MCP view layout and content overflow handling
- Optimize user interface interaction experience
  - Action buttons for user and assistant messages use hover-to-show mechanism to reduce visual clutter
  - Action buttons for system messages remain always visible for quick access
  - Add accessibility support with aria-label and title attributes
- Improve README documentation and environment configuration examples

### Bug Fixes
- Fix MCP server tool selection logic to ensure tools load correctly

### Removed
- Remove Tool Viewer functionality and related code to simplify system architecture

### Security

## [1.9.4] - 2025-10-12

### New Features
- Add language and region parameter support to Bing search tool

### Improvements
- Refactor style file structure, modularize CSS organization
  - Extract component inline styles into independent CSS files
  - Standardize Agent editor CSS class naming conventions
  - Standardize MCP component style class names and modal structure
  - Standardize button style class names and optimize MCP server card UI
  - Optimize style system architecture and component styles
  - Optimize bold text display style in message content
- Refactor conversation flow to unified Streaming mode
  - Optimize chat history synchronization and tool call workflow

### Bug Fixes
- Fix rendering anomalies caused by duplicate message IDs when switching sessions
- Fix tool call information sync issues in streaming messages

### Security

## [1.9.3] - 2025-10-09

### New Features

### Improvements
- Optimize streaming rendering performance to achieve ultra-smooth typewriter effect
- Optimize model configuration list, remove outdated gpt-5-codex model

### Bug Fixes

### Security

## [1.9.2] - 2025-10-09

### New Features

### Improvements
- Optimize data synchronization mechanism and IPC listener initialization timing
  - Remove ProfileCacheManager's data change detection mechanism, send all notifications directly to frontend
  - Delete DataSnapshot interface and related data snapshot comparison logic
  - Clean up hasSignificantDataChanges and other complex change detection methods
  - Move IPC listener setup to constructor to ensure it is ready before any messages are sent
  - Simplify data sync workflow, improve system response speed and reliability

### Bug Fixes
- Fix user profile data initialization timing issues
  - ProfileDataManager sets isInitialized to false on init, only sets to true after first sync succeeds
  - Remove DataLoadingPage dependency on isLoading state, rely solely on isInitialized to determine data readiness
  - Optimize data loading progress bar logic, simplify state determination flow
  - Ensure initialization is only marked complete after ProfileCacheManager's first sync finishes
  - Resolve race condition where the page transitions before user data is fully loaded

### Security

## [1.9.1] - 2025-10-07

### New Features

### Improvements
- Optimize MCP view component, remove duplicate statistics logic to improve performance

### Bug Fixes

### Security

## [1.9.0] - 2025-10-07

### New Features
- Add MCP server fine-grained tool selection, support enabling/disabling tools on demand
- Add built-in tool server auto-integration mechanism, unify tool management architecture
- Add MCP three-column layout architecture, optimize tool display and interaction experience
- Add Memory component scroll and loading functionality enhancements
- Integrate complete GitHub Copilot model catalog, expand model selection range

### Improvements
- Optimize MCP server selection interface interaction and visual design
- Upgrade MCP server configuration architecture to support fine-grained tool selection and management
- Refactor built-in tools to MCP server architecture for unified tool management
- Migrate built-in tools to main process and enhance security
- Refactor built-in tool manager to singleton pattern, enhance MCP compatibility
- Optimize MCP server and tool list UI styles, unify interface design language
- Optimize MCP interface layout and interaction, improve user operation efficiency
- Refactor MCP view component structure, improve code maintainability
- Unify Memory interface field naming to camelCase for better code consistency
- Optimize message enhancement logic, add time and memory information earlier
- Internationalize MemoryCard component UI text to English

### Bug Fixes
- Fix ChatInput model selector unable to immediately display selected state
- Fix native module compatibility issues on macOS ARM64 environment

### Security
- Enhance authentication data debug log output, improve system observability

## [1.8.3] - 2025-10-03

### New Features
- Add build fix documentation docs/windows-build-fixes.md

### Improvements
- Optimize Windows CI/CD build workflow, add Visual Studio and Windows SDK verification steps
- Improve native module build strategy, force use of pre-built binaries

### Bug Fixes
- Fix GitHub Actions Windows build failures
  - Disable electron-builder's npmRebuild to avoid recompiling native modules
  - Add pre-built binary configuration for sqlite3 and sharp to .npmrc
  - Add Visual Studio and Windows SDK verification steps in CI
  - Configure extraResources to ensure native modules (sqlite3, sharp) are correctly packaged in Windows installer
  - Resolve node-gyp compilation failure on Windows caused by missing Windows SDK
  - Fix pre-built binary missing issue due to sqlite3 N-API version mismatch

### Security

## [1.8.2] - 2025-10-03

### New Features

### Improvements

### Bug Fixes
- Fix GitHub Actions Windows build failures
  - Add Windows SDK installation step in CI/CD workflow to resolve missing compilation toolchain
  - Configure electron-builder to prefer pre-built binaries to avoid building native modules from source
  - Add .npmrc configuration file specifying mirror sources and build options
  - Resolve node-gyp compilation failures for native modules such as sqlite3 and sharp on Windows
  - Fix build errors caused by Visual Studio 2022 being installed but missing Windows SDK components

### Security

## [1.8.1] - 2025-10-03

### New Features

### Improvements
- Add Python 3.11 environment configuration in GitHub Actions workflows
  - Add Python environment setup steps for macOS and Windows build jobs
  - Ensure Python dependencies are correctly installed during the build process
  - Improve CI/CD workflow stability

### Bug Fixes

### Security

## [1.8.0] - 2025-10-03

### New Features
- Add memory management view, implement AI memory visualization and management
- Integrate mem0 AI intelligent memory layer system
- Implement text embedding API based on mem0 design
- Add unified logout handler, improve main process IPC architecture
- Integrate ChromaDB server into main process, implement mem0 system production environment optimization
- Integrate multi-model LLM support

### Improvements
- Optimize memory component UI design and code structure
- Migrate vector storage from ChromaDB to better-sqlite3 + sqlite-vec
- Upgrade authentication system to V3.0, refactor Token data structure
- Optimize Token monitoring system startup timing and management
- Optimize startup workflow performance and debugging capabilities
- Complete authentication system V2 refactoring and type system integration
- Implement KosmosMemory singleton pattern, simplify architecture and strengthen production environment support
- Comprehensively enhance system logging and debugging capabilities
- Complete LLM module migration from renderer process to main process
- Refactor authentication system architecture, implement main process–renderer process separation
- Remove environment variable dependency from GitHub Copilot configuration
- Refactor configuration management architecture and optimize module organization
- Refactor GitHub Copilot model management architecture
- Implement Memory system singleton pattern and user-specific persistence paths
- Refactor memory management system as native Kosmos component
- Migrate to GitHub Copilot official model configuration format
- Improve main process IPC architecture, optimize memory system and Webpack configuration

### Bug Fixes
- Unify macOS and Windows window close behavior
- Fix proactive token refresh logic in ConversationSummarizer
- Fix GitHub Copilot token expiration issue, unify token management architecture
- Fix startup page progress bar animation and state change display issues
- Fix GitHub Copilot token refresh mechanism, resolve expired token issue
- Unify Token monitoring event system, optimize re-authentication workflow
- Fix IPC data format handling in agentChat.ts

### Security

## [1.7.1] - 2025-09-25

### New Features

### Improvements
- Enhance re-authentication workflow with complete system cleanup functionality

### Bug Fixes
- Remove reference to non-existent test script to fix compilation error
- Implement full-screen dialog for token expiration re-authentication

### Security

## [1.7.0] - 2025-09-25

### New Features
- Enhance message Markdown rendering and table display functionality
- Add real-time date and time information to user messages
- Add FetchWebContentTool built-in tool for web content scraping
- Add Bing web search built-in tool
- Add GitHub Copilot multi-model API testing toolkit
- Add Cherry Studio long-term memory system technical research report

### Improvements
- Refactor directory structure and standardize file naming conventions to camelCase
- Refactor profileOps directory structure and fix related references
- Rename profile directory to userData and fix all file references
- Rename tools directory to builtinTools and fix file references
- Rename update directory to autoUpdate and fix related references
- Refactor mcp directory to mcpRuntime and fix related references
- Refactor component directory structure, unify UI component management
- Refactor streaming rendering components and MCP component directory structure
- Refactor Agent components and navigation component directory structure
- Refactor safeConsole module to utilities directory
- Refactor SigninOps module directory structure
- Refactor ProfileCacheManager file naming conventions
- Refactor update module directory structure
- Refactor vscodeMcpClient directory structure to under mcp module

### Bug Fixes
- Fix visual flicker on card switching in ChatSessionsSidepane
- Fix streaming output being frequently interrupted by syncs

### Security

## [1.6.1] - 2025-09-22

### New Features

### Improvements

### Bug Fixes
- Fix missing IPC handler for saving to auth.json after token refresh
  - Add missing signin:updateAuthJson IPC handler to main.ts
  - Resolve error where AuthManager could not save session data after successful token refresh
  - Fix No handler registered for signin:updateAuthJson IPC communication issue
  - Ensure token refresh and auth.json save workflow executes completely
- Fix update dialog displaying "Unknown" version number
  - Add latest field support in UpdateInfo interface to be compatible with version data sent from main process
  - Adjust version field reading priority in UpdateProvider to prefer the latest field
  - Complete version info fallback chain: latest -> version -> latest -> version -> Unknown
  - Resolve data mismatch where main process uses latest field but renderer process prioritizes version field
  - Ensure update notifications and download completion prompts correctly display the actual version number

### Security

## [1.6.0] - 2025-09-21

### New Features
- Add menu to chat session sidebar to support delete and fork operations

### Improvements
- Refactor chat session management component architecture
- Refactor chat session state management architecture
- Complete migration refactoring of AuthOps and StartupOps to SigninOps
- Complete SigninOps unified authentication system migration
- Rename AuthOpsV2 to SigninOps as unified login operations manager
- Rewrite AuthManagerV2 and complete comprehensive adaptation
- Refactor AuthManager initialization workflow and fix Profile selection interface issues
- Refactor Auth system to implement separation of responsibilities and performance optimization
- Major simplification of Session validation mechanism
- Optimize debug log output to reduce console noise
- Optimize login page token expiration hint text

### Bug Fixes
- Fix TokenMonitor not starting, causing access token monitoring to be ineffective
- Fix DataLoadingPage stuck and not redirecting after login

### Security

## [1.5.3] - 2025-09-15

### New Features

### Improvements
- Remove ProfileV1 support, unify to ProfileV2 architecture

### Bug Fixes
- Complete fix for ghost connection and ghost server issues
- Fix missing version number display in update dialog
- Fix profile alias access issue causing ChatSession save failures

### Security

## [1.5.2] - 2025-09-15

### New Features

### Improvements

### Bug Fixes
- Fix profile alias access issue causing ChatSession save failures
- Fix missing alias field in profile data sync in ProfileCacheManager
- Implement type-safe access to ProfileV1 and ProfileV2 union types in AgentChat
- Add strict object checks and type assertions to avoid TypeScript compilation errors
- Improve error log output for easier problem locating and debugging
- Resolve ChatSession save failures caused by "No current profile alias found"

### Security

## [1.5.1] - 2025-09-14

### New Features

### Improvements

### Bug Fixes
- Fix field missing due to V2 format Profile initialization timing issues
- Add ensureV2ProfileIntegrity method to ensure chatSessions field exists
- Automatically repair missing chats array and chatSessions field structure
- Add data integrity check and auto-repair when reading V2 Profile
- Improve Profile data robustness to prevent runtime chatSessions field anomalies

### Security

## [1.5.0] - 2025-09-14

### New Features
- Add chat session sidebar functionality
- Add intelligent chat session title generator
- Implement GitHub Copilot Token sleep/resume recovery system
- Internationalize chat session sidebar text

### Improvements
- Refactor ChatSessionsSidepane selection state management system
- Optimize chat session management architecture and agent functionality
- Refactor chat session management architecture and API interfaces
- Refactor chat session operation API, unify save logic
- Refactor ChatSessionOps architecture to dual backend mode
- Add comprehensive chatSession architecture design documentation
- Improve release workflow documentation wording precision

### Bug Fixes

### Security

## [1.4.4] - 2025-09-09

### New Features
- Migrate to GitHub Copilot API and enhance MCP configuration timestamp functionality
- Switch interface language from Chinese to English
- Extend plain text file format support to 80+ types
- Implement fully unified style between others attachment type and file type
- Implement LeftNavigation component hiding in minimal mode
- Redesign minimal mode button as a standard toggle control
- Implement dynamic window size restriction in minimal mode
- Implement window always-on-top in minimal mode

### Improvements
- Refactor chat session data structure from histories to sessions
- Merge image and file attachment entry points into a unified entry
- Unify AgentHeader and ChatViewHeader button styles
- Optimize chat interface button icon design
- Optimize GitHub Copilot Token pre-refresh time from 20 minutes to 5 minutes

### Bug Fixes
- Fix duplicate toast issue caused by conflict between manual and automatic update checks
- Fix update progress data type mismatch issue
- Fix root cause of GitHub Copilot Token auto-refresh
- Fix AgentMcpServersTab Server List unable to scroll
- Optimize others attachment type icon display strategy

### Security

## [1.4.3] - 2025-09-09

### New Features
- Add 80+ plain text file format support, greatly expanding file attachment compatibility
  - Add full C/C++ series support (.c, .cc, .cpp, .cxx, .c++, .h, .hpp, .hxx, .h++)
  - Expand web technology stack support (.vue, .svelte, .scss, .sass, .less, .mjs, .cjs)
  - Add modern programming language support (.kt, .swift, .dart, .jl, .lua, etc.)
  - Complete shell script support (.bash, .zsh, .fish, .ps1, .psm1, .psd1)
  - Add configuration file support (.toml, .ini, .env, .dockerfile, .editorconfig)
  - Add data format support (.csv, .log, .patch, .diff, .pem, .crt)
- Add minimal mode feature set for a more focused user interface
  - Implement LeftNavigation component hiding in minimal mode
  - Add window always-on-top in minimal mode
  - Implement dynamic window size restriction in minimal mode
  - Redesign minimal mode button as a standard toggle control

### Improvements
- Refactor attachment system architecture to implement a unified file processing entry
  - Merge image and file attachment entry points into a single file attachment button
  - Implement smart file type detection, automatically calling the corresponding processing logic by file type
  - Simplify user interface, reduce user cognitive load and operational complexity
  - Maintain backward compatibility — all existing features (drag-and-drop, paste, model adaptation) fully preserved
- Unify attachment display styles to improve interface consistency
  - Implement fully unified style between others attachment type and file type
  - Remove metadata display label for others type, achieve visual consistency with file type
  - Unify CSS class names, others type uses file-attachment style to ensure layout consistency
  - Retain hover tooltip to provide complete file information while keeping a clean interface
- Optimize user interface design and interaction experience
  - Unify AgentHeader and ChatViewHeader button styles
  - Optimize chat interface button icon design

### Bug Fixes
- Fix others attachment type icon display strategy
  - Change others type attachment icon from fixed paperclip to smart file type icon
  - Reuse getFileTypeIcon function to display semantic icons based on file extension
  - Improve user experience — others type files now display more intuitive file type indicators
  - Keep icon logic fully consistent with file type attachments to enhance interface consistency

### Security

## [1.4.2] - 2025-09-02

### New Features

### Improvements

### Bug Fixes
- Fix root cause of GitHub Copilot Token auto-refresh
  - Fix AuthManager.initializeTokenMonitor() startup condition being too strict, causing monitoring to be ineffective
  - Implement unconditional TokenMonitor startup to ensure proactive monitoring is always active
  - Enhance TokenMonitor robustness and session check recovery mechanism
  - Improve diagnostic logging system to provide detailed token lifecycle tracking
  - Add state check logic to prevent duplicate TokenMonitor startup
- Fix AgentMcpServersTab Server List unable to scroll
  - Force apply overflow-y: auto !important to resolve CSS style conflicts
  - Add max-height: calc(100vh - 120px) to ensure container height constraint
  - Add overflow-x: hidden to prevent horizontal scroll interference
  - Add flex-shrink: 0 to server-list to avoid content being compressed
  - Fix tab-body container scrolling failure caused by being overridden by other CSS rules

### Security

## [1.4.1] - 2025-08-30

### New Features

### Improvements

### Bug Fixes
- Remove canvas dependency to resolve Windows build failure

### Security

## [1.4.0] - 2025-08-30

### New Features
- Implement two-phase image compression strategy to optimize storage space
- Implement context compression architecture based on pseudocode standard
- Add complete architecture and implementation for context compression system
- Complete Streaming v2 architecture refactoring and UI blocking issue fix
- Implement complete file reference architecture optimization
- Enhance Agent chat and Profile data management functionality
- Add chat history example files

### Improvements
- Optimize chat context compression and listener mechanism
- Refactor AgentChat data flow architecture and fix frontend JSON rendering issues
- Remove Streaming v2 experimental implementation and unify to standard streaming
- Refactor chat system to unified attachment processing architecture
- Refactor Message.tsx unified attachment display system
- Optimize chat header status indicator display
- Refactor document structure and add core feature documentation
- Optimize model selector capability tag display
- Optimize ChatInput attachment card size and layout
- Consolidate attachment system documentation and feature optimization
- Optimize streaming output logging system, significantly reduce redundant log output
- Complete VSCode file attachment research and design Kosmos file reading solution
- Merge image compression file architecture optimization
- Remove Model entry from left navigation
- Optimize left navigation update button to fit 60px width

### Bug Fixes
- Fix Claude model unified content architecture compatibility issues
- Fix Claude model message format compatibility issues
- Fix 413 error caused by difference between Token calculation and HTTP request body size
- Fix ContextBadge token duplicate calculation issue
- Fix root cause of GitHub Copilot API token not auto-refreshing on expiration
- Fix file attachment [object Object] display issue
- Fix GitHub Copilot API token limit issue and update documentation
- Fix ReadFileTool double serialization and path validation issues
- Fix ReadFileTool duplicate API call implementation and improve file reading tool system
- Fix Windows file path validation issue
- Fix ChatInput attachment card delete button not responding
- Fix MCP Server Editor field disappearing and configuration being unexpectedly modified

### Security

## [1.3.0] - 2025-08-22

### New Features
- Add complete image attachment chat functionality, supporting image upload and display
- Add image drag-and-drop upload, support dragging images directly into the chat area
- Add screenshot paste support, can directly paste images from clipboard
- Add attachment card grid layout and image preview functionality
- Add VSCode file attachment mechanism in-depth research documentation
- Add MCP tool research and technical analysis documentation

### Improvements
- Redesign attachment card grid layout, optimize image preview experience
- Fully implement image chat functionality, strictly aligned with VSCode Copilot Chat experience
- Refactor document structure, consolidate logging system documentation into docs/logger directory
- Add maintainer permissions for team member jianliwei

### Bug Fixes

### Security

## [1.2.0] - 2025-08-19

### New Features
- Add AgentChat no-tool scenario performance optimization with complete documentation
- Add AgentChatManager unified instance management architecture
- Add system prompt optimizer fully internationalized to English
- Add AzureOpenAIModelApi complete system prompt support
- Add Agent tool isolation mechanism and dynamic sync functionality
- Add IPC interfaces and frontend ChatOps operations for ChatConfig
- Add AgentChat architecture supporting independent instance management of ChatHistory
- Add cross-platform adaptive window Header refactoring

### Improvements
- Refactor ProfileCacheManager to V2 architecture supporting multi-chat configuration
- Complete V1 to V2 architecture migration and IPC communication fixes
- Complete ProfileDataManager V2 architecture migration
- Refactor LLM service module directory structure to optimize code organization
- Refactor ChatView to dual-area layout and fix resize issues
- Refactor chat view component architecture and optimize navigation layout
- Refactor Left Navigation to Slack-style 80px narrow sidebar design
- Optimize chat interface display to support dynamic information based on current agent
- Optimize Agent Chat Editor interface design and interaction experience
- Unify MCP server card design style in Agent Editor
- Refactor AgentChatEditor component styles, unify Kosmos design system
- Improve Agent editor Tab data isolation mechanism
- Remove all mobile style support, focus on desktop experience
- Standardize Profile v2 sample configuration format
- Unify profile configuration file naming to profile.json
- Clean up test files and refactor configuration file structure
- Refactor project documentation structure and directory organization
- Optimize user dropdown menu layout and display

### Bug Fixes
- Fix Agent editor markdown spacing and Toast notification display issues
- Fix streaming text rendering to stable version logic
- Fix data loss issue when switching Tabs in AgentChatEditor
- Fix data consistency and UI rendering issues in add mode
- Fix AgentList menu hierarchy issue and protect system default Agent
- Fix MCP server management button not responding
- Fix button logic switching issue in Add mode
- Fix model switching IPC notification blocking issue
- Fix New Chat button state sync issue
- Fix ChatContainer flicker on startup and improve performance optimization
- Fix ProfileCacheManager IPC retry mechanism
- Fix inconsistent font size of name and role in AgentList component
- Fix streaming inconsistency before and after in Multi-Agent architecture
- Fix layout issue where WindowHeader was obscuring UserSection
- Fix nav-item horizontal centering and adjust navigation bar width to 60px
- Fix AzureOpenAI module filename typo

### Security

## [1.1.1] - 2025-08-14

### New Features
- Add complete Mac sandbox environment adaptation solution
- Add intelligent command path resolution mechanism, supporting Homebrew, system paths, user installations, and all common locations
- Add enhanced environment variable building functionality to resolve Mac App Store sandbox PATH restriction issues

### Improvements
- Complete vscMcpClient sandbox adaptation, migrating mature adaptation solution from mcpClient
- Optimize stdio transport type compatibility and stability on Mac
- Improve technical documentation, add complete Mac sandbox adaptation solution chapter

### Bug Fixes
- Fix MCP server command path resolution failure in Mac sandbox environment
- Fix development tools (uvx, pip, uv, python, npm, node, etc.) not found on Mac
- Improve MCP server connection success rate on Mac from ~30% to over 95%

### Security

## [1.1.0] - 2025-08-14

### New Features
- Add complete VSCode MCP client implementation
- Add Windows installer one-click install experience
- Add VSCode MCP client manager integration

### Improvements
- Complete full vscMcpClient mode migration and documentation consolidation
- Complete VSCode MCP Client transport layer architecture refactoring and file cleanup
- Implement hybrid mode architecture to optimize memory usage
- Clean up temporary documents after VSCode MCP Client refactoring is complete
- Optimize Windows installer to one-click install experience, simplify installation process

### Bug Fixes
- Fix frontend state sync delay during reconnection operations
- Fix pm-studio-mcp initialization timeout issue
- Completely fix AbortSignal memory leak in retry loop
- Completely fix EventTarget memory leak causing process crash
- Resolve VscodeHttpTransport memory leak issue
- Fix 'currently connecting, cannot reconnect' error when user reconnects

### Security

## [1.0.21] - 2025-08-11

### New Features

### Improvements
- Complete release automation workflow documentation and commit format specification
- Update auto-update system documentation and clean up outdated documentation

### Bug Fixes
- Fix MCP ghost data issue and improve baseline data sync mechanism
- Fix updateManager toast and UpdateDialog version number display issues
- Fix failure to retrieve RELEASE_CDN_URL environment variable when packaging on Windows

### Security

## [1.0.20] - 2025-08-11

### New Features

### Improvements

### Bug Fixes
- Fix update notification display logic when version number is empty, avoid displaying abnormal version number format

### Security

## [1.0.19] - 2025-08-11

### New Features

### Improvements

### Bug Fixes

### Security

## [1.0.18] - 2025-08-11

### Bug Fixes
- Fix write EIO error on application exit in sandbox environment
- Fix GitHub Copilot API token auto-refresh mechanism
- Complete GitHub Actions environment variable configuration

### Improvements
- Fix background color difference between ChatInput and ChatContainer
- Optimize ChatInput interface design to achieve seamless borderless blending effect

### New Features
- Add safe console log output functionality
- Add token refresh fix test script

## [1.0.17] - 2025-08-10

### Improvements
- Unify model-badge styles in ModelConfigSidepane with McpServerCard for consistency
- Adjust font size from 10px to 0.75rem for improved readability
- Update padding from 3px 8px to 0.25rem 0.5rem to optimize visual spacing
- Change border radius from 12px to 8px to align with other UI components
- Simplify color scheme by using semi-transparent background instead of gradient for better performance
- Add transition effects to ensure consistent interaction experience

## [1.0.16] - 2025-08-10

### New Features
- Sync GitHub Copilot model configuration with API return list
- Add GitHub Copilot model data management functionality
- Add model configuration table generation tool and documentation
- Add GitHub Copilot model retrieval script

### Bug Fixes
- Fix auth.json file format error
- Optimize model configuration interface

### Improvements
- Complete English internationalization refactoring of Chinese content in renderer directory
- Clean up overly complex update preference settings component
- Clean up unused test script files
- Optimize code structure and internationalization support

### Removed
- Remove test-update-system.js and other test scripts
- Remove fix-uvx-path.js script
- Remove verify-app-permissions.sh script
- Remove UpdatePreferences.tsx overly complex component

## [1.0.15] - 2025-08-09

### Improvements
- Simplify startup page validation workflow, remove unnecessary "analyze results" step
- Optimize startup experience, reduce validation stages and wait time
- Remove detailed results display after validation completion, redirect directly to the corresponding page
- Update startup page version number display to match actual application version

## [1.0.14] - 2025-08-09

### Bug Fixes
- Fix RELEASE_CDN_URL environment variable not readable in packaged application
- Fix silent update check failure
- Improve environment variable loading mechanism in main and renderer processes

### Improvements
- Unify environment variable definition handling in webpack configuration
- Enhance robustness of environment variable file lookup
- Optimize configuration consistency in packaged application

## [1.0.13] - 2025-08-09

### New Features
- Implement smart cache check mechanism to optimize download workflow
- Implement CDN auto-update download functionality

### Bug Fixes
- Fix update notification failure caused by IPC communication interruption after macOS window rebuild
- Fix residual child processes after application close
- Fix Toast install button failure and optimize user experience
- Fix three critical issues in the auto-update system and refactor notification mechanism

### Improvements
- Optimize left panel UserSection layout and update button styles
- Optimize chat interface component seamless blending effect
- Improve Git Push automation prompt format specification
- Add CDN URL configuration description

## [1.0.12] - 2025-08-08

### Improvements
- Refactor Electron build configuration, separate build targets for different architectures
- Standardize product file naming convention to KOSMOS-{version}-{platform}-{arch} format
- Remove portable format build, focus on DMG and NSIS installers
- Optimize Mac and Windows platform build workflows to improve release efficiency

### New Features
- Add release automation workflow documentation (.github/prompts/release.prompt.md)
- Provide comprehensive version release operation guide

## [1.0.11] - 2025-08-08

### Improvements
- Fixed dependency issue in GitHub Actions workflow
- Temporarily disabled validation steps to ensure build completion
- Improved dependency configuration for notification steps

### Bug Fixes
- Fixed issue where notify step could not execute due to disabled validate step
- Ensured completion notification is correctly sent after successful build

## [1.0.10] - 2025-08-08

### New Features
- Added detailed README.md documentation for release directory
- GitHub Actions environment variable support (supports .env.local configuration)

### Improvements
- Optimized GitHub Actions workflow configuration
- Cleaned up duplicate workflow files
- Improved build artifact documentation

### Bug Fixes
- Fixed GitHub Actions release permission issue (403 Forbidden)
- Fixed incorrect repository owner configuration in package.json
- Removed conflicting build.yml workflow file

## [1.0.9] - 2025-08-08

### New Features
- 

### Improvements
- 

### Bug Fixes
- Repository configuration in GitHub Actions workflow files

## [1.0.8] - 2025-08-08

### New Features
- Complete auto-update system
- Smart update notification strategy
- User preferences settings interface
- Per-platform build support

### Improvements
- Optimized icon file configuration
- Improved GitHub Actions workflows
- Enhanced error handling mechanism

### Bug Fixes
- Fixed icon file path issue
- Fixed per-platform build configuration

---

## Version Notes

### Version Format
Uses Semantic Versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Incompatible API changes
- **MINOR**: Backward-compatible new functionality
- **PATCH**: Backward-compatible bug fixes

### Change Types
- **New Features**: New functionality
- **Improvements**: Improvements to existing functionality
- **Bug Fixes**: Bug fixes
- **Removed**: Removed functionality
- **Security**: Security-related fixes

### Release Notes
Each version provides detailed release notes and download links on the [GitHub Releases](https://github.com/gim-home/Kosmos/releases) page.
