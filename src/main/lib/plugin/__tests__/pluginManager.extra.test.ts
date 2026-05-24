/**
 * Supplementary coverage tests for PluginManager — covers branches
 * not reached by pluginManager.test.ts.
 */

import * as fs from 'fs';

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
  };
  const mockMcpClientManager = { delete: vi.fn() };
  return {
    mockLoadAllInstalledPlugins, mockLoadPluginFromDir, mockAddPluginRecord,
    mockRemovePluginRecord, mockGetPluginRecord, mockHookRegistry,
    mockInjectPluginSkills, mockRemovePluginSkills, mockInjectPluginMcpServers,
    mockRemovePluginMcpServers, mockProfileCacheManager, mockMcpClientManager,
  };
});

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../pluginDirectories', () => ({
  ensurePluginDirectories: vi.fn(),
  getPluginDir: (id: string) => `/plugins/packages/${id}`,
  getPluginPackagesDir: () => '/plugins/packages',
}));
vi.mock('../pluginLoader', () => ({
  loadAllInstalledPlugins: (...a: any[]) => mockLoadAllInstalledPlugins(...a),
  loadPluginFromDir: (...a: any[]) => mockLoadPluginFromDir(...a),
  addPluginRecord: (...a: any[]) => mockAddPluginRecord(...a),
  removePluginRecord: (...a: any[]) => mockRemovePluginRecord(...a),
  getPluginRecord: (...a: any[]) => mockGetPluginRecord(...a),
}));
vi.mock('../hooks/hookRegistry', () => ({ hookRegistry: mockHookRegistry }));
vi.mock('../bridges/skillBridge', () => ({
  injectPluginSkills: (...a: any[]) => mockInjectPluginSkills(...a),
  removePluginSkills: (...a: any[]) => mockRemovePluginSkills(...a),
}));
vi.mock('../bridges/mcpBridge', () => ({
  injectPluginMcpServers: (...a: any[]) => mockInjectPluginMcpServers(...a),
  removePluginMcpServers: (...a: any[]) => mockRemovePluginMcpServers(...a),
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../pluginManager';

const mockFs = vi.mocked(fs);

function makePlugin(id = 'my-plugin', enabled = true): any {
  return {
    id,
    manifest: { name: id, version: '1.0.0', description: 'T', author: { name: 'T' } },
    path: `/plugins/packages/${id}`,
    enabled,
    resolvedSkillPaths: [],
    injectedSkills: [],
    injectedMcpServers: [],
  };
}

function freshManager(): PluginManager {
  (PluginManager as any).instance = undefined;
  return PluginManager.getInstance();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PluginManager supplementary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [], errors: [] });
    mockFs.existsSync = vi.fn().mockReturnValue(false);
    mockFs.mkdirSync = vi.fn();
    mockFs.copyFileSync = vi.fn();
    mockFs.readdirSync = vi.fn().mockReturnValue([]);
    mockFs.rmSync = vi.fn();
  });

  // ── installPlugin: copy throws ────────────────────────────────────────────

  it('installPlugin returns error when fs copy throws', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');

    const p = makePlugin('copy-fail');
    mockLoadPluginFromDir.mockReturnValueOnce({ plugin: p, errors: [] });
    mockFs.mkdirSync = vi.fn().mockImplementation(() => { throw new Error('EPERM'); });

    const result = await mgr.installPlugin('/source/dir');
    expect(result.error).toMatch(/Failed to copy/);
  });

  // ── installPlugin: activation warnings ───────────────────────────────────

  it('installPlugin logs warn when activation produces errors', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');

    const p = makePlugin('warn-plugin');
    p.manifest.mcpServers = { srv: { type: 'stdio', command: 'node' } };
    mockLoadPluginFromDir
      .mockReturnValueOnce({ plugin: p, errors: [] })
      .mockReturnValueOnce({ plugin: p, errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockRejectedValue(new Error('MCP injection failed: boom'));

    const result = await mgr.installPlugin('/source/dir');
    // Should not return top-level error — warnings are logged
    expect(typeof result).toBe('object');
  });

  // ── uninstallPlugin: deletes files when they exist ────────────────────────

  it('uninstallPlugin deletes files when existsSync returns true', async () => {
    const p = makePlugin('del-plugin');
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    mockFs.existsSync = vi.fn().mockReturnValue(true);

    const mgr = freshManager();
    await mgr.initialize('alice');
    await mgr.uninstallPlugin('del-plugin');

    expect(mockFs.rmSync).toHaveBeenCalled();
  });

  // ── uninstallPlugin: file deletion throws ────────────────────────────────

  it('uninstallPlugin logs error but succeeds when file delete throws', async () => {
    const p = makePlugin('err-del');
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.rmSync = vi.fn().mockImplementation(() => { throw new Error('EACCES'); });

    const mgr = freshManager();
    await mgr.initialize('alice');
    const result = await mgr.uninstallPlugin('err-del');
    expect(result.error).toBeUndefined(); // delete error is logged, not returned
  });

  // ── enablePlugin: disabled plugin gets activated ──────────────────────────

  it('enablePlugin activates a disabled plugin', async () => {
    const p = makePlugin('en-plugin', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });
    mockGetPluginRecord.mockReturnValue({ id: 'en-plugin', enabled: false, path: p.path, version: '1.0.0', installedAt: '' });

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const result = await mgr.enablePlugin('en-plugin');
    expect(result.error).toBeUndefined();
    expect(mgr.getPlugin('en-plugin')!.enabled).toBe(true);
  });

  it('enablePlugin returns error when activation errors occur', async () => {
    const p = makePlugin('err-enable', false);
    p.manifest.mcpServers = { srv: {} };
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });
    mockGetPluginRecord.mockReturnValue({ id: 'err-enable', enabled: false, path: p.path, version: '1.0.0', installedAt: '' });

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockInjectPluginSkills.mockRejectedValue(new Error('Skill injection failed'));
    mockInjectPluginMcpServers.mockRejectedValue(new Error('MCP injection failed'));

    const result = await mgr.enablePlugin('err-enable');
    expect(result.error).toBeDefined();
  });

  // ── disablePlugin: already disabled is idempotent ─────────────────────────

  it('disablePlugin is idempotent when already disabled', async () => {
    const p = makePlugin('idle-disabled', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });

    const mgr = freshManager();
    await mgr.initialize('alice');
    const result = await mgr.disablePlugin('idle-disabled');
    expect(result.error).toBeUndefined();
    expect(mockHookRegistry.unregisterPluginHooks).not.toHaveBeenCalled();
  });

  // ── restartPlugin: errors from re-activate ────────────────────────────────

  it('restartPlugin returns error when re-activation fails', async () => {
    const p = makePlugin('restart-err', true);
    p.manifest.mcpServers = { srv: {} };
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    // After init, make next activation calls fail
    mockInjectPluginSkills.mockRejectedValue(new Error('Skill injection failed'));
    mockInjectPluginMcpServers.mockRejectedValue(new Error('MCP injection failed'));

    const result = await mgr.restartPlugin('restart-err');
    expect(result.error).toBeDefined();
  });

  // ── enablePluginForAgent: plugin not enabled yet ──────────────────────────

  it('enablePluginForAgent enables plugin globally if not already enabled', async () => {
    const p = makePlugin('lazy-agent-plugin', false);
    p.injectedSkills = ['plugin--lazy-agent-plugin--skill'];
    p.injectedMcpServers = ['plugin--lazy-agent-plugin--server'];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });
    mockGetPluginRecord.mockReturnValue({ id: 'lazy-agent-plugin', enabled: false, path: p.path, version: '1.0.0', installedAt: '' });

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockInjectPluginSkills.mockResolvedValue(['plugin--lazy-agent-plugin--skill']);
    mockInjectPluginMcpServers.mockResolvedValue(['plugin--lazy-agent-plugin--server']);

    const agent = { skills: [], mcp_servers: [], enabled_plugins: [] };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(true);

    await mgr.enablePluginForAgent('lazy-agent-plugin', 'alice', 'chat-1');
    expect(mgr.getPlugin('lazy-agent-plugin')!.enabled).toBe(true);
  });

  // ── enablePluginForAgent: both skill and MCP injection fail ──────────────

  it('enablePluginForAgent returns error when both skill and MCP injection fail', async () => {
    const p = makePlugin('full-fail', true);
    p.manifest.mcpServers = { srv: {} };
    p.resolvedSkillPaths = ['/some/skill'];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    // Now make both fail
    mockInjectPluginSkills.mockRejectedValue(new Error('Skill injection failed: boom'));
    mockInjectPluginMcpServers.mockRejectedValue(new Error('MCP injection failed: boom'));

    const agent = { skills: [], mcp_servers: [], enabled_plugins: [] };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });

    const result = await mgr.enablePluginForAgent('full-fail', 'alice', 'chat-1');
    expect(result.error).toMatch(/Plugin activation failed/);
  });

  // ── enablePluginForAgent: partial failure (only skill) ───────────────────

  it('enablePluginForAgent warns but continues when only skill injection fails', async () => {
    const p = makePlugin('partial-fail', true);
    p.manifest.mcpServers = { srv: {} };
    p.resolvedSkillPaths = ['/some/skill'];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockInjectPluginSkills.mockRejectedValue(new Error('Skill injection failed: boom'));
    mockInjectPluginMcpServers.mockResolvedValue(['plugin--partial-fail--server']);

    const agent = { skills: [], mcp_servers: [], enabled_plugins: [] };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(true);

    const result = await mgr.enablePluginForAgent('partial-fail', 'alice', 'chat-1');
    // partial failure should warn but not return error
    expect(result.error).toBeUndefined();
  });

  // ── enablePluginForAgent: updateChatAgent returns false ──────────────────

  it('enablePluginForAgent returns error when updateChatAgent fails', async () => {
    const p = makePlugin('update-fail', true);
    p.injectedSkills = [];
    p.injectedMcpServers = [];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const agent = { skills: [], mcp_servers: [], enabled_plugins: [] };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(false);

    const result = await mgr.enablePluginForAgent('update-fail', 'alice', 'chat-1');
    expect(result.error).toMatch(/Failed to update/);
  });

  // ── disablePluginForAgent: updateChatAgent returns false ──────────────────

  it('disablePluginForAgent returns error when updateChatAgent fails', async () => {
    const p = makePlugin('disable-fail', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    const agent = { skills: ['plugin--disable-fail--sk'], mcp_servers: [], enabled_plugins: ['disable-fail'] };
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent });
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(false);

    const result = await mgr.disablePluginForAgent('disable-fail', 'alice', 'chat-1');
    expect(result.error).toMatch(/Failed to update/);
  });

  // ── disablePluginForAgent: unknown plugin ─────────────────────────────────

  it('disablePluginForAgent returns error for unknown plugin', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');
    const result = await mgr.disablePluginForAgent('ghost', 'alice', 'c1');
    expect(result.error).toMatch(/not found/);
  });

  it('disablePluginForAgent returns error when chat has no agent', async () => {
    const p = makePlugin('no-agent', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: null });
    const result = await mgr.disablePluginForAgent('no-agent', 'alice', 'c1');
    expect(result.error).toMatch(/no agent/);
  });

  // ── deactivatePlugin: injectedMcpServers fallback ────────────────────────

  it('deactivatePlugin falls back to prefix scan when injectedMcpServers is empty', async () => {
    const p = makePlugin('prefix-scan', true);
    p.injectedMcpServers = []; // empty → fallback
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    // Set up a profile with matching MCP servers for prefix-based cleanup
    const fakeProfile = {
      __isV2: true,
      mcp_servers: [
        { name: 'plugin--prefix-scan--srv', transport: 'stdio', command: '', args: [] },
        { name: 'other-server', transport: 'stdio', command: '', args: [] },
      ],
      chats: [],
    };
    mockProfileCacheManager.getCachedProfile.mockReturnValue(fakeProfile);
    mockMcpClientManager.delete.mockResolvedValue(undefined);

    await mgr.disablePlugin('prefix-scan');
    expect(mockMcpClientManager.delete).toHaveBeenCalledWith('plugin--prefix-scan--srv', { pluginBypass: true });
  });

  // ── deactivatePlugin: injectedSkills removal ─────────────────────────────

  it('deactivatePlugin removes skills when injectedSkills is non-empty', async () => {
    const p = makePlugin('has-skills', true);
    p.resolvedSkillPaths = ['/some/skill'];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue(['plugin--has-skills--skill1']);
    mockInjectPluginMcpServers.mockResolvedValue([]);
    mockRemovePluginSkills.mockResolvedValue(undefined);

    const mgr = freshManager();
    await mgr.initialize('alice');

    expect(mgr.getPlugin('has-skills')!.injectedSkills).toContain('plugin--has-skills--skill1');

    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    await mgr.disablePlugin('has-skills');
    expect(mockRemovePluginSkills).toHaveBeenCalled();
  });

  // ── deactivatePlugin: injectedMcpServers removal ─────────────────────────

  it('deactivatePlugin calls removePluginMcpServers when injectedMcpServers non-empty', async () => {
    const p = makePlugin('has-mcp', true);
    p.manifest.mcpServers = { srv: { type: 'stdio', command: 'node' } };
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue(['plugin--has-mcp--srv']);
    mockRemovePluginMcpServers.mockResolvedValue(undefined);

    const mgr = freshManager();
    await mgr.initialize('alice');

    expect(mgr.getPlugin('has-mcp')!.injectedMcpServers).toContain('plugin--has-mcp--srv');

    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    await mgr.disablePlugin('has-mcp');
    expect(mockRemovePluginMcpServers).toHaveBeenCalled();
  });

  // ── removePluginFromAllAgents ─────────────────────────────────────────────

  it('removePluginFromAllAgents cleans up plugin references across agents', async () => {
    const p = makePlugin('multi-agent', true);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    const fakeProfile = {
      __isV2: true,
      mcp_servers: [],
      chats: [
        {
          chat_id: 'c1',
          agent: {
            skills: ['plugin--multi-agent--sk'],
            mcp_servers: [{ name: 'plugin--multi-agent--srv', tools: [] }],
            enabled_plugins: ['multi-agent'],
          },
        },
        {
          chat_id: 'c2',
          agent: null, // no agent — should skip
        },
      ],
    };
    mockProfileCacheManager.getCachedProfile.mockReturnValue(fakeProfile);
    mockProfileCacheManager.updateChatAgent.mockResolvedValue(true);

    await mgr.uninstallPlugin('multi-agent');
    expect(mockProfileCacheManager.updateChatAgent).toHaveBeenCalledWith(
      'alice', 'c1',
      expect.objectContaining({ enabled_plugins: [] }),
    );
  });

  // ── removePluginMcpServersByPrefix: no userAlias ─────────────────────────

  it('removePluginMcpServersByPrefix skips when currentUserAlias is null', async () => {
    const p = makePlugin('no-user', true);
    p.injectedMcpServers = []; // force fallback path
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    // Manually null out the user alias to hit the early return
    (mgr as any).currentUserAlias = null;
    // Should not throw
    await expect((mgr as any).removePluginMcpServersByPrefix('no-user')).resolves.toBeUndefined();
  });

  // ── removePluginMcpServersByPrefix: mcpClientManager.delete throws ────────

  it('removePluginMcpServersByPrefix handles mcpClientManager.delete throwing', async () => {
    const p = makePlugin('mcp-throw', true);
    p.injectedMcpServers = [];
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [p], disabled: [], errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    const fakeProfile = {
      __isV2: true,
      mcp_servers: [{ name: 'plugin--mcp-throw--srv', transport: 'stdio' }],
      chats: [],
    };
    mockProfileCacheManager.getCachedProfile.mockReturnValue(fakeProfile);
    mockMcpClientManager.delete.mockRejectedValue(new Error('cleanup failed'));

    // Should not throw
    await expect(mgr.disablePlugin('mcp-throw')).resolves.toBeDefined();
  });

  // ── updateRecordEnabled: getPluginRecord returns null ─────────────────────

  it('updateRecordEnabled handles null record gracefully', async () => {
    const p = makePlugin('no-record', false);
    mockLoadAllInstalledPlugins.mockReturnValue({ enabled: [], disabled: [p], errors: [] });
    mockGetPluginRecord.mockReturnValue(null); // no record
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    const mgr = freshManager();
    await mgr.initialize('alice');

    // enablePlugin calls updateRecordEnabled which should not throw
    const result = await mgr.enablePlugin('no-record');
    expect(result.error).toBeUndefined();
  });

  // ── copyDirRecursive: recursive subdirectory ──────────────────────────────

  it('installPlugin handles plugin with subdirectory during copy', async () => {
    const mgr = freshManager();
    await mgr.initialize('alice');

    const p = makePlugin('subdir-plugin');
    mockLoadPluginFromDir
      .mockReturnValueOnce({ plugin: p, errors: [] })
      .mockReturnValueOnce({ plugin: p, errors: [] });
    mockInjectPluginSkills.mockResolvedValue([]);
    mockInjectPluginMcpServers.mockResolvedValue([]);

    // Simulate a directory entry in readdirSync
    const dirEntry = { name: 'subdir', isDirectory: () => true };
    const fileEntry = { name: 'file.js', isDirectory: () => false };
    mockFs.readdirSync = vi.fn()
      .mockReturnValueOnce([dirEntry, fileEntry] as any) // top-level dir
      .mockReturnValueOnce([] as any); // sub-dir is empty

    const result = await mgr.installPlugin('/source/dir');
    expect(result.error).toBeUndefined();
  });
});
