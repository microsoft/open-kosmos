// @ts-nocheck
/**
 * remoteChannelIPC.ts coverage tests
 */

// ─── mock variables ───────────────────────────────────────────────────────────

const mockHandle = vi.fn();
const mockRemoveHandler = vi.fn();
const mockWcSend = vi.fn();
const mockGetAllWindows = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
    removeHandler: (...args: any[]) => mockRemoveHandler(...args),
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows(),
  },
}));

vi.mock('@shared/ipc/remoteChannel', async () => {
  const { connectRenderToMain, connectMainToRender } = await import('../../../../shared/ipc/base');
  return {
    renderToMain: connectRenderToMain('remoteChannel'),
    mainToRender: connectMainToRender('remoteChannel'),
  };
});

const mockGetCachedProfile = vi.fn();
const mockUpdateRemoteChannelsConfig = vi.fn();

vi.mock('../../userDataADO/profileCacheManager', () => ({}));

const mockGetChannelStatus = vi.fn();
const mockGetAllChannelStatus = vi.fn();
const mockStartChannel = vi.fn();
const mockStopChannel = vi.fn();
const mockRestartChannel = vi.fn();
const mockBind = vi.fn();
const mockUnbind = vi.fn();

vi.mock('../channelManager', () => ({}));

const mockGetCredential = vi.fn();

vi.mock('../credentialStore', () => ({
  credentialStore: {
    getCredential: (...args: any[]) => mockGetCredential(...args),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for: ${channel}`);
  return call[1];
}

function makeDeps(overrides: Partial<{
  alias: string | null;
  profile: any;
  channelManager: any;
}> = {}) {
  const alias = 'alias' in overrides ? overrides.alias : 'testuser';
  const profile = overrides.profile ?? { remoteChannels: { teams: {} } };
  const channelManager = overrides.channelManager ?? {
    getChannelStatus: (...args: any[]) => mockGetChannelStatus(...args),
    getAllChannelStatus: (...args: any[]) => mockGetAllChannelStatus(...args),
    startChannel: (...args: any[]) => mockStartChannel(...args),
    stopChannel: (...args: any[]) => mockStopChannel(...args),
    restartChannel: (...args: any[]) => mockRestartChannel(...args),
    bind: (...args: any[]) => mockBind(...args),
    unbind: (...args: any[]) => mockUnbind(...args),
  };

  return {
    getAlias: () => alias,
    getProfileCacheManager: async () => ({
      getCachedProfile: (...args: any[]) => mockGetCachedProfile(...args),
      updateRemoteChannelsConfig: (...args: any[]) => mockUpdateRemoteChannelsConfig(...args),
    }),
    getRemoteChannelManager: async () => channelManager,
    _profile: profile,
  };
}

async function setup(deps: ReturnType<typeof makeDeps>) {
  vi.clearAllMocks();
  mockGetCachedProfile.mockReturnValue(deps._profile);
  mockUpdateRemoteChannelsConfig.mockResolvedValue(undefined);
  mockGetChannelStatus.mockReturnValue(null);
  mockGetAllChannelStatus.mockReturnValue([]);
  mockStartChannel.mockResolvedValue(undefined);
  mockStopChannel.mockResolvedValue(undefined);
  mockRestartChannel.mockResolvedValue(undefined);
  mockBind.mockResolvedValue({ userId: 'user-123' });
  mockUnbind.mockResolvedValue(undefined);
  mockGetCredential.mockResolvedValue(null);

  const { registerRemoteChannelIPC } = await import('../remoteChannelIPC');
  registerRemoteChannelIPC(deps);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('remoteChannelIPC coverage tests', () => {
  afterEach(() => vi.resetModules());

  // ── getConfig ───────────────────────────────────────────────────────────────

  describe('remoteChannel:getConfig', () => {
    it('returns config on success', async () => {
      const deps = makeDeps();
      await setup(deps);
      const handler = getHandler('remoteChannel:getConfig');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ teams: {} });
    });

    it('returns empty object when no remoteChannels on profile', async () => {
      const deps = makeDeps({ profile: { remoteChannels: undefined } });
      await setup(deps);
      const handler = getHandler('remoteChannel:getConfig');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('returns null profile gracefully', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetCachedProfile.mockReturnValue(null);
      const handler = getHandler('remoteChannel:getConfig');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('returns error when not logged in', async () => {
      const deps = makeDeps({ alias: null });
      await setup(deps);
      const handler = getHandler('remoteChannel:getConfig');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not logged in');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetCachedProfile.mockImplementationOnce(() => { throw new Error('DB error'); });
      const handler = getHandler('remoteChannel:getConfig');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });

  // ── updateConfig ────────────────────────────────────────────────────────────

  describe('remoteChannel:updateConfig', () => {
    it('returns success when no running channels', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockReturnValue(null);
      const handler = getHandler('remoteChannel:updateConfig');
      const result = await handler({}, { teams: {} });
      expect(result.success).toBe(true);
    });

    it('restarts running channels', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockReturnValue({ status: 'running' });
      const handler = getHandler('remoteChannel:updateConfig');
      const result = await handler({}, { teams: {} });
      expect(result.success).toBe(true);
      expect(mockRestartChannel).toHaveBeenCalledWith('teams');
    });

    it('does not restart stopped channels', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
      const handler = getHandler('remoteChannel:updateConfig');
      await handler({}, { teams: {} });
      expect(mockRestartChannel).not.toHaveBeenCalled();
    });

    it('returns error when not logged in', async () => {
      const deps = makeDeps({ alias: null });
      await setup(deps);
      const handler = getHandler('remoteChannel:updateConfig');
      const result = await handler({}, { teams: {} });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not logged in');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockUpdateRemoteChannelsConfig.mockRejectedValueOnce(new Error('Update error'));
      const handler = getHandler('remoteChannel:updateConfig');
      const result = await handler({}, { teams: {} });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Update error');
    });
  });

  // ── getStatus ───────────────────────────────────────────────────────────────

  describe('remoteChannel:getStatus', () => {
    it('returns channel status', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockReturnValue({ channelId: 'teams', status: 'running' });
      const handler = getHandler('remoteChannel:getStatus');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ status: 'running' });
    });

    it('returns null when channel not found', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockReturnValue(null);
      const handler = getHandler('remoteChannel:getStatus');
      const result = await handler({}, 'unknown');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetChannelStatus.mockImplementationOnce(() => { throw new Error('Status error'); });
      const handler = getHandler('remoteChannel:getStatus');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(false);
    });
  });

  // ── getAllStatus ────────────────────────────────────────────────────────────

  describe('remoteChannel:getAllStatus', () => {
    it('returns all channel statuses', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetAllChannelStatus.mockReturnValue([{ channelId: 'teams', status: 'stopped' }]);
      const handler = getHandler('remoteChannel:getAllStatus');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetAllChannelStatus.mockImplementationOnce(() => { throw new Error('Get all error'); });
      const handler = getHandler('remoteChannel:getAllStatus');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── start ───────────────────────────────────────────────────────────────────

  describe('remoteChannel:start', () => {
    it('starts channel successfully', async () => {
      const deps = makeDeps();
      await setup(deps);
      const handler = getHandler('remoteChannel:start');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(true);
      expect(mockStartChannel).toHaveBeenCalledWith('teams');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockStartChannel.mockRejectedValueOnce(new Error('Start error'));
      const handler = getHandler('remoteChannel:start');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(false);
    });
  });

  // ── stop ────────────────────────────────────────────────────────────────────

  describe('remoteChannel:stop', () => {
    it('stops channel successfully', async () => {
      const deps = makeDeps();
      await setup(deps);
      const handler = getHandler('remoteChannel:stop');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(true);
      expect(mockStopChannel).toHaveBeenCalledWith('teams');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockStopChannel.mockRejectedValueOnce(new Error('Stop error'));
      const handler = getHandler('remoteChannel:stop');
      const result = await handler({}, 'teams');
      expect(result.success).toBe(false);
    });
  });

  // ── bind ────────────────────────────────────────────────────────────────────

  describe('remoteChannel:bind', () => {
    it('returns userId on success', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockBind.mockResolvedValueOnce({ userId: 'u-1' });
      const handler = getHandler('remoteChannel:bind');
      const result = await handler({}, { channelId: 'teams', code: 'abc123' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ userId: 'u-1' });
    });

    it('returns error when not logged in', async () => {
      const deps = makeDeps({ alias: null });
      await setup(deps);
      const handler = getHandler('remoteChannel:bind');
      const result = await handler({}, { channelId: 'teams', code: 'abc123' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not logged in');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockBind.mockRejectedValueOnce(new Error('Bind error'));
      const handler = getHandler('remoteChannel:bind');
      const result = await handler({}, { channelId: 'teams', code: 'abc123' });
      expect(result.success).toBe(false);
    });
  });

  // ── unbind ──────────────────────────────────────────────────────────────────

  describe('remoteChannel:unbind', () => {
    it('unbinds successfully', async () => {
      const deps = makeDeps();
      await setup(deps);
      const handler = getHandler('remoteChannel:unbind');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(true);
      expect(mockUnbind).toHaveBeenCalledWith('teams');
    });

    it('returns error when not logged in', async () => {
      const deps = makeDeps({ alias: null });
      await setup(deps);
      const handler = getHandler('remoteChannel:unbind');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not logged in');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockUnbind.mockRejectedValueOnce(new Error('Unbind error'));
      const handler = getHandler('remoteChannel:unbind');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(false);
    });
  });

  // ── getBindingStatus ────────────────────────────────────────────────────────

  describe('remoteChannel:getBindingStatus', () => {
    it('returns bound=false when no token', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetCredential.mockResolvedValue(null);
      const handler = getHandler('remoteChannel:getBindingStatus');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(true);
      expect(result.data.bound).toBe(false);
      expect(result.data.userId).toBeUndefined();
    });

    it('returns bound=true with userId when token and userId exist', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetCredential
        .mockResolvedValueOnce('some-token')  // bindingToken
        .mockResolvedValueOnce('user-123');   // boundUserId
      const handler = getHandler('remoteChannel:getBindingStatus');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(true);
      expect(result.data.bound).toBe(true);
      expect(result.data.userId).toBe('user-123');
    });

    it('returns error when not logged in', async () => {
      const deps = makeDeps({ alias: null });
      await setup(deps);
      const handler = getHandler('remoteChannel:getBindingStatus');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not logged in');
    });

    it('returns error on exception', async () => {
      const deps = makeDeps();
      await setup(deps);
      mockGetCredential.mockRejectedValueOnce(new Error('Credential error'));
      const handler = getHandler('remoteChannel:getBindingStatus');
      const result = await handler({}, { channelId: 'teams' });
      expect(result.success).toBe(false);
    });
  });

  // ── broadcastRemoteChannelStatus ────────────────────────────────────────────

  describe('broadcastRemoteChannelStatus', () => {
    it('sends statusChanged to all non-destroyed windows', async () => {
      const { broadcastRemoteChannelStatus } = await import('../remoteChannelIPC');
      const fakeWc = { send: mockWcSend };
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: fakeWc },
        { isDestroyed: () => true, webContents: fakeWc },
      ]);
      const info = { channelId: 'teams', status: 'running' as const };
      broadcastRemoteChannelStatus(info);
      expect(mockWcSend).toHaveBeenCalledWith('remoteChannel:statusChanged', info);
      expect(mockWcSend).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no windows', async () => {
      const { broadcastRemoteChannelStatus } = await import('../remoteChannelIPC');
      mockWcSend.mockClear();
      mockGetAllWindows.mockReturnValue([]);
      broadcastRemoteChannelStatus({ channelId: 'teams', status: 'stopped' as const });
      expect(mockWcSend).not.toHaveBeenCalled();
    });
  });

  // ── broadcastBindingChanged ─────────────────────────────────────────────────

  describe('broadcastBindingChanged', () => {
    it('sends bindingChanged to all non-destroyed windows', async () => {
      const { broadcastBindingChanged } = await import('../remoteChannelIPC');
      const fakeWc = { send: mockWcSend };
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: fakeWc },
      ]);
      const info = { channelId: 'teams', bound: true };
      broadcastBindingChanged(info);
      expect(mockWcSend).toHaveBeenCalledWith('remoteChannel:bindingChanged', info);
    });
  });
});
