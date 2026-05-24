# Agent Skill Next-Turn Refresh Technical Design

> Version: 1.0.0 | Date: 2026-03-24

## 1. Overview

This document turns the accepted design into an implementable Kosmos architecture:

1. trigger from both `chat.agent.skills` binding changes and `profile.skills` registry changes
2. consume via chat-level `skill_snapshot`
3. apply changes at next-turn boundary only

The design keeps the existing two-level Skill model intact:

1. `ProfileV2.skills` remains the global installed-skill registry.
2. `ChatAgent.skills` remains the Agent-level reference list.
3. `ChatConfig.skill_snapshot` becomes the runtime consumption snapshot.

## 2. Current State

### 2.1 Current Runtime Path

Today, `AgentChat` builds the Skills section directly inside `getAgentSpecificSystemPrompt()`.

Current behavior:

1. read `currentChat.agent.skills`
2. read `profile.skills`
3. resolve names at prompt-build time
4. append a live-built Skills section

This logic exists in [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts).

### 2.2 Current Failure Mode

The known incident showed that direct folder copy plus Agent binding can bypass profile registration:

1. the Skill folder exists on disk
2. the Agent references the Skill name
3. `profile.skills` does not contain the Skill
4. runtime resolution skips it

Result: the Agent can reach `No valid skills configured for this agent.` even though the UI or file tree makes the Skill look present.

### 2.3 Why Current Live Resolution Is Weak

The prompt builder currently mixes three concerns in one place:

1. resolving the authoritative valid Skill set
2. formatting the prompt text
3. deciding when refreshed state should take effect

The design below separates them.

## 3. Design Principles

1. Preserve the existing two-level Skill reference model.
2. Do not mutate an in-flight model request.
3. Keep refresh lazy and deterministic.
4. Keep `profile.skills` as the only installed-skill authority.
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

1. `ChatConfig.skill_snapshot.prompt`

Prompt assembly must stop rebuilding the Skills catalog ad hoc from live profile data every time.

### 4.3 Why Chat Scope, Not Session Message Scope

For MVP, the snapshot should live on `ChatConfig`, not inside every chat session file.

Reasons:

1. Skill bindings are configured on `ChatAgent`, which is chat-scoped.
2. Current Agent selection and Skill references are already chat-scoped in profile data.
3. This avoids introducing a second persistence surface in session JSON.
4. It still supports next-turn refresh semantics for all sessions started from the same chat config.

If future behavior requires stricter session isolation, the design can extend later to session metadata, but that is unnecessary for V1.

## 5. Data Model

### 5.1 New Types

Recommended addition in [src/main/lib/userDataADO/types/profile.ts](../src/main/lib/userDataADO/types/profile.ts):

```ts
export interface ChatSkillSnapshotItem {
  name: string;
  description: string;
  version: string;
  file_path: string;
}

export interface ChatSkillSnapshot {
  binding_signature: string;
  registry_signature: string;
  generated_at: string;
  skills: ChatSkillSnapshotItem[];
  missing_skill_names?: string[];
  prompt: string;
}

export interface ChatConfig {
  chat_id: string;
  chat_type: 'single_agent' | 'multi_agent';
  agent?: ChatAgent;
  agents?: ChatAgent[];
  skill_snapshot?: ChatSkillSnapshot;
}
```

### 5.2 Notes on Stored Fields

1. `skills` is persisted because it improves debugging and future UI inspection.
2. `missing_skill_names` helps diagnose invalid Agent references.
3. `prompt` is persisted so prompt assembly does not have to reformat from raw registry data again.

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

Only watching `profile.skills` is insufficient because the Agent can change its selected Skill names without registry mutation.

Both are required.

## 7. Snapshot Builder

### 7.1 Builder Responsibility

Introduce a focused builder that:

1. normalizes bound Skill names
2. resolves valid entries from `profile.skills`
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
await this.refreshSkillSnapshotIfNeeded();
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
compute current resolved skills and registry signature from profile.skills

if no snapshot exists:
  build snapshot and persist
  return

if snapshot.binding_signature != current binding signature:
  build snapshot and persist
  return

if snapshot.registry_signature != current registry signature:
  build snapshot and persist
  return

reuse existing snapshot
```

### 8.3 Turn Boundary Rule

This function is called only at a fresh request boundary.

It must not run inside a partially streamed response to rewrite prompt state.

## 9. Trigger and Invalidation Strategy

### 9.1 MVP Recommendation

Use lazy refresh with optional lightweight invalidation markers.

That means:

1. signature comparison at next-turn boundary is the correctness guarantee
2. explicit stale marking is an optimization and observability aid, not the only safeguard

### 9.2 Registry Change Trigger Points

Relevant current entry points include:

1. `profileCacheManager.addSkill(...)`
2. Skill update paths that modify existing registry entries
3. Skill remove paths if implemented or already present elsewhere
4. library install/import flows that eventually call `addSkill(...)` or update the registry

Primary file: [src/main/lib/userDataADO/profileCacheManager.ts](../src/main/lib/userDataADO/profileCacheManager.ts)

### 9.3 Binding Change Trigger Points

Relevant current entry points include:

1. `update_agent`
2. Settings UI save path for Agent edits
3. any direct `profileCacheManager.updateChatAgent(...)` caller that changes `skills`

Primary file for tool-driven Agent changes: [src/main/lib/mcpRuntime/builtinTools/updateAgentTool.ts](../src/main/lib/mcpRuntime/builtinTools/updateAgentTool.ts)

### 9.4 What Invalidation Should Do

For MVP, invalidation can be implemented in one of two ways.

Option A:

1. do nothing except rely on next-turn signatures

Option B:

1. clear `chat.skill_snapshot`
2. or mark it stale with a lightweight reason flag

Recommended choice:

1. keep signatures as the hard guarantee
2. clear the snapshot for obviously affected chats when cheap and easy

## 10. Main Process Integration Points

### 10.1 Profile Types

Update [src/main/lib/userDataADO/types/profile.ts](../src/main/lib/userDataADO/types/profile.ts):

1. add `ChatSkillSnapshotItem`
2. add `ChatSkillSnapshot`
3. add `skill_snapshot?: ChatSkillSnapshot` to `ChatConfig`

### 10.2 Profile Cache Manager

Extend [src/main/lib/userDataADO/profileCacheManager.ts](../src/main/lib/userDataADO/profileCacheManager.ts):

1. add helper to write `chat.skill_snapshot`
2. add helper to clear or replace snapshot for a chat
3. optionally add helper to clear snapshots for chats affected by a Skill registry change

Possible helper names:

```ts
updateChatSkillSnapshot(alias, chatId, snapshot)
clearChatSkillSnapshot(alias, chatId)
clearSkillSnapshotsForAffectedChats(alias, skillNames)
```

### 10.3 AgentChat

Refactor [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts):

1. extract current Skills block formatting out of `getAgentSpecificSystemPrompt()`
2. call `refreshSkillSnapshotIfNeeded()` before prompt assembly
3. inject `chatConfig.skill_snapshot?.prompt` instead of rebuilding the catalog in place

### 10.4 Agent Update Tool

In [src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts](../src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts):

1. after a successful `skills` update, clear or mark the chat snapshot stale
2. do not attempt immediate mid-turn rebuild in the tool handler

### 10.5 Skill Install Flows

Relevant files:

1. [src/main/main.ts](../src/main/main.ts)
2. [src/main/lib/skill/skillManager.ts](../src/main/lib/skill/skillManager.ts)
3. [src/main/lib/skill/skillDeviceImporter.ts](../src/main/lib/skill/skillDeviceImporter.ts)

These flows do not need to rebuild prompts directly.

They only need to ensure the profile registry is updated correctly, after which next-turn refresh will pick up the new state.

## 11. Persistence Semantics

### 11.1 Why Persist the Snapshot

Persisting `skill_snapshot` inside chat config gives three benefits:

1. no extra runtime-only cache is required for correctness
2. inspection is easier during debugging
3. restarts keep the latest known snapshot until the next stale check

### 11.2 Failure Tolerance

If snapshot persistence fails:

1. the send should not crash the app
2. fallback can rebuild in memory for the current request
3. a warning should be logged

This follows Kosmos's non-fatal error strategy.

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

1. installing a Skill updates registry and next-turn refresh builds a snapshot
2. updating Agent `skills` invalidates snapshot and next-turn refresh rebuilds it
3. current-turn response is not mutated by a concurrent Skill change

### 12.3 Regression Tests

Cover the incident class explicitly:

1. Agent references a Skill name that is not in `profile.skills`
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

This will make future field debugging much easier than the current ad hoc runtime path.

## 14. Rollout Plan

### Phase 1

1. add types
2. add builder
3. refactor `AgentChat` consumption
4. ship with signature-based lazy refresh only

### Phase 2

1. add targeted snapshot clearing on known registry or binding updates
2. add better logs

### Phase 3

1. optionally expose snapshot status to renderer or debugging tools

## 15. Open Questions

1. Should empty `chat.agent.skills` clear the persisted snapshot immediately or just bypass it at runtime.
2. Should registry signature include file mtime or only logical metadata.
3. Should retry always force a stale check even if the previous request in the same chat just checked it. Recommended answer: yes, because the cost is small and correctness is clearer.

## 16. Recommended Final Decisions

1. Use `ChatConfig.skill_snapshot` as the MVP persistence layer.
2. Use both `binding_signature` and `registry_signature`.
3. Use next-turn lazy refresh as the correctness model.
4. Keep `profile.skills` as the only installed-skill authority.
5. Do not support direct folder copy as installation.