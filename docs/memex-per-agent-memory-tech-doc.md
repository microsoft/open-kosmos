# Memex Memory Technical Design

> Version: 2.3.0 | Date: 2026-07-04

## 1. Overview

Memex Memory gives OpenKosmos a persistent, local Zettelkasten-style memory made of Markdown cards with YAML frontmatter and `[[wikilink]]` references. It now has two scopes:

1. `current-agent`: existing per-agent memory isolated to one stable `agentId`.
2. `profile-memory`: memory shared by every agent in the current profile.

The current implementation is native and vendored: OpenKosmos imports the memex command/library code under `src/main/lib/memex/vendor/` and calls it in-process from the Electron main process.

There is no global memex CLI install, no stdio MCP server, no child process, no embeddings, no sync, and no `openkosmosFeatureMemexMemory` feature flag. Enablement is controlled by the per-profile `memex.enabled` master switch in `{userData}/profiles/<alias>/profile.json`, surfaced in Settings -> Memex Memory.

Design goals:

1. **Per-agent isolation**: each stable `agentId` has its own memory root under the agent store.
2. **Profile-scoped sharing**: profile-memory is shared across all agents in one profile, without crossing profile boundaries.
3. **Native tool execution**: agents call one built-in tool, `memex_memory`, instead of a hidden MCP server.
4. **Narrow renderer mutation surface**: the chat sidepane is read-only; Settings can archive/delete profile-memory only. Create/edit stays agent-tool-only.
5. **First-write storage creation**: read-only access tolerates missing memory homes and does not create directories.
6. **Runtime toggle parity**: Settings changes update both UI visibility and the advertised built-in tool inventory without app restart.

## 2. Architecture

### 2.1 High-Level Flow

```text
Settings -> Memex Memory
  -> window.electronAPI.profile.updateMemexSettings(alias, { enabled })
  -> ProfileCacheManager persists profile.json and notifies renderer
  -> profileDataManager dispatches the toggle side-effects; mcpClientCacheManager.refresh() updates advertised built-in tools

Agent tool call
  -> BuiltinMcpClient captures ToolExecutionContext before async boundaries
  -> BuiltinToolsManager.executeTool(..., capturedExecutionContext)
  -> memex_memory dispatch reads scope (default current-agent)
  -> current-agent maps chatId to primary agentId; profile-memory uses alias only
  -> buildAgentMemexHome(...) or buildProfileMemexHome(...)
  -> MemexService calls vendored memex commands
  -> mutation operations emit memex:cardsChanged

Renderer sidepane
  -> MemexMemorySidepane reads current chatId
  -> memexApi.listCards/readCard/searchCards/getGraph(chatId, ...)
  -> memexIPC resolves alias from the signed-in session and maps chatId to the primary agentId
  -> MemexService returns structured DTOs
  -> cardsChanged refreshes the visible list/detail when chatId matches

Settings -> Memex Memory
  -> unified header exposes the memex.enabled master switch
  -> when enabled, Profile Memory uses a Hooks-style list/detail manager
  -> users can archive or permanently delete cards
  -> cardsChanged refreshes the manager when scope is profile-memory
```

### 2.2 Component Map

| Layer | File(s) | Responsibility |
|-------|---------|----------------|
| Main - Service | `src/main/lib/memex/MemexService.ts` | Stateless facade over vendored memex. Provides text operations for the agent tool and structured DTO reads for the sidepane. |
| Main - Home resolver | `src/main/lib/memex/memexHome.ts` | Builds current-agent and profile-memory paths and rejects unsafe alias/agentId path segments. |
| Main - Events | `src/main/lib/memex/memexEvents.ts` | Process-local scoped `cardsChanged` event bus keyed by user alias + scope, plus agent id for current-agent changes. |
| Main - IPC | `src/main/lib/memex/memexIPC.ts` | Registers scope-aware read handlers, profile-memory archive/delete handlers, and forwards scoped `cardsChanged` to renderer windows. |
| Main - Tool | `src/main/lib/mcpRuntime/builtinTools/memexMemoryTool.ts` | Defines and executes the scope-aware `memex_memory` built-in tool. |
| Built-in routing | `src/main/lib/mcpRuntime/builtinMcpClient.ts`, `builtinToolsManager.ts`, `mcpClientManager.ts` | Captures per-call execution context, gates tool visibility/execution via `memex.enabled`, and routes stale disabled calls to the built-in client for a recoverable disabled response. |
| Profile config | `src/main/lib/userDataADO/profileSettingsCrud.ts`, `profileCacheManager.ts`, `src/main/lib/userDataADO/types/profile.ts` | Stores `memex.enabled` in `profile.json`, default `false`. |
| Profile migration | `src/main/lib/userDataADO/profileMigration.ts`, `profileCacheManager.ts`, `agentExtraction.ts` | Removes legacy hidden `memex-*` MCP server configs/bindings and moves legacy chat-scoped memory dirs to agent memory dirs during V6/load-time migrations. |
| Shared IPC | `src/shared/ipc/memex.ts` | Defines tuple-based read IPC and `memex:cardsChanged` payload types. |
| Preload | `src/preload/memex/invoke.ts`, `src/preload/memex/api.ts`, `src/preload/main.ts` | Exposes whitelisted read invokes and a channel-scoped `onCardsChanged` subscription that passes only payloads to the renderer. |
| Renderer API | `src/renderer/ipc/memex.ts` | Binds renderer read calls and `cardsChanged` subscription. |
| Renderer sidepane | `src/renderer/components/chat/MemexMemorySidepane.tsx`, `MemexMemorySidepaneParts.tsx`, `chat-side.atom.ts`, `ChatSide.tsx`, `ChatViewHeader.tsx` | Renders the Agent Memory sidepane, header toggle, list/search/detail navigation, and singleton sidepane mutual exclusion. |
| Settings | `src/renderer/components/settings/MemexSettingsView.tsx`, `ProfileMemoryListPanel.tsx`, `ProfileMemoryDetailPanel.tsx`, `ProfileMemoryDropdownMenu.tsx`, `ProfileMemoryEditorView.tsx`, `SettingsNavigation.tsx`, `AppRoutes.tsx` | Renders the per-profile Memex Memory master switch and the Hooks-aligned Profile Memory list/detail manager when enabled. Settings supports archive/delete only; `ProfileMemoryEditorView` is a compatibility redirect for old manual create/edit deep links. |

## 3. Data Model

### 3.1 Storage Layout

```text
{userData}/profiles/{alias}/agents/{agentId}/memory/
  cards/
    {slug}.md
  archive/
    {slug}.md

{userData}/profiles/{alias}/profile-memory/
  cards/
    {slug}.md
  archive/
    {slug}.md
```

`alias` and `agentId` are treated as path components and must be safe single path segments. `buildAgentMemexHome()` and `buildProfileMemexHome()` reject empty values, absolute paths, `/`, `\`, `.`, and `..` for the relevant path segments.

Read-only operations do not call `ensureHome()` and do not create `cards/`. The vendored store returns an empty scan for missing directories. The first successful write creates the needed directory through the store write path.

### 3.2 Card Format

Cards are Markdown files with YAML frontmatter:

```markdown
---
title: Example Decision
created: 2026-06-10
source: OpenKosmos
category: architecture
tags: memory, agent
---

Body text with [[related-card]] links.
```

Required fields are `title`, `created`, and `source`. Optional fields include `modified`, `category`, `tags`, and `status`.

The native integration uses a flat slug model. `MemexService` rejects explicit slugs containing `/` or `\`, and also uses the vendored `validateSlug()` to reject empty, traversal, and OS-reserved slug characters.

### 3.3 App Config

```typescript
interface MemexSettings {
  enabled: boolean;
}
```

`DEFAULT_MEMEX_SETTINGS.enabled` is `false`. The switch is per-profile (stored in `profile.json`), not app-level, and controls both:

1. Availability of the `memex_memory` built-in tool in advertised tool inventories.
2. Visibility of the Agent Memory header button and sidepane.
3. Visibility of the Profile Memory manager in Settings.

### 3.4 IPC Contract

Renderer-to-main calls use tuple arguments:

| Channel | Direction | Call | Response |
|---------|-----------|------|----------|
| `memex:listCards` | Renderer -> Main | `[target: MemexMemoryTarget]` | `MemexResult<CardSummary[]>` |
| `memex:readCard` | Renderer -> Main | `[target: MemexMemoryTarget, slug: string]` | `MemexResult<CardDetail>` |
| `memex:getGraph` | Renderer -> Main | `[target: MemexMemoryTarget]` | `MemexResult<MemexGraph>` |
| `memex:searchCards` | Renderer -> Main | `[target: MemexMemoryTarget, query: string]` | `MemexResult<CardSummary[]>` |
| `memex:archiveProfileCard` | Renderer -> Main | `[slug: string]` | `MemexResult<string>` |
| `memex:deleteProfileCard` | Renderer -> Main | `[slug: string]` | `MemexResult<string>` |
| `memex:cardsChanged` | Main -> Renderer | `{ scope: 'current-agent' \| 'profile-memory', chatId?: string, agentId?: string }` | event only |

`MemexMemoryTarget` is either `{ scope: 'current-agent', chatId }` or `{ scope: 'profile-memory' }`. The renderer `memexApi` keeps chat helpers that accept a `chatId` and wraps them into current-agent targets.

There are no renderer create/edit channels. `memex:enable`, `memex:disable`, `memex:getStatus`, raw write/read editor channels, and phase-change channels belonged to removed designs and are not part of the Settings surface. Renderer mutations are limited to `archiveProfileCard` and `deleteProfileCard` for profile-memory.

## 4. Agent Tool

The agent interacts with memory through a single built-in tool:

```text
memex_memory
```

The tool accepts `scope?: 'current-agent' | 'profile-memory'`. Omitted scope defaults to `current-agent` for backwards compatibility. `profile-memory` is shared by all agents in the current profile and requires only `userAlias`, not a primary `agentId`.

Supported operations:

| Operation | Purpose | Mutates? |
|-----------|---------|----------|
| `recall` | Browse all cards, search by query, or filter by metadata. | No |
| `search` | Keyword search; requires non-empty query. | No |
| `retro` | Capture a structured memory with title/body/category/tags. | Yes |
| `read` | Read one card's raw Markdown by slug. | No |
| `write` | Write raw Markdown with frontmatter. Advanced path; prefer `retro`. | Yes |
| `links` | Show aggregate link stats or one card's inbound/outbound links. | No |
| `organize` | Report memory graph health. | No |
| `archive` | Move a card from `cards/` to `archive/`. | Yes |

Agent-tool mutations (`retro`, `write`, `archive`) and Settings profile-memory archive/delete actions emit scoped `cardsChanged` events only after successful completion. Current-agent events include `{ userAlias, scope: 'current-agent', agentId, chatId }` and the IPC layer fans them out to every chat that references the changed agent, falling back to the origin chat if the profile cannot be read. Profile-memory events include `{ userAlias, scope: 'profile-memory' }` and are broadcast to Settings.

Search and recall propagate vendored `searchCommand` failures as tool errors. Sensitive query rejection must not be returned as successful text output.

## 5. Renderer Surfaces

The Agent Memory sidepane is a chat-scoped inspector over the chat's primary agent memory:

1. The header Brain button is rendered by `ToggleMemexMemory` only when `memex.enabled` is true.
2. `MemexMemorySidepaneAtom` is one of the singleton sidepanes. Opening it closes Workspace Explorer, Schedules, Sub-Agent Tasks, and the embedded browser.
3. List view calls `listCards(chatId)` or `searchCards(chatId, query)`.
4. Detail view calls `readCard(chatId, slug)` and renders a title header above the full raw `.md` card with the shared `FileContentRenderer`, so Markdown frontmatter, GFM, raw HTML, source-mode behavior, and future file-format handling stay aligned with the `OverlayFileViewer` file-content renderer. Memex passes a scoped wikilink resolver so known `[[slug]]` and `[[slug|label]]` references render as internal links that select the target card; unresolved wikilinks stay plain Markdown text.
5. Detail/list views subscribe to `cardsChanged` and refresh only when payload `chatId` matches the active chat; shared-agent chats all refresh because main process fan-out emits one payload per referencing chat.
6. When active `chatId` changes, the pane clears stale cards/errors and returns to list mode so a slug from the old primary agent is not read against the new primary agent.
7. When `memex.enabled` becomes false, the pane hides and resets its atom state so invisible sidepane state does not keep participating in mutual exclusion.

`CardDetail.outbound` contains only known-card slugs for graph/structured consumers, while `CardDetail.resolvedWikilinks` maps raw wikilink targets to the resolved slug used by renderer navigation. The chat sidepane detail itself is a file-content viewer and does not render separate link chips.

The Settings -> Memex Memory page follows the same management UX pattern as Settings -> Hooks because both pages manage profile-scoped resources behind a profile-level master switch. The unified header owns the Memex Memory title, card-count badges, and `memex.enabled` switch. When the switch is off, the page shows a disabled empty state with an enable CTA. When the switch is on, the page renders a two-column list/detail manager: the left column searches and selects profile-memory cards; the right column is a file-content viewer with a title header above the full raw `.md` card, rendered by the shared `FileContentRenderer` using the same file-content rendering contract as `OverlayFileViewer` plus profile-memory wikilink navigation. Row actions can archive or permanently delete a card. Settings does not provide manual create/edit; agents create or update cards through the `memex_memory` built-in tool.

## 6. Legacy Migration

The original design used hidden stdio MCP servers named `memex-{chatId}`. Native Memex removes that lifecycle.

Profile migration now:

1. Detects only legacy managed hidden memex MCP servers that match the old shape: `hidden: true`, name starts with `memex-`, `transport: 'stdio'`, `command: 'memex'`, `args: ['mcp']`, and a `MEMEX_HOME` env value.
2. Removes those MCP server configs from `profile.mcp_servers`.
3. Removes matching agent `mcp_servers` bindings.
4. Moves on-disk `profiles/{alias}/memex_memory/{chatId}` cards into `profiles/{alias}/agents/{primaryAgentId}/memory` during V6/load-time agent-store migrations.

User-created MCP servers are not removed merely because their name starts with `memex-`; they must match the full hidden legacy server shape.

For multi-agent legacy chats, the old directory was chat-level and cannot be split safely. Migration moves it to `agent_ids[0]` only to preserve the prior primary-chat behavior without copying potentially private memory to every agent. Target files win on conflict; conflicting legacy files are moved into the target with a `-{chatId}` suffix so they remain visible without overwriting existing cards.

## 7. Security and Isolation

- Main-process path composition uses `buildAgentMemexHome()` for current-agent homes and `buildProfileMemexHome()` for profile-memory homes.
- Renderer-provided `chatId` is resolved to a profile-owned primary `agentId`; only `agentId` is interpolated into the memory path after safe-segment validation.
- Slugs are validated at the service boundary and are flat; nested slug writes are rejected.
- Preload exposes only whitelisted invoke channels and a dedicated `onCardsChanged(payload)` subscription. It does not expose raw `ipcRenderer.on/off` or the raw `IpcRendererEvent`.
- Sidepane IPC is read-only; Settings mutation IPC is limited to profile-memory archive/delete; agents create/edit memory through `memex_memory` in the main process.
- Built-in tool execution uses the captured per-call `ToolExecutionContext` from `BuiltinMcpClient`, not a mutable static context read after async boundaries.

## 8. Error Handling

| Scenario | Handling |
|----------|----------|
| `memex.enabled` is false | Tool inventory hides `memex_memory`; stale calls route to the built-in client and return a recoverable disabled error. Sidepane and Settings IPC return `Memex Memory feature is disabled`; Settings hides the Profile Memory manager. |
| No signed-in alias | Sidepane and Settings IPC return a typed error. |
| Empty `chatId` | Sidepane IPC returns `chatId is required.` |
| Missing primary agent binding | Current-agent tool calls and sidepane IPC return a typed "No primary agent is bound" error. Profile-memory calls do not require a primary agent. |
| Unsafe `agentId` | `buildAgentMemexHome()` throws; IPC/tool returns `Failed to open memory: ...`. |
| Missing card slug | Text operations throw; sidepane and Settings reads return `{ success: false, error }`. |
| Sensitive search/recall query | Search command failure is thrown and returned as a tool error. |
| Mutation failure | Tool returns `{ success: false, error }` and does not emit `cardsChanged`. |
| Missing memory directory on read | Structured reads return empty collections or not-found for a specific slug; no directories are created. |

## 9. Testing Expectations

Keep tests aligned with these behavior boundaries:

- `memexHome.test.ts`: path composition and traversal rejection for `alias`/`agentId` in both scopes.
- `MemexService.test.ts`: text operations, structured reads, known-only outbound links, missing home reads, flat slug validation, sensitive query failure, archive/write behavior.
- `memexIPC.test.ts`: per-profile switch gating, scope-aware reads, Settings-only profile-memory mutations, no directory creation on reads, event forwarding.
- `memexMemoryTool.test.ts`: tool schema, scope defaulting, operation dispatch, profile-memory behavior, mutation notifications, no notification on failed mutation.
- `MemexMemorySidepane.test.tsx`: list/detail rendering, chat switch race guards, `cardsChanged` refresh, disabled-state cleanup.
- `MemexSettingsView.coverage.test.tsx` and `MemexSettingsSubViews.test.tsx`: Hooks-aligned Profile Memory header, disabled state, list/detail selection, editor routes, dropdown archive dialog, and master switch behavior.
- `chat-side.atom.test.ts`: singleton sidepane mutual exclusion.
- `profileSettingsCrud.test.ts` and profile migration tests: `memex.enabled` defaults, update behavior, legacy hidden server cleanup, and legacy chat memory migration to agent memory.

## 10. Related Documents

- Current implementation notes: [`src/main/lib/memex/ai.prompt.md`](../src/main/lib/memex/ai.prompt.md)
- Canonical implementation plan: [memex-native-integration-plan.md](memex-native-integration-plan.md)
- Chat UI module notes: [`src/renderer/components/chat/ai.prompt.md`](../src/renderer/components/chat/ai.prompt.md)
- IPC framework notes: [`src/shared/ipc/ai.prompt.md`](../src/shared/ipc/ai.prompt.md)
