/**
 * Hook executor (tech-doc §6.3): for a single lifecycle event, match the
 * effective Hooks' actions, run them with a bounded synchronous fan-out, and
 * aggregate the outcome in deterministic match order. `async` actions are
 * fire-and-forget. The command runner is injectable so the executor can be unit
 * tested without spawning processes.
 */

import { createLogger } from '../unifiedLogger';
import { aggregateHookOutcomes, parseHookOutput } from './agentHookResult';
import type { HookActionOutcome } from './agentHookResult';
import { matchActionsForEvent } from './agentHookResolver';
import { evaluateHookIfCondition } from './hookIfMatcher';
import { runCommandHook } from './commandHookRunner';
import { runHttpHook } from './httpHookRunner';
import type { CommandHookEnv } from './commandHookRunner';
import type {
  AgentHookEvent,
  AgentHookInput,
  AggregatedHookResult,
  CommandHookAction,
  CommandHookResult,
  EffectiveHook,
  HookAction,
  HttpHookAction,
} from './types';

const logger = createLogger();
const MAX_SYNC_HOOK_ACTIONS_PER_EVENT = 8;

/** Return the first non-empty trimmed line of `text`, or '' when there is none. */
function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function uniqueQueries(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value && !seen.has(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * Map a single command/HTTP result to an aggregation outcome, honoring the
 * official exit-code and stdout-context protocol:
 *   - Exit code 2 is a blocking error: stdout/JSON is ignored and stderr (its
 *     first non-empty line) becomes the block reason.
 *   - Otherwise, valid JSON stdout is parsed as structured output.
 *   - Otherwise, plain stdout is ignored; context injection requires structured
 *     JSON with hookSpecificOutput.additionalContext.
 */
function buildActionOutcome(event: AgentHookEvent, result: CommandHookResult): HookActionOutcome {
  if (result.exitCode === 2) {
    const reason = firstNonEmptyLine(result.stderr) || 'Hook blocked the operation (exit code 2)';
    return { success: false, json: { decision: 'block', reason } };
  }

  if (!result.success) {
    return { success: false };
  }

  const parsed = result.stdout ? parseHookOutput(result.stdout) : {};
  if (parsed.json) {
    return { success: result.success, json: parsed.json };
  }

  return { success: true };
}

/** Signature of the command runner, exposed for dependency injection in tests. */
export type CommandRunner = (
  action: CommandHookAction,
  input: AgentHookInput,
  envCtx: CommandHookEnv,
  signal?: AbortSignal,
) => Promise<CommandHookResult>;

/** Signature of the HTTP runner, exposed for dependency injection in tests. */
export type HttpRunner = (
  action: HttpHookAction,
  input: AgentHookInput,
  envCtx: CommandHookEnv,
  signal?: AbortSignal,
) => Promise<CommandHookResult>;

/**
 * The value a matcher is tested against for a given event:
 *   - SessionStart -> official source + legacy trigger aliases
 *   - tool events  -> the tool name
 *   - all others (UserPromptSubmit / Stop / compact) -> none (matchers match all)
 */
export function getMatchQueryForInput(input: AgentHookInput): string | string[] | undefined {
  switch (input.hook_event_name) {
    case 'SessionStart': {
      const source = input.source;
      const legacyTrigger = input.trigger;
      const sourceAlias = legacyTrigger === 'new' ? 'startup' : legacyTrigger;
      const legacyAlias = source === 'startup' ? 'new' : source;
      const queries = uniqueQueries([source, legacyTrigger, sourceAlias, legacyAlias]);
      return queries.length <= 1 ? queries[0] : queries;
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return input.tool_name;
    default:
      return undefined;
  }
}

export async function executeHooksForEvent(
  event: AgentHookEvent,
  input: AgentHookInput,
  effectiveHooks: EffectiveHook[],
  envCtx: CommandHookEnv,
  signal?: AbortSignal,
  runner: CommandRunner = runCommandHook,
  httpRunner: HttpRunner = runHttpHook,
): Promise<AggregatedHookResult> {
  const matchQuery = getMatchQueryForInput(input);
  const matched = matchActionsForEvent(effectiveHooks, event, matchQuery)
    .filter(({ action }) => evaluateHookIfCondition(action.if, input));
  if (matched.length === 0) {
    return {};
  }

  const runAction = (action: HookAction): Promise<CommandHookResult> =>
    action.type === 'http'
      ? httpRunner(action, input, envCtx, signal)
      : runner(action, input, envCtx, signal);

  if (signal?.aborted) {
    return {};
  }

  const syncActions = [];
  for (const matchedAction of matched) {
    const { hookId, hookName, action } = matchedAction;
    if (action.async) {
      void runAction(action)
        .then(result => {
          if (!result.success) {
            logger.warn(`[AgentHooks] Async hook "${hookName}" (${hookId}) ${event} failed: ${result.error ?? 'unknown'}`);
          }
        })
        .catch(err => {
          logger.error(`[AgentHooks] Async hook "${hookName}" (${hookId}) ${event} error: ${err instanceof Error ? err.message : String(err)}`);
        });
      continue;
    }
    if (syncActions.length < MAX_SYNC_HOOK_ACTIONS_PER_EVENT) {
      syncActions.push(matchedAction);
    } else {
      logger.warn(`[AgentHooks] Skipping hook action "${hookName}" (${hookId}) ${event}: per-event sync action limit reached`);
    }
  }

  const results = await Promise.all(syncActions.map(async ({ hookId, hookName, matcher, action }) => {
    const result = await runAction(action);
    logger.info('[AgentHooks] Executed hook action', 'executeHooksForEvent', {
      hookId,
      hookName,
      event,
      matcher,
      durationMs: result.durationMs,
      success: result.success,
      exitCode: result.exitCode ?? null,
    });
    return result;
  }));
  const outcomes = results.map(result => buildActionOutcome(event, result));

  return aggregateHookOutcomes(outcomes);
}
