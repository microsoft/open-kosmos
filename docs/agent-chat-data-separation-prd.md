# Agent / Chat Data Separation PRD

## 1. Background

Historically an "Agent" was embedded inside a "Chat". `profile.json` stored
`chats[]` where each chat carried its agent inline (`single_agent` → `agent`,
`multi_agent` → `agents[]`). The whole app treated the chats list AS the agent
list: the renderer resolved agents through `chat.agent`, `primaryAgent` was an
agent name, workspace and knowledge were both carried on the inline agent,
`chat_workspaces` were keyed by an agent-derived folder, archived agents sat in
`archive/archived_agents.json`, and scheduler jobs stored the chat id in a
misnamed `agentId` field.

This coupling blocked the product goal of reusing one agent across chats and
sharing/managing agents independently.

## 2. Goal

Separate Agent from Chat into a `1 Chat : N Agents (N >= 1)` model. A chat keeps
a mapping to agent ids and owns a fixed workspace derived from its `chat_id`;
agents become standalone, addressable, reusable entities with their own
knowledge.

## 3. Target on-disk model

```
profiles/{alias}/
├── profile.json
│   chats: [ { "chat_id": "chat_...", "agent_ids": ["agent_..."] } ]
│   archived_chats: [ { "chat_id": "chat_...", "agent_ids": ["agent-..."] } ]  # archive list SSOT
│   primaryChat: "chat_..."   # chat_id of the primary chat (V6: was primaryAgent name)
├── agents/
│   ├── index.json            # all agents: [{ id, name }]  (single index; archive is a chat concept, agents have no archived state)
│   └── {agentId}/
│       ├── agent.json        # ex-ChatAgent + { id }, no workspace
│       └── knowledge/        # moved from chat_workspaces/.../knowledge
├── chat_workspaces/{chat_id}/        # keyed by chat_id (was agent-{name}-{source})
├── chat_sessions/{chat_id}/{YYYYMM}/ # unchanged
└── schedules/{YYYYMM}.json           # job.chat_id (renamed from agentId)
```

- New and V6-migrated `agentId` values use stable UUID-like ids
  (`agent_{timestamp}_{random}`), minted once and then kept for life. Profiles
  created by older development snapshots may still contain name-derived ids; the
  V6 startup migration does not mint new ids for agents that already carry one.
- `profile.json` on disk contains chat identity/mapping fields (`chat_id`,
  `agent_ids`); inline `agent`/`agents` and `workspace` are not persisted.
  Chat workspace is still chat-owned, but it is derived at runtime from
  `{userData}/profiles/{alias}/chat_workspaces/{chat_id}`. `agent.json` must not
  store `workspace`. The archive list is a sibling `archived_chats[]` field with
  the same `agent_ids`-only shape and no workspace field.

## 4. Requirements

1. Chats reference agents by id (`agent_ids`, length ≥ 1). The profile primary is
   `primaryChat`, a stable `chat_id` (the V6 migration converts the legacy
   `primaryAgent` name → owning `chat_id`); empty/unset → fall back to first chat.
2. Agents persist standalone under `agents/{id}/agent.json` with a single
   `index.json` listing all agents (archive is a chat-only concept, so agents
   have no per-agent archived state and there is no split active/archived
   index). Legacy archived agents move out of `archive/archived_agents.json`
   into the same `index.json` (one `agents/{id}/` dir each), and the archive
   LIST moves into `profile.json` `archived_chats[]` (the SSOT,
   `agent_ids`-only). Any legacy `index_active.json` + `index_archived.json`
   are merged back into `index.json` on load and deleted.
3. Workspace and knowledge ownership are split: a chat-owned workspace follows
   the chat and is derived from `chat_id`; `agents/{id}/agent.json.knowledge` is
   agent-owned and follows the agent. `chat_workspaces` are keyed by chat_id, but
   `profile.json.chats[]` does not persist a `workspace` field.
4. Scheduler jobs use `chat_id` (renamed from `agentId`).
5. Migration is automatic on profile load, idempotent, and version-gated.
6. No data loss; schema-additive first, inline fields removed only after the
   store holds every agent.
7. Archive is a chat-only concept end to end: the Settings page reads
   "Archived Chats", and the chat "…" menu / confirm dialog / toasts use neutral
   wording ("Archive", "… archived successfully"). Archiving or restoring a chat
   only mutates `profile.archived_chats`; the agent is never marked
   archived and stays in `agents/index.json`. Restore must refuse archived entries
   whose `agent_ids` cannot be resolved from `agents/{id}/agent.json`, so an
   active chat is never restored without a usable agent.
8. Agent ids are stable and name-independent: a **new** agent is minted an
   `agent_{timestamp}_{random}` id at creation and keeps it for life, so renaming
   an agent never re-keys its store dir/`agent_ids` nor rewrites `profile.json`
   (legacy migrated agents keep their existing name-derived id). Editing an agent
   (including rename) rewrites only `agents/{id}/agent.json`.
9. Deleting a chat removes its `agent_ids` mapping and, after that profile write is
   durable, deletes the chat-owned resource graph (sessions, workspace, schedules,
   tasks, memex memory, and unshared `agents/{id}` directories). Agents still
   referenced by another active or archived chat are kept. The `manage_agents` tool
   therefore offers only non-destructive actions (`create`, `update`, `list`,
   `set_primary`, `status`) — no `remove`/delete/archive, no agent-owned
   `workspace` parameter, and all agent-name operations see secondary agents in
   multi-agent chats.

## 5. Non-goals

- Multi-PR renderer component decouple beyond reading through the accessor.

> **Update:** removing the in-memory inline facade used to render chats was a
> non-goal of the *base* separation PR, but it has since **landed** in the
> companion renderer-normalization work (see
> [sidecar-renderer-normalization-tech-doc.md](./sidecar-renderer-normalization-tech-doc.md)):
> the renderer resolves agents from store-backed client caches, `performNotification`
> pushes `agent_ids`-only chats, and the main read-path hydration was removed. A
> transient load/migration-time hydrate still runs, then strips back to `agent_ids`.

## 6. Compatibility / rollout

Migration v6 extracts agents, writes the store + indexes, rewrites chats to
ids, uses legacy inline `agent.workspace` / `chat.workspace` values only as
migration inputs to consolidate physical directories to `chat_workspaces/{chat_id}`,
then strips `workspace` from both `profile.json` chats and stored agents, and
moves knowledge.
Loads after migration hydrate the
inline agents from the store **transiently** (so V1/V4/V6 migration + sanitize
run against whole objects), then strip inline back out so the cached profile is
`agent_ids`-only, mirroring the
mcp/skills/hooks SSOT pattern. Backward compatible: pre-migration profiles
upgrade in place.
