/** Lifecycle boundaries at which a Hook can run. */
export type AgentHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'PreCompact'
  | 'PostCompact';

/** Command-based Hook action. */
export interface CommandHookAction {
  type: 'command';
  /**
   * Permission-rule condition such as `execute_command(rm *)` or
   * `edit_file(*.ts)`. Tool names must match actual OpenKosmos tool names. Only
   * evaluated on tool events (PreToolUse, PostToolUse, PostToolUseFailure); on
   * other events a hook with `if` set never runs.
   */
  if?: string;
  command: string;
  args?: string[];
  timeout?: number;
  timeoutMs?: number;
  async?: boolean;
}

export type HttpHookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** HTTP-based Hook action. */
export interface HttpHookAction {
  type: 'http';
  /** See {@link CommandHookAction.if}. */
  if?: string;
  url: string;
  method?: HttpHookMethod;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  timeoutMs?: number;
  async?: boolean;
}

export type HookAction = CommandHookAction | HttpHookAction;

/**
 * Reusable profile-level Hook definition.
 *
 * A Hook binds exactly one lifecycle `event` (optionally narrowed by `matcher`)
 * to exactly one `action`. Hooks are bound to Agents from the Agent side
 * (`ChatAgent.hooks: string[]`), mirroring how Skills and MCP servers are
 * selected per Agent. A Hook therefore carries no binding state of its own.
 *
 * Provenance/versioning fields remain compatible with older profiles. New
 * hooks are local; legacy values are retained without remote lookups.
 */
export interface HookDefinition {
  id: string;
  name: string;
  description?: string;
  /** Local version number, mirroring SkillConfig/McpServerConfig. */
  version: string;
  /** Legacy remote version retained for profile compatibility. */
  remoteVersion?: string;
  /** Hook source; newly created hooks are ON-DEVICE. */
  source: 'IN-LIBRARY' | 'ON-DEVICE';
  enabled: boolean;
  event: AgentHookEvent;
  /** Optional tool-name / source filter for the event. Empty or `*` matches all. */
  matcher?: string;
  action: HookAction;
  createdAt: string;
  updatedAt: string;
}
