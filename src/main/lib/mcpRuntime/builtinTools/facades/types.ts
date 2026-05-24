/**
 * Shared types and validation helpers for facade tools.
 *
 * Facades are thin delegation layers that translate a simplified, flat, AI-friendly
 * input schema into calls to the existing (legacy) built-in tool implementations.
 */

import { BuiltinToolDefinition } from '../types';

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
  action: 'create' | 'update' | 'remove' | 'list' | 'set_primary' | 'status';
  name?: string;
  emoji?: string;
  role?: string;
  model?: string;
  system_prompt?: string;
  workspace?: string;
  knowledge_base?: string;
  mcp_servers?: string[];
  mcp_tool_filter?: Record<string, string[]>;
  skills?: string[];
  memory_enabled?: boolean;
  greeting?: string;
  quick_starts?: Array<{ title: string; description: string; prompt: string }>;
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
