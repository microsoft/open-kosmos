// @ts-nocheck
// Coverage tests for ProfileCacheManager — focuses on branches not yet covered:
// handleProfile, syncStarredChatSessionIndex, removeStarredChatSessionIndex,
// notifyProfileDataManager batching, forceNotifyProfileDataManager,
// setMainWindow, deprecated MCP helpers,
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

const writeFileAtomicallyWithRetryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../atomicFileWrite', () => ({
  writeFileAtomicallyWithRetry: writeFileAtomicallyWithRetryMock,
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

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

vi.mock('../../../../shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('@shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));

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


vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../featureFlags/featureFlagManager', async () => ({
  featureFlagManager: { isEnabled: vi.fn(() => false) },
}));

vi.mock('../../startup/lazy', async () => ({
  getExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));


const mcpManagerStore = vi.hoisted(() => ({ servers: new Map<string, any[]>() }));
const mcpManagerMock = vi.hoisted(() => ({
  getServers: vi.fn((alias: string) => mcpManagerStore.servers.get(alias) ?? []),
  getServerInfo: vi.fn((alias: string, name: string) =>
    (mcpManagerStore.servers.get(alias) ?? []).find((s: any) => s.name === name) ?? null),
  hasServersLoaded: vi.fn((alias: string) => mcpManagerStore.servers.has(alias)),
  hasPersistedServers: vi.fn((alias: string) => mcpManagerStore.servers.has(alias)),
  resolveFromDisk: vi.fn(async (alias: string, legacySlice?: any[]) => {
    mcpManagerStore.servers.set(alias, legacySlice ?? mcpManagerStore.servers.get(alias) ?? []);
  }),
  commitResolvedServers: vi.fn(async (alias: string, servers: any[]) => {
    mcpManagerStore.servers.set(alias, servers ?? []);
  }),
  addServer: vi.fn(async (alias: string, cfg: any) => {
    const cur = mcpManagerStore.servers.get(alias) ?? [];
    if (cur.some((s: any) => s.name === cfg.name)) return false;
    mcpManagerStore.servers.set(alias, [...cur, cfg]);
    return true;
  }),
  updateServer: vi.fn(async (alias: string, name: string, updates: any) => {
    const cur = mcpManagerStore.servers.get(alias) ?? [];
    const i = cur.findIndex((s: any) => s.name === name);
    if (i < 0) return false;
    const next = [...cur]; next[i] = { ...next[i], ...updates };
    mcpManagerStore.servers.set(alias, next);
    return true;
  }),
  deleteServer: vi.fn(async (alias: string, name: string) => {
    const cur = mcpManagerStore.servers.get(alias) ?? [];
    const i = cur.findIndex((s: any) => s.name === name);
    if (i < 0) return false;
    mcpManagerStore.servers.set(alias, cur.filter((_: any, j: number) => j !== i));
    return true;
  }),
  setServerInUse: vi.fn(async (alias: string, name: string, inUse: boolean) => {
    const cur = mcpManagerStore.servers.get(alias) ?? [];
    const i = cur.findIndex((s: any) => s.name === name);
    if (i < 0) return false;
    const next = [...cur]; next[i] = { ...next[i], in_use: inUse };
    mcpManagerStore.servers.set(alias, next);
    return true;
  }),
  clearCache: vi.fn((alias?: string) => {
    if (alias === undefined) mcpManagerStore.servers.clear();
    else mcpManagerStore.servers.delete(alias);
  }),
}));
vi.mock('../mcpConfigManager', () => ({
  mcpConfigManager: mcpManagerMock,
  McpConfigManager: class {},
}));

const skillsManagerStore = vi.hoisted(() => ({ skills: new Map<string, any[]>() }));
const skillsManagerMock = vi.hoisted(() => ({
  loadForAlias: vi.fn(async (alias: string, rawProfile: { skills?: unknown }) => {
    const skills = Array.isArray(rawProfile?.skills) ? (rawProfile.skills as any[]) : [];
    skillsManagerStore.skills.set(alias, skills);
    return { skills, needsProfileRewrite: false };
  }),
  getSkills: vi.fn((alias: string) => skillsManagerStore.skills.get(alias) ?? []),
  getSkill: vi.fn((alias: string, name: string) =>
    (skillsManagerStore.skills.get(alias) ?? []).find((s: any) => s.name === name)),
  hasSkill: vi.fn((alias: string, name: string) =>
    (skillsManagerStore.skills.get(alias) ?? []).some((s: any) => s.name === name)),
  hasSkillsLoaded: vi.fn((alias: string) => skillsManagerStore.skills.has(alias)),
  hasPersistedSkills: vi.fn(() => true),
  resolveFromDisk: vi.fn(async (alias: string, legacySlice?: any[]) => {
    skillsManagerStore.skills.set(alias, legacySlice ?? skillsManagerStore.skills.get(alias) ?? []);
  }),
  clearForAlias: vi.fn((alias: string) => {
    skillsManagerStore.skills.delete(alias);
  }),
  clearAll: vi.fn(() => {
    skillsManagerStore.skills.clear();
  }),
}));
vi.mock('../skillsConfigManager', () => ({
  skillsConfigManager: skillsManagerMock,
  SkillsConfigManager: class {},
}));

const hooksManagerStore = vi.hoisted(() => ({ hooks: new Map<string, any[]>() }));
const hooksManagerMock = vi.hoisted(() => ({
  loadForAlias: vi.fn(async (alias: string, rawProfile: { hooks?: unknown }) => {
    const hooks = Array.isArray(rawProfile?.hooks) ? (rawProfile.hooks as any[]) : [];
    hooksManagerStore.hooks.set(alias, hooks);
    return { hooks, needsProfileRewrite: false };
  }),
  getHooks: vi.fn((alias: string) => hooksManagerStore.hooks.get(alias) ?? []),
  getHook: vi.fn((alias: string, id: string) =>
    (hooksManagerStore.hooks.get(alias) ?? []).find((h: any) => h.id === id)),
  hasHook: vi.fn((alias: string, id: string) =>
    (hooksManagerStore.hooks.get(alias) ?? []).some((h: any) => h.id === id)),
  hasHooksLoaded: vi.fn((alias: string) => hooksManagerStore.hooks.has(alias)),
  hasPersistedHooks: vi.fn(() => true),
  resolveFromDisk: vi.fn(async (alias: string, legacySlice?: any[]) => {
    hooksManagerStore.hooks.set(alias, legacySlice ?? hooksManagerStore.hooks.get(alias) ?? []);
  }),
  commitResolvedHooks: vi.fn(async () => {}),
  addHook: vi.fn(async () => true),
  updateHook: vi.fn(async () => true),
  deleteHook: vi.fn(async () => true),
  clearForAlias: vi.fn((alias: string) => {
    hooksManagerStore.hooks.delete(alias);
  }),
  clearAll: vi.fn(() => {
    hooksManagerStore.hooks.clear();
  }),
}));
vi.mock('../hooksConfigManager', () => ({
  hooksConfigManager: hooksManagerMock,
  HooksConfigManager: class {},
}));

import { ProfileCacheManager, getChangedTopLevelKeys } from '../profileCacheManager';
import type { ProfileV2, ChatSession } from '../types/profile';
import { setRegistryAgents, clearRegistry as clearAgentRegistry } from '../agentStoreManager';
import * as agentStoreManagerNs from '../agentStoreManager';

beforeEach(() => {
  vi.clearAllMocks();
  mcpManagerStore.servers.clear();
});

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

// ─── deprecated MCP helpers ───────────────────────────────────────────────────

describe('ProfileCacheManager deprecated MCP helpers', () => {
  it('updateMcpServerStatus does not throw', () => {
    const mgr = freshManager();
    expect(() => mgr.updateMcpServerStatus('alice', 'srv', 'connected')).not.toThrow();
  });

  it('updateMcpServerTools does not throw', () => {
    const mgr = freshManager();
    expect(() => mgr.updateMcpServerTools('alice', 'srv', [{ name: 't', inputSchema: {} }])).not.toThrow();
  });

  it('updateMcpServerError does not throw', () => {
    const mgr = freshManager();
    expect(() => mgr.updateMcpServerError('alice', 'srv', new Error('oops'))).not.toThrow();
    expect(() => mgr.updateMcpServerError('alice', 'srv', null)).not.toThrow();
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
    expect(result?.computerUse).toEqual({
      enabled: false,
      alwaysAllowedApps: [],
      requireConfirmation: true,
    });
    expect(mgr.getCachedProfile('newuser')).not.toBeNull();
  });

  it('returns null when writeProfileToFile fails for new user', async () => {
    const mgr = freshManager();
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);

    const result = await mgr.handleProfile('newuser');
    expect(result).toBeNull();
  });

  it('returns null (does not write the profile) when the first-run agent store seed fails', async () => {
    // A failed agent store write would persist a default chat whose agent_ids point
    // at a missing agent.json (the inline copy is stripped on write), so the first-run
    // creation must abort rather than seed an agent-less default chat.
    const mgr = freshManager();
    (mgr as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
    const writeSpy = vi.spyOn(agentStoreManagerNs, 'writeAgent').mockRejectedValue(new Error('disk full'));
    try {
      const result = await mgr.handleProfile('newuser');
      expect(result).toBeNull();
      expect((mgr as any).writeProfileToFile).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
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

describe('ProfileCacheManager.writeProfileToFile', () => {
  it('strips derived chat workspace fields from profile.json', async () => {
    (ProfileCacheManager as any).instance = undefined;
    const mgr = ProfileCacheManager.getInstance();
    const profile = buildProfile('alice', {
      chats: [{
        chat_id: 'chat_20260101010101_dev_abc',
        chat_type: 'single_agent',
        workspace: '/runtime/workspace',
        agent_ids: ['agent-a'],
      }],
      archived_chats: [{
        chat_id: 'chat_20260102020202_dev_def',
        chat_type: 'single_agent',
        workspace: '/runtime/archived-workspace',
        agent_ids: ['agent-a'],
      }],
    });

    const result = await (mgr as any).writeProfileToFile('alice', profile);

    expect(result).toBe(true);
    const written = JSON.parse(writeFileAtomicallyWithRetryMock.mock.calls.at(-1)![1]);
    expect(written.chats[0].workspace).toBeUndefined();
    expect(written.archived_chats[0].workspace).toBeUndefined();
    expect(profile.chats[0].workspace).toBe('/runtime/workspace');
    expect(profile.archived_chats![0].workspace).toBe('/runtime/archived-workspace');
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

// ─── sidecar normalization (Phase 1: agents/skills/hooks change events) ───────

describe('ProfileCacheManager sidecar normalization (Phase 1)', () => {
  const alias = 'alice';
  const profileDir = '/mock/userData/profiles/alice';

  afterEach(() => clearAgentRegistry());

  it('getRegisteredAgents returns the registry snapshot for the alias', () => {
    const mgr = freshManager();
    expect(mgr.getRegisteredAgents(alias)).toEqual([]);
    setRegistryAgents(profileDir, [
      { id: 'a1', name: 'A1' } as any,
      { id: 'a2', name: 'A2' } as any,
    ]);
    expect(mgr.getRegisteredAgents(alias).map((a: any) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('emitSidecarChangeEvents pushes agents/skills/hooks slices to the window', () => {
    const mgr = freshManager();
    setRegistryAgents(profileDir, [{ id: 'a1', name: 'A1' } as any]);
    skillsManagerStore.skills.set(alias, [{ name: 'skill-x' } as any]);
    hooksManagerStore.hooks.set(alias, [{ id: 'hook-y' } as any]);

    const send = vi.fn();
    const win = { webContents: { send } } as any;
    (mgr as any).emitSidecarChangeEvents(win, alias);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith(
      'agents:changed',
      expect.objectContaining({ alias, agents: [{ id: 'a1', name: 'A1' }] }),
    );
    expect(send).toHaveBeenCalledWith(
      'skills:changed',
      expect.objectContaining({ alias, skills: [{ name: 'skill-x' }] }),
    );
    expect(send).toHaveBeenCalledWith(
      'hooks:changed',
      expect.objectContaining({ alias, hooks: [{ id: 'hook-y' }] }),
    );
  });
});

describe('getChangedTopLevelKeys', () => {
  it('returns [] when either argument is not a non-null object', () => {
    // Covers the guard branch (non-object / null inputs short-circuit to []).
    expect(getChangedTopLevelKeys(null, { a: 1 })).toEqual([]);
    expect(getChangedTopLevelKeys({ a: 1 }, null)).toEqual([]);
    expect(getChangedTopLevelKeys('not-an-object', { a: 1 })).toEqual([]);
    expect(getChangedTopLevelKeys({ a: 1 }, 42)).toEqual([]);
    expect(getChangedTopLevelKeys(undefined, undefined)).toEqual([]);
  });

  it('returns the sorted set of top-level keys whose JSON differs', () => {
    // Covers the object-comparison branch: changed, added, and removed keys.
    const before = { name: 'old', shared: { x: 1 }, removed: true };
    const after = { name: 'new', shared: { x: 1 }, added: 5 };
    expect(getChangedTopLevelKeys(before, after)).toEqual(['added', 'name', 'removed']);
  });

  it('returns [] when both objects are deeply equal', () => {
    const value = { a: 1, b: { c: [1, 2, 3] } };
    expect(getChangedTopLevelKeys({ ...value }, { ...value })).toEqual([]);
  });
});
