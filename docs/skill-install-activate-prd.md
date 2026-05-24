# Skill Install And Activate PRD

> Version: 1.0.0 | Date: 2026-03-25

## 1. Background

Kosmos currently uses a two-layer Skill model:

1. `ProfileV2.skills` is the global installed-skill registry.
2. `ChatAgent.skills` is the per-Agent binding list.

This model is technically valid, but the user experience breaks when installation is treated as equivalent to immediate availability.

The real incident exposed the gap clearly:

1. the user asked to install a Skill with the intent to use it immediately
2. the system successfully installed the Skill into the global profile registry
3. the assistant replied as if the current Agent could already use it
4. the Skill was still not callable because it had not yet been applied to the current Agent

From the user's perspective, this is not a minor state mismatch. It is a broken promise:

1. "installed" was interpreted as "ready to use now"
2. the product required an extra hidden step
3. that extra step was only revealed after the user questioned the system

## 2. Problem Statement

Kosmos currently exposes two different meanings under the same conversational concept of "available Skill":

1. installed in the profile registry
2. callable by the current Agent in the current chat

This causes four product problems:

1. the assistant can claim a Skill is usable when only installation has completed
2. chat-based installation and UI-based installation do not follow the same post-install flow
3. the user must learn an internal implementation detail, namely that installation and Agent binding are separate
4. success feedback is ambiguous and can contradict later availability checks

## 3. Product Decision

Kosmos will treat "install and use" as a complete product transaction, not as two separate expert-only steps.

The new product rule is:

1. `install` means add the Skill to the global registry
2. `activate` means bind the Skill to one or more Agents
3. `callable in current chat` means the current Agent can actually use that Skill now
4. the system must not claim immediate usability unless the current chat has reached the callable state

When the user expresses immediate-use intent, Kosmos should complete both installation and activation in one guided flow.

## 4. Scope

### 4.1 In Scope

1. define clear user-facing states for installed, activated, and callable Skills
2. unify chat and renderer installation flows under one post-install behavior
3. support install-and-activate for the current Agent when context is unambiguous
4. support target selection when the Agent target is ambiguous
5. update success and error messaging to reflect real callable state
6. expose runtime availability checks that distinguish installation from current-chat usability
7. add telemetry for activation completion and abandonment

### 4.2 Out of Scope

1. redesigning the full Skills management UI information architecture
2. changing the underlying two-layer data model of `profile.skills` and `chat.agent.skills`
3. introducing session-level historical Skill state tracking
4. changing unrelated MCP or Agent authoring workflows

## 5. Goals

### 5.1 Product Goals

1. make "install and use" succeed as a single coherent experience
2. remove contradictory assistant responses about Skill availability
3. unify installation behavior across chat, file tree, generated files, overlay viewer, and settings pages
4. make the current Agent's callable Skill state inspectable and deterministic

### 5.2 User Goals

1. "When I say install this Skill and use it, the current assistant should be able to use it immediately if there is no ambiguity."
2. "If the system needs a target Agent, it should ask me clearly instead of pretending the Skill is already usable."
3. "If a Skill is installed but not enabled for the current Agent, the product should tell me that explicitly."

### 5.3 Non-Goals

1. auto-applying every installed Skill to all Agents
2. hiding all installation state from advanced users
3. removing the distinction between global registry and Agent binding

## 6. User Stories

1. As a user in a single-Agent chat, when I say "install pdf skill, I want to use it", the current Agent should become able to use the Skill without a second manual step.
2. As a user in a multi-Agent chat, when I install a Skill for immediate use, the system should ask me which Agent to apply it to.
3. As a user, when I ask which Skills are available now, I want the answer to reflect callable Skills for the current Agent, not only globally installed Skills.
4. As a developer, I want all installation entry points to share the same post-install decision logic so behavior stays consistent.

## 7. Experience Principles

### 7.1 Truthful Success Messaging

Kosmos must only use "ready to use" language when the current Agent can actually call the Skill.

Allowed states:

1. installed and callable now
2. installed but not yet applied
3. installed but target selection required
4. already callable

### 7.2 Intent Over Internal Mechanics

If the user says:

1. "install this Skill, I want to use it"
2. "install and use it now"
3. "install this for you to use"

Kosmos should interpret that as an install-and-activate request, not as install-only.

### 7.3 No Silent Global Side Effects

Kosmos must not apply a newly installed Skill to all Agents unless the user explicitly asks for that.

### 7.4 Clear Ambiguity Handling

If there is no single obvious target Agent:

1. do not auto-apply broadly
2. do not claim success prematurely
3. ask the user or open the existing Agent selection UI

## 8. Functional Requirements

### 8.1 Skill State Model

The system must distinguish these states:

1. `installed`: Skill exists in `profile.skills`
2. `applied`: Skill exists in a target Agent's `skills` list
3. `callable_in_current_chat`: current chat's active Agent can use the Skill now

### 8.2 Install And Activate Flow

The system must support a unified flow that:

1. installs the Skill from device or library
2. determines whether immediate activation is expected
3. resolves the target Agent if possible
4. applies the Skill when the target is unambiguous
5. returns a result that explicitly states whether the Skill is callable in the current chat

### 8.3 Current-Agent Auto Activation

When all of the following are true:

1. the request expresses immediate-use intent
2. the request occurs in a single-Agent chat context
3. the current Agent is editable

Kosmos must auto-apply the installed Skill to the current Agent.

### 8.4 Ambiguous Target Resolution

When the request occurs in a context with more than one possible target Agent:

1. the Skill should still be installed successfully
2. the system must return `needs_target_selection`
3. UI entry points should open an Agent selection dialog
4. chat entry points should ask a direct follow-up question

### 8.5 Availability Query

Kosmos must provide an availability check that returns:

1. whether the Skill is installed
2. whether it is applied to the current Agent
3. whether it is callable in the current chat

### 8.6 Messaging Rules

The system must use distinct success messages:

1. installed and callable
2. installed but not applied
3. already callable
4. installed and waiting for target selection

## 9. Intent Rules

### 9.1 Immediate-Use Intent

The following requests are treated as install-and-activate intent:

1. "install this Skill, I want to use it"
2. "install this and use it now"
3. "apply this Skill to yourself"
4. "make this Skill available here"

### 9.2 Install-Only Intent

The following requests are treated as install-only:

1. "install this Skill to the library"
2. "add this Skill first"
3. "just install it"
4. "do not apply it yet"

### 9.3 Default Behavior

If intent is unclear:

1. UI flows should prefer explicit post-install selection affordances
2. chat flows should prefer a concise clarification or install-first response without overclaiming availability

## 10. Entry Point Requirements

### 10.1 Chat Tool Path

Chat-based Skill installation must support current-chat-aware activation behavior using runtime tool execution context.

### 10.2 File Tree Path

Installing from a file tree node must use the same activation resolution logic as chat-based installation.

### 10.3 Generated File Card Path

Installing from generated-file attachments must use the same activation resolution logic as chat-based installation.

### 10.4 Settings And Library Path

Installing from Settings or Skill library views must use the same post-install resolver so the product remains consistent.

## 11. Success Metrics

### 11.1 Primary Metrics

1. percentage of Skill installs that become callable in the initiating chat within the same flow
2. reduction in follow-up turns needed after a successful Skill installation
3. reduction in contradictory assistant replies about installed versus callable Skills

### 11.2 Supporting Metrics

1. install success rate
2. activation success rate
3. install-to-activation abandonment rate
4. multi-Agent target-selection completion rate

## 13. UX Requirements

### 13.1 Chat Response Examples

Installed and callable:

1. "pdf has been installed and applied to Kobi. I can use it in this chat now."

Installed but not yet applied:

1. "pdf has been installed to your Skill library, but it is not enabled for the current Agent yet. Do you want me to apply it to Kobi?"

Target selection required:

1. "pdf has been installed. Which Agent should use it?"

Already callable:

1. "pdf is already available for the current Agent."

### 13.2 UI Feedback

UI toasts, dialogs, and status badges should clearly separate:

1. installed in library
2. enabled for current Agent

## 14. Risks And Mitigations

### 14.1 Risk: Over-Automation Applies Skills Too Broadly

Mitigation:

1. only auto-apply for unambiguous single-Agent current-chat cases
2. never default to apply-all

### 14.2 Risk: Old Code Paths Still Overclaim Availability

Mitigation:

1. update legacy install-only responses to say "installed to library"
2. add tests for response wording and resolution states

### 14.3 Risk: Different Entry Points Drift Again

Mitigation:

1. centralize post-install resolution in one shared orchestrator
2. keep renderer flows thin and declarative

## 15. Rollout Plan

### 15.1 Phase 1

1. ship truthful messaging for install-only paths
2. add install-and-activate orchestration in main process
3. add chat-aware current-Agent installation flow

### 15.2 Phase 2

1. migrate all renderer entry points to the shared orchestrator
2. update Skill availability UI labels
3. add telemetry dashboards for install-to-callable funnel

### 15.3 Phase 3

1. optimize target selection UX for multi-Agent chats
2. consider richer availability UI if metrics still show confusion

## 16. Acceptance Criteria

1. In a single-Agent chat, an install-and-use request results in the Skill becoming callable without an extra manual apply step.
2. In an ambiguous multi-Agent context, the system installs the Skill but does not claim current usability before the target is chosen.
3. When the user asks which Skills are available now, the answer reflects current-Agent callable Skills.
4. File tree, generated-file, chat, and settings installation flows all produce the same resolution outcomes.
5. No success message claims immediate use unless activation for the current Agent has actually completed.