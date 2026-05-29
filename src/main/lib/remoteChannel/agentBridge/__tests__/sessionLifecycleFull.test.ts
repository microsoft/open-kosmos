// @ts-nocheck
vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    forceNotifyProfileDataManager: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
    updateRemoteChannelsConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    patchMetadata: vi.fn(),
    renameSession: vi.fn(),
    ensureLoaded: vi.fn(),
    getAllSessions: vi.fn(),
    createSession: vi.fn(),
  },
}));

vi.mock('../../../chat/agentChatManager', () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({
      updateSessionTitle: vi.fn(),
    })),
  },
  agentChatManager: {
    switchToChatSession: vi.fn(),
    generateChatSessionId: vi.fn(),
    getInstanceByChatSessionId: vi.fn(),
    streamMessage: vi.fn(),
  },
}));

vi.mock('../../../userDataADO/types/profile', () => ({
  isBuiltinAgent: vi.fn(() => false),
}));

import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { isBuiltinAgent } from '../../../userDataADO/types/profile';
import { chatSessionStore } from '../../../chat/chatSessionStore';
import { resolveChatId, demoteOrphanedSessions, registerRemoteSession } from '../sessionLifecycle';

describe('resolveChatId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns default when no profile', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue(undefined);
    expect(resolveChatId('user1', 'teams')).toBe('default');
  });

  it('returns default when profile has no chats and no remoteChannels', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    expect(resolveChatId('user1', 'teams')).toBe('default');
  });

  it('returns first chat when profile has chats but no remoteChannels binding', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1', agent: { name: 'Kobi' } }],
    });
    expect(resolveChatId('user1', 'teams')).toBe('chat-1');
  });

  it('returns boundChatId from remoteChannels when present and brand-appropriate', () => {
    vi.mocked(isBuiltinAgent).mockReturnValue(false);
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      remoteChannels: { teams: { boundChatId: 'bound-chat' } },
      chats: [{ chat_id: 'bound-chat', agent: { name: 'Kobi' } }],
    });
    expect(resolveChatId('user1', 'teams')).toBe('bound-chat');
  });

  it('falls through to default chat when boundChatId not in chats', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      remoteChannels: { teams: { boundChatId: 'missing-chat' } },
      chats: [{ chat_id: 'chat-1', agent: { name: 'Bot' } }],
    });
    expect(resolveChatId('user1', 'teams')).toBe('chat-1');
  });

  it('returns default when getCachedProfile throws', () => {
    (profileCacheManager.getCachedProfile as any).mockImplementation(() => { throw new Error('fail'); });
    expect(resolveChatId('user1', 'teams')).toBe('default');
  });

  it('returns boundChatId when channelConfig exists but no boundChatId falls through to first chat', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      remoteChannels: { teams: {} },
      chats: [{ chat_id: 'chat-1', agent: { name: 'Bot' } }],
    });
    expect(resolveChatId('user1', 'teams')).toBe('chat-1');
  });

  it('picks brand-appropriate built-in agent chat when available', () => {
    vi.mocked(isBuiltinAgent).mockImplementation((_name: string, _brand: string) => _name === 'OpenKosmosBot');
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [
        { chat_id: 'custom-chat', agent: { name: 'CustomBot' } },
        { chat_id: 'builtin-chat', agent: { name: 'OpenKosmosBot' } },
      ],
    });
    expect(resolveChatId('user1', 'teams')).toBe('builtin-chat');
  });
});

describe('demoteOrphanedSessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when profile is absent', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue(undefined);
    await demoteOrphanedSessions('user1', new Map());
    expect(chatSessionStore.getAllSessions).not.toHaveBeenCalled();
  });

  it('does nothing when profile has no chats', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    await demoteOrphanedSessions('user1', new Map());
    expect(chatSessionStore.getAllSessions).not.toHaveBeenCalled();
  });

  it('demotes remote sessions not in sessionMap', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1' }],
    });
    (chatSessionStore.getAllSessions as any).mockResolvedValue([
      { chatSession_id: 'orphan-session', source: { type: 'remote' } },
    ]);
    (chatSessionStore.patchMetadata as any).mockResolvedValue({
      metadata: { chatSession_id: 'orphan-session', starred: false },
    });

    await demoteOrphanedSessions('user1', new Map());
    expect(chatSessionStore.patchMetadata).toHaveBeenCalledWith(
      'user1', 'chat-1', 'orphan-session', expect.any(Object),
    );
  });

  it('does not demote sessions that are in sessionMap', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1' }],
    });
    (chatSessionStore.getAllSessions as any).mockResolvedValue([
      { chatSession_id: 'active-session', source: { type: 'remote' } },
    ]);

    const sessionMap = new Map([['teams:user', { chatId: 'chat-1', chatSessionId: 'active-session', lastActiveAt: Date.now() }]]);
    await demoteOrphanedSessions('user1', sessionMap);
    expect(chatSessionStore.patchMetadata).not.toHaveBeenCalled();
  });

  it('does not demote sessions without remote source', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1' }],
    });
    (chatSessionStore.getAllSessions as any).mockResolvedValue([
      { chatSession_id: 'local-session', source: null },
    ]);

    await demoteOrphanedSessions('user1', new Map());
    expect(chatSessionStore.patchMetadata).not.toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    (profileCacheManager.getCachedProfile as any).mockImplementation(() => { throw new Error('db error'); });
    await expect(demoteOrphanedSessions('user1', new Map())).resolves.not.toThrow();
  });
});

describe('registerRemoteSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates session and notifies profile manager', async () => {
    (chatSessionStore.createSession as any).mockResolvedValue(undefined);
    (profileCacheManager.forceNotifyProfileDataManager as any).mockResolvedValue(undefined);

    await registerRemoteSession('user1', 'chat-1', 'sess-1', 'teams');

    expect(chatSessionStore.createSession).toHaveBeenCalledWith(
      'user1', 'chat-1',
      expect.objectContaining({ chatSession_id: 'sess-1', source: { type: 'remote', channel: 'teams' } }),
      expect.any(Object),
      { autoSelect: false },
    );
    expect(profileCacheManager.forceNotifyProfileDataManager).toHaveBeenCalledWith('user1');
  });

  it('handles errors without throwing', async () => {
    (chatSessionStore.createSession as any).mockRejectedValue(new Error('write error'));
    await expect(registerRemoteSession('user1', 'chat-1', 'sess-1', 'teams')).resolves.not.toThrow();
  });
});
