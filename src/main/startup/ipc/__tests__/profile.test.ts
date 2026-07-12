import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => (mockHandle as any)(...args) },
  shell: { openExternal: (...args: any[]) => (mockOpenExternal as any)(...args) },
}));

// --- profile cache manager mock ---
const mockGetCachedProfile = vi.fn();
const mockForceNotifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
const mockUpdatePrimaryChat = vi.fn().mockResolvedValue(true);
const mockUpdateFreDone = vi.fn().mockResolvedValue(true);
const mockUpdateConfirmationSettings = vi.fn().mockResolvedValue(true);
const mockUpdateBrowserSettings = vi.fn().mockResolvedValue(true);
const mockUpdateMemexSettings = vi.fn().mockResolvedValue(true);
const mockUpdateComputerUseSettings = vi.fn().mockResolvedValue(true);
const mockAddChatConfig = vi.fn().mockResolvedValue(true);
const mockUpdateChatConfig = vi.fn().mockResolvedValue(true);
const mockDeleteChatConfig = vi.fn().mockResolvedValue(true);
const mockArchiveChatConfig = vi.fn().mockResolvedValue(true);
const mockUnarchiveChatConfig = vi.fn().mockResolvedValue({ success: true });
const mockGetArchivedAgents = vi.fn(() => []);
const mockGetChatConfig = vi.fn(() => ({ chat_id: 'c1' }));
const mockGetAllChatConfigs = vi.fn(() => []);
const mockUpdateChatAgent = vi.fn().mockResolvedValue(true);
const mockSaveChatSession = vi.fn().mockResolvedValue(true);
const mockDeleteChatSession = vi.fn().mockResolvedValue(true);
const mockGetChatSessionFile = vi.fn().mockResolvedValue({ messages: [] });
const mockSyncStarredChatSessionIndex = vi.fn().mockResolvedValue(undefined);
const mockGetRegisteredAgents = vi.fn<(alias: string) => any[]>(() => []);

const mockPcManager = {
  getCachedProfile: (...args: any[]) => (mockGetCachedProfile as any)(...args),
  forceNotifyProfileDataManager: (...args: any[]) => (mockForceNotifyProfileDataManager as any)(...args),
  updatePrimaryChat: (...args: any[]) => (mockUpdatePrimaryChat as any)(...args),
  updateFreDone: (...args: any[]) => (mockUpdateFreDone as any)(...args),
  updateConfirmationSettings: (...args: any[]) => (mockUpdateConfirmationSettings as any)(...args),
  updateBrowserSettings: (...args: any[]) => (mockUpdateBrowserSettings as any)(...args),
  updateMemexSettings: (...args: any[]) => (mockUpdateMemexSettings as any)(...args),
  updateComputerUseSettings: (...args: any[]) => (mockUpdateComputerUseSettings as any)(...args),
  addChatConfig: (...args: any[]) => (mockAddChatConfig as any)(...args),
  updateChatConfig: (...args: any[]) => (mockUpdateChatConfig as any)(...args),
  deleteChatConfig: (...args: any[]) => (mockDeleteChatConfig as any)(...args),
  archiveChatConfig: (...args: any[]) => (mockArchiveChatConfig as any)(...args),
  unarchiveChatConfig: (...args: any[]) => (mockUnarchiveChatConfig as any)(...args),
  getArchivedAgents: (...args: any[]) => (mockGetArchivedAgents as any)(...args),
  getChatConfig: (...args: any[]) => (mockGetChatConfig as any)(...args),
  getAllChatConfigs: (...args: any[]) => (mockGetAllChatConfigs as any)(...args),
  updateChatAgent: (...args: any[]) => (mockUpdateChatAgent as any)(...args),
  saveChatSession: (...args: any[]) => (mockSaveChatSession as any)(...args),
  deleteChatSession: (...args: any[]) => (mockDeleteChatSession as any)(...args),
  getChatSessionFile: (...args: any[]) => (mockGetChatSessionFile as any)(...args),
  syncStarredChatSessionIndex: (...args: any[]) => (mockSyncStarredChatSessionIndex as any)(...args),
  getRegisteredAgents: (...args: any[]) => (mockGetRegisteredAgents as any)(...args),
};

const mockGetProfileCacheManager = vi.fn().mockResolvedValue(mockPcManager);

vi.mock('../../lazy', () => ({
  getProfileCacheManager: (...args: any[]) => (mockGetProfileCacheManager as any)(...args),
}));

const mockDestroyEmbeddedBrowserSession = vi.fn();
const mockDestroyAllEmbeddedBrowser = vi.fn();
vi.mock('../../../lib/embeddedBrowser/EmbeddedBrowserManager', () => ({
  getEmbeddedBrowserManager: vi.fn(() => ({
    destroySession: (...args: any[]) => (mockDestroyEmbeddedBrowserSession as any)(...args),
    destroyAll: (...args: any[]) => (mockDestroyAllEmbeddedBrowser as any)(...args),
  })),
}));

// --- mcp client manager mock ---
const mockMcpAdd = vi.fn().mockResolvedValue(undefined);
const mockMcpUpdate = vi.fn().mockResolvedValue(undefined);
const mockMcpDelete = vi.fn().mockResolvedValue(undefined);
const mockMcpConnect = vi.fn().mockResolvedValue(undefined);
const mockMcpReconnect = vi.fn().mockResolvedValue(undefined);
const mockMcpDisconnect = vi.fn().mockResolvedValue(undefined);
const mockRefreshBuiltin = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    add: (...args: any[]) => (mockMcpAdd as any)(...args),
    update: (...args: any[]) => (mockMcpUpdate as any)(...args),
    delete: (...args: any[]) => (mockMcpDelete as any)(...args),
    connect: (...args: any[]) => (mockMcpConnect as any)(...args),
    reconnect: (...args: any[]) => (mockMcpReconnect as any)(...args),
    disconnect: (...args: any[]) => (mockMcpDisconnect as any)(...args),
    refreshBuiltinTools: (...args: any[]) => (mockRefreshBuiltin as any)(...args),
  },
}));

vi.mock('../../../lib/chat/chatSessionStore', () => ({
  chatSessionStore: {
    renameSession: vi.fn().mockResolvedValue({ metadata: {} }),
    setStarred: vi.fn().mockResolvedValue({ metadata: {} }),
    getUnreadSummary: vi.fn().mockResolvedValue({ unread: 0 }),
  },
}));

vi.mock('../../../lib/chat/agentChatManager', () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({
      updateSessionTitle: vi.fn(),
    })),
  },
}));

vi.mock('../../../lib/userDataADO/chatSessionManager', () => ({
  chatSessionManager: {
    getChatSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getMoreChatSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getAllScheduledSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0, hasMore: false }),
  },
}));

const mockRecordMcpServerAdded = vi.fn();
const mockRecordAgentCreated = vi.fn();

vi.mock('../../../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: {
    toggleJobsByAgent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/utilities/safeConsole', () => ({
  safeConsole: { warn: vi.fn(), error: vi.fn() },
}));

const mockGetPermissionStatus = vi.fn();
vi.mock('../../../lib/computerUse/permissions', () => ({
  getPermissionStatus: (...args: any[]) => (mockGetPermissionStatus as any)(...args),
}));

const mockGetComputerUseUnsupportedReason = vi.fn<() => string | null>(() => null);
const mockGetComputerUsePlatformSupport = vi.fn(() => ({
  platform: 'darwin',
  arch: 'arm64',
  platformSupported: true,
}));
vi.mock('../../../lib/computerUse/platformSupport', () => ({
  getComputerUseUnsupportedReason: (...args: any[]) => (mockGetComputerUseUnsupportedReason as any)(...args),
  getComputerUsePlatformSupport: (...args: any[]) => (mockGetComputerUsePlatformSupport as any)(...args),
}));

const mockGetServers = vi.fn<(alias: string) => any[]>(() => []);
vi.mock('../../../lib/userDataADO/mcpConfigManager', () => ({
  mcpConfigManager: {
    getServers: (...args: any[]) => (mockGetServers as any)(...args),
  },
}));

const mockGetSkills = vi.fn<(alias: string) => any[]>(() => []);
vi.mock('../../../lib/userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: (...args: any[]) => (mockGetSkills as any)(...args),
  },
}));

const mockGetHooks = vi.fn<(alias: string) => any[]>(() => []);
vi.mock('../../../lib/userDataADO/hooksConfigManager', () => ({
  hooksConfigManager: {
    getHooks: (...args: any[]) => (mockGetHooks as any)(...args),
  },
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

const baseCtx = {
  currentUserAlias: 'alice',
};

describe('startup/ipc/profile', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetProfileCacheManager.mockResolvedValue(mockPcManager);
    mockGetComputerUseUnsupportedReason.mockReturnValue(null);
    mockGetComputerUsePlatformSupport.mockReturnValue({
      platform: 'darwin',
      arch: 'arm64',
      platformSupported: true,
    });
    const { default: registerProfileIPC } = await import('../profile');
    registerProfileIPC({ ...baseCtx } as any);
  });

  // --- profile:getProfile ---

  it('profile:getProfile returns profile when found', async () => {
    mockGetCachedProfile.mockReturnValue({ alias: 'alice', name: 'Alice' });
    mockGetServers.mockReturnValue([{ name: 'srv1', command: 'node' }]);
    mockGetSkills.mockReturnValue([{ name: 'web-search', version: '1.0.0' }]);
    mockGetHooks.mockReturnValue([{ id: 'hook1', event: 'onSessionStart' }]);
    const result = await getHandler('profile:getProfile')({}, 'alice');
    expect(result).toEqual({
      success: true,
      data: {
        alias: 'alice',
        name: 'Alice',
        mcp_servers: [{ name: 'srv1', command: 'node' }],
        skills: [{ name: 'web-search', version: '1.0.0' }],
        hooks: [{ id: 'hook1', event: 'onSessionStart' }],
      },
    });
    expect(mockForceNotifyProfileDataManager).toHaveBeenCalledWith('alice');
    expect(mockGetServers).toHaveBeenCalledWith('alice');
    expect(mockGetSkills).toHaveBeenCalledWith('alice');
    expect(mockGetHooks).toHaveBeenCalledWith('alice');
  });

  it('profile:getProfile re-injects an empty installed server set, skill registry, and Hook library when the managers have none', async () => {
    mockGetCachedProfile.mockReturnValue({ alias: 'alice', name: 'Alice' });
    mockGetServers.mockReturnValue([]);
    mockGetSkills.mockReturnValue([]);
    mockGetHooks.mockReturnValue([]);
    const result = await getHandler('profile:getProfile')({}, 'alice');
    expect(result).toEqual({ success: true, data: { alias: 'alice', name: 'Alice', mcp_servers: [], skills: [], hooks: [] } });
  });

  it('profile:getProfile re-injects inline agents into agent_ids-only chats from the registry', async () => {
    const agent = { id: 'a1', name: 'Alpha', model: 'gpt-4' };
    mockGetCachedProfile.mockReturnValue({
      alias: 'alice',
      chats: [{ chat_id: 'c1', chat_type: 'single_agent', agent_ids: ['a1'] }],
    });
    mockGetRegisteredAgents.mockReturnValue([agent]);
    mockGetServers.mockReturnValue([]);
    mockGetSkills.mockReturnValue([]);
    mockGetHooks.mockReturnValue([]);
    const result = await getHandler('profile:getProfile')({}, 'alice');
    expect(result.success).toBe(true);
    expect(mockGetRegisteredAgents).toHaveBeenCalledWith('alice');
    expect(result.data.chats[0].agent).toEqual(agent);
  });

  it('profile:getProfile returns error when not found', async () => {
    mockGetCachedProfile.mockReturnValue(null);
    const result = await getHandler('profile:getProfile')({}, 'unknown');
    expect(result).toEqual({ success: false, error: 'Profile not found' });
  });

  it('profile:getProfile returns error on exception', async () => {
    mockGetProfileCacheManager.mockRejectedValueOnce(new Error('db fail'));
    const result = await getHandler('profile:getProfile')({}, 'alice');
    expect(result).toEqual({ success: false, error: 'db fail' });
  });

  // --- normalized sidecar pulls (agents:getAll / skills:getAll / hooks:getAll) ---

  it('agents:getAll returns the registered agents for the alias', async () => {
    mockGetRegisteredAgents.mockReturnValue([{ id: 'a1', name: 'A1' }]);
    const result = await getHandler('agents:getAll')({}, 'alice');
    expect(mockGetRegisteredAgents).toHaveBeenCalledWith('alice');
    expect(result).toEqual({ success: true, data: [{ id: 'a1', name: 'A1' }] });
  });

  it('agents:getAll returns error on exception', async () => {
    mockGetProfileCacheManager.mockRejectedValueOnce(new Error('reg fail'));
    const result = await getHandler('agents:getAll')({}, 'alice');
    expect(result).toEqual({ success: false, error: 'reg fail' });
  });

  it('skills:getAll returns the skills for the alias', async () => {
    mockGetSkills.mockReturnValue([{ name: 'web-search' }]);
    const result = await getHandler('skills:getAll')({}, 'alice');
    expect(mockGetSkills).toHaveBeenCalledWith('alice');
    expect(result).toEqual({ success: true, data: [{ name: 'web-search' }] });
  });

  it('skills:getAll returns error on exception', async () => {
    mockGetSkills.mockImplementationOnce(() => {
      throw new Error('skills fail');
    });
    const result = await getHandler('skills:getAll')({}, 'alice');
    expect(result).toEqual({ success: false, error: 'skills fail' });
  });

  it('hooks:getAll returns the hooks for the alias', async () => {
    mockGetHooks.mockReturnValue([{ id: 'hook1' }]);
    const result = await getHandler('hooks:getAll')({}, 'alice');
    expect(mockGetHooks).toHaveBeenCalledWith('alice');
    expect(result).toEqual({ success: true, data: [{ id: 'hook1' }] });
  });

  it('hooks:getAll returns error on exception', async () => {
    mockGetHooks.mockImplementationOnce(() => {
      throw new Error('hooks fail');
    });
    const result = await getHandler('hooks:getAll')({}, 'alice');
    expect(result).toEqual({ success: false, error: 'hooks fail' });
  });

  // --- profile:setPrimaryChat ---

  it('profile:setPrimaryChat succeeds', async () => {
    const result = await getHandler('profile:setPrimaryChat')({}, 'chat1');
    expect(result).toEqual({ success: true });
    expect(mockUpdatePrimaryChat).toHaveBeenCalledWith('alice', 'chat1');
  });

  it('profile:setPrimaryChat returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:setPrimaryChat')({}, 'chat1');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // --- profile:updateFreDone ---

  it('profile:updateFreDone succeeds', async () => {
    const result = await getHandler('profile:updateFreDone')({}, 'alice', true);
    expect(result).toEqual({ success: true });
    expect(mockUpdateFreDone).toHaveBeenCalledWith('alice', true);
  });

  // --- profile:updateConfirmationSettings ---

  it('profile:updateConfirmationSettings succeeds', async () => {
    const result = await getHandler('profile:updateConfirmationSettings')({}, 'alice', { confirm: true });
    expect(result).toEqual({ success: true });
  });

  // --- profile:updateBrowserSettings ---

  it('profile:updateBrowserSettings succeeds when enabling', async () => {
    const result = await getHandler('profile:updateBrowserSettings')({}, 'alice', { enabled: true });
    expect(mockUpdateBrowserSettings).toHaveBeenCalledWith('alice', { enabled: true });
    expect(mockDestroyAllEmbeddedBrowser).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('profile:updateBrowserSettings tears down live views when disabling', async () => {
    mockUpdateBrowserSettings.mockResolvedValueOnce(true);
    const result = await getHandler('profile:updateBrowserSettings')({}, 'alice', { enabled: false });
    expect(mockDestroyAllEmbeddedBrowser).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('profile:updateBrowserSettings does not tear down when the write fails', async () => {
    mockUpdateBrowserSettings.mockResolvedValueOnce(false);
    const result = await getHandler('profile:updateBrowserSettings')({}, 'alice', { enabled: false });
    expect(mockDestroyAllEmbeddedBrowser).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false });
  });

  it('profile:updateBrowserSettings returns error on throw', async () => {
    mockUpdateBrowserSettings.mockRejectedValueOnce(new Error('boom'));
    const result = await getHandler('profile:updateBrowserSettings')({}, 'alice', { enabled: true });
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  // --- profile:updateMemexSettings ---

  it('profile:updateMemexSettings succeeds', async () => {
    const result = await getHandler('profile:updateMemexSettings')({}, 'alice', { enabled: true });
    expect(mockUpdateMemexSettings).toHaveBeenCalledWith('alice', { enabled: true });
    expect(result).toEqual({ success: true });
  });

  it('profile:updateMemexSettings returns error on throw', async () => {
    mockUpdateMemexSettings.mockRejectedValueOnce(new Error('nope'));
    const result = await getHandler('profile:updateMemexSettings')({}, 'alice', { enabled: false });
    expect(result).toEqual({ success: false, error: 'nope' });
  });

  // --- profile:updateComputerUseSettings ---

  it('profile:updateComputerUseSettings persists and refreshes the builtin tool set', async () => {
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', { enabled: true });
    expect(mockUpdateComputerUseSettings).toHaveBeenCalledWith('alice', { enabled: true });
    expect(mockRefreshBuiltin).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('profile:updateComputerUseSettings rejects alias mismatches', async () => {
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'bob', { enabled: true });
    expect(result).toEqual({
      success: false,
      error: 'Computer Use settings can only be updated for the current profile',
    });
    expect(mockUpdateComputerUseSettings).not.toHaveBeenCalled();
    expect(mockRefreshBuiltin).not.toHaveBeenCalled();
  });

  it('profile:updateComputerUseSettings rejects malformed settings patches', async () => {
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', {
      enabled: 'true',
      alwaysAllowedApps: ['Safari'],
    });
    expect(result).toEqual({ success: false, error: 'Invalid Computer Use settings' });
    expect(mockUpdateComputerUseSettings).not.toHaveBeenCalled();
    expect(mockRefreshBuiltin).not.toHaveBeenCalled();
  });

  it('profile:updateComputerUseSettings normalizes allowlists before persisting', async () => {
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', {
      alwaysAllowedApps: ['Safari', ' ', 'Notes'],
    });
    expect(result).toEqual({ success: true });
    expect(mockUpdateComputerUseSettings).toHaveBeenCalledWith('alice', {
      alwaysAllowedApps: ['Safari', 'Notes'],
    });
    expect(mockRefreshBuiltin).toHaveBeenCalledTimes(1);
  });

  it('profile:updateComputerUseSettings does not refresh when the save does not persist', async () => {
    mockUpdateComputerUseSettings.mockResolvedValueOnce(false);
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', { enabled: true });
    expect(mockRefreshBuiltin).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false });
  });

  it('profile:updateComputerUseSettings still succeeds when the tool refresh fails', async () => {
    mockRefreshBuiltin.mockRejectedValueOnce(new Error('refresh boom'));
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', { enabled: false });
    // A best-effort refresh failure must NOT flip the already-persisted save result.
    expect(mockRefreshBuiltin).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('profile:updateComputerUseSettings blocks enabling on unsupported platforms', async () => {
    mockGetComputerUseUnsupportedReason.mockReturnValueOnce('Computer Use is unavailable on Windows ARM64.');

    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', { enabled: true });

    expect(result).toEqual({ success: false, error: 'Computer Use is unavailable on Windows ARM64.' });
    expect(mockUpdateComputerUseSettings).not.toHaveBeenCalled();
    expect(mockRefreshBuiltin).not.toHaveBeenCalled();
  });

  it('profile:updateComputerUseSettings returns error when the save throws', async () => {
    mockUpdateComputerUseSettings.mockRejectedValueOnce(new Error('persist fail'));
    const result = await getHandler('profile:updateComputerUseSettings')({}, 'alice', { enabled: true });
    expect(mockRefreshBuiltin).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'persist fail' });
  });

  // --- computerUse:getPermissionStatus ---

  it('computerUse:getPermissionStatus returns status without prompting when prompt is false', async () => {
    mockGetPermissionStatus.mockReturnValue({ screenRecording: 'granted', accessibility: true });
    const result = await getHandler('computerUse:getPermissionStatus')({}, false);
    expect(mockGetPermissionStatus).toHaveBeenCalledWith(false);
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      status: { screenRecording: 'granted', accessibility: true, platform: 'darwin', arch: 'arm64', platformSupported: true },
    });
  });

  it('computerUse:getPermissionStatus does not open System Settings when screen recording is granted', async () => {
    mockGetPermissionStatus.mockReturnValue({ screenRecording: 'granted', accessibility: false });
    const result = await getHandler('computerUse:getPermissionStatus')({}, true);
    expect(mockGetPermissionStatus).toHaveBeenCalledWith(true);
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      status: { screenRecording: 'granted', accessibility: false, platform: 'darwin', arch: 'arm64', platformSupported: true },
    });
  });

  it('computerUse:getPermissionStatus opens the Screen Recording pane when prompting and not granted', async () => {
    mockGetPermissionStatus.mockReturnValue({ screenRecording: 'denied', accessibility: true });
    const result = await getHandler('computerUse:getPermissionStatus')({}, true);
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    expect(result).toEqual({
      success: true,
      status: { screenRecording: 'denied', accessibility: true, platform: 'darwin', arch: 'arm64', platformSupported: true },
    });
  });

  it('computerUse:getPermissionStatus still returns status when opening System Settings fails', async () => {
    mockGetPermissionStatus.mockReturnValue({ screenRecording: 'denied', accessibility: false });
    mockOpenExternal.mockRejectedValueOnce(new Error('no opener'));
    const result = await getHandler('computerUse:getPermissionStatus')({}, true);
    // A best-effort openExternal failure must not fail the status read.
    expect(result).toEqual({
      success: true,
      status: { screenRecording: 'denied', accessibility: false, platform: 'darwin', arch: 'arm64', platformSupported: true },
    });
  });

  it('computerUse:getPermissionStatus returns an error when the status read throws', async () => {
    mockGetPermissionStatus.mockImplementation(() => {
      throw new Error('perm boom');
    });
    const result = await getHandler('computerUse:getPermissionStatus')({}, false);
    expect(result).toEqual({ success: false, error: 'perm boom' });
  });

  it('profile:addMcpServer returns error on failure', async () => {
    mockMcpAdd.mockRejectedValueOnce(new Error('add fail'));
    const result = await getHandler('profile:addMcpServer')({}, 'srv', {});
    expect(result).toEqual({ success: false, error: 'add fail' });
  });

  it('profile:updateMcpServer calls mcpClientManager.update', async () => {
    const result = await getHandler('profile:updateMcpServer')({}, 'srv', { command: 'python' });
    expect(mockMcpUpdate).toHaveBeenCalledWith('srv', { command: 'python' });
    expect(result).toEqual({ success: true });
  });

  it('profile:deleteMcpServer calls mcpClientManager.delete', async () => {
    const result = await getHandler('profile:deleteMcpServer')({}, 'srv');
    expect(mockMcpDelete).toHaveBeenCalledWith('srv');
    expect(result).toEqual({ success: true });
  });

  it('profile:connectMcpServer calls mcpClientManager.connect', async () => {
    const result = await getHandler('profile:connectMcpServer')({}, 'srv');
    expect(mockMcpConnect).toHaveBeenCalledWith('srv');
    expect(result).toEqual({ success: true });
  });

  it('profile:reconnectMcpServer calls mcpClientManager.reconnect', async () => {
    const result = await getHandler('profile:reconnectMcpServer')({}, 'srv');
    expect(mockMcpReconnect).toHaveBeenCalledWith('srv');
    expect(result).toEqual({ success: true });
  });

  it('profile:disconnectMcpServer calls mcpClientManager.disconnect', async () => {
    const result = await getHandler('profile:disconnectMcpServer')({}, 'srv');
    expect(mockMcpDisconnect).toHaveBeenCalledWith('srv');
    expect(result).toEqual({ success: true });
  });

  // --- Chat config handlers ---

  it('profile:addChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:addChatConfig')({}, { chat_id: 'c1' });
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  it('profile:updateChatConfig succeeds', async () => {
    const result = await getHandler('profile:updateChatConfig')({}, 'c1', { name: 'Bot' });
    expect(result).toEqual({ success: true });
    expect(mockUpdateChatConfig).toHaveBeenCalledWith('alice', 'c1', { name: 'Bot' });
  });

  it('profile:deleteChatConfig succeeds', async () => {
    const result = await getHandler('profile:deleteChatConfig')({}, 'c1');
    expect(result).toEqual({ success: true });
  });

  it('profile:deleteChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:deleteChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  it('profile:archiveChatConfig succeeds and disables scheduler jobs', async () => {
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    const result = await getHandler('profile:archiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: true });
    expect(schedulerManager.toggleJobsByAgent).toHaveBeenCalledWith('c1', false);
  });

  it('profile:archiveChatConfig logs scheduler disable failures without failing', async () => {
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    vi.mocked(schedulerManager.toggleJobsByAgent).mockRejectedValueOnce(new Error('disable failed'));

    const result = await getHandler('profile:archiveChatConfig')({}, 'c1');
    await Promise.resolve();

    expect(result).toEqual({ success: true });
  });

  it('profile:archiveChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:archiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  it('profile:unarchiveChatConfig succeeds and re-enables scheduler jobs', async () => {
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    const result = await getHandler('profile:unarchiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: true });
    expect(schedulerManager.toggleJobsByAgent).toHaveBeenCalledWith('c1', true);
  });

  it('profile:unarchiveChatConfig logs scheduler re-enable failures without failing', async () => {
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    vi.mocked(schedulerManager.toggleJobsByAgent).mockRejectedValueOnce(new Error('enable failed'));

    const result = await getHandler('profile:unarchiveChatConfig')({}, 'c1');
    await Promise.resolve();

    expect(result).toEqual({ success: true });
  });

  it('profile:getArchivedAgents returns data', async () => {
    mockGetArchivedAgents.mockReturnValue([{ chat_id: 'old' }] as any);
    const result = await getHandler('profile:getArchivedAgents')();
    expect(result).toEqual({ success: true, data: [{ chat_id: 'old' }] });
  });

  it('profile:getChatConfig returns data', async () => {
    const result = await getHandler('profile:getChatConfig')({}, 'c1');
    expect(result).toEqual({ success: true, data: { chat_id: 'c1' } });
  });

  it('profile:getAllChatConfigs returns data', async () => {
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'c1' }] as any);
    const result = await getHandler('profile:getAllChatConfigs')();
    expect(result).toEqual({ success: true, data: [{ chat_id: 'c1' }] });
  });

  it('profile:updateChatAgent succeeds', async () => {
    const result = await getHandler('profile:updateChatAgent')({}, 'c1', { model: 'gpt-4' });
    expect(result).toEqual({ success: true });
  });

  // --- Chat session handlers ---

  it('profile:saveChatSession returns success', async () => {
    const result = await getHandler('profile:saveChatSession')({}, 'alice', 'c1', { messages: [] });
    expect(result).toEqual({ success: true });
  });

  it('profile:saveChatSession returns error when save fails', async () => {
    mockSaveChatSession.mockResolvedValueOnce(false);
    const result = await getHandler('profile:saveChatSession')({}, 'alice', 'c1', {});
    expect(result).toEqual({ success: false, error: 'Failed to save chat session' });
  });

  it('profile:deleteChatSession returns success', async () => {
    const result = await getHandler('profile:deleteChatSession')({}, 'alice', 'c1', 's1');
    expect(result).toEqual({ success: true });
    expect(mockDestroyEmbeddedBrowserSession).toHaveBeenCalledWith('s1');
  });

  it('profile:deleteChatSession succeeds when embedded browser cleanup throws', async () => {
    mockDestroyEmbeddedBrowserSession.mockImplementationOnce(() => {
      throw new Error('browser cleanup failed');
    });

    const result = await getHandler('profile:deleteChatSession')({}, 'alice', 'c1', 's1');

    expect(result).toEqual({ success: true });
  });

  it('profile:deleteChatSession returns error when delete fails', async () => {
    mockDeleteChatSession.mockResolvedValueOnce(false);
    const result = await getHandler('profile:deleteChatSession')({}, 'alice', 'c1', 's1');
    expect(result).toEqual({ success: false, error: 'Failed to delete chat session' });
  });

  it('profile:getChatSessionFile returns data', async () => {
    const result = await getHandler('profile:getChatSessionFile')({}, 'alice', 'c1', 's1');
    expect(result).toEqual({ success: true, data: { messages: [] } });
  });

  it('profile:getChatSessions returns data', async () => {
    const result = await getHandler('profile:getChatSessions')({}, 'alice', 'c1', 5);
    expect(result).toEqual({ success: true, data: { sessions: [] } });
  });

  it('profile:getMoreChatSessions returns data', async () => {
    const result = await getHandler('profile:getMoreChatSessions')({}, 'alice', 'c1', 2);
    expect(result).toEqual({ success: true, data: { sessions: [] } });
  });

  it('profile:getAllScheduledSessions returns paginated data', async () => {
    const result = await getHandler('profile:getAllScheduledSessions')({}, 'alice', 'c1', { limit: 20, offset: 0 });
    expect(result).toEqual({ success: true, data: { sessions: [], total: 0, hasMore: false } });
  });

  it('profile:getChatUnreadSummary returns summary', async () => {
    const result = await getHandler('profile:getChatUnreadSummary')({}, 'alice', 'c1');
    expect(result).toEqual({ success: true, data: { unread: 0 } });
  });

  it('profile:renameChatSession renames and syncs index', async () => {
    const { chatSessionStore } = await import('../../../lib/chat/chatSessionStore');
    const result = await getHandler('profile:renameChatSession')({}, 'alice', 'c1', 's1', 'New Title');
    expect(chatSessionStore.renameSession).toHaveBeenCalledWith('alice', 'c1', 's1', 'New Title');
    expect(result).toEqual({ success: true });
  });

  it('profile:setChatSessionStarred stars session and syncs index', async () => {
    const { chatSessionStore } = await import('../../../lib/chat/chatSessionStore');
    const result = await getHandler('profile:setChatSessionStarred')({}, 'alice', 'c1', 's1', true);
    expect(chatSessionStore.setStarred).toHaveBeenCalledWith('alice', 'c1', 's1', true);
    expect(result).toEqual({ success: true });
  });
});
