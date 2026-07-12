// @ts-nocheck
/**
 * profileCacheManager.coverage5.test.ts
 *
 * Supplemental branch coverage for ProfileCacheManager.
 * This file intentionally keeps production code untouched and drives the
 * remaining branches through mutable module mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAllWindows = vi.hoisted(() => vi.fn(() => []));
const mockFsExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockFsMkdirSync = vi.hoisted(() => vi.fn());
const mockFsReadFile = vi.hoisted(() => vi.fn().mockResolvedValue('{}'));
const mockFsWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsRm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockApplyProfileMigrations = vi.hoisted(() => vi.fn(() => false));
const mockApplyBuiltinDefaultsMigrations = vi.hoisted(() => vi.fn(() => false));
const mockSanitizeProfileV2 = vi.hoisted(() => vi.fn((profile: any) => profile));
const mockCreateDefaultChat = vi.hoisted(() => vi.fn(() => ({
  chat_id: 'default-chat',
  chat_type: 'single_agent',
  agent: { name: 'Kobi', workspace: '', mcp_servers: [], skills: [] },
})));
const mockBuildStarredItem = vi.hoisted(() => vi.fn((_profile: any, chatId: string, session: any, starredAt?: string) => ({
  chatSessionId: session.chatSession_id,
  chatId,
  title: session.title || 'Session',
  lastUpdated: session.last_updated || '2026-01-01T00:00:00Z',
  agentName: 'Agent',
  starredAt: starredAt || session.starredAt || '2026-01-01T00:00:00Z',
})));

const mockChatSessionStore = vi.hoisted(() => ({
  getChatSessionsProjection: vi.fn().mockResolvedValue({ sessions: [] }),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}));

const mockGhcInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAgentInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFeatureEnabled = vi.hoisted(() => vi.fn(() => false));
const mockGetExternalAgentService = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnifiedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  updateConfig: vi.fn(),
}));

const mockChatCrud = vi.hoisted(() => ({
  addChatConfig: vi.fn(async (ctx: any, alias: string, chatConfig: any) => {
    await ctx.readProfileFromFile(alias);
    await ctx.writeProfileToFile(alias, { alias, chats: [chatConfig] });
    await ctx.notifyProfileDataManager(alias, true);
    return true;
  }),
  updateChatConfig: vi.fn(async (ctx: any, alias: string) => {
    await ctx.notifyProfileDataManager(alias);
    return true;
  }),
  deleteChatConfig: vi.fn().mockResolvedValue(true),
  getChatConfig: vi.fn(() => null),
  getAllChatConfigs: vi.fn(() => []),
  updateChatAgent: vi.fn().mockResolvedValue(true),
  updateChatSkillSnapshot: vi.fn().mockResolvedValue(true),
}));

const mockSettingsCrud = vi.hoisted(() => ({
  getToolBarSettings: vi.fn(() => ({})),
  getConfirmationSettings: vi.fn(() => ({})),
  updateToolBarSettings: vi.fn(async (ctx: any, alias: string) => {
    await ctx.readProfileFromFile(alias);
    await ctx.writeProfileToFile(alias, { alias });
    await ctx.notifyProfileDataManager(alias);
    return true;
  }),
  updateConfirmationSettings: vi.fn(async (ctx: any, alias: string) => {
    await ctx.notifyProfileDataManager(alias, true);
    return true;
  }),
  getVoiceInputSettings: vi.fn(() => ({})),
  updateVoiceInputSettings: vi.fn(async (ctx: any, alias: string) => {
    await ctx.notifyProfileDataManager(alias);
    return true;
  }),
  getTtsSettings: vi.fn(() => ({})),
  updateTtsSettings: vi.fn().mockResolvedValue(true),
  updatePrimaryAgent: vi.fn().mockResolvedValue(true),
  updateFreDone: vi.fn().mockResolvedValue(true),
  getFreDone: vi.fn(() => false),
  getDevToolsMcpSettings: vi.fn(() => ({})),
  updateDevToolsMcpSettings: vi.fn().mockResolvedValue(true),
  getSyncSettings: vi.fn(() => ({})),
  updateSyncSettings: vi.fn().mockResolvedValue(true),
}));

const mockArchiveOps = vi.hoisted(() => ({
  archiveChatConfig: vi.fn(async (ctx: any, alias: string) => {
    ctx.getProfileDirectoryPath(alias);
    await ctx.readProfileFromFile(alias);
    await ctx.writeProfileToFile(alias, { alias });
    await ctx.notifyProfileDataManager(alias);
    return true;
  }),
  unarchiveChatConfig: vi.fn(async (ctx: any, alias: string) => {
    await ctx.notifyProfileDataManager(alias, true);
    return { success: true };
  }),
  getArchivedAgents: vi.fn(() => []),
}));

const mockChatSessionOps = vi.hoisted(() => ({
  saveChatSession: vi.fn(async (ctx: any, alias: string, chatId: string, session: any) => {
    await ctx.syncStarredChatSessionIndex(alias, chatId, session, { notifyRenderer: false });
    await ctx.notifyProfileDataManager(alias);
    return true;
  }),
  deleteChatSession: vi.fn(async (ctx: any, alias: string, _chatId: string, chatSessionId: string) => {
    await ctx.removeStarredChatSessionIndex(alias, chatSessionId, { notifyRenderer: false });
    await ctx.notifyProfileDataManager(alias, true);
    return true;
  }),
  getChatSessions: vi.fn(() => []),
  getChatSessionsAsync: vi.fn().mockResolvedValue([]),
  getChatSessionFile: vi.fn().mockResolvedValue(null),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockFsExistsSync,
    mkdirSync: mockFsMkdirSync,
    promises: {
      ...actual.promises,
      readFile: mockFsReadFile,
      writeFile: mockFsWriteFile,
      rm: mockFsRm,
    },
  };
});

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => mockUnifiedLogger),
  createConsoleLogger: vi.fn(() => mockUnifiedLogger),
  getUnifiedLogger: vi.fn(() => mockUnifiedLogger),
  createHighPerformanceLogger: vi.fn(() => mockUnifiedLogger),
  createDebugLogger: vi.fn(() => mockUnifiedLogger),
  getRefactoredLogger: vi.fn(() => mockUnifiedLogger),
  getGlobalLogger: vi.fn(() => mockUnifiedLogger),
  initializeGlobalLogger: vi.fn(() => mockUnifiedLogger),
  resetGlobalLogger: vi.fn(),
  isGlobalLoggerInitialized: vi.fn(() => false),
  default: vi.fn(() => mockUnifiedLogger),
}));

vi.mock('../pathUtils', () => ({
  getDefaultWorkspacePath: vi.fn((alias: string, chatId: string) => `/mock/workspace/${alias}/${chatId}`),
  isDefaultWorkspacePath: vi.fn(() => false),
}));

vi.mock('../profileBackupManager', () => ({
  backupProfileDirectoryBeforeMutation: vi.fn().mockResolvedValue({ success: true, backupDir: '/mock/backup' }),
}));

vi.mock('../chatSessionManager', () => ({
  chatSessionManager: { loadChatSessions: vi.fn(), saveChatSession: vi.fn() },
}));

vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('../../../../shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('@shared/constants/builtinSkills', () => ({
  BUILTIN_DEFAULTS_VERSION: 3,
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_SKILL_CHANGELOG: {},
}));
vi.mock('../../../../shared/constants/builtinSkills', () => ({
  BUILTIN_DEFAULTS_VERSION: 3,
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_SKILL_CHANGELOG: {},
}));

vi.mock('../../chat/chatSessionStore', () => ({ chatSessionStore: mockChatSessionStore }));
vi.mock('../../llm/ghcModelsManager', () => ({
  ghcModelsManager: { initialize: mockGhcInitialize },
  getDefaultModel: vi.fn(() => 'gpt-5'),
}));
vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    initialize: mockMcpInitialize,
    getAllMcpServerRuntimeStates: vi.fn(() => []),
    getMcpServerRuntimeState: vi.fn(() => null),
    _clearServerRuntimeState: vi.fn(),
    executeTool: vi.fn(),
  },
}));
vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: { initialize: mockAgentInitialize },
}));
vi.mock('../../featureFlags/featureFlagManager', () => ({
  featureFlagManager: { isEnabled: mockFeatureEnabled },
}));
vi.mock('../../../startup/lazy', () => ({
  getExternalAgentService: mockGetExternalAgentService,
}));

vi.mock('../profileSanitizer', () => ({
  sanitizeProfileV2: mockSanitizeProfileV2,
  sanitizeHooks: vi.fn((h: any) => (Array.isArray(h) ? h : [])),
  sanitizeStarredChatSessions: vi.fn((profile: any) => profile['starred-chat-sessions'] || []),
  buildStarredChatSessionIndexItem: mockBuildStarredItem,
  sanitizeChatSkillSnapshot: vi.fn(),
  clearSkillSnapshotsForAffectedChats: vi.fn(),
  createDefaultChat: mockCreateDefaultChat,
  generateChatId: vi.fn(() => 'generated-chat'),
}));
vi.mock('../profileMigration', () => ({
  PROFILE_MIGRATION_VERSION: 3,
  applyProfileMigrations: mockApplyProfileMigrations,
  applyBuiltinDefaultsMigrations: mockApplyBuiltinDefaultsMigrations,
  isDefaultProfile: vi.fn(() => false),
  isDefaultChatConfig: vi.fn(() => false),
}));
vi.mock('../profileEntityCrud', () => ({
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
  addSkill: vi.fn().mockResolvedValue(true),
  updateSkill: vi.fn().mockResolvedValue(true),
  deleteSkill: vi.fn().mockResolvedValue(true),
}));
vi.mock('../profileHookCrud', () => ({
  getHooks: vi.fn(() => []),
  addHook: vi.fn().mockResolvedValue(true),
  updateHook: vi.fn().mockResolvedValue(true),
  deleteHook: vi.fn().mockResolvedValue(true),
}));
vi.mock('../profileChatCrud', () => mockChatCrud);
vi.mock('../profileSettingsCrud', () => mockSettingsCrud);
vi.mock('../profileArchiveManager', () => mockArchiveOps);
vi.mock('../profileChatSessionOps', () => mockChatSessionOps);

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

import { ProfileCacheManager } from '../profileCacheManager';
import { findAgentlessActiveChatIds } from '../profileRelationshipGuards';
import * as entityCrud from '../profileEntityCrud';
import * as hookCrud from '../profileHookCrud';
import * as agentStoreManagerNs from '../agentStoreManager';
import type { ProfileV2 } from '../types/profile';

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  const manager = ProfileCacheManager.getInstance();
  (manager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  return manager;
}

function makeWindow(title = 'OpenKosmos AI Studio') {
  return {
    title,
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
}

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    role: 'assistant',
    name: 'Agent',
    model: 'gpt-5',
    workspace: '/workspace',
    version: '1.0.0',
    source: 'ON-DEVICE',
    mcp_servers: [],
    skills: [],
    system_prompt: '',
    zero_states: { greeting: '', quick_starts: [] },
    ...overrides,
  };
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
    builtinDefaultsVersion: 3,
    profileMigrationVersion: 3,
    chats: [{
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: makeAgent(),
    }],
    ...overrides,
  };
}

describe('ProfileCacheManager active chat relationship guard', () => {
  it('finds active chats with neither agent_ids nor inline agents', () => {
    const profile = makeProfile({
      chats: [
        { chat_id: 'chat-broken', chat_type: 'single_agent' },
        { chat_type: 'single_agent' },
        { chat_id: 'chat-ids', chat_type: 'single_agent', agent_ids: ['agent-a'] },
        { chat_id: 'chat-inline', chat_type: 'single_agent', agent: makeAgent() },
        { chat_id: 'chat-inline-many', chat_type: 'multi_agent', agents: [makeAgent()] },
      ] as any,
    });

    expect(findAgentlessActiveChatIds(profile)).toEqual(['chat-broken', '<missing-chat-id>']);
  });

  it('treats a malformed chats field as empty', () => {
    expect(findAgentlessActiveChatIds(makeProfile({ chats: null as any }))).toEqual([]);
  });
});

async function flushBackgroundServices() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  mcpManagerStore.servers.clear();
  delete (global as any).electron;
  delete process.env.APP_NAME;
  mockFsExistsSync.mockReturnValue(true);
  mockFsMkdirSync.mockImplementation(() => undefined);
  mockFsReadFile.mockResolvedValue('{}');
  mockFsWriteFile.mockResolvedValue(undefined);
  mockFsRm.mockResolvedValue(undefined);
  mockApplyProfileMigrations.mockReturnValue(false);
  mockApplyBuiltinDefaultsMigrations.mockReturnValue(false);
  mockSanitizeProfileV2.mockImplementation((profile: any) => profile);
  mockChatSessionStore.getChatSessionsProjection.mockResolvedValue({ sessions: [] });
  mockGetAllWindows.mockReturnValue([]);
  mockGhcInitialize.mockResolvedValue(undefined);
  mockMcpInitialize.mockResolvedValue(undefined);
  mockAgentInitialize.mockResolvedValue(undefined);
  mockFeatureEnabled.mockReturnValue(false);
  mockGetExternalAgentService.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProfileCacheManager coverage5 singleton and parsing branches', () => {
  it('removes legacy relay credentials without reading or reconnecting', async () => {
    const manager = freshManager();

    await (manager as any).cleanupLegacyRemoteCredentials('alice');

    expect(mockFsRm).toHaveBeenCalledTimes(2);
    expect(mockFsRm).toHaveBeenCalledWith(
      '/mock/userData/profiles/alice/credentials/teams_bindingToken.enc',
      { force: true },
    );
    expect(mockFsRm).toHaveBeenCalledWith(
      '/mock/userData/profiles/alice/credentials/teams_boundUserId.enc',
      { force: true },
    );
  });

  it('continues when a legacy relay credential cannot be removed', async () => {
    mockFsRm.mockRejectedValueOnce(new Error('locked'));
    const manager = freshManager();

    await expect((manager as any).cleanupLegacyRemoteCredentials('alice')).resolves.toBeUndefined();

    expect(mockUnifiedLogger.warn).toHaveBeenCalledWith(
      '[ProfileCacheManager] Failed to remove legacy remote credential',
      'cleanupLegacyRemoteCredentials',
      expect.objectContaining({ alias: 'alice', error: 'locked' }),
    );
  });

  it('returns the existing singleton on the second getInstance call', () => {
    (ProfileCacheManager as any).instance = undefined;
    const first = ProfileCacheManager.getInstance();
    const second = ProfileCacheManager.getInstance();
    expect(second).toBe(first);
  });

  it('covers the non-Error JSON parse branch', async () => {
    mockFsReadFile.mockResolvedValueOnce('anything');
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'parse failed';
    });
    const manager = freshManager();

    const result = await (manager as any).readProfileFromFile('alice');

    expect(result).toBeNull();
    parseSpy.mockRestore();
  });
});

describe('ProfileCacheManager coverage5 integrity branches', () => {
  it('persists when profile migrations, workspace backfill, and normalization mutate data', async () => {
    mockApplyProfileMigrations.mockReturnValue(true);
    mockApplyBuiltinDefaultsMigrations.mockReturnValue(false);
    mockSanitizeProfileV2.mockImplementation((profile: any) => ({
      ...profile,
      primaryAgent: 'Changed',
    }));
    const manager = freshManager();
    const writeProfileToFile = (manager as any).writeProfileToFile;
    const profile = makeProfile({
      profileMigrationVersion: 0,
      builtinDefaultsVersion: 0,
      chats: [{
        chat_id: 'chat-missing-workspace',
        chat_type: 'single_agent',
        agent: makeAgent({ workspace: '' }),
      }],
    });

    const result = await (manager as any).ensureV2ProfileIntegrity('alice', profile);

    expect(result.primaryAgent).toBe('Changed');
    expect(result.chats[0].workspace).toBe('/mock/workspace/alice/chat-missing-workspace');
    expect(result.chats[0].agent.workspace).toBeUndefined();
    expect(writeProfileToFile).toHaveBeenCalledWith('alice', expect.objectContaining({ primaryAgent: 'Changed' }));
  });

  it('returns fallback data with existing optional values when integrity throws', async () => {
    const manager = freshManager();
    const profile: any = {
      createdAt: '2026-02-01T00:00:00Z',
      alias: 'fallback-alias',
      mcp_servers: [{ name: 'server' }],
      skills: [{ name: 'skill' }],
      'starred-chat-sessions': [{ chatSessionId: 'session-1' }],
    };
    profile.self = profile;

    const result = await (manager as any).ensureV2ProfileIntegrity('alice', profile);

    expect(result.createdAt).toBe('2026-02-01T00:00:00Z');
    expect(result.alias).toBe('fallback-alias');
    expect(result.mcp_servers).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result['starred-chat-sessions']).toHaveLength(1);
  });

  it('returns fallback defaults when optional values are absent', async () => {
    const manager = freshManager();
    const profile: any = {};
    profile.self = profile;

    const result = await (manager as any).ensureV2ProfileIntegrity('alice', profile);

    expect(result.alias).toBe('alice');
    expect(result.mcp_servers).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result['starred-chat-sessions']).toEqual([]);
  });
});

describe('ProfileCacheManager coverage5 notification branches', () => {
  it('processes a pending batched notification when the debounce fires', async () => {
    vi.useFakeTimers();
    const manager = freshManager();
    const performNotification = vi.fn().mockResolvedValue(undefined);
    (manager as any).performNotification = performNotification;

    await (manager as any).notifyProfileDataManager('alice');
    await vi.runAllTimersAsync();

    expect(performNotification).toHaveBeenCalledWith('alice');
  });

  it('sends null profile data when the cache has no profile', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);

    await (manager as any).performNotification('missing');

    expect(win.webContents.send).toHaveBeenCalledWith('profile:cacheUpdated', expect.objectContaining({
      alias: 'missing',
      profile: null,
    }));
  });

  it('uses APP_NAME window lookup and skips chat session loading for empty chats', async () => {
    process.env.APP_NAME = 'Custom App';
    const manager = freshManager();
    const win = makeWindow('Custom App');
    mockGetAllWindows.mockReturnValue([win]);
    (manager as any).cache.set('alice', makeProfile({ chats: [] as any }));

    await (manager as any).performNotification('alice');

    expect(mockGetAllWindows).toHaveBeenCalled();
    expect(mockChatSessionStore.getChatSessionsProjection).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('profile:cacheUpdated', expect.objectContaining({
      profile: expect.objectContaining({ chats: [] }),
    }));
  });

  it('includes optional session projection fields and handles non-Error per-chat load failures', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);
    (manager as any).currentUserAlias = 'current-alias';
    (manager as any).cache.set('alice', makeProfile({
      chats: [
        { chat_id: 'chat-ok', chat_type: 'single_agent', agent: makeAgent() },
        { chat_id: 'chat-fail', chat_type: 'single_agent', agent: makeAgent({ name: 'Fail' }) },
      ],
    }));
    mockChatSessionStore.getChatSessionsProjection.mockImplementation(async (_alias: string, chatId: string) => {
      if (chatId === 'chat-fail') {
        throw 'projection failed';
      }
      return {
        sessions: [
          {
            chatSession_id: 'session-full',
            last_updated: '2026-01-02T00:00:00Z',
            title: 'Full',
            readStatus: 'read',
            starred: true,
            starredAt: '2026-01-02T00:00:00Z',
            schedulerJobId: 'job-1',
            schedulerExecutionStatus: 'completed',
            schedulerStartedAt: '2026-01-02T00:00:00Z',
            schedulerCompletedAt: '2026-01-02T00:01:00Z',
            schedulerError: 'none',
            source: { type: 'scheduler' },
          },
          {
            chatSession_id: 'session-minimal',
            last_updated: '2026-01-03T00:00:00Z',
            title: 'Minimal',
            readStatus: 'unread',
          },
        ],
      };
    });

    await (manager as any).performNotification('alice');

    const profileCall = win.webContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'profile:cacheUpdated',
    );
    const sent = profileCall[1].profile;
    expect(sent.alias).toBe('current-alias');
    expect(sent.chats[0].chatSessions[0]).toEqual(expect.objectContaining({
      chatSession_id: 'session-full',
      starred: true,
      schedulerJobId: 'job-1',
      schedulerExecutionStatus: 'completed',
      schedulerStartedAt: '2026-01-02T00:00:00Z',
      schedulerCompletedAt: '2026-01-02T00:01:00Z',
      schedulerError: 'none',
      source: { type: 'scheduler' },
    }));
    expect(sent.chats[0].chatSessions[1].source).toBeUndefined();
    expect(sent.chats[1].chatSessions).toEqual([]);
  });

  it('falls back to the original profile when the outer session loading block throws', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);
    (manager as any).cache.set('alice', makeProfile({
      chats: { length: 1 } as any,
    }));

    await (manager as any).performNotification('alice');

    expect(win.webContents.send).toHaveBeenCalledWith('profile:cacheUpdated', expect.objectContaining({
      profile: expect.objectContaining({ chats: { length: 1 } }),
    }));
  });

  it('strips inline agent/agents and pushes agent_ids-only chats (Phase 4)', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);
    // The chat's agent is durable in the registry, so its inline facade is stripped.
    vi.spyOn(manager as any, 'getRegisteredAgents').mockReturnValue([{ id: 'agent-a' }]);
    (manager as any).cache.set('alice', makeProfile({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent_ids: ['agent-a'],
          agent: makeAgent({ name: 'Inline' }),
          agents: [makeAgent({ name: 'Inline' })],
        },
      ] as any,
    }));

    await (manager as any).performNotification('alice');

    const profileCall = win.webContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'profile:cacheUpdated',
    );
    const pushedChat = profileCall[1].profile.chats[0];
    expect(pushedChat.agent).toBeUndefined();
    expect(pushedChat.agents).toBeUndefined();
    expect(pushedChat.agent_ids).toEqual(['agent-a']);
  });

  it('keeps the inline agent facade when the chat agent is not registered (durability fallback)', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);
    // Registry lacks agent-a (its store write failed), so the inline facade must
    // survive the push — otherwise resolveChatAgent would render the chat agent-less.
    vi.spyOn(manager as any, 'getRegisteredAgents').mockReturnValue([]);
    (manager as any).cache.set('alice', makeProfile({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent_ids: ['agent-a'],
          agent: makeAgent({ name: 'Inline' }),
        },
      ] as any,
    }));

    await (manager as any).performNotification('alice');

    const profileCall = win.webContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'profile:cacheUpdated',
    );
    const pushedChat = profileCall[1].profile.chats[0];
    expect(pushedChat.agent).toBeDefined();
    expect(pushedChat.agent.name).toBe('Inline');
  });

  it('emits agents:changed before the profile:cacheUpdated push (Phase 4 ordering)', async () => {
    const manager = freshManager();
    const win = makeWindow();
    manager.setMainWindow(win as any);
    (manager as any).cache.set('alice', makeProfile());

    await (manager as any).performNotification('alice');

    const eventNames = win.webContents.send.mock.calls.map((c: any[]) => c[0]);
    const agentsIdx = eventNames.indexOf('agents:changed');
    const profileIdx = eventNames.indexOf('profile:cacheUpdated');
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(profileIdx).toBeGreaterThanOrEqual(0);
    expect(agentsIdx).toBeLessThan(profileIdx);
  });
});

describe('ProfileCacheManager coverage5 background service branches', () => {
  it('logs string failures from every background service path', async () => {
    const manager = freshManager();
    mockGhcInitialize.mockRejectedValue('models failed');
    mockMcpInitialize.mockRejectedValue('mcp failed');
    mockAgentInitialize.mockRejectedValue('agent failed');
    mockFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureExternalAgent');
    mockGetExternalAgentService.mockRejectedValue('external failed');

    (manager as any).initializeBackgroundServices('alice');
    await flushBackgroundServices();

    expect(mockGhcInitialize).toHaveBeenCalledWith('alice');
    expect(mockMcpInitialize).toHaveBeenCalledWith('alice');
    expect(mockAgentInitialize).toHaveBeenCalledWith('alice');
    expect(mockGetExternalAgentService).toHaveBeenCalledWith('alice');
  });

  it('covers the rejected allSettled result branch', async () => {
    const manager = freshManager();
    mockGhcInitialize.mockRejectedValueOnce(new Error('model failure'));
    mockUnifiedLogger.error.mockImplementationOnce(() => {
      throw new Error('logger failed');
    });

    (manager as any).initializeBackgroundServices('alice');
    await flushBackgroundServices();

    expect(mockUnifiedLogger.warn).toHaveBeenCalledWith('[ProfileCacheManager] 1 background services failed to initialize');
  });
});

describe('ProfileCacheManager coverage5 delegated context branches', () => {
  it('exercises chat CRUD context read/write and both notify forms', async () => {
    const manager = freshManager();
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify(makeProfile()));

    await manager.addChatConfig('alice', { chat_id: 'chat-new', chat_type: 'single_agent', agent: makeAgent() } as any);
    await manager.updateChatConfig('alice', 'chat-new', {});

    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice');
  });

  it('exercises settings context read/write and both notify forms', async () => {
    const manager = freshManager();
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify(makeProfile()));

    await manager.updateVoiceInputSettings('alice', {} as any);
    await manager.updateConfirmationSettings('alice', {} as any);

    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice');
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('exercises archive context path/read/write and both notify forms', async () => {
    const manager = freshManager();
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify(makeProfile()));

    await manager.archiveChatConfig('alice', 'chat-1');
    await manager.unarchiveChatConfig('alice', 'chat-1');

    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice');
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('exercises chat session context starred callbacks and both notify forms', async () => {
    const manager = freshManager();
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    (manager as any).cache.set('alice', makeProfile({
      'starred-chat-sessions': [{
        chatSessionId: 'session-delete',
        chatId: 'chat-1',
        title: 'Delete',
        lastUpdated: '2026-01-01T00:00:00Z',
        agentName: 'Agent',
        starredAt: '2026-01-01T00:00:00Z',
      }],
    }));

    await manager.saveChatSession('alice', 'chat-1', {
      chatSession_id: 'session-save',
      title: 'Save',
      last_updated: '2026-01-02T00:00:00Z',
      starred: true,
    } as any);
    await manager.deleteChatSession('alice', 'chat-1', 'session-delete');

    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice');
    expect((manager as any).notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });
});

describe('ProfileCacheManager coverage5 fallback data branches', () => {
  it('uses empty starred arrays when cached profile values are undefined', async () => {
    const manager = freshManager();
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    const profile = makeProfile({ 'starred-chat-sessions': undefined as any });
    (manager as any).cache.set('alice', profile);

    const synced = await manager.syncStarredChatSessionIndex('alice', 'chat-1', {
      chatSession_id: 'session-1',
      starred: true,
      title: 'Session',
      last_updated: '2026-01-01T00:00:00Z',
    } as any, { notifyRenderer: false });
    const removed = await manager.removeStarredChatSessionIndex('alice', 'missing', { notifyRenderer: false });

    expect(synced).toBe(true);
    expect(removed).toBe(false);
  });

  it('covers clearCache with a present key whose value is undefined', () => {
    const manager = freshManager();
    (manager as any).cache.set('alice', undefined);

    manager.clearCache('alice');

    expect((manager as any).cache.has('alice')).toBe(false);
  });

  it('skips profile creation notification when requested', async () => {
    const manager = freshManager();
    const notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    (manager as any).notifyProfileDataManager = notifyProfileDataManager;
    (manager as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
    // The fs mock in this file routes writeFileSync to a nonexistent /mock path, so
    // a real agent store write would throw; make the first-run seed succeed so the
    // profile is created and the notification-skip behavior can be asserted.
    const writeSpy = vi.spyOn(agentStoreManagerNs, 'writeAgent').mockResolvedValue(undefined as never);
    try {
      const result = await manager.handleProfile('new-user', { notifyRenderer: false });

      expect(result?.alias).toBe('new-user');
      expect(notifyProfileDataManager).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('ProfileCacheManager hook CRUD delegation', () => {
  const hook = {
    id: 'h1',
    name: 'H1',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
    enabled: true,
    event: 'PreToolUse' as const,
    action: { type: 'command' as const, command: 'echo' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('delegates getHooks/addHook/updateHook/deleteHook to hookCrud', async () => {
    const manager = freshManager();

    expect(manager.getHooks('alice')).toEqual([]);
    expect(await manager.addHook('alice', hook)).toBe(true);
    expect(await manager.updateHook('alice', 'h1', { enabled: false })).toBe(true);
    expect(await manager.deleteHook('alice', 'h1')).toBe(true);

    expect(hookCrud.getHooks).toHaveBeenCalledWith(expect.anything(), 'alice');
    expect(hookCrud.addHook).toHaveBeenCalledWith(expect.anything(), 'alice', hook);
    expect(hookCrud.updateHook).toHaveBeenCalledWith(expect.anything(), 'alice', 'h1', { enabled: false });
    expect(hookCrud.deleteHook).toHaveBeenCalledWith(expect.anything(), 'alice', 'h1');
  });
});
