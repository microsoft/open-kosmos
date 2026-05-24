vi.mock('electron', async () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../cache/quickStartImageCacheManager', async () => ({
  quickStartImageCacheManager: {
    getInstance: vi.fn(() => ({
      cacheQuickStartImages: vi.fn(),
    })),
  },
}));

vi.mock('../pathUtils', async () => ({
  getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
  getDefaultAgentWorkspacePath: vi.fn(() => '/mock/workspace/agent'),
  ensureWorkspaceExists: vi.fn(),
  removeChatSessionsDirectory: vi.fn(),
  removeDefaultWorkspaceDirectory: vi.fn(),
  isDefaultWorkspacePath: vi.fn(() => false),
  moveContentsToDirectory: vi.fn(),
}));

vi.mock('../chatSessionManager', async () => ({
  chatSessionManager: {
    loadChatSessions: vi.fn(),
    saveChatSession: vi.fn(),
  },
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('../../../../shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

import { ProfileCacheManager } from '../profileCacheManager';
import type { ChatSession, ProfileV2, StarredChatSessionIndexItem } from '../types/profile';

function createTestProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    alias: 'testUser',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Agent One',
          model: 'claude-sonnet-4.6',
          workspace: '',
          knowledgeBase: '',
          version: '1.0.0',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: 'test',
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      },
    ],
    'starred-chat-sessions': [],
    ...overrides,
  };
}

function createStarredSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    chatSession_id: 'session-1',
    title: 'Important Session',
    last_updated: '2026-03-20T10:00:00.000Z',
    readStatus: 'unread',
    starred: true,
    starredAt: '2026-03-20T09:00:00.000Z',
    source: { type: 'local' },
    ...overrides,
  };
}

describe('ProfileCacheManager starred session index sync', () => {
  let manager: ProfileCacheManager;

  beforeEach(() => {
    (ProfileCacheManager as any).instance = undefined;
    manager = ProfileCacheManager.getInstance();
    (manager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds a starred session to profile-level index', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.syncStarredChatSessionIndex('testUser', 'chat-1', createStarredSession(), {
      notifyRenderer: true,
    });

    const updatedProfile = (manager as any).cache.get('testUser') as ProfileV2;
    const items = updatedProfile['starred-chat-sessions'] || [];

    expect(result).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining<Partial<StarredChatSessionIndexItem>>({
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        title: 'Important Session',
        agentName: 'Agent One',
        readStatus: 'unread',
      }),
    );
    expect((manager as any).writeProfileToFile).toHaveBeenCalledWith('testUser', updatedProfile);
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('testUser', true);
  });

  it('updates an existing starred index entry on metadata change', async () => {
    const profile = createTestProfile({
      'starred-chat-sessions': [
        {
          chatId: 'chat-1',
          chatSessionId: 'session-1',
          title: 'Old Title',
          lastUpdated: '2026-03-19T10:00:00.000Z',
          readStatus: 'unread',
          source: { type: 'local' },
          agentName: 'Agent One',
          agentEmoji: '🤖',
          agentAvatar: '',
          agentSource: 'ON-DEVICE',
          agentVersion: '1.0.0',
          starredAt: '2026-03-19T09:00:00.000Z',
        },
      ],
    });
    (manager as any).cache.set('testUser', profile);

    await manager.syncStarredChatSessionIndex(
      'testUser',
      'chat-1',
      createStarredSession({ title: 'New Title', last_updated: '2026-03-20T12:00:00.000Z', readStatus: 'read' }),
      { notifyRenderer: false },
    );

    const updatedProfile = (manager as any).cache.get('testUser') as ProfileV2;
    const items = updatedProfile['starred-chat-sessions'] || [];

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('New Title');
    expect(items[0].lastUpdated).toBe('2026-03-20T12:00:00.000Z');
    expect(items[0].readStatus).toBe('read');
    expect(items[0].starredAt).toBe('2026-03-20T09:00:00.000Z');
    expect((manager as any).notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('preserves existing readStatus and source on partial metadata sync', async () => {
    const profile = createTestProfile({
      'starred-chat-sessions': [
        {
          chatId: 'chat-1',
          chatSessionId: 'session-1',
          title: 'Old Title',
          lastUpdated: '2026-03-19T10:00:00.000Z',
          readStatus: 'unread',
          source: { type: 'local' },
          agentName: 'Agent One',
          agentEmoji: '🤖',
          agentAvatar: '',
          agentSource: 'ON-DEVICE',
          agentVersion: '1.0.0',
          starredAt: '2026-03-19T09:00:00.000Z',
        },
      ],
    });
    (manager as any).cache.set('testUser', profile);

    await manager.syncStarredChatSessionIndex(
      'testUser',
      'chat-1',
      {
        chatSession_id: 'session-1',
        title: 'New Title',
        last_updated: '2026-03-20T12:00:00.000Z',
      },
      { notifyRenderer: false },
    );

    const items = ((manager as any).cache.get('testUser') as ProfileV2)['starred-chat-sessions'] || [];
    expect(items[0].readStatus).toBe('unread');
    expect(items[0].source).toEqual({ type: 'local' });
  });

  it('removes an index entry when a session is unstarred', async () => {
    const profile = createTestProfile({
      'starred-chat-sessions': [
        {
          chatId: 'chat-1',
          chatSessionId: 'session-1',
          title: 'Important Session',
          lastUpdated: '2026-03-20T10:00:00.000Z',
          readStatus: 'unread',
          source: { type: 'local' },
          agentName: 'Agent One',
          agentEmoji: '🤖',
          agentAvatar: '',
          agentSource: 'ON-DEVICE',
          agentVersion: '1.0.0',
          starredAt: '2026-03-20T09:00:00.000Z',
        },
      ],
    });
    (manager as any).cache.set('testUser', profile);

    const result = await manager.syncStarredChatSessionIndex(
      'testUser',
      'chat-1',
      createStarredSession({ starred: false, starredAt: undefined }),
      { notifyRenderer: true },
    );

    const updatedProfile = (manager as any).cache.get('testUser') as ProfileV2;
    expect(result).toBe(true);
    expect(updatedProfile['starred-chat-sessions']).toEqual([]);
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('testUser', true);
  });

  it('removes an index entry by chatSessionId', async () => {
    const profile = createTestProfile({
      'starred-chat-sessions': [
        {
          chatId: 'chat-1',
          chatSessionId: 'session-1',
          title: 'Important Session',
          lastUpdated: '2026-03-20T10:00:00.000Z',
          readStatus: 'unread',
          source: { type: 'local' },
          agentName: 'Agent One',
          agentEmoji: '🤖',
          agentAvatar: '',
          agentSource: 'ON-DEVICE',
          agentVersion: '1.0.0',
          starredAt: '2026-03-20T09:00:00.000Z',
        },
      ],
    });
    (manager as any).cache.set('testUser', profile);

    const result = await manager.removeStarredChatSessionIndex('testUser', 'session-1', { notifyRenderer: false });

    expect(result).toBe(true);
    expect(((manager as any).cache.get('testUser') as ProfileV2)['starred-chat-sessions']).toEqual([]);
    expect((manager as any).notifyProfileDataManager).not.toHaveBeenCalled();
  });
});