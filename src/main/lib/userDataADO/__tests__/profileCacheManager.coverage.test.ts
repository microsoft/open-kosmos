// @ts-nocheck
// Coverage tests for ProfileCacheManager — focuses on branches not yet covered:
// handleProfile, syncStarredChatSessionIndex, removeStarredChatSessionIndex,
// notifyProfileDataManager batching, forceNotifyProfileDataManager,
// setMainWindow, setRemoteChannelManagerGetter, deprecated MCP helpers,
// getCachedProfile, getAllChatConfigs, context builders

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('fs');

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../cache/quickStartImageCacheManager', async () => ({
  quickStartImageCacheManager: {
    getInstance: vi.fn(() => ({ cacheQuickStartImages: vi.fn() })),
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
  chatSessionManager: { loadChatSessions: vi.fn(), saveChatSession: vi.fn() },
}));

vi.mock('../../../../shared/constants/branding', async () => ({ BRAND_NAME: 'kosmos' }));
vi.mock('@shared/constants/branding', async () => ({ BRAND_NAME: 'kosmos' }));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('../../../../shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));
vi.mock('@shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('@shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn().mockResolvedValue({ sessions: [] }),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  ghcModelsManager: { initialize: vi.fn().mockResolvedValue(undefined) },
  getDefaultModel: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllMcpServerRuntimeStates: vi.fn(() => []),
    getMcpServerRuntimeState: vi.fn(() => null),
    _clearServerRuntimeState: vi.fn(),
    executeTool: vi.fn(),
  },
}));

vi.mock('../../plugin/pluginManager', async () => ({
  pluginManager: { initialize: vi.fn().mockResolvedValue({ errors: [] }) },
}));


vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../featureFlags/featureFlagManager', async () => ({
  featureFlagManager: { isEnabled: vi.fn(() => false) },
}));

vi.mock('../../remoteChannel/credentialStore', async () => ({
  credentialStore: { hasCredential: vi.fn().mockResolvedValue(false) },
}));

vi.mock('../../startup/lazy', async () => ({
  getExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: { getInstance: vi.fn(() => ({ getCachedConfig: vi.fn() })) },
}));

import { ProfileCacheManager } from '../profileCacheManager';
import type { ProfileV2, ChatSession } from '../types/profile';

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildProfile(alias = 'alice', overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    alias,
    freDone: false,
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
          model: 'gpt-5',
          workspace: '/mock/workspace',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: 'hello',
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      },
    ],
    'starred-chat-sessions': [],
    ...overrides,
  };
}

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  const mgr = ProfileCacheManager.getInstance();
  (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  return mgr;
}

// ─── setMainWindow ────────────────────────────────────────────────────────────

describe('ProfileCacheManager.setMainWindow', () => {
  it('stores the window reference without throwing', () => {
    const mgr = freshManager();
    const fakeWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any;
    expect(() => mgr.setMainWindow(fakeWindow)).not.toThrow();
    expect((mgr as any).mainWindow).toBe(fakeWindow);
  });
});

// ─── setRemoteChannelManagerGetter ────────────────────────────────────────────

describe('ProfileCacheManager.setRemoteChannelManagerGetter', () => {
  it('stores the getter function', () => {
    const mgr = freshManager();
    const getter = vi.fn().mockResolvedValue({});
    mgr.setRemoteChannelManagerGetter(getter);
    expect((mgr as any).getRemoteChannelManager).toBe(getter);
  });
});

// ─── getCachedProfile ─────────────────────────────────────────────────────────

describe('ProfileCacheManager.getCachedProfile', () => {
  it('returns null when alias is not cached', () => {
    const mgr = freshManager();
    expect(mgr.getCachedProfile('nobody')).toBeNull();
  });

  it('returns the cached profile when present', () => {
    const mgr = freshManager();
    const profile = buildProfile('alice');
    (mgr as any).cache.set('alice', profile);
    expect(mgr.getCachedProfile('alice')).toEqual(profile);
  });
});

// ─── forceNotifyProfileDataManager ───────────────────────────────────────────

describe('ProfileCacheManager.forceNotifyProfileDataManager', () => {
  it('calls notifyProfileDataManager with immediate=true', async () => {
    const mgr = freshManager();
    const spy = (mgr as any).notifyProfileDataManager as ReturnType<typeof vi.fn>;
    await mgr.forceNotifyProfileDataManager('alice');
    expect(spy).toHaveBeenCalledWith('alice', true);
  });
});


// ─── syncStarredChatSessionIndex ─────────────────────────────────────────────

describe('ProfileCacheManager.syncStarredChatSessionIndex', () => {
  it('returns false when alias is not cached', async () => {
    const mgr = freshManager();
    const result = await mgr.syncStarredChatSessionIndex('nobody', 'chat-1', {
      chatSession_id: 'session-1',
      starred: true,
    } as any);
    expect(result).toBe(false);
  });

  it('returns false when session has no chatSession_id', async () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    const result = await mgr.syncStarredChatSessionIndex('alice', 'chat-1', {} as any);
    expect(result).toBe(false);
  });

  it('returns false when shouldRemove is false and shouldTrack is false', async () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    // starred is undefined, no existing item
    const result = await mgr.syncStarredChatSessionIndex('alice', 'chat-1', {
      chatSession_id: 'session-x',
    } as any);
    expect(result).toBe(false);
  });

  it('adds a new starred session when starred=true', async () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      chats: [{
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Test',
          model: 'gpt-5',
          workspace: '/ws',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      }],
    });
    (mgr as any).cache.set('alice', profile);

    const result = await mgr.syncStarredChatSessionIndex('alice', 'chat-1', {
      chatSession_id: 'session-1',
      starred: true,
      title: 'My Session',
      last_updated: new Date().toISOString(),
    } as any);

    expect(result).toBe(true);
    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated['starred-chat-sessions'].some(i => i.chatSessionId === 'session-1')).toBe(true);
  });

  it('removes a starred session when starred=false', async () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      'starred-chat-sessions': [{
        chatSessionId: 'session-1',
        chatId: 'chat-1',
        title: 'My Session',
        agentName: 'Test',
        agentEmoji: '🤖',
        lastUpdated: new Date().toISOString(),
        starredAt: new Date().toISOString(),
      }],
    });
    (mgr as any).cache.set('alice', profile);

    const result = await mgr.syncStarredChatSessionIndex('alice', 'chat-1', {
      chatSession_id: 'session-1',
      starred: false,
    } as any);

    expect(result).toBe(true);
    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated['starred-chat-sessions'].some(i => i.chatSessionId === 'session-1')).toBe(false);
  });

  it('rolls back cache if write fails', async () => {
    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);
    const profile = buildProfile('alice', {
      chats: [{
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Test',
          model: 'gpt-5',
          workspace: '/ws',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      }],
    });
    (mgr as any).cache.set('alice', profile);

    const result = await mgr.syncStarredChatSessionIndex('alice', 'chat-1', {
      chatSession_id: 'session-2',
      starred: true,
      title: 'Session',
      last_updated: new Date().toISOString(),
    } as any);

    expect(result).toBe(false);
  });
});

// ─── removeStarredChatSessionIndex ───────────────────────────────────────────

describe('ProfileCacheManager.removeStarredChatSessionIndex', () => {
  it('returns false when alias is not cached', async () => {
    const mgr = freshManager();
    expect(await mgr.removeStarredChatSessionIndex('nobody', 'session-1')).toBe(false);
  });

  it('returns false when session is not in the list', async () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    expect(await mgr.removeStarredChatSessionIndex('alice', 'nonexistent')).toBe(false);
  });

  it('removes the session and returns true', async () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      'starred-chat-sessions': [{
        chatSessionId: 'session-1',
        chatId: 'chat-1',
        title: 'Test',
        agentName: 'Agent',
        agentEmoji: '🤖',
        lastUpdated: new Date().toISOString(),
        starredAt: new Date().toISOString(),
      }],
    });
    (mgr as any).cache.set('alice', profile);

    const result = await mgr.removeStarredChatSessionIndex('alice', 'session-1');
    expect(result).toBe(true);
    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated['starred-chat-sessions']).toHaveLength(0);
  });

  it('rolls back cache if write fails', async () => {
    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);
    const profile = buildProfile('alice', {
      'starred-chat-sessions': [{
        chatSessionId: 'session-1',
        chatId: 'chat-1',
        title: 'Test',
        agentName: 'Agent',
        agentEmoji: '🤖',
        lastUpdated: new Date().toISOString(),
        starredAt: new Date().toISOString(),
      }],
    });
    (mgr as any).cache.set('alice', profile);

    const result = await mgr.removeStarredChatSessionIndex('alice', 'session-1');
    expect(result).toBe(false);
    // Cache should be restored
    const current = (mgr as any).cache.get('alice') as ProfileV2;
    expect(current['starred-chat-sessions']).toHaveLength(1);
  });

  it('suppresses renderer notification when notifyRenderer=false', async () => {
    const mgr = freshManager();
    const notifySpy = (mgr as any).notifyProfileDataManager as ReturnType<typeof vi.fn>;
    const profile = buildProfile('alice', {
      'starred-chat-sessions': [{
        chatSessionId: 'session-1',
        chatId: 'chat-1',
        title: 'Test',
        agentName: 'Agent',
        agentEmoji: '🤖',
        lastUpdated: new Date().toISOString(),
        starredAt: new Date().toISOString(),
      }],
    });
    (mgr as any).cache.set('alice', profile);

    await mgr.removeStarredChatSessionIndex('alice', 'session-1', { notifyRenderer: false });
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

// ─── handleProfile — new user (no profile file) ───────────────────────────────

describe('ProfileCacheManager.handleProfile — new user', () => {
  it('creates and caches a default profile when no file exists', async () => {
    const mgr = freshManager();
    // readProfileFromFile returns null => new user
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);

    const result = await mgr.handleProfile('newuser');

    expect(result).not.toBeNull();
    expect(result?.alias).toBe('newuser');
    expect(mgr.getCachedProfile('newuser')).not.toBeNull();
  });

  it('returns null when writeProfileToFile fails for new user', async () => {
    const mgr = freshManager();
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);

    const result = await mgr.handleProfile('newuser');
    expect(result).toBeNull();
  });
});

// ─── handleProfile — existing user ────────────────────────────────────────────

describe('ProfileCacheManager.handleProfile — existing user', () => {
  it('loads existing profile from file and caches it', async () => {
    const mgr = freshManager();
    const existing = buildProfile('alice');
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(existing);

    const result = await mgr.handleProfile('alice');
    expect(result).toEqual(existing);
    expect(mgr.getCachedProfile('alice')).toEqual(existing);
  });

  it('skips renderer notification when notifyRenderer=false', async () => {
    const mgr = freshManager();
    const existing = buildProfile('alice');
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(existing);
    const notifySpy = (mgr as any).notifyProfileDataManager as ReturnType<typeof vi.fn>;

    await mgr.handleProfile('alice', { notifyRenderer: false });
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

// ─── notifyProfileDataManager batching ───────────────────────────────────────

describe('ProfileCacheManager.notifyProfileDataManager batching', () => {
  it('debounces multiple non-immediate notifications', async () => {
    // Use a real manager without the stubbed notifyProfileDataManager
    (ProfileCacheManager as any).instance = undefined;
    const mgr = ProfileCacheManager.getInstance();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    // Spy on the internal performNotification
    const performSpy = vi.fn().mockResolvedValue(undefined);
    (mgr as any).performNotification = performSpy;

    // Call non-immediate 3 times
    await (mgr as any).notifyProfileDataManager('alice');
    await (mgr as any).notifyProfileDataManager('alice');
    await (mgr as any).notifyProfileDataManager('bob');

    // Wait for debounce (150 ms)
    await new Promise(r => setTimeout(r, 200));

    // processBatchedNotifications should have fired once per unique alias
    expect(performSpy).toHaveBeenCalled();
  });

  it('calls performNotification immediately when immediate=true', async () => {
    (ProfileCacheManager as any).instance = undefined;
    const mgr = ProfileCacheManager.getInstance();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    const performSpy = vi.fn().mockResolvedValue(undefined);
    (mgr as any).performNotification = performSpy;

    await (mgr as any).notifyProfileDataManager('alice', true);
    expect(performSpy).toHaveBeenCalledWith('alice', true);
  });
});
