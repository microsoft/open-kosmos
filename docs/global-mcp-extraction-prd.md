# Installed Global MCP Servers Extraction (profile.json → mcp.json) — PRD

<!-- Last verified: 2026-06-28 -->

> Status: **Implemented (Option B — B-main variant).** Installed global MCP servers are
> stored in `{userData}/profiles/{alias}/mcp.json` and owned end-to-end in the main
> process by a standalone `McpConfigManager` (module `mcpConfigManager.ts`) — the
> only writer of `mcp.json` and the runtime source of truth. `ProfileV2.mcp_servers`
> is now an **optional, deprecated** field, populated only transiently during the
> load/migration window; `ProfileCacheManager` writes only `profile.json`. The IPC
> wire contract is intentionally unchanged: the `profile:cacheUpdated` payload still
> carries `mcp_servers`, injected from the manager, so the renderer is unaffected.
> No downgrade dual-write; existing `McpServerConfig[]` on-disk format retained. See
> the Tech Doc for details.

## 1. Background

The **installed global MCP servers** are the per-profile pool of fully-defined MCP
servers (`name` / `transport` / `command` / `args` / `env` / `url` / `oauth` /
`source` / `in_use` / tools, …). It is currently persisted as the
`mcp_servers: McpServerConfig[]` field **inside `profile.json`**:

```
{userData}/profiles/{alias}/profile.json
  ├─ alias, chats, skills, hooks, …
  └─ mcp_servers: McpServerConfig[]      ← installed global MCP servers (this document)
```

This must not be confused with the **per-agent binding** field
`chat.agent.mcp_servers: AgentMcpServer[]`, which only stores a server **name +
selected tool subset** and references an installed global server by name. Per-agent
bindings are out of scope and stay in `profile.json`.

This document covers only locally installed, per-profile global MCP server
configs. No online source participates in this storage model.

`ProfileCacheManager` keeps the entire `ProfileV2` object in memory and rewrites
the **whole** `profile.json` atomically (temp-file + rename, 500 ms debounce) on
**every** profile mutation — a chat rename, an agent edit, a settings toggle, a
hook change, etc. The installed global MCP servers are therefore coupled to unrelated write
traffic, even though server definitions are an independent concern.

## 2. Problem

- **Write amplification / blast radius.** Every unrelated profile change rewrites
  installed MCP servers too, and every installed MCP server change rewrites the entire (potentially
  large) `profile.json`. A corrupt/interrupted write to `profile.json` risks the
  installed server configs along with everything else.
- **Poor separation of concerns.** MCP server definitions are conceptually a
  standalone, user-/tool-editable config (cf. VS Code's `mcp.json`), but they are
  buried inside the monolithic profile document.
- **Harder external editing / sync.** There is no single file a user or sync
  process can point at to read or edit installed global MCP servers in isolation.

## 3. Goals

- **G1 — Standalone storage.** Persist installed global MCP servers in a dedicated
  `{userData}/profiles/{alias}/mcp.json` file, decoupled from `profile.json`.
- **G2 — Reduced write coupling.** Installed MCP server writes touch only `mcp.json`;
  unrelated profile writes touch only `profile.json`. Each file is written only
  when its own slice actually changed (content dirty-check that excludes the
  volatile `updatedAt`), and each file carries its **own** `updatedAt` that
  advances independently of the other's.
- **G3 — Zero behavior change for consumers.** The Agent MCP picker, the MCP
  management UI, runtime connections (`mcpClientManager`), sub-agents, and the
  renderer MCP cache must behave exactly as before. No user-visible regression.
  (Plugins were also a consumer when this PRD was written; the plugin feature has
  since been removed, so they no longer apply.)
- **G4 — Safe, automatic, idempotent migration.** Existing profiles seed
  `mcp.json` from their current `profile.mcp_servers` on first load after upgrade,
  with no user action and no data loss; re-running is a no-op.

## 4. Non-goals

- **Not** moving per-agent bindings (`chat.agent.mcp_servers`) out of
  `profile.json`.
- **Not** converting the on-disk format to VS Code's `mcp.json` schema. We keep
  our own `McpServerConfig[]` shape to avoid lossy conversion of fields VS Code
  does not model (`in_use`, legacy `source`/`remoteVersion`, `hidden`, `oauth`). VS
  Code interop continues to be handled by the existing `vscodeMcpClient`
  importer, unchanged.
- **Not** making installed MCP servers truly machine-global across aliases. Scope stays
  **per-profile (per-alias)**, identical to today. ("Global" here means
  "profile-level installed servers", as opposed to per-agent bindings.)
- **Not** rewriting the IPC wire contract or the renderer MCP subsystem in this
  phase (see phasing in the Tech Doc).

## 5. User-visible behavior

None intended. From the user's perspective everything (adding/removing/editing
MCP servers, connecting, per-agent tool selection) works exactly as before. The
only observable change is a new `mcp.json` file next to `profile.json` on disk,
and a (slightly) smaller, less-churned `profile.json`.

## 6. Success criteria

- After upgrade, an existing profile's servers appear unchanged in the MCP UI and
  connect normally; `mcp.json` exists and contains the full installed server set;
  `profile.json` no longer carries the `mcp_servers` field.
- A fresh profile creates a valid empty `mcp.json`.
- Adding/updating/deleting a server rewrites **only** `mcp.json`; a chat/agent/
  settings change rewrites **only** `profile.json`.
- All existing MCP, profile-cache, sanitizer, and migration tests pass (updated
  where they previously asserted `mcp_servers` lived in `profile.json`), and new
  tests cover the split read/write and the seed migration. Per-file coverage gate
  (≥ 90% lines/functions/branches/statements) stays green on every touched file.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Two files can desync if the process crashes between two writes | Installed MCP servers and the profile are written by **independent owners** (`McpConfigManager` writes `mcp.json` on its own dirty-check; `ProfileCacheManager` writes `profile.json` on its own). The two slices have no cross-file referential integrity (agent bindings reference servers by name and already tolerate missing servers), so a partial write is recoverable on next load. |
| Older app versions (downgrade) read `profile.json` with no `mcp_servers` and show no installed global servers | Optional one-release **dual-write** transition window (also keep `mcp_servers` in `profile.json`) before fully dropping the field; **rejected** for this change (clean split). |
| Many existing tests assert `mcp_servers` inside `profile.json` | Update them as part of the change; add new split-storage tests. |
| Accidentally extracting `chat.agent.mcp_servers` (bindings) instead of the installed global servers | Explicit field-level guard in code + tests; called out in code review checklist. |

## 8. Rollout / phasing

- **Phase 1 (shipped base):** Storage split with the in-memory shape preserved
  (**Option A** — `mcp.json` written by a bundle writer inside `ProfileCacheManager`).
  No IPC/renderer change. Lowest-risk foundation for Phase 2.
- **Phase 2 (implemented — B-main variant, this change):** Promoted to a standalone
  `McpConfigManager` subsystem that owns `mcp.json` end-to-end in the main process
  (own cache, own per-alias write lock, own dirty-check + `updatedAt`) and decouples
  installed global servers from `ProfileV2` at runtime — `mcp_servers` is kept optional/deprecated
  and populated only during the transient load/migration window. The IPC wire contract
  and the renderer MCP cache are intentionally **unchanged**: the `profile:cacheUpdated`
  payload still carries `mcp_servers`, injected from the manager.
- **Phase 3 (future, optional):** A fully independent `mcp:updated` IPC channel +
  dedicated renderer cache (dropping the payload injection) and full removal of the
  deprecated `ProfileV2.mcp_servers` field. Tracked separately.
