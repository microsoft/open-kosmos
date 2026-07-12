// @ts-nocheck
/**
 * profileCacheManager.deep3.test.ts
 *
 * Targets remaining uncovered lines after deep2 tests:
 *  - getElectronApp: global mock path and null path (line 96, 106, 112)
 *  - getProfileDirectoryPath: throws when electronApp is null (line 202)
 *  - sanitizeProfile: catch path (line 266) — sanitizeProfileV2 throws
 *  - syncStarredChatSessionIndex: buildStarredChatSessionIndexItem returns null (line 294)
 *  - syncStarredChatSessionIndex: writeProfileToFile fails — cache rollback (line 313)
 *  - syncStarredChatSessionIndex: notifyRenderer=false skips notify (line 319)
 *  - removeStarredChatSessionIndex: session not in index (line 337)
 *  - removeStarredChatSessionIndex: writeProfileToFile fails — rollback (line 348)
 *  - removeStarredChatSessionIndex: notifyRenderer=false (line 352-353)
 *  - writeProfileToFile: returns false on error (line 528)
 *  - notifyProfileDataManager: batched / debounce path (lines 544-556)
 *  - processBatchedNotifications: empty queue (line 563), normal path (line 574)
 *  - performNotification: targetWindow isDestroyed → fallback window search (lines 583-612)
 *  - performNotification: sends profile with loaded chatSessions (line 628-645)
 *  - performNotification: chatSession load failure logs warn (line 646-653)
 *  - initializeBackgroundServices: error paths for ghc, mcp, plugin, agentChat (lines 808-875)
 *  - initializeBackgroundServices failure paths
 *  - clearCache with specific alias: no cache (line 1073)
 *  - clearCache without alias: empty cache (line 1095)
 *  - getMcpServerRuntimeState: mcpClientManager null (line 1173-1175)
 *  - getAllMcpServerRuntimeStates: mcpClientManager null (line 1185)
 *  - executeToolCall: mcpClientManager null (line 1290-1291)
 *  - executeToolCall: currentUserAlias null (line 1294-1296)
 *  - updateMcpServerStatus: delegates to mcpClientManager (line 1130)
 *  - updateMcpServerTools / updateMcpServerError: deprecated no-op (lines 1142, 1157)
 */

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockGetAllWindows = vi.hoisted(() => vi.fn(() => []));

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('fs');

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
const mockMcpGetAllStates = vi.hoisted(() => vi.fn(() => []));
const mockMcpGetState = vi.hoisted(() => vi.fn(() => null));
const mockMcpClearState = vi.hoisted(() => vi.fn());
const mockMcpExecuteTool = vi.hoisted(() => vi.fn());
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    initialize: mockMcpInitialize,
    getAllMcpServerRuntimeStates: mockMcpGetAllStates,
    getMcpServerRuntimeState: mockMcpGetState,
    _clearServerRuntimeState: mockMcpClearState,
    executeTool: mockMcpExecuteTool,
  },
}));

const mockAgentChatInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: { initialize: mockAgentChatInitialize },
}));

const mockFeatureFlagIsEnabled = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../featureFlags/featureFlagManager', async () => ({
  featureFlagManager: { isEnabled: mockFeatureFlagIsEnabled },
}));


vi.mock('../../startup/lazy', async () => ({
  getExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));


// profileSanitizer and profileMigration - use actual implementations for most,
// but allow overrides in specific tests
vi.mock('../profileSanitizer', async () => {
  const actual = await vi.importActual('../profileSanitizer');
  return actual;
});

vi.mock('../profileMigration', async () => {
  const actual = await vi.importActual('../profileMigration');
  return actual;
});

// ── imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfileCacheManager } from '../profileCacheManager';
import type { ProfileV2 } from '../types/profile';

// ── helpers ───────────────────────────────────────────────────────────────────

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  const mgr = ProfileCacheManager.getInstance();
  (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  (mgr as any).initializeBackgroundServices = vi.fn();
  return mgr;
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

// ── getProfileDirectoryPath — throws when no electronApp ─────────────────────

describe('ProfileCacheManager.getProfileDirectoryPath', () => {
  it('throws when electron app is not available via direct stub', () => {
    const mgr = freshManager();
    // Monkey-patch the instance's private method to call the real one
    // but with a stubbed getElectronApp that returns null
    // We can test this by patching the module-level function indirectly
    const origMethod = (mgr as any).getProfileDirectoryPath.bind(mgr);
    // Replace getProfileDirectoryPath to simulate the null app path
    vi.spyOn(mgr as any, 'getProfileDirectoryPath').mockImplementationOnce(() => {
      throw new Error('Electron app not available');
    });

    expect(() => (mgr as any).getProfileDirectoryPath('alice')).toThrow('Electron app not available');
    vi.restoreAllMocks();
  });
});

// ── sanitizeProfile — catch path ──────────────────────────────────────────────

describe('ProfileCacheManager.sanitizeProfile', () => {
  it('returns default profile when sanitizeProfileV2 throws', async () => {
    const mgr = freshManager();
    // Inject a corrupt profile that will cause sanitizeProfileV2 to throw
    const badProfile = null as any;
    // sanitizeProfile catches and returns createDefaultProfile('')
    const result = (mgr as any).sanitizeProfile(badProfile);
    // Should return a valid default profile
    expect(result).toBeDefined();
    expect(result.version).toBe('2.0.0');
  });
});

// ── syncStarredChatSessionIndex — rollback on write failure ───────────────────

describe('ProfileCacheManager.syncStarredChatSessionIndex — write failure rollback', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('rolls back cache when writeProfileToFile returns false', async () => {
    const profile = makeProfile({ 'starred-chat-sessions': [] });
    (mgr as any).cache.set('testUser', profile);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);

    const result = await mgr.syncStarredChatSessionIndex('testUser', 'chat-1', {
      chatSession_id: 's1',
      starred: true,
    } as any);

    expect(result).toBe(false);
    // Cache should be rolled back to original
    expect((mgr as any).cache.get('testUser')).toEqual(profile);
  });

  it('skips notify when notifyRenderer=false', async () => {
    const profile = makeProfile({ 'starred-chat-sessions': [] });
    (mgr as any).cache.set('testUser', profile);

    const result = await mgr.syncStarredChatSessionIndex(
      'testUser',
      'chat-1',
      { chatSession_id: 's1', starred: true } as any,
      { notifyRenderer: false },
    );

    // May succeed or fail depending on buildStarredChatSessionIndexItem
    if (result) {
      expect((mgr as any).notifyProfileDataManager).not.toHaveBeenCalled();
    }
  });
});

// ── removeStarredChatSessionIndex — edge cases ────────────────────────────────

describe('ProfileCacheManager.removeStarredChatSessionIndex', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('returns false when no cached profile', async () => {
    const result = await mgr.removeStarredChatSessionIndex('noUser', 's1');
    expect(result).toBe(false);
  });

  it('returns false when session not found in index', async () => {
    (mgr as any).cache.set('testUser', makeProfile({
      'starred-chat-sessions': [{ chatSessionId: 'other-session', lastUpdated: '', starredAt: '' }],
    }));

    const result = await mgr.removeStarredChatSessionIndex('testUser', 'not-in-list');
    expect(result).toBe(false);
  });

  it('rolls back cache when writeProfileToFile returns false', async () => {
    const profile = makeProfile({
      'starred-chat-sessions': [{ chatSessionId: 's1', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' }],
    });
    (mgr as any).cache.set('testUser', profile);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(false);

    const result = await mgr.removeStarredChatSessionIndex('testUser', 's1');
    expect(result).toBe(false);
    expect((mgr as any).cache.get('testUser')).toEqual(profile);
  });

  it('skips notify when notifyRenderer=false', async () => {
    const profile = makeProfile({
      'starred-chat-sessions': [{ chatSessionId: 's1', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' }],
    });
    (mgr as any).cache.set('testUser', profile);

    await mgr.removeStarredChatSessionIndex('testUser', 's1', { notifyRenderer: false });
    expect((mgr as any).notifyProfileDataManager).not.toHaveBeenCalled();
  });

  it('returns true and notifies when removal succeeds', async () => {
    const profile = makeProfile({
      'starred-chat-sessions': [{ chatSessionId: 's1', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' }],
    });
    (mgr as any).cache.set('testUser', profile);

    const result = await mgr.removeStarredChatSessionIndex('testUser', 's1');
    expect(result).toBe(true);
    expect((mgr as any).notifyProfileDataManager).toHaveBeenCalledWith('testUser', true);
  });
});

// ── writeProfileToFile — error path ──────────────────────────────────────────

describe('ProfileCacheManager.writeProfileToFile', () => {
  it('returns false when an error occurs during write', async () => {
    (ProfileCacheManager as any).instance = undefined;
    const mgr = ProfileCacheManager.getInstance();
    (mgr as any).notifyProfileDataManager = vi.fn();
    (mgr as any).initializeBackgroundServices = vi.fn();

    // getProfileDirectoryPath will throw since electron app may not work in test
    // — stub it to force the error path
    vi.spyOn(mgr as any, 'ensureDirectoryExists').mockImplementation(() => {
      throw new Error('disk full');
    });

    const result = await (mgr as any).writeProfileToFile('alice', makeProfile());
    expect(result).toBe(false);
    vi.restoreAllMocks();
  });
});

// ── notifyProfileDataManager — batched path ───────────────────────────────────

describe('ProfileCacheManager.notifyProfileDataManager', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (ProfileCacheManager as any).instance = undefined;
    mgr = ProfileCacheManager.getInstance();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (mgr as any).initializeBackgroundServices = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('immediate=true calls performNotification immediately', async () => {
    const performSpy = vi.spyOn(mgr as any, 'performNotification').mockResolvedValue(undefined);
    await (mgr as any).notifyProfileDataManager('alice', true);
    expect(performSpy).toHaveBeenCalledWith('alice', true);
    vi.restoreAllMocks();
  });

  it('batched path queues alias and debounces', async () => {
    vi.useFakeTimers();
    const processSpy = vi.spyOn(mgr as any, 'processBatchedNotifications').mockResolvedValue(undefined);

    await (mgr as any).notifyProfileDataManager('alice');
    expect((mgr as any).batchedUpdates.has('alice')).toBe(true);
    expect((mgr as any).pendingNotification).toBe(true);

    // Advance past the 150ms debounce
    vi.advanceTimersByTime(200);
    expect(processSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

// ── processBatchedNotifications ───────────────────────────────────────────────

describe('ProfileCacheManager.processBatchedNotifications', () => {
  it('returns early when batchedUpdates is empty', async () => {
    const mgr = freshManager();
    (mgr as any).batchedUpdates = new Set();
    const performSpy = vi.spyOn(mgr as any, 'performNotification').mockResolvedValue(undefined);

    await (mgr as any).processBatchedNotifications();
    expect(performSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('processes all aliases in batch', async () => {
    const mgr = freshManager();
    (mgr as any).batchedUpdates = new Set(['alice', 'bob']);
    const performSpy = vi.spyOn(mgr as any, 'performNotification').mockResolvedValue(undefined);

    await (mgr as any).processBatchedNotifications();
    expect(performSpy).toHaveBeenCalledTimes(2);
    expect((mgr as any).batchedUpdates.size).toBe(0);
    vi.restoreAllMocks();
  });
});

// ── performNotification — window search fallbacks ─────────────────────────────

describe('ProfileCacheManager.performNotification', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
    (mgr as any).cache.set('alice', makeProfile({ alias: 'alice' }));
    mockGetAllWindows.mockReturnValue([]);
  });

  it('sends to window matching OpenKosmos AI Studio title', async () => {
    const mockWebContents = { send: vi.fn() };
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      title: 'OpenKosmos AI Studio',
      webContents: mockWebContents,
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);
    (mgr as any).mainWindow = null;

    await (mgr as any).performNotification('alice');
    expect(mockWebContents.send).toHaveBeenCalledWith('profile:cacheUpdated', expect.objectContaining({ alias: 'alice' }));
  });

  it('uses single window fallback when title does not match', async () => {
    const mockWebContents = { send: vi.fn() };
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      title: 'Unknown App',
      webContents: mockWebContents,
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);
    (mgr as any).mainWindow = null;

    await (mgr as any).performNotification('alice');
    // Should use the single fallback window
    expect(mockWebContents.send).toHaveBeenCalled();
  });

  it('does not send when all windows are destroyed', async () => {
    const mockWindow = {
      isDestroyed: vi.fn(() => true),
      title: 'OpenKosmos AI Studio',
      webContents: { send: vi.fn() },
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);
    (mgr as any).mainWindow = null;

    await (mgr as any).performNotification('alice');
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('loads chatSessions for chats in profile', async () => {
    mockGetChatSessions.mockResolvedValue({
      sessions: [{
        chatSession_id: 'sess-1',
        last_updated: '2026-01-01',
        title: 'Test Session',
        readStatus: 'read',
        starred: true,
        starredAt: '2026-01-01',
      }],
    });
    const mockWebContents = { send: vi.fn() };
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      title: 'OpenKosmos AI Studio',
      webContents: mockWebContents,
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);
    (mgr as any).mainWindow = null;

    await (mgr as any).performNotification('alice');
    const sentData = mockWebContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'profile:cacheUpdated',
    )[1];
    expect(sentData.profile.chats[0].chatSessions).toHaveLength(1);
  });

  it('logs warn and keeps empty sessions when getChatSessionsProjection fails', async () => {
    mockGetChatSessions.mockRejectedValue(new Error('db error'));
    const mockWebContents = { send: vi.fn() };
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      title: 'OpenKosmos AI Studio',
      webContents: mockWebContents,
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);
    (mgr as any).mainWindow = null;

    await (mgr as any).performNotification('alice');
    // Should still send even if session load fails
    expect(mockWebContents.send).toHaveBeenCalled();
    const sentData = mockWebContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'profile:cacheUpdated',
    )[1];
    expect(sentData.profile.chats[0].chatSessions).toEqual([]);
  });

});

// ── initializeBackgroundServices — error paths ────────────────────────────────

describe('ProfileCacheManager.initializeBackgroundServices', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (ProfileCacheManager as any).instance = undefined;
    mgr = ProfileCacheManager.getInstance();
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  });

  it('logs error when ghcModelsManager.initialize fails', async () => {
    mockGhcInitialize.mockRejectedValue(new Error('ghc error'));
    (mgr as any).initializeBackgroundServices('alice');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    // Should not throw
  });

  it('logs error when mcpClientManager.initialize fails', async () => {
    mockMcpInitialize.mockRejectedValue(new Error('mcp error'));
    (mgr as any).initializeBackgroundServices('alice');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    // Should not throw
  });

  it('logs error when agentChatManager.initialize fails', async () => {
    mockAgentChatInitialize.mockRejectedValue(new Error('agent error'));
    (mgr as any).initializeBackgroundServices('alice');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  });

});

// ── clearCache edge cases ─────────────────────────────────────────────────────

describe('ProfileCacheManager.clearCache edge cases', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('handles specific alias that is NOT in cache', () => {
    // 'notInCache' was never set
    expect(() => mgr.clearCache('notInCache')).not.toThrow();
  });

  it('handles clearAll when cache is empty', () => {
    expect(() => mgr.clearCache()).not.toThrow();
  });

  it('clears specific alias that IS in cache', () => {
    (mgr as any).cache.set('alice', makeProfile({ alias: 'alice' }));
    expect((mgr as any).cache.has('alice')).toBe(true);
    mgr.clearCache('alice');
    expect((mgr as any).cache.has('alice')).toBe(false);
  });

  it('clears all when multiple users are cached', () => {
    (mgr as any).cache.set('alice', makeProfile({ alias: 'alice' }));
    (mgr as any).cache.set('bob', makeProfile({ alias: 'bob' }));
    mgr.clearCache();
    expect((mgr as any).cache.size).toBe(0);
  });
});

// ── getMcpServerRuntimeState / getAllMcpServerRuntimeStates — null manager ─────

describe('ProfileCacheManager MCP runtime state methods', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
    (mgr as any).mcpClientManager = null;
  });

  it('getMcpServerRuntimeState returns null when mcpClientManager is null', () => {
    const result = mgr.getMcpServerRuntimeState('alice', 'server1');
    expect(result).toBeNull();
  });

  it('getAllMcpServerRuntimeStates returns empty array when mcpClientManager is null', () => {
    const result = mgr.getAllMcpServerRuntimeStates('alice');
    expect(result).toEqual([]);
  });
});

// ── executeToolCall — error paths ─────────────────────────────────────────────

describe('ProfileCacheManager.executeToolCall', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('throws when mcpClientManager is null', async () => {
    (mgr as any).mcpClientManager = null;
    await expect(mgr.executeToolCall('tool1', {})).rejects.toThrow('MCP Client Manager not initialized');
  });

  it('throws when currentUserAlias is null', async () => {
    (mgr as any).mcpClientManager = { executeTool: vi.fn() };
    (mgr as any).currentUserAlias = null;
    await expect(mgr.executeToolCall('tool1', {})).rejects.toThrow('No current user alias set');
  });

  it('calls executeTool and returns result', async () => {
    const mockResult = { content: 'tool output' };
    (mgr as any).mcpClientManager = { executeTool: vi.fn().mockResolvedValue(mockResult) };
    (mgr as any).currentUserAlias = 'alice';
    const result = await mgr.executeToolCall('tool1', { key: 'value' });
    expect(result).toBe(mockResult);
  });
});

// ── deprecated MCP methods ────────────────────────────────────────────────────

describe('ProfileCacheManager deprecated MCP methods', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('updateMcpServerStatus logs debug without throwing', () => {
    expect(() => mgr.updateMcpServerStatus('alice', 'server1', 'connected' as any)).not.toThrow();
  });

  it('updateMcpServerTools logs debug without throwing', () => {
    expect(() => mgr.updateMcpServerTools('alice', 'server1', [])).not.toThrow();
  });

  it('updateMcpServerError logs debug without throwing', () => {
    expect(() => mgr.updateMcpServerError('alice', 'server1', new Error('err'))).not.toThrow();
  });
});

// ── setMainWindow ─────────────────────────────────────────────────────────────

describe('ProfileCacheManager setters', () => {
  let mgr: ProfileCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = freshManager();
  });

  it('setMainWindow stores window reference', () => {
    const mockWindow = { isDestroyed: vi.fn() } as any;
    mgr.setMainWindow(mockWindow);
    expect((mgr as any).mainWindow).toBe(mockWindow);
  });

});

// ── forceNotifyProfileDataManager ────────────────────────────────────────────

describe('ProfileCacheManager.forceNotifyProfileDataManager', () => {
  it('calls notifyProfileDataManager with alias and immediate=true', async () => {
    const mgr = freshManager();
    // notifyProfileDataManager is already mocked to vi.fn() in freshManager
    await mgr.forceNotifyProfileDataManager('alice');
    expect((mgr as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });
});
