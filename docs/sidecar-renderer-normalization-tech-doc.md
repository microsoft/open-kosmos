# Sidecar Renderer Normalization Tech Doc

Companion to [agent-chat-data-separation-tech-doc.md](./agent-chat-data-separation-tech-doc.md).
That doc separated the **persistence** layer (profile.json holds `chat_id` +
`agent_ids`; agents live in `agents/{id}/agent.json`; mcp/skills/hooks live in
their own sidecar files). This doc addresses the **runtime + IPC + renderer**
layer, which still re-composes the old monolithic `ProfileV2` shape at the IPC
boundary. It defines the target normalized design and a phased migration for
**all three per-entity sidecars: agents, skills, hooks** (MCP already has a
normalized renderer cache — `mcpClientCacheManager` — and is the precedent).

> **Status (2026-07-01): landed.** All five phases below shipped. The renderer
> now resolves agents/skills/hooks from store-backed client caches fed by granular
> `agents:changed`/`skills:changed`/`hooks:changed` events; `performNotification`
> pushes `agent_ids`-only chats and no longer recomposes the agent facade; the
> main read path (`getChatConfig`/`getAllChatConfigs`) and the `hydrateChatAgents`
> read facade were removed. The "as-is" sections below are retained as the design
> rationale / historical baseline.

## 1. Motivation

### 1.1 The recompose glue (as-is)

Persistence is normalized, but `ProfileCacheManager` re-assembles the legacy
monolithic profile on every notification and pushes the whole blob to the
renderer:

- **Load** (`readProfileFromFile`): strips `mcp_servers` → `mcpConfigManager`,
  `skills` → `skillsConfigManager`, `hooks` → `hooksConfigManager`, and inline
  agents → the agent store (keeping only `agent_ids` on each chat). The cached
  profile holds ids only.
- **Notify** (`performNotification`): recomposes `ProfileV2` — re-injects
  `chat.agent` / `chat.agents` from the agent registry by `agent_ids`,
  `mcp_servers` from `mcpConfigManager.getServers()`, `skills` from
  `skillsConfigManager.getSkills()`, `hooks` from `hooksConfigManager.getHooks()`,
  plus per-chat `chatSessions` — and sends the whole object over
  `profile:cacheUpdated`.
- **Consume** (renderer `profileDataManager`): stores `profile.chats` (with the
  inline `chat.agent` facade) verbatim; ~33 renderer files read `chat.agent` /
  `chat.agents` directly.

```
disk (normalized)                main memory                       IPC push            renderer
profile.json  ── strip ──▶  ProfileCacheManager (ids only)  ┐
agents/{id}   ── load  ──▶  agentStoreManager.registry      │
mcp.json      ── load  ──▶  mcpConfigManager.cache          ├─ performNotification
skills.json   ── load  ──▶  skillsConfigManager.cache       │  RE-COMPOSE ProfileV2 ──▶ profile:cacheUpdated ──▶ profileDataManager
hooks.json    ── load  ──▶  hooksConfigManager.cache        ┘  (inject agent/mcp/                              (whole blob, inline facade)
                                                               skills/hooks)
```

### 1.2 Why this is debt

1. **Hot-cache consistency burden.** The recompose reads hot caches; any sidecar
   write that is not write-through serves a stale value. This caused the
   2026-07-01 agent-editor "saved but still shows unsaved" bug (the agent
   registry was populated only at load; `writeAgent` did not refresh it, so
   `performNotification` re-injected a stale `chat.agent`). Fixed by making the
   registry write-through — but the whole class of bug exists only because a
   composition layer reads mutable caches.
2. **Two-sided hydration asymmetry.** Reads (`getChatConfig`) hydrate the inline
   facade; writes (`updateChatAgent`) need `resolveExistingPrimaryAgent`'s
   multi-tier fallback to merge correctly. Two independent hydration paths for
   one datum; both have produced data-loss regressions historically.
3. **Coarse-grained push.** Changing one field of one agent recomputes the whole
   profile (loads every chat's `chatSessions`, re-injects every sidecar) and
   pushes the entire blob, debounced. There is no per-entity delta.
4. **Optimistic/echo conflict.** The editor optimistically sets local state on
   save; the subsequent whole-profile push carries the authoritative (possibly
   stale) `chat.agent` and clobbers it, re-dirtying a just-saved form.

### 1.3 Non-goals

- No change to the **persistence** model (already normalized; do not touch disk
  schema or migrations).
- No change to `chatSessions` loading (already lazy, per-chat; stays as is).
- No new state-management library. The existing singleton-cache + `subscribe` +
  hook pattern (`mcpClientCacheManager`) is the target; consistency beats novelty.
- MCP **config** normalization is out of scope here (MCP already has a renderer
  cache for runtime status; its config still rides the profile blob and can be
  normalized later using the same pattern).

## 2. Target architecture

Each per-entity sidecar owns a normalized renderer cache fed by a granular IPC
event, mirroring `mcpClientCacheManager`. The renderer keeps entities in a
`Map<id, T>` and selects them by id; it no longer receives a synthesized
monolithic profile for these slices.

```
main store (write-through)        granular event         renderer cache (normalized)      component
agentStoreManager ── writeAgent ─▶ agents:changed  ──▶ agentClientCacheManager (Map<id>) ─▶ useAgent(id)
skillsConfigManager ─ setSkills ─▶ skills:changed  ──▶ skillClientCacheManager           ─▶ useSkills()
hooksConfigManager ── setHooks  ─▶ hooks:changed   ──▶ hookClientCacheManager            ─▶ useHooks()
```

### 2.1 Four design principles

1. **Normalized client state.** `chats` hold `agent_ids` only. A separate
   `agentsById: Map<id, AgentConfig>` holds agents. Renderer memory shape = disk
   shape; zero synthesis, zero inline facade.
2. **Per-entity event + per-entity renderer cache.** Reuse the
   `mcpClientCacheManager` shape (singleton, `cache`, `subscribe()`,
   `initialize()` pull, `setupIPCListeners()` push). Add `agentClientCacheManager`
   (a bespoke per-id map, since consumers resolve agents by id), plus
   `skillClientCacheManager` and `hookClientCacheManager`. The latter two share
   identical "full-list replace" semantics, so they are thin instantiations of a
   generic `SidecarListCacheManager<T>` (`src/renderer/lib/sidecar/`) with a
   matching `useSidecarList<T>` hook — one tested implementation instead of two
   near-identical copies. `profileDataManager` stops carrying these slices.
3. **Write-through is an invariant.** Each main store owns disk + hot cache +
   change event behind one API (`read` / `write` / `subscribe`); it is always
   self-consistent and emits its granular event after every mutation. The agent
   registry write-through fix (Phase 0/1) is a special case of this rule.
4. **Editor dirty-state = draft vs baseline.** One `draft`; `baseline` = the
   store entity; `isDirty = !deepEqual(draft, baseline)`. Save → `updateAgent`
   → optimistic store update → `baseline = draft`; the authoritative echo (now
   write-through + id-keyed) matches the draft, so it is a no-op and cannot
   re-dirty. Remove the frozen `initial*` snapshots and the `tabResetKey`
   remount hack.

### 2.2 Per-sidecar event contracts

Event payloads are **sidecar snapshots keyed by alias**, not whole-profile
snapshots.

| Sidecar | Store (main)           | Event            | Payload                                            | Renderer cache             | Hook           |
|---------|------------------------|------------------|----------------------------------------------------|----------------------------|----------------|
| Agents  | `agentStoreManager`    | `agents:changed` | `{ alias, agents: AgentConfig[] }` (full list)     | `agentClientCacheManager`  | `useAgent(id)` / `useAgents(ids)` |
| Skills  | `skillsConfigManager`  | `skills:changed` | `{ alias, skills: SkillConfig[] }` (full list; small) | `skillClientCacheManager`  | `useSkills()`  |
| Hooks   | `hooksConfigManager`   | `hooks:changed`  | `{ alias, hooks: HookDefinition[] }` (full list; small) | `hookClientCacheManager`   | `useHooks()`   |

Rationale for full lists: the profile push already computes the authoritative
agent registry snapshot (`getRegisteredAgents(alias)`) so emitting the same list
keeps the renderer cache atomic with `profile:cacheUpdated` and avoids delta
ordering edge cases. Skills and hooks are small global lists edited as a set, so
shipping the **full list** is simpler and cheaper than diffing; the renderer
replaces its cache wholesale. All three still expose the same `Map`/`subscribe`
renderer surface.

### 2.3 Renderer cache manager shape (all three)

Mirror `mcpClientCacheManager`:

```ts
class AgentClientCacheManager {
  private static instance
  private cache: { agentsById: Map<string, AgentConfig>; isInitialized: boolean }
  private listeners: Listener[] = []
  static getInstance()
  getCache()                                  // read-only snapshot
  getAgent(id): AgentConfig | undefined
  getAgents(ids: string[]): AgentConfig[]
  subscribe(listener): () => void             // returns unsubscribe
  async initialize()                          // IPC pull of the current set
  private setupIPCListeners()                 // agents:changed → replace list → notify
}
```

`skillClientCacheManager` / `hookClientCacheManager` are identical except the
cache holds a list and `changed` replaces it wholesale.

**Sign-out / profile-switch lifecycle (all three).** These caches are singletons
that outlive any single signed-in user, so they must drop the previous user's
data at account boundaries or the next user can transiently read it. Mirror
`mcpClientCacheManager.cleanup()`: reset the cached data and notify subscribers
with an empty snapshot, but **preserve** the IPC push listener and React
subscribers (the listener self-wires only once in the constructor, so tearing it
down would permanently stop `*:changed` updates for the next signed-in user).
`AuthProvider` invokes `cleanup()` on both sign-out paths (the `signOut()`
callback and the `auth:signOut` window event), alongside the profile/session/MCP
caches. As defense-in-depth for a profile switch that does not emit a sign-out,
`initialize(alias)` also drops the stale snapshot up front whenever the alias
actually changes, so no agents leak across accounts while the async pull is in
flight. Push handlers require an active matching alias; after `cleanup()` sets
the alias to `null`, delayed `*:changed` events for the signed-out user are
ignored until the next `initialize(alias)`.

### 2.4 Hooks (React)

```ts
useAgent(id?: string): AgentConfig | undefined      // subscribes, re-renders on that id's change
useAgents(ids: string[]): AgentConfig[]
useSkills(): SkillConfig[]
useHooks(): HookDefinition[]
```

Each hook subscribes to its cache manager and returns the current value; a change
event re-renders only components using the affected entity.

## 3. Editor dirty-state redesign (agents)

The 2026-07-01 bug family lived in the multi-tab editor's mount-time frozen
`initial*` snapshots + `tabResetKey` remount reset. Two layers:

- **Root cause (fixed):** the `agents` registry (the hot cache the IPC boundary
  re-injects `chat.agent` from) was not write-through, so a save pushed a *stale*
  `chat.agent` that re-dirtied the tab ~1ms after a clean Save. The registry
  write-through fix (`upsertRegistryAgent`/`removeRegistryAgent` in
  `agentStoreManager`) makes every push carry the just-saved agent, so the echo
  equals what was saved and no re-dirty occurs. This is the functional fix.
- **Architectural decoupling (Phase 3a):** the editor still read its baseline
  from the inline `chat.agent` recompose facade. Phase 3a repoints the baseline
  source to the normalized `agentClientCacheManager` via
  `useAgent(agentId, fallback)` (keyed by `chat.agent?.id ?? chat.agent_ids[0]`,
  falling back to the inline agent while the facade still exists). This is what
  lets Phase 4 stop re-injecting `chat.agent` without breaking the editor: once
  the facade is gone, the agent is still resolved from the store-backed cache by
  `agent_ids`.

**Deferred (documented debt, not required for facade removal):** the fuller
"single `draft`/`baseline` + `deepEqual` isDirty, tabs fully controlled from
`draft`, delete the `tabResetKey` remount hack" rewrite. Because the registry
write-through already removed the re-dirty at the source, converting all seven
tab components from semi-controlled (local state seeded on mount, reset by
`tabResetKey`) to fully-controlled is a large, higher-risk refactor whose only
remaining benefit is cleanup. It is tracked as a follow-up so each phase stays
small, independently green, and ≥90% covered. The `tabResetKey` machinery is
retained for now and continues to work because the pushes are fresh.

## 4. Phased migration

Additive first, destructive last. Every phase keeps the app green and is
independently revertible. The inline facade stays working until Phase 5.

| Phase | Scope | Risk | Removes facade? |
|-------|-------|------|-----------------|
| **1** | Main stores emit granular events (`agents/skills/hooks:changed`); agent registry write-through (done). Preload + IPC channels. | Low (additive) | No |
| **2** | Renderer cache managers (`agent/skill/hook ClientCacheManager`) + hooks, wired to the new channels + `initialize()` pull. Compat: hooks fall back to `chat.agent` / `profile.skills` if the cache is cold. | Low (parallel infra) | No |
| **3** | Migrate consumers to the hooks: (3a) the agent editor viewModel (fixes dirty-state at the source); (3b) the remaining ~33 renderer `chat.agent` readers + ~19 main accessor readers, batched by view. | Medium (per-file) | No |
| **4** | `performNotification` stops re-injecting `agent`/`mcp_servers`/`skills`/`hooks`; each sidecar pushes only its own slice; `profileDataManager` no longer carries the inline facade. | Medium | Mostly |
| **5** | Remove the read-path inline facade: delete `hydrateChatAgents` from `getChatConfig`/`getAllChatConfigs` and migrate the ~25 main consumers that read `chatConfig.agent` directly to `agentAccessor` (`getChatPrimaryAgent`/`getChatAgents`). Keep the write-side `resolveExistingPrimaryAgent` guard. | Medium (consumer migration + accessor regression fixes; NOT pure dead-code removal) | Yes |

### 4.1 Phase 1 detail

- **Agents:** `writeAgent`/`deleteAgent` already write-through the registry
  (2026-07-01 fix). Add an emitter that sends `agents:changed`
  `{ alias, agents }` to the focused window, alongside the existing whole-profile
  notify (kept until Phase 4).
- **Skills/Hooks:** after each mutator updates its `cache` Map, emit
  `skills:changed` / `hooks:changed` with the full list for that alias.
- **Preload:** add `agents.onChanged` / `skills.onChanged` / `hooks.onChanged`
  subscription bridges + `agents.getAll` / `skills.getAll` / `hooks.getAll`
  invoke bridges (the `initialize()` pull), mirroring `mcp.onServerStatesUpdated`
  / `mcp.getServerStatus`.
- **IPC (main):** register the `*:getAll` handlers returning the current
  in-memory set for an alias.

### 4.2 Phase 2 detail

- Add the three renderer cache managers (§2.3) under
  `src/renderer/lib/{agent,skill,hook}/`.
- Add the hooks (§2.4).
- Initialize the caches at the same point `mcpClientCacheManager.initialize()` is
  called (post-auth), and on alias switch. **Landed in Phase 3a:** the
  `agentClientCacheManager` push listener wires itself at construction, and the
  `initialize(userAlias)` pull is now called in `userDataProvider`'s alias effect
  (next to `chatOps.initialize`) — it shipped with Phase 3a, the first phase whose
  editor consumer actually reads the cache. Skill/hook cache `initialize()` pulls
  land when their first consumers adopt them in Phase 3b.
- **Compat shim:** while the facade still exists, `useAgent(id, fallback)`
  returns the cached agent if present, else the `fallback` (typically the inline
  `chat.agent`) the consumer passes in. This lets Phase 3 migrate consumers
  incrementally without breakage.

### 4.3 Phases 3–5 detail

- **3a:** repoint `useAgentChatEditingViewModel`'s agent baseline to the
  normalized cache via `useAgent(agentId, chat.agent)`; wire
  `agentClientCacheManager.initialize(userAlias)` into `userDataProvider`
  (alongside `chatOps.initialize`). The `tabResetKey` remount hack is retained
  (see §3 — its removal is deferred debt now that the source-level dirty bug is
  fixed by registry write-through).
- **3b:** replace `chat.agent` / `chat.agents` reads with `useAgent` / `useAgents`
  (renderer) and direct `agentAccessor` reads (main), batched by feature area, one
  commit per batch, each ≥90% covered.
- **4:** trim `performNotification`'s recompose block; give each sidecar its own
  push; `profileDataManager` drops inline agent handling. **Landed:**
  `performNotification` maps chats to `agent_ids`-only (`delete rest.agent` /
  `delete rest.agents`) and emits the granular sidecar events BEFORE the profile
  push, so a store-backed cache is fresh when the renderer resolves the pushed
  chats.
- **5:** remove the read-path facade. **Landed, and larger than the original "dead
  code" estimate:** deleting `hydrateChatAgents` exposed ~25 main-process call
  sites that read `chatConfig.agent` directly (`agentChat`, `agentChatManager`,
  `agentChatManagerSessionCoordinator`, `agentChatPromptService`,
  `agentChatHookRuntime.resolveActiveAgent`, `removeSkillsFromAgentsTool`,
  `externalAgentService`, `evalJudgeRunner`,
  `subAgentConfigResolver`, …). Each was migrated to `getChatPrimaryAgent(chat)`
  (= `chat.agent ?? getChatAgents(chat)[0]`, resolving `agent_ids[0]` via the
  registry for a separated chat) or `getChatAgents(chat)`. The write-side
  `resolveExistingPrimaryAgent` guard in `updateChatAgent` is a **separate**
  concern (it hydrates the *existing* agent before an in-place merge to prevent
  data loss) and was kept. The unreferenced renderer `getChatInfoList`/`getChatList`
  (chatOps.ts) still read inline `.agent` but have no callers, so they were left as
  documented dead code rather than migrated.

### 4.4 Phase 5 notes / lessons

- **Coverage-gate ripple.** Swapping `chatConfig.agent` → `getChatPrimaryAgent`
  on a low-coverage file pulls the WHOLE file into the diff-aware ≥90% gate. Three
  files (`removeSkillsFromAgentsTool.ts`,
  `agentChatManagerSessionCoordinator.ts`) were pre-existing debt exposed this way;
  because the migration is required for correctness (reverting re-breaks chat load
  on migrated profiles) the only valid fix was adding tests — the allowlist is
  forbidden per CLAUDE.md.
- **Barrel-mock completeness (renderer tests).** `agentChatEditingViewModel.ts`
  added `import { resolveChatAgent } from '@/lib/agent'` in Phase 4, which broke a
  coverage test whose `vi.mock('.../lib/agent', …)` only exported `useAgent` +
  `chatAgentId`. `@/lib/agent` and the test's relative specifier resolve to the
  **same** module, so the incomplete mock threw at import for every graph module
  importing the missing name. Rule: any test mocking the `lib/agent` barrel must
  export the full bridge surface (`useAgent, useAgents, chatAgentId,
  resolveChatAgent, resolveChatAgents, useChatAgent, useChatAgentMap`) or use
  `importActual`.

## 5. Tradeoffs

- **Temporary duplication (Phases 2–3).** The normalized caches run alongside the
  facade until Phase 5. Accepted: it is the only way to migrate ~52 consumers
  without a big-bang. The compat shim (§4.2) bounds the risk.
- **Sidecar events ship full lists.** Less bandwidth-efficient for agents than a
  per-id delta, but it keeps cache replacement atomic with the profile push and
  avoids ordering/reconciliation edge cases while the renderer is migrating.
  Revisit only if the agent registry grows large enough to measure.
- **Not migrating MCP config here.** MCP already has a renderer cache for status;
  normalizing its *config* is the same pattern and is deferred to keep this
  change focused.

## 6. Test plan

Per-file ≥90% coverage (lines/functions/branches/statements) on every changed
`src/**/*.{ts,tsx}`, per the repo gate.

- **Phase 1:** store-emitter unit tests (mutation → full-list event payload
  shape; alias scoping); preload bridge tests
  (`main.coverage*.test.ts` style); IPC `*:getAll` handler tests.
- **Phase 2:** cache-manager tests (full-list replace, subscribe /
  unsubscribe, `initialize()` pull, cold-cache compat fallback); hook tests
  (re-render on relevant change only).
- **Phase 3:** editor dirty-state tests (save → not dirty; echo → still not
  dirty — the regression that started this workstream); per-consumer render
  tests.
- **Phase 4–5:** assert `performNotification` no longer injects the removed
  slices; assert the facade code paths are gone and reads go through the caches.

## 7. Rollout / revert

- Land phase-by-phase; each phase is a standalone commit that keeps CI green.
- Revert granularity = one phase. Phases 1–2 are additive (safe to leave landed
  even if 3+ pause). Phase 5 is the only irreversible removal and lands last,
  after all consumers are migrated and verified.
