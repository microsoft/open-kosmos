// @ts-nocheck
/**
 * profileCacheManager.coverage4.test.ts
 *
 * Targets remaining uncovered lines/branches/functions:
 * - entityCrud delegate wrappers: addMcpServerConfig, updateMcpServerConfig,
 * - chatCrudCtx + delegate wrappers: addChatConfig, updateChatConfig,
 *   deleteChatConfig, getChatConfig, getAllChatConfigs, updateChatAgent, getCachedProfile,
 *   forceNotifyProfileDataManager
 * - settingsCtx (line 1263) + all settings delegates not previously forced through the ctx builder
 * - archiveCtx (lines 1333-1342) + delegate wrappers
 * - chatSessionCtx (lines 1361-1370) + saveChatSession, deleteChatSession,
 *   getChatSessions, getChatSessionsAsync, getChatSessionFile
 * - syncStarredChatSessionIndex sort path (line 295)
 * - removeStarredChatSessionIndex (lines 328-350)
 * - notifyProfileDataManager with immediate=true (forceNotify path)
 */

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const mockEntityCrud = vi.hoisted(() => ({
  withProfileWriteLock: vi.fn(async (_alias: string, operation: () => Promise<unknown>) => operation()),
  writeProfileThenCommitCache: vi.fn(async (
    ctx: any,
    alias: string,
    currentProfile: any,
    nextProfile: any,
    immediate = false,
    notify = true,
  ) => {
    const success = await ctx.writeProfileToFile(alias, nextProfile);
    if (!success) return false;
    Object.assign(currentProfile, nextProfile);
    ctx.cache.set(alias, currentProfile);
    if (notify) await ctx.notifyProfileDataManager(alias, immediate);
    return true;
  }),
  addMcpServerConfig: vi.fn().mockResolvedValue(true),
  updateMcpServerConfig: vi.fn().mockResolvedValue(true),
  deleteMcpServerConfig: vi.fn().mockResolvedValue(true),
  addSkillConfig: vi.fn().mockResolvedValue(true),
  updateSkillConfig: vi.fn().mockResolvedValue(true),
  deleteSkillConfig: vi.fn().mockResolvedValue(true),
}));

const mockSkillsConfigManager = vi.hoisted(() => ({
  loadForAlias: vi.fn().mockResolvedValue({ skills: [], needsProfileRewrite: false }),
  getSkills: vi.fn().mockReturnValue([]),
  getSkill: vi.fn().mockReturnValue(undefined),
  hasSkill: vi.fn().mockReturnValue(false),
  clearForAlias: vi.fn(),
  clearAll: vi.fn(),
}));

const mockChatCrud = vi.hoisted(() => ({
  addChatConfig: vi.fn().mockResolvedValue(true),
  updateChatConfig: vi.fn().mockResolvedValue(true),
  deleteChatConfig: vi.fn().mockResolvedValue(true),
  getChatConfig: vi.fn().mockReturnValue(null),
  getAllChatConfigs: vi.fn().mockReturnValue([]),
  updateChatAgent: vi.fn().mockResolvedValue(true),
}));

const mockSettingsCrud = vi.hoisted(() => ({
  getToolBarSettings: vi.fn().mockReturnValue({}),
  getConfirmationSettings: vi.fn().mockReturnValue({}),
  updateToolBarSettings: vi.fn().mockResolvedValue(true),
  updateConfirmationSettings: vi.fn().mockResolvedValue(true),
  getVoiceInputSettings: vi.fn().mockReturnValue({}),
  updateVoiceInputSettings: vi.fn().mockResolvedValue(true),
  getTtsSettings: vi.fn().mockReturnValue({}),
  updateTtsSettings: vi.fn().mockResolvedValue(true),
  updatePrimaryChat: vi.fn().mockResolvedValue(true),
  updateFreDone: vi.fn().mockResolvedValue(true),
  getFreDone: vi.fn().mockReturnValue(false),
  getDevToolsMcpSettings: vi.fn().mockReturnValue({}),
  updateDevToolsMcpSettings: vi.fn().mockResolvedValue(true),
  getSyncSettings: vi.fn().mockReturnValue({}),
  updateSyncSettings: vi.fn().mockResolvedValue(true),
}));

const mockArchiveOps = vi.hoisted(() => ({
  archiveChatConfig: vi.fn().mockResolvedValue(true),
  unarchiveChatConfig: vi.fn().mockResolvedValue({ success: true }),
  getArchivedAgents: vi.fn().mockReturnValue([]),
}));

const mockChatSessionOps = vi.hoisted(() => ({
  saveChatSession: vi.fn().mockResolvedValue(true),
  deleteChatSession: vi.fn().mockResolvedValue(true),
  getChatSessions: vi.fn().mockReturnValue([]),
  getChatSessionsAsync: vi.fn().mockResolvedValue([]),
  getChatSessionFile: vi.fn().mockResolvedValue(null),
}));

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', async () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => '/mock/userData') },
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


vi.mock('../profileSanitizer', async () => {
  const actual = await vi.importActual('../profileSanitizer');
  return actual;
});

vi.mock('../profileMigration', async () => {
  const actual = await vi.importActual('../profileMigration');
  return actual;
});

vi.mock('../profileEntityCrud', async () => mockEntityCrud);
vi.mock('../skillsConfigManager', async () => ({ skillsConfigManager: mockSkillsConfigManager }));
vi.mock('../profileChatCrud', async () => mockChatCrud);
vi.mock('../profileSettingsCrud', async () => mockSettingsCrud);
vi.mock('../profileArchiveManager', async () => mockArchiveOps);
vi.mock('../profileChatSessionOps', async () => mockChatSessionOps);

// ── imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { ProfileCacheManager } from '../profileCacheManager';
import type { ProfileV2 } from '../types/profile';

// ── helpers ───────────────────────────────────────────────────────────────────

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  const mgr = ProfileCacheManager.getInstance();
  (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  return mgr;
}

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    alias: 'alice',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    'starred-chat-sessions': [],
    chats: [{
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
    }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mcpManagerStore.servers.clear();
});

// ── entityCrud delegates ──────────────────────────────────────────────────────

describe('ProfileCacheManager — entityCrud delegates', () => {
  it('addMcpServerConfig delegates to entityCrud', async () => {
    const mgr = freshManager();
    const config = { name: 'srv' } as any;
    const result = await mgr.addMcpServerConfig('alice', config);
    expect(mockEntityCrud.addMcpServerConfig).toHaveBeenCalledWith(expect.anything(), 'alice', config);
    expect(result).toBe(true);
  });

  it('updateMcpServerConfig delegates to entityCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.updateMcpServerConfig('alice', 'srv', { version: '2.0.0' });
    expect(mockEntityCrud.updateMcpServerConfig).toHaveBeenCalledWith(expect.anything(), 'alice', 'srv', { version: '2.0.0' });
    expect(result).toBe(true);
  });

  it('deleteMcpServerConfig delegates to entityCrud', async () => {
    const mgr = freshManager();
    const result = await mgr.deleteMcpServerConfig('alice', 'srv');
    expect(mockEntityCrud.deleteMcpServerConfig).toHaveBeenCalledWith(expect.anything(), 'alice', 'srv');
    expect(result).toBe(true);
  });

  it('addSkill delegates', async () => {
    const mgr = freshManager();
    const config = { name: 'sk', description: '', version: '1.0.0', source: 'ON-DEVICE' } as any;
    const result = await mgr.addSkill('alice', config);
    expect(mockEntityCrud.addSkillConfig).toHaveBeenCalledWith(expect.anything(), 'alice', config);
    expect(result).toBe(true);
  });

  it('updateSkill delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.updateSkill('alice', 'sk', { version: '2.0.0' });
    expect(mockEntityCrud.updateSkillConfig).toHaveBeenCalledWith(expect.anything(), 'alice', 'sk', { version: '2.0.0' });
    expect(result).toBe(true);
  });

  it('deleteSkill delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.deleteSkill('alice', 'sk');
    expect(mockEntityCrud.deleteSkillConfig).toHaveBeenCalledWith(expect.anything(), 'alice', 'sk');
    expect(result).toBe(true);
  });

});

// ── chatCrud delegates ────────────────────────────────────────────────────────

describe('ProfileCacheManager — chatCrud delegates', () => {
  it('addChatConfig delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.addChatConfig('alice', { chat_id: 'c1', chat_type: 'single_agent' });
    expect(mockChatCrud.addChatConfig).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('updateChatConfig delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.updateChatConfig('alice', 'c1', { chat_type: 'single_agent' });
    expect(mockChatCrud.updateChatConfig).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('deleteChatConfig delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.deleteChatConfig('alice', 'c1');
    expect(mockChatCrud.deleteChatConfig).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('getChatConfig delegates', () => {
    const mgr = freshManager();
    const result = mgr.getChatConfig('alice', 'c1');
    expect(mockChatCrud.getChatConfig).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('getAllChatConfigs delegates', () => {
    const mgr = freshManager();
    const result = mgr.getAllChatConfigs('alice');
    expect(mockChatCrud.getAllChatConfigs).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });

  it('updateChatAgent delegates', async () => {
    const mgr = freshManager();
    const result = await mgr.updateChatAgent('alice', 'c1', { name: 'NewAgent' } as any);
    expect(mockChatCrud.updateChatAgent).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('getCachedProfile returns null when not in cache', () => {
    const mgr = freshManager();
    const result = mgr.getCachedProfile('nonexistent');
    expect(result).toBeNull();
  });

  it('getCachedProfile returns profile when in cache', () => {
    const mgr = freshManager();
    const profile = makeProfile();
    (mgr as any).cache.set('alice', profile);
    const result = mgr.getCachedProfile('alice');
    expect(result).toBe(profile);
  });

  it('forceNotifyProfileDataManager calls notifyProfileDataManager with immediate=true', async () => {
    const mgr = freshManager();
    await mgr.forceNotifyProfileDataManager('alice');
    expect((mgr as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });
});

// ── settings delegates ────────────────────────────────────────────────────────

describe('ProfileCacheManager — settings delegates (via settingsCtx)', () => {
  it('getConfirmationSettings delegates', () => {
    const mgr = freshManager();
    mgr.getConfirmationSettings('alice');
    expect(mockSettingsCrud.getConfirmationSettings).toHaveBeenCalled();
  });

  it('updateConfirmationSettings delegates', async () => {
    const mgr = freshManager();
    await mgr.updateConfirmationSettings('alice', {} as any);
    expect(mockSettingsCrud.updateConfirmationSettings).toHaveBeenCalled();
  });

  it('getVoiceInputSettings delegates', () => {
    const mgr = freshManager();
    mgr.getVoiceInputSettings('alice');
    expect(mockSettingsCrud.getVoiceInputSettings).toHaveBeenCalled();
  });

  it('updateVoiceInputSettings delegates', async () => {
    const mgr = freshManager();
    await mgr.updateVoiceInputSettings('alice', {} as any);
    expect(mockSettingsCrud.updateVoiceInputSettings).toHaveBeenCalled();
  });

  it('updatePrimaryChat delegates', async () => {
    const mgr = freshManager();
    await mgr.updatePrimaryChat('alice', 'chat_x');
    expect(mockSettingsCrud.updatePrimaryChat).toHaveBeenCalled();
  });

  it('updateFreDone delegates', async () => {
    const mgr = freshManager();
    await mgr.updateFreDone('alice', true);
    expect(mockSettingsCrud.updateFreDone).toHaveBeenCalled();
  });

  it('getFreDone delegates', () => {
    const mgr = freshManager();
    mgr.getFreDone('alice');
    expect(mockSettingsCrud.getFreDone).toHaveBeenCalled();
  });

  it('getDevToolsMcpSettings delegates', () => {
    const mgr = freshManager();
    mgr.getDevToolsMcpSettings('alice');
    expect(mockSettingsCrud.getDevToolsMcpSettings).toHaveBeenCalled();
  });

  it('updateDevToolsMcpSettings delegates', async () => {
    const mgr = freshManager();
    await mgr.updateDevToolsMcpSettings('alice', {} as any);
    expect(mockSettingsCrud.updateDevToolsMcpSettings).toHaveBeenCalled();
  });

  it('getSyncSettings delegates', () => {
    const mgr = freshManager();
    mgr.getSyncSettings('alice');
    expect(mockSettingsCrud.getSyncSettings).toHaveBeenCalled();
  });

  it('updateSyncSettings delegates', async () => {
    const mgr = freshManager();
    await mgr.updateSyncSettings('alice', {} as any);
    expect(mockSettingsCrud.updateSyncSettings).toHaveBeenCalled();
  });
});

// ── archive delegates ─────────────────────────────────────────────────────────

describe('ProfileCacheManager — archive delegates (via archiveCtx)', () => {
  it('archiveChatConfig delegates', async () => {
    const mgr = freshManager();
    await mgr.archiveChatConfig('alice', 'c1');
    expect(mockArchiveOps.archiveChatConfig).toHaveBeenCalled();
  });

  it('unarchiveChatConfig delegates', async () => {
    const mgr = freshManager();
    await mgr.unarchiveChatConfig('alice', 'c1');
    expect(mockArchiveOps.unarchiveChatConfig).toHaveBeenCalled();
  });

  it('getArchivedAgents delegates', () => {
    const mgr = freshManager();
    mgr.getArchivedAgents('alice');
    expect(mockArchiveOps.getArchivedAgents).toHaveBeenCalled();
  });
});

// ── chatSession delegates ─────────────────────────────────────────────────────

describe('ProfileCacheManager — chatSession delegates (via chatSessionCtx)', () => {
  it('saveChatSession delegates', async () => {
    const mgr = freshManager();
    await mgr.saveChatSession('alice', 'c1', {} as any);
    expect(mockChatSessionOps.saveChatSession).toHaveBeenCalled();
  });

  it('deleteChatSession delegates', async () => {
    const mgr = freshManager();
    await mgr.deleteChatSession('alice', 'c1', 'sess1');
    expect(mockChatSessionOps.deleteChatSession).toHaveBeenCalled();
  });

  it('getChatSessions (deprecated) delegates', () => {
    const mgr = freshManager();
    mgr.getChatSessions('alice', 'c1');
    expect(mockChatSessionOps.getChatSessions).toHaveBeenCalled();
  });

  it('getChatSessionsAsync delegates', async () => {
    const mgr = freshManager();
    await mgr.getChatSessionsAsync('alice', 'c1');
    expect(mockChatSessionOps.getChatSessionsAsync).toHaveBeenCalled();
  });

  it('getChatSessionFile delegates', async () => {
    const mgr = freshManager();
    await mgr.getChatSessionFile('alice', 'c1', 'sess1');
    expect(mockChatSessionOps.getChatSessionFile).toHaveBeenCalled();
  });
});

// ── removeStarredChatSessionIndex ─────────────────────────────────────────────

describe('ProfileCacheManager — removeStarredChatSessionIndex', () => {
  it('returns false when alias not in cache', async () => {
    const mgr = freshManager();
    const result = await (mgr as any).removeStarredChatSessionIndex('nobody', 'sess1');
    expect(result).toBe(false);
  });

  it('returns false when chatSessionId not found in starred items', async () => {
    const mgr = freshManager();
    const profile = makeProfile({ 'starred-chat-sessions': [] });
    (mgr as any).cache.set('alice', profile);
    const result = await (mgr as any).removeStarredChatSessionIndex('alice', 'nonexistent');
    expect(result).toBe(false);
  });

  it('removes existing starred session and returns true', async () => {
    const mgr = freshManager();
    const profile = makeProfile({
      'starred-chat-sessions': [
        { chatSessionId: 'sess1', chatId: 'c1', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', agentName: 'A', starredAt: '2026-01-01T00:00:00Z' },
      ],
    });
    (mgr as any).cache.set('alice', profile);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    const result = await (mgr as any).removeStarredChatSessionIndex('alice', 'sess1');
    expect(result).toBe(true);
  });
});

// ── syncStarredChatSessionIndex sort path ─────────────────────────────────────

describe('ProfileCacheManager — syncStarredChatSessionIndex sort path', () => {
  it('adds new starred session (covers sort line 295)', async () => {
    const mgr = freshManager();
    const profile = makeProfile({
      'starred-chat-sessions': [],
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'Agent',
          model: 'gpt-5',
          system_prompt: '',
          source: 'ON-DEVICE',
          version: '1.0.0',
          workspace: '',
          mcp_servers: [],
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      }],
    });
    (mgr as any).cache.set('alice', profile);
    (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);

    const session = {
      chatSession_id: 'chatSession_20260101010101_dev_abc',
      title: 'New Session',
      last_updated: '2026-01-01T00:00:00Z',
      starred: true,
    };

    const result = await (mgr as any).syncStarredChatSessionIndex('alice', 'c1', session);
    expect(result).toBe(true);
  });
});
