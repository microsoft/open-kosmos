/**
 * Effective Hook resolution and event/matcher matching (tech-doc §6).
 *
 * Resolution uses the active Agent's selected Hook ids (`ChatAgent.hooks`) — no
 * source precedence or multi-level merge. Execution order is deterministic:
 * profile `hooks[]` order, first-occurrence wins for id dedupe. Each Hook binds
 * one event/matcher to one action, so matching is a flat filter. This ordering
 * is what makes "last successful action wins" aggregation well-defined.
 */

import type { AgentHookEvent, EffectiveHook, HookAction, HookDefinition } from './types';

/** The Agent-scoped inputs the resolver matches Hooks against. */
export interface ResolverAgentContext {
  /** Hook ids selected on the active Agent (`ChatAgent.hooks`). */
  hookIds: string[];
}

/** A single action matched for an event, tagged with its owning Hook id. */
export interface MatchedAction {
  hookId: string;
  hookName: string;
  matcher?: string;
  action: HookAction;
}

/**
 * Resolve the Hooks effective for an Agent from the Hook ids the Agent selected.
 * Disabled Hooks are skipped; results are deduplicated by Hook id (first wins).
 */
export function resolveEffectiveHooks(
  hooks: HookDefinition[] | undefined,
  ctx: ResolverAgentContext,
): EffectiveHook[] {
  if (!Array.isArray(hooks)) return [];
  const selected = new Set(Array.isArray(ctx.hookIds) ? ctx.hookIds : []);
  if (selected.size === 0) return [];

  const seen = new Set<string>();
  const effective: EffectiveHook[] = [];

  for (const hook of hooks) {
    if (!hook || hook.enabled !== true || typeof hook.id !== 'string') continue;
    if (seen.has(hook.id)) continue;
    if (!selected.has(hook.id)) continue;

    seen.add(hook.id);
    effective.push(hook);
  }

  return effective;
}

/**
 * Decide whether a matcher applies to an event's match query.
 *   - empty or '*' matches everything
 *   - plain text, including dotted tool names, uses exact or pipe-list match
 *   - regex-looking matchers are treated as JavaScript regular expressions
 */
export function matchesMatcher(matcher: string | undefined, query: string | undefined): boolean {
  const normalizedMatcher = (matcher ?? '').trim();
  if (normalizedMatcher === '' || normalizedMatcher === '*') return true;

  const normalizedQuery = (query ?? '').trim();

  const looksLikeRegex =
    normalizedMatcher.startsWith('^') ||
    normalizedMatcher.endsWith('$') ||
    normalizedMatcher.includes('.*') ||
    /[()[\]{}+?\\]/.test(normalizedMatcher);

  if (!looksLikeRegex) {
    const options = normalizedMatcher.split('|').map(part => part.trim()).filter(Boolean);
    return options.includes(normalizedQuery);
  }

  try {
    return new RegExp(normalizedMatcher).test(normalizedQuery);
  } catch {
    return false;
  }
}

function matchesAnyQuery(matcher: string | undefined, query: string | string[] | undefined): boolean {
  if (Array.isArray(query)) {
    return query.some(item => matchesMatcher(matcher, item));
  }
  return matchesMatcher(matcher, query);
}

/**
 * Flatten effective Hooks into the ordered list of actions matching one event
 * and (optionally) a match query (e.g. tool name, or SessionStart trigger).
 */
export function matchActionsForEvent(
  effectiveHooks: EffectiveHook[],
  event: AgentHookEvent,
  matchQuery?: string | string[],
): MatchedAction[] {
  const matched: MatchedAction[] = [];
  for (const hook of effectiveHooks) {
    if (hook.event !== event) continue;
    if (!matchesAnyQuery(hook.matcher, matchQuery)) continue;
    if (!hook.action) continue;
    matched.push({ hookId: hook.id, hookName: hook.name, matcher: hook.matcher, action: hook.action });
  }
  return matched;
}
