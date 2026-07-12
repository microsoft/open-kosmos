# Agent Hooks Technical Design

> Version: 1.1.0 | Date: 2026-06-28
>
> Revision 1.1.0: the global Hook *list* is extracted from `profile.json` into a
> standalone `hooks.json` owned by `HooksConfigManager` (mirroring the MCP and
> Skills extractions). The Hooks master switch (`hooksEnabled`) stays in
> `profile.json`. Sections 3.3, 5.2, 6, 12, 14, and 15 reflect this model.

## 1. Overview

This document defines the implementable architecture for OpenKosmos Agent Hooks.

Hooks are profile-level resources selected by Agents. They do not have source or level semantics. At runtime, the Agent Loop resolves the active Agent's selected Hook ids (`ChatAgent.hooks`) and executes the resulting effective Hooks at lifecycle boundaries.

The design intentionally follows the existing MCP and Skills model:

```text
Profile resource library
  -> Agent selects resources
  -> runtime resolves resources for the active Agent
```

## 2. Design Principles

1. Keep Hooks as ordinary profile resources.
2. Do not introduce project-level configuration.
3. Do not introduce source precedence or multi-level merge rules.
4. Resolve effective Hooks from Agent-side selections only.
5. Keep Agent Loop integration narrow and explicit.
6. Reuse existing cancellation, security, logging, and persistence patterns.

## 3. Current Relevant Architecture

### 3.1 Agent Loop

The main Agent Loop runs through:

1. `src/main/lib/chat/agentChat.ts`
2. `src/main/lib/chat/agentChatTurnRunner.ts`
3. `src/main/lib/chat/agentChatToolExecutor.ts`
4. `src/main/lib/chat/agentChatStreamingService.ts`

Important current flow:

```text
User message
  -> AgentChatTurnRunner.runStreamMessage()
  -> add user message to session
  -> run conversation loop
  -> callWithToolsStreaming()
  -> model response
  -> handleToolCalls()
  -> executeToolCall()
  -> postProcessToolResult()
  -> persist tool result
```

### 3.2 MCP Runtime

Tool execution routes through:

1. `src/main/lib/chat/agentChatToolExecutor.ts`
2. `src/main/lib/mcpRuntime/mcpClientManager.ts`
3. `src/main/lib/mcpRuntime/builtinMcpClient.ts`
4. `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts`

`AgentChatToolExecutor.executeToolCall()` is the most important tool execution boundary for Hooks.

### 3.3 Profile Persistence

Profile-level resources live in:

1. `src/main/lib/userDataADO/types/profile.ts`
2. `src/main/lib/userDataADO/profileCacheManager.ts`

Hooks follow the same persistence authority pattern as MCP servers and Skills: the Hook *list* is extracted out of `profile.json` into a standalone `hooks.json`, owned end-to-end by `HooksConfigManager` (`src/main/lib/userDataADO/hooksConfigManager.ts`), which is the single source of truth and the only writer of `hooks.json` (low-level read/serialize/migrate live in `hooksFileStore.ts`). Only the hook list moves; the Hooks master switch (`ProfileV2.hooksEnabled`) intentionally stays in `profile.json`. At load time `ProfileCacheManager` hydrates the list from `hooks.json`, strips `ProfileV2.hooks` from the cached/persisted profile, and re-injects it into the renderer payload via `hooksConfigManager.getHooks(alias)`.

## 4. Target Module

Add a new main-process module:

```text
src/main/lib/agentHooks/
  types.ts
  schemas.ts
  agentHookManager.ts
  agentHookResolver.ts
  agentHookExecutor.ts
  commandHookRunner.ts
  httpHookRunner.ts
  agentHookResult.ts
  ai.prompt.md
```

Responsibilities:

| File | Responsibility |
|---|---|
| `types.ts` | Hook data model, lifecycle event types, input/output types |
| `schemas.ts` | Runtime validation for persisted Hook definitions and Hook output |
| `agentHookManager.ts` | Main singleton facade used by chat runtime and profile APIs |
| `agentHookResolver.ts` | Resolve effective Hooks for an Agent from `ChatAgent.hooks` selections |
| `agentHookExecutor.ts` | Match and execute Hooks for one event, aggregate results |
| `commandHookRunner.ts` | Execute command Hooks with stdin JSON, timeout, cancellation, and output cap |
| `httpHookRunner.ts` | Execute HTTP Hooks with request validation, timeout, cancellation, and output cap |
| `agentHookResult.ts` | Output parsing and aggregation helpers |

## 5. Data Model

### 5.1 Profile Type Additions

Recommended persisted model in `src/shared/agentHooks/profileTypes.ts` and re-exported from `src/main/lib/userDataADO/types/profile.ts`:

```ts
export type AgentHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'PreCompact'
  | 'PostCompact';

export interface CommandHookAction {
  type: 'command';
  if?: string; // permission-rule condition (e.g. `execute_command(rm *)`); tool events only
  command: string;
  args?: string[];
  timeout?: number; // seconds, clamped to 600
  async?: boolean;
}

export interface HttpHookAction {
  type: 'http';
  if?: string; // permission-rule condition (e.g. `execute_command(rm *)`); tool events only
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // seconds, clamped to 600
}

export type HookAction =
  | CommandHookAction
  | HttpHookAction;

export interface HookDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  remoteVersion?: string;
  source: 'IN-LIBRARY' | 'ON-DEVICE';
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  action: HookAction;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileV2 {
  hooks?: HookDefinition[];
}

export interface ChatAgent {
  hooks?: string[]; // selected HookDefinition ids
}
```

Both renderer/IPC validation and profile read/write sanitization enforce the same timeout cap. Runtime resolution also clamps official `timeout` seconds and legacy `timeoutMs` to 600 seconds so synced/imported/manual profile data cannot bypass the safety limit.

Each Hook binds exactly one `event`, one optional `matcher`, and one `action`
(flat shape — there are no `events[]` / `actions[]` arrays). A profile that needs
several event/action bindings stores several `HookDefinition` entries. Imported,
programmatic, and Settings-authored Hooks all use this same one-event/one-action
shape, so review surfaces render a single operation per Hook.

Hooks retain the shared `version`, `source`, and optional `remoteVersion` fields
for persisted-schema compatibility. Hooks authored through Settings or
`manage_hooks` always use `source: 'ON-DEVICE'`, `version: '1.0.0'`, and
`remoteVersion: ''`. `sanitizeHooks` backfills these defaults on every read/write,
and `isValidHookDefinition` validates the persisted shape at the CRUD boundary.
These fields are descriptive only: Hook management performs no network access,
update checks, source precedence, or merge behavior.

The optional `action.if` is a permission-rule condition
(`Tool(pattern)` or a bare `Tool`). It is a best-effort filter evaluated by the
executor **only on tool events** (`PreToolUse`, `PostToolUse`,
`PostToolUseFailure`); on any other event an action that sets `if` never runs.
Tool names must match actual OpenKosmos tool names (e.g., `execute_command`,
`edit_file`, `read_file`). Tools with a `command` field (e.g., `execute_command`)
match command patterns — leading `VAR=value` assignments are stripped,
`&& || ; |` and newlines split subcommands, `$()`/backtick inner commands are
extracted, and glob wildcards are supported. Other tools match against file-path
fields (`file_path`, `path`, `notebook_path`) using glob patterns.

### 5.2 Integrity Ensure

The hook list is no longer backfilled onto `profile.json`. Instead, at profile load `ProfileCacheManager` calls `hooksConfigManager.resolveFromDisk(alias, legacyHookSlice)` to hydrate `hooks.json` into memory. A legacy profile that still carries an inline `profile.hooks` slice is migrated once: the slice is split into `hooks.json` and the legacy field is stripped from `profile.json` (`needsProfileRewrite`). A missing or corrupt `hooks.json` is treated as an empty library (the corrupt file is backed up first).

The only profile-level field that must still be backfilled is the master switch, which defaults to disabled:

```ts
profile.hooksEnabled ??= false;
```

### 5.3 Agent Selection Identity

Selection key:

1. `ChatAgent.hooks`: stores stable `HookDefinition.id` values on the Agent, mirroring `ChatAgent.skills` and `ChatAgent.mcp_servers`.

## 6. Effective Hook Resolution

### 6.1 Resolver Input

The resolver needs:

1. current user alias
2. active Agent config
3. global Hook library (`hooksConfigManager.getHooks(alias)`, backed by `hooks.json`)

### 6.2 Resolver Algorithm

```text
load global hooks (hooks.json via hooksConfigManager.getHooks)
load active Agent's ChatAgent.hooks
filter enabled hooks
for each hook:
  include if ChatAgent.hooks contains hook.id
deduplicate by hook.id
return effective hooks
```

No source merge or precedence logic is allowed.

### 6.3 Event Matching

After effective Hooks are resolved, event matching is:

```text
effective hooks
  -> filter by lifecycle event (hook.event)
  -> filter by matcher (hook.matcher)
  -> filter by action.if (tool events only)
  -> execute matching action
```

Matcher rules:

1. empty or `*` matches all
2. plain text matches exact normalized query
3. `A|B|C` matches any exact value
4. regex is supported for advanced cases

Recommended event match queries:

| Event | Match query |
|---|---|
| `SessionStart` | `trigger` |
| `UserPromptSubmit` | no default matcher in MVP |
| `PreToolUse` | `tool_name` |
| `PostToolUse` | `tool_name` |
| `PostToolUseFailure` | `tool_name` |

## 7. Hook Runtime API

Recommended narrow facade:

```ts
export interface AgentHookRunContext {
  userAlias: string;
  chatId: string;
  chatSessionId: string;
  agentId: string;
  agentName: string;
  workspacePath?: string;
  signal?: AbortSignal;
}

export class AgentHookManager {
  static getInstance(): AgentHookManager;

  resolveHooksForAgent(context: AgentHookRunContext): EffectiveHook[];

  runHooks(
    event: AgentHookEvent,
    input: AgentHookInput,
    context: AgentHookRunContext,
  ): Promise<AggregatedHookResult>;
}
```

In the MVP profile schema, `ChatAgent` does not have its own stable persisted id, so the chat-scoped id (`chatId`) identifies the active AgentChat instance. The hook input's `chat_id` (and `OPENKOSMOS_CHAT_ID`) carry this id; `agent_id` (and `OPENKOSMOS_AGENT_ID`) are retained as **deprecated** aliases of the same value for backward compatibility with existing hook scripts. `agentName` / `agent_name` carry the mutable display name.

`AgentChatTurnRunner` should only call `runHooks(...)`; it should not know how Hooks are persisted or resolved.

## 8. Hook Input Types

### 8.1 Base Input

```ts
interface BaseAgentHookInput {
  hook_event_name: AgentHookEvent;
  user_alias: string;
  chat_id: string;
  chat_session_id: string;
  /** @deprecated legacy alias of chat_id (kept for compatibility) */
  agent_id: string;
  agent_name: string;
  cwd?: string;
}
```

`agent_id` is a **deprecated** alias of `chat_id` — the same stable chat-scoped runtime id as `AgentHookRunContext.chatId`; prefer `chat_id`. `agent_name` remains the user-visible Agent display name.

### 8.2 Event-Specific Inputs

```ts
interface SessionStartHookInput extends BaseAgentHookInput {
  hook_event_name: 'SessionStart';
  trigger: 'new' | 'resume' | 'retry';
}

interface UserPromptSubmitHookInput extends BaseAgentHookInput {
  hook_event_name: 'UserPromptSubmit';
  prompt: unknown;
}

interface PreToolUseHookInput extends BaseAgentHookInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
}

interface PostToolUseHookInput extends BaseAgentHookInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
}

interface PostToolUseFailureHookInput extends BaseAgentHookInput {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  error: string;
  is_interrupt?: boolean;
  is_timeout?: boolean;
}
```

## 9. Hook Output Protocol

### 9.1 Schema

```ts
interface HookJsonOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

type HookSpecificOutput =
  | {
      hookEventName: 'SessionStart';
      additionalContext?: string;
    }
  | {
      hookEventName: 'UserPromptSubmit';
      additionalContext?: string;
    }
  | {
      hookEventName: 'PreToolUse';
      additionalContext?: string;
      updatedInput?: Record<string, unknown>;
      permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
      permissionDecisionReason?: string;
    }
  | {
      hookEventName: 'PostToolUse';
      additionalContext?: string;
      updatedToolOutput?: unknown;
      updatedMCPToolOutput?: unknown;
    }
  | {
      hookEventName: 'PostToolUseFailure';
      additionalContext?: string;
    }
  | {
      hookEventName: 'Stop';
      additionalContext?: string;
    }
  | {
      hookEventName: 'PreCompact';
      additionalContext?: string;
    }
  | {
      hookEventName: 'PostCompact';
      additionalContext?: string;
    };
```

### 9.2 Aggregated Result

```ts
interface AggregatedHookResult {
  preventContinuation?: boolean;
  stopReason?: string;
  blockingError?: string;
  additionalContexts?: string[];
  updatedInput?: Record<string, unknown>;
  updatedToolOutput?: unknown;
  updatedMCPToolOutput?: unknown;
  approvalDecision?: 'allow' | 'ask';
  approvalDecisionReason?: string;
  systemMessages?: string[];
}
```

### 9.3 Aggregation Rules

1. Any `continue:false` prevents continuation.
2. Any `decision:block` blocks the current operation.
3. `additionalContext` values are collected in execution order.
4. `updatedInput` uses the last successful Hook that returns it.
5. `updatedMCPToolOutput` uses the last successful Hook that returns it.
6. Malformed JSON is a non-blocking Hook error unless the command exits with a blocking exit code and event semantics allow blocking.
7. `permissionDecision` is reduced to `approvalDecision`: `allow` grants an automatic
   approval, while `ask` is dominant over `allow` and forces a user-facing
   confirmation prompt. `deny` is handled as a block, and `defer` leaves
   `approvalDecision` undefined (the tool follows the normal approval flow). The
   first non-empty `permissionDecisionReason` from an `ask` Hook is captured into
   `approvalDecisionReason` and shown in the confirmation prompt.

## 10. Command Hook Runner

### 10.1 Execution Requirements

Command Hooks must:

1. spawn a child process without blocking the Electron main process
2. write Hook input JSON to stdin
3. collect stdout and stderr with a fixed output cap
4. enforce timeout
5. support cancellation through `AbortSignal`
6. return structured execution result
7. avoid leaking sensitive payloads into logs

Recommended default values:

```ts
const DEFAULT_HOOK_TIMEOUT_MS = 600_000;
const USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS = 30_000;
const MAX_HOOK_OUTPUT_BYTES = 256 * 1024;
```

### 10.2 Environment

Recommended environment variables:

```text
OPENKOSMOS_HOOK_EVENT
OPENKOSMOS_USER_ALIAS
OPENKOSMOS_CHAT_ID
OPENKOSMOS_CHAT_SESSION_ID
OPENKOSMOS_AGENT_ID            # deprecated alias of OPENKOSMOS_CHAT_ID
OPENKOSMOS_AGENT_NAME
OPENKOSMOS_WORKSPACE_PATH
OPENKOSMOS_HOOKS_ARTIFACTS_PATH
```

`OPENKOSMOS_WORKSPACE_PATH` points at the Agent's current workspace path; `OPENKOSMOS_HOOKS_ARTIFACTS_PATH` points at a per-profile directory (`<userData>/profiles/<alias>/hooks-artifacts`) intended for user-managed Hook scripts and Hook-produced artifacts. The directory is created on first use. Both values are also accepted as `${OPENKOSMOS_WORKSPACE_PATH}` / `${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}` placeholders inside the command string and exec-form `args` — substituted values inside shell-form commands are platform-quoted before being handed to `shell: true`.

### 10.3 Security Validation

Command Hook execution must use a shared command validation policy or a dedicated helper aligned with existing `execute_command` safety rules.

The runner must reject:

1. empty commands
2. known destructive shell patterns
3. commands blocked by workspace trust or app-level Hook settings

## 11. Agent Loop Integration

### 11.1 `SessionStart`

Recommended location:

1. `AgentChat` first-turn setup before prompt assembly.

Flow:

```text
if session start Hooks not fired:
  run SessionStart Hooks
  append additionalContexts into current turn system context
```

### 11.2 `UserPromptSubmit`

Recommended location:

1. `AgentChat.streamMessage()`
2. before `addMessageToSession(userMessage)`

Flow:

```text
run UserPromptSubmit Hooks
if blocked:
  do not persist user message
  surface block reason
else:
  add additional context for next prompt assembly
  persist user message
```

### 11.3 `PreToolUse`

Recommended location:

1. `AgentChatTurnRunner.handleToolCalls()`
2. after tool call arguments are parseable
3. before `batchValidateAndRequestApproval(...)`

Flow:

```text
parse tool input
run PreToolUse Hooks
if blocked:
  persist blocked tool result
  continue Agent Loop
if updatedInput:
  replace tool call args
  run security approval on updated input
if approvalDecision == 'ask':
  force a user confirmation prompt (independent of the normal/bypass approval path)
  reject the tool call when the prompt is declined or cannot be delivered (fail closed)
execute tool
```

The security approval must run after Hook updates, not before.

An `ask` decision is enforced even when the agent's normal approval path is a
bypass-all stub: ask-flagged tool calls are excluded from the batch approval input
and routed through `requestHookApprovalInteraction(...)`, which drives the
interaction layer directly. If no UI receiver is available or the interaction is
blocked by policy, the tool call is rejected (fail closed). The confirmation
message uses the Hook's `permissionDecisionReason` when present, otherwise a
default prompt that names the tool.

### 11.4 `PostToolUse`

Recommended location:

1. `AgentChatTurnRunner.handleToolCalls()`
2. after `executeToolCall(...)`
3. before `postProcessToolResult(...)`

Flow:

```text
toolResult = executeToolCall(...)
run PostToolUse Hooks with tool input and output
if updatedMCPToolOutput:
  toolResult = updatedMCPToolOutput
postProcessToolResult(...)
persist tool result
```

### 11.5 `PostToolUseFailure`

Recommended location:

1. `AgentChatTurnRunner.handleToolCalls()` catch path
2. before `persistToolExecutionFailure(...)`

Flow:

```text
catch tool error
run PostToolUseFailure Hooks
include additionalContexts in failure content or next model context
persist tool failure
```

## 12. Profile Cache Manager Integration

Add helpers to `ProfileCacheManager`:

```ts
getHooks(alias: string): HookDefinition[];
addHook(alias: string, hook: HookDefinition): Promise<void>;
updateHook(alias: string, hookId: string, patch: Partial<HookDefinition>): Promise<void>;
deleteHook(alias: string, hookId: string): Promise<void>;
isHooksEnabled(alias: string): boolean;
setHooksEnabled(alias: string, enabled: boolean): Promise<void>;
```

Hook *list* helpers (`getHooks` / `addHook` / `updateHook` / `deleteHook`) delegate to `HooksConfigManager` and must:

1. gate on profile existence (`ensureProfileLoadedForConfigCrud`), which also seeds the manager from disk
2. write **only** `hooks.json` through `HooksConfigManager` (never `profile.json`)
3. call `notifyProfileDataManager()` so the renderer cache refreshes

Master-switch helpers (`isHooksEnabled` / `setHooksEnabled`) are the exception: `hooksEnabled` stays in `profile.json`, so `setHooksEnabled` still takes the profile write lock and persists through the profile write path, preserving existing profile normalization rules.

## 13. IPC and Renderer Surfaces

Use the type-safe IPC framework for new Hook APIs.

Suggested shared contract:

```ts
interface AgentHooksIpc {
  listHooks(): Promise<HookDefinition[]>;
  createHook(input: CreateHookInput): Promise<HookDefinition>;
  updateHook(hookId: string, patch: UpdateHookInput): Promise<HookDefinition>;
  deleteHook(hookId: string): Promise<void>;
  getMasterSwitch(): Promise<{ enabled: boolean }>;
  setMasterSwitch(enabled: boolean): Promise<void>;
}
```

Renderer MVP surfaces:

1. Settings Hooks collection.
2. Hook editor for one event/matcher/action per Hook.
3. Agent-side Hook selection in the Agent editor (`ChatAgent.hooks`), plus the post-create apply-to-agents dialog that writes those Agent selections.

## 14. Profile-Level Configuration

The profile-level master switch lives in `profile.json` alongside a legacy/transient `hooks` field. The two fields have different owners:

```ts
interface ProfileV2 {
  // Legacy/transient: hydrated from hooks.json at load and stripped before write.
  // Runtime reads MUST go through hooksConfigManager.getHooks(alias).
  hooks?: HookDefinition[];
  // Master switch — the source of truth, persisted in profile.json (NOT hooks.json).
  hooksEnabled?: boolean;
}
```

Default recommendation:

1. `hooksEnabled: false` for first rollout, or
2. gated by a feature flag during development.

If disabled:

1. Hooks remain editable if product wants that behavior.
2. Runtime Hook execution returns no effective Hooks.

## 15. Logging and Diagnostics

### 15.1 Resolution Logs

At turn start or first Hook execution in a turn, log:

1. `chatId`
2. `chatSessionId`
3. `agentName`
4. effective Hook count
5. matched Hook count by event

### 15.2 Execution Logs

For each Hook action, log:

1. Hook id
2. Hook name
3. event
4. matcher
5. duration
6. outcome
7. exit code if command action

Do not log full Hook input or tool payload by default.

## 16. Testing Strategy

### 16.1 Unit Tests

Add tests for:

1. direct Agent selection resolution
2. deduplication by Hook id
3. disabled Hooks are ignored
4. matcher exact, wildcard, pipe-list, and regex behavior
5. Hook output parsing
6. aggregation precedence
7. malformed JSON output
8. timeout behavior

### 16.2 Integration Tests

Add tests for:

1. `UserPromptSubmit` blocking a prompt before persistence
2. `PreToolUse` blocking a tool call
3. `PreToolUse` updating tool input and triggering security validation on updated input
4. `PostToolUse` updating tool output before persistence
5. `PostToolUseFailure` adding recovery context
6. app-level disabled switch bypassing runtime execution

### 16.3 Regression Tests

Cover:

1. an Agent does not receive Hooks selected only by other Agents
2. installing or deleting Hook definitions does not corrupt existing Agents, MCP servers, or Skills

## 17. Rollout Plan

### Phase 1: Runtime Foundation

1. Add profile types and integrity backfill.
2. Add `agentHooks` module.
3. Add command Hook runner.
4. Integrate `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `PostToolUseFailure`.
5. Add unit tests.

### Phase 2: Management UX

1. Add Settings Hooks collection.
2. Add Agent Hooks selection view.
3. Add Hook selection controls for Agents.
4. Add IPC coverage and renderer tests.

### Phase 3: Extended Actions and Events

Delivered:

1. Add HTTP Hook actions.
2. Add `Stop`, `PreCompact`, and `PostCompact` lifecycle events.

Remaining:

1. Add prompt, MCP tool, and agent verifier Hook actions if needed.
2. Add sub-agent lifecycle events if needed.

## 18. Open Questions

1. Should Hook command execution reuse `execute_command` internals directly or use a smaller dedicated runner aligned with its validation rules.
2. Should plain text stdout become `additionalContext` for some events, or should structured JSON be required for context injection.
3. Should Hook selection stay Agent-only, or should resource-scoped selection be added later.

Recommended MVP answers:

1. Use a dedicated runner with shared validation rules.
2. Require structured JSON for context injection.
3. Keep Hook selection Agent-only; add resource-scoped selection only if needed.
