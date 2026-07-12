export {};

const capturedHandlers: Record<string, Function> = {};

vi.mock('electron', async () => ({
  ipcMain: {},
}));

vi.mock('@shared/ipc/agentHooks', async () => ({
  renderToMain: {
    bindMain: vi.fn(() => {
      return new Proxy(
        {},
        {
          get(_target, methodName: string) {
            return (handler: Function) => {
              capturedHandlers[methodName] = handler;
            };
          },
        },
      );
    }),
  },
}));

const mockProfileCacheManager = {
  getHooks: vi.fn(() => [] as any[]),
  addHook: vi.fn(async (..._args: any[]) => true),
  updateHook: vi.fn(async (..._args: any[]) => true),
  deleteHook: vi.fn(async (..._args: any[]) => true),
  getCachedProfile: vi.fn(() => null as any),
  isHooksEnabled: vi.fn(() => false),
  setHooksEnabled: vi.fn(async (..._args: any[]) => true),
};

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('crypto', async () => ({
  randomUUID: () => 'fixed-uuid',
}));

const makeCtx = (alias: string | null) => ({ currentUserAlias: alias }) as any;

const ctx = makeCtx('alice');

const validHookInput = {
  event: 'PreToolUse',
  matcher: 'read_file',
  action: { type: 'command', command: 'echo hi', if: 'execute_command(echo *)' },
} as const;

describe('registerAgentHooksIPC', () => {
  beforeAll(async () => {
    const { registerAgentHooksIPC } = await import('../agentHooksIpc');
    registerAgentHooksIPC(ctx);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ctx.currentUserAlias = 'alice';
    mockProfileCacheManager.getHooks.mockReturnValue([]);
    mockProfileCacheManager.addHook.mockResolvedValue(true);
    mockProfileCacheManager.updateHook.mockResolvedValue(true);
    mockProfileCacheManager.deleteHook.mockResolvedValue(true);
    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    mockProfileCacheManager.isHooksEnabled.mockReturnValue(false);
    mockProfileCacheManager.setHooksEnabled.mockResolvedValue(true);
  });

  it('binds the main side and registers handlers', () => {
    expect(Object.keys(capturedHandlers).sort()).toEqual(
      [
        'createHook',
        'deleteHook',
        'getMasterSwitch',
        'listHooks',
        'setMasterSwitch',
        'updateHook',
      ].sort(),
    );
  });

  it('is idempotent - re-registration does not re-bind', async () => {
    const { renderToMain } = await import('@shared/ipc/agentHooks');
    const { registerAgentHooksIPC } = await import('../agentHooksIpc');
    // beforeEach cleared mock history; an already-registered module must not bind again.
    registerAgentHooksIPC(ctx);
    expect(renderToMain.bindMain).not.toHaveBeenCalled();
  });

  describe('no current alias', () => {
    beforeEach(() => {
      ctx.currentUserAlias = null;
    });

    it('listHooks fails', async () => {
      expect(await capturedHandlers['listHooks']()).toEqual({ success: false, error: 'No current user alias set' });
    });

    it('getMasterSwitch fails', async () => {
      expect(await capturedHandlers['getMasterSwitch']()).toEqual({ success: false, enabled: false, error: 'No current user alias set' });
    });

    it('setMasterSwitch fails', async () => {
      expect(await capturedHandlers['setMasterSwitch']({}, true)).toEqual({ success: false, error: 'No current user alias set' });
    });

    it('createHook fails', async () => {
      expect(await capturedHandlers['createHook']({}, { name: 'n' })).toEqual({
        success: false,
        error: 'No current user alias set',
      });
    });

    it('updateHook fails', async () => {
      expect(await capturedHandlers['updateHook']({}, 'h1', { name: 'n' })).toEqual({
        success: false,
        error: 'No current user alias set',
      });
    });

    it('deleteHook fails', async () => {
      expect(await capturedHandlers['deleteHook']({}, 'h1')).toEqual({
        success: false,
        error: 'No current user alias set',
      });
    });

  });

  describe('listHooks', () => {
    it('returns hooks for the current alias', async () => {
      mockProfileCacheManager.getHooks.mockReturnValue([{ id: 'h1' }] as any);
      const res = await capturedHandlers['listHooks']();
      expect(res).toEqual({ success: true, data: [{ id: 'h1' }] });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.getHooks.mockImplementation(() => {
        throw new Error('boom');
      });
      const res = await capturedHandlers['listHooks']();
      expect(res).toEqual({ success: false, error: 'boom' });
    });

    it('reports "Unknown error" for a non-Error throw', async () => {
      mockProfileCacheManager.getHooks.mockImplementation(() => {
        throw 'string failure';
      });
      const res = await capturedHandlers['listHooks']();
      expect(res).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('createHook', () => {
    it('creates a hook with generated id and timestamps', async () => {
      const res = await capturedHandlers['createHook']({}, { name: 'My Hook', ...validHookInput });
      expect(mockProfileCacheManager.addHook).toHaveBeenCalledTimes(1);
      const passed = mockProfileCacheManager.addHook.mock.calls[0][1] as any;
      expect(passed.id).toBe('fixed-uuid');
      expect(passed.name).toBe('My Hook');
      expect(passed.enabled).toBe(false);
      expect(passed.event).toBe('PreToolUse');
      expect(passed.matcher).toBe('read_file');
      expect(passed.action).toEqual({ type: 'command', command: 'echo hi', if: 'execute_command(echo *)' });
      expect((passed as any).events).toBeUndefined();
      expect(passed.version).toBe('1.0.0');
      expect(passed.remoteVersion).toBe('');
      expect(passed.source).toBe('ON-DEVICE');
      expect(passed.createdAt).toBeDefined();
      expect(passed.updatedAt).toBe(passed.createdAt);
      expect(res).toMatchObject({ success: true });
      expect(res.hook.id).toBe('fixed-uuid');
    });

    it('creates hooks disabled even when input requests enabled', async () => {
      const res = await capturedHandlers['createHook']({}, { name: 'My Hook', enabled: true, ...validHookInput });

      expect(res).toMatchObject({ success: true });
      expect(mockProfileCacheManager.addHook.mock.calls[0][1].enabled).toBe(false);
      expect(res.hook.enabled).toBe(false);
    });

    it('rejects invalid input via validation', async () => {
      const res = await capturedHandlers['createHook']({}, { name: '' });
      expect(res).toEqual({ success: false, error: 'Hook name is required' });
      expect(mockProfileCacheManager.addHook).not.toHaveBeenCalled();
    });

    it('reports failure when persistence returns false', async () => {
      mockProfileCacheManager.addHook.mockResolvedValue(false);
      const res = await capturedHandlers['createHook']({}, { name: 'n', ...validHookInput });
      expect(res).toEqual({ success: false, error: 'Failed to create hook' });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.addHook.mockRejectedValue(new Error('disk full'));
      const res = await capturedHandlers['createHook']({}, { name: 'n', ...validHookInput });
      expect(res).toEqual({ success: false, error: 'disk full' });
    });
  });

  describe('updateHook', () => {
    it('updates and returns the patched hook', async () => {
      mockProfileCacheManager.getHooks.mockReturnValue([{ id: 'other' }, { id: 'h1', name: 'new' }] as any);
      const res = await capturedHandlers['updateHook']({}, 'h1', { name: 'new' });
      expect(mockProfileCacheManager.updateHook).toHaveBeenCalledWith('alice', 'h1', { name: 'new' });
      expect(res).toEqual({ success: true, hook: { id: 'h1', name: 'new' } });
    });

    it('returns success with undefined hook when the updated id is not found in the list', async () => {
      mockProfileCacheManager.getHooks.mockReturnValue([{ id: 'other' }] as any);
      const res = await capturedHandlers['updateHook']({}, 'h1', { name: 'new' });
      expect(res).toEqual({ success: true, hook: undefined });
    });

    it('rejects an empty hook id', async () => {
      const res = await capturedHandlers['updateHook']({}, '', { name: 'x' });
      expect(res).toEqual({ success: false, error: 'Hook id is required' });
    });

    it('rejects an invalid patch', async () => {
      const res = await capturedHandlers['updateHook']({}, 'h1', { enabled: 'no' });
      expect(res).toEqual({ success: false, error: 'Hook enabled must be a boolean' });
    });

    it('reports failure when persistence returns false', async () => {
      mockProfileCacheManager.updateHook.mockResolvedValue(false);
      const res = await capturedHandlers['updateHook']({}, 'h1', { name: 'x' });
      expect(res).toEqual({ success: false, error: 'Failed to update hook' });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.updateHook.mockRejectedValue(new Error('locked'));
      const res = await capturedHandlers['updateHook']({}, 'h1', { name: 'x' });
      expect(res).toEqual({ success: false, error: 'locked' });
    });
  });

  describe('deleteHook', () => {
    it('deletes a hook', async () => {
      const res = await capturedHandlers['deleteHook']({}, 'h1');
      expect(mockProfileCacheManager.deleteHook).toHaveBeenCalledWith('alice', 'h1');
      expect(res).toEqual({ success: true });
    });

    it('rejects an empty hook id', async () => {
      const res = await capturedHandlers['deleteHook']({}, '');
      expect(res).toEqual({ success: false, error: 'Hook id is required' });
    });

    it('reports failure when persistence returns false', async () => {
      mockProfileCacheManager.deleteHook.mockResolvedValue(false);
      const res = await capturedHandlers['deleteHook']({}, 'h1');
      expect(res).toEqual({ success: false, error: 'Failed to delete hook' });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.deleteHook.mockRejectedValue(new Error('nope'));
      const res = await capturedHandlers['deleteHook']({}, 'h1');
      expect(res).toEqual({ success: false, error: 'nope' });
    });
  });

  describe('getMasterSwitch', () => {
    it('returns the enabled flag', async () => {
      mockProfileCacheManager.isHooksEnabled.mockReturnValue(true);
      const res = await capturedHandlers['getMasterSwitch']();
      expect(mockProfileCacheManager.isHooksEnabled).toHaveBeenCalledWith('alice');
      expect(res).toEqual({ success: true, enabled: true });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.isHooksEnabled.mockImplementation(() => {
        throw new Error('bad profile');
      });
      const res = await capturedHandlers['getMasterSwitch']();
      expect(res).toEqual({ success: false, enabled: false, error: 'bad profile' });
    });
  });

  describe('setMasterSwitch', () => {
    it('persists the new value', async () => {
      const res = await capturedHandlers['setMasterSwitch']({}, true);
      expect(mockProfileCacheManager.setHooksEnabled).toHaveBeenCalledWith('alice', true);
      expect(res).toEqual({ success: true });
    });

    it('rejects a non-boolean value', async () => {
      const res = await capturedHandlers['setMasterSwitch']({}, 'yes');
      expect(res).toEqual({ success: false, error: 'enabled must be a boolean' });
      expect(mockProfileCacheManager.setHooksEnabled).not.toHaveBeenCalled();
    });

    it('returns an error when persistence returns false', async () => {
      mockProfileCacheManager.setHooksEnabled.mockResolvedValue(false);
      const res = await capturedHandlers['setMasterSwitch']({}, true);
      expect(res).toEqual({ success: false, error: 'Failed to update Hooks master switch' });
    });

    it('returns error on throw', async () => {
      mockProfileCacheManager.setHooksEnabled.mockRejectedValue(new Error('write failed'));
      const res = await capturedHandlers['setMasterSwitch']({}, false);
      expect(res).toEqual({ success: false, error: 'write failed' });
    });
  });
});
