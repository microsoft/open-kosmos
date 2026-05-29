vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'kosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
    updateRemoteChannelsConfig: vi.fn().mockResolvedValue(undefined),
    forceNotifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    patchMetadata: vi.fn(),
    renameSession: vi.fn(),
    ensureLoaded: vi.fn(),
    getAllSessions: vi.fn(),
    createSession: vi.fn(),
  },
}));

vi.mock('../../chat/agentChatManager', () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({ updateSessionTitle: vi.fn() })),
  },
  agentChatManager: {
    switchToChatSession: vi.fn().mockResolvedValue(undefined),
    generateChatSessionId: vi.fn(() => 'gen-session-id'),
    getInstanceByChatSessionId: vi.fn(() => null),
    streamMessage: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock('../../userDataADO/types/profile', () => ({
  isBuiltinAgent: vi.fn(() => false),
}));

vi.mock('../../userDataADO/chatSessionManager', () => ({
  chatSessionManager: {
    getChatSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getChatSessionFile: vi.fn().mockResolvedValue(null),
  },
}));

// Mock AgentBridge.initialize dependencies: sessionPersistence
vi.mock('../agentBridge/sessionPersistence', () => ({
  loadSessionMap: vi.fn().mockResolvedValue(new Map()),
  createPersistScheduler: vi.fn(() => ({ schedule: vi.fn(), cancel: vi.fn() })),
  pruneSessionMap: vi.fn(),
  persistSessionMap: vi.fn().mockResolvedValue(undefined),
  getSessionMapPath: vi.fn(() => '/tmp/sessions.json'),
}));

vi.mock('../agentBridge/attachmentPipeline', () => ({
  downloadAndBuildParts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../agentBridge/sessionLifecycle', () => ({
  demoteSession: vi.fn().mockResolvedValue(undefined),
  demoteOrphanedSessions: vi.fn().mockResolvedValue(undefined),
  registerRemoteSession: vi.fn().mockResolvedValue(undefined),
  resolveChatId: vi.fn(() => 'default-chat'),
  updateRemoteSessionTitle: vi.fn().mockResolvedValue(undefined),
  markSessionAsRemote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../channelManager', () => ({
  RemoteChannelManager: {
    getInstance: vi.fn(() => ({
      sendTyping: vi.fn(),
      getAlias: vi.fn(() => 'user1'),
    })),
  },
}));

// Mock BrowserWindow.getAllWindows
const mockWebContents = { send: vi.fn() };
const mockWindow = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
vi.mock('electron', async () => {
  const actual = await vi.importActual<any>('electron');
  return {
    ...actual,
    BrowserWindow: {
      ...actual.BrowserWindow,
      getAllWindows: vi.fn(() => [mockWindow]),
    },
  };
});

import { AgentBridge } from '../agentBridge/index';
import { agentChatManager } from '../../chat/agentChatManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { demoteSession } from '../agentBridge/sessionLifecycle';

function resetInstance() {
  // Reset singleton
  (AgentBridge as any).instance = undefined;
}

describe('AgentBridge', () => {
  beforeEach(async () => {
    resetInstance();
    vi.clearAllMocks();
    const bridge = AgentBridge.getInstance();
    await bridge.initialize('user1');
  });

  afterEach(() => {
    AgentBridge.getInstance().destroy();
    resetInstance();
  });

  it('getInstance returns same instance', () => {
    const a = AgentBridge.getInstance();
    const b = AgentBridge.getInstance();
    expect(a).toBe(b);
  });

  it('getSessionMap returns the session map', () => {
    const map = AgentBridge.getInstance().getSessionMap();
    expect(map).toBeInstanceOf(Map);
  });

  it('destroy clears internal state', () => {
    const bridge = AgentBridge.getInstance();
    bridge.destroy();
    expect(bridge.getSessionMap().size).toBe(0);
  });

  it('removeSessionByChatSessionId returns null for unknown session', () => {
    const result = AgentBridge.getInstance().removeSessionByChatSessionId('unknown');
    expect(result).toBeNull();
  });

  it('removeSessionByChatSessionId removes and returns channel/userId', async () => {
    const bridge = AgentBridge.getInstance();
    const map = bridge.getSessionMap();
    map.set('ch1:user1', { chatId: 'c1', chatSessionId: 'sess-1', lastActiveAt: Date.now() });
    const result = bridge.removeSessionByChatSessionId('sess-1');
    expect(result).toEqual({ channelId: 'ch1', userId: 'user1' });
    expect(map.has('ch1:user1')).toBe(false);
  });

  it('clearSessionsForChannel removes matching sessions', () => {
    const bridge = AgentBridge.getInstance();
    const map = bridge.getSessionMap();
    map.set('ch1:user1', { chatId: 'c1', chatSessionId: 's1', lastActiveAt: Date.now() });
    map.set('ch1:user2', { chatId: 'c1', chatSessionId: 's2', lastActiveAt: Date.now() });
    map.set('ch2:user1', { chatId: 'c2', chatSessionId: 's3', lastActiveAt: Date.now() });
    bridge.clearSessionsForChannel('ch1');
    expect(map.has('ch1:user1')).toBe(false);
    expect(map.has('ch1:user2')).toBe(false);
    expect(map.has('ch2:user1')).toBe(true);
  });

  it('handleChannelUnbound clears sessions and calls demoteSession', async () => {
    const bridge = AgentBridge.getInstance();
    const map = bridge.getSessionMap();
    map.set('ch1:user1', { chatId: 'c1', chatSessionId: 's1', lastActiveAt: Date.now() });

    await bridge.handleChannelUnbound('ch1');
    expect(demoteSession).toHaveBeenCalledWith('user1', 'c1', 's1');
    expect(map.size).toBe(0);
  });

  it('handleInboundMessage with .new command returns SESSION_DIVIDER', async () => {
    const message = {
      channelId: 'teams',
      activityId: 'act-1',
      text: '.new',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toBe('__SESSION_DIVIDER__');
  });

  it('handleInboundMessage with .skill (list) returns skill list', async () => {
    // profileCacheManager is imported at top of file
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [],
      skills: [],
    });
    const message = {
      channelId: 'teams',
      activityId: 'act-2',
      text: '.skill',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('No skills configured');
  });

  it('handleInboundMessage with normal text calls streamMessage', async () => {
    (agentChatManager.streamMessage as any).mockResolvedValue({
      success: true,
      data: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }],
    });

    const message = {
      channelId: 'teams',
      activityId: 'act-3',
      text: 'Hello bot',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toBe('Hello!');
  });

  it('handleInboundMessage returns error text when streamMessage fails', async () => {
    (agentChatManager.streamMessage as any).mockResolvedValue({
      success: false,
      error: 'AI error',
    });

    const message = {
      channelId: 'teams',
      activityId: 'act-4',
      text: 'fail please',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('AI error');
  });

  it('handleInboundMessage with .switch command returns switch list', async () => {
    // profileCacheManager is imported at top of file
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    const message = {
      channelId: 'teams',
      activityId: 'act-5',
      text: '.switch',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('No conversations available');
  });

  it('handleInboundMessage with .agent command returns agent list', async () => {
    // profileCacheManager is imported at top of file
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    const message = {
      channelId: 'teams',
      activityId: 'act-6',
      text: '.agent',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('No agents available');
  });

  it('handles .skill(...) parse error', async () => {
    // profileCacheManager is imported at top of file
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { skills: ['s1'] } }],
      skills: [{ name: 's1', description: 'desc' }],
      remoteChannels: { teams: { boundChatId: 'c1' } },
    });
    // Override resolveChatId to return 'c1' so skills are found
    const { resolveChatId } = await import('../agentBridge/sessionLifecycle');
    (resolveChatId as any).mockReturnValue('c1');
    const message = {
      channelId: 'teams',
      activityId: 'act-7',
      text: '.skill(99) hello',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('⚠️');
    // Restore default
    (resolveChatId as any).mockReturnValue('default-chat');
  });

  it('handles .skill with no skills configured', async () => {
    // profileCacheManager is imported at top of file
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [], skills: [] });
    const message = {
      channelId: 'teams',
      activityId: 'act-8',
      text: '.skill(1) hello',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toContain('No skills configured');
  });

  it('returns (Agent returned no content) when streamMessage returns empty data', async () => {
    (agentChatManager.streamMessage as any).mockResolvedValue({ success: true, data: [] });
    const message = {
      channelId: 'teams',
      activityId: 'act-9',
      text: 'Hello',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await AgentBridge.getInstance().handleInboundMessage(message);
    expect(result.text).toBe('(Agent returned no content)');
  });

  it('reuses existing session within TTL', async () => {
    const bridge = AgentBridge.getInstance();
    const map = bridge.getSessionMap();
    map.set('teams:user1', { chatId: 'c1', chatSessionId: 'existing-sess', lastActiveAt: Date.now() });

    (agentChatManager.getInstanceByChatSessionId as any).mockReturnValue({
      setEventSender: vi.fn(),
    });
    (agentChatManager.streamMessage as any).mockResolvedValue({
      success: true,
      data: [{ role: 'assistant', content: [{ type: 'text', text: 'reply' }] }],
    });

    const message = {
      channelId: 'teams',
      activityId: 'act-10',
      text: 'test',
      userId: 'user1',
      conversationId: 'conv-1',
      timestamp: Date.now(),
    };
    const result = await bridge.handleInboundMessage(message);
    expect(result.text).toBe('reply');
    // session should still be there (not replaced)
    expect(agentChatManager.generateChatSessionId).not.toHaveBeenCalled();
  });

  it('creates new session when existing session is expired', async () => {
    const bridge = AgentBridge.getInstance();
    const map = bridge.getSessionMap();
    // Set expired session
    const { SESSION_TTL } = await import('../agentBridge/types');
    map.set('teams:user2', { chatId: 'c1', chatSessionId: 'expired-sess', lastActiveAt: Date.now() - SESSION_TTL - 1000 });

    (agentChatManager.streamMessage as any).mockResolvedValue({ success: true, data: [] });

    const message = {
      channelId: 'teams',
      activityId: 'act-11',
      text: 'test',
      userId: 'user2',
      conversationId: 'conv-2',
      timestamp: Date.now(),
    };
    await bridge.handleInboundMessage(message);
    expect(agentChatManager.generateChatSessionId).toHaveBeenCalled();
  });
});
