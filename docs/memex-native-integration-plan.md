# Memex Native Integration — Implementation Plan (canonical, on-disk)

> Status: DONE - Author: AI pair - Persisted so it survives context compression.
> Supersedes `docs/memex-per-agent-memory-tech-doc.md` (the stdio-MCP design). **No backward compatibility** is required.

## Decisions (locked by user)
1. Agent interacts with memory through **one built-in tool** `memex_memory` that internally orchestrates all public Memex operations (`recall`/`search`/`capture`/`read`/`links`/`organize`/`archive`). V1 durable writes go through `capture` only; raw `retro`/`write` remain internal compatibility helpers and are not exposed to the model.
2. **Vendor memex source into the repo** and call it natively. No `npm install -g`, no stdio MCP server, no child process. Upstream upgrades = manual pump-and-merge.
3. **No sync** (drop git/GitLab sync). **No embeddings / semantic search.** **No backward compat** (delete the old MCP-based plumbing).
4. Each agent keeps its own memory dir: `home = <userData>/profiles/<alias>/agents/<agentId>/memory`; V6/load-time migration moves legacy `<profile>/memex_memory/<chatId>` contents into the primary agent's memory dir.
5. Each chat gets a **memory sidepane** for its primary agent, built to match existing sidepanes (`Sidepane.css`, `chat-side.atom.ts`, `ChatSide`, `ChatViewHeader` toggle).

## Verified facts (do not re-research)
- Built-in tools live in `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts`: register in `initialize()` (`this.tools.set(name, def)`) AND dispatch in `executeTool()` (if/else chain). Def shape `{name, description, inputSchema: JSONSchema}`. Return `{success, data: JSON.stringify(result)}` or `{success:false, error}`.
- Facade pattern with an `operation`/`action` enum already exists (`manage_mcp`, `manage_process`, `manage_agents`). `memex_memory` follows it 1:1.
- `ToolExecutionContext` (`src/main/lib/subAgent/types.ts:122`) has `chatId`, `userAlias`, `chatSessionId`, `cancellationToken`. Set in `agentChatToolExecutor.ts:168` and `subAgentToolExecutor.ts:90`. The `memex_memory` dispatch resolves `chatId` to the current primary `agentId` via the profile before calling `MemexMemoryTool`.
- OpenKosmos already has deps: `@modelcontextprotocol/sdk@^1.26`, `zod@^3.25`, `js-yaml@^4.1`. Missing: `gray-matter`, `commander` (do NOT add — patch them out).
- memex upstream `@touchskyer/memex` is MIT, default branch `main`, currently v0.3.2.
- memex card format: `<home>/cards/<slug>.md`, YAML frontmatter `title, created, source` (req) + `modified, category, tags, status` (opt), body has `[[wikilinks]]`. Archive at `<home>/archive/`. Config `<home>/.memexrc` (JSON, `nestedSlugs` etc.). Link graph computed at runtime (regex `\[\[([^\]]+)\]\]`).
- `linksCommand(store, slug, {json:true})` returns structured link data, but its outbound list is raw authored wikilinks. `readCardStructured()` must expose only navigable outbound slugs by resolving/filtering against known cards; reuse `linksCommand` for inbound and aggregate stats.

## Vendor set → `src/main/lib/memex/vendor/`
Pump these upstream files (keep verbatim except the patches noted). Record every deviation in `vendor/memex/PATCHES.md`.

| Upstream | Vendored as | Patch |
|---|---|---|
| `src/lib/store.ts` | `vendor/store.ts` | none (rewrite imports extensionless) |
| `src/lib/parser.ts` | `vendor/parser.ts` | **gray-matter → js-yaml** in `parseFrontmatter` (`stringifyFrontmatter` is hand-rolled, keep) |
| `src/lib/scan.ts` | `vendor/scan.ts` | none |
| `src/lib/scoring.ts` | `vendor/scoring.ts` | none |
| `src/lib/formatter.ts` | `vendor/formatter.ts` | none |
| `src/lib/sensitive-input.ts` | `vendor/sensitiveInput.ts` | none |
| `src/lib/config.ts` | `vendor/config.ts` | strip unused embedding-provider fields + `EmbeddingProviderType` import |
| `src/commands/search.ts` | `vendor/commands/search.ts` | **remove `semantic` branch + embeddings import** |
| `src/commands/read.ts` | `vendor/commands/read.ts` | none |
| `src/commands/write.ts` | `vendor/commands/write.ts` | none |
| `src/commands/links.ts` | `vendor/commands/links.ts` | none |
| `src/commands/organize.ts` | `vendor/commands/organize.ts` | none |
| `src/commands/archive.ts` | `vendor/commands/archive.ts` | none |

**Do NOT vendor:** `embeddings.ts`, `sync.ts`, `hooks.ts`, `mcp/*`, `cli.ts`, upstream service and maintenance commands, `importers/*`, or `share-card/*`.
ESM adaptation: vendored files become `.ts`, imports rewritten to extensionless OpenKosmos style; no `import.meta.url`; `node:` prefixes are fine in main process.

## Native facade → `src/main/lib/memex/MemexService.ts` + `memexHome.ts`
- `memexHome.ts`: `buildMemexHome(userData, alias, agentId)`, plus `ensureHome(home)` as an explicit setup helper. Read-only IPC/tool operations must not call `ensureHome`; the memory tree is created lazily by the first write.
- `MemexService` (stateless, home passed per call). Methods wrap commands:
  - text-returning (for the tool): `recall`, `search`, `capture`, `read`, `links`, `organize`, `archive`.
  - structured (for the sidepane): `listCards(home) → {slug,title,category,created,modified,excerpt}[]`, `readCardStructured(home, slug)` (outbound filtered to known navigable slugs), `getGraph(home) → {nodes, edges, orphans, hubs}` (known-card edges only).
- `recall` = index/list-or-search; `capture` = validated durable write/update/correct operation with provenance stamping. Legacy `retro`/`write` service helpers are internal compatibility surfaces only. Replaces upstream's MCP `operations.ts` minus sync hooks.

## Agent tool → `src/main/lib/mcpRuntime/builtinTools/memexMemoryTool.ts`
- Name `memex_memory` (snake_case per convention; UI label "Memex Memory").
- `inputSchema`: `{ operation: enum[recall,search,capture,read,links,organize,archive], description: string (UI), query?, slug?, title?, body?, mode?, source_type?, source?, source_anchor?, profile_intent_quote?, category?, tags?, related_slugs?, tag?, since?, before? }`, required `[operation, description]`.
- `BuiltinMcpClient.executeTool()` captures the full `ToolExecutionContext` before its first async boundary, then passes that immutable per-call snapshot through `BuiltinToolsManager.executeTool(..., capturedExecutionContext)`.
- The `memex_memory` dispatch branch MUST use that captured context (`userAlias`, `chatId`) and resolve the primary `agentId` from the profile before calling `MemexMemoryTool.execute(args, ctx)`; do not re-read `BuiltinToolsManager.getExecutionContext()` after an await, because concurrent sessions can overwrite the mutable static context.
- `MemexMemoryTool.execute(args, ctx)`: `home = buildMemexHome(app.getPath('userData'), ctx.userAlias, ctx.agentId)` -> `switch(operation)` -> MemexService -> return text. Do not create directories before read-only operations; capture/archive mutations create or move cards through the store. Throw on unknown op / missing context. Sub-agents are read-only and must be rejected for `capture` and `archive`.
- Register in `initialize()` and dispatch in `executeTool()`.

## Sidepane read IPC → rewrite `src/shared/ipc/memex.ts`
Replace enable/disable/getStatus with chat-scoped, structured reads; the main handler resolves each `chatId` to the primary agent memory dir:
- `listCards: { call:[chatId:string], return: MemexResult<CardSummary[]> }`
- `readCard: { call:[chatId:string, slug:string], return: MemexResult<CardDetail> }`
- `getGraph: { call:[chatId:string], return: MemexResult<MemexGraph> }`
- `searchCards: { call:[chatId:string, query:string], return: MemexResult<CardSummary[]> }`
- push `memex:cardsChanged { chatId, agentId }` when a card is written. The write event is keyed by `agentId` and main-process IPC fans it out to every chat referencing that agent, so shared-agent sidepanes refresh consistently.
Update `src/preload/memex/{api,invoke}.ts`, `src/preload/main.ts`, `src/renderer/ipc/memex.ts`. Main handlers in a new `memexIPC.ts` resolve alias from session + call MemexService.

## Sidepane UI (renderer, match existing pattern; <500 lines/file)
- `src/renderer/components/chat/chat-side.atom.ts`: add `MemexMemorySidepaneAtom` with `effectiveShow/effectiveToggle` closing the other 3 panes + inline preview (mutual exclusion).
- `src/renderer/components/chat/ChatViewHeader.tsx`: add `ToggleMemexMemorySidepane()` button (Brain/Network icon) calling `effectiveToggle`.
- `src/renderer/components/chat/ChatSide.tsx`: mount `<MemexMemorySidepane />` in the sibling list.
- `src/renderer/components/chat/MemexMemorySidepane.tsx`: `if(!isVisible) return null`; `useCurrentChatId()`; fetch via `memexApi.listCards(chatId)` in `useEffect` gated on visible; subscribe to `cardsChanged`; reuse `Sidepane.css` (`.chat-sidepane`, `.sidepane-section-header/body/close-btn`). Split into `MemexCardList`, `MemexCardDetail`, (optional) `MemexGraphView` subcomponents to stay <500 lines.
- Entry point under chat header (not Settings). Enablement follows the embedded-browser pattern: a profile.json `memex.enabled` master switch (default off) in Settings → Memex Memory — no feature flag.

## Removal (no backward compat) — after native path is green
- Delete `src/main/lib/memex/MemexManager.ts` (replaced by MemexService).
- Rewrite `src/main/lib/memex/memexIPC.ts` for the new IPC (no enable/disable installs).
- `src/main/startup/ipc/index.ts`: replace `setupMemex` wiring (no MCP server provisioning).
- `src/main/startup/ipc/profile.ts`: remove `onAgentCreated/onAgentDeleted` memex hooks (dirs are lazy-created on first write).
- `src/renderer/components/settings/MemexView.tsx`: the old install/enable toggle was removed (the sidepane replaces the per-agent install lifecycle). A new `MemexSettingsView` (+ `SettingsNavigation` nav item + unconditional `AppRoutes` `/settings/memex` route) renders only the profile.json `memex.enabled` master switch, mirroring `BrowserSettingsView`.
- `McpServerConfig.hidden` field + the 4 `.filter(!s.hidden)` sites: leave as-is (harmless dead code) unless trivially removable; not on critical path.

## Phases / task IDs
1. Vendor core (+PATCHES.md). 2. MemexService + memexHome. 3. `memex_memory` tool. 4. Read IPC (shared/preload/renderer/main). 5. Sidepane UI. 6. Remove old MCP plumbing. 7. Tests + `npm run build:vite` + `npm run typecheck` + docs (`ai.prompt.md` updates, mark this plan DONE).

## Gotchas
- Resolve `home` per-call from execution context; never cache across agents.
- `parser.ts` patch must preserve upstream behavior (fallback strip on YAML parse failure).
- Keep vendored files verbatim to ease pump-merge; concentrate edits, document in PATCHES.md.
- Renderer component files must stay <500 lines (CLAUDE.md). English-only everywhere.
- After each module change: `npm run check:impact -- <files>`, read flagged `ai.prompt.md`.
