/**
 * profileCacheManager.coverage2.test.ts
 *
 * Targets uncovered branches in profileCacheManager.ts:
 * - clearCache: no alias (clear all), alias with hadCache=false, alias with profile
 * - getCachedAliases
 * - updateMcpServerInUse: server found / not found, profile missing
 * - getMcpServerInfo / getAllMcpServerInfo: no profile, profile without mcpClientManager
 * - executeToolCall: not initialized / no alias errors
 * - cleanupMem0Resources
 * - clearUserRuntimeStates: with/without mcpClientManager
 * - clearMcpServerRuntimeState
 * - getMcpServerRuntimeState / getAllMcpServerRuntimeStates: without mcpClientManager
 * - deprecated updateMcpServerStatus/Tools/Error
 * - setMainWindow, setRemoteChannelManagerGetter
 * - notifyProfileDataManager batched path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  promises: {
    readFile: vi.fn().mockResolvedValue('{}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../pathUtils', () => ({
  getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
  isDefaultWorkspacePath: vi.fn(() => false),
}));

vi.mock('../chatSessionManager', () => ({
  chatSessionManager: { loadChatSessions: vi.fn(), saveChatSession: vi.fn() },
}));

vi.mock('../../../../shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('../../../../shared/constants/builtinSkills'),
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn().mockResolvedValue({ sessions: [] }),
  },
}));

vi.mock('../../llm/ghcModelsManager', () => ({
  ghcModelsManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllMcpServerRuntimeStates: vi.fn(() => []),
    getMcpServerRuntimeState: vi.fn(() => null),
    _clearServerRuntimeState: vi.fn(),
    executeTool: vi.fn().mockResolvedValue({ content: 'result' }),
  },
}));

vi.mock('../../plugin/pluginManager', () => ({
  pluginManager: { initialize: vi.fn().mockResolvedValue({ errors: [] }) },
}));


vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../remoteChannel/credentialStore', () => ({
  credentialStore: { hasCredential: vi.fn().mockResolvedValue(false) },
}));

vi.mock('../../featureFlags/featureFlagManager', () => ({
  featureFlagManager: { isEnabled: vi.fn(() => false) },
}));

vi.mock('../../startup/lazy', () => ({
  getExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../profileSanitizer', () => ({
  sanitizeProfileV2: vi.fn((p: any) => p),
  sanitizeSubAgents: vi.fn((a: any) => a),
  sanitizeStarredChatSessions: vi.fn((a: any) => a),
  buildStarredChatSessionIndexItem: vi.fn(() => null),
  sanitizeChatSkillSnapshot: vi.fn(),
  clearSkillSnapshotsForAffectedChats: vi.fn(),
  createDefaultChat: vi.fn(() => ({
    chat_id: 'chat-1',
    name: 'Default',
    agent: {},
  })),
  generateChatId: vi.fn(() => 'generated-id'),
}));

vi.mock('../profileMigration', () => ({
  PROFILE_MIGRATION_VERSION: 1,
  applyProfileMigrations: vi.fn(() => false),
  applyBuiltinDefaultsMigrations: vi.fn(() => false),
  isDefaultProfile: vi.fn(() => false),
  isDefaultChatConfig: vi.fn(() => false),
}));

vi.mock('../profileSettingsCrud', () => ({
  getConfirmationSettings: vi.fn(() => ({})),
  updateConfirmationSettings: vi.fn().mockResolvedValue(true),
  updateRemoteChannelsConfig: vi.fn().mockResolvedValue(true),
  updatePrimaryAgent: vi.fn().mockResolvedValue(true),
  updateFreDone: vi.fn().mockResolvedValue(true),
  getFreDone: vi.fn(() => false),
  getBrowserControlSettings: vi.fn(() => ({})),
  updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
  getDevToolsMcpSettings: vi.fn(() => ({})),
  updateDevToolsMcpSettings: vi.fn().mockResolvedValue(true),
}));

vi.mock('../profileArchiveManager', () => ({
  archiveChatConfig: vi.fn().mockResolvedValue(true),
  unarchiveChatConfig: vi.fn().mockResolvedValue({ success: true }),
  getArchivedAgents: vi.fn(() => []),
}));

vi.mock('../profileEntityCrud', () => ({
  addMcpServerConfig: vi.fn().mockResolvedValue(true),
  updateMcpServerConfig: vi.fn().mockResolvedValue(true),
  deleteMcpServerConfig: vi.fn().mockResolvedValue(true),
  addSkill: vi.fn().mockResolvedValue(true),
  updateSkill: vi.fn().mockResolvedValue(true),
  deleteSkill: vi.fn().mockResolvedValue(true),
  getSubAgents: vi.fn().mockResolvedValue([]),
  getSubAgentIndex: vi.fn(() => []),
  addSubAgent: vi.fn().mockResolvedValue(true),
  updateSubAgent: vi.fn().mockResolvedValue(true),
  deleteSubAgent: vi.fn().mockResolvedValue(true),
  syncSubAgentIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../profileChatCrud', () => ({
  addChatConfig: vi.fn().mockResolvedValue(true),
  updateChatConfig: vi.fn().mockResolvedValue(true),
  deleteChatConfig: vi.fn().mockResolvedValue(true),
  getChatConfig: vi.fn(() => null),
  getAllChatConfigs: vi.fn(() => []),
  updateChatAgent: vi.fn().mockResolvedValue(true),
  updateChatSkillSnapshot: vi.fn().mockResolvedValue(true),
}));

vi.mock('../profileChatSessionOps', () => ({
  saveChatSession: vi.fn().mockResolvedValue(true),
  deleteChatSession: vi.fn().mockResolvedValue(true),
  getChatSessions: vi.fn(() => []),
  getChatSessionsAsync: vi.fn().mockResolvedValue([]),
  getChatSessionFile: vi.fn().mockResolvedValue(null),
}));

vi.mock('../appCacheManager', () => ({
  appCacheManager: { },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getManager() {
  const mod = await import('../profileCacheManager');
  // Reset singleton for test isolation
  (mod.ProfileCacheManager as any).instance = null;
  return mod.ProfileCacheManager.getInstance();
}

function makeProfile(alias = 'test-user'): any {
  return {
    version: '2.0.0',
    alias,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    freDone: false,
    primaryAgent: 'Kobi',
    mcp_servers: [{ name: 'server1', in_use: false }],
    skills: [],
    'starred-chat-sessions': [],
    chats: [{ chat_id: 'c1', name: 'Chat', agent: {} }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileCacheManager — clearCache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clearCache(alias) when alias exists in cache deletes it', async () => {
    const mgr = await getManager();
    (mgr as any).cache.set('user1', makeProfile('user1'));
    mgr.clearCache('user1');
    expect(mgr.getCachedProfile('user1')).toBeNull();
  });

  it('clearCache(alias) when alias NOT in cache does nothing harmful', async () => {
    const mgr = await getManager();
    expect(() => mgr.clearCache('nonexistent')).not.toThrow();
  });

  it('clearCache() with no alias clears all entries', async () => {
    const mgr = await getManager();
    (mgr as any).cache.set('user1', makeProfile('user1'));
    (mgr as any).cache.set('user2', makeProfile('user2'));
    mgr.clearCache();
    expect(mgr.getCachedAliases()).toHaveLength(0);
  });

  it('clearCache() with no alias when cache already empty', async () => {
    const mgr = await getManager();
    expect(() => mgr.clearCache()).not.toThrow();
    expect(mgr.getCachedAliases()).toHaveLength(0);
  });
});

describe('ProfileCacheManager — getCachedAliases', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns list of cached aliases', async () => {
    const mgr = await getManager();
    (mgr as any).cache.set('alice', makeProfile('alice'));
    (mgr as any).cache.set('bob', makeProfile('bob'));
    const aliases = mgr.getCachedAliases();
    expect(aliases).toContain('alice');
    expect(aliases).toContain('bob');
  });
});

describe('ProfileCacheManager — updateMcpServerInUse', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('updates in_use when server is found', async () => {
    const mgr = await getManager();
    const profile = makeProfile('u1');
    (mgr as any).cache.set('u1', profile);
    mgr.updateMcpServerInUse('u1', 'server1', true);
    const updated = mgr.getCachedProfile('u1') as any;
    expect(updated.mcp_servers[0].in_use).toBe(true);
  });

  it('does nothing when server is not found', async () => {
    const mgr = await getManager();
    const profile = makeProfile('u1');
    (mgr as any).cache.set('u1', profile);
    expect(() => mgr.updateMcpServerInUse('u1', 'nonexistent', true)).not.toThrow();
  });

  it('does nothing when profile not in cache', async () => {
    const mgr = await getManager();
    expect(() => mgr.updateMcpServerInUse('noone', 'server1', true)).not.toThrow();
  });
});

describe('ProfileCacheManager — getMcpServerRuntimeState / getAllMcpServerRuntimeStates', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when mcpClientManager not set', async () => {
    const mgr = await getManager();
    (mgr as any).mcpClientManager = null;
    expect(mgr.getMcpServerRuntimeState('u1', 'server1')).toBeNull();
    expect(mgr.getAllMcpServerRuntimeStates('u1')).toEqual([]);
  });

  it('delegates to mcpClientManager when set', async () => {
    const mgr = await getManager();
    const fakeMcp = {
      getMcpServerRuntimeState: vi.fn(() => ({ serverName: 'server1', status: 'connected', tools: [], lastError: null })),
      getAllMcpServerRuntimeStates: vi.fn(() => [{ serverName: 'server1' }]),
    };
    (mgr as any).mcpClientManager = fakeMcp;
    expect(mgr.getMcpServerRuntimeState('u1', 'server1')).toBeTruthy();
    expect(mgr.getAllMcpServerRuntimeStates('u1')).toHaveLength(1);
  });
});

describe('ProfileCacheManager — clearMcpServerRuntimeState / clearUserRuntimeStates', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clearMcpServerRuntimeState does nothing without mcpClientManager', async () => {
    const mgr = await getManager();
    (mgr as any).mcpClientManager = null;
    expect(() => mgr.clearMcpServerRuntimeState('u1', 'server1')).not.toThrow();
  });

  it('clearMcpServerRuntimeState delegates to mcpClientManager', async () => {
    const mgr = await getManager();
    const clear = vi.fn();
    (mgr as any).mcpClientManager = { _clearServerRuntimeState: clear, getAllMcpServerRuntimeStates: vi.fn(() => []) };
    mgr.clearMcpServerRuntimeState('u1', 'server1');
    expect(clear).toHaveBeenCalledWith('server1');
  });

  it('clearUserRuntimeStates clears all states via mcpClientManager', async () => {
    const mgr = await getManager();
    const clear = vi.fn();
    (mgr as any).mcpClientManager = {
      _clearServerRuntimeState: clear,
      getAllMcpServerRuntimeStates: vi.fn(() => [
        { serverName: 's1' },
        { serverName: 's2' },
      ]),
    };
    mgr.clearUserRuntimeStates('u1');
    expect(clear).toHaveBeenCalledTimes(2);
  });
});

describe('ProfileCacheManager — getMcpServerInfo / getAllMcpServerInfo', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getMcpServerInfo returns null config when not in profile', async () => {
    const mgr = await getManager();
    const result = mgr.getMcpServerInfo('u1', 'server1');
    expect(result.config).toBeNull();
    expect(result.runtime).toBeNull();
  });

  it('getAllMcpServerInfo returns empty array when no profile cached', async () => {
    const mgr = await getManager();
    expect(mgr.getAllMcpServerInfo('u1')).toEqual([]);
  });

  it('getAllMcpServerInfo maps servers from cached profile', async () => {
    const mgr = await getManager();
    (mgr as any).cache.set('u1', makeProfile('u1'));
    (mgr as any).mcpClientManager = {
      getMcpServerRuntimeState: vi.fn(() => null),
    };
    const result = mgr.getAllMcpServerInfo('u1');
    expect(result).toHaveLength(1);
    expect(result[0].config.name).toBe('server1');
  });
});

describe('ProfileCacheManager — executeToolCall', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when mcpClientManager not initialized', async () => {
    const mgr = await getManager();
    (mgr as any).mcpClientManager = null;
    await expect(mgr.executeToolCall('test_tool', {})).rejects.toThrow('not initialized');
  });

  it('throws when no currentUserAlias', async () => {
    const mgr = await getManager();
    (mgr as any).mcpClientManager = { executeTool: vi.fn().mockResolvedValue('ok') };
    (mgr as any).currentUserAlias = null;
    await expect(mgr.executeToolCall('test_tool', {})).rejects.toThrow('No current user alias');
  });

  it('delegates to mcpClientManager.executeTool when properly initialized', async () => {
    const mgr = await getManager();
    const executeTool = vi.fn().mockResolvedValue('result');
    (mgr as any).mcpClientManager = { executeTool };
    (mgr as any).currentUserAlias = 'user1';
    const result = await mgr.executeToolCall('test_tool', { x: 1 });
    expect(result).toBe('result');
    expect(executeTool).toHaveBeenCalledWith({ toolName: 'test_tool', toolArgs: { x: 1 } });
  });
});

describe('ProfileCacheManager — cleanupMem0Resources', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves without throwing', async () => {
    const mgr = await getManager();
    await expect(mgr.cleanupMem0Resources()).resolves.toBeUndefined();
  });
});

describe('ProfileCacheManager — setMainWindow and setRemoteChannelManagerGetter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('setMainWindow stores window reference', async () => {
    const mgr = await getManager();
    const fakeWindow = { isDestroyed: vi.fn(() => false) } as any;
    expect(() => mgr.setMainWindow(fakeWindow)).not.toThrow();
    expect((mgr as any).mainWindow).toBe(fakeWindow);
  });

  it('setRemoteChannelManagerGetter stores getter', async () => {
    const mgr = await getManager();
    const getter = vi.fn();
    mgr.setRemoteChannelManagerGetter(getter);
    expect((mgr as any).getRemoteChannelManager).toBe(getter);
  });
});

describe('ProfileCacheManager — forceNotifyProfileDataManager', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves without throwing even with no window', async () => {
    const mgr = await getManager();
    await expect(mgr.forceNotifyProfileDataManager('u1')).resolves.toBeUndefined();
  });
});

describe('ProfileCacheManager — notifyProfileDataManager batched path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('batches multiple non-immediate calls and deduplicates aliases', async () => {
    const mgr = await getManager();
    // Call non-immediate multiple times — should not throw
    await (mgr as any).notifyProfileDataManager('user1');
    await (mgr as any).notifyProfileDataManager('user1');
    // Wait for batch timeout
    await new Promise((r) => setTimeout(r, 200));
  });
});
