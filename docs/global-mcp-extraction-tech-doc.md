# Installed Global MCP Servers Extraction (profile.json → mcp.json) — Tech Doc

<!-- Last verified: 2026-06-27 -->

> Implements [global-mcp-extraction-prd.md](./global-mcp-extraction-prd.md).
>
> Status: **Implemented (Option B — B-main variant).** A standalone
> `McpConfigManager` (`mcpConfigManager.ts`) owns installed global MCP servers end-to-end
> in the main process: it holds the per-alias installed server configs in memory (the runtime source
> of truth), is the **only** writer of `mcp.json` (serialized through
> `mcpFileStore.ts`), and keeps its **own** per-alias write lock, content dirty-check
> (`lastFingerprint`, excluding the volatile `updatedAt`) and independent `updatedAt`.
> `ProfileCacheManager` now writes **only** `profile.json` (also dirty-checked on
> everything except `updatedAt`) and no longer carries `mcp_servers` on the cached
> profile — the field is optional/deprecated and populated only transiently during
> the load/migration window. The renderer wire contract is **unchanged**: both the
> `profile:cacheUpdated` push and the `profile:getProfile` IPC read still carry
> `mcp_servers`, now injected from the manager. Covered by `__tests__/mcpConfigManager.test.ts`,
> `__tests__/mcpFileStore.test.ts`, and `__tests__/profileCacheManager.mcpFile.test.ts`.

## 1. Overview

We extract installed global MCP servers out of `profile.json` into a sibling `mcp.json`
**and give it a dedicated owner** — `McpConfigManager` — instead of routing it
through `ProfileCacheManager`. The manager is a main-process singleton that caches
the per-alias installed server configs, performs all CRUD, and is the only component that writes
`mcp.json`. `ProfileCacheManager` is now responsible solely for `profile.json`.

The renderer and the IPC wire contract are intentionally **unchanged**: the
`profile:cacheUpdated` payload is still assembled by `ProfileCacheManager` and still
includes `mcp_servers`, but that slice is now read from the manager
(`mcpConfigManager.getServers(alias)`) rather than from the cached profile. The
in-memory `ProfileV2.mcp_servers` field is optional/deprecated and is populated only
transiently during the load/migration window (so legacy migrations such as V1
`isDefaultProfile` and V4 `memex-*` cleanup keep working) before being handed to the
manager and stripped from the cached profile.

```
DISK                          MAIN PROCESS                         CONSUMERS
profile.json  ───────────────►  ProfileCacheManager  ── profile body ─┐
(no mcp_servers) ◄── writes ──     │       ▲                           ├─► profile:cacheUpdated
                                   │       │ getServers(alias)         │   → renderer (UNCHANGED)
mcp.json { version, updatedAt, ┌───┴─►  McpConfigManager ──────────────┘
          mcp_servers } ◄ writes┘       (cache + CRUD + dirty-check)  ──► agentChat / scheduler /
                                                                          facades read
                                                                          mcpConfigManager.getServers()
```

Chosen approach = **Option B (B-main variant)** — the lowest-risk Option B: full
main-process decoupling while keeping the renderer/IPC contract identical. It builds
on the merged **Option A** storage split (the bundle writer that previously lived in
`ProfileCacheManager`). A future **Phase 3** could add a dedicated `mcp:updated` IPC
+ renderer cache (dropping the payload injection) and fully delete
`ProfileV2.mcp_servers`.

All branchy logic lives in small, fully unit-tested units — `mcpFileStore.ts`
(serialize / fingerprint / read / write) and `mcpConfigManager.ts` (cache + load
handoff + CRUD) — so the large coverage-gated `profileCacheManager.ts` only keeps
thin wiring (load handoff, CRUD delegation, payload injection).

## 2. On-disk format

`{userData}/profiles/{alias}/mcp.json`:

```jsonc
{
  "version": "1.0",
  "mcp_servers": [ /* McpServerConfig[] — identical element shape to today */ ]
}
```

- Element shape is the existing `McpServerConfig` (`types/profile.ts`) — **no**
  field translation. This preserves `in_use`, legacy `source`/`remoteVersion`,
  `hidden`, `oauth`, `headers`, and `version` losslessly without assigning any
  remote behavior to compatibility metadata.
- `version` is a file-format version independent of `profileMigrationVersion`,
  reserved for future `mcp.json`-only format changes.

## 3. Storage layout (after change)

```
{userData}/profiles/{alias}/
├── profile.json            # ProfileCacheManager — everything EXCEPT mcp_servers
├── mcp.json                # NEW — installed global MCP servers (McpServerConfig[])
├── chat_sessions/…         # unchanged
└── skills/…                # unchanged
```

## 4. Load path

In `ProfileCacheManager.readProfileFromFile` / `handleProfile`, installed server configs are
resolved through `McpConfigManager` and only **transiently** attached to the profile
so the existing migration/sanitize pipeline still sees it:

1. Read `profile.json` (as today) → raw `ProfileV2`.
2. Capture the **legacy slice** `rawProfile.mcp_servers` (an array for a profile that
   predates `mcp.json`, otherwise `undefined`).
3. `mcpConfigManager.resolveFromDisk(alias, legacySlice)` reads `mcp.json` and seeds
   the manager's cache **without** writing:
   - present & valid → cache the file's servers, prime the fingerprint from disk;
   - absent → cache `legacySlice ?? []` and clear the fingerprint (forces a seeding
     write on the next commit/CRUD);
   - corrupt → back up to `mcp.json.corrupt-<ts>`, cache empty, clear the fingerprint
     (never a silent data loss).
4. Transiently re-attach the resolved installed server configs onto the raw profile
   (`rawProfile.mcp_servers = [...mcpConfigManager.getServers(alias)]`) **before**
   `ensureV2ProfileIntegrity` runs, so integrity/sanitize/migration (V1
   `isDefaultProfile`, V4 `memex-*` cleanup) all see the full object as before. Then
   **immediately** `mcpConfigManager.commitResolvedServers(alias, mcpConfigManager.getServers(alias))`
   to persist `mcp.json` **before** `ensureV2ProfileIntegrity` can write a stripped
   `profile.json` — otherwise an upgrade-time `mcp.json` write failure (after the
   `profile.json` strip succeeded) would lose installed server configs from both files. No-op in
   steady state (the fingerprint is primed from disk). If this early `mcp.json`
   write fails, profile loading returns the existing valid profile and leaves
   `profile.json` intact (with its legacy slice) instead of treating the profile as
   unreadable or backing it up as corrupt.
5. Before `ensureV2ProfileIntegrity` writes any bumped migration version back to
   `profile.json`, it commits the post-migration installed server configs (`profileCopy.mcp_servers`)
   to `mcp.json`. This is required for V4 MCP cleanup: if a hidden legacy memex
   server is removed from the transient profile but the sidecar write fails, the
   profile write is skipped so `profileMigrationVersion` stays old and the cleanup
   retries on the next launch. A later dirty-checked handoff remains as a no-op /
   defense-in-depth sync point.
6. **Strip** the transient field (`delete sanitizedProfile.mcp_servers`) so the cached
   profile no longer carries installed server configs — the manager is authoritative from here on.
7. Prime the `profile.json` dirty-check snapshot (`lastProfileFingerprint`) from the
   re-sanitized profile shape so a later pure-MCP change hashes equal and does not
   needlessly rewrite `profile.json`.

Two helper units back this path. First, the `mcp.json` read/serialize/write boundary:

```ts
// mcpFileStore.ts (new, small, 100% covered)
export const MCP_FILE_VERSION = '1.0';
export interface McpFile { version: string; updatedAt: string; mcp_servers: McpServerConfig[] }
export interface ReadMcpFileResult { file: McpFile | null; corrupt: boolean }

export function serializeMcpFile(servers: McpServerConfig[], updatedAt: string): string; // canonical JSON
export function fingerprintMcpServers(servers: McpServerConfig[]): string;  // dirty-check key, excludes updatedAt
export async function readMcpFile(filePath: string): Promise<ReadMcpFileResult>; // never throws; tolerates missing updatedAt
export async function writeMcpFile(                                        // atomic + retry
  filePath: string, servers: McpServerConfig[], updatedAt: string, options?: AtomicWriteOptions
): Promise<void>;
```

`readMcpFile` distinguishes **missing** (`{ file: null, corrupt: false }`) from
**unreadable/bad-JSON/invalid-shape** (`{ file: null, corrupt: true }`) so the
caller can back up a corrupt file instead of silently dropping data. Shape
validation is element-level: `mcp_servers` must be an array of non-null objects,
so a tampered/truncated file like `{ "mcp_servers": [null] }` is flagged corrupt
(backed up + empty installed server set) rather than cached and later thrown on in the
sanitizer. A missing or non-string `updatedAt` reads back as `''`
(forward/backward tolerant).

`mcp.json` carries its **own** `updatedAt`, independent of `profile.json`'s. The
write path embeds a fresh timestamp only when installed server content changed; the
dirty-check compares `fingerprintMcpServers` (which deliberately **excludes**
`updatedAt`) so a no-op never rewrites the file or moves its timestamp.

Second, the runtime owner — `McpConfigManager` (`mcpConfigManager.ts`), a singleton
exported as `mcpConfigManager`:

```ts
// mcpConfigManager.ts (new) — the ONLY writer of mcp.json
// synchronous reads (runtime source of truth):
getServers(alias): McpServerConfig[]                    // [] when not loaded
getServerInfo(alias, name): McpServerConfig | null
hasServersLoaded(alias): boolean

// load handoff (called by ProfileCacheManager during load):
resolveFromDisk(alias, legacySlice?): Promise<void>     // seed cache, no write
commitResolvedServers(alias, servers): Promise<void>    // dirty-checked persist

// CRUD (locked, dirty-checked persist, own updatedAt) → boolean:
addServer(alias, config)        // false on duplicate name
updateServer(alias, name, patch) / deleteServer(alias, name)
setServerInUse(alias, name, inUse)                      // all false when not found

clearCache(alias?)                                       // sign-out / test reset
```

- The cache (`Map<alias, McpServerConfig[]>`) is the runtime source of truth for installed global MCP servers. Every
  mutator runs under a **per-alias write lock** (`withWriteLock`) that is independent
  of the `profile.json` write lock, so the two files never deadlock each other.
- All persistence funnels through one private `persistServers` choke point:
  `sanitizeMcpServerList` → compare `fingerprintMcpServers` against the per-alias
  `lastFingerprint` → `writeMcpFile` (with a fresh `updatedAt` and retry logging)
  only when it changed → update cache + `lastFingerprint` **after** the write
  succeeds. A failed required write leaves the cache at the last durable installed-server state, so
  retrying a CRUD does not see an unsaved duplicate. A no-op CRUD therefore neither
  rewrites `mcp.json` nor bumps its timestamp.
- A corrupt `mcp.json` is backed up by the manager (`backupCorruptFile`), not by
  `ProfileCacheManager` — the backup responsibility moved with the ownership.

## 5. Write path

There are now **two independent writers**, each owning one file plus its own
dirty-check and `updatedAt` — there is no longer a single bundle writer.

### 5.1 `mcp.json` — owned by `McpConfigManager`

Every installed global MCP server change funnels through `persistServers` under the manager's per-alias
write lock:

```
persistServers(alias, servers):
  clean = sanitizeMcpServerList(servers)          // shared sanitizer (see §6)
  fp = fingerprintMcpServers(clean)               // excludes updatedAt
  if fp === lastFingerprint[alias]:
    cache[alias] = clean                          // equivalent to durable disk
    return                                        // no-op: no write, no timestamp bump
  writeMcpFile(mcpPath, clean, new Date().toISOString(), { onRetry: log })
  cache[alias] = clean                            // disk-first: only after success
  lastFingerprint[alias] = fp
```

Triggered by `commitResolvedServers` (load/seed) and by the CRUD mutators
(`addServer` / `updateServer` / `deleteServer` / `setServerInUse`). `writeMcpFile`
goes through `atomicFileWrite.ts:writeFileAtomicallyWithRetry` (temp-file + rename
with Windows `EPERM/EACCES/EBUSY` backoff).

### 5.2 `profile.json` — owned by `ProfileCacheManager`

`writeProfileToFile(alias, profile)` writes **only** `profile.json`; the only
sidecar interaction is a safety guard that retries a pending manager handoff before
stripping the legacy top-level `mcp_servers` slice. If that retry still fails, the
profile write is aborted so the legacy slice remains durable in `profile.json`.

```
writeProfileToFile(alias, profile):
  sanitized = sanitizeProfile(profile)
  if manager has loaded but not-yet-persisted installed server configs:
    commitResolvedServers(alias, sanitized.mcp_servers ?? manager.getServers(alias))
    if it fails: return false                      // preserve legacy slice on disk
  fp = fingerprintProfileForDirtyCheck(sanitized)    // excludes updatedAt
  if fp === lastProfileFingerprint[alias]: return     // no-op
  payload = { ...sanitized }; delete payload.mcp_servers; payload.updatedAt = now
  writeFileAtomicallyWithRetry(profilePath, JSON(payload))
  lastProfileFingerprint[alias] = fp
```

- `profile.json` is written **without** the top-level `mcp_servers` field; only the
  top-level installed server configs are removed, so nested `chat.agent(.agents[]).mcp_servers` bindings
  are preserved.
- A pure installed-MCP-server change rewrites only `mcp.json`; an unrelated profile edit
  rewrites only `profile.json` — each file (and its `updatedAt`) moves only when its
  own slice does (delivers PRD goal **G2**, both directions). The two files have no
  write-ordering dependency because they are written by different owners on different
  locks; the slices have no cross-file referential integrity, so any partial state is
  recoverable on the next load.

### 5.3 CRUD wiring

`ProfileCacheManager.addMcpServerConfig` / `updateMcpServerConfig` /
`deleteMcpServerConfig` are thin delegations:

```
ensureProfileLoadedForMcpCrud(alias)        // cache.has OR readProfileFromFile
  → mcpConfigManager.{add,update,delete}Server(...)
  → on success: notifyProfileDataManager(alias[, true])
```

There is **no** staged `ProfileV2` and **no** `writeProfileThenCommitCache` for MCP
writes anymore — the manager persists `mcp.json` directly, and the notification
re-injects installed server configs from the manager (§8). The three MCP CRUD helpers were removed
from `profileEntityCrud.ts`; `mcpClientManager` is unchanged.

## 6. Sanitizer / type changes

- `sanitizeMcpServerList(servers)` is extracted into `profileSanitizer.ts` as the
  single canonical MCP-list sanitizer, used by **both** `sanitizeProfileV2` (the
  transient load window) and `McpConfigManager.persistServers` (every `mcp.json`
  write) — DRY, with no sanitizer-test churn. It filters out null/non-object
  entries (rather than coercing them to junk empty-named servers), so it never
  throws on a malformed list from either a tampered `mcp.json` or a legacy
  `profile.json` slice — matching the agent-level `mcp_servers` sanitizer.
- `ProfileV2.mcp_servers` is now **optional and `@deprecated`** (`types/profile.ts`):
  populated only transiently during the load/migration window, never read at runtime.
  Runtime reads MUST go through `mcpConfigManager.getServers(alias)`. Full removal of
  the field is a future Phase 3.
- `isProfileV2` keys off `alias` + `chats` (not `mcp_servers`), so dropping the field
  from `profile.json` does **not** break the type guard.
- `DEFAULT_PROFILE_V2.mcp_servers` stays `[]` (in-memory default); a fresh profile
  seeds the manager from it (`commitResolvedServers`), which writes an empty
  `mcp.json`.

## 7. Migration

Version-gated via `PROFILE_MIGRATION_VERSION` (currently `4` → bump to `5`) in
`profileMigration.ts`, combined with an `mcp.json`-presence check:

```
applyProfileMigrations(profileCopy):    // runs on the merged in-memory profile
  if storedVersion < 5:
    // mcp.json was already seeded during the load step (§4.3) from
    // profileCopy.mcp_servers, so here we just guarantee the field is dropped
    // from the profile.json payload and bump the version.
    profileCopy.profileMigrationVersion = 5
```

Practical sequencing:

1. **Load** reads `profile.json`; `mcpConfigManager.resolveFromDisk(alias, legacySlice)`
   reads `mcp.json` — if missing it caches the legacy `profile.mcp_servers` slice for
   seeding; if present the file wins and any stale `profile.mcp_servers` is ignored.
2. **Migration V5** marks the profile migrated; V4/V5 operate on the
   transiently-attached slice (§4).
3. **`commitResolvedServers`** persists `mcp.json` (seeding it when it was absent);
   the next `profile.json` write drops the top-level `mcp_servers` field.

Notes:

- The existing **Migration V4** (legacy hidden `memex-*` server cleanup) operates on
  the transiently-attached `profileCopy.mcp_servers`; because the slice is re-attached
  before migrations run and then handed back via `commitResolvedServers`, V4 keeps
  working unchanged and its result is persisted to `mcp.json` by the manager.
- **Idempotent / crash-safe:** re-running load/migration with an existing `mcp.json`
  is a no-op; a half-finished migration simply re-seeds on next launch.

### Optional downgrade-safety window

If we must support running an **older** app build against migrated data, a one-release
transition could **dual-write** `mcp_servers` back into `profile.json` (the manager
exposes the slice via `getServers`, and `writeProfileToFile` would re-embed it). The
following release removes the copy. **Rejected here:** clean split, no dual-write.

## 8. IPC / renderer

No wire-contract change:

- The `profile:cacheUpdated` payload is assembled by `ProfileCacheManager` and still
  includes `mcp_servers`, but the slice is now **injected from the manager**
  (`mcp_servers: mcpConfigManager.getServers(alias)`) rather than read from the cached
  profile, so the renderer receives installed server configs exactly as before.
- The `profile:getProfile` IPC read (`startup/ipc/profile.ts`) **also re-injects**
  `mcp_servers` from the manager onto the (now stripped) cached profile, so the wire
  shape is consistent across both surfaces. This matters because the renderer's
  `getProfile` fallback (`profileDataManager.initialize`) applies the returned profile
  directly when the push was missed/raced; without the re-injection that fallback would
  forward an empty installed server set to `mcpClientCacheManager`.
- `profileDataManager.ts` still reads `data.profile.mcp_servers` and forwards to
  `mcpClientCacheManager.updateServerConfigs(...)` — untouched.
- IPC handlers `profile:addMcpServer` / `updateMcpServer` / `deleteMcpServer` route
  through `ProfileCacheManager`'s CRUD wrappers, which now delegate to the manager —
  the handler signatures are untouched.

## 9. Affected files

| File | Change |
|------|--------|
| `src/main/lib/userDataADO/mcpFileStore.ts` | Phase-1 base (unchanged here). `serializeMcpFile(servers, updatedAt)` / `fingerprintMcpServers` (dirty-check key, excludes `updatedAt`) / `readMcpFile` (never-throws, missing-vs-corrupt, tolerant `updatedAt`) / `writeMcpFile` (atomic + retry) + `MCP_FILE_VERSION`. |
| `src/main/lib/userDataADO/mcpConfigManager.ts` | **New.** The runtime owner of installed global MCP servers and the **only** writer of `mcp.json`: per-alias cache + write lock + `lastFingerprint` dirty-check + own `updatedAt`. `resolveFromDisk` / `commitResolvedServers` (load handoff), `getServers` / `getServerInfo` / `hasServersLoaded` / `hasPersistedServers` (sync reads), `addServer` / `updateServer` / `deleteServer` / `setServerInUse` (CRUD), `clearCache`, corrupt-file backup. Required writes are disk-first: cache/fingerprint update only after `writeMcpFile` succeeds. |
| `src/main/lib/userDataADO/profileMcpHandoff.ts` | Small helper module for the load/write handoff: logs non-fatal sidecar commit failures and owns the profile dirty-check fingerprint that excludes top-level `mcp_servers` and `updatedAt`. |
| `src/main/lib/userDataADO/profileCacheManager.ts` | Load delegates to `mcpConfigManager.resolveFromDisk` + `commitResolvedServers` (transient attach → early sidecar commit before any profile strip → post-migration commit → strip), primes only `lastProfileFingerprint`; sidecar write failures do not reset valid profiles, and later profile writes retry a pending handoff before stripping. `writeProfileToFile` writes **only** `profile.json`; MCP CRUD wrappers + `getMcpServerInfo` / `getAllMcpServerInfo` delegate to the manager; the `profile:cacheUpdated` payload injects `mcp_servers` from the manager. Obsolete bundle-writer, catalog-merge, fingerprint, backup, and path helpers were removed. |
| `src/main/lib/userDataADO/profileMigration.ts` | Unchanged here (`PROFILE_MIGRATION_VERSION` = 5 shipped in Phase 1). |
| `src/main/lib/userDataADO/profileSanitizer.ts` | Extracted `sanitizeMcpServerList(servers)` as the shared MCP-list sanitizer used by both `sanitizeProfileV2` and `McpConfigManager.persistServers`. |
| `src/main/lib/userDataADO/profileEntityCrud.ts` | **Removed** the three MCP CRUD helpers (`addMcpServerConfig` / `updateMcpServerConfig` / `deleteMcpServerConfig`); they now live in `McpConfigManager`. |
| `src/main/lib/userDataADO/types/profile.ts` | `ProfileV2.mcp_servers` is now **optional + `@deprecated`** — a transient load-window field; runtime reads go through `mcpConfigManager.getServers`. |
| Consumers | Repointed from `ProfileCacheManager` to `mcpConfigManager.getServers(alias)`. Removed catalog and plugin consumers no longer apply. |
| `__tests__/mcpConfigManager.test.ts`, `…/profileCacheManager.mcpFile.test.ts` | **New / rewritten.** Manager unit tests + the decoupling integration test (real manager singleton). Consumer + cacheManager-core suites updated to mock `../mcpConfigManager`. |
| `src/main/lib/userDataADO/ai.prompt.md` | Updated storage-layout diagram, Key Files (add `mcpConfigManager.ts`), "Changing Installed Global MCP Server Storage", and Gotchas for the manager-owned model. |
| `src/main/lib/mcpRuntime/ai.prompt.md` | Note installed global MCP servers are owned by `McpConfigManager` (`mcp.json`) and read via `mcpConfigManager.getServers`, still surfaced through `profile:cacheUpdated`. |

`mcpClientManager.ts`, the IPC `profile.ts` handlers, and all renderer MCP code are
**unchanged**.

## 10. Test plan

- **Unit (`mcpFileStore`)**: read missing/empty/valid/corrupt `mcp.json`; atomic
  write + retry; round-trip preserves `oauth`/`headers`/`source`/`in_use`.
- **Unit (`mcpConfigManager`)**: sync reads + defaults; `resolveFromDisk`
  present / absent-with-slice / absent-no-slice / corrupt (+ backup-fails);
  `commitResolvedServers` seed / no-op / changed / sanitize; each CRUD mutator
  success + duplicate + not-found; `clearCache` one/all/refresh; `onRetry` logging;
  concurrent-write lock serialization.
- **ProfileCacheManager (integration, real manager)**: fresh profile → empty
  `mcp.json`, `profile.json` without `mcp_servers`; legacy profile (servers in
  `profile.json`, no `mcp.json`) → seeded `mcp.json`, stripped `profile.json`,
  identical installed server configs via `mcpConfigManager.getServers`; dirty-check (MCP-only change
  rewrites only `mcp.json`; chat-only change rewrites only `profile.json`); corrupt
  `mcp.json` → backup + empty installed server set; `profile:cacheUpdated` payload carries the
  manager's installed server configs.
- **Migration**: V5 idempotency; V4 memex cleanup still runs and persists to
  `mcp.json`; re-run no-op.
- **Regression**: consumers read installed server configs via the manager; full MCP
  add/update/delete/connect flow via existing `mcpClientManager` tests.
- **Coverage**: ≥ 90% lines/functions/branches/statements on every touched file
  (cover both arms of each dirty-check / presence / corrupt branch).

## 11. Resolved decisions

1. **Refactor depth** — shipped **Option A** as the storage-split base, then
   **Option B (B-main)** here: full main-process decoupling with the renderer/IPC
   contract unchanged. A further Phase 3 (dedicated `mcp:updated` IPC + renderer cache,
   full removal of `ProfileV2.mcp_servers`) remains optional.
2. **Downgrade window** — **dropped** (clean split, no dual-write).
3. **File format** — **kept** `McpServerConfig[]` (VS Code `mcp.json` schema rejected
   due to lossy fields).
