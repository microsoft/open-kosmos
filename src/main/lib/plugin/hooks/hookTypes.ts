/**
 * Hook type definitions for the OpenKosmos plugin hook system.
 *
 * Compatible with Claude Code hook output protocol:
 *   - Hooks output JSON to stdout
 *   - `hookSpecificOutput.additionalContext` is injected into the conversation
 *   - Top-level `additionalContext` (Copilot CLI format) is also supported
 *   - `additional_context` (Cursor format) is also supported
 */

import type { HookEvent, HookCommand } from '../types';

export type { HookEvent, HookCommand };

/** Context passed to SessionStart hooks. */
export interface SessionStartContext {
  userAlias: string;
  chatId: string;
  chatSessionId: string;
  agentName?: string;
  /** Agent workspace path (project directory), if configured. */
  workspacePath?: string;
}

/** Union of all hook context types (will grow as more events are added). */
export type HookContext = SessionStartContext;

// ---- Hook JSON Output (Claude Code compatible) ----------------------------

/**
 * The JSON structure a hook command can write to stdout.
 * Supports three platforms' output formats:
 *
 * 1. Claude Code:  `{ hookSpecificOutput: { additionalContext: "..." } }`
 * 2. Copilot CLI:  `{ additionalContext: "..." }`
 * 3. Cursor:       `{ additional_context: "..." }`
 */
export interface HookJsonOutput {
  /** Whether the hook should continue (Claude Code protocol). */
  continue?: boolean;
  /** Suppress stdout from being logged. */
  suppressOutput?: boolean;
  /** Message shown when continue is false. */
  stopReason?: string;

  // --- Claude Code nested format ---
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    initialUserMessage?: string;
  };

  // --- Copilot CLI top-level format ---
  additionalContext?: string;

  // --- Cursor snake_case format ---
  additional_context?: string;
}

/** Result from executing a single hook command. */
export interface HookCommandResult {
  success: boolean;
  /** stdout from the command (if type === 'command'). */
  output?: string;
  error?: string;
  /** Wall-clock execution time in ms. */
  durationMs: number;
  /** Parsed additional context from hook JSON output. */
  additionalContext?: string;
}

/** Aggregated result from executing all hooks for an event. */
export interface HookExecutionResult {
  event: HookEvent;
  results: HookCommandResult[];
  /** True if all hooks succeeded (or there were no hooks). */
  allSucceeded: boolean;
  /** Collected additionalContext strings from all hooks that provided them. */
  additionalContexts: string[];
}
