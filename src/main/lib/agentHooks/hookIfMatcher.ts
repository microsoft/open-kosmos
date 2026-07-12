/**
 * Evaluation of the Agent Hooks `if` permission-rule condition on Hook actions.
 *
 * `if` narrows when an action runs, beyond the event matcher. It is only
 * meaningful on tool events (PreToolUse, PostToolUse, PostToolUseFailure). On any
 * other event, an action with `if` set never runs. The filter is best-effort and
 * fails open (runs the action) when a command pattern cannot be parsed.
 *
 * Tool names in `if` conditions must match the actual tool names used in OpenKosmos
 * (e.g., `execute_command(...)`, not external aliases). Argument patterns support
 * glob matching for file paths and command string matching for command tools.
 */

import type { AgentHookEvent, AgentHookInput } from './types';

const TOOL_EVENTS: ReadonlySet<AgentHookEvent> = new Set<AgentHookEvent>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
]);

/** Tool input fields that carry a file path, matched by file-pattern `if` rules. */
const FILE_PATH_FIELDS = ['file_path', 'filePath', 'path', 'notebook_path'] as const;

/** Splits a command string into top-level segments on shell control operators. */
const COMMAND_OPERATORS = /\|\||&&|;|\||\n/;

interface ParsedIfRule {
  tool: string;
  /** Inner argument pattern, e.g. `rm *` for `execute_command(rm *)`. Undefined for a bare tool name. */
  pattern?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `Tool(pattern)` or `Tool` into its parts. Returns null when unparseable. */
export function parseIfRule(rule: string): ParsedIfRule | null {
  const trimmed = rule.trim();
  if (trimmed === '') return null;
  const open = trimmed.indexOf('(');
  if (open === -1) {
    return { tool: trimmed };
  }
  if (!trimmed.endsWith(')')) return null;
  const tool = trimmed.slice(0, open).trim();
  if (tool === '') return null;
  const pattern = trimmed.slice(open + 1, -1).trim();
  return pattern === '' ? { tool } : { tool, pattern };
}

/** Convert a glob-ish pattern (supporting `*` and `?`) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const globbed = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(`^${globbed}$`);
}

/** Strip leading `VAR=value` environment assignments from a single command. */
function stripLeadingAssignments(command: string): string {
  let rest = command.trimStart();
  for (;;) {
    const match = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+/.exec(rest);
    if (!match) break;
    rest = rest.slice(match[0].length).trimStart();
  }
  return rest;
}

/** Collect commands nested inside `$(...)` / backticks and whether the command is dynamic. */
function extractDynamicCommands(command: string): { inner: string[]; hasDynamic: boolean } {
  const inner: string[] = [];
  let hasDynamic = false;

  const dollarParen = /\$\(([^()]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = dollarParen.exec(command)) !== null) {
    hasDynamic = true;
    const captured = match[1].trim();
    if (captured) inner.push(captured);
  }

  const backtick = /`([^`]*)`/g;
  while ((match = backtick.exec(command)) !== null) {
    hasDynamic = true;
    const captured = match[1].trim();
    if (captured) inner.push(captured);
  }

  if (/\$\{?[A-Za-z_]/.test(command)) hasDynamic = true;

  return { inner, hasDynamic };
}

/** Remove embedded command substitutions so an outer command matches on its own. */
function stripSubstitutions(command: string): string {
  return command.replace(/\$\([^()]*\)/g, '').replace(/`[^`]*`/g, '').trim();
}

/**
 * Match a command string against a permission-rule pattern: leading assignments
 * are stripped, each subcommand and command substitution is checked, and patterns
 * more specific than the command name fail open on dynamic commands.
 */
export function matchesCommandPattern(command: string, pattern: string): boolean {
  if (typeof command !== 'string' || command.trim() === '') {
    return true;
  }

  const regex = globToRegExp(pattern);
  const patternIsCommandNameOnly = /^\S+(\s+\*)?$/.test(pattern.trim());
  const { inner, hasDynamic } = extractDynamicCommands(command);

  const candidates: string[] = [];
  for (const segment of command.split(COMMAND_OPERATORS)) {
    const trimmed = segment.trim();
    if (trimmed) candidates.push(stripLeadingAssignments(trimmed));
  }
  for (const innerCommand of inner) {
    candidates.push(stripLeadingAssignments(innerCommand));
  }

  for (const candidate of candidates) {
    const cleaned = stripSubstitutions(candidate);
    if (cleaned && regex.test(cleaned)) return true;
    if (candidate !== cleaned && regex.test(candidate)) return true;
  }

  return hasDynamic && !patternIsCommandNameOnly;
}

/** Match a file-path tool argument against a permission-rule pattern. */
export function matchesFilePattern(toolInput: Record<string, unknown> | undefined, pattern: string): boolean {
  if (!toolInput) return false;
  const regex = globToRegExp(pattern);
  for (const field of FILE_PATH_FIELDS) {
    const value = toolInput[field];
    if (typeof value === 'string' && regex.test(value)) return true;
  }
  return false;
}

/**
 * Decide whether an action's `if` condition allows it to run for `input`.
 * Returns true when there is no condition.
 */
export function evaluateHookIfCondition(ifRule: string | undefined, input: AgentHookInput): boolean {
  if (ifRule === undefined || ifRule.trim() === '') return true;

  if (!TOOL_EVENTS.has(input.hook_event_name)) return false;

  const parsed = parseIfRule(ifRule);
  if (!parsed) return false;

  const toolName = 'tool_name' in input && typeof input.tool_name === 'string' ? input.tool_name : '';
  if (parsed.tool !== toolName) return false;

  if (parsed.pattern === undefined) return true;

  const toolInput = 'tool_input' in input && isRecord(input.tool_input) ? input.tool_input : undefined;

  // Tools with a command field (e.g., execute_command) match against the command string
  const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : undefined;
  if (command !== undefined) {
    return matchesCommandPattern(command, parsed.pattern);
  }

  // All other tools match against file-path fields
  return matchesFilePattern(toolInput, parsed.pattern);
}
