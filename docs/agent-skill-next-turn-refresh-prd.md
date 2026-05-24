# Agent Skill Next-Turn Refresh PRD

## 1. Background

Kosmos currently uses a two-level Skill model:

1. `ProfileV2.skills` is the global installed-skill registry.
2. `ChatAgent.skills` is the Agent-level name reference list.

At runtime, `AgentChat` reads `currentChat.agent.skills`, looks up each name in `profile.skills`, and then appends a live-built Skills section into the system prompt.

This works when the registry and the Agent binding are already consistent before a turn starts, but it has two product problems:

1. A Skill can be installed or updated during a chat, while the current turn is already in flight.
2. A Skill can be bound on the Agent while the runtime still has no stable "consumption snapshot" for that chat.

The recent incident around local Skill installation exposed the core issue clearly: copying a Skill folder and binding the name on the Agent is not enough. If the Skill is not formally registered in `profile.skills`, runtime prompt injection skips it and the Agent can still end up with `No valid skills configured for this agent.`

## 2. Problem Statement

Kosmos currently treats Skill availability as a live read from two mutable sources during prompt assembly:

1. Agent binding: `chat.agent.skills`
2. Installed registry: `profile.skills`

This creates three issues:

1. There is no explicit chat-level Skill snapshot that represents "the Skills this chat will use on the next turn".
2. Mid-chat Skill changes do not have a well-defined effect boundary.
3. The system has no formal stale/refresh model, so behavior is harder to reason about and explain.

## 3. Product Decision

Kosmos will introduce a chat-level `skill_snapshot` as the only runtime consumption layer for Agent Skills.

The product rule is:

1. `chat.agent.skills` changes and `profile.skills` changes are both refresh triggers.
2. `skill_snapshot` is the only source used by prompt assembly.
3. Refresh takes effect on the next turn, not in the middle of the current model run.

This aligns Kosmos with the practical semantics already proven in OpenClaw research: Skill availability can refresh without restarting the process, but the refresh boundary must be the next turn or a newly started session flow.

## 4. Scope

### 4.1 In Scope

1. Add `skill_snapshot` to chat-scoped persisted config.
2. Define snapshot stale rules based on both binding changes and registry changes.
3. Refresh snapshot before a new turn begins.
4. Make `AgentChat` consume `skill_snapshot.prompt` instead of rebuilding Skills prompt text directly from live registry data.
5. Ensure formal Skill install, Skill update, Skill delete, and Agent Skill binding update can invalidate affected chats.
6. Keep current-turn behavior stable when a Skill changes mid-run.

### 4.2 Out of Scope

1. Rebuilding the current in-flight prompt or mutating a running model call.
2. Supporting direct folder copy as an official local install path.
3. Redesigning the entire Skills UI.
4. Converting Kosmos into a full file-scan-based Skill discovery system like OpenClaw.
5. Introducing per-message historical Skill snapshots.

## 5. Goals

### 5.1 Product Goals

1. Make Skill refresh semantics deterministic and explainable.
2. Ensure newly installed or newly bound Skills become available without requiring app restart.
3. Prevent the runtime from consuming partially updated or inconsistent Skill state mid-turn.
4. Preserve the current two-level reference model instead of introducing a second Skills authority.

### 5.2 User Goals

1. "If I install or update a Skill during a chat, it should become usable soon without restarting."
2. "If the Agent adds or removes a Skill from its config, I want that change to apply predictably."
3. "The current answer should stay stable, and the new Skill state should apply on the next turn."

### 5.3 Non-Goals

1. Immediate mid-stream Skill hot swap.
2. Replacing `profile.skills` as the global registry.
3. Treating on-disk Skill folders as installed if registration never happened.

## 6. User Stories

1. As a user, when a Skill is formally installed in the current profile, I want the current chat to use it on the next turn if the Agent references it.
2. As a user, when an Agent's `skills` list changes, I want the next turn to reflect the new selection.
3. As a user, I do not want the current generating response to change behavior halfway through because a Skill changed in the background.
4. As a developer, I want a single chat-level snapshot so runtime behavior is easy to inspect, debug, and persist.

## 7. Experience Rules

### 7.1 Refresh Boundary

Skill changes never alter the currently active LLM request.

They apply at the next safe turn boundary, including:

1. the next user send
2. retry or regenerate that starts a fresh model request
3. a newly created session that starts after the change

### 7.2 Current-Turn Stability

If a Skill is installed, updated, or rebound while the Agent is already responding:

1. the current response continues unchanged
2. the chat is marked stale for Skills
3. the next turn rebuilds the snapshot before prompt assembly

### 7.3 Missing Skill Handling

If the Agent references a Skill name that does not exist in `profile.skills`:

1. the snapshot records it as missing
2. the prompt only includes valid Skills
3. the turn does not fail solely because of the missing reference

### 7.4 Unsupported Local Install Path

Directly copying a folder into `profiles/<alias>/skills/<name>/` is not treated as installation.

Only formal install paths count:

1. `skillLibrary.installSkillFromFilePath(...)`
2. `skillLibrary.addSkillFromDevice(...)`
3. library install paths that eventually call `profileCacheManager.addSkill(...)` or update the existing registered Skill entry

## 8. Functional Requirements

### 8.1 Must Have

1. Persist a chat-level `skill_snapshot`.
2. Persist enough metadata to detect whether the snapshot is stale.
3. Recompute the snapshot when either Agent Skill bindings or installed-skill registry data changes.
4. Recompute only at next-turn boundary, never mid-request.
5. Make `AgentChat` consume only snapshot-derived prompt text.
6. Allow chats with missing Skill references to continue operating using the valid subset.

### 8.2 Should Have

1. Store missing Skill names in the snapshot for inspection and debugging.
2. Expose refresh reason in logs.
3. Rebuild snapshots automatically for new chats created from updated Agent configs.

### 8.3 Won't Have in MVP

1. UI badge for "Skills updated, applies next turn".
2. Full Skill diff history.
3. Background precomputation of every chat snapshot immediately after every profile change.

## 9. Data Model Requirements

### 9.1 New Chat-Level Snapshot

`ChatConfig` will gain a persisted `skill_snapshot` object.

Recommended fields:

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

### 9.2 Signature Semantics

1. `binding_signature` represents the normalized Agent `skills` selection for the chat.
2. `registry_signature` represents the installed metadata for the bound Skills as currently known in `profile.skills`.

If either signature no longer matches live state at turn start, the snapshot is stale.

### 9.3 Backward Compatibility

If `skill_snapshot` is absent:

1. existing chats remain readable
2. the next turn lazily builds the first snapshot
3. no one-time migration job is required for MVP

## 10. Product Logic

### 10.1 Trigger Sources

The system must consider both of these as refresh triggers:

1. `chat.agent.skills` changes
2. `profile.skills` registry changes

Typical entry points include:

1. formal Skill install
2. Skill update
3. Skill removal
4. Agent update via `update_agent`
5. any Settings-page Agent edit that changes `skills`

### 10.2 Consumption Rule

Prompt assembly must not re-derive the authoritative available-skill list from scratch.

Instead it uses the already built `skill_snapshot.prompt`.

### 10.3 Refresh Timing

At the beginning of a new send/regenerate flow:

1. read live `chat.agent.skills`
2. read live `profile.skills`
3. compare with persisted snapshot signatures
4. rebuild snapshot if stale or missing
5. continue prompt assembly using refreshed snapshot

## 11. Success Criteria

1. A formally installed Skill becomes usable on the next turn without restart.
2. An Agent Skill binding change becomes usable on the next turn without restart.
3. Mid-turn Skill changes do not alter the in-flight response.
4. The previous failure mode where direct copy plus binding looks installed but remains unresolved is now easier to diagnose because snapshot state explicitly records valid and missing Skill names.

## 12. Risks and Mitigations

### 12.1 Risk: Stale Snapshot Persists Too Long

Mitigation:

1. next-turn stale check is mandatory
2. snapshot rebuild is lazy but deterministic

### 12.2 Risk: Too Many Chats Need Recompute

Mitigation:

1. do not eagerly rebuild every chat on every registry change in MVP
2. only mark affected chats stale and rebuild on demand

### 12.3 Risk: Ambiguity Between Installed and On-Disk Skills

Mitigation:

1. keep `profile.skills` as the sole registry authority
2. document that folder copy is not installation

## 13. Rollout Notes

The feature should ship as an internal architecture improvement first.

No user-facing migration or onboarding flow is required.

If later needed, renderer surfaces can expose snapshot status or refresh diagnostics, but that is not required for MVP.