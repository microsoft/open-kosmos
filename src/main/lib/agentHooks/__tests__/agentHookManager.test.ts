import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

const getHooksArtifactsPathMock = vi.fn();
vi.mock('../../userDataADO/pathUtils', () => ({
  getHooksArtifactsPath: (...a: unknown[]) => getHooksArtifactsPathMock(...a),
}));

const getHooksMock = vi.fn();
const isEnabledMock = vi.fn();
vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getHooks: (...a: unknown[]) => getHooksMock(...a),
    isHooksEnabled: (...a: unknown[]) => isEnabledMock(...a),
  },
}));

import { AgentHookManager, createDefaultDeps } from '../agentHookManager';
import type { AgentHookManagerDeps } from '../agentHookManager';
import type { CommandRunner } from '../agentHookExecutor';
import type { AgentHookInput, AgentHookRunContext, EffectiveHook, HookDefinition } from '../types';

function boundHook(): HookDefinition {
  return {
    id: 'h1',
    name: 'H1',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const context: AgentHookRunContext = {
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Kobi',
  hookIds: ['h1'],
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

beforeEach(() => {
  getHooksMock.mockReset();
  isEnabledMock.mockReset();
  getHooksArtifactsPathMock.mockReset();
  getHooksArtifactsPathMock.mockReturnValue('/profile/alice/hooks-artifacts');
});

describe('AgentHookManager.resolveHooksForAgent', () => {
  it('returns nothing when the master switch is disabled', () => {
    const deps: AgentHookManagerDeps = { getHooks: () => [boundHook()], isEnabled: () => false };
    expect(new AgentHookManager(deps).resolveHooksForAgent(context)).toEqual([]);
  });

  it('resolves bound hooks when enabled', () => {
    const hook = boundHook();
    const deps: AgentHookManagerDeps = { getHooks: () => [hook], isEnabled: () => true };
    expect(new AgentHookManager(deps).resolveHooksForAgent(context)).toEqual([hook]);
  });
});

describe('AgentHookManager.isEnabled', () => {
  it('reflects the injected master-switch dependency', () => {
    expect(new AgentHookManager({ getHooks: () => [], isEnabled: () => true }).isEnabled('alice')).toBe(true);
    expect(new AgentHookManager({ getHooks: () => [], isEnabled: () => false }).isEnabled('alice')).toBe(false);
  });
});

describe('AgentHookManager.runHooks', () => {
  it('returns empty when there are no effective hooks', async () => {
    const deps: AgentHookManagerDeps = { getHooks: () => [], isEnabled: () => true };
    expect(await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context)).toEqual({});
  });

  it('does not execute hooks when the master switch is disabled', async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      success: true,
      stdout: '',
      stderr: '',
      durationMs: 1,
      exitCode: 0,
    }));
    const deps: AgentHookManagerDeps = {
      getHooks: () => [boundHook()],
      isEnabled: () => false,
      runner,
    };
    const out = await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    expect(out).toEqual({});
    expect(runner).not.toHaveBeenCalled();
  });

  it('executes effective hooks through the injected runner', async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      success: true,
      stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"ctx"}}',
      stderr: '',
      durationMs: 1,
      exitCode: 0,
    }));
    const deps: AgentHookManagerDeps = { getHooks: () => [boundHook()], isEnabled: () => true, runner };
    const out = await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    expect(out.additionalContexts).toEqual(['ctx']);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('derives hooksArtifactsPath from the user alias and propagates it via envCtx', async () => {
    const runner: CommandRunner = vi.fn(async () => ({ success: true, stdout: '', stderr: '', durationMs: 1, exitCode: 0 }));
    const deps: AgentHookManagerDeps = {
      getHooks: () => [boundHook()],
      isEnabled: () => true,
      runner,
    };
    await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    expect(getHooksArtifactsPathMock).toHaveBeenCalledWith('alice');
    const envCtxArg = (runner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2] as { hooksArtifactsPath?: string };
    expect(envCtxArg.hooksArtifactsPath).toBe('/profile/alice/hooks-artifacts');
  });

  it('still runs hooks when hooksArtifactsPath resolution fails (envCtx gets undefined)', async () => {
    getHooksArtifactsPathMock.mockImplementation(() => {
      throw new Error('fs denied');
    });
    const runner: CommandRunner = vi.fn(async () => ({ success: true, stdout: '', stderr: '', durationMs: 1, exitCode: 0 }));
    const deps: AgentHookManagerDeps = {
      getHooks: () => [boundHook()],
      isEnabled: () => true,
      runner,
    };
    await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    expect(runner).toHaveBeenCalledTimes(1);
    const envCtxArg = (runner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2] as { hooksArtifactsPath?: string };
    expect(envCtxArg.hooksArtifactsPath).toBeUndefined();
  });

  it('still runs hooks when hooksArtifactsPath resolution fails with a non-Error', async () => {
    getHooksArtifactsPathMock.mockImplementation(() => {
      throw 'string failure';
    });
    const runner: CommandRunner = vi.fn(async () => ({ success: true, stdout: '', stderr: '', durationMs: 1, exitCode: 0 }));
    const deps: AgentHookManagerDeps = {
      getHooks: () => [boundHook()],
      isEnabled: () => true,
      runner,
    };
    await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    const envCtxArg = (runner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2] as { hooksArtifactsPath?: string };
    expect(envCtxArg.hooksArtifactsPath).toBeUndefined();
  });

  it('routes http actions through the injected http runner', async () => {
    const httpRunner = vi.fn(async () => ({
      success: true,
      stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"http-ctx"}}',
      stderr: '',
      durationMs: 1,
      exitCode: 200,
    }));
    const runner = vi.fn();
    const httpHook: HookDefinition = {
      ...boundHook(),
      event: 'PreToolUse',
      action: { type: 'http', url: 'https://example.com/hook' },
    };
    const deps: AgentHookManagerDeps = {
      getHooks: () => [httpHook],
      isEnabled: () => true,
      runner: runner as unknown as CommandRunner,
      httpRunner,
    };
    const out = await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context);
    expect(out.additionalContexts).toEqual(['http-ctx']);
    expect(httpRunner).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
  });

  it('never throws — returns empty when resolution fails', async () => {
    const deps: AgentHookManagerDeps = {
      getHooks: () => {
        throw new Error('cache exploded');
      },
      isEnabled: () => true,
    };
    expect(await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context)).toEqual({});
  });

  it('never throws — returns empty when resolution fails with a non-Error', async () => {
    const deps: AgentHookManagerDeps = {
      getHooks: () => {
        throw 'cache exploded as string';
      },
      isEnabled: () => true,
    };
    expect(await new AgentHookManager(deps).runHooks('PreToolUse', preInput, context)).toEqual({});
  });
});

describe('AgentHookManager.getInstance', () => {
  it('returns a singleton', () => {
    isEnabledMock.mockReturnValue(false);
    const a = AgentHookManager.getInstance();
    const b = AgentHookManager.getInstance();
    expect(a).toBe(b);
  });
});

describe('createDefaultDeps', () => {
  it('reads hooks from the profile cache', () => {
    const hooks: EffectiveHook[] = [boundHook()];
    getHooksMock.mockReturnValue(hooks);
    expect(createDefaultDeps().getHooks('alice')).toBe(hooks);
  });

  it('returns an empty list when the profile cache throws', () => {
    getHooksMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(createDefaultDeps().getHooks('alice')).toEqual([]);
  });

  it('reads the master switch from the profile cache', () => {
    isEnabledMock.mockReturnValue(true);
    expect(createDefaultDeps().isEnabled('alice')).toBe(true);
    expect(isEnabledMock).toHaveBeenCalledWith('alice');
  });

  it('returns false when the profile cache throws', () => {
    isEnabledMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(createDefaultDeps().isEnabled('alice')).toBe(false);
  });
});
