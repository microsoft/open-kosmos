/**
 * Agent Hooks runtime types.
 *
 * See docs/agent-hooks-prd.md and docs/agent-hooks-tech-doc.md.
 *
 * The persisted resource model (HookDefinition, actions, events) lives
 * in `shared/agentHooks/profileTypes.ts` so it can be shared by profile,
 * renderer IPC, and runtime modules without pulling main code into renderer.
 * This module re-exports those persisted types and adds the runtime-only types used
 * by the resolver, executor, command runner, and Agent Loop integration.
 */

import type {
  AgentHookEvent,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  HookAction,
  HookDefinition,
} from '../../../shared/agentHooks/profileTypes';

export type {
  AgentHookEvent,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  HookAction,
  HookDefinition,
};

/** Official default timeout for command/HTTP Hooks outside UserPromptSubmit. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600_000;

/** Runtime maximum for any persisted or user-provided command/HTTP Hook timeout. */
export const MAX_HOOK_TIMEOUT_MS = DEFAULT_HOOK_TIMEOUT_MS;

/** Official shorter timeout for UserPromptSubmit command/HTTP Hooks. */
export const USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS = 30_000;

/** Maximum stdout/stderr bytes captured per command Hook. */
export const MAX_HOOK_OUTPUT_BYTES = 256 * 1024;

/** Maximum persisted `if` condition characters for one Hook action. */
export const MAX_HOOK_IF_LENGTH = 500;

/** Maximum persisted HTTP header count for one Hook action. */
export const MAX_HOOK_HTTP_HEADERS = 30;

/** Maximum persisted HTTP header key/value characters for one Hook action. */
export const MAX_HOOK_HTTP_HEADER_CHARS = 16_384;

/** Maximum persisted or runtime HTTP request body characters for one Hook action. */
export const MAX_HOOK_HTTP_BODY_LENGTH = 100_000;

/** A Hook that has been resolved as effective for the active Agent. */
export type EffectiveHook = HookDefinition;

// ─── Hook input (written to the command's stdin as JSON) ────────────────────

export interface BaseAgentHookInput {
  hook_event_name: AgentHookEvent;
  /** Standard hook field for the current chat session id. */
  session_id: string;
  /** OpenKosmos-specific user alias. */
  user_alias: string;
  chat_id: string;
  /** OpenKosmos legacy field; `session_id` is emitted alongside it for compatibility. */
  chat_session_id: string;
  /**
   * @deprecated Legacy alias of {@link BaseAgentHookInput.chat_id} — it carries
   * the chat-scoped id, not a distinct agent id (`ChatAgent` has no stable
   * persisted id). Emitted alongside `chat_id` for backward compatibility with
   * existing hook scripts; prefer `chat_id`.
   */
  agent_id: string;
  agent_name: string;
  /** Standard hook field for the agent name/type. */
  agent_type?: string;
  /** Best-effort path to the persisted transcript/session file. */
  transcript_path?: string;
  cwd?: string;
  permission_mode?: 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';
}

export interface SessionStartHookInput extends BaseAgentHookInput {
  hook_event_name: 'SessionStart';
  /** Standard hook field describing how the session was started. */
  source: 'startup' | 'resume' | 'clear' | 'compact';
  /** Legacy OpenKosmos field retained for existing hooks. */
  trigger?: 'new' | 'resume' | 'retry';
  model?: string;
  session_title?: string;
}

export interface UserPromptSubmitHookInput extends BaseAgentHookInput {
  hook_event_name: 'UserPromptSubmit';
  prompt: unknown;
}

export interface PreToolUseHookInput extends BaseAgentHookInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  /** Standard hook field alias for `tool_call_id`. */
  tool_use_id: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUseHookInput extends BaseAgentHookInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  /** Standard hook field alias for `tool_call_id`. */
  tool_use_id: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  /** Standard hook field alias for `tool_output`. */
  tool_response: unknown;
  tool_output: unknown;
}

export interface PostToolUseFailureHookInput extends BaseAgentHookInput {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  /** Standard hook field alias for `tool_call_id`. */
  tool_use_id: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  error: string;
  is_interrupt?: boolean;
  is_timeout?: boolean;
}

/**
 * Phase 3 observational events. These fire around turn completion and context
 * compaction; their Hooks may inject session-scoped `additionalContext` but
 * cannot block or mutate the operation.
 */
export interface StopHookInput extends BaseAgentHookInput {
  hook_event_name: 'Stop';
}

export interface PreCompactHookInput extends BaseAgentHookInput {
  hook_event_name: 'PreCompact';
  /** `manual` when compaction was forced, `auto` when triggered by token pressure. */
  trigger: 'auto' | 'manual';
}

export interface PostCompactHookInput extends BaseAgentHookInput {
  hook_event_name: 'PostCompact';
  /** `manual` when compaction was forced, `auto` when triggered by token pressure. */
  trigger: 'auto' | 'manual';
}

export type AgentHookInput =
  | SessionStartHookInput
  | UserPromptSubmitHookInput
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | StopHookInput
  | PreCompactHookInput
  | PostCompactHookInput;

// ─── Hook output protocol (parsed from the command's stdout) ────────────────

export type HookSpecificOutput =
  | { hookEventName: 'SessionStart'; additionalContext?: string }
  | { hookEventName: 'UserPromptSubmit'; additionalContext?: string }
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
  | { hookEventName: 'PostToolUseFailure'; additionalContext?: string }
  | { hookEventName: 'Stop'; additionalContext?: string }
  | { hookEventName: 'PreCompact'; additionalContext?: string }
  | { hookEventName: 'PostCompact'; additionalContext?: string };

export interface HookJsonOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

/** The aggregated outcome of running every matched action for one event. */
export interface AggregatedHookResult {
  /** True when any action requested `continue: false`. */
  preventContinuation?: boolean;
  /** Stop reason carried from a `continue: false` action. */
  stopReason?: string;
  /** Block reason carried from a `decision: 'block'` action. */
  blockingError?: string;
  /** Additional context strings collected in execution order. */
  additionalContexts?: string[];
  /** Updated tool input from the last successful PreToolUse action that returned it. */
  updatedInput?: Record<string, unknown>;
  /** Updated tool output from the last successful PostToolUse action that returned it. */
  updatedToolOutput?: unknown;
  /** Legacy MCP-only output replacement. Prefer `updatedToolOutput` for new hooks. */
  updatedMCPToolOutput?: unknown;
  /** Hook-driven PreToolUse approval override. */
  approvalDecision?: 'allow' | 'ask';
  /** Reason carried from a PreToolUse `ask` decision, shown in the confirmation prompt. */
  approvalDecisionReason?: string;
  /** System messages collected in execution order. */
  systemMessages?: string[];
}

// ─── Command execution ──────────────────────────────────────────────────────

/** Result of running a single command Hook action. */
export interface CommandHookResult {
  /** True when the process exited without error, timeout, or validation failure. */
  success: boolean;
  /** Raw stdout (capped at MAX_HOOK_OUTPUT_BYTES). */
  stdout: string;
  /** Raw stderr (capped at MAX_HOOK_OUTPUT_BYTES). */
  stderr: string;
  /** Process exit code, when available. */
  exitCode?: number | null;
  /** Wall-clock execution time in milliseconds. */
  durationMs: number;
  /** True when the process was killed for exceeding its timeout. */
  timedOut?: boolean;
  /** Validation or spawn error message, when the command could not run. */
  error?: string;
}

/** Context threaded from the Agent Loop into Hook resolution and execution. */
export interface AgentHookRunContext {
  userAlias: string;
  chatId: string;
  chatSessionId: string;
  agentName: string;
  /** Hook ids selected on the active Agent (`ChatAgent.hooks`). */
  hookIds: string[];
  workspacePath?: string;
  signal?: AbortSignal;
}

export function resolveHookTimeoutMs(
  action: { timeout?: number; timeoutMs?: number },
  input: Pick<AgentHookInput, 'hook_event_name'>,
): number {
  if (typeof action.timeout === 'number' && Number.isFinite(action.timeout) && action.timeout > 0) {
    return Math.min(Math.round(action.timeout * 1000), MAX_HOOK_TIMEOUT_MS);
  }
  if (typeof action.timeoutMs === 'number' && Number.isFinite(action.timeoutMs) && action.timeoutMs > 0) {
    return Math.min(action.timeoutMs, MAX_HOOK_TIMEOUT_MS);
  }
  return input.hook_event_name === 'UserPromptSubmit'
    ? USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS
    : DEFAULT_HOOK_TIMEOUT_MS;
}
