# Agent Hooks PRD

## 1. Background

OpenKosmos Agents can already be configured with profile-level resources:

1. MCP servers provide tool capabilities.
2. Skills provide task-specific instructions and workflows.
3. Agents bind the MCP servers and Skills they need.

This creates a simple and successful product model: resources live in the profile, and each Agent selects the resources it uses.

Hooks should follow the same model. They should not introduce project-level configuration or source precedence. A Hook is a reusable profile resource that is bound directly to Agents.

## 2. Problem Statement

OpenKosmos currently lacks a first-class way to customize Agent lifecycle behavior at stable runtime boundaries.

Common needs include:

1. Add context when a session starts.
2. Validate or block a user prompt before it reaches the model.
3. Validate, modify, or block a tool call before execution.
4. Inspect or transform a tool result before it is persisted back into the conversation.
5. Add recovery context after tool execution fails.

Without a unified Hooks system, these behaviors either require hard-coded product logic or ad hoc tool-specific behavior. That does not scale with the existing Agent Studio model.

## 3. Product Decision

OpenKosmos will introduce Hooks as profile-level resources.

The core product rule is:

```text
Hooks are Hooks.
They do not have source precedence or level resolution semantics.
Agents select them.
The Agent runtime resolves the active Agent's selected Hook ids before each Agent Loop execution.
```

This aligns Hooks with the existing MCP and Skills model:

```text
Profile
  -> Agents
  -> MCP servers
  -> Skills
  -> Hooks

Agent
  -> selected MCP servers
  -> selected Skills
  -> selected Hooks
```

## 4. Goals

### 4.1 Product Goals

1. Make Agent lifecycle customization a first-class resource model.
2. Keep Hooks consistent with MCP and Skills management.
3. Avoid project-level configuration and multi-level merge semantics.
4. Avoid implicit global side effects.
5. Give users and Agent authors a clear way to understand which Hooks affect an Agent.
6. Provide safe control points around user prompts, tool execution, and tool results.

### 4.2 User Goals

1. "I want this Agent to run a validation Hook before using specific tools."
2. "I want to see and manage the Hooks that affect an Agent."
3. "Adding a shared resource should not silently alter every Agent."

### 4.3 Non-Goals

1. No project-level Hooks.
2. No user/project/local/policy level merge model.
3. No source precedence model.
4. No mid-stream mutation of an in-flight model request.

## 5. Resource Model

### 5.1 Hook Definition

A Hook is a reusable profile resource.

Recommended conceptual shape:

```ts
interface HookDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  remoteVersion?: string;
  source: 'IN-LIBRARY' | 'ON-DEVICE';
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  action: HookAction; // command or http; supports an optional `if` condition
}

interface ChatAgent {
  hooks?: string[]; // selected HookDefinition ids
}
```

Each Hook is flat: one `event`, one optional `matcher`, and one `action`. A
command or http `action` may carry an optional `if` permission-rule condition
(e.g. `execute_command(rm *)`) that further gates execution on tool events.

Hooks retain the shared `version`, `source`, and optional `remoteVersion` fields
for persisted-schema compatibility. New Hooks are always authored locally with
`source: 'ON-DEVICE'`; the legacy fields are descriptive only and never trigger
network access, update checks, source precedence, or merge behavior.

### 5.2 Binding Semantics

Hooks are selected directly on an Agent through `ChatAgent.hooks`.

An Agent receives effective Hooks from the Hook ids selected on that Agent.

## 6. MVP Scope

### 6.1 In Scope

1. Profile-level Hook definitions.
2. Agent-side Hook selection.
3. Runtime resolution of effective Hooks for the active Agent.
4. Command-based Hooks.
5. HTTP Hooks.
6. Hook lifecycle events:
   1. `SessionStart`
   2. `UserPromptSubmit`
   3. `PreToolUse`
   4. `PostToolUse`
   5. `PostToolUseFailure`
   6. `Stop`
   7. `PreCompact`
   8. `PostCompact`
7. JSON input and JSON output protocol.
8. Blocking and non-blocking results.
9. Tool input update support for `PreToolUse`.
10. Tool output update support for `PostToolUse`.
11. Safety controls: timeout, output cap, cancellation, and security revalidation.

### 6.2 Out of Scope for MVP

1. Prompt Hooks that call an LLM.
2. MCP tool Hooks.
3. Agent Hooks that launch verifier Agents.
4. Sub-agent lifecycle Hooks.
5. Hook marketplace UX.
6. Automatic dependency installation for Hook commands.
7. Background async rewake semantics.

## 7. Lifecycle Events

### 7.1 `SessionStart`

Runs before the first turn of a chat session.

Primary use:

1. Add additional context.
2. Initialize lightweight session metadata.

### 7.2 `UserPromptSubmit`

Runs before the user's prompt is written into the session and sent into the Agent Loop.

Primary use:

1. Validate prompt policy.
2. Add additional context.
3. Block unsafe or unsupported requests.

### 7.3 `PreToolUse`

Runs after the model produces a tool call and before the tool is executed.

Primary use:

1. Block a tool call.
2. Add context explaining a policy decision.
3. Update tool input before execution.

If a Hook updates tool input, security validation must run again on the updated input.

### 7.4 `PostToolUse`

Runs after tool execution succeeds and before the result is persisted.

Primary use:

1. Add context based on the tool result.
2. Transform or redact tool output.
3. Attach follow-up guidance for the next Agent Loop.

### 7.5 `PostToolUseFailure`

Runs after tool execution fails and before the failure result is persisted.

Primary use:

1. Add recovery guidance.
2. Normalize failure context.
3. Improve the model's next-step reasoning.

## 8. Hook Execution Protocol

MVP supports command and HTTP Hooks. Prompt, MCP tool, and agent verifier Hooks remain out of scope until product semantics, tool-routing behavior, and recursion controls are specified.

Recommended command shape:

```ts
interface CommandHookAction {
  type: 'command';
  command: string;
  args?: string[];
  timeout?: number;
  async?: boolean;
}
```

HTTP Hooks call a configured URL with optional method, headers, and body.

Hook input is written to stdin as JSON.

Hook output is read from stdout. If stdout starts with JSON, OpenKosmos parses it as structured Hook output. Otherwise, stdout is treated as plain text output according to the event's behavior.

Example output:

```json
{
  "continue": true,
  "reason": "The tool call is safe.",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "The file path was normalized before execution.",
    "updatedInput": {
      "path": "/normalized/path"
    }
  }
}
```

## 9. Functional Requirements

### 9.1 Must Have

1. Users can create, update, enable, disable, and delete Hook definitions.
2. Users can select Hooks on Agents.
3. Agent runtime resolves effective Hooks from Agent-side selections.
4. Disabled Hooks never execute.
5. Effective Hooks are matched by lifecycle event and matcher.
6. `PreToolUse` can block a tool call.
7. `PreToolUse` can update tool input.
8. `PostToolUse` can update tool output.
9. Hook failures are surfaced in a controlled way and do not crash the app.
10. Hook command execution respects timeout, cancellation, and output limits.
11. Updated tool input is revalidated before tool execution.

### 9.2 Should Have

1. Hook management UI shows which Agents are bound.
2. Logs include Hook event, Hook id, duration, outcome, and redacted failure reason.
3. Duplicate effective Hooks are deduplicated by stable Hook id.
4. Hook execution can emit progress chunks to the chat UI.

### 9.3 Won't Have in MVP

1. Source labels such as user, project, local, or policy.
2. Project-level Hook configuration.
3. LLM-based Hook actions.
4. MCP tool Hook actions.
5. Agent verifier Hook actions.
7. Agent editor effective Hooks preview.

## 10. Experience Requirements

### 10.1 Hooks Collection

Settings should expose the profile's locally managed Hooks collection.

Minimum fields:

1. Name
2. Description
3. Enabled state
4. Hook operation: exactly one event, one optional matcher, and one action per Hook
5. Agent-side selection via the Agent editor
6. Command or HTTP action details
7. Compatibility metadata display: version label and persisted source badge

The read-only detail panel should group the selected Hook into semantic sections
aligned with the MCP tool detail layout: description, trigger, action, and
metadata. It should elevate high-signal state (enabled/source/version) into the
header and hide empty optional fields unless a user-meaningful fallback is
clearer, such as "All tools" for an empty matcher.

### 10.2 Agent Configuration

Agent editor exposes the Hooks selection surface. Settings owns the Hooks collection and Hook create/edit review; after creation, the apply-to-agents dialog writes selected Hook ids to the chosen Agents.

## 11. Success Criteria

1. A Hook selected on an Agent runs only for that Agent.
2. Adding a Hook definition to the profile does not change Agent runtime behavior unless its id is selected on the Agent.
3. `PreToolUse` can block unsafe tool execution.
4. `PostToolUse` can transform tool output before it is persisted.
5. Users can inspect why a Hook is effective for an Agent.

## 12. Risks and Mitigations

### 12.1 Risk: Hooks Become Hidden Global Side Effects

Mitigation:

1. No install-time automatic execution.
2. Require explicit Agent-side resource selection.
3. Show selected Hooks in Agent configuration.

### 12.2 Risk: Hook Commands Introduce Security Exposure

Mitigation:

1. Default Hooks feature to disabled or require explicit user enablement.
2. Apply command validation and trust checks.
3. Limit timeout and output size.
4. Revalidate updated tool input.

### 12.3 Risk: Hook Resolution Becomes Hard to Debug

Mitigation:

1. Resolve Hooks from Agent-side selections only.
2. Avoid source precedence.
3. Deduplicate by Hook id.
4. Log resolution summary at turn start.

## 13. Rollout Plan

### Phase 1

1. Add profile data model for Hooks.
2. Add Hook resolver and command/HTTP executors.
3. Integrate lifecycle events into Agent Loop.
4. Add unit tests for resolution and output parsing.

### Phase 2

1. Add Settings Hooks collection UI.
2. Add Agent effective Hooks view.

### Phase 3

1. Add prompt, MCP tool, and agent verifier Hook actions if product demand justifies them.
2. Add sub-agent lifecycle events if product demand justifies them.
3. Add richer diagnostics and chat progress display.
