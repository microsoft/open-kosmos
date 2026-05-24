/**
 * Tests for PluginManager — singleton lifecycle, install/uninstall,
 * enable/disable, per-agent enable/disable, and query methods.
 */

import * as fs from 'fs';

// ── hoisted mocks (must be before vi.mock calls) ────────────────────────────

const {
  mockLoadAllInstalledPlugins,
  mockLoadPluginFromDir,
  mockAddPluginRecord,
  mockRemovePluginRecord,
  mockGetPluginRecord,
  mockHookRegistry,
  mockInjectPluginSkills,
  mockRemovePluginSkills,
  mockInjectPluginMcpServers,
  mockRemovePluginMcpServers,
  mockProfileCacheManager,
  mockMcpClientManager,
} = vi.hoisted(() => {
  const mockLoadAllInstalledPlugins = vi.fn();
  const mockLoadPluginFromDir = vi.fn();
  const mockAddPluginRecord = vi.fn();
  const mockRemovePluginRecord = vi.fn();
  const mockGetPluginRecord = vi.fn();
  const mockHookRegistry = { registerPluginHooks: vi.fn(), unregisterPluginHooks: vi.fn() };
  const mockInjectPluginSkills = vi.fn();
  const mockRemovePluginSkills = vi.fn();
  const mockInjectPluginMcpServers = vi.fn();
  const mockRemovePluginMcpServers = vi.fn();
  const mockProfileCacheManager = {
    getChatConfig: vi.fn(),
    updateChatAgent: vi.fn(),
    getCachedProfile: vi.fn(),
    addSkill: vi.fn(),
  };
  const mockMcpClientManager = { delete: vi.fn() };
  return {
    mockLoadAllInstalledPlugins,
    mockLoadPluginFromDir,
    mockAddPluginRecord,
    mockRemovePluginRecord,
    mockGetPluginRecord,
    mockHookRegistry,
    mockInjectPluginSkills,
    mockRemovePluginSkills,
    mockInjectPluginMcpServers,
    mockRemovePluginMcpServers,
    mockProfileCacheManager,
    mockMcpClientManager,
  };
});

// ── module-level mocks ──────────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../pluginDirectories', () => ({
  ensurePluginDirectories: vi.fn(),
  getPluginDir: (id: string) => `/plugins/packages/${id}`,
  getPluginPackagesDir: () => '/plugins/packages',
}));

vi.mock('../pluginLoader', () => ({
  loadAllInstalledPlugins: (...args: any[]) => mockLoadAllInstalledPlugins(...args),
  loadPluginFromDir: (...args: any[]) => mockLoadPluginFromDir(...args),
  addPluginRecord: (...args: any[]) => mockAddPluginRecord(...args),
  removePluginRecord: (...args: any[]) => mockRemovePluginRecord(...args),
  getPluginRecord: (...args: any[]) => mockGetPluginRecord(...args),
}));

vi.mock('../hooks/hookRegistry', () => ({ hookRegistry: mockHookRegistry }));

vi.mock('../bridges/skillBridge', () => ({
  injectPluginSkills: (...args: any[]) => mockInjectPluginSkills(...args),
  removePluginSkills: (...args: any[]) => mockRemovePluginSkills(...args),
}));

vi.mock('../bridges/mcpBridge', () => ({
  injectPluginMcpServers: (...args: any[]) => mockInjectPluginMcpServers(...args),
  removePluginMcpServers: (...args: any[]) => mockRemovePluginMcpServers(...args),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../../userDataADO/types/profile', () => ({
  isProfileV2: (p: any) => p && p.__isV2 === true,
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: mockMcpClientManager,
}));

vi.mock('fs');

// ── Import SUT after mocks ──────────────────────────────────────────────────

// Reset singleton between tests
import { PluginManager } from '../pluginManager';

const mockFs = vi.mocked(fs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(id = 'my-plugin', enabled = true): any {
  return {
    id,
    manifest: { name: id, version: '1.0.0', description: 'Test', author: { name: 'T' } },
    path: `/plugins/packages/${id}`,
    enabled,
    resolvedSkillPaths: [],
    injectedSkills: [],
    injectedMcpServers: [],
  };
}

function freshManager(): PluginManager {
  // Reset the private singleton so each test starts clean
  (PluginManager as any).instance = undefined;
  return PluginManager.getInstance();
}

// ---------------------------------------------------------------------------
// Tests: getInstance / singleton
// ---------------------------------------------------------------------------

describe('PluginManager.getInstance', () => {
  it('returns the same instance', () => {
    (PluginManager as any).instance = undefined;
    const a = PluginManager.getInstance();
    const b = PluginManager.getInstance();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Tests: initialize
// ---------------------------------------------------------------------------

describe('PluginManager.initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
  });

  it('calls ensurePluginDirectories and loadAllInstalledPlugins', async () => {
    const { ensurePluginDirectories } = await import('../pluginDirectories');
    const mgr = freshManager();
    await mgr.initialize('alice');
    expect(ensurePluginDirectories).toHaveBeenCalled();
    expect(mockLoadAllInstalledPlugins).toHaveBeenCalled();
  });

  it('stores enabled and disabled plugins', async () => {
    const p1 = makePlugin('p1', true);
    const p2 = makePlugin('p2', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p1], disabled: [p2], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');
    expect(mgr.getPlugins()).toHaveLength(2);
    expect(mgr.getEnabledPlugins()).toHaveLength(1);
  });

  it('returns load errors', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({
      enabled: [],
      disabled: [],
      errors: [{ pluginId: 'bad', message: 'bad manifest' }],
    });
    const mgr = freshManager();
    const result = await mgr.initialize('alice');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('bad manifest');
  });

  it('skips double initialization', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    const mgr = freshManager();
    await mgr.initialize('alice');
    await mgr.initialize('alice');
    expect(mockLoadAllInstalledPlugins).toHaveBeenCalledTimes(1);
  });

  it('is marked initialized after first call', async () => {
    const mgr = freshManager();
    expect(mgr.isInitialized()).toBe(false);
    await mgr.initialize('alice');
    expect(mgr.isInitialized()).toBe(true);
  });

  it('activates enabled plugins and registers hooks', async () => {
    const p = makePlugin('hook-plugin', true);
    p.manifest.hooks = { SessionStart: ['echo hi'] };
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');
    expect(mockHookRegistry.registerPluginHooks).toHaveBeenCalledWith(
      'hook-plugin', p.path, 'SessionStart', ['echo hi'],
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: installPlugin
// ---------------------------------------------------------------------------

describe('PluginManager.installPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    mockFs.existsSync = vi.fn().mockReturnValue(false);
    mockFs.mkdirSync = vi.fn();
    mockFs.copyFileSync = vi.fn();
    mockFs.readdirSync = vi.fn().mockReturnValue([]);
  });

  it('returns error if not initialized', async () => {
    const mgr = freshManager();
    const result = await mgr.installPlugin('/some/dir');
    expect(result.error).toMatch(/not initialized/);
  });

  it('returns error if manifest load fails', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');
    mockLoadPluginFromDir.mockReturnValueOnce({ plugin: null, errors: [{ pluginId: 'x', message: 'bad' }] });
    const result = await mgr.installPlugin('/some/dir');
    expect(result.error).toMatch(/bad/);
  });

  it('returns error if plugin is already installed', async () => {
    const p = makePlugin('dup');
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockLoadPluginFromDir.mockReturnValueOnce({ plugin: p, errors: [] });

    const mgr = freshManager();
    await mgr.initialize('alice');
    const result = await mgr.installPlugin('/some/dir');
    expect(result.error).toMatch(/already installed/);
  });

  it('registers and activates plugin on success', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');

    const p = makePlugin('new-plugin');
    mockLoadPluginFromDir
      .mockReturnValueOnce({ plugin: p, errors: [] })  // source validation
      .mockReturnValueOnce({ plugin: p, errors: [] }); // final location
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const result = await mgr.installPlugin('/source/dir');
    expect(result.error).toBeUndefined();
    expect(mgr.getPlugin('new-plugin')).toBeDefined();
    expect(mockAddPluginRecord).toHaveBeenCalled();
  });

  it('cleans up and returns error if final load fails', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');

    const p = makePlugin('fail-plugin');
    mockLoadPluginFromDir
      .mockReturnValueOnce({ plugin: p, errors: [] })
      .mockReturnValueOnce({ plugin: null, errors: [{ pluginId: 'fail-plugin', message: 'corrupt' }] });
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.rmSync = vi.fn();

    const result = await mgr.installPlugin('/source/dir');
    expect(result.error).toMatch(/corrupt/);
    expect(mockFs.rmSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: uninstallPlugin
// ---------------------------------------------------------------------------

describe('PluginManager.uninstallPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync = vi.fn().mockReturnValue(false);
    mockFs.rmSync = vi.fn();
  });

  it('returns error for unknown plugin', async () => {
    const mgr = freshManager();
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    await mgr.initialize('alice');
    const result = await mgr.uninstallPlugin('ghost');
    expect(result.error).toMatch(/not found/);
  });

  it('removes plugin from registry and map', async () => {
    const p = makePlugin('rem');
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);

    const mgr = freshManager();
    await mgr.initialize('alice');
    await mgr.uninstallPlugin('rem');

    expect(mgr.getPlugin('rem')).toBeUndefined();
    expect(mockRemovePluginRecord).toHaveBeenCalledWith('rem');
    expect(mockHookRegistry.unregisterPluginHooks).toHaveBeenCalledWith('rem');
  });
});

// ---------------------------------------------------------------------------
// Tests: enablePlugin / disablePlugin
// ---------------------------------------------------------------------------

describe('PluginManager.enablePlugin / disablePlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enablePlugin returns error for unknown plugin', async () => {
    const mgr = freshManager();
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    await mgr.initialize('alice');
    const result = await mgr.enablePlugin('nope');
    expect(result.error).toMatch(/not found/);
  });

  it('enablePlugin is idempotent when already enabled', async () => {
    const p = makePlugin('p', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    vi.clearAllMocks();
    const result = await mgr.enablePlugin('p');
    expect(result.error).toBeUndefined();
    // Should NOT call activate again
    expect(mockInjectPluginSkills).not.toHaveBeenCalled();
  });

  it('disablePlugin returns error for unknown plugin', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    const mgr = freshManager();
    await mgr.initialize('alice');
    const result = await mgr.disablePlugin('nope');
    expect(result.error).toMatch(/not found/);
  });

  it('disablePlugin deactivates and marks plugin disabled', async () => {
    const p = makePlugin('dis', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockGetPluginRecord.mockReturnValue({ id: 'dis', enabled: true, path: p.path, version: '1.0.0', installedAt: '' });

    const mgr = freshManager();
    await mgr.initialize('alice');
    await mgr.disablePlugin('dis');

    expect(mgr.getPlugin('dis')!.enabled).toBe(false);
    expect(mockHookRegistry.unregisterPluginHooks).toHaveBeenCalledWith('dis');
  });
});

// ---------------------------------------------------------------------------
// Tests: restartPlugin
// ---------------------------------------------------------------------------

describe('PluginManager.restartPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error for unknown plugin', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    const mgr = freshManager();
    await mgr.initialize('alice');
    expect((await mgr.restartPlugin('ghost')).error).toMatch(/not found/);
  });

  it('returns error for disabled plugin', async () => {
    const p = makePlugin('lazy', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });
    const mgr = freshManager();
    await mgr.initialize('alice');
    expect((await mgr.restartPlugin('lazy')).error).toMatch(/not enabled/);
  });

  it('deactivates then re-activates an enabled plugin', async () => {
    const p = makePlugin('restart-me', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    vi.clearAllMocks();
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const result = await mgr.restartPlugin('restart-me');
    expect(result.error).toBeUndefined();
    expect(mockHookRegistry.unregisterPluginHooks).toHaveBeenCalled();
    expect(mockHookRegistry.registerPluginHooks).not.toHaveBeenCalled(); // no hooks in manifest
  });
});

// ---------------------------------------------------------------------------
// Tests: enablePluginForAgent / disablePluginForAgent
// ---------------------------------------------------------------------------

describe('PluginManager.enablePluginForAgent / disablePluginForAgent', () => {
  const userAlias = 'alice';
  const chatId = 'chat-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupWithPlugin(enabled = true) {
    const p = makePlugin('agent-plugin', enabled);
    p.injectedSkills = ['plugin--agent-plugin--greet'];
    p.injectedMcpServers = ['plugin--agent-plugin--server'];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: enabled ? [p] : [], disabled: enabled ? [] : [p], errors: [] });
    if (enabled) {
      mockInjectPluginSkills.mockResolvedValue(p.injectedSkills);
      mockInjectPluginMcpServers.mockResolvedValue(p.injectedMcpServers);
    }
    return p;
  }

  it('enablePluginForAgent returns error for unknown plugin', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    const mgr = freshManager();
    await mgr.initialize(userAlias);
    expect((await mgr.enablePluginForAgent('nope', userAlias, chatId)).error).toMatch(/not found/);
  });

  it('enablePluginForAgent returns error if chat has no agent', async () => {
    setupWithPlugin(true);
    const mgr = freshManager();
    await mgr.initialize(userAlias);

    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: null });
    const result = await mgr.enablePluginForAgent('agent-plugin', userAlias, chatId);
    expect(result.error).toMatch(/no agent/);
  });

  it('enablePluginForAgent adds skills and MCP to agent', async () => {
    setupWithPlugin(true);
    const mgr = freshManager();
    await mgr.initialize(userAlias);

    vi.clearAllMocks();
    mockInjectPluginSkills.mockResolvedValue(['plugin--agent-plugin--greet']);
    mockInjectPluginMcpServers.mockResolvedValue(['plugin--agent-plugin--server']);

    const agent = {
      skills: [],
      mcp_servers: [],
      enabled_plugins: [],
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(true);

    const result = await mgr.enablePluginForAgent('agent-plugin', userAlias, chatId);
    expect(result.error).toBeUndefined();
    expect(mockProfileCacheManager.updateChatAgent).toHaveBeenCalledWith(
      userAlias, chatId,
      expect.objectContaining({
        enabled_plugins: ['agent-plugin'],
      }),
    );
  });

  it('disablePluginForAgent removes skills and MCP from agent', async () => {
    setupWithPlugin(true);
    const mgr = freshManager();
    await mgr.initialize(userAlias);

    const agent = {
      skills: ['plugin--agent-plugin--greet', 'keep-this'],
      mcp_servers: [
        { name: 'plugin--agent-plugin--server', tools: [] },
        { name: 'keep-server', tools: [] },
      ],
      enabled_plugins: ['agent-plugin'],
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(true);

    const result = await mgr.disablePluginForAgent('agent-plugin', userAlias, chatId);
    expect(result.error).toBeUndefined();

    const call = mockProfileCacheManager.updateChatAgent.mock.calls[0];
    expect(call[2].skills).toEqual(['keep-this']);
    expect(call[2].mcp_servers).toEqual([{ name: 'keep-server', tools: [] }]);
    expect(call[2].enabled_plugins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: getPlugins / getEnabledPlugins / getPlugin
// ---------------------------------------------------------------------------

describe('PluginManager query methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getPlugins returns all plugins', async () => {
    const p1 = makePlugin('a', true);
    const p2 = makePlugin('b', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p1], disabled: [p2], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');
    expect(mgr.getPlugins()).toHaveLength(2);
  });

  it('getEnabledPlugins returns only enabled', async () => {
    const p1 = makePlugin('x', true);
    const p2 = makePlugin('y', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p1], disabled: [p2], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');
    const enabled = mgr.getEnabledPlugins();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('x');
  });

  it('getPlugin returns undefined for unknown', async () => {
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    const mgr = freshManager();
    await mgr.initialize('alice');
    expect(mgr.getPlugin('missing')).toBeUndefined();
  });
});
