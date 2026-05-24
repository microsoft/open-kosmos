/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

function setupBasicElectronAPI(onServerStatesUpdatedImpl?: (cb: any) => () => void) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      mcp: {
        onServerStatesUpdated: onServerStatesUpdatedImpl ?? vi.fn(() => vi.fn()),
        getServerStatus: vi.fn(async () => ({ success: true, data: [] })),
      },
    },
  });
}

describe('MCPClientCacheManager — comprehensive', () => {
  beforeEach(() => {
    vi.resetModules();
    setupBasicElectronAPI();
  });

  async function getInstance() {
    const mod = await import('../mcpClientCacheManager');
    return mod.mcpClientCacheManager;
  }

  it('getCache() returns initial empty cache', async () => {
    const mgr = await getInstance();
    const cache = mgr.getCache();
    expect(cache.servers).toEqual([]);
    expect(cache.runtimeStates).toEqual([]);
    expect(cache.isInitialized).toBe(false);
  });

  it('subscribe() adds listener and unsubscribe removes it', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    const unsubscribe = mgr.subscribe(listener);
    unsubscribe();
    // After unsubscribe, listener should not be called
    (mgr as any).notifyListeners(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribeConnectionFailure() adds and removes listener', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    const unsub = mgr.subscribeConnectionFailure(listener);
    unsub();
    (mgr as any).notifyConnectionFailure('server', 'error');
    expect(listener).not.toHaveBeenCalled();
  });

  it('initialize() fetches server status and sets isInitialized', async () => {
    const mod = await import('../mcpClientCacheManager');
    await mod.mcpClientCacheManager.initialize();
    expect(mod.mcpClientCacheManager.getCache().isInitialized).toBe(true);
  });

  it('initialize() handles API not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { mcp: {} },
    });
    const mod = await import('../mcpClientCacheManager');
    await expect(mod.mcpClientCacheManager.initialize()).resolves.toBeUndefined();
  });

  it('initialize() handles thrown exception gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        mcp: {
          onServerStatesUpdated: vi.fn(() => vi.fn()),
          getServerStatus: vi.fn(async () => { throw new Error('IPC error'); }),
        },
      },
    });
    const mod = await import('../mcpClientCacheManager');
    await expect(mod.mcpClientCacheManager.initialize()).resolves.toBeUndefined();
  });

  it('handleServerStatesUpdate() ignores invalid input', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate(null);
    (mgr as any).handleServerStatesUpdate('not array');
    expect(mgr.getMCPRuntimeStates()).toHaveLength(0);
  });

  it('handleServerStatesUpdate() maps and stores runtime states', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv1', status: 'connected', tools: [{ name: 'tool1', description: 'T', inputSchema: {} }], lastError: null },
    ]);
    expect(mgr.getMCPRuntimeState('srv1')?.status).toBe('connected');
    expect(mgr.getMCPRuntimeState('srv1')?.tools).toHaveLength(1);
  });

  it('handleServerStatesUpdate() maps unknown status to disconnected', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'bogus-status', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPRuntimeState('srv')?.status).toBe('disconnected');
  });

  it('handleServerStatesUpdate() detects connecting -> error transition', async () => {
    const mgr = await getInstance();
    const failureListener = vi.fn();
    mgr.subscribeConnectionFailure(failureListener);

    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connecting', tools: [], lastError: null },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'error', tools: [], lastError: 'timeout' },
    ]);

    expect(failureListener).toHaveBeenCalledWith('srv', 'timeout');
  });

  it('handleServerStatesUpdate() uses default error message when lastError is null', async () => {
    const mgr = await getInstance();
    const failureListener = vi.fn();
    mgr.subscribeConnectionFailure(failureListener);

    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connecting', tools: [], lastError: null },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'error', tools: [], lastError: null },
    ]);

    expect(failureListener).toHaveBeenCalledWith('srv', 'Connection failed');
  });

  it('handleServerStatesUpdate() does NOT fire failure for non-connecting -> error', async () => {
    const mgr = await getInstance();
    const failureListener = vi.fn();
    mgr.subscribeConnectionFailure(failureListener);

    // Go directly to error without being in connecting first
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'error', tools: [], lastError: 'timeout' },
    ]);

    expect(failureListener).not.toHaveBeenCalled();
  });

  it('updateServerConfigs() builds server list from configs', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv1', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    expect(mgr.getMCPServers()).toHaveLength(1);
    expect(mgr.getMCPServerByName('srv1')).not.toBeNull();
  });

  it('updateServerConfigs() ignores invalid input', async () => {
    const mgr = await getInstance();
    (mgr as any).updateServerConfigs(null);
    (mgr as any).updateServerConfigs('not array');
    expect(mgr.getMCPServers()).toHaveLength(0);
  });

  it('updateServerConfigs() preserves builtin-tools server', async () => {
    const mgr = await getInstance();
    // First inject a builtin server via server states update
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', tools: [], lastError: null },
    ]);

    // Now update configs without the builtin
    mgr.updateServerConfigs([
      { name: 'my-srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);

    const servers = mgr.getMCPServers();
    expect(servers.some(s => s.name === 'builtin-tools')).toBe(true);
  });

  it('updateServerConfigs() inherits runtime state', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv1', status: 'connected', tools: [{ name: 'tool1', inputSchema: {} }], lastError: null },
    ]);

    mgr.updateServerConfigs([
      { name: 'srv1', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);

    const server = mgr.getMCPServerByName('srv1');
    expect(server?.status).toBe('connected');
    expect(server?.tools).toHaveLength(1);
  });

  it('updateServerConfigs() notifies listeners when config changes', async () => {
    const mgr = await getInstance();
    const config = { name: 'srv1', transport: 'stdio' as const, command: 'node', args: [], env: {}, url: '', in_use: true };
    mgr.updateServerConfigs([config]);

    const listener = vi.fn();
    mgr.subscribe(listener);
    // Call again with different config to trigger change
    mgr.updateServerConfigs([{ ...config, command: 'python' }]);
    // Allow debounce
    await new Promise(r => setTimeout(r, 200));
    expect(listener).toHaveBeenCalled();
  });

  it('getAllMCPTools() returns tools from connected servers only', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'connected-srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
      { name: 'disconnected-srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'connected-srv', status: 'connected', tools: [{ name: 'my_tool', inputSchema: {} }], lastError: null },
      { serverName: 'disconnected-srv', status: 'disconnected', tools: [], lastError: null },
    ]);

    const tools = mgr.getAllMCPTools();
    expect(tools.some(t => t.name === 'my_tool')).toBe(true);
    expect(tools.every(t => t.serverId === 'connected-srv')).toBe(true);
  });

  it('getAgentSpecificTools() returns empty for no agent servers', async () => {
    const mgr = await getInstance();
    expect(mgr.getAgentSpecificTools([])).toEqual([]);
  });

  it('getAgentSpecificTools() returns empty when cache has no servers', async () => {
    const mgr = await getInstance();
    expect(mgr.getAgentSpecificTools([{ name: 'srv', tools: [] }])).toEqual([]);
  });

  it('getAgentSpecificTools() filters tools by allowed tool names', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      {
        serverName: 'srv',
        status: 'connected',
        tools: [
          { name: 'tool_a', inputSchema: {} },
          { name: 'tool_b', inputSchema: {} },
        ],
        lastError: null
      },
    ]);

    const tools = mgr.getAgentSpecificTools([{ name: 'srv', tools: ['tool_a'] }]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('tool_a');
  });

  it('getAgentSpecificTools() returns all tools when allowedTools is empty', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      {
        serverName: 'srv',
        status: 'connected',
        tools: [{ name: 'tool_a', inputSchema: {} }, { name: 'tool_b', inputSchema: {} }],
        lastError: null,
      },
    ]);

    const tools = mgr.getAgentSpecificTools([{ name: 'srv', tools: [] }]);
    expect(tools).toHaveLength(2);
  });

  it('getMCPStats() returns correct counts', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv1', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
      { name: 'srv2', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
      { name: 'srv3', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv1', status: 'connected', tools: [], lastError: null },
      { serverName: 'srv2', status: 'disconnected', tools: [], lastError: null },
      { serverName: 'srv3', status: 'error', tools: [], lastError: 'fail' },
    ]);

    const stats = mgr.getMCPStats();
    expect(stats.totalServers).toBe(3);
    expect(stats.connectedServers).toBe(1);
    expect(stats.disconnectedServers).toBe(1);
    expect(stats.errorServers).toBe(1);
    expect(stats.totalTools).toBe(0);
  });

  it('isDataStale() returns true when lastUpdated is 0', async () => {
    const mgr = await getInstance();
    expect(mgr.isDataStale()).toBe(true);
  });

  it('isDataStale() returns false immediately after update', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    // Force different config to trigger timestamp update
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'python', args: [], env: {}, url: '', in_use: true },
    ]);
    expect(mgr.isDataStale(60000)).toBe(false);
  });

  it('refresh() fetches server status from IPC', async () => {
    const mgr = await getInstance();
    await expect(mgr.refresh()).resolves.toBeUndefined();
  });

  it('refresh() handles thrown exception gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        mcp: {
          onServerStatesUpdated: vi.fn(() => vi.fn()),
          getServerStatus: vi.fn(async () => { throw new Error('fail'); }),
        },
      },
    });
    const mod = await import('../mcpClientCacheManager');
    await expect(mod.mcpClientCacheManager.refresh()).resolves.toBeUndefined();
  });

  it('cleanup() resets cache but preserves listeners', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    expect(mgr.getMCPServers()).toHaveLength(1);

    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.cleanup();

    expect(mgr.getMCPServers()).toHaveLength(0);
    expect(mgr.getCache().isInitialized).toBe(false);
    // Listener should still be subscribed (preserved)
    await new Promise(r => setTimeout(r, 200));
    expect(listener).toHaveBeenCalled(); // Called due to notifyListeners in cleanup
  });

  it('getAllServerStates() is alias for getMCPRuntimeStates()', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getAllServerStates()).toEqual(mgr.getMCPRuntimeStates());
  });

  it('getServerState() is alias for getMCPRuntimeState()', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getServerState('srv')).toEqual(mgr.getMCPRuntimeState('srv'));
  });

  it('notifyConnectionFailure() handles listener errors without throwing', async () => {
    const mgr = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('listener error'); });
    mgr.subscribeConnectionFailure(badListener);
    expect(() => (mgr as any).notifyConnectionFailure('srv', 'err')).not.toThrow();
  });

  it('IPC listener auto-updates cache when events arrive', async () => {
    let capturedCallback: ((states: any[]) => void) | null = null;
    setupBasicElectronAPI((cb) => {
      capturedCallback = cb;
      return vi.fn();
    });

    const mod = await import('../mcpClientCacheManager');
    const mgr = mod.mcpClientCacheManager;

    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);

    capturedCallback!([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);

    expect(mgr.getMCPServerByName('srv')?.status).toBe('connected');
  });

  it('handleServerStatesUpdate() marks non-builtin server as disconnected when missing from state', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);

    // First update sets server to connected
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('srv')?.status).toBe('connected');

    // Second update does NOT include srv -> should be marked disconnected
    (mgr as any).handleServerStatesUpdate([]);
    expect(mgr.getMCPServerByName('srv')?.status).toBe('disconnected');
  });

  it('handleServerStatesUpdate() adds builtin-tools server if not in cache', async () => {
    const mgr = await getInstance();
    // No configs registered for builtin-tools
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', tools: [{ name: 'file_read', inputSchema: {} }], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('builtin-tools')).not.toBeNull();
    expect(mgr.getMCPServerByName('builtin-tools')?.in_use).toBe(true);
  });

  it('handleServerStatesUpdate() does not trigger notification when nothing changed', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    mgr.subscribe(listener);

    // Empty update - no servers, no changes
    (mgr as any).handleServerStatesUpdate([]);
    await new Promise(r => setTimeout(r, 200));
    expect(listener).not.toHaveBeenCalled();
  });

  it('performNotification() swallows listener errors', async () => {
    const mgr = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('listener boom'); });
    mgr.subscribe(badListener);

    // Trigger immediate notification
    (mgr as any).notifyListeners(true);
    expect(badListener).toHaveBeenCalled();
    // No unhandled exception
  });

  it('handleServerStatesUpdate() preserves builtin-tools server that IS already in cache', async () => {
    const mgr = await getInstance();
    // First add builtin-tools via server states (so it ends up in cache.servers)
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('builtin-tools')).not.toBeNull();

    // Now fire another update that does NOT include builtin-tools in the state list
    // but builtin-tools IS in cache.servers — line 299 branch: push builtin server as-is
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'other-srv', status: 'connecting', tools: [], lastError: null },
    ]);
    // builtin-tools should still be present
    expect(mgr.getMCPServerByName('builtin-tools')).not.toBeNull();
  });

  it('debounced notifyListeners batches multiple rapid updates', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);

    const listener = vi.fn();
    mgr.subscribe(listener);

    // Fire many updates rapidly
    for (let i = 0; i < 5; i++) {
      (mgr as any).handleServerStatesUpdate([
        { serverName: 'srv', status: i % 2 === 0 ? 'connected' : 'disconnected', tools: [], lastError: null },
      ]);
    }

    await new Promise(r => setTimeout(r, 300));
    // Should be called fewer times than 5 due to debouncing
    expect(listener.mock.calls.length).toBeLessThan(5);
  });
});
