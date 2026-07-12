# Agent / Chat Data Separation Tech Doc

## 1. Scope

Implements the PRD `agent-chat-data-separation-prd.md`. Covers the data model,
migration, store, on-disk strip/hydrate facade, accessor SSOT, scheduler rename,
chat-owned runtime workspace ownership, and physical knowledge relocation.
Renderer component decouple has landed (see §10).

## 2. Types (`types/profile.ts`)

- `ChatConfig` gains `agent_ids?: string[]` (target mapping, length ≥ 1).
  `ChatConfig.workspace?: string` is a **runtime-only** chat-owned working
  directory derived from `{userData}/profiles/{alias}/chat_workspaces/{chat_id}`.
  It is injected into cache / IPC payloads for compatibility, but is stripped
  from `profile.json` before write. Runtime deliverables, hook cwd, built-in tool
  workspace roots, and chat-session files follow this derived path.
  Inline `agent`/`agents` remain **optional** on the type but are no longer a
  live read facade: the cache, the `getChatConfig`/`getAllChatConfigs` read path,
  and both renderer wire pushes are `agent_ids`-only. Inline agents survive only
  transiently during load/migration (before `stripInlineChatAgentsForDisk`) and
  in hand-built inputs; consumers read agents via `agentAccessor`. See §10 and
  [sidecar-renderer-normalization-tech-doc.md](./sidecar-renderer-normalization-tech-doc.md).
- `AgentConfig extends ChatAgent { id }` — standalone agent, persisted as
  `agents/{id}/agent.json`. For **new** agents `id = buildAgentUuid()` =
  `agent_{timestamp}_{random}` (`@shared/utils/idFormats`) — a stable,
  name-independent id minted once at creation so a rename never changes it.
  **Legacy** migrated agents keep their name-derived `agent-{name}-{source}` id
  (`buildAgentId`, now `@deprecated`). `ChatAgent.id?` carries the id on the inline
  facade; all store/migration code derives an id via `agentIdOf(agent)` (carried
  `id`, else the legacy fallback), never by re-deriving from the name.
  `AgentConfig` must not persist `workspace`; any legacy `ChatAgent.workspace`
  is migration-only compatibility input and is stripped before `agent.json` is
  written.
- Index item `{ id, name }` for the single `index.json` listing all agents
  (archive is a chat concept; agents have no per-agent archived state).
- `ProfileV2.archived_chats?: ArchivedChatEntry[]` — the archive list SSOT
  (`{ chat_id, agent_ids, chat_type, archived_at?, starred_sessions? }`,
  `agent_ids`-only, no inline agent, no workspace).

## 3. Agent store (`agentStoreManager.ts`)

Path helpers (`getAgentsRootDir/getAgentDir/getAgentConfigPath/
getAgentKnowledgeDir/getAgentIndexPath`) and CRUD: `readAgent/writeAgent/
deleteAgent/listAgents/readIndex/writeIndex`, plus the one-time best-effort
`consolidateLegacyAgentIndexes`. A single `index.json` lists all agents
(`listAgents` reads it directly). `consolidateLegacyAgentIndexes` merges any
legacy `index_active.json` + `index_archived.json` back into `index.json` and
deletes the split files (best-effort: never throws, so a write hiccup never
breaks a profile load). Archive is a *chat* concept: archived chat
metadata (chat_id, chat_type, agent_ids, starred) lives in `profile.json`
`archived_chats[]` (the SSOT) with agents resolved by id; the standalone
`agents/archived_chats.json` and legacy `archive/archived_agents.json` are read
only as one-time migration sources. The agent itself stays in `index.json`
whether or not its chat is archived.

## 4. Migration V6 (`profileMigration.ts`; `PROFILE_MIGRATION_VERSION=6`, single bump from main's 5)

This whole PR is unreleased (main is at V5), so **every** profile-shape change it
introduces lives under one gate (`storedMigrationVersion < 6`) — there is no
intermediate released state to stay compatible with, and splitting into two
versions would let a dev profile stamped at v6 by an earlier branch build skip half
the work. Two sub-steps run under the single gate:

- **(a) Agent/chat separation.** For each chat, mint a stable UUID on every inline
  agent lacking one (`ensureInlineAgentIds`) then derive `agent_ids` from inline
  agent(s) via `agentIdOf` (carried id, else legacy name-derived fallback; skips
  already-populated, skips nameless). Inline kept so the transform is reversible and
  read-compatible. Destructive disk extraction is a follow-up.
- **(b) `primaryAgent` → `primaryChat`** (see §9). Resolved in the same gate, while
  inline agents are still present, so the owning chat is found by its primary
  agent's name.
- **(c) Workspace ownership.** Use legacy inline `chat.agent.workspace` /
  `chat.agents[].workspace` as migration input, consolidate the physical
  workspace directory to `chat_workspaces/{chat_id}`, then stop persisting
  `workspace` on both chats and agents. Because V6 is unreleased on this branch,
  this lands inside the same `< 6` gate rather than introducing V7.

Version-gated, idempotent.

## 5. Store bridge (`agentExtraction.ts`)

- `hydrateChatsFromStore` — on load, re-attach inline agents from
  `agents/{id}/agent.json` so the facade is whole in cache.
- `stripInlineChatAgentsForDisk` — on write, return a profile with inline
  `agent`/`agents` removed (chat_id + agent_ids only) once the store holds every
  id; otherwise keep inline (no data loss).
- `ensureChatAgentIds` — heals chats missing `agent_ids` (the strip precondition)
  regardless of migration version. `consolidateWorkspaceDirsToChatId` — renames a
  chat's OWN legacy `chat_workspaces/{agentId}` dirs to `{chat_id}`. The owned dirs
  come from `legacyWorkspaceDirNames` = the chat's derived agent ids, its
  chat-owned `workspace`, and legacy agent `workspace` fields during migration; a
  `knowledgeBase` is **never** consulted for dir
  ownership (it is a reference that can point at a *different* agent's dir, so using
  it would fold one agent's data into another, reproducing the historical cross-agent corruption).
- `migrateKnowledgeToAgentStore` — on load, idempotently move per-agent knowledge
  from `chat_workspaces/{agentId|chat_id}/knowledge` to `agents/{agentId}/knowledge`
  (skips already-moved/missing, removes empty legacy knowledge dirs, swallows IO
  errors, retries next load), then repoints BOTH the inline and store `agent.json`
  `knowledgeBase` ONLY when it points at the chat's OWN legacy dir (a derived id,
  the chat_id, or the agent's workspace dir). A cross-agent `knowledgeBase` and
  external custom paths are left untouched here.
- `migrateWorkspaceToChat` / `consolidateWorkspaceDirsToChatId` /
  `stripStoredAgentWorkspaces` — use legacy inline `agent.workspace` and
  `chat.workspace` values only as migration signals, canonicalize any
  profile-owned workspace under `chat_workspaces/*` to
  `chat_workspaces/{chat_id}`, and rewrite any intermediate `agents/{id}/agent.json`
  files that accidentally persisted `workspace`. External legacy workspace paths
  are not deleted or adopted; after write, runtime uses the fixed derived
  `{profile}/chat_workspaces/{chat_id}` path. The store write choke point
  (`writeAgent`) and the profile write path both strip `workspace`, so new writes
  cannot reintroduce it.
- `repointCrossAgentKnowledge` — FINAL pass, after active AND archived knowledge has
  relocated. A `knowledgeBase` still pointing inside `chat_workspaces` is a
  cross-agent reference (e.g. an active agent sharing an archived agent's docs); it
  is repointed to FOLLOW that knowledge to its new `agents/{ownerId}/knowledge` home
  **only when the knowledge actually migrated** (the store dir now exists with
  content). Not-migrated refs and external paths stay as-is. Updates inline agents on
  active chats and the stored `agent.json` SSOT (active + archived, membership
  preserved). Resolves a ref's legacy dir name to the owner's store id via a map of
  BOTH `chat_id`→id AND `buildAgentId(name, source)` (legacy `agent-{name}-{source}`
  dir name)→store id, built from `listAgents()`; the name-derived mapping is required
  now that store ids are UUIDs and no longer equal the legacy per-agent dir name.
- `runAgentStoreMigrations` — orchestrates the load-time sequence: consolidate
  legacy indexes → extract → hydrate → migrate inline workspaces to chats → heal
  ids → consolidate dirs → relocate knowledge → migrate archived → follow
  cross-agent knowledge refs → strip stored agent workspaces → refresh registry.
  Its return value includes the cross-agent repoint pass, so a load whose only
  mutation is a followed knowledge reference still triggers the profile save.
- `persistNewChatAgents` — **create path** (`addChatConfig`). First mints a stable
  name-independent id (`ensureInlineAgentIds`→`buildAgentUuid`) on each inline agent
  that lacks one, then writes the NEW chat's inline agent(s) into `agents/{id}/` and
  stamps `agent_ids` at creation time, so a new agent is store-backed immediately
  (the next `writeProfileToFile` strips its inline copy) rather than waiting for a
  load-time migration. Create-safe: it NEVER prunes/deletes, so a chat referencing an
  existing shared agent by id only keeps it. `addChatConfig` also derives the
  runtime chat workspace by `chat_id` (`getDefaultWorkspacePath`, not persisted)
  and the agent knowledge by store id (`getAgentKnowledgePath` =
  `agents/{id}/knowledge`).
- `syncChatAgentsToStore` — write-through on edit. Because the agent's id is carried
  (not re-derived from the name), a **rename keeps the same id**: `agent_ids` is
  unchanged and nothing is pruned — only `agent.json` content is rewritten. A stale
  store entry is deleted only on a **genuine agent swap** where the id actually
  changes. A legacy inline agent lacking an id is first anchored to the chat's
  existing `agent_ids` by position so its stable id is preserved across the edit.
  There is no eager `removeChatAgentsFromStore` on ordinary edits; the chat-delete
  path now removes unshared agents only after the profile deletion is durable (see
  §8). Shared agents remain protected by `collectAgentIdsReferencedByOtherChats`.
- Archive/unarchive never touch the agent index — the agent stays in the single
  `index.json`; only `profile.archived_chats` changes (the removed
  `mirrorArchivedAgentToStore`/`setAgentArchived`/`isAgentArchived` no longer
  exist). Archive refuses to remove the last active chat, treats `chats[0]` as
  the implicit primary when `primaryChat` is unset/invalid, and refuses to create
  an archived entry with no agent ids; unarchive refuses to restore an
  agent-less archived entry or one whose agent ids no longer resolve in
  `agents/{id}/agent.json`, unless it is only dropping a stale archive record for
  a chat that already exists in `profile.chats`.
- Sync import of external knowledge bases is agent-owned: the renderer carries
  both `chatId` and `agentId`, and `sync:copyKnowledgeBasesToProfile` resolves
  that exact `<chat, agent>` binding before copying into `agents/{id}/knowledge`.
  Primary agents update through `updateChatAgent`; secondary agents update through
  the plural, store-aware `updateChatConfig({ agent, agents })` path.
- `migrateArchivedAgentsToStore(profileDir, profile)` — on load, migrate legacy
  archived agents into the store: **mint a stable UUID** (`ensureInlineAgentIds`→
  `buildAgentUuid`) on each archived inline agent lacking an id — exactly like
  active agents — so archived and active share ONE id scheme (never the deprecated
  name-derived id); then persist each into the single `index.json` (one
  `agents/{id}/` dir), consolidate its workspace dir to `{chat_id}` and relocate
  knowledge (reusing the active-chat helpers via synthetic chats), then move the
  archive list onto `profile.archived_chats` (the SSOT). **Two-phase** so a failed
  save loses no metadata: Phase 1 (profile has no `archived_chats`) imports from
  the transitional `agents/archived_chats.json` or legacy
  `archive/archived_agents.json`, KEEPING the source as a safety net; Phase 2
  (profile already owns `archived_chats`) retires those transitional files plus
  the now-empty `archive/` dir. Any legacy split indexes are merged into the
  single `index.json` by `consolidateLegacyAgentIndexes` (run first) and deleted.

Mirrors the mcp/skills/hooks SSOT pattern: strip-on-write, re-attach-on-read,
cache keeps a facade. Fingerprint dirty-check runs on the stripped disk copy, so
no rewrite loop (fp-strip not needed).

## 6a. Startup profile backup + write-safety guard

Before any profile-shape code touches an existing profile directory,
`ProfileCacheManager.readProfileFromFile(alias)` calls
`backupProfileDirectoryBeforeMutation(profileDir, alias)`. The backup is
filesystem-level rather than schema-level so it works for V4 and earlier profiles
as well as unreleased V5/V6 development profiles. It copies profile metadata into
`{profileDir}/.profile_backups/{timestamp}/` through a temp directory
(`.tmp-{timestamp}-{pid}`) that is atomically renamed after the manifest is
written. Each process backs up one `{alias, profileDir}` pair only once, and each
startup cleanup removes backup directories older than 24 hours (plus stale tmp
dirs older than 1 hour).

The backup is intentionally lightweight. It preserves `profile.json`,
`agents/index.json`, `agents/{id}/agent.json`, legacy archive metadata, and safe
small sidecar JSON files, while excluding heavy directories by basename:
`.profile_backups`, `knowledge`, `chat_sessions`, `chat-sessions`,
`chat_workspaces`, `chat-workspaces`, `skills`, `memory`, `memex_memory`,
`memex-memory`, `profile_memory`, and `profile-memory` (case-insensitive). It
also excludes sensitive profile-scoped credential storage: `credentials/`,
`auth.json`, `browserAuthTokenCache.json`, `browserAuthTokenCache.enc`, and
legacy browser session token-cache filenames. Every copied `.json` file is also
parsed and rewritten with credential-bearing fields redacted (`authToken`, token
or secret fields, `env` values, and `headers` values) before it enters the
backup. This covers legacy inline agents in `profile.json`, standalone
`agents/{id}/agent.json`, and `mcp.json` without dropping the relationship
metadata needed for recovery. If `profile.json` itself cannot be parsed, the
startup backup preserves the original bytes so a later default-profile recovery
does not destroy the only manually recoverable copy. Other JSON metadata files
that cannot be parsed still get a small placeholder with the original bytes
omitted rather than duplicating possible secrets. The corrupt-profile fallback
that writes `profile.json.corrupt-{timestamp}` also raw-copies the unreadable
`profile.json` immediately before default-profile recovery overwrites it. This means
`agents/{id}/knowledge` is skipped but the agent metadata that is required to
recover chat-agent relationships is retained without duplicating live auth
material. A failed cleanup is warning-only; a failed startup backup is
fail-closed: `ProfileCacheManager` records the alias and `writeProfileToFile`
refuses to write for that alias; `handleProfile` also refuses corrupt-profile
default recovery for that alias, preventing a backup failure from being followed
by agent-store seeding or destructive migration/sanitization writes.

`writeProfileToFile` also enforces an active-chat relationship invariant after
sanitization and before `stripInlineChatAgentsForDisk`: every active chat must
carry at least one of a non-empty `agent_ids`, inline `agent`, or non-empty inline
`agents`. A chat reduced to only `{ chat_id, chat_type }` is refused rather than
persisted. `sanitizeProfileV2` preserves existing `agent_ids` and derives missing
ids from inline agents before the strip gate, so normalization cannot silently
turn a valid `agent_ids`-only chat into an unbound chat.

## 6. Accessor SSOT (`agentAccessor.ts`)

`agentIdOf/getChatAgents/getChatPrimaryAgent/getChatAgentIds/chatHasAgentId/
findChatByPrimaryChat`. `agentIdOf(agent)` is the single "inline agent → id"
derivation (carried `id`, else legacy name-derived fallback) used across the
store/migration paths so a rename can never change an agent's id. The rest return
inline-hydrated values with `agent_ids` identity. `findChatByPrimaryChat(chats,
primaryChat)` is a plain `chat.chat_id === primaryChat` lookup (the primary is now
a stable `chat_id`, not an agent name). Backend consumers (eval, archive
guard) read through it, all falling back to the first chat when unmatched.

## 7. Scheduler

`agentId` → `chat_id` across scheduler types/store/IPC/runner/cleanup.

## 8. Chat delete & `manage_agents` tool surface

- `deleteChatConfig` (`profileChatCrud.ts`) removes the chat→agent mapping from
  `profile.json`; only after that profile write is durable does it clean the
  chat-owned resource graph: chat session files, chat workspace, schedule jobs,
  SubAgentTaskStore records, memex memory, and every `agents/{id}`
  directory that is no longer referenced by another active or archived chat. Shared
  agents are protected by `collectAgentIdsReferencedByOtherChats`, so deleting one
  chat never breaks another chat that still points at the same agent.
- The `manage_agents` built-in tool (`manageAgentsFacade.ts`) exposes only
  non-destructive actions: `create`, `update`, `list`, `set_primary`, `status`. The
  `remove` action remains absent; chat deletion is now an explicit UI/profile CRUD
  operation that removes chat-owned resources and unshared agents. `create` mirrors the store-first
  `addChatConfig` path (new `agents/{id}/` + `agent_ids` mapping); `update` rewrites
  only `agents/{id}/agent.json`. Agent tools do not expose or accept `workspace`;
  chat workspace is derived from `chat_id`. List/status/set-primary/update resolve
  all agents in a chat (`getChatAgents`), not only the primary agent, so secondary
  agents in `1 chat : N agents` remain visible and updateable.

## 9. Profile primary: `primaryChat` (Migration V6 (b))

`ProfileV2.primaryAgent` (an agent *name*) was renamed to `primaryChat` (the primary
chat's stable `chat_id`). The name-based field broke when the agent was renamed and
could not disambiguate two chats sharing an agent name. Wiring:

- `profileSettingsCrud.updatePrimaryChat(ctx, alias, chatId)` validates the chat
  exists and early-exits if already primary; surfaced as
  `profileCacheManager.updatePrimaryChat`, the `profile:setPrimaryChat` IPC channel,
  and `preload.profile.setPrimaryChat`.
- `findChatByPrimaryChat` = `chat_id === primaryChat`. Empty/unset `primaryChat`
  means "no explicit primary" → runtime + renderer fall back to `chats[0]`.
- `set_primary_agent` tool keeps its external `agent_name` input and
  `primaryAgent`/`previousPrimaryAgent` result fields (user-facing agent names) but
  internally resolves the name to its owning chat's `chat_id` via
  `getAllChatConfigs` + `getChatAgents` (accessor-resolved from the store, no
  inline hydration), then calls `updatePrimaryChat`. A secondary agent name maps to
  the chat that owns it; the persisted primary concept is still the chat.
- **Migration V6 (b)** (`PROFILE_MIGRATION_VERSION = 6`): resolves the legacy
  `primaryAgent` name to its owning `chat_id`, writes `primaryChat`, deletes
  `primaryAgent` (unmatched name → `primaryChat` unset). This runs in the same
  `< 6` gate as the agent_ids derivation — see §4. `sanitizeProfileV2` whitelists
  only `primaryChat`, so a lingering `primaryAgent` is dropped on write.

## 10. Renderer normalization (landed — sidecar-renderer-normalization)

The inline-facade decouple designed in
[sidecar-renderer-normalization-tech-doc.md](./sidecar-renderer-normalization-tech-doc.md)
is now **complete** (Phases 1–5): the renderer resolves agents/skills/hooks from
granular store-backed client caches (mirroring `mcpClientCacheManager`) fed by
`agents:changed`/`skills:changed`/`hooks:changed` push events, and the
`performNotification` recompose glue is gone. As a result:

- `performNotification` pushes `agent_ids`-only chats (strips inline
  `agent`/`agents`); only `mcp_servers`/`skills`/`hooks` are re-attached as their
  own sidecar slices.
- The main read path (`getChatConfig`/`getAllChatConfigs`) returns `agent_ids`-only
  chats; the temporary `hydrateChatAgents` read-path hydration was removed and main
  consumers read via `agentAccessor` (`getChatPrimaryAgent`/`getChatAgents`).
- The write-side `resolveExistingPrimaryAgent` guard in `updateChatAgent` is
  retained (it hydrates the *existing* agent before an in-place merge — a different
  concern from read hydration).
- Dead code left in place: the unreferenced renderer `getChatInfoList`/`getChatList`
  (chatOps.ts) still reads inline `.agent` but has no callers.

## 11. Tests

Per-file >=90% coverage gate enforced. Suites: profileBackupManager (startup
metadata backup, exclusions, retention), agentStoreManager (incl.
consolidateLegacyAgentIndexes), agentExtraction
(extract/hydrate/sync/ensure-ids/strip/consolidate/migrate-knowledge/migrate-archived/
run-migrations), agentAccessor (incl. `agentIdOf`), idFormats (`buildAgentUuid`),
profileChatCrud (create mints UUID, delete removes chat-owned resources and skips shared agents), profileArchiveManager
(archive + unarchive, profile-list only — agent index untouched), manageAgentsFacade
(no `remove` action), agentChatSeparation.e2e (disk round-trip), scheduler chat_id.
