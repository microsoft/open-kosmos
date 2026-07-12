import { describe, it, expect } from 'vitest';

import { resolveEffectiveHooks, matchesMatcher, matchActionsForEvent } from '../agentHookResolver';
import type { ResolverAgentContext } from '../agentHookResolver';
import type { HookAction, HookDefinition } from '../types';

function hook(partial: Partial<HookDefinition> & { id: string }): HookDefinition {
  return {
    name: partial.id,
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'noop' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const ctx: ResolverAgentContext = {
  hookIds: ['a', 'dup', 'h1', 'h2', 'e', 'f'],
};

describe('resolveEffectiveHooks', () => {
  it('returns empty when hooks is not an array', () => {
    expect(resolveEffectiveHooks(undefined, ctx)).toEqual([]);
  });

  it('returns empty when no hook ids are selected', () => {
    const h = hook({ id: 'a' });
    expect(resolveEffectiveHooks([h], { hookIds: [] })).toEqual([]);
  });

  it('tolerates a non-array hookIds value', () => {
    const h = hook({ id: 'a' });
    expect(
      resolveEffectiveHooks([h], { hookIds: undefined as unknown as string[] }),
    ).toEqual([]);
  });

  it('skips null, disabled, and id-less hooks', () => {
    const hooks = [
      null as unknown as HookDefinition,
      hook({ id: 'a', enabled: false }),
      hook({ id: undefined as unknown as string, enabled: true }),
    ];
    expect(resolveEffectiveHooks(hooks, ctx)).toEqual([]);
  });

  it('matches hooks selected by id on the agent', () => {
    const h = hook({ id: 'a' });
    expect(resolveEffectiveHooks([h], ctx)).toEqual([h]);
  });

  it('excludes hooks not selected by the active agent', () => {
    const h = hook({ id: 'x' });
    expect(resolveEffectiveHooks([h], ctx)).toEqual([]);
  });

  it('deduplicates by id keeping the first occurrence', () => {
    const first = hook({ id: 'dup', name: 'first' });
    const second = hook({ id: 'dup', name: 'second' });
    const result = resolveEffectiveHooks([first, second], ctx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('first');
  });
});

describe('matchesMatcher', () => {
  it('matches when matcher is empty or wildcard', () => {
    expect(matchesMatcher(undefined, 'read_file')).toBe(true);
    expect(matchesMatcher('  ', 'read_file')).toBe(true);
    expect(matchesMatcher('*', 'read_file')).toBe(true);
  });

  it('matches exact normalized values', () => {
    expect(matchesMatcher('read_file', 'read_file')).toBe(true);
    expect(matchesMatcher('read_file', 'ReadFile')).toBe(false);
    expect(matchesMatcher('github.search', 'github.search')).toBe(true);
    expect(matchesMatcher('github.search', 'github-search')).toBe(false);
  });

  it('matches any option in a pipe list', () => {
    expect(matchesMatcher('read_file|write_file|edit_file', 'write_file')).toBe(true);
    expect(matchesMatcher('read_file|write_file', 'delete_file')).toBe(false);
  });

  it('falls back to regex matching', () => {
    expect(matchesMatcher('mcp__.*', 'mcp__fs__read')).toBe(true);
    expect(matchesMatcher('^notebook', 'notebook_edit')).toBe(true);
    expect(matchesMatcher('^read_file$', 'write_file')).toBe(false);
  });

  it('returns false for an invalid regex', () => {
    expect(matchesMatcher('(', 'anything')).toBe(false);
  });

  it('handles an undefined query', () => {
    expect(matchesMatcher('read_file', undefined)).toBe(false);
  });
});

describe('matchActionsForEvent', () => {
  const effective = [
    hook({
      id: 'h1',
      name: 'H1',
      event: 'PreToolUse',
      matcher: 'read_file',
      action: { type: 'command', command: 'a' },
    }),
    hook({
      id: 'h1b',
      name: 'H1b',
      event: 'PostToolUse',
      action: { type: 'command', command: 'b' },
    }),
    hook({
      id: 'h2',
      name: 'H2',
      event: 'PreToolUse',
      matcher: 'write_file',
      action: { type: 'command', command: 'c' },
    }),
  ];

  it('returns only actions for the matching event and matcher', () => {
    const matched = matchActionsForEvent(effective, 'PreToolUse', 'read_file');
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ hookId: 'h1', hookName: 'H1', matcher: 'read_file' });
    expect(matched[0].action).toEqual({ type: 'command', command: 'a' });
  });

  it('returns nothing when the matcher does not match', () => {
    expect(matchActionsForEvent(effective, 'PreToolUse', 'delete_file')).toEqual([]);
  });

  it('matches when any query alias matches', () => {
    const matched = matchActionsForEvent(effective, 'PreToolUse', ['delete_file', 'write_file']);
    expect(matched).toHaveLength(1);
    expect(matched[0].hookId).toBe('h2');
  });

  it('skips hooks whose event differs or whose action is missing', () => {
    const odd = [
      hook({ id: 'e', event: 'PostToolUse', action: undefined as unknown as HookAction }),
      hook({ id: 'f', event: 'PreToolUse', action: { type: 'command', command: 'x' } }),
    ];
    expect(matchActionsForEvent(odd, 'PostToolUse')).toEqual([]);
  });
});
