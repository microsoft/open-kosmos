import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── electron mock: capture ipcMain.handle registrations ──
const mockHandle = vi.fn();
const mockRemoveHandler = vi.fn();
const mockGetAllWindows = vi.fn(() => [] as any[]);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => (mockHandle as any)(...args),
    removeHandler: (...args: any[]) => (mockRemoveHandler as any)(...args),
  },
  app: { getPath: vi.fn(() => '/tmp/userData') },
  BrowserWindow: { getAllWindows: (...args: any[]) => (mockGetAllWindows as any)(...args) },
}));

// ── profileCacheManager mock: control the per-profile master switch ──
const mockGetMemexSettings = vi.fn(() => ({ enabled: true }));
const mockGetChatConfig = vi.fn((_alias: string, chatId: string) => ({ chat_id: chatId, agent_ids: ['agent-1'] }));
const mockGetAllChatConfigs = vi.fn(() => [] as any[]);
vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getMemexSettings: (...args: any[]) => (mockGetMemexSettings as any)(...args),
    getChatConfig: (...args: any[]) => (mockGetChatConfig as any)(...args),
    getAllChatConfigs: (...args: any[]) => (mockGetAllChatConfigs as any)(...args),
  },
}));

// ── MemexService mock ──
const mockListCards = vi.fn().mockResolvedValue([{ slug: 'c1', title: 'C1', excerpt: 'x' }]);
const mockReadCardStructured = vi.fn().mockResolvedValue({ slug: 'c1', title: 'C1', content: 'body', outbound: [], inbound: [] });
const mockGetGraph = vi.fn().mockResolvedValue({ nodes: [], edges: [], orphans: [], hubs: [] });
const mockSearchCards = vi.fn().mockResolvedValue([]);
const mockRead = vi.fn().mockResolvedValue('raw-card');
const mockWrite = vi.fn().mockResolvedValue('Saved card: c1');
const mockArchive = vi.fn().mockResolvedValue('Archived card: c1');
const mockDelete = vi.fn().mockResolvedValue('Deleted card: c1');
vi.mock('../MemexService', () => ({
  memexService: {
    listCards: (...args: any[]) => (mockListCards as any)(...args),
    readCardStructured: (...args: any[]) => (mockReadCardStructured as any)(...args),
    getGraph: (...args: any[]) => (mockGetGraph as any)(...args),
    searchCards: (...args: any[]) => (mockSearchCards as any)(...args),
    read: (...args: any[]) => (mockRead as any)(...args),
    write: (...args: any[]) => (mockWrite as any)(...args),
    archive: (...args: any[]) => (mockArchive as any)(...args),
    delete: (...args: any[]) => (mockDelete as any)(...args),
  },
}));

// ── memexHome mock: avoid touching the filesystem ──
const mockBuildAgentMemexHome = vi.fn(() => ({ root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' }));
const mockBuildProfileMemexHome = vi.fn(() => ({ root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' }));
const mockEnsureHome = vi.fn().mockResolvedValue(undefined);
vi.mock('../memexHome', () => ({
  buildAgentMemexHome: (...args: any[]) => (mockBuildAgentMemexHome as any)(...args),
  buildProfileMemexHome: (...args: any[]) => (mockBuildProfileMemexHome as any)(...args),
  ensureHome: (...args: any[]) => (mockEnsureHome as any)(...args),
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

const baseCtx = { currentUserAlias: 'alice', mainWindow: null };

describe('memexIPC.registerMemexIPC', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetChatConfig.mockImplementation((_alias: string, chatId: string) => ({ chat_id: chatId, agent_ids: ['agent-1'] }));
    mockGetAllChatConfigs.mockReturnValue([]);
    mockBuildAgentMemexHome.mockReturnValue({ root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' });
    mockBuildProfileMemexHome.mockReturnValue({ root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' });
    mockEnsureHome.mockResolvedValue(undefined);
    const mod = await import('../memexIPC');
    mod.registerMemexIPC({ ...baseCtx } as any);
  });

  it('registers all four read handlers', () => {
    for (const ch of ['memex:listCards', 'memex:readCard', 'memex:getGraph', 'memex:searchCards', 'memex:archiveProfileCard', 'memex:deleteProfileCard']) {
      expect(mockHandle.mock.calls.some(([name]) => name === ch)).toBe(true);
    }
  });

  // ── listCards ──
  it('listCards returns service data on success', async () => {
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: true, data: [{ slug: 'c1', title: 'C1', excerpt: 'x' }] });
    expect(mockBuildAgentMemexHome).toHaveBeenCalledWith('/tmp/userData', 'alice', 'agent-1');
    expect(mockListCards).toHaveBeenCalledWith({ root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' });
  });

  it('listCards resolves profile-memory without a chatId', async () => {
    const res = await getHandler('memex:listCards')({}, { scope: 'profile-memory' });
    expect(res).toEqual({ success: true, data: [{ slug: 'c1', title: 'C1', excerpt: 'x' }] });
    expect(mockBuildProfileMemexHome).toHaveBeenCalledWith('/tmp/userData', 'alice');
    expect(mockListCards).toHaveBeenCalledWith({ root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' });
  });

  it('listCards keeps runtime compatibility for legacy chatId arguments', async () => {
    const res = await getHandler('memex:listCards')({}, 'chat-1');
    expect(res.success).toBe(true);
    expect(mockBuildAgentMemexHome).toHaveBeenCalledWith('/tmp/userData', 'alice', 'agent-1');
  });

  it('listCards returns an error when the master switch is off', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: 'Memex Memory feature is disabled' });
  });

  it('listCards returns an error when there is no signed-in user', async () => {
    vi.resetModules();
    const mod = await import('../memexIPC');
    mockHandle.mockClear();
    mod.registerMemexIPC({ currentUserAlias: null, mainWindow: null } as any);
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: 'No signed-in user; cannot resolve memory.' });
  });

  it('listCards returns an error when chatId is empty', async () => {
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: '' });
    expect(res).toEqual({ success: false, error: 'chatId is required.' });
  });

  it('listCards rejects an invalid memory target scope', async () => {
    const res = await getHandler('memex:listCards')({}, { scope: 'unknown-scope', chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: 'Invalid memory target.' });
    expect(mockGetChatConfig).not.toHaveBeenCalled();
  });

  it('listCards rejects a null memory target', async () => {
    const res = await getHandler('memex:listCards')({}, null);
    expect(res).toEqual({ success: false, error: 'Invalid memory target.' });
    expect(mockGetChatConfig).not.toHaveBeenCalled();
  });

  it('listCards returns an error when the chat has no primary agent', async () => {
    mockGetChatConfig.mockReturnValueOnce({ chat_id: 'chat-empty', agent_ids: [] });
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-empty' });
    expect(res).toEqual({ success: false, error: 'No primary agent is bound to this chat; cannot resolve memory.' });
  });

  it('listCards surfaces profile-memory home resolution errors', async () => {
    mockBuildProfileMemexHome.mockImplementationOnce(() => {
      throw new Error('bad profile path');
    });
    const res = await getHandler('memex:listCards')({}, { scope: 'profile-memory' });
    expect(res).toEqual({ success: false, error: 'Failed to open memory: bad profile path' });
  });

  it('listCards does not create the memory home on read-only access', async () => {
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res.success).toBe(true);
    expect(mockEnsureHome).not.toHaveBeenCalled();
  });

  it('listCards surfaces a typed error when the service throws', async () => {
    mockListCards.mockRejectedValueOnce(new Error('scan failed'));
    const res = await getHandler('memex:listCards')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: 'scan failed' });
  });

  // ── readCard ──
  it('readCard passes the slug and returns detail', async () => {
    const res = await getHandler('memex:readCard')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'c1');
    expect(mockReadCardStructured).toHaveBeenCalledWith(
      { root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' },
      'c1',
    );
    expect(res.success).toBe(true);
    expect(res.data.slug).toBe('c1');
  });

  it('readCard surfaces a service error', async () => {
    mockReadCardStructured.mockRejectedValueOnce(new Error('not found'));
    const res = await getHandler('memex:readCard')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'missing');
    expect(res).toEqual({ success: false, error: 'not found' });
  });

  it('readCard returns the resolveHome error when the master switch is off', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const res = await getHandler('memex:readCard')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'c1');
    expect(res).toEqual({ success: false, error: 'Memex Memory feature is disabled' });
  });

  it('readCard reports "Unknown error" when the service rejects with a non-Error', async () => {
    mockReadCardStructured.mockRejectedValueOnce('a bare string');
    const res = await getHandler('memex:readCard')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'c1');
    expect(res).toEqual({ success: false, error: 'Unknown error' });
  });

  // ── getGraph ──
  it('getGraph returns the graph DTO', async () => {
    const res = await getHandler('memex:getGraph')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: true, data: { nodes: [], edges: [], orphans: [], hubs: [] } });
  });

  it('getGraph returns the resolveHome error when chatId is empty', async () => {
    const res = await getHandler('memex:getGraph')({}, { scope: 'current-agent', chatId: '' });
    expect(res).toEqual({ success: false, error: 'chatId is required.' });
  });

  it('getGraph surfaces a service error', async () => {
    mockGetGraph.mockRejectedValueOnce(new Error('graph boom'));
    const res = await getHandler('memex:getGraph')({}, { scope: 'current-agent', chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: 'graph boom' });
  });

  // ── searchCards ──
  it('searchCards forwards the query', async () => {
    mockSearchCards.mockResolvedValueOnce([{ slug: 'm', title: 'M', excerpt: '' }]);
    const res = await getHandler('memex:searchCards')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'hello');
    expect(mockSearchCards).toHaveBeenCalledWith(
      { root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' },
      'hello',
    );
    expect(res).toEqual({ success: true, data: [{ slug: 'm', title: 'M', excerpt: '' }] });
  });

  it('searchCards does not create the memory home on read-only access', async () => {
    const res = await getHandler('memex:searchCards')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'hello');
    expect(res.success).toBe(true);
    expect(mockEnsureHome).not.toHaveBeenCalled();
  });

  it('searchCards surfaces a service error', async () => {
    mockSearchCards.mockRejectedValueOnce(new Error('search boom'));
    const res = await getHandler('memex:searchCards')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'hello');
    expect(res).toEqual({ success: false, error: 'search boom' });
  });

  it('searchCards returns the resolveHome error when the master switch is off', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const res = await getHandler('memex:searchCards')({}, { scope: 'current-agent', chatId: 'chat-1' }, 'hello');
    expect(res).toEqual({ success: false, error: 'Memex Memory feature is disabled' });
  });

  it('archiveProfileCard archives profile-memory and emits a profile-memory change', async () => {
    const { memexEvents, MEMEX_CARDS_CHANGED } = await import('../memexEvents');
    const listener = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, listener);
    const res = await getHandler('memex:archiveProfileCard')({}, 'c1');
    expect(res).toEqual({ success: true, data: 'Archived card: c1' });
    expect(mockArchive).toHaveBeenCalledWith({ root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' }, 'c1');
    expect(listener).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'profile-memory' });
  });

  it('archiveProfileCard returns the resolveHome error when the master switch is off', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const res = await getHandler('memex:archiveProfileCard')({}, 'c1');
    expect(res).toEqual({ success: false, error: 'Memex Memory feature is disabled' });
  });

  it('archiveProfileCard surfaces a service error', async () => {
    mockArchive.mockRejectedValueOnce(new Error('archive failed'));
    const res = await getHandler('memex:archiveProfileCard')({}, 'c1');
    expect(res).toEqual({ success: false, error: 'archive failed' });
  });

  it('deleteProfileCard deletes profile-memory and emits a profile-memory change', async () => {
    const { memexEvents, MEMEX_CARDS_CHANGED } = await import('../memexEvents');
    const listener = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, listener);
    const res = await getHandler('memex:deleteProfileCard')({}, 'c1');
    expect(res).toEqual({ success: true, data: 'Deleted card: c1' });
    expect(mockDelete).toHaveBeenCalledWith({ root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' }, 'c1');
    expect(listener).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'profile-memory' });
  });

  it('deleteProfileCard returns the resolveHome error when the master switch is off', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const res = await getHandler('memex:deleteProfileCard')({}, 'c1');
    expect(res).toEqual({ success: false, error: 'Memex Memory feature is disabled' });
  });

  it('deleteProfileCard surfaces a service error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('delete failed'));
    const res = await getHandler('memex:deleteProfileCard')({}, 'c1');
    expect(res).toEqual({ success: false, error: 'delete failed' });
  });
});

describe('memexIPC.setupMemex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers handlers regardless of the master switch (per-call gating)', async () => {
    // Unlike the old feature-flag model, setupMemex always wires the handlers;
    // each handler gates on the master switch per-call via resolveHome. This
    // lets the Settings toggle take effect at runtime without re-wiring.
    mockGetMemexSettings.mockReturnValue({ enabled: false });
    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });
    expect(mockHandle.mock.calls.some(([name]) => name === 'memex:listCards')).toBe(true);
  });

  it('registers handlers when the switch is enabled', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat-9', agent_ids: ['agent-9'] }]);
    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });
    expect(mockHandle.mock.calls.some(([name]) => name === 'memex:listCards')).toBe(true);
  });

  it('is idempotent — a second call does not re-register handlers', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });
    const countAfterFirst = mockHandle.mock.calls.length;
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });
    expect(mockHandle.mock.calls.length).toBe(countAfterFirst);
  });

  it('forwards cardsChanged events to open windows', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    const cardsChanged = vi.fn();
    const fakeWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([fakeWin as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-9', chatId: 'chat-origin' });

    // bindWebContents(win).cardsChanged({chatId}) ultimately calls webContents.send('memex:cardsChanged', payload)
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('memex:cardsChanged', { scope: 'current-agent', chatId: 'chat-9', agentId: 'agent-9' });
    expect(cardsChanged).not.toHaveBeenCalled(); // sanity: our local spy is unrelated
  });

  it('forwards profile-memory cardsChanged events to open windows', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    const destroyed = { isDestroyed: () => true, webContents: { send: vi.fn() } };
    const alive = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([destroyed as any, alive as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice', scope: 'profile-memory' });

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(alive.webContents.send).toHaveBeenCalledWith('memex:cardsChanged', { scope: 'profile-memory' });
  });

  it('does not forward current-agent cardsChanged events without an agentId', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    const fakeWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([fakeWin as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice' });

    expect(fakeWin.webContents.send).not.toHaveBeenCalled();
  });

  it('skips destroyed windows when forwarding cardsChanged', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat-7', agent_ids: ['agent-7'] }]);
    const destroyed = { isDestroyed: () => true, webContents: { send: vi.fn() } };
    const alive = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([destroyed as any, alive as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-7', chatId: 'chat-origin' });

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(alive.webContents.send).toHaveBeenCalledWith('memex:cardsChanged', { scope: 'current-agent', chatId: 'chat-7', agentId: 'agent-7' });
  });

  it('falls back to the event chatId when no chat currently references the agent', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetAllChatConfigs.mockReturnValue([]);
    const fakeWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([fakeWin as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-fallback', chatId: 'chat-origin' });

    expect(fakeWin.webContents.send).toHaveBeenCalledWith('memex:cardsChanged', { scope: 'current-agent', chatId: 'chat-origin', agentId: 'agent-fallback' });
  });

  it('does not forward cardsChanged when no chat references the agent and no fallback chatId is present', async () => {
    mockGetMemexSettings.mockReturnValue({ enabled: true });
    mockGetAllChatConfigs.mockReturnValue([]);
    const fakeWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([fakeWin as any]);

    const mod = await import('../memexIPC');
    mod.setupMemex({ currentUserAlias: 'alice', mainWindow: null });

    const { emitCardsChanged } = await import('../memexEvents');
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-no-chat' });

    expect(fakeWin.webContents.send).not.toHaveBeenCalled();
  });
});
