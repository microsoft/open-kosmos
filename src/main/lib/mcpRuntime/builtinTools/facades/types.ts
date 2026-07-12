/**
 * Shared types and validation helpers for facade tools.
 *
 * Facades are thin delegation layers that translate a simplified, flat, AI-friendly
 * input schema into calls to the existing (legacy) built-in tool implementations.
 */

import { BuiltinToolDefinition } from '../types';
import type { AgentHookEvent, HttpHookMethod } from '../../../../../shared/agentHooks/profileTypes';
import type { AgentSystemPrompt } from '../../../../../shared/types/agentSystemPrompt';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Standardised success / error envelope returned by every facade action. */
export interface FacadeResult {
  success: boolean;
  message: string;
  error?: string;
  /** Hint shown to AI on how to fix the error. */
  hint?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ManageSkillsInput {
  action: 'install' | 'uninstall' | 'bind' | 'unbind';
  skill_names: string[];
  source?: 'device';
  path?: string;
  agent_names?: string[];
  all_agents?: boolean;
}

export interface ManageMcpInput {
  action: 'add' | 'update' | 'remove' | 'connect' | 'disconnect' | 'reconnect' | 'status';
  name: string;
  transport?: 'stdio' | 'sse' | 'StreamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface ManageAgentsInput {
  action: 'create' | 'update' | 'list' | 'set_primary' | 'status';
  name?: string;
  emoji?: string;
  role?: string;
  model?: string;
  system_prompt?: AgentSystemPrompt | string;
  agent_identity_prompt?: string;
  project_context_prompt?: string;
  knowledge_base?: string;
  mcp_servers?: string[];
  mcp_servers_mode?: 'merge' | 'replace';
  mcp_tool_filter?: Record<string, string[]>;
  skills?: string[];
  skills_mode?: 'merge' | 'replace';
  hooks?: string[];
  hooks_mode?: 'merge' | 'replace';
  greeting?: string;
  quick_starts?: Array<{ id?: string; title: string; description: string; prompt: string }>;
  quick_starts_mode?: 'merge' | 'replace';
}

export interface ManageHooksInput {
  action:
    | 'status'
    | 'list'
    | 'create'
    | 'update'
    | 'delete'
    | 'disable';
  hook_id?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  event?: AgentHookEvent;
  matcher?: string;
  action_type?: 'command' | 'http';
  if?: string;
  command?: string;
  args?: string[];
  url?: string;
  method?: HttpHookMethod;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  timeoutMs?: number;
  async?: boolean;
}

export interface SearchMcpInput {
  query?: string;
  installed?: boolean;
}

export interface SearchAgentsInput {
  query?: string;
  installed?: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationOk {
  ok: true;
}

export interface ValidationFail {
  ok: false;
  message: string;
  hint?: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

export function ok(): ValidationOk {
  return { ok: true };
}

export function fail(message: string, hint?: string): ValidationFail {
  return { ok: false, message, hint };
}

export function errorResult(message: string, hint?: string): FacadeResult {
  return { success: false, message, error: message, hint };
}

/**
 * Normalise and deduplicate a string array (trimmed, non-empty, unique).
 */
export function normalizeStringArray(arr?: string[]): string[] {
  if (!arr || !Array.isArray(arr)) return [];
  return Array.from(
    new Set(
      arr
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean),
    ),
  );
}

// Re-export for convenience
export type { BuiltinToolDefinition };
