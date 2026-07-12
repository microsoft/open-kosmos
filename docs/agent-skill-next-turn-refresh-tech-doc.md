# Agent Skill Next-Turn Refresh Technical Design

> Version: 1.1.0 | Date: 2026-06-27

## 1. Overview

This document turns the accepted design into an implementable OpenKosmos architecture:

1. trigger from both `chat.agent.skills` binding changes and `skills.json` registry changes
2. consume via a chat-level snapshot stored in the in-memory `chatSkillSnapshotStore`
3. apply changes at next-turn boundary only

The design keeps the existing two-level Skill model intact:

1. `SkillsConfigManager` / `skills.json` is the global installed-skill registry.
2. `ChatAgent.skills` remains the Agent-level reference list.
3. `chatSkillSnapshotStore` holds the runtime consumption snapshot in memory; `ChatConfig.skill_snapshot` is not persisted.

## 2. Runtime State

### 2.1 Final Runtime Path

`AgentChatPromptService.refreshSkillSnapshotIfNeeded()` runs at the next-turn boundary before prompt assembly.

Current behavior:

1. read `currentChat.agent.skills`
2. read `skillsConfigManager.getSkills(alias)`
3. build or reuse the in-memory `ChatSkillSnapshot` in `chatSkillSnapshotStore`
4. `getAgentSpecificSystemPrompt()` appends `chatSkillSnapshotStore.get(alias, chatId)?.prompt`

This logic exists in [src/main/lib/chat/agentChatPromptService.ts](../src/main/lib/chat/agentChatPromptService.ts).

### 2.2 Current Failure Mode

The known incident showed that direct folder copy plus Agent binding can bypass profile registration:

1. the Skill folder exists on disk
2. the Agent references the Skill name
3. `skills.json` does not contain the Skill
4. runtime resolution skips it

Result: the Agent can reach `No valid skills configured for this agent.` even though the UI or file tree makes the Skill look present.

### 2.3 Why the Old Live Resolution Was Weak

The old prompt builder mixed three concerns in one place:

1. resolving the authoritative valid Skill set
2. formatting the prompt text
3. deciding when refreshed state should take effect

The design below separates them.

## 3. Design Principles

1. Preserve the existing two-level Skill reference model.
2. Do not mutate an in-flight model request.
3. Keep refresh lazy and deterministic.
4. Keep `SkillsConfigManager` / `skills.json` as the only installed-skill authority.
5. Minimize invasive changes to unrelated renderer flows.

## 4. Target Architecture

### 4.1 High-Level Flow

```text
Skill registry change or Agent skills change
  -> mark chat snapshot stale
  -> next send/regenerate begins
  -> AgentChat checks snapshot signatures
  -> rebuild snapshot if stale or missing
  -> prompt assembly consumes snapshot.prompt only
```

### 4.2 Consumption Boundary

The new source of truth at prompt time is:

1. `chatSkillSnapshotStore.get(alias, chatId)?.prompt`

Prompt assembly must stop rebuilding the Skills catalog ad hoc from live profile data every time.

### 4.3 Why Chat Scope, Not Session Message Scope

The snapshot lives in the process-local `chatSkillSnapshotStore`, not inside `ChatConfig` and not inside every chat session file.

Reasons:

1. Skill bindings are configured on `ChatAgent`, which is chat-scoped.
2. The snapshot is rebuildable from `chat.agent.skills` plus `skillsConfigManager.getSkills(alias)`.
3. This avoids coupling registry changes to `profile.json` writes and avoids introducing a session JSON surface.
4. It still supports next-turn refresh semantics because a cold cache simply rebuilds before prompt assembly.

If future behavior requires durable inspection across restarts, the design can add a debug surface later, but persistence is unnecessary for correctness.

## 5. Data Model

### 5.1 Runtime Types

`ChatSkillSnapshotItem` and `ChatSkillSnapshot` remain runtime data types, but `ChatConfig` no longer has `skill_snapshot?: ChatSkillSnapshot`.

```ts
interface ChatSkillSnapshotItem {
  name: string;
  description: string;
  version: string;
  file_path: string;
}

interface ChatSkillSnapshot {
  binding_signature: string;
  registry_signature: string;
  generated_at: string;
  skills: ChatSkillSnapshotItem[];
  missing_skill_names?: string[];
  prompt: string;
}
```

### 5.2 Store

`src/main/lib/userDataADO/chatSkillSnapshotStore.ts` owns the cache:

```text
Map<alias, Map<chatId, ChatSkillSnapshot>>
```

It exposes `get`, `set`, `clear(alias, chatId)`, `clearForAlias`, `clearAll`, and `invalidateAffectedChats(alias, chats, skillNames)`. The store is intentionally not persisted. Old `ChatConfig.skill_snapshot` values from previous builds are ignored by sanitization and drop on the next profile rewrite.

## 6. Signature Strategy

### 6.1 Binding Signature

`binding_signature` represents the normalized Agent-side Skill binding.

Recommended input:

1. `chat.agent.skills ?? []`
2. preserve configured order after trimming, deduping, and removing empty names

Recommended canonical form:

```ts
JSON.stringify(normalizedSkillNames)
```

This is sufficient because the binding signal is mostly structural, not cryptographic.

### 6.2 Registry Signature

`registry_signature` represents the installed metadata currently visible for the bound Skill names.

Recommended input per resolved Skill:

1. `name`
2. `description`
3. `version`
4. `source`
5. resolved file path if available

Recommended canonical form:

```ts
JSON.stringify(
  resolvedSkills.map(skill => ({
    name: skill.name,
    description: skill.description,
    version: skill.version,
    source: skill.source,
    file_path: skill.file_path,
  }))
)
```

This catches both install/uninstall and metadata updates.

### 6.3 Why Two Signatures

Only watching `chat.agent.skills` is insufficient because installed metadata can change without binding changes.

Only watching `skills.json` is insufficient because the Agent can change its selected Skill names without registry mutation.

Both are required.

## 7. Snapshot Builder

### 7.1 Builder Responsibility

Introduce a focused builder that:

1. normalizes bound Skill names
2. resolves valid entries from `skillsConfigManager.getSkills(alias)`
3. records missing names
4. computes signatures
5. formats the final prompt text

Recommended home:

1. a small helper in `src/main/lib/chat/` or `src/main/lib/skill/`

Good candidates:

1. `src/main/lib/chat/skillSnapshotBuilder.ts`
2. `src/main/lib/skill/skillSnapshotBuilder.ts`

### 7.2 Prompt Formatting Contract

The builder should generate the entire Skills prompt block, including:

1. section header
2. usage guidance
3. available Skills list
4. best practices

This keeps `AgentChat` simple: it only injects `snapshot.prompt` if present.

### 7.3 File Path Resolution

The builder should keep current path semantics consistent with the existing runtime.

Current code builds a path under:

1. `{userData}/profiles/{alias}/skills/{skillName}/skill.md`

If that convention changes later, only the snapshot builder needs to change.

## 8. Refresh Algorithm

### 8.1 Entry Point

Before a new model request is assembled, `AgentChat` should call something like:

```ts
this.refreshSkillSnapshotIfNeeded();
```

Recommended location:

1. immediately before building the combined system prompt for a new send or regenerate flow

### 8.2 Algorithm

```text
load current chat config
if no agent or no skill references:
  clear or bypass snapshot
  return

compute current binding signature from chat.agent.skills
compute current resolved skills and registry signature from `skillsConfigManager.getSkills(alias)`

if no snapshot exists:
  build snapshot and store in `chatSkillSnapshotStore`
  return

if snapshot.binding_signature != current binding signature:
  build snapshot and store in `chatSkillSnapshotStore`
  return

if snapshot.registry_signature != current registry signature:
  build snapshot and store in `chatSkillSnapshotStore`
  return

reuse existing snapshot
```

### 8.3 Turn Boundary Rule

This function is called only at a fresh request boundary.

It must not run inside a partially streamed response to rewrite prompt state.

## 9. Trigger and Invalidation Strategy

### 9.1 Final Strategy

Use lazy refresh with lightweight in-memory invalidation.

That means:

1. signature comparison at next-turn boundary is the correctness guarantee
2. explicit store clearing is an eagerness optimization, not the only safeguard

### 9.2 Registry Change Trigger Points

Relevant current entry points include:

1. `ProfileCacheManager.addSkill(...)` → `profileEntityCrud.addSkillConfig(...)` → `skillsConfigManager.addSkill(...)`
2. Skill update paths that modify existing registry entries
3. Skill remove paths if implemented or already present elsewhere
4. local import flows that eventually call `addSkill(...)` or update the registry

Primary files: [src/main/lib/userDataADO/profileEntityCrud.ts](../src/main/lib/userDataADO/profileEntityCrud.ts), [src/main/lib/userDataADO/skillsConfigManager.ts](../src/main/lib/userDataADO/skillsConfigManager.ts), and [src/main/lib/userDataADO/chatSkillSnapshotStore.ts](../src/main/lib/userDataADO/chatSkillSnapshotStore.ts)

### 9.3 Binding Change Trigger Points

Relevant current entry points include:

1. `update_agent`
2. Settings UI save path for Agent edits
3. any direct `profileCacheManager.updateChatAgent(...)` caller that changes `skills`

Primary file for tool-driven Agent changes: [src/main/lib/mcpRuntime/builtinTools/updateAgentTool.ts](../src/main/lib/mcpRuntime/builtinTools/updateAgentTool.ts)

### 9.4 What Invalidation Should Do

Final behavior:

1. keep signatures as the hard guarantee
2. clear the matching `chatSkillSnapshotStore` entry for obvious binding changes
3. call `chatSkillSnapshotStore.invalidateAffectedChats(alias, chats, skillNames)` after successful skill CRUD so chats bound to changed skills rebuild on demand

## 10. Main Process Integration Points

### 10.1 Snapshot Types and Store

[src/main/lib/userDataADO/types/profile.ts](../src/main/lib/userDataADO/types/profile.ts) defines `ChatSkillSnapshotItem` and `ChatSkillSnapshot` for runtime use, but `ChatConfig` does **not** persist `skill_snapshot`. [src/main/lib/userDataADO/chatSkillSnapshotStore.ts](../src/main/lib/userDataADO/chatSkillSnapshotStore.ts) owns the in-memory store and invalidation helpers.

### 10.2 Profile / Registry Orchestration

`ProfileCacheManager.addSkill` / `updateSkill` / `deleteSkill` delegate to `profileEntityCrud.addSkillConfig` / `updateSkillConfig` / `deleteSkillConfig`. Those wrappers gate on profile existence, write only `skills.json` through `SkillsConfigManager`, invalidate affected chats in `chatSkillSnapshotStore`, and notify the renderer. The removed `updateChatSkillSnapshot` / `clearSkillSnapshotsForAffectedChats` profile writers must not be reintroduced.

### 10.3 AgentChat

[src/main/lib/chat/agentChatPromptService.ts](../src/main/lib/chat/agentChatPromptService.ts):

1. `refreshSkillSnapshotIfNeeded()` rebuilds or clears the store before prompt assembly
2. `getAgentSpecificSystemPrompt()` injects `chatSkillSnapshotStore.get(alias, chatId)?.prompt`
3. prompt assembly does not rebuild the catalog directly from live registry data

### 10.4 Agent Update Tool

In [src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts](../src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts):

1. after a successful `skills` update, clear the chat's `chatSkillSnapshotStore` entry
2. do not attempt immediate mid-turn rebuild in the tool handler

### 10.5 Skill Install Flows

Relevant files:

1. [src/main/main.ts](../src/main/main.ts)
2. [src/main/lib/skill/skillManager.ts](../src/main/lib/skill/skillManager.ts)
3. [src/main/lib/skill/skillDeviceImporter.ts](../src/main/lib/skill/skillDeviceImporter.ts)

These flows do not need to rebuild prompts directly.

They only need to ensure the profile registry is updated correctly, after which next-turn refresh will pick up the new state.

## 11. Persistence Semantics

### 11.1 Why the Snapshot Is Not Persisted

The snapshot is a rebuildable cache, not user-authored profile state. Persisting it in `profile.json` would force unrelated skill-registry changes to rewrite profile data just to drop stale snapshots. Correctness already comes from the next-turn signature check, so the final design keeps snapshots in `chatSkillSnapshotStore` only.

1. process restart or cache eviction simply means the next turn sees a missing snapshot and rebuilds it
2. binding changes clear the store entry after `updateChatConfig` succeeds
3. skill CRUD invalidates affected chats through `chatSkillSnapshotStore.invalidateAffectedChats`
4. old persisted `skill_snapshot` values are dropped on load and are never re-written

### 11.2 Failure Tolerance

If snapshot rebuild fails:

1. the send should not crash the app
2. the prompt can proceed without a skill snapshot for that turn
3. a warning should be logged

This follows OpenKosmos's non-fatal error strategy.

## 12. Testing Strategy

### 12.1 Unit Tests

Add unit tests for the snapshot builder:

1. bound Skill resolves from registry
2. missing Skill name is recorded
3. binding signature changes when skill order or content changes as designed
4. registry signature changes when version or description changes
5. prompt output contains only valid Skills

### 12.2 Integration Tests

Add main-process or store-level tests for:

1. installing a Skill updates `skills.json` and next-turn refresh builds a store snapshot
2. updating Agent `skills` clears the store snapshot and next-turn refresh rebuilds it
3. current-turn response is not mutated by a concurrent Skill change

### 12.3 Regression Tests

Cover the incident class explicitly:

1. Agent references a Skill name that is not in `skills.json`
2. snapshot records it as missing
3. prompt excludes it
4. system does not falsely treat folder presence as formal installation

## 13. Logging and Diagnostics

Recommended log fields when a snapshot refresh occurs:

1. `chatId`
2. `userAlias`
3. refresh reason: `missing_snapshot` | `binding_changed` | `registry_changed`
4. valid skill count
5. missing skill count

This makes field debugging easier than the old ad hoc runtime path.

## 14. Rollout State

1. Runtime types and `skillSnapshotBuilder` exist.
2. `AgentChatPromptService` consumes `chatSkillSnapshotStore` at turn boundaries.
3. Binding changes clear the relevant store entry after profile writes succeed.
4. Skill CRUD invalidates affected chat snapshots through `chatSkillSnapshotStore.invalidateAffectedChats`.
5. Renderer snapshot status or debug UI remains optional future work.

## 15. Open Questions

1. Should empty `chat.agent.skills` clear the in-memory snapshot immediately or just bypass it at runtime. Recommended answer: clear the store entry.
2. Should registry signature include file mtime or only logical metadata.
3. Should retry always force a stale check even if the previous request in the same chat just checked it. Recommended answer: yes, because the cost is small and correctness is clearer.

## 16. Recommended Final Decisions

1. Use `chatSkillSnapshotStore` as the runtime snapshot layer; do not persist `ChatConfig.skill_snapshot`.
2. Use both `binding_signature` and `registry_signature`.
3. Use next-turn lazy refresh as the correctness model.
4. Keep `SkillsConfigManager` / `skills.json` as the only installed-skill authority.
5. Do not support direct folder copy as installation.