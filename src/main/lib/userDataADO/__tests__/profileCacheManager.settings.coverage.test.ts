/**
 * profileCacheManager.settings.coverage.test.ts
 *
 * Covers the settings CRUD delegation methods (lines 1344-1435) that were
 * updatePrimaryChat, updateFreDone, getFreDone, getDevToolsMcpSettings,
 * updateDevToolsMcpSettings,
 * getSyncSettings, updateSyncSettings, archiveChatConfig, unarchiveChatConfig,
 * getArchivedAgents, saveChatSession, deleteChatSession, getChatSessions,
 * getChatSessionsAsync, getChatSessionFile.
 */

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


// Mock the delegated CRUD modules
vi.mock('../profileSettingsCrud', async () => ({
  getConfirmationSettings: vi.fn(() => ({})),
  updateConfirmationSettings: vi.fn().mockResolvedValue(true),
  getVoiceInputSettings: vi.fn(() => ({})),
  updateVoiceInputSettings: vi.fn().mockResolvedValue(true),
  updatePrimaryChat: vi.fn().mockResolvedValue(true),
  updateFreDone: vi.fn().mockResolvedValue(true),
  getFreDone: vi.fn(() => false),
  getDevToolsMcpSettings: vi.fn(() => ({})),
  updateDevToolsMcpSettings: vi.fn().mockResolvedValue(true),
  getSyncSettings: vi.fn(() => ({})),
  updateSyncSettings: vi.fn().mockResolvedValue(true),
  getCodingAgentSettings: vi.fn(() => ({ cli: 'claude' })),
  updateCodingAgentSettings: vi.fn().mockResolvedValue(true),
}));

vi.mock('../profileArchiveManager', async () => ({
  archiveChatConfig: vi.fn().mockResolvedValue(true),
  unarchiveChatConfig: vi.fn().mockResolvedValue({ success: true }),
  getArchivedAgents: vi.fn(() => []),
}));

vi.mock('../profileChatSessionOps', async () => ({
  saveChatSession: vi.fn().mockResolvedValue(true),
  deleteChatSession: vi.fn().mockResolvedValue(true),
  getChatSessions: vi.fn(() => []),
  getChatSessionsAsync: vi.fn().mockResolvedValue([]),
  getChatSessionFile: vi.fn().mockResolvedValue(null),
}));

import { ProfileCacheManager } from '../profileCacheManager';

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  const mgr = ProfileCacheManager.getInstance();
  (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  return mgr;
}

describe('ProfileCacheManager — settings CRUD delegation', () => {
  it('updatePrimaryChat delegates to settingsCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updatePrimaryChat('alice', 'chat_x');
    expect(result).toBe(true);
  });

  it('updateFreDone delegates to settingsCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updateFreDone('alice', true);
    expect(result).toBe(true);
  });

  it('getFreDone delegates to settingsCrud', () => {
    const mgr = freshManager();
    const result = mgr.getFreDone('alice');
    expect(typeof result).toBe('boolean');
  });

  it('getCodingAgentSettings delegates to settingsCrud', () => {
    const mgr = freshManager();
    const result = mgr.getCodingAgentSettings('alice');
    expect(result).toEqual({ cli: 'claude' });
  });

  it('updateCodingAgentSettings delegates to settingsCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updateCodingAgentSettings('alice', { cli: 'codex' });
    expect(result).toBe(true);
  });

  it('getDevToolsMcpSettings delegates to settingsCrud', () => {
    const mgr = freshManager();
    const result = mgr.getDevToolsMcpSettings('alice');
    expect(result).toBeDefined();
  });

  it('updateDevToolsMcpSettings delegates to settingsCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updateDevToolsMcpSettings('alice', {} as any);
    expect(result).toBe(true);
  });

  it('getSyncSettings delegates to settingsCrud', () => {
    const mgr = freshManager();
    const result = mgr.getSyncSettings('alice');
    expect(result).toBeDefined();
  });

  it('updateSyncSettings delegates to settingsCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updateSyncSettings('alice', {} as any);
    expect(result).toBe(true);
  });
});

describe('ProfileCacheManager — archive operations delegation', () => {
  it('archiveChatConfig delegates to archiveOps', async () => {
    const mgr = freshManager();
    const result = await mgr.archiveChatConfig('alice', 'chat-1');
    expect(result).toBe(true);
  });

  it('unarchiveChatConfig delegates to archiveOps', async () => {
    const mgr = freshManager();
    const result = await mgr.unarchiveChatConfig('alice', 'chat-1');
    expect(result).toEqual({ success: true });
  });

  it('getArchivedAgents delegates to archiveOps', () => {
    const mgr = freshManager();
    const result = mgr.getArchivedAgents('alice');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('ProfileCacheManager — chatSession operations delegation', () => {
  it('saveChatSession delegates to chatSessionOps', async () => {
    const mgr = freshManager();
    const result = await mgr.saveChatSession('alice', 'chat-1', {} as any);
    expect(result).toBe(true);
  });

  it('deleteChatSession delegates to chatSessionOps', async () => {
    const mgr = freshManager();
    const result = await mgr.deleteChatSession('alice', 'chat-1', 'session-1');
    expect(result).toBe(true);
  });

  it('getChatSessions (deprecated) delegates to chatSessionOps', () => {
    const mgr = freshManager();
    const result = mgr.getChatSessions('alice', 'chat-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('getChatSessionsAsync delegates to chatSessionOps', async () => {
    const mgr = freshManager();
    const result = await mgr.getChatSessionsAsync('alice', 'chat-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('getChatSessionFile delegates to chatSessionOps', async () => {
    const mgr = freshManager();
    const result = await mgr.getChatSessionFile('alice', 'chat-1', 'session-1');
    expect(result).toBeNull();
  });
});

describe('ProfileCacheManager — getCachedAliases', () => {
  it('returns all cached aliases', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', {});
    (mgr as any).cache.set('bob', {});
    const aliases = mgr.getCachedAliases();
    expect(aliases).toContain('alice');
    expect(aliases).toContain('bob');
  });
});
