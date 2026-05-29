// @ts-nocheck
// Tests for ProfileCacheManager methods with low coverage:
// clearCache, updateMcpServerInUse, getCachedAliases,
// getMcpServerInfo, getAllMcpServerInfo, cleanupMem0Resources,
// getMcpServerRuntimeState, getAllMcpServerRuntimeStates,
// executeToolCall, clearMcpServerRuntimeState, clearUserRuntimeStates

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
  chatSessionStore: { getChatSessionsProjection: vi.fn(), saveSession: vi.fn(), deleteSession: vi.fn() },
}));

// Heavy background service mocks — prevent actual initialization
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
import type { ProfileV2 } from '../types/profile';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildProfile(alias = 'alice', overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    alias,
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
  // Stub out filesystem and notification helpers to keep tests pure
  (mgr as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (mgr as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  return mgr;
}

// ─── getCachedAliases ─────────────────────────────────────────────────────────

describe('ProfileCacheManager.getCachedAliases', () => {
  it('returns an empty array when no profiles are cached', () => {
    const mgr = freshManager();
    expect(mgr.getCachedAliases()).toEqual([]);
  });

  it('returns all currently cached alias names', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    (mgr as any).cache.set('bob', buildProfile('bob'));
    expect(mgr.getCachedAliases()).toEqual(expect.arrayContaining(['alice', 'bob']));
    expect(mgr.getCachedAliases()).toHaveLength(2);
  });
});

// ─── clearCache ───────────────────────────────────────────────────────────────

describe('ProfileCacheManager.clearCache', () => {
  it('removes only the specified alias from the cache', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    (mgr as any).cache.set('bob', buildProfile('bob'));
    mgr.clearCache('alice');
    expect(mgr.getCachedAliases()).not.toContain('alice');
    expect(mgr.getCachedAliases()).toContain('bob');
  });

  it('does not throw when clearing a non-existent alias', () => {
    const mgr = freshManager();
    expect(() => mgr.clearCache('nobody')).not.toThrow();
  });

  it('clears all cached profiles when no alias is provided', () => {
    const mgr = freshManager();
    (mgr as any).cache.set('alice', buildProfile('alice'));
    (mgr as any).cache.set('bob', buildProfile('bob'));
    mgr.clearCache();
    expect(mgr.getCachedAliases()).toHaveLength(0);
  });
});

// ─── updateMcpServerInUse ────────────────────────────────────────────────────

describe('ProfileCacheManager.updateMcpServerInUse', () => {
  it('sets in_use to true on the named server', () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      mcp_servers: [{ name: 'my-server', command: 'npx', args: [], in_use: false, enabled: true }],
    });
    (mgr as any).cache.set('alice', profile);

    mgr.updateMcpServerInUse('alice', 'my-server', true);

    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated.mcp_servers[0].in_use).toBe(true);
  });

  it('sets in_use to false on the named server', () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      mcp_servers: [{ name: 'my-server', command: 'npx', args: [], in_use: true, enabled: true }],
    });
    (mgr as any).cache.set('alice', profile);

    mgr.updateMcpServerInUse('alice', 'my-server', false);

    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated.mcp_servers[0].in_use).toBe(false);
  });

  it('does nothing when the alias is not in the cache', () => {
    const mgr = freshManager();
    expect(() => mgr.updateMcpServerInUse('nobody', 'srv', true)).not.toThrow();
  });

  it('does nothing when the server name does not exist', () => {
    const mgr = freshManager();
    const profile = buildProfile('alice', {
      mcp_servers: [{ name: 'other-server', command: 'npx', args: [], in_use: false, enabled: true }],
    });
    (mgr as any).cache.set('alice', profile);

    mgr.updateMcpServerInUse('alice', 'missing-server', true);

    const updated = (mgr as any).cache.get('alice') as ProfileV2;
    expect(updated.mcp_servers[0].in_use).toBe(false); // unchanged
  });
});

// ─── getMcpServerRuntimeState / getAllMcpServerRuntimeStates ─────────────────

describe('ProfileCacheManager MCP runtime state accessors', () => {
  it('getMcpServerRuntimeState returns null when mcpClientManager is not set', () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = null;
    expect(mgr.getMcpServerRuntimeState('alice', 'srv')).toBeNull();
  });

  it('getMcpServerRuntimeState delegates to mcpClientManager', () => {
    const mgr = freshManager();
    const fakeState = { serverName: 'srv', status: 'connected', tools: [], lastError: null };
    const mockClient = { getMcpServerRuntimeState: vi.fn(() => fakeState) };
    (mgr as any).mcpClientManager = mockClient;

    const result = mgr.getMcpServerRuntimeState('alice', 'srv');
    expect(result).toBe(fakeState);
    expect(mockClient.getMcpServerRuntimeState).toHaveBeenCalledWith('srv');
  });

  it('getAllMcpServerRuntimeStates returns [] when mcpClientManager is not set', () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = null;
    expect(mgr.getAllMcpServerRuntimeStates('alice')).toEqual([]);
  });

  it('getAllMcpServerRuntimeStates delegates to mcpClientManager', () => {
    const mgr = freshManager();
    const fakeStates = [{ serverName: 'srv', status: 'connected', tools: [], lastError: null }];
    const mockClient = { getAllMcpServerRuntimeStates: vi.fn(() => fakeStates) };
    (mgr as any).mcpClientManager = mockClient;

    const result = mgr.getAllMcpServerRuntimeStates('alice');
    expect(result).toBe(fakeStates);
  });
});

// ─── clearMcpServerRuntimeState / clearUserRuntimeStates ─────────────────────

describe('ProfileCacheManager MCP runtime state cleanup', () => {
  it('clearMcpServerRuntimeState calls _clearServerRuntimeState on mcpClientManager', () => {
    const mgr = freshManager();
    const mockClient = { _clearServerRuntimeState: vi.fn() };
    (mgr as any).mcpClientManager = mockClient;

    mgr.clearMcpServerRuntimeState('alice', 'srv');
    expect(mockClient._clearServerRuntimeState).toHaveBeenCalledWith('srv');
  });

  it('clearMcpServerRuntimeState does not throw when mcpClientManager is null', () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = null;
    expect(() => mgr.clearMcpServerRuntimeState('alice', 'srv')).not.toThrow();
  });

  it('clearUserRuntimeStates iterates all states and clears each', () => {
    const mgr = freshManager();
    const states = [
      { serverName: 'srv-a', status: 'connected', tools: [], lastError: null },
      { serverName: 'srv-b', status: 'connected', tools: [], lastError: null },
    ];
    const mockClient = {
      getAllMcpServerRuntimeStates: vi.fn(() => states),
      _clearServerRuntimeState: vi.fn(),
    };
    (mgr as any).mcpClientManager = mockClient;

    mgr.clearUserRuntimeStates('alice');
    expect(mockClient._clearServerRuntimeState).toHaveBeenCalledTimes(2);
    expect(mockClient._clearServerRuntimeState).toHaveBeenCalledWith('srv-a');
    expect(mockClient._clearServerRuntimeState).toHaveBeenCalledWith('srv-b');
  });
});

// ─── getMcpServerInfo / getAllMcpServerInfo ───────────────────────────────────

describe('ProfileCacheManager.getMcpServerInfo', () => {
  it('returns null config and runtime when profile is not cached', () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = { getMcpServerRuntimeState: vi.fn(() => null) };
    const info = mgr.getMcpServerInfo('nobody', 'srv');
    expect(info.config).toBeNull();
    expect(info.runtime).toBeNull();
  });

  it('returns config from profile and runtime from mcpClientManager', () => {
    const mgr = freshManager();
    const serverCfg = { name: 'srv', command: 'npx', args: [], enabled: true };
    const profile = buildProfile('alice', { mcp_servers: [serverCfg as any] });
    (mgr as any).cache.set('alice', profile);
    const fakeState = { serverName: 'srv', status: 'connected', tools: [], lastError: null };
    (mgr as any).mcpClientManager = { getMcpServerRuntimeState: vi.fn(() => fakeState) };

    const info = mgr.getMcpServerInfo('alice', 'srv');
    expect(info.config).toEqual(serverCfg);
    expect(info.runtime).toBe(fakeState);
  });
});

describe('ProfileCacheManager.getAllMcpServerInfo', () => {
  it('returns empty array when profile is not cached', () => {
    const mgr = freshManager();
    expect(mgr.getAllMcpServerInfo('nobody')).toEqual([]);
  });

  it('maps each server config to its runtime state', () => {
    const mgr = freshManager();
    const srv = { name: 'srv', command: 'npx', args: [], enabled: true };
    const profile = buildProfile('alice', { mcp_servers: [srv as any] });
    (mgr as any).cache.set('alice', profile);
    const fakeState = { serverName: 'srv', status: 'connected', tools: [], lastError: null };
    (mgr as any).mcpClientManager = { getMcpServerRuntimeState: vi.fn(() => fakeState) };

    const all = mgr.getAllMcpServerInfo('alice');
    expect(all).toHaveLength(1);
    expect(all[0].config).toEqual(srv);
    expect(all[0].runtime).toBe(fakeState);
  });
});

// ─── executeToolCall ─────────────────────────────────────────────────────────

describe('ProfileCacheManager.executeToolCall', () => {
  it('throws when mcpClientManager is not initialized', async () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = null;
    await expect(mgr.executeToolCall('my_tool', {})).rejects.toThrow('MCP Client Manager not initialized');
  });

  it('throws when no current user alias is set', async () => {
    const mgr = freshManager();
    (mgr as any).mcpClientManager = { executeTool: vi.fn() };
    (mgr as any).currentUserAlias = null;
    await expect(mgr.executeToolCall('my_tool', {})).rejects.toThrow('No current user alias set');
  });

  it('delegates to mcpClientManager.executeTool with toolName and toolArgs', async () => {
    const mgr = freshManager();
    const mockResult = { output: 'done' };
    const mockClient = { executeTool: vi.fn().mockResolvedValue(mockResult) };
    (mgr as any).mcpClientManager = mockClient;
    (mgr as any).currentUserAlias = 'alice';

    const result = await mgr.executeToolCall('run_shell', { cmd: 'ls' });
    expect(result).toBe(mockResult);
    expect(mockClient.executeTool).toHaveBeenCalledWith({ toolName: 'run_shell', toolArgs: { cmd: 'ls' } });
  });

  it('propagates errors from mcpClientManager.executeTool', async () => {
    const mgr = freshManager();
    const mockClient = { executeTool: vi.fn().mockRejectedValue(new Error('tool error')) };
    (mgr as any).mcpClientManager = mockClient;
    (mgr as any).currentUserAlias = 'alice';

    await expect(mgr.executeToolCall('bad_tool', {})).rejects.toThrow('tool error');
  });
});

// ─── cleanupMem0Resources ─────────────────────────────────────────────────────

describe('ProfileCacheManager.cleanupMem0Resources', () => {
  it('resolves without error', async () => {
    const mgr = freshManager();
    await expect(mgr.cleanupMem0Resources()).resolves.toBeUndefined();
  });
});
