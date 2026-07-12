import type { HookDefinition } from '../../../../../../shared/agentHooks/profileTypes';

const profileCacheManagerMock = vi.hoisted(() => ({
  currentUserAlias: 'test-user' as string | null,
  hooks: [] as HookDefinition[],
  chats: [] as any[],
  getCurrentUserAlias: vi.fn(() => profileCacheManagerMock.currentUserAlias),
  getHooks: vi.fn((_: string) => profileCacheManagerMock.hooks),
  getAllChatConfigs: vi.fn((_: string) => profileCacheManagerMock.chats),
  addHook: vi.fn(async (_: string, hook: HookDefinition) => {
    profileCacheManagerMock.hooks.push(hook);
    return true;
  }),
  updateHook: vi.fn(async (_: string, hookId: string, patch: Partial<HookDefinition>) => {
    const index = profileCacheManagerMock.hooks.findIndex(hook => hook.id === hookId);
    if (index < 0) return false;
    profileCacheManagerMock.hooks[index] = {
      ...profileCacheManagerMock.hooks[index],
      ...patch,
    };
    return true;
  }),
  deleteHook: vi.fn(async (_: string, hookId: string) => {
    const before = profileCacheManagerMock.hooks.length;
    profileCacheManagerMock.hooks = profileCacheManagerMock.hooks.filter(hook => hook.id !== hookId);
    return profileCacheManagerMock.hooks.length !== before;
  }),
}));

vi.mock('../../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: profileCacheManagerMock,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageHooksFacade } from '../manageHooksFacade';

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: overrides.id ?? `h-${profileCacheManagerMock.hooks.length + 1}`,
    name: 'Existing Hook',
    description: 'Existing',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    matcher: undefined,
    action: { type: 'command', command: 'echo ok' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ManageHooksFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileCacheManagerMock.currentUserAlias = 'test-user';
    profileCacheManagerMock.hooks = [];
    profileCacheManagerMock.chats = [];
  });

  it('returns an AI-friendly flat action schema without master switch or binding mutation', () => {
    const definition = ManageHooksFacade.getDefinition();
    expect(definition.name).toBe('manage_hooks');
    expect(definition.inputSchema.required).toEqual(['action']);
    expect(definition.description).toContain('exactly one event');
    expect(definition.description).not.toContain('set_master_switch');
    const actionEnum = (definition.inputSchema.properties as any).action.enum;
    expect(actionEnum).toEqual(['status', 'list', 'create', 'update', 'delete', 'disable']);
    expect(actionEnum).not.toContain('enable');
    expect(actionEnum).not.toContain('bind');
    expect((definition.inputSchema.properties as any).action_type.enum).toEqual(['command', 'http']);
    expect((definition.inputSchema.properties as any).event.enum).toContain('PreToolUse');
    expect((definition.inputSchema.properties as any).if.description).toContain('permission-rule');
  });

  it('rejects invalid action and missing user alias', async () => {
    expect((await ManageHooksFacade.execute({ action: 'nope' } as any)).success).toBe(false);
    profileCacheManagerMock.currentUserAlias = null;
    const result = await ManageHooksFacade.execute({ action: 'list' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('No current user session');
  });

  it('rejects an empty captured execution alias without reading the mutable current profile alias', async () => {
    const result = await ManageHooksFacade.execute({ action: 'list' }, { userAlias: '' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No current user session');
    expect(profileCacheManagerMock.getCurrentUserAlias).not.toHaveBeenCalled();
  });

  it('creates a disabled hook from flat command fields and preserves the if condition', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Marker Hook',
      event: 'UserPromptSubmit',
      command: 'echo hi',
      if: 'Bash(echo *)',
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.addHook).toHaveBeenCalledTimes(1);
    const hook = profileCacheManagerMock.hooks[0];
    expect(hook).toMatchObject({
      name: 'Marker Hook',
      enabled: false,
      event: 'UserPromptSubmit',
      version: '1.0.0',
      remoteVersion: '',
      source: 'ON-DEVICE',
      action: { type: 'command', command: 'echo hi', if: 'Bash(echo *)' },
    });
    expect((hook as any).events).toBeUndefined();
    expect((hook as any).bindings).toBeUndefined();
    expect(result.next_actions).toEqual([
      'Review the hook in Settings > Hooks, then enable it manually when ready. Bind it to an agent in the Agent editor.',
    ]);
  });

  it('uses the captured execution alias instead of the mutable current profile alias', async () => {
    profileCacheManagerMock.currentUserAlias = 'current-user';

    const result = await ManageHooksFacade.execute(
      {
        action: 'create',
        name: 'Captured Alias Hook',
        event: 'UserPromptSubmit',
        command: 'echo hi',
      },
      { userAlias: 'captured-user' },
    );

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.addHook).toHaveBeenCalledWith('captured-user', expect.anything());
    expect(profileCacheManagerMock.getCurrentUserAlias).not.toHaveBeenCalled();
  });

  it('creates a flat hook disabled even when enabled is requested', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Structured Hook',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'read_file',
      command: 'echo structured',
      timeout: 5,
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0]).toMatchObject({
      name: 'Structured Hook',
      enabled: false,
      event: 'PreToolUse',
      matcher: 'read_file',
      action: { type: 'command', command: 'echo structured', timeout: 5 },
    });
    expect(result.warnings).toContain('Hook was created disabled. Enabling hooks requires manual review in Settings > Hooks.');
  });

  it('creates a flat HTTP hook with method, headers, body, timeout, async, and if fields', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'HTTP Hook',
      event: 'PostToolUse',
      action_type: 'http',
      if: 'WebFetch(*)',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: '{"ok":true}',
      timeout: 10,
      async: true,
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0].action).toEqual({
      type: 'http',
      if: 'WebFetch(*)',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: '{"ok":true}',
      timeout: 10,
      async: true,
    });
  });

  it('infers flat HTTP actions from url and omits optional HTTP fields when absent', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Minimal HTTP Hook',
      event: 'PostCompact',
      url: 'https://example.com/minimal',
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0]).toMatchObject({
      event: 'PostCompact',
      action: { type: 'http', url: 'https://example.com/minimal' },
    });
  });

  it('rejects create without required flat fields or when persistence fails', async () => {
    const missingName = await ManageHooksFacade.execute({
      action: 'create',
      event: 'Stop',
      command: 'echo unnamed',
    });
    expect(missingName.success).toBe(false);
    expect(missingName.message).toContain('"name" is required');

    const missingEvent = await ManageHooksFacade.execute({ action: 'create', name: 'No Event', command: 'echo hi' });
    expect(missingEvent.success).toBe(false);
    expect(missingEvent.message).toContain('"event" is required');

    const missingFlatAction = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Missing Flat Action',
      event: 'PreToolUse',
      action_type: 'http',
    });
    expect(missingFlatAction.success).toBe(false);
    expect(missingFlatAction.message).toContain('A command or http action is required');

    const missingInferredAction = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Missing Inferred Action',
      event: 'Stop',
    });
    expect(missingInferredAction.success).toBe(false);
    expect(missingInferredAction.message).toContain('A command or http action is required');

    profileCacheManagerMock.addHook.mockResolvedValueOnce(false);
    const failedPersist = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Persist Fail',
      event: 'Stop',
      command: 'echo fail',
    });
    expect(failedPersist.success).toBe(false);
    expect(failedPersist.message).toContain('Failed to create hook');
  });

  it('rejects create when action validation fails', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Invalid Action',
      event: 'PreToolUse',
      command: '',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('A command or http action is required');

    const invalidIf = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Invalid If',
      event: 'PreToolUse',
      command: 'echo ok',
      if: 'x'.repeat(501),
    });
    expect(invalidIf.success).toBe(false);
    expect(invalidIf.message).toContain('Hook if exceeds 500 characters');
  });

  it('creates exec-form command hooks with matcher, args, timeoutMs, and async fields', async () => {
    const result = await ManageHooksFacade.execute({
      action: 'create',
      name: 'Exec Hook',
      event: 'PreToolUse',
      matcher: 'read_file',
      action_type: 'command',
      command: 'node',
      args: ['script.js', '--flag'],
      timeoutMs: 5000,
      async: true,
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0]).toMatchObject({
      event: 'PreToolUse',
      matcher: 'read_file',
      action: {
        type: 'command',
        command: 'node',
        args: ['script.js', '--flag'],
        timeoutMs: 5000,
        async: true,
      },
    });
  });

  it('updates metadata without clearing the existing flat operation', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];
    const result = await ManageHooksFacade.execute({
      action: 'update',
      hook_id: 'h1',
      name: 'Hook B',
      description: 'New description',
      enabled: false,
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0]).toMatchObject({
      name: 'Hook B',
      enabled: false,
      description: 'New description',
      event: 'PreToolUse',
      action: { type: 'command', command: 'echo ok' },
    });
  });

  it('updates the flat event and action on a disabled hook', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];

    const result = await ManageHooksFacade.execute({
      action: 'update',
      hook_id: 'h1',
      event: 'Stop',
      command: 'echo stop',
    });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0]).toMatchObject({
      event: 'Stop',
      action: { type: 'command', command: 'echo stop' },
    });
  });

  it('updates only the matcher on a disabled hook', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];

    const result = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', matcher: 'write_file' });

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.hooks[0].matcher).toBe('write_file');
  });

  it('reports update validation, enable rejection, and persistence failures', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];

    const enabling = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', enabled: true });
    expect(enabling.success).toBe(false);
    expect(enabling.message).toContain('Enabling hooks from manage_hooks is not allowed');

    const invalid = await ManageHooksFacade.execute({
      action: 'update',
      hook_id: 'h1',
      name: 'x'.repeat(1000),
    });
    expect(invalid.success).toBe(false);

    profileCacheManagerMock.updateHook.mockResolvedValueOnce(false);
    const failed = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', description: 'Will fail' });
    expect(failed.success).toBe(false);
    expect(failed.message).toContain('Failed to update hook');
  });

  it('refuses to change flat operation fields on an enabled hook', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', enabled: true })];

    const updateEvent = await ManageHooksFacade.execute({
      action: 'update',
      hook_id: 'h1',
      event: 'Stop',
      command: 'echo changed',
    });
    const updateMatcher = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', matcher: 'tool' });
    const updateAction = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', command: 'echo action' });

    expect(updateEvent.success).toBe(false);
    expect(updateMatcher.success).toBe(false);
    expect(updateAction.success).toBe(false);
    expect(updateEvent.message).toContain('Enabled hooks cannot be modified');
  });

  it('rejects target actions without a hook id or unique name', async () => {
    const missingTarget = await ManageHooksFacade.execute({ action: 'delete' });
    expect(missingTarget.success).toBe(false);
    expect(missingTarget.message).toContain('"hook_id" or unique "name" is required');

    const missingId = await ManageHooksFacade.execute({ action: 'disable', hook_id: 'missing' });
    expect(missingId.success).toBe(false);
    expect(missingId.message).toContain('not found');
  });

  it('requires hook_id for ambiguous names', async () => {
    profileCacheManagerMock.hooks = [
      makeHook({ id: 'h1', name: 'Duplicate' }),
      makeHook({ id: 'h2', name: 'Duplicate' }),
    ];
    const result = await ManageHooksFacade.execute({ action: 'disable', name: 'Duplicate' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('ambiguous');
  });

  it('returns a clear error when a unique-name target does not exist', async () => {
    const result = await ManageHooksFacade.execute({ action: 'disable', name: 'Missing Hook' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Hook name "Missing Hook" not found');
  });

  it('refuses to enable hooks from the facade', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];

    const result = await ManageHooksFacade.execute({ action: 'enable', hook_id: 'h1' } as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid action "enable"');
    expect(profileCacheManagerMock.hooks[0].enabled).toBe(false);
  });

  it('requires Settings review before disabling or deleting enabled hooks', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Policy Hook', enabled: true })];

    const disabled = await ManageHooksFacade.execute({ action: 'disable', hook_id: 'h1' });
    const updateDisabled = await ManageHooksFacade.execute({ action: 'update', hook_id: 'h1', enabled: false });
    const deleted = await ManageHooksFacade.execute({ action: 'delete', hook_id: 'h1' });

    expect(disabled.success).toBe(false);
    expect(disabled.message).toContain('Enabled hooks cannot be disabled from manage_hooks');
    expect(updateDisabled.success).toBe(false);
    expect(updateDisabled.message).toContain('Enabled hooks cannot be disabled from manage_hooks');
    expect(deleted.success).toBe(false);
    expect(deleted.message).toContain('Enabled hooks cannot be deleted from manage_hooks');
    expect(profileCacheManagerMock.updateHook).not.toHaveBeenCalled();
    expect(profileCacheManagerMock.deleteHook).not.toHaveBeenCalled();
  });

  it('requires Agent editor unbinding before disabling or deleting bound hooks', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Bound Hook', enabled: false })];
    profileCacheManagerMock.chats = [
      { chat_id: 'chat-1', agent: { name: 'Single Agent', hooks: ['h1'] } },
      { chat_id: 'chat-2', agents: [{ name: 'Multi Agent', hooks: ['h1'] }] },
    ];

    const disabled = await ManageHooksFacade.execute({ action: 'disable', hook_id: 'h1' });
    const deleted = await ManageHooksFacade.execute({ action: 'delete', hook_id: 'h1' });

    expect(disabled.success).toBe(false);
    expect(disabled.message).toContain('Agent-bound hooks cannot be disabled from manage_hooks');
    expect(disabled.hint).toContain('Single Agent');
    expect(disabled.hint).toContain('Multi Agent');
    expect(deleted.success).toBe(false);
    expect(deleted.message).toContain('Agent-bound hooks cannot be deleted from manage_hooks');
    expect(profileCacheManagerMock.updateHook).not.toHaveBeenCalled();
    expect(profileCacheManagerMock.deleteHook).not.toHaveBeenCalled();
  });

  it('deduplicates bound agent names in safety hints', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Bound Hook', enabled: false })];
    profileCacheManagerMock.chats = [
      { chat_id: 'chat-1', agent: { name: 'Same Agent', hooks: ['h1'] } },
      { chat_id: 'chat-1', agents: [{ name: 'Same Agent', hooks: ['h1'] }] },
    ];

    const disabled = await ManageHooksFacade.execute({ action: 'disable', hook_id: 'h1' });

    expect(disabled.success).toBe(false);
    expect(disabled.hint).toBe('Remove the hook from bound agent(s) in the Agent editor first: Same Agent');
  });

  it('disables, deletes, and lists hooks by id with flat summaries', async () => {
    profileCacheManagerMock.hooks = [
      makeHook({
        id: 'h1',
        name: 'Hook A',
        enabled: false,
        matcher: 'read_file',
        action: { type: 'command', command: 'echo ok', if: 'Bash(echo *)' },
      }),
    ];

    expect((await ManageHooksFacade.execute({ action: 'disable', hook_id: 'h1' })).success).toBe(true);
    expect(profileCacheManagerMock.hooks[0].enabled).toBe(false);
    const list = await ManageHooksFacade.execute({ action: 'list' });
    expect(list.success).toBe(true);
    expect(list.hooks).toEqual([
      expect.objectContaining({
        id: 'h1',
        name: 'Hook A',
        enabled: false,
        event: 'PreToolUse',
        matcher: 'read_file',
        version: '1.0.0',
        source: 'ON-DEVICE',
        action_type: 'command',
        if: 'Bash(echo *)',
      }),
    ]);
    expect((list.hooks as any)[0].events).toBeUndefined();
    const deleted = await ManageHooksFacade.execute({ action: 'delete', hook_id: 'h1' });
    expect(deleted.success).toBe(true);
    expect(deleted.removed).toMatchObject({ id: 'h1', event: 'PreToolUse', action_type: 'command' });
    expect(profileCacheManagerMock.hooks).toHaveLength(0);
  });

  it('reports disable persistence failures', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Hook A', enabled: false })];
    profileCacheManagerMock.updateHook.mockResolvedValueOnce(false);

    const result = await ManageHooksFacade.execute({ action: 'disable', hook_id: 'h1' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to disable hook "Hook A"');
  });

  it('deletes hooks by unique name and reports persistence failures', async () => {
    profileCacheManagerMock.hooks = [makeHook({ id: 'h1', name: 'Unique Hook', enabled: false })];

    const deleted = await ManageHooksFacade.execute({ action: 'delete', name: 'Unique Hook' });
    expect(deleted.success).toBe(true);
    expect(deleted.removed).toMatchObject({ id: 'h1', event: 'PreToolUse', action_type: 'command' });
    expect(profileCacheManagerMock.hooks).toHaveLength(0);

    profileCacheManagerMock.hooks = [makeHook({ id: 'h2', name: 'Delete Fail', enabled: false })];
    profileCacheManagerMock.deleteHook.mockResolvedValueOnce(false);
    const failed = await ManageHooksFacade.execute({ action: 'delete', hook_id: 'h2' });
    expect(failed.success).toBe(false);
    expect(failed.message).toContain('Failed to delete hook');
  });

  it('returns status counts', async () => {
    profileCacheManagerMock.hooks = [
      makeHook({ id: 'enabled', enabled: true }),
      makeHook({ id: 'disabled', enabled: false }),
    ];

    const result = await ManageHooksFacade.execute({ action: 'status' });

    expect(result.success).toBe(true);
    expect(result.total_hooks).toBe(2);
    expect(result.enabled_hooks).toBe(1);
  });
});
