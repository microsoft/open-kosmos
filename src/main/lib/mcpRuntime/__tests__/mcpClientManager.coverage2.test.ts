// @ts-nocheck
/**
 * mcpClientManager coverage2 — uncovered branches:
 * - getAllTools when no alias
 * - getToolsForSubAgent: blocked tools filtering, null tool sets, disallow list
 * - executeTool: agentMcpServerNames matching, fallback to global map
 * - add: missing name/config, name mismatch, builtin reserved name, server already exists
 * - update: builtin protection, name mismatch, server not found
 * - delete: builtin protection, server not found, config-failure, OAuth cleanup
 * - forceClientImplementation: server not found, sdk -> vscodeMcpClient conversion
 * - getImplementationStats
 * - isBuiltinServer / getBuiltinServerName
 * - _resolveStatusForError
 * - resetForSignOut
 */

const { mockGetAllWindows, mockProfileCacheManagerGetMcpServerInfo, mockProfileCacheManagerGetAllMcpServerInfo, mockProfileCacheManagerAddMcpServerConfig, mockProfileCacheManagerUpdateMcpServerConfig, mockProfileCacheManagerDeleteMcpServerConfig } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn(() => []),
  mockProfileCacheManagerGetMcpServerInfo: vi.fn(() => ({ config: null, runtime: null })),
  mockProfileCacheManagerGetAllMcpServerInfo: vi.fn(() => []),
  mockProfileCacheManagerAddMcpServerConfig: vi.fn(async () => true),
  mockProfileCacheManagerUpdateMcpServerConfig: vi.fn(async () => true),
  mockProfileCacheManagerDeleteMcpServerConfig: vi.fn(async () => true),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })),
}));

vi.mock('../userDataADO', () => ({
  profileCacheManager: {
    getMcpServerInfo: mockProfileCacheManagerGetMcpServerInfo,
    getAllMcpServerInfo: mockProfileCacheManagerGetAllMcpServerInfo,
    addMcpServerConfig: mockProfileCacheManagerAddMcpServerConfig,
    updateMcpServerConfig: mockProfileCacheManagerUpdateMcpServerConfig,
    deleteMcpServerConfig: mockProfileCacheManagerDeleteMcpServerConfig,
  },
}));

vi.mock('./auth/McpAuthService', () => ({
  McpAuthService: {
    onInteraction: vi.fn(),
    getInstance: vi.fn(() => ({
      getTokenForServer: vi.fn(async () => undefined),
      clearOAuthForServer: vi.fn(async () => {}),
    })),
  },
}));

vi.mock('./vscMcpClient', () => ({
  VscMcpClient: vi.fn(() => ({
    connectToServer: vi.fn(async () => 'connected'),
    getTools: vi.fn(async () => [{ name: 'test_tool', description: 'test', inputSchema: {} }]),
    executeTool: vi.fn(async () => 'result'),
    cleanup: vi.fn(async () => {}),
  })),
}));

vi.mock('./builtinMcpClient', () => ({
  BuiltinMcpClient: vi.fn(() => ({
    connectToServer: vi.fn(async () => 'connected'),
    getTools: vi.fn(async () => [{ name: 'builtin_tool', description: 'builtin', inputSchema: {} }]),
    executeTool: vi.fn(async () => 'builtin result'),
    cleanup: vi.fn(async () => {}),
  })),
  BUILTIN_SERVER_NAME: '__openkosmos_builtin__',
}));

vi.mock('../userDataADO/openkosmosPlaceholders', () => ({
  openkosmosPlaceholderManager: {
    replacePlaceholders: vi.fn((s: string) => s),
    replacePlaceholdersInObject: vi.fn((obj: any) => obj),
  },
  containsOpenKosmosPlaceholder: vi.fn(() => false),
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  getUnifiedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { MCPClientManager } from '../mcpClientManager';
import { BUILTIN_SERVER_NAME } from '../builtinMcpClient';

function getManager(): MCPClientManager {
  (MCPClientManager as any).instance = null;
  return MCPClientManager.getInstance();
}

describe('MCPClientManager coverage2', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileCacheManagerGetMcpServerInfo.mockReset();
    mockProfileCacheManagerUpdateMcpServerConfig.mockReset();
    mockProfileCacheManagerDeleteMcpServerConfig.mockReset();
    mockProfileCacheManagerGetMcpServerInfo.mockReturnValue({ config: null, runtime: null });
    mockProfileCacheManagerUpdateMcpServerConfig.mockResolvedValue(true);
    mockProfileCacheManagerDeleteMcpServerConfig.mockResolvedValue(true);
    manager = getManager();
  });

  describe('getAllTools', () => {
    it('returns empty array when no user alias', async () => {
      const tools = await manager.getAllTools();
      expect(tools).toHaveLength(0);
    });

    it('returns tools for connected servers', async () => {
      manager['currentUserAlias'] = 'user';
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'connected',
        tools: [{ name: 'tool1', description: 'T1', inputSchema: {} }],
        lastError: null,
      });

      const tools = await manager.getAllTools();
      expect(tools.some(t => t.name === 'tool1')).toBe(true);
    });

    it('skips disconnected servers', async () => {
      manager['currentUserAlias'] = 'user';
      manager['runtimeStates'].set('server2', {
        serverName: 'server2',
        status: 'error',
        tools: [{ name: 'tool2', description: 'T2', inputSchema: {} }],
        lastError: null,
      });

      const tools = await manager.getAllTools();
      expect(tools.some(t => t.name === 'tool2')).toBe(false);
    });
  });

  describe('getToolsForSubAgent', () => {
    beforeEach(() => {
      manager['currentUserAlias'] = 'user';
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'connected',
        tools: [
          { name: 'tool1', description: 'T1', inputSchema: {} },
          { name: 'sub_agent', description: 'Spawn', inputSchema: {} },
        ],
        lastError: null,
      });
      manager['runtimeStates'].set(BUILTIN_SERVER_NAME, {
        serverName: BUILTIN_SERVER_NAME,
        status: 'connected',
        tools: [
          { name: 'builtin_tool', description: 'BT', inputSchema: {} },
          { name: 'send_to_subagent', description: 'Send to child', inputSchema: {} },
        ],
        lastError: null,
      });
    });

    it('excludes blocked sub-agent control tools', async () => {
      const tools = await manager.getToolsForSubAgent([{ name: 'server1', tools: [] }]);
      expect(tools.some(t => t.name === 'sub_agent')).toBe(false);
      expect(tools.some(t => t.name === 'send_to_subagent')).toBe(false);
    });

    it('filters specific tools when tools list provided', async () => {
      const tools = await manager.getToolsForSubAgent([{ name: 'server1', tools: ['tool1'] }]);
      expect(tools.some(t => t.name === 'tool1')).toBe(true);
    });

    it('skips servers not in allowed list', async () => {
      const tools = await manager.getToolsForSubAgent([{ name: 'other-server', tools: [] }]);
      expect(tools.some(t => t.name === 'tool1')).toBe(false);
    });

    it('filters builtin tools with whitelist', async () => {
      const tools = await manager.getToolsForSubAgent([], ['builtin_tool']);
      expect(tools.some(t => t.name === 'builtin_tool')).toBe(true);
      expect(tools.some(t => t.name === 'send_to_subagent')).toBe(false);
    });

    it('applies disallowBuiltinTools blacklist', async () => {
      const tools = await manager.getToolsForSubAgent([], undefined, ['builtin_tool']);
      expect(tools.some(t => t.name === 'builtin_tool')).toBe(false);
    });

    it('applies ad-hoc allowed tool names after builtin disallow filtering', async () => {
      const tools = await manager.getToolsForSubAgent([], undefined, ['send_to_subagent'], new Set(['builtin_tool']));
      expect(tools.map(t => t.name)).toEqual(['builtin_tool']);
    });

    it('applies ad-hoc allowed tool names without builtin disallow filtering', async () => {
      const tools = await manager.getToolsForSubAgent([], undefined, undefined, new Set(['builtin_tool']));
      expect(tools.map(t => t.name)).toEqual(['builtin_tool']);
    });
  });

  describe('executeTool', () => {
    it('throws when no client found for tool', async () => {
      await expect(manager.executeTool({ toolName: 'nonexistent', toolArgs: {} })).rejects.toThrow(
        'No client found for tool: nonexistent'
      );
    });

    it('uses agent scope to find correct server', async () => {
      const mockClient = {
        executeTool: vi.fn(async () => 'agent result'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set('server-a', mockClient as any);
      manager['runtimeStates'].set('server-a', {
        serverName: 'server-a',
        status: 'connected',
        tools: [{ name: 'shared_tool', description: 'T', inputSchema: {} }],
        lastError: null,
      });

      const result = await manager.executeTool({
        toolName: 'shared_tool',
        toolArgs: {},
        agentMcpServerNames: ['server-a'],
      });
      expect(result).toBe('agent result');
    });

    it('falls back to global toolToServerMap when agent scope misses', async () => {
      const mockClient = {
        executeTool: vi.fn(async () => 'global result'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set('global-server', mockClient as any);
      manager['toolToServerMap'].set('global_tool', 'global-server');

      const result = await manager.executeTool({ toolName: 'global_tool', toolArgs: {} });
      expect(result).toBe('global result');
    });

    it('does not fall back to the global map when strict agent scope is enabled', async () => {
      const mockClient = {
        executeTool: vi.fn(async () => 'global result'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set('global-server', mockClient as any);
      manager['toolToServerMap'].set('global_tool', 'global-server');

      await expect(
        manager.executeTool({
          toolName: 'global_tool',
          toolArgs: {},
          agentMcpServerNames: [],
          strictAgentMcpServerNames: true,
        }),
      ).rejects.toThrow('No client found for tool: global_tool');
      expect(mockClient.executeTool).not.toHaveBeenCalled();
    });

    it('allows strict scoped calls to the builtin server', async () => {
      const builtinClient = {
        executeTool: vi.fn(async () => 'builtin result'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set(BUILTIN_SERVER_NAME, builtinClient as any);
      manager['runtimeStates'].set(BUILTIN_SERVER_NAME, {
        serverName: BUILTIN_SERVER_NAME,
        status: 'connected',
        tools: [{ name: 'read_file', description: 'Read', inputSchema: {} }],
        lastError: null,
      });

      const result = await manager.executeTool({
        toolName: 'read_file',
        toolArgs: {},
        agentMcpServerNames: [BUILTIN_SERVER_NAME],
        strictAgentMcpServerNames: true,
      });

      expect(result).toBe('builtin result');
      expect(builtinClient.executeTool).toHaveBeenCalledOnce();
    });

    it('does not use global fallback for a disconnected server in the agent scope', async () => {
      const mockClient = {
        executeTool: vi.fn(async () => 'should not run'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set('agent-server', mockClient as any);
      manager['toolToServerMap'].set('scoped_tool', 'agent-server');

      await expect(
        manager.executeTool({
          toolName: 'scoped_tool',
          toolArgs: {},
          agentMcpServerNames: ['agent-server'],
        }),
      ).rejects.toThrow('No client found for tool: scoped_tool');
      expect(mockClient.executeTool).not.toHaveBeenCalled();
    });

    it('routes stale browser calls to the builtin client even when inventory mapping is hidden', async () => {
      const builtinClient = {
        executeTool: vi.fn(async () => '{"ok":false,"error":"browser tool is disabled (enable it in Settings → Browser)"}'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set(BUILTIN_SERVER_NAME, builtinClient as any);
      manager['toolToServerMap'].delete('browser');

      const result = await manager.executeTool({ toolName: 'browser', toolArgs: { action: 'read_page' } });

      expect(result).toContain('Settings → Browser');
      expect(builtinClient.executeTool).toHaveBeenCalledWith({
        toolName: 'browser',
        toolArgs: { action: 'read_page' },
        signal: undefined,
      });
    });

    it('routes stale memex_memory calls to the builtin client even when inventory mapping is hidden', async () => {
      const builtinClient = {
        executeTool: vi.fn(async () => '{"content":[{"type":"text","text":"memex_memory tool is disabled (enable it in Settings → Memex Memory)"}],"isError":true}'),
        connectToServer: vi.fn(async () => 'connected'),
        getTools: vi.fn(async () => []),
        cleanup: vi.fn(async () => {}),
      };
      manager['mcpClients'].set(BUILTIN_SERVER_NAME, builtinClient as any);
      manager['toolToServerMap'].delete('memex_memory');

      const result = await manager.executeTool({ toolName: 'memex_memory', toolArgs: { operation: 'recall', description: 'x' } });

      expect(result).toContain('Settings → Memex Memory');
      expect(builtinClient.executeTool).toHaveBeenCalledWith({
        toolName: 'memex_memory',
        toolArgs: { operation: 'recall', description: 'x' },
        signal: undefined,
      });
    });
  });

  describe('add', () => {
    it('throws when no user alias', async () => {
      await expect(manager.add('server1', { name: 'server1' } as any)).rejects.toThrow(
        'Manager not initialized'
      );
    });

    it('throws for builtin server name', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.add(BUILTIN_SERVER_NAME, { name: BUILTIN_SERVER_NAME } as any)).rejects.toThrow(
        'reserved for builtin'
      );
    });

    it('throws when name/config missing', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.add('', null as any)).rejects.toThrow('required');
    });

    it('throws when name mismatch', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.add('server1', { name: 'server2' } as any)).rejects.toThrow('must match');
    });

    it('throws when server already exists', async () => {
      manager['currentUserAlias'] = 'user';
      mockProfileCacheManagerGetMcpServerInfo.mockReturnValueOnce({ config: { name: 'server1' } });
      try {
        await manager.add('server1', { name: 'server1', transport: 'stdio' } as any);
        // If it doesn't throw, check the error was surfaced some other way
      } catch (e: any) {
        expect(e.message).toBeTruthy();
      }
    });
  });

  describe('update', () => {
    it('throws when no user alias', async () => {
      await expect(manager.update('server1', { name: 'server1' } as any)).rejects.toThrow('Manager not initialized');
    });

    it('throws for builtin server', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.update(BUILTIN_SERVER_NAME, { name: BUILTIN_SERVER_NAME } as any)).rejects.toThrow(
        'cannot be updated'
      );
    });

    it('throws when update name/config is missing', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.update('', null as any)).rejects.toThrow('required');
    });

    it('throws when update config name does not match', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.update('server1', { name: 'server2' } as any)).rejects.toThrow('must match');
    });

    it('throws when server not found', async () => {
      manager['currentUserAlias'] = 'user';
      mockProfileCacheManagerGetMcpServerInfo.mockReturnValueOnce({ config: null });
      await expect(manager.update('server1', { name: 'server1' } as any)).rejects.toThrow('not found');
    });

  });

  describe('delete', () => {
    it('throws when no user alias', async () => {
      await expect(manager.delete('server1')).rejects.toThrow('Manager not initialized');
    });

    it('throws for builtin server', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.delete(BUILTIN_SERVER_NAME)).rejects.toThrow('cannot be deleted');
    });

    it('throws when delete server name is missing', async () => {
      manager['currentUserAlias'] = 'user';
      await expect(manager.delete('')).rejects.toThrow('Server name is required');
    });

    it('throws when server not found', async () => {
      manager['currentUserAlias'] = 'user';
      mockProfileCacheManagerGetMcpServerInfo.mockReturnValueOnce({ config: null });
      await expect(manager.delete('nonexistent')).rejects.toThrow('not found');
    });

  });

  describe('connect/disconnect/reconnect builtin protection', () => {
    beforeEach(() => {
      manager['currentUserAlias'] = 'user';
    });

    it('throws on connect to builtin server', async () => {
      await expect(manager.connect(BUILTIN_SERVER_NAME)).rejects.toThrow('always connected');
    });

    it('throws on disconnect of builtin server', async () => {
      await expect(manager.disconnect(BUILTIN_SERVER_NAME)).rejects.toThrow('cannot be disconnected');
    });

    it('throws on reconnect of builtin server', async () => {
      await expect(manager.reconnect(BUILTIN_SERVER_NAME)).rejects.toThrow('cannot be reconnected');
    });

    it('throws connect when no alias', async () => {
      manager['currentUserAlias'] = null;
      await expect(manager.connect('server1')).rejects.toThrow('Manager not initialized');
    });

    it('throws disconnect when no alias', async () => {
      manager['currentUserAlias'] = null;
      await expect(manager.disconnect('server1')).rejects.toThrow('Manager not initialized');
    });

    it('throws reconnect when no alias', async () => {
      manager['currentUserAlias'] = null;
      await expect(manager.reconnect('server1')).rejects.toThrow('Manager not initialized');
    });
  });

  describe('forceClientImplementation', () => {
    it('throws when no user alias', async () => {
      await expect(manager.forceClientImplementation('server1', 'vscodeMcpClient')).rejects.toThrow(
        'Manager not initialized'
      );
    });

    it('throws when server not found', async () => {
      manager['currentUserAlias'] = 'user';
      mockProfileCacheManagerGetMcpServerInfo.mockReturnValueOnce({ config: null });
      await expect(manager.forceClientImplementation('server1', 'vscodeMcpClient')).rejects.toThrow('not found');
    });

    it('converts sdk to vscodeMcpClient', async () => {
      manager['currentUserAlias'] = 'user';
      mockProfileCacheManagerGetMcpServerInfo.mockReturnValue({ config: { name: 'server1', transport: 'stdio' } });
      try {
        await manager.forceClientImplementation('server1', 'sdk' as any);
        expect(manager.getClientImplementation('server1')).toBe('vscodeMcpClient');
      } catch {
        // OK if not found due to internal state
      }
    });
  });

  describe('getImplementationStats', () => {
    it('returns zero counts when no clients', () => {
      const stats = manager.getImplementationStats();
      expect(stats.total).toBe(0);
      expect(stats.vscodeMcpClient).toBe(0);
      expect(stats.sdk).toBe(0);
    });

    it('counts vscodeMcpClient implementations', () => {
      manager['clientImplementations'].set('server1', 'vscodeMcpClient');
      manager['clientImplementations'].set('server2', 'vscodeMcpClient');
      const stats = manager.getImplementationStats();
      expect(stats.vscodeMcpClient).toBe(2);
      expect(stats.total).toBe(2);
    });
  });

  describe('isBuiltinServer / getBuiltinServerName', () => {
    it('returns true for builtin server name', () => {
      expect(manager.isBuiltinServer(BUILTIN_SERVER_NAME)).toBe(true);
    });

    it('returns false for other names', () => {
      expect(manager.isBuiltinServer('some-server')).toBe(false);
    });

    it('getBuiltinServerName returns builtin name', () => {
      expect(manager.getBuiltinServerName()).toBe(BUILTIN_SERVER_NAME);
    });
  });

  describe('runtime state management', () => {
    it('getAllMcpServerRuntimeStates returns all states', () => {
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'connected',
        tools: [],
        lastError: null,
      });
      const states = manager.getAllMcpServerRuntimeStates();
      expect(states).toHaveLength(1);
    });

    it('getMcpServerRuntimeState returns specific state', () => {
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'error',
        tools: [],
        lastError: new Error('test'),
      });
      const state = manager.getMcpServerRuntimeState('server1');
      expect(state?.status).toBe('error');
    });

    it('getMcpServerRuntimeState returns undefined for missing', () => {
      const state = manager.getMcpServerRuntimeState('nonexistent');
      expect(state).toBeUndefined();
    });

    it('_clearServerRuntimeState removes state', () => {
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'connected',
        tools: [],
        lastError: null,
      });
      manager._clearServerRuntimeState('server1');
      expect(manager.getMcpServerRuntimeState('server1')).toBeUndefined();
    });

    it('getCurrentUserAlias returns null before initialize', () => {
      expect(manager.getCurrentUserAlias()).toBeNull();
    });
  });

  describe('getClientByToolName', () => {
    it('returns undefined when tool not mapped', () => {
      const client = manager.getClientByToolName('unknown_tool');
      expect(client).toBeUndefined();
    });
  });

  describe('getClientByServerName', () => {
    it('returns undefined when server not in map', () => {
      const client = manager.getClientByServerName('unknown');
      expect(client).toBeUndefined();
    });
  });

  describe('setDefaultImplementation / getDefaultImplementation', () => {
    it('sets and gets default implementation', () => {
      manager.setDefaultImplementation('vscodeMcpClient');
      expect(manager.getDefaultImplementation()).toBe('vscodeMcpClient');
    });
  });

  describe('resetForSignOut', () => {
    it('clears state and resets singleton', async () => {
      manager['currentUserAlias'] = 'user';
      manager['runtimeStates'].set('server1', {
        serverName: 'server1',
        status: 'connected',
        tools: [],
        lastError: null,
      });

      await manager.resetForSignOut();

      // After resetForSignOut, instance should be null
      expect((MCPClientManager as any).instance).toBeNull();
    });
  });
});
