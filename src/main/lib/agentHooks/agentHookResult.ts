/**
 * Hook output parsing and aggregation helpers.
 *
 * Output protocol (tech-doc §8/§9): a command Hook may write a JSON object to
 * stdout. If stdout *starts with* a JSON object it is parsed as structured Hook
 * output (trailing log text after the object is tolerated). Otherwise stdout is
 * treated as plain text. Per the MVP decision (PRD open question #2), only
 * structured `hookSpecificOutput.additionalContext` is injected as context; plain
 * text is never turned into additional context.
 */

import { isHookJsonOutput } from './schemas';
import type { AggregatedHookResult, HookJsonOutput } from './types';

/** The outcome of one executed action: whether it ran cleanly and its parsed output. */
export interface HookActionOutcome {
  /** True when the command exited successfully (no error/timeout/validation failure). */
  success: boolean;
  /** Structured JSON output, when the command emitted a valid one. */
  json?: HookJsonOutput;
}

/**
 * Scan from the start of `text` and return the first balanced top-level JSON
 * object substring, or null when no complete object begins the string. String
 * literals and escapes are respected so braces inside strings are ignored.
 */
function extractLeadingJsonObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  return null;
}

/**
 * Parse a command's stdout into structured Hook output or plain text.
 * Malformed or non-protocol JSON falls back to plain text (non-blocking).
 */
export function parseHookOutput(stdout: string): { json?: HookJsonOutput; plainText?: string } {
  if (typeof stdout !== 'string') return {};
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  if (!trimmed.startsWith('{')) {
    return { plainText: stdout };
  }
  const candidate = extractLeadingJsonObject(trimmed);
  if (!candidate) {
    return { plainText: stdout };
  }
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (isHookJsonOutput(parsed)) {
      return { json: parsed };
    }
    return { plainText: stdout };
  } catch {
    return { plainText: stdout };
  }
}

/**
 * Fold a list of action outcomes (in execution order) into a single result.
 *
 * Aggregation rules (tech-doc §9.3):
 *   1. Any `continue: false` prevents continuation (first stopReason wins).
 *   2. Any `decision: 'block'` blocks the operation (first block reason wins).
 *   3. `additionalContext` values are collected in execution order.
 *   4. `updatedInput` uses the LAST successful action that returns it.
 *   5. `updatedToolOutput`/`updatedMCPToolOutput` use the LAST successful
 *      action that returns them.
 *   6. Malformed JSON contributes nothing (non-blocking).
 */
export function aggregateHookOutcomes(outcomes: HookActionOutcome[]): AggregatedHookResult {
  const result: AggregatedHookResult = {};
  const additionalContexts: string[] = [];
  const systemMessages: string[] = [];

  for (const { success, json } of outcomes) {
    if (!json) continue;

    if (json.continue === false) {
      result.preventContinuation = true;
      if (json.stopReason && !result.stopReason) {
        result.stopReason = json.stopReason;
      }
    }

    if (json.decision === 'block' && !result.blockingError) {
      result.blockingError = json.reason || 'Operation blocked by hook';
    }
    if (success && json.decision === 'approve' && !result.blockingError && result.approvalDecision !== 'ask') {
      result.approvalDecision = 'allow';
    }

    if (typeof json.systemMessage === 'string' && json.systemMessage) {
      systemMessages.push(json.systemMessage);
    }

    const specific = json.hookSpecificOutput;
    if (!specific) continue;

    if (typeof specific.additionalContext === 'string' && specific.additionalContext) {
      additionalContexts.push(specific.additionalContext);
    }

    if (success) {
      if (
        specific.hookEventName === 'PreToolUse' &&
        'permissionDecision' in specific &&
        typeof specific.permissionDecision === 'string'
      ) {
        const reason =
          typeof specific.permissionDecisionReason === 'string' && specific.permissionDecisionReason
            ? specific.permissionDecisionReason
            : undefined;
        if (specific.permissionDecision === 'deny' && !result.blockingError) {
          result.blockingError = reason || 'Operation blocked by hook';
        } else if (specific.permissionDecision === 'ask') {
          result.approvalDecision = 'ask';
          if (reason && !result.approvalDecisionReason) {
            result.approvalDecisionReason = reason;
          }
        } else if (specific.permissionDecision === 'allow' && result.approvalDecision !== 'ask') {
          result.approvalDecision = 'allow';
        }
      }
      if ('updatedInput' in specific && specific.updatedInput && typeof specific.updatedInput === 'object') {
        result.updatedInput = specific.updatedInput as Record<string, unknown>;
      }
      if ('updatedToolOutput' in specific && specific.updatedToolOutput !== undefined) {
        result.updatedToolOutput = specific.updatedToolOutput;
      }
      if ('updatedMCPToolOutput' in specific && specific.updatedMCPToolOutput !== undefined) {
        result.updatedMCPToolOutput = specific.updatedMCPToolOutput;
      }
    }
  }

  if (additionalContexts.length > 0) result.additionalContexts = additionalContexts;
  if (systemMessages.length > 0) result.systemMessages = systemMessages;
  return result;
}
