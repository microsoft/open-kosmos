/**
 * Runtime validation guards for Agent Hooks.
 *
 * Used to (1) reject malformed Hook definitions before they are persisted via
 * the profile CRUD layer, and (2) defensively validate Hook command stdout that
 * claims to be structured JSON output. Deep structural normalization of persisted
 * Hooks is owned by `profileSanitizer.sanitizeHooks`; these guards are a lighter
 * boolean check used at the API and runtime boundaries.
 */

import type {
  AgentHookEvent,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  HookDefinition,
  HookJsonOutput,
} from './types';

const VALID_EVENTS: ReadonlySet<AgentHookEvent> = new Set<AgentHookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
]);

const VALID_HTTP_METHODS: ReadonlySet<HttpHookMethod> = new Set<HttpHookMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(entry => typeof entry === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** True when `value` is a structurally valid command Hook action. */
export function isCommandHookAction(value: unknown): value is CommandHookAction {
  if (!isRecord(value)) return false;
  if (value.type !== 'command') return false;
  if (!isNonEmptyString(value.command)) return false;
  if (value.if !== undefined && typeof value.if !== 'string') return false;
  if (value.args !== undefined && !isStringArray(value.args)) return false;
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || value.timeout <= 0)) {
    return false;
  }
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || value.timeoutMs <= 0)) {
    return false;
  }
  if (value.async !== undefined && typeof value.async !== 'boolean') return false;
  return true;
}

/** True when `value` is a structurally valid HTTP Hook action. */
export function isHttpHookAction(value: unknown): value is HttpHookAction {
  if (!isRecord(value)) return false;
  if (value.type !== 'http') return false;
  if (!isNonEmptyString(value.url)) return false;
  if (value.if !== undefined && typeof value.if !== 'string') return false;
  if (value.method !== undefined && !VALID_HTTP_METHODS.has(value.method as HttpHookMethod)) return false;
  if (value.headers !== undefined && !isStringRecord(value.headers)) return false;
  if (value.body !== undefined && typeof value.body !== 'string') return false;
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || value.timeout <= 0)) {
    return false;
  }
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || value.timeoutMs <= 0)) {
    return false;
  }
  if (value.async !== undefined && typeof value.async !== 'boolean') return false;
  return true;
}

/** True when `value` is any structurally valid Hook action. */
export function isHookAction(value: unknown): value is CommandHookAction | HttpHookAction {
  return isCommandHookAction(value) || isHttpHookAction(value);
}

/** True when `value` is a structurally valid, persistable Hook definition. */
export function isValidHookDefinition(value: unknown): value is HookDefinition {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.name !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (typeof value.version !== 'string') return false;
  if (value.remoteVersion !== undefined && typeof value.remoteVersion !== 'string') return false;
  if (value.source !== 'IN-LIBRARY' && value.source !== 'ON-DEVICE') return false;
  if (typeof value.enabled !== 'boolean') return false;
  if (typeof value.event !== 'string' || !VALID_EVENTS.has(value.event as AgentHookEvent)) return false;
  if (value.matcher !== undefined && typeof value.matcher !== 'string') return false;
  return isHookAction(value.action);
}

/** True when `value` matches the Hook JSON output protocol shape. */
export function isHookJsonOutput(value: unknown): value is HookJsonOutput {
  if (!isRecord(value)) return false;
  if (value.continue !== undefined && typeof value.continue !== 'boolean') return false;
  if (value.suppressOutput !== undefined && typeof value.suppressOutput !== 'boolean') return false;
  if (value.stopReason !== undefined && typeof value.stopReason !== 'string') return false;
  if (value.decision !== undefined && value.decision !== 'approve' && value.decision !== 'block') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (value.systemMessage !== undefined && typeof value.systemMessage !== 'string') return false;
  if (value.hookSpecificOutput !== undefined && !isRecord(value.hookSpecificOutput)) return false;
  return true;
}
