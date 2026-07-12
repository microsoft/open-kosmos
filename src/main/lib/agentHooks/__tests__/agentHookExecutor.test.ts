import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { executeHooksForEvent, getMatchQueryForInput } from '../agentHookExecutor';
import type { CommandRunner, HttpRunner } from '../agentHookExecutor';
import type { CommandHookEnv } from '../commandHookRunner';
import type { AgentHookInput, CommandHookResult, EffectiveHook } from '../types';

const env: CommandHookEnv = {
  event: 'PreToolUse',
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Kobi',
};

const preInput: AgentHookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  user_alias: 'alice',
  chat_id: 'chat-1',
  chat_session_id: 'sess-1',
  agent_id: 'Kobi',
  agent_name: 'Kobi',
  tool_name: 'Read',
  tool_use_id: 'tc-1',
  tool_call_id: 'tc-1',
  tool_input: { path: '/a' },
};

function effective(actions: { command: string; async?: boolean }[]): EffectiveHook[] {
  return actions.map((a, index) => ({
    id: `h${index + 1}`,
    name: `H${index + 1}`,
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: a.command, async: a.async },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

function effectiveFor(event: AgentHookInput['hook_event_name'], commands: string[]): EffectiveHook[] {
  return commands.map((command, index) => ({
    id: `h${index + 1}`,
    name: `H${index + 1}`,
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event,
    action: { type: 'command' as const, command },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

function httpEffective(event: AgentHookInput['hook_event_name'] = 'PreToolUse'): EffectiveHook[] {
  return [
    {
      id: 'h2',
      name: 'H2',
      version: '1.0.0',
      source: 'ON-DEVICE',
      enabled: true,
      event,
      action: { type: 'http', url: 'https://example.com/hook', method: 'POST' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
}

const result = (over: Partial<CommandHookResult> = {}): CommandHookResult => ({
  success: true,
  stdout: '',
  stderr: '',
  durationMs: 1,
  ...over,
});

describe('getMatchQueryForInput', () => {
  it('returns the trigger for SessionStart', () => {
    expect(
      getMatchQueryForInput({ ...preInput, hook_event_name: 'SessionStart', source: 'resume', trigger: 'resume' } as AgentHookInput),
    ).toBe('resume');
  });

  it('returns official and legacy aliases for a startup SessionStart', () => {
    expect(
      getMatchQueryForInput({ ...preInput, hook_event_name: 'SessionStart', source: 'startup', trigger: 'new' } as AgentHookInput),
    ).toEqual(['startup', 'new']);
  });

  it('returns the tool name for tool events', () => {
    expect(getMatchQueryForInput(preInput)).toBe('Read');
    expect(
      getMatchQueryForInput({ ...preInput, hook_event_name: 'PostToolUse', tool_output: 1, tool_response: 1 } as AgentHookInput),
    ).toBe('Read');
    expect(getMatchQueryForInput({ ...preInput, hook_event_name: 'PostToolUseFailure', error: 'x' } as AgentHookInput)).toBe('Read');
  });

  it('returns undefined for UserPromptSubmit and unknown events', () => {
    expect(getMatchQueryForInput({ ...preInput, hook_event_name: 'UserPromptSubmit', prompt: 'p' } as AgentHookInput)).toBeUndefined();
    expect(getMatchQueryForInput({ ...preInput, hook_event_name: 'Other' } as unknown as AgentHookInput)).toBeUndefined();
  });

  it('returns undefined for the Phase 3 observational events', () => {
    expect(getMatchQueryForInput({ ...preInput, hook_event_name: 'Stop' } as unknown as AgentHookInput)).toBeUndefined();
    expect(
      getMatchQueryForInput({ ...preInput, hook_event_name: 'PreCompact', trigger: 'auto' } as unknown as AgentHookInput),
    ).toBeUndefined();
    expect(
      getMatchQueryForInput({ ...preInput, hook_event_name: 'PostCompact', trigger: 'manual' } as unknown as AgentHookInput),
    ).toBeUndefined();
  });
});

describe('executeHooksForEvent', () => {
  it('returns empty when no actions match', async () => {
    const runner = vi.fn();
    const out = await executeHooksForEvent('PreToolUse', preInput, [], env, undefined, runner as unknown as CommandRunner);
    expect(out).toEqual({});
    expect(runner).not.toHaveBeenCalled();
  });

  it('runs an action whose if-condition matches the tool input', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ stdout: '', exitCode: 0 }));
    const execCmdInput = { ...preInput, tool_name: 'execute_command', tool_input: { command: 'rm -rf /tmp/x' } } as AgentHookInput;
    const hooks: EffectiveHook[] = [
      {
        id: 'h1',
        name: 'H1',
        version: '1.0.0',
        source: 'ON-DEVICE',
        enabled: true,
        event: 'PreToolUse',
        action: { type: 'command', command: 'echo', if: 'execute_command(rm *)' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const out = await executeHooksForEvent('PreToolUse', execCmdInput, hooks, env, undefined, runner);
    expect(out).toEqual({});
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('skips an action whose if-condition does not match the tool input', async () => {
    const runner: CommandRunner = vi.fn(async () => result());
    const hooks: EffectiveHook[] = [
      {
        id: 'h1',
        name: 'H1',
        version: '1.0.0',
        source: 'ON-DEVICE',
        enabled: true,
        event: 'PreToolUse',
        action: { type: 'command', command: 'echo', if: 'execute_command(rm *)' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const out = await executeHooksForEvent('PreToolUse', preInput, hooks, env, undefined, runner);
    expect(out).toEqual({});
    expect(runner).not.toHaveBeenCalled();
  });

  it('runs a sync action and aggregates its structured output', async () => {
    const runner: CommandRunner = vi.fn(async () =>
      result({ stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"ctx"}}', exitCode: 0 }),
    );
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo' }]), env, undefined, runner);
    expect(out.additionalContexts).toEqual(['ctx']);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('runs matched sync actions concurrently and aggregates in match order', async () => {
    const pending: Array<(value: CommandHookResult) => void> = [];
    const runner: CommandRunner = vi.fn(() => new Promise<CommandHookResult>(resolve => {
      pending.push(resolve);
    }));
    const promise = executeHooksForEvent(
      'PreToolUse',
      preInput,
      effective([{ command: 'first' }, { command: 'second' }]),
      env,
      undefined,
      runner,
    );

    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(2);
    pending[1](result({ stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"second"}}' }));
    pending[0](result({ stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"first"}}' }));

    await expect(promise).resolves.toMatchObject({ additionalContexts: ['first', 'second'] });
  });

  it('caps sync actions per event to keep hook execution bounded', async () => {
    const runner: CommandRunner = vi.fn(async () => result());
    await executeHooksForEvent(
      'PreToolUse',
      preInput,
      effective(Array.from({ length: 10 }, (_, index) => ({ command: `hook-${index}` }))),
      env,
      undefined,
      runner,
    );

    expect(runner).toHaveBeenCalledTimes(8);
  });

  it('treats empty stdout as no structured output', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ stdout: '' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo' }]), env, undefined, runner);
    expect(out).toEqual({});
  });

  it('fires async actions without awaiting them and logs failures', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: false, error: 'bad', stdout: 'x' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo', async: true }]), env, undefined, runner);
    expect(out).toEqual({});
    await new Promise(r => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('swallows async runner rejections', async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error('explode');
    });
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo', async: true }]), env, undefined, runner);
    expect(out).toEqual({});
    await new Promise(r => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('does not log when an async action succeeds', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: true, stdout: 'ok' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo', async: true }]), env, undefined, runner);
    expect(out).toEqual({});
    await new Promise(r => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('logs an async failure with a fallback message when no error is provided', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: false }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo', async: true }]), env, undefined, runner);
    expect(out).toEqual({});
    await new Promise(r => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('swallows non-Error async rejections', async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw 'plain string failure';
    });
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo', async: true }]), env, undefined, runner);
    expect(out).toEqual({});
    await new Promise(r => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('stops before running actions when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = vi.fn();
    const out = await executeHooksForEvent(
      'PreToolUse',
      preInput,
      effective([{ command: 'echo' }]),
      env,
      controller.signal,
      runner as unknown as CommandRunner,
    );
    expect(out).toEqual({});
    expect(runner).not.toHaveBeenCalled();
  });

  it('dispatches http actions to the http runner, not the command runner', async () => {
    const runner = vi.fn();
    const httpRunner: HttpRunner = vi.fn(async () =>
      result({ stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"from-http"}}', exitCode: 200 }),
    );
    const out = await executeHooksForEvent(
      'PreToolUse',
      preInput,
      httpEffective(),
      env,
      undefined,
      runner as unknown as CommandRunner,
      httpRunner,
    );
    expect(out.additionalContexts).toEqual(['from-http']);
    expect(httpRunner).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
  });

  it('fires the Stop event by matching all actions (no match query)', async () => {
    const stopInput = { ...preInput, hook_event_name: 'Stop' } as unknown as AgentHookInput;
    const httpRunner: HttpRunner = vi.fn(async () => result({ stdout: 'ok', exitCode: 200 }));
    const out = await executeHooksForEvent(
      'Stop',
      stopInput,
      httpEffective('Stop'),
      { ...env, event: 'Stop' },
      undefined,
      undefined,
      httpRunner,
    );
    expect(out).toEqual({});
    expect(httpRunner).toHaveBeenCalledTimes(1);
  });

  it('blocks the operation when a command exits with code 2, using stderr as the reason', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: false, exitCode: 2, stderr: '\n  nope, denied\nmore' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'guard' }]), env, undefined, runner);
    expect(out.blockingError).toBe('nope, denied');
  });

  it('falls back to a default block reason when exit code 2 has empty stderr', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: false, exitCode: 2, stderr: '' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'guard' }]), env, undefined, runner);
    expect(out.blockingError).toBe('Hook blocked the operation (exit code 2)');
  });

  it('ignores plain stdout for SessionStart because context injection requires structured JSON', async () => {
    const ssInput = { ...preInput, hook_event_name: 'SessionStart', source: 'startup', trigger: 'new' } as unknown as AgentHookInput;
    const runner: CommandRunner = vi.fn(async () => result({ success: true, stdout: '  context line  ' }));
    const out = await executeHooksForEvent('SessionStart', ssInput, effectiveFor('SessionStart', ['echo']), { ...env, event: 'SessionStart' }, undefined, runner);
    expect(out).toEqual({});
  });

  it('ignores plain stdout for UserPromptSubmit because context injection requires structured JSON', async () => {
    const upInput = { ...preInput, hook_event_name: 'UserPromptSubmit', prompt: 'hi' } as unknown as AgentHookInput;
    const runner: CommandRunner = vi.fn(async () => result({ success: true, stdout: 'note' }));
    const out = await executeHooksForEvent('UserPromptSubmit', upInput, effectiveFor('UserPromptSubmit', ['echo']), { ...env, event: 'UserPromptSubmit' }, undefined, runner);
    expect(out).toEqual({});
  });

  it('does not inject plain stdout as context for events outside the stdout-context set', async () => {
    const runner: CommandRunner = vi.fn(async () => result({ success: true, stdout: 'ignored' }));
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'echo' }]), env, undefined, runner);
    expect(out).toEqual({});
  });

  it('does not inject plain stdout context when the run failed', async () => {
    const ssInput = { ...preInput, hook_event_name: 'SessionStart', source: 'startup', trigger: 'new' } as unknown as AgentHookInput;
    const runner: CommandRunner = vi.fn(async () => result({ success: false, exitCode: 1, stdout: 'note' }));
    const out = await executeHooksForEvent('SessionStart', ssInput, effectiveFor('SessionStart', ['echo']), { ...env, event: 'SessionStart' }, undefined, runner);
    expect(out).toEqual({});
  });

  it('ignores structured stdout on non-zero, non-blocking failures', async () => {
    const runner: CommandRunner = vi.fn(async () =>
      result({
        success: false,
        exitCode: 1,
        stdout: '{"decision":"block","reason":"should not apply"}',
      }),
    );
    const out = await executeHooksForEvent('PreToolUse', preInput, effective([{ command: 'guard' }]), env, undefined, runner);
    expect(out).toEqual({});
  });
});
