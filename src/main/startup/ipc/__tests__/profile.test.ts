import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => (mockHandle as any)(...args) },
}));

// --- profile cache manager mock ---
const mockGetCachedProfile = vi.fn();
const mockForceNotifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
const mockUpdatePrimaryAgent = vi.fn().mockResolvedValue(true);
const mockUpdateFreDone = vi.fn().mockResolvedValue(true);
const mockUpdateConfirmationSettings = vi.fn().mockResolvedValue(true);
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

const mockPcManager = {
  getCachedProfile: (...args: any[]) => (mockGetCachedProfile as any)(...args),
  forceNotifyProfileDataManager: (...args: any[]) => (mockForceNotifyProfileDataManager as any)(...args),
  updatePrimaryAgent: (...args: any[]) => (mockUpdatePrimaryAgent as any)(...args),
  updateFreDone: (...args: any[]) => (mockUpdateFreDone as any)(...args),
  updateConfirmationSettings: (...args: any[]) => (mockUpdateConfirmationSettings as any)(...args),
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
};

const mockGetProfileCacheManager = vi.fn().mockResolvedValue(mockPcManager);
const mockUseRemoteChannelManager = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lazy', () => ({
  getProfileCacheManager: (...args: any[]) => (mockGetProfileCacheManager as any)(...args),
  useRemoteChannelManager: (...args: any[]) => (mockUseRemoteChannelManager as any)(...args),
}));

// --- mcp client manager mock ---
const mockMcpAdd = vi.fn().mockResolvedValue(undefined);
const mockMcpUpdate = vi.fn().mockResolvedValue(undefined);
const mockMcpDelete = vi.fn().mockResolvedValue(undefined);
const mockMcpConnect = vi.fn().mockResolvedValue(undefined);
const mockMcpReconnect = vi.fn().mockResolvedValue(undefined);
const mockMcpDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    add: (...args: any[]) => (mockMcpAdd as any)(...args),
    update: (...args: any[]) => (mockMcpUpdate as any)(...args),
    delete: (...args: any[]) => (mockMcpDelete as any)(...args),
    connect: (...args: any[]) => (mockMcpConnect as any)(...args),
    reconnect: (...args: any[]) => (mockMcpReconnect as any)(...args),
    disconnect: (...args: any[]) => (mockMcpDisconnect as any)(...args),
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
  },
}));

const mockRecordMcpServerAdded = vi.fn();
const mockRecordAgentCreated = vi.fn();

vi.mock('../../../lib/analytics', () => ({
  analyticsManager: {
    recordMcpServerAdded: (...args: any[]) => (mockRecordMcpServerAdded as any)(...args),
    recordAgentCreated: (...args: any[]) => (mockRecordAgentCreated as any)(...args),
  },
}));

vi.mock('../../../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: {
    toggleJobsByAgent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/utilities/safeConsole', () => ({
  safeConsole: { warn: vi.fn(), error: vi.fn() },
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
    const { default: registerProfileIPC } = await import('../profile');
    registerProfileIPC({ ...baseCtx } as any);
  });

  // --- profile:getProfile ---

  it('profile:getProfile returns profile when found', async () => {
    mockGetCachedProfile.mockReturnValue({ alias: 'alice', name: 'Alice' });
    const result = await getHandler('profile:getProfile')({}, 'alice');
    expect(result).toEqual({ success: true, data: { alias: 'alice', name: 'Alice' } });
    expect(mockForceNotifyProfileDataManager).toHaveBeenCalledWith('alice');
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

  // --- profile:setPrimaryAgent ---

  it('profile:setPrimaryAgent succeeds', async () => {
    const result = await getHandler('profile:setPrimaryAgent')({}, 'agent1');
    expect(result).toEqual({ success: true });
    expect(mockUpdatePrimaryAgent).toHaveBeenCalledWith('alice', 'agent1');
  });

  it('profile:setPrimaryAgent returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:setPrimaryAgent')({}, 'agent1');
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

  // --- MCP server handlers ---

  it('profile:addMcpServer calls mcpClientManager.add', async () => {
    const result = await getHandler('profile:addMcpServer')({}, 'myServer', { command: 'node' });
    expect(mockMcpAdd).toHaveBeenCalledWith('myServer', { command: 'node' });
    expect(result).toEqual({ success: true });
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

  it('profile:addChatConfig succeeds', async () => {
    const result = await getHandler('profile:addChatConfig')({}, { chat_id: 'c1' });
    expect(result).toEqual({ success: true });
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
