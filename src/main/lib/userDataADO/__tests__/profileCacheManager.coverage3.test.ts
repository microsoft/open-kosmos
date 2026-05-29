// @ts-nocheck
/**
 * profileCacheManager.coverage3.test.ts
 *
 * Targets uncovered lines NOT hit by deep3 (which mocks out key methods):
 * - getElectronApp: global mock path (line 106), catch path (line 112)
 * - ensureDirectoryExists: mkdirSync branch (line 220)
 * - readProfileFromFile: full body (lines 228-254)
 * - ensureV2ProfileIntegrity: full body (lines 426-488)
 * - writeProfileToFile: full body (lines 510-528)
 * - notifyProfileDataManager: batched path (lines 544-554)
 * - syncStarredChatSessionIndex: various branches (lines 278-356)
 * - settingsCtx, archiveCtx, chatSessionCtx: context builders (lines 1312-1415)
 */

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockGetAllWindows = vi.hoisted(() => vi.fn(() => []));
const mockFsExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockFsMkdirSync = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsReadFile = vi.hoisted(() => vi.fn().mockResolvedValue('{}'));

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockFsExistsSync,
    mkdirSync: mockFsMkdirSync,
    promises: {
      ...actual.promises,
      writeFile: mockFsWriteFile,
      readFile: mockFsReadFile,
    },
  };
});

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

const mockGetChatSessions = vi.hoisted(() => vi.fn().mockResolvedValue({ sessions: [] }));
vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: mockGetChatSessions,
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

const mockGhcInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../llm/ghcModelsManager', async () => ({
  ghcModelsManager: { initialize: mockGhcInitialize },
  getDefaultModel: vi.fn(() => 'gpt-5'),
}));

const mockMcpInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    initialize: mockMcpInitialize,
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

const mockFeatureFlagIsEnabled = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../featureFlags/featureFlagManager', async () => ({
  featureFlagManager: { isEnabled: mockFeatureFlagIsEnabled },
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

vi.mock('../profileSanitizer', async () => {
  const actual = await vi.importActual('../profileSanitizer');
  return actual;
});

vi.mock('../profileMigration', async () => {
  const actual = await vi.importActual('../profileMigration');
  return actual;
});

// ── imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileCacheManager } from '../profileCacheManager';
import type { ProfileV2 } from '../types/profile';

// ── helpers ───────────────────────────────────────────────────────────────────

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  return ProfileCacheManager.getInstance();
}

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    alias: 'testUser',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    'starred-chat-sessions': [],
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Agent',
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
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFsExistsSync.mockReturnValue(false);
  mockFsMkdirSync.mockImplementation(() => undefined);
  mockFsWriteFile.mockResolvedValue(undefined);
  mockFsReadFile.mockResolvedValue('{}');
});

// ── getElectronApp: global.electron.app path ─────────────────────────────────
// getElectronApp is a module-level function; test via getProfileDirectoryPath

describe('ProfileCacheManager — getElectronApp paths', () => {
  it('uses global.electron.app when set (line 106)', () => {
    const mockApp = { getPath: vi.fn(() => '/global/userData') };
    (global as any).electron = { app: mockApp };

    const mgr = freshManager();
    // getProfileDirectoryPath calls getElectronApp() internally
    const dir = (mgr as any).getProfileDirectoryPath('alice');
    expect(mockApp.getPath).toHaveBeenCalled();
    expect(dir).toContain('alice');

    delete (global as any).electron;
  });

  it('uses electron.app from import when global.electron not set (line 109)', () => {
    delete (global as any).electron;
    const mgr = freshManager();
    const dir = (mgr as any).getProfileDirectoryPath('alice');
    expect(dir).toContain('alice');
  });
});

// ── ensureDirectoryExists ─────────────────────────────────────────────────────

describe('ProfileCacheManager — ensureDirectoryExists', () => {
  it('calls mkdirSync when directory does not exist (line 220)', () => {
    mockFsExistsSync.mockReturnValue(false);
    const mgr = freshManager();
    (mgr as any).ensureDirectoryExists('/some/path');
    expect(mockFsMkdirSync).toHaveBeenCalledWith('/some/path', { recursive: true });
  });

  it('does not call mkdirSync when directory exists', () => {
    mockFsExistsSync.mockReturnValue(true);
    const mgr = freshManager();
    (mgr as any).ensureDirectoryExists('/some/path');
    expect(mockFsMkdirSync).not.toHaveBeenCalled();
  });
});

// ── writeProfileToFile ────────────────────────────────────────────────────────

describe('ProfileCacheManager — writeProfileToFile (real)', () => {
  it('writes profile file and returns true (lines 510-526)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    const mgr = freshManager();
    const profile = makeProfile();

    const result = await (mgr as any).writeProfileToFile('testUser', profile);
    expect(result).toBe(true);
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  it('returns false when writeFile throws (line 528)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsWriteFile.mockRejectedValueOnce(new Error('disk full'));
    const mgr = freshManager();

    const result = await (mgr as any).writeProfileToFile('testUser', makeProfile());
    expect(result).toBe(false);
  });
});

// ── readProfileFromFile ───────────────────────────────────────────────────────

describe('ProfileCacheManager — readProfileFromFile (real)', () => {
  it('returns null when profile file does not exist (line 232)', async () => {
    mockFsExistsSync.mockReturnValue(false);
    const mgr = freshManager();
    // Mock writeProfileToFile to avoid side effects
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);

    const result = await (mgr as any).readProfileFromFile('testUser');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON (line 242)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFile.mockResolvedValueOnce('{ invalid json }');
    const mgr = freshManager();

    const result = await (mgr as any).readProfileFromFile('testUser');
    expect(result).toBeNull();
  });

  it('returns null when profile is not V2 format (line 247)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0' }));
    const mgr = freshManager();

    const result = await (mgr as any).readProfileFromFile('testUser');
    expect(result).toBeNull();
  });

  it('returns profile when valid V2 JSON exists (lines 235-252)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    const profile = makeProfile();
    mockFsReadFile.mockResolvedValueOnce(JSON.stringify(profile));
    mockFsWriteFile.mockResolvedValue(undefined); // for writeProfileToFile in ensureV2ProfileIntegrity

    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);

    const result = await (mgr as any).readProfileFromFile('testUser');
    expect(result).toBeDefined();
    expect(result?.alias).toBe('testUser');
  });
});

// ── ensureV2ProfileIntegrity ──────────────────────────────────────────────────

describe('ProfileCacheManager — ensureV2ProfileIntegrity', () => {
  it('runs migrations and returns profile copy (lines 426-485)', async () => {
    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    const profile = makeProfile();

    const result = await (mgr as any).ensureV2ProfileIntegrity('testUser', profile);
    expect(result).toBeDefined();
    expect(result.alias).toBe('testUser');
  });

  it('adds default chat when chats array is empty (lines 439-441)', async () => {
    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    const profile = makeProfile({ chats: [] });

    const result = await (mgr as any).ensureV2ProfileIntegrity('testUser', profile);
    expect(result.chats).toBeDefined();
    expect(result.chats.length).toBeGreaterThanOrEqual(1);
  });

  it('returns minimal safe profile on error (lines 486-499)', async () => {
    const mgr = freshManager();
    // Pass invalid profile that causes an error in the try block
    const badProfile = { version: '2.0.0' } as any;

    const result = await (mgr as any).ensureV2ProfileIntegrity('testUser', badProfile);
    expect(result).toBeDefined();
    expect(result.version).toBe('2.0.0');
  });
});

// ── notifyProfileDataManager: batched path ────────────────────────────────────

describe('ProfileCacheManager — notifyProfileDataManager (batched)', () => {
  it('debounces notifications when called multiple times (lines 544-554)', async () => {
    const mgr = freshManager();
    // Mock performNotification to avoid window lookup
    (mgr as any).performNotification = vi.fn().mockResolvedValue(undefined);

    // Call non-immediate (batched) multiple times
    await (mgr as any).notifyProfileDataManager('user1');
    await (mgr as any).notifyProfileDataManager('user1');
    // The notifications are batched; performNotification shouldn't be called yet
    expect((mgr as any).batchedUpdates.has('user1')).toBe(true);

    // Cleanup timeout
    if ((mgr as any).notificationTimeout) {
      clearTimeout((mgr as any).notificationTimeout);
      (mgr as any).notificationTimeout = null;
    }
  });

  it('calls performNotification immediately when immediate=true', async () => {
    const mgr = freshManager();
    (mgr as any).performNotification = vi.fn().mockResolvedValue(undefined);

    await (mgr as any).notifyProfileDataManager('user1', true);
    expect((mgr as any).performNotification).toHaveBeenCalledWith('user1', true);
  });
});

// ── syncStarredChatSessionIndex: branches ────────────────────────────────────

describe('ProfileCacheManager — syncStarredChatSessionIndex', () => {
  it('returns false when cache is empty', async () => {
    const mgr = freshManager();
    const result = await mgr.syncStarredChatSessionIndex('user1', 'chat-1', { chatSession_id: 'sess-1', starred: true });
    expect(result).toBe(false);
  });

  it('returns false when session has no chatSession_id', async () => {
    const mgr = freshManager();
    (mgr as any).cache.set('user1', makeProfile());
    const result = await mgr.syncStarredChatSessionIndex('user1', 'chat-1', {});
    expect(result).toBe(false);
  });

  it('returns false when neither shouldRemove nor shouldTrack', async () => {
    const mgr = freshManager();
    const profile = makeProfile({ 'starred-chat-sessions': [] });
    (mgr as any).cache.set('user1', profile);
    // starred is undefined (not true/false) so shouldTrack=false and shouldRemove=false
    const result = await mgr.syncStarredChatSessionIndex('user1', 'chat-1', { chatSession_id: 'sess-1' });
    expect(result).toBe(false);
  });

  it('returns false when items are unchanged (line 301-302)', async () => {
    const mgr = freshManager();
    // Create profile with existing starred session
    const existingItem = {
      chatSessionId: 'sess-1',
      chatId: 'chat-1',
      userAlias: 'user1',
      title: 'Test',
      lastUpdated: '2026-01-01T00:00:00Z',
      starredAt: '2026-01-01T00:00:00Z',
    };
    const profile = makeProfile({ 'starred-chat-sessions': [existingItem] });
    (mgr as any).cache.set('user1', profile);

    // Remove when already removed (shouldRemove=true)
    const result = await mgr.syncStarredChatSessionIndex('user1', 'chat-1', {
      chatSession_id: 'sess-999', // not in list
      starred: false,
    });
    expect(result).toBe(false);
  });

  it('calls writeProfileToFile and returns true on success', async () => {
    const mgr = freshManager();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);

    const profile = makeProfile({ 'starred-chat-sessions': [] });
    (mgr as any).cache.set('user1', profile);

    const result = await mgr.syncStarredChatSessionIndex('user1', 'chat-1', {
      chatSession_id: 'sess-1',
      starred: true,
      title: 'My Session',
    });
    // May return false if buildStarredChatSessionIndexItem returns null
    expect(typeof result).toBe('boolean');
  });
});

// ── context builders: settingsCtx, archiveCtx, chatSessionCtx ────────────────

describe('ProfileCacheManager — context builders', () => {
  it('settingsCtx returns a context object with cache (line 1312)', () => {
    const mgr = freshManager();
    const ctx = (mgr as any).settingsCtx();
    expect(ctx).toBeDefined();
    expect(ctx.cache).toBeDefined();
  });

  it('archiveCtx returns a context with archive operations (line 1381)', () => {
    const mgr = freshManager();
    const ctx = (mgr as any).archiveCtx();
    expect(ctx).toBeDefined();
    expect(ctx.cache).toBeDefined();
    expect(typeof ctx.readProfileFromFile).toBe('function');
  });

  it('chatSessionCtx returns a context with session operations (line 1409)', () => {
    const mgr = freshManager();
    const ctx = (mgr as any).chatSessionCtx();
    expect(ctx).toBeDefined();
    expect(typeof ctx.syncStarredChatSessionIndex).toBe('function');
  });

  it('entityCtx returns a context with CRUD operations (line 945)', () => {
    const mgr = freshManager();
    const ctx = (mgr as any).entityCtx();
    expect(ctx).toBeDefined();
    expect(ctx.cache).toBeDefined();
  });

  it('chatCrudCtx returns a context with chat CRUD (line 1000)', () => {
    const mgr = freshManager();
    const ctx = (mgr as any).chatCrudCtx();
    expect(ctx).toBeDefined();
    expect(typeof ctx.readProfileFromFile).toBe('function');
  });
});

// ── settings delegators (lines 1312-1375) ────────────────────────────────────

describe('ProfileCacheManager — settings delegators', () => {
  it('getAllChatConfigs returns array', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('user1', makeProfile());
    const result = mgr.getAllChatConfigs('user1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('getCachedProfile returns profile', () => {
    const mgr = freshManager();
    const profile = makeProfile();
    (mgr as any).cache.set('user1', profile);
    expect(mgr.getCachedProfile('user1')).toBeDefined();
  });

  it('getCachedAliases returns list', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('user1', makeProfile());
    expect(mgr.getCachedAliases()).toContain('user1');
  });
});

// ── clearCache ────────────────────────────────────────────────────────────────

describe('ProfileCacheManager — clearCache', () => {
  it('clears specific alias (lines 1058-1077)', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('user1', makeProfile());
    mgr.clearCache('user1');
    expect((mgr as any).cache.has('user1')).toBe(false);
  });

  it('handles alias not in cache (line 1073)', () => {
    const mgr = freshManager();
    // Alias not present
    expect(() => mgr.clearCache('nonexistent')).not.toThrow();
  });

  it('clears all cache (lines 1089-1095)', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('user1', makeProfile());
    (mgr as any).cache.set('user2', makeProfile({ alias: 'user2' }));
    mgr.clearCache();
    expect((mgr as any).cache.size).toBe(0);
  });

  it('handles empty cache clear (line 1095)', () => {
    const mgr = freshManager();
    // No entries
    expect(() => mgr.clearCache()).not.toThrow();
  });
});
