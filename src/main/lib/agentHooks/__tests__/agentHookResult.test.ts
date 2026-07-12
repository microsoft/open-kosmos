import { describe, it, expect } from 'vitest';

import { parseHookOutput, aggregateHookOutcomes } from '../agentHookResult';
import type { HookActionOutcome } from '../agentHookResult';
import type { HookJsonOutput } from '../types';

describe('parseHookOutput', () => {
  it('returns empty for non-string input', () => {
    expect(parseHookOutput(undefined as unknown as string)).toEqual({});
  });

  it('returns empty for blank input', () => {
    expect(parseHookOutput('   ')).toEqual({});
  });

  it('treats non-JSON text as plain text', () => {
    expect(parseHookOutput('hello world')).toEqual({ plainText: 'hello world' });
  });

  it('returns plain text when the leading object never closes', () => {
    expect(parseHookOutput('{ "a": 1 ')).toEqual({ plainText: '{ "a": 1 ' });
  });

  it('parses a valid protocol object', () => {
    expect(parseHookOutput('{"continue": true}')).toEqual({ json: { continue: true } });
  });

  it('tolerates trailing log text after the object', () => {
    expect(parseHookOutput('{"continue": false} extra log line')).toEqual({
      json: { continue: false },
    });
  });

  it('respects braces inside string literals and escaped quotes', () => {
    const out = parseHookOutput('{"reason":"a\\"b}c"}');
    expect(out.json).toEqual({ reason: 'a"b}c' });
  });

  it('falls back to plain text for valid JSON that is not protocol-shaped', () => {
    expect(parseHookOutput('{"continue": "yes"}')).toEqual({ plainText: '{"continue": "yes"}' });
  });

  it('falls back to plain text when JSON.parse throws', () => {
    expect(parseHookOutput('{not valid json}')).toEqual({ plainText: '{not valid json}' });
  });
});

describe('aggregateHookOutcomes', () => {
  const j = (json: HookJsonOutput, success = true): HookActionOutcome => ({ success, json });

  it('returns empty for no outcomes', () => {
    expect(aggregateHookOutcomes([])).toEqual({});
  });

  it('skips outcomes without json', () => {
    expect(aggregateHookOutcomes([{ success: true }])).toEqual({});
  });

  it('captures preventContinuation and the first stopReason', () => {
    const result = aggregateHookOutcomes([
      j({ continue: false, stopReason: 'first' }),
      j({ continue: false, stopReason: 'second' }),
    ]);
    expect(result.preventContinuation).toBe(true);
    expect(result.stopReason).toBe('first');
  });

  it('handles continue:false without a stopReason', () => {
    const result = aggregateHookOutcomes([j({ continue: false })]);
    expect(result.preventContinuation).toBe(true);
    expect(result.stopReason).toBeUndefined();
  });

  it('captures the first block reason and default message', () => {
    expect(aggregateHookOutcomes([j({ decision: 'block', reason: 'no' })]).blockingError).toBe('no');
    expect(aggregateHookOutcomes([j({ decision: 'block' })]).blockingError).toBe('Operation blocked by hook');
    const twoBlocks = aggregateHookOutcomes([
      j({ decision: 'block', reason: 'one' }),
      j({ decision: 'block', reason: 'two' }),
    ]);
    expect(twoBlocks.blockingError).toBe('one');
  });

  it('maps top-level approve to an approval override only on successful actions', () => {
    expect(aggregateHookOutcomes([j({ decision: 'approve' })]).approvalDecision).toBe('allow');
    expect(aggregateHookOutcomes([j({ decision: 'approve' }, false)]).approvalDecision).toBeUndefined();
  });

  it('collects system messages in order and ignores empty ones', () => {
    const result = aggregateHookOutcomes([
      j({ systemMessage: 'a' }),
      j({ systemMessage: '' }),
      j({ systemMessage: 'b' }),
    ]);
    expect(result.systemMessages).toEqual(['a', 'b']);
  });

  it('skips outcomes whose hookSpecificOutput is absent', () => {
    expect(aggregateHookOutcomes([j({ continue: true })])).toEqual({});
  });

  it('collects additionalContext strings and skips empty ones', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ctx1' } }),
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '' } }),
    ]);
    expect(result.additionalContexts).toEqual(['ctx1']);
  });

  it('applies updatedInput only from the last successful action', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { a: 1 } } }),
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { a: 2 } } }),
    ]);
    expect(result.updatedInput).toEqual({ a: 2 });
  });

  it('ignores updatedInput from failed actions', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { a: 1 } } }, false),
    ]);
    expect(result.updatedInput).toBeUndefined();
  });

  it('ignores non-object updatedInput', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: 'x' as unknown as Record<string, unknown> } }),
    ]);
    expect(result.updatedInput).toBeUndefined();
  });

  it('maps official PreToolUse permission decisions', () => {
    expect(
      aggregateHookOutcomes([
        j({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }),
      ]).approvalDecision,
    ).toBe('allow');
    expect(
      aggregateHookOutcomes([
        j({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }),
        j({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }),
      ]).approvalDecision,
    ).toBe('ask');
    expect(
      aggregateHookOutcomes([
        j({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'no',
          },
        }),
      ]).blockingError,
    ).toBe('no');
    const deferred = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'defer' } }),
    ]);
    expect(deferred.blockingError).toBeUndefined();
    expect(deferred.approvalDecision).toBeUndefined();
  });

  it('captures the ask permission decision reason for the confirmation prompt', () => {
    const withReason = aggregateHookOutcomes([
      j({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'Confirm before deleting',
        },
      }),
    ]);
    expect(withReason.approvalDecision).toBe('ask');
    expect(withReason.approvalDecisionReason).toBe('Confirm before deleting');

    const withoutReason = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }),
    ]);
    expect(withoutReason.approvalDecision).toBe('ask');
    expect(withoutReason.approvalDecisionReason).toBeUndefined();

    const firstReasonWins = aggregateHookOutcomes([
      j({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'first',
        },
      }),
      j({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'second',
        },
      }),
    ]);
    expect(firstReasonWins.approvalDecisionReason).toBe('first');
  });

  it('applies updatedMCPToolOutput when present and defined', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: 'patched' } }),
    ]);
    expect(result.updatedMCPToolOutput).toBe('patched');
  });

  it('applies official updatedToolOutput and keeps legacy output separately', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'official' } }),
      j({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: 'legacy' } }),
    ]);
    expect(result.updatedToolOutput).toBe('official');
    expect(result.updatedMCPToolOutput).toBe('legacy');
  });

  it('ignores updatedMCPToolOutput when the key is undefined', () => {
    const result = aggregateHookOutcomes([
      j({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: undefined } }),
    ]);
    expect('updatedMCPToolOutput' in result).toBe(false);
  });
});
