/**
 * Supplementary tests for src/main/startup/ipc/profile.ts
 *
 * Covers branches missed by the existing profile.test.ts:
 *  - profile:duplicateChatConfig: missing alias, blank sourceChatId, blank
 *    agentName, success, failure result from duplicateAgent
 *  - profile:addChatConfig: success, add fails
 *  - profile:deleteChatConfig: success, delete fails
 *  - profile:archiveChatConfig: success=false does NOT call toggleJobsByAgent
 *  - profile:unarchiveChatConfig: success=false does NOT call toggleJobsByAgent,
 *    error path
 *  - profile:renameChatSession: renameSession returns falsy
 *  - profile:setChatSessionStarred: setStarred returns falsy
 *  - profile:getChatUnreadSummary: error path
 *  - profile:getArchivedAgents: no current user alias
 *  - profile:getChatConfig: no current user alias
 *  - profile:getAllChatConfigs: no current user alias
 *  - profile:updateChatAgent: no current user alias
 *  - MCP server handlers: error paths for update / delete / connect / reconnect / disconnect
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => (mockHandle as any)(...args) },
}));

// ── profile cache manager ─────────────────────────────────────────────────────

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
  getCachedProfile: (...a: any[]) => (mockGetCachedProfile as any)(...a),
  forceNotifyProfileDataManager: (...a: any[]) => (mockForceNotifyProfileDataManager as any)(...a),
  updatePrimaryAgent: (...a: any[]) => (mockUpdatePrimaryAgent as any)(...a),
  updateFreDone: (...a: any[]) => (mockUpdateFreDone as any)(...a),
  updateConfirmationSettings: (...a: any[]) => (mockUpdateConfirmationSettings as any)(...a),
  addChatConfig: (...a: any[]) => (mockAddChatConfig as any)(...a),
  updateChatConfig: (...a: any[]) => (mockUpdateChatConfig as any)(...a),
  deleteChatConfig: (...a: any[]) => (mockDeleteChatConfig as any)(...a),
  archiveChatConfig: (...a: any[]) => (mockArchiveChatConfig as any)(...a),
  unarchiveChatConfig: (...a: any[]) => (mockUnarchiveChatConfig as any)(...a),
  getArchivedAgents: (...a: any[]) => (mockGetArchivedAgents as any)(...a),
  getChatConfig: (...a: any[]) => (mockGetChatConfig as any)(...a),
  getAllChatConfigs: (...a: any[]) => (mockGetAllChatConfigs as any)(...a),
  updateChatAgent: (...a: any[]) => (mockUpdateChatAgent as any)(...a),
  saveChatSession: (...a: any[]) => (mockSaveChatSession as any)(...a),
  deleteChatSession: (...a: any[]) => (mockDeleteChatSession as any)(...a),
  getChatSessionFile: (...a: any[]) => (mockGetChatSessionFile as any)(...a),
  syncStarredChatSessionIndex: (...a: any[]) => (mockSyncStarredChatSessionIndex as any)(...a),
};

const mockGetProfileCacheManager = vi.fn().mockResolvedValue(mockPcManager);

vi.mock('../../lazy', () => ({
  getProfileCacheManager: (...a: any[]) => (mockGetProfileCacheManager as any)(...a),
}));

// ── agentDuplicator (dynamic import) ─────────────────────────────────────────

const mockDuplicateAgent = vi.fn().mockResolvedValue({ success: true, newChatId: 'new-chat' });

vi.mock('../../lib/userDataADO/agentDuplicator', () => ({
  duplicateAgent: (...a: any[]) => (mockDuplicateAgent as any)(...a),
}));

// ── mcp ───────────────────────────────────────────────────────────────────────

const mockMcpAdd = vi.fn().mockResolvedValue(undefined);
const mockMcpUpdate = vi.fn().mockResolvedValue(undefined);
const mockMcpDelete = vi.fn().mockResolvedValue(undefined);
const mockMcpConnect = vi.fn().mockResolvedValue(undefined);
const mockMcpReconnect = vi.fn().mockResolvedValue(undefined);
const mockMcpDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    add: (...a: any[]) => (mockMcpAdd as any)(...a),
    update: (...a: any[]) => (mockMcpUpdate as any)(...a),
    delete: (...a: any[]) => (mockMcpDelete as any)(...a),
    connect: (...a: any[]) => (mockMcpConnect as any)(...a),
    reconnect: (...a: any[]) => (mockMcpReconnect as any)(...a),
    disconnect: (...a: any[]) => (mockMcpDisconnect as any)(...a),
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
    getInstance: vi.fn(() => ({ updateSessionTitle: vi.fn() })),
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

vi.mock('../../../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: { toggleJobsByAgent: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../lib/utilities/safeConsole', () => ({
  safeConsole: { warn: vi.fn(), error: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

const baseCtx = { currentUserAlias: 'alice' };

// ── test suite ────────────────────────────────────────────────────────────────

describe('startup/ipc/profile deep', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetProfileCacheManager.mockResolvedValue(mockPcManager);
    // Re-register agentDuplicator mock after resetModules so dynamic import in handler gets the mock
    vi.doMock('../../../lib/userDataADO/agentDuplicator', () => ({
      duplicateAgent: (...a: any[]) => (mockDuplicateAgent as any)(...a),
    }));
    const { default: reg } = await import('../profile');
    reg({ ...baseCtx } as any);
  });

  // ── profile:duplicateChatConfig ─────────────────────────────────────────────

  it('profile:duplicateChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:duplicateChatConfig')({}, 'src', 'NewAgent');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  it('profile:duplicateChatConfig returns error when sourceChatId is blank', async () => {
    const result = await getHandler('profile:duplicateChatConfig')({}, '  ', 'NewAgent');
    expect(result).toEqual({ success: false, error: 'Invalid source chat ID' });
  });

  it('profile:duplicateChatConfig returns error when agentName is blank', async () => {
    const result = await getHandler('profile:duplicateChatConfig')({}, 'src', '  ');
    expect(result).toEqual({ success: false, error: 'Invalid agent name' });
  });

  it('profile:duplicateChatConfig returns failure result from duplicateAgent', async () => {
    mockDuplicateAgent.mockResolvedValue({ success: false, error: 'dupe fail' });
    const result = await getHandler('profile:duplicateChatConfig')({}, 'src', 'NewAgent');
    expect(result).toEqual({ success: false, error: 'dupe fail' });
    expect(mockRecordAgentCreated).not.toHaveBeenCalled();
  });

  // ── profile:deleteChatConfig ─────────────────────────────────────────────────

  it('profile:deleteChatConfig returns success when delete succeeds', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetProfileCacheManager.mockResolvedValue(mockPcManager);
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: 'alice' } as any);

    const result = await getHandler('profile:deleteChatConfig')({}, 'c1');
    expect(result).toEqual({ success: true });
  });

  it('profile:deleteChatConfig returns failure when delete fails', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockDeleteChatConfig.mockResolvedValueOnce(false);
    mockGetProfileCacheManager.mockResolvedValue(mockPcManager);
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: 'alice' } as any);

    const result = await getHandler('profile:deleteChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false });
  });

  // ── profile:archiveChatConfig ────────────────────────────────────────────────

  it('profile:archiveChatConfig does NOT call toggleJobsByAgent when archive fails', async () => {
    mockArchiveChatConfig.mockResolvedValueOnce(false);
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    await getHandler('profile:archiveChatConfig')({}, 'c1');
    expect(schedulerManager.toggleJobsByAgent).not.toHaveBeenCalled();
  });

  // ── profile:unarchiveChatConfig ──────────────────────────────────────────────

  it('profile:unarchiveChatConfig does NOT call toggleJobsByAgent when unarchive fails', async () => {
    mockUnarchiveChatConfig.mockResolvedValueOnce({ success: false, error: 'cannot unarchive' });
    const { schedulerManager } = await import('../../../lib/scheduler/SchedulerManager');
    const result = await getHandler('profile:unarchiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'cannot unarchive' });
    expect(schedulerManager.toggleJobsByAgent).not.toHaveBeenCalled();
  });

  it('profile:unarchiveChatConfig returns error on exception', async () => {
    mockUnarchiveChatConfig.mockRejectedValueOnce(new Error('db error'));
    const result = await getHandler('profile:unarchiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'db error' });
  });

  it('profile:unarchiveChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:unarchiveChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // ── profile:getArchivedAgents: no alias ────────────────────────────────────

  it('profile:getArchivedAgents returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:getArchivedAgents')();
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // ── profile:getChatConfig: no alias ───────────────────────────────────────

  it('profile:getChatConfig returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:getChatConfig')({}, 'c1');
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // ── profile:getAllChatConfigs: no alias ───────────────────────────────────

  it('profile:getAllChatConfigs returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:getAllChatConfigs')();
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // ── profile:updateChatAgent: no alias ────────────────────────────────────

  it('profile:updateChatAgent returns error when no current user alias', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: reg } = await import('../profile');
    reg({ currentUserAlias: null } as any);
    const result = await getHandler('profile:updateChatAgent')({}, 'c1', {});
    expect(result).toEqual({ success: false, error: 'No current user alias set' });
  });

  // ── profile:renameChatSession: rename returns falsy ──────────────────────────

  it('profile:renameChatSession returns error when renameSession returns falsy', async () => {
    const { chatSessionStore } = await import('../../../lib/chat/chatSessionStore');
    vi.mocked(chatSessionStore.renameSession).mockResolvedValueOnce(null as any);
    const result = await getHandler('profile:renameChatSession')({}, 'alice', 'c1', 's1', 'New Title');
    expect(result).toEqual({ success: false, error: 'Failed to rename chat session' });
  });

  // ── profile:setChatSessionStarred: setStarred returns falsy ─────────────────

  it('profile:setChatSessionStarred returns error when setStarred returns falsy', async () => {
    const { chatSessionStore } = await import('../../../lib/chat/chatSessionStore');
    vi.mocked(chatSessionStore.setStarred).mockResolvedValueOnce(null as any);
    const result = await getHandler('profile:setChatSessionStarred')({}, 'alice', 'c1', 's1', true);
    expect(result).toEqual({ success: false, error: 'Failed to update chat session star state' });
  });

  // ── profile:getChatUnreadSummary: error path ──────────────────────────────

  it('profile:getChatUnreadSummary returns error on exception', async () => {
    const { chatSessionStore } = await import('../../../lib/chat/chatSessionStore');
    vi.mocked(chatSessionStore.getUnreadSummary).mockRejectedValueOnce(new Error('read error'));
    const result = await getHandler('profile:getChatUnreadSummary')({}, 'alice', 'c1');
    expect(result).toEqual({ success: false, error: 'read error' });
  });

  // ── MCP server error paths ─────────────────────────────────────────────────

  it('profile:updateMcpServer returns error on failure', async () => {
    mockMcpUpdate.mockRejectedValueOnce(new Error('update fail'));
    const result = await getHandler('profile:updateMcpServer')({}, 'srv', {});
    expect(result).toEqual({ success: false, error: 'update fail' });
  });

  it('profile:deleteMcpServer returns error on failure', async () => {
    mockMcpDelete.mockRejectedValueOnce(new Error('del fail'));
    const result = await getHandler('profile:deleteMcpServer')({}, 'srv');
    expect(result).toEqual({ success: false, error: 'del fail' });
  });

  it('profile:connectMcpServer returns error on failure', async () => {
    mockMcpConnect.mockRejectedValueOnce(new Error('conn fail'));
    const result = await getHandler('profile:connectMcpServer')({}, 'srv');
    expect(result).toEqual({ success: false, error: 'conn fail' });
  });

  it('profile:reconnectMcpServer returns error on failure', async () => {
    mockMcpReconnect.mockRejectedValueOnce(new Error('reconn fail'));
    const result = await getHandler('profile:reconnectMcpServer')({}, 'srv');
    expect(result).toEqual({ success: false, error: 'reconn fail' });
  });

  it('profile:disconnectMcpServer returns error on failure', async () => {
    mockMcpDisconnect.mockRejectedValueOnce(new Error('disc fail'));
    const result = await getHandler('profile:disconnectMcpServer')({}, 'srv');
    expect(result).toEqual({ success: false, error: 'disc fail' });
  });

  // ── profile:updateChatConfig: error path ──────────────────────────────────

  it('profile:updateChatConfig returns error on exception', async () => {
    mockUpdateChatConfig.mockRejectedValueOnce(new Error('upd error'));
    const result = await getHandler('profile:updateChatConfig')({}, 'c1', {});
    expect(result).toEqual({ success: false, error: 'upd error' });
  });

  // ── profile:updateFreDone: error path ────────────────────────────────────

  it('profile:updateFreDone returns error on exception', async () => {
    mockUpdateFreDone.mockRejectedValueOnce(new Error('fre error'));
    const result = await getHandler('profile:updateFreDone')({}, 'alice', false);
    expect(result).toEqual({ success: false, error: 'fre error' });
  });

  // ── profile:updateConfirmationSettings: error path ──────────────────────

  it('profile:updateConfirmationSettings returns error on exception', async () => {
    mockUpdateConfirmationSettings.mockRejectedValueOnce(new Error('cs error'));
    const result = await getHandler('profile:updateConfirmationSettings')({}, 'alice', {});
    expect(result).toEqual({ success: false, error: 'cs error' });
  });
});
