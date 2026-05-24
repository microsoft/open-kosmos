# Skill Install And Activate Technical Design

> Version: 1.0.0 | Date: 2026-03-25

## 1. Overview

This document defines the implementation for making Skill installation and current-chat activation a single coherent flow in Kosmos.

The design keeps the existing data model intact:

1. `ProfileV2.skills` remains the global installed-skill registry
2. `ChatAgent.skills` remains the per-Agent binding list
3. runtime usability is derived from the current chat's Agent binding plus the installed registry

The technical change is not a data model rewrite. It is an orchestration and truthfulness upgrade.

## 2. Current State

### 2.1 Global Installation

Skill installation currently exists through device and renderer entry points, including:

1. [src/main/lib/mcpRuntime/builtinTools/addSkillFromDeviceTool.ts](../src/main/lib/mcpRuntime/builtinTools/addSkillFromDeviceTool.ts)
2. [src/main/main.ts](../src/main/main.ts#L1367)
3. [src/preload/main.ts](../src/preload/main.ts#L650)

These paths add the Skill to the global registry but do not, by themselves, make the Skill callable by the current Agent.

### 2.2 Agent Application

Agent binding already exists through:

1. [src/main/lib/skill/applySkillToAgents.ts](../src/main/lib/skill/applySkillToAgents.ts)
2. [src/main/lib/mcpRuntime/builtinTools/applySkillToAgentsTool.ts](../src/main/lib/mcpRuntime/builtinTools/applySkillToAgentsTool.ts)
3. [src/main/main.ts](../src/main/main.ts#L1510)

### 2.3 Runtime Consumption

Runtime Skill usage is based on the current chat's Agent bindings, not only on installation status.

Relevant runtime code:

1. [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts#L844)
2. [src/renderer/components/ui/StatusBadges.tsx](../src/renderer/components/ui/StatusBadges.tsx#L131)

### 2.4 Current UX Fragmentation

Renderer-based installation already has partial post-install apply behavior:

1. [src/renderer/components/layout/AppLayout.tsx](../src/renderer/components/layout/AppLayout.tsx#L724)
2. [src/renderer/components/chat/GeneratedFileCards.tsx](../src/renderer/components/chat/GeneratedFileCards.tsx#L327)
3. [src/renderer/components/skills/ApplySkillToAgentsDialog.tsx](../src/renderer/components/skills/ApplySkillToAgentsDialog.tsx)

Chat-based installation does not share the same resolution logic, which is why contradictory responses are still possible.

## 3. Design Principles

1. preserve the existing registry-plus-binding model
2. centralize post-install resolution in one main-process service
3. make chat-based installation aware of current execution context
4. keep renderer entry points thin and reuse the same orchestration
5. separate installation truth from current-chat callable truth

## 4. Target Architecture

### 4.1 High-Level Flow

```text
install request
  -> resolve source
  -> install into profile registry
  -> resolve activation intent and target
  -> apply to current or selected Agent(s) when appropriate
  -> compute current-chat availability result
  -> return a single resolution payload
```

### 4.2 New Shared Orchestrator

Introduce a new service:

1. `src/main/lib/skill/installAndActivateSkill.ts`

This service becomes the shared entry point for:

1. chat tool installation with immediate-use intent
2. renderer file-based installation
3. renderer library installation
4. future post-install automation flows

## 5. Data Contracts

### 5.1 Activation Resolution Types

Recommended result enum:

```ts
export type SkillActivationResolution =
  | 'installed_and_callable'
  | 'installed_but_not_applied'
  | 'installed_but_needs_target_selection'
  | 'already_callable'
  | 'failed';
```

### 5.2 Orchestrator Args

```ts
export interface InstallAndActivateSkillArgs {
  source:
    | { type: 'device-path'; value: string }
    | { type: 'library-name'; value: string };
  activation: {
    mode: 'current-agent' | 'selected-agents' | 'all-agents' | 'install-only' | 'ask';
    chatId?: string;
    agentName?: string;
    targets?: Array<{ chatId: string; agentName: string }>;
  };
  userAlias: string;
  requestSource: 'chat-tool' | 'file-tree' | 'generated-file' | 'overlay-viewer' | 'settings' | 'skill-library';
}
```

### 5.3 Orchestrator Result

```ts
export interface InstallAndActivateSkillResult {
  success: boolean;
  skillName: string;
  install: {
    performed: boolean;
    success: boolean;
    isOverwrite: boolean;
  };
  activation: {
    attempted: boolean;
    success: boolean;
    appliedTargets: Array<{ chatId: string; agentName: string }>;
    skippedTargets: Array<{ chatId: string; agentName: string; reason: string }>;
  };
  currentChat: {
    chatId?: string;
    agentName?: string;
    callable: boolean;
  };
  resolution: SkillActivationResolution;
  message: string;
  error?: string;
}
```

## 6. Orchestrator Algorithm

### 6.1 Install Step

For `device-path`:

1. reuse the existing `addSkillFromDevice(...)` path
2. preserve overwrite confirmation behavior already implemented in [src/main/main.ts](../src/main/main.ts#L1367)

For `library-name`:

1. reuse the existing library install path already exposed through skill library IPC

### 6.2 Resolve Current Chat Context

If activation mode requires current-chat targeting, resolve:

1. current chat config from `profileCacheManager.getChatConfig(userAlias, chatId)`
2. current Agent name from `chat.agent.name` for single-Agent chats

If the chat is multi-Agent or the current Agent cannot be uniquely determined:

1. do not auto-apply
2. return `installed_but_needs_target_selection`

### 6.3 Apply Step

If mode is `current-agent` and the target is unambiguous:

1. call `applySkillToAgents(...)`
2. target only `{ chatId, agentName }`
3. preserve the existing `skill_snapshot: undefined` invalidation behavior in [src/main/lib/skill/applySkillToAgents.ts](../src/main/lib/skill/applySkillToAgents.ts)

### 6.4 Callable Check

After install and optional apply:

1. reload current chat config
2. confirm the Skill exists in `profile.skills`
3. confirm the current Agent's `skills` contains the Skill name
4. set `currentChat.callable = true` only if both conditions hold

### 6.5 Message Generation

Generate messages only from final resolved state, never from partial install state.

## 7. Main Process Changes

### 7.1 New Service File

Add:

1. `src/main/lib/skill/installAndActivateSkill.ts`

Responsibilities:

1. call install path
2. resolve activation target
3. call `applySkillToAgents(...)` when appropriate
4. compute final availability
5. return unified result

### 7.2 New Helper File

Add:

1. `src/main/lib/skill/skillAvailability.ts`

Responsibilities:

1. determine whether a Skill is installed
2. determine whether it is applied to the current Agent
3. determine whether it is callable in the current chat

Recommended exports:

```ts
export interface SkillAvailabilityResult {
  installed: boolean;
  appliedToCurrentAgent: boolean;
  callableInCurrentChat: boolean;
  currentAgentName?: string;
}
```

### 7.3 IPC Extensions

Extend `skillLibrary` IPC in [src/main/main.ts](../src/main/main.ts) and [src/preload/main.ts](../src/preload/main.ts):

1. `installSkillWithActivation(...)`
2. `getSkillAvailability(...)`

Recommended signatures:

```ts
installSkillWithActivation(filePathOrName, options)
getSkillAvailability(skillName, chatId)
```

## 8. Built-In Tool Changes

### 8.1 Why Built-In Tool Context Can Support This

Tool execution context is already available through:

1. [src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts](../src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts#L71)
2. [src/main/lib/subAgent/types.ts](../src/main/lib/subAgent/types.ts#L118)
3. [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts#L4244)

This provides `chatId`, `chatSessionId`, and `userAlias` during chat tool execution.

### 8.2 Unified Tool: `apply_skill_to_agents`

`apply_skill_to_agents` handles the full lifecycle:

1. Check if skill is already installed globally
2. If not installed, install first (from library or device path)
3. Apply to target agents (defaults to current agent)
4. Return a resolution payload with install and apply status

### 8.3 Availability Tool Recommendation

Add:

1. `get_skill_runtime_availability`

This should return:

1. installed state
2. applied-to-current-Agent state
3. callable-in-current-chat state

### 8.4 Legacy Tool Behavior

Keep [src/main/lib/mcpRuntime/builtinTools/installSkillFromDeviceTool.ts](../src/main/lib/mcpRuntime/builtinTools/installSkillFromDeviceTool.ts), but change message wording to avoid implying current-chat usability.

The message should become:

1. `Successfully added skill "X" to the profile skill library.`

not:

1. any message implying the current Agent can already use the Skill

## 9. Renderer Changes

### 9.1 Entry Points To Migrate

Migrate these renderer flows to the shared orchestrator IPC:

1. [src/renderer/components/layout/AppLayout.tsx](../src/renderer/components/layout/AppLayout.tsx#L724)
2. [src/renderer/components/chat/GeneratedFileCards.tsx](../src/renderer/components/chat/GeneratedFileCards.tsx#L327)
3. overlay viewer install path
4. skill library install path

### 9.2 Dialog Reuse

Keep [src/renderer/components/skills/ApplySkillToAgentsDialog.tsx](../src/renderer/components/skills/ApplySkillToAgentsDialog.tsx) as the fallback UI when resolution is `installed_but_needs_target_selection`.

Do not keep separate post-install decision logic inside each renderer component.

### 9.3 Renderer Decision Logic

Renderer components should become simple consumers of `resolution`:

1. `installed_and_callable` -> success toast only
2. `already_callable` -> informational toast only
3. `installed_but_not_applied` -> prompt or UI affordance to apply
4. `installed_but_needs_target_selection` -> open `ApplySkillToAgentsDialog`
5. `failed` -> error toast

## 10. Availability Computation

### 10.1 Installed

Installed means:

1. `profile.skills.some(skill => skill.name === skillName)`

### 10.2 Applied To Current Agent

Applied means:

1. current chat exists
2. a single current Agent can be resolved
3. `currentAgent.skills.includes(skillName)`

### 10.3 Callable In Current Chat

Callable means:

1. installed is true
2. appliedToCurrentAgent is true

For current implementation, no extra runtime gate is needed beyond those two checks.

## 12. Testing Plan

### 12.1 Unit Tests

Add unit tests for the new orchestrator:

1. install succeeds and current-agent activation succeeds
2. install succeeds but current chat is ambiguous
3. install succeeds but activation fails
4. skill already installed and already callable
5. install-only mode does not claim callable success

Suggested test files:

1. `src/main/lib/skill/__tests__/installAndActivateSkill.test.ts`
2. `src/main/lib/skill/__tests__/skillAvailability.test.ts`

### 12.2 Built-In Tool Tests

Add tests for:

1. `apply_skill_to_agents` (install + apply lifecycle)
2. `search_skills` (installed, library, GitHub sources)
3. legacy messaging accuracy

Suggested files:

1. `src/main/lib/mcpRuntime/builtinTools/__tests__/searchSkillsTool.test.ts`

### 12.3 Renderer Tests

Update or add tests for:

1. file tree install flow auto-activates in single-Agent context
2. generated-file install flow opens selection UI in ambiguous context
3. result resolution maps correctly to toast or dialog behavior

Suggested affected areas:

1. existing file tree context-menu tests
2. generated file card tests
3. dialog integration tests if needed

## 13. Rollout Strategy

### 13.1 Step 1

1. add shared orchestrator
2. add new availability helper
3. add truthful messaging for legacy install-only tool

### 13.2 Step 2

1. wire new IPC endpoint for renderer
2. migrate file tree and generated-file flows
3. add built-in current-Agent install tool

### 13.3 Step 3

1. update agent-facing prompt/tool usage strategy to prefer install-and-activate when user intent implies immediate use
2. add telemetry dashboards

## 14. Backward Compatibility

1. keep existing install and apply APIs functional
2. avoid breaking current renderer dialogs
3. ensure old install-only paths remain correct but less misleading
4. keep current profile data format unchanged

## 15. File-Level Change Summary

### 15.1 New Files

1. `src/main/lib/skill/installAndActivateSkill.ts`
2. `src/main/lib/skill/skillAvailability.ts`
3. tests for both helpers
4. built-in tool file for current-Agent installation

### 15.2 Modified Files

1. [src/main/main.ts](../src/main/main.ts)
2. [src/preload/main.ts](../src/preload/main.ts)
3. [src/main/lib/mcpRuntime/builtinTools/addSkillFromDeviceTool.ts](../src/main/lib/mcpRuntime/builtinTools/addSkillFromDeviceTool.ts)
4. [src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts](../src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts)
5. [src/renderer/components/layout/AppLayout.tsx](../src/renderer/components/layout/AppLayout.tsx)
6. [src/renderer/components/chat/GeneratedFileCards.tsx](../src/renderer/components/chat/GeneratedFileCards.tsx)
7. optionally Skill library related renderer entry points

## 16. Acceptance Criteria

1. A chat-based install-and-use request makes the Skill callable in the initiating single-Agent chat without an extra apply step.
2. A renderer-based install path and a chat-based install path return consistent resolution states.
3. No install-only result message implies current-Agent usability.
4. Availability checks distinguish installed state from callable state.
5. Existing apply-to-agents dialog remains the fallback for ambiguous target cases.