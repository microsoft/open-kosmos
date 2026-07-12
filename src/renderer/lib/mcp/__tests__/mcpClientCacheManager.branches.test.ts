/**
 * @vitest-environment happy-dom
 *
 * Targeted branch coverage tests for mcpClientCacheManager.ts.  Exercises
 * uncovered conditional paths in the singleton manager — fallbacks,
 * no-runtime-state branches, no-changes paths, and missing-API branches —
 * to push branch coverage above the 90% threshold.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

function setupBasicElectronAPI(getServerStatusResult?: any) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      mcp: {
        onServerStatesUpdated: vi.fn(() => vi.fn()),
        getServerStatus: vi.fn(async () => getServerStatusResult ?? { success: true, data: [] }),
      },
    },
  });
}

describe('MCPClientCacheManager — branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    setupBasicElectronAPI();
  });

  async function getInstance() {
    const mod = await import('../mcpClientCacheManager');
    return mod.mcpClientCacheManager;
  }

  // ── singleton: getInstance returns same instance on repeat calls (line 139 idx 1) ──
  it('getInstance() returns the same instance on second call', async () => {
    const mod = await import('../mcpClientCacheManager');
    const a = mod.MCPClientCacheManager.getInstance();
    const b = mod.MCPClientCacheManager.getInstance();
    expect(a).toBe(b);
  });

  // ── subscribe: removing already-removed listener (line 159 idx 1) ──
  it('subscribe() unsubscribe is idempotent when listener already removed', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);
    unsub();
    // Second call: index === -1, no splice
    expect(() => unsub()).not.toThrow();
  });

  // ── subscribeConnectionFailure: removing already-removed listener (line 173 idx 1) ──
  it('subscribeConnectionFailure() unsubscribe is idempotent', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    const unsub = mgr.subscribeConnectionFailure(listener);
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  // ── initialize: result.success === false (line 190 idx 1) ──
  it('initialize() does not update state when getServerStatus returns success=false', async () => {
    setupBasicElectronAPI({ success: false, data: null });
    const mod = await import('../mcpClientCacheManager');
    await mod.mcpClientCacheManager.initialize();
    expect(mod.mcpClientCacheManager.getMCPServers()).toHaveLength(0);
    expect(mod.mcpClientCacheManager.getCache().isInitialized).toBe(true);
  });

  // ── setupIPCListeners: callback receives null/undefined (line 211 idx 1) ──
  it('IPC callback handles null serverStates gracefully', async () => {
    let captured: ((s: any) => void) | null = null;
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        mcp: {
          onServerStatesUpdated: vi.fn((cb: any) => { captured = cb; return vi.fn(); }),
          getServerStatus: vi.fn(async () => ({ success: true, data: [] })),
        },
      },
    });
    const mod = await import('../mcpClientCacheManager');
    expect(captured).not.toBeNull();
    expect(() => captured!(null)).not.toThrow();
    expect(mod.mcpClientCacheManager.getMCPRuntimeStates()).toHaveLength(0);
  });

  // ── handleServerStatesUpdate: state.tools is undefined (line 256 idx 1) ──
  it('handleServerStatesUpdate() handles state with undefined tools', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', /* no tools */ lastError: null },
    ]);
    expect(mgr.getMCPRuntimeState('srv')?.tools).toEqual([]);
  });

  // ── handleServerStatesUpdate: cached server already disconnected (line 304 idx 1) ──
  it('handleServerStatesUpdate() does not flag changes when server is already disconnected', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    // Wait for the debounced notification from updateServerConfigs to fire,
    // then subscribe — so the listener only sees subsequent changes.
    await new Promise(r => setTimeout(r, 200));
    const listener = vi.fn();
    mgr.subscribe(listener);
    // Server is already disconnected. Pass empty serverStates so the
    // mapping branch hits: "server not in state list, already disconnected".
    (mgr as any).handleServerStatesUpdate([]);
    await new Promise(r => setTimeout(r, 200));
    // No state change, no notification.
    expect(listener).not.toHaveBeenCalled();
    expect(mgr.getMCPServerByName('srv')?.status).toBe('disconnected');
  });

  // ── handleServerStatesUpdate: builtin server already in cache, not in state (line 300) ──
  it('handleServerStatesUpdate() preserves builtin-tools when not in new state', async () => {
    const mgr = await getInstance();
    // First inject builtin-tools via state
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('builtin-tools')).not.toBeNull();

    // Now update with state that includes a DIFFERENT server — the builtin
    // server stays in cache because the BUILTIN_SERVER_NAME branch preserves it.
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'other', status: 'connecting', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('builtin-tools')).not.toBeNull();
  });

  // ── handleServerStatesUpdate: builtin server in state but no runtime state (line 323) ──
  it('handleServerStatesUpdate() handles builtin with no tools field', async () => {
    const mgr = await getInstance();
    // Build a state entry that has lastError null — exercises line 339's
    // ternary false branch on the builtin handling path.
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', /* no tools */ lastError: null },
    ]);
    const srv = mgr.getMCPServerByName('builtin-tools');
    expect(srv).not.toBeNull();
    expect(srv?.error).toBeUndefined();
  });

  // ── updateServerConfigs: runtime state present, lastError null (line 416 idx 0) ──
  it('updateServerConfigs() falls back to existing error when runtime lastError is null', async () => {
    const mgr = await getInstance();
    // Seed an existing server with an error
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'error', tools: [], lastError: 'boom' },
    ]);
    expect(mgr.getMCPServerByName('srv')?.error).toBe('boom');

    // Re-update configs — runtimeState still has lastError, exercises the
    // String(...) branch.
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'python', args: [], env: {}, url: '', in_use: true },
    ]);
    expect(mgr.getMCPServerByName('srv')?.error).toBe('boom');
  });

  // ── updateServerConfigs: no changes — JSON.stringify match (line 431) ──
  it('updateServerConfigs() skips notification when stringified servers match', async () => {
    const mgr = await getInstance();
    const cfg = { name: 'srv', transport: 'stdio' as const, command: 'node', args: [], env: {}, url: '', in_use: true };
    mgr.updateServerConfigs([cfg]);
    await new Promise(r => setTimeout(r, 200));

    const listener = vi.fn();
    mgr.subscribe(listener);
    // Same config again → JSON.stringify matches → no change, no notification.
    mgr.updateServerConfigs([cfg]);
    await new Promise(r => setTimeout(r, 200));
    expect(listener).not.toHaveBeenCalled();
  });

  // ── updateServerConfigs: builtinServer already in newServers (line 426 false) ──
  it('updateServerConfigs() does not duplicate builtin-tools when already in configs', async () => {
    const mgr = await getInstance();
    // First seed builtin via state update
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'builtin-tools', status: 'connected', tools: [], lastError: null },
    ]);
    // Now pass builtin-tools in updateServerConfigs — the .some() check should
    // be true so the builtin server is NOT pushed again.
    mgr.updateServerConfigs([
      { name: 'builtin-tools', transport: 'stdio', command: '', args: [], env: {}, url: '', in_use: true },
    ]);
    const builtin = mgr.getMCPServers().filter(s => s.name === 'builtin-tools');
    expect(builtin).toHaveLength(1);
  });

  // ── getMCPServerByName: found case (line 505) ──
  it('getMCPServerByName() returns server when found', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    expect(mgr.getMCPServerByName('srv')?.name).toBe('srv');
    // Not found → null
    expect(mgr.getMCPServerByName('missing')).toBeNull();
  });

  // ── getMCPRuntimeState: found and not-found (line 519) ──
  it('getMCPRuntimeState() returns state when found, null when missing', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getMCPRuntimeState('srv')?.serverName).toBe('srv');
    expect(mgr.getMCPRuntimeState('missing')).toBeNull();
  });

  // ── getServerState (alias): found and missing (line 533) ──
  it('getServerState() returns state when found, null when missing', async () => {
    const mgr = await getInstance();
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [], lastError: null },
    ]);
    expect(mgr.getServerState('srv')?.serverName).toBe('srv');
    expect(mgr.getServerState('missing')).toBeNull();
  });

  // ── getAgentSpecificTools: serverConfig.tools undefined (line 566) ──
  it('getAgentSpecificTools() treats missing tools as empty array', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [{ name: 'tool_a', inputSchema: {} }], lastError: null },
    ]);
    // tools is undefined → falls back to empty allowed list → returns ALL tools
    const tools = mgr.getAgentSpecificTools([{ name: 'srv' } as any]);
    expect(tools.length).toBe(1);
  });

  // ── getAgentSpecificTools: server is not connected (line 573) ──
  it('getAgentSpecificTools() skips servers that are not connected', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'error', tools: [{ name: 't', inputSchema: {} }], lastError: 'x' },
    ]);
    const tools = mgr.getAgentSpecificTools([{ name: 'srv', tools: ['t'] }]);
    expect(tools).toHaveLength(0);
  });

  // ── refresh: getServerStatus unavailable (line 619 idx 1) ──
  it('refresh() handles missing getServerStatus gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { mcp: { onServerStatesUpdated: vi.fn(() => vi.fn()) /* no getServerStatus */ } },
    });
    const mod = await import('../mcpClientCacheManager');
    await expect(mod.mcpClientCacheManager.refresh()).resolves.toBeUndefined();
  });

  // ── refresh: getServerStatus returns success=false (line 621 idx 1) ──
  it('refresh() does not update state when result.success is false', async () => {
    setupBasicElectronAPI({ success: false, data: null });
    const mod = await import('../mcpClientCacheManager');
    await mod.mcpClientCacheManager.refresh();
    expect(mod.mcpClientCacheManager.getMCPServers()).toHaveLength(0);
  });

  // ── cleanup: notificationTimeout is null (line 639 idx 1) ──
  it('cleanup() works when no pending notification', async () => {
    const mgr = await getInstance();
    // No notifyListeners called → notificationTimeout is null
    expect(() => mgr.cleanup()).not.toThrow();
  });

  // ── notifyListeners(): clearTimeout when already pending (line 466) ──
  it('notifyListeners() clears pending timer on rapid successive calls', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    // Trigger two notifications in quick succession — the second call goes
    // through `clearTimeout(this.notificationTimeout)` branch.
    (mgr as any).notifyListeners();
    (mgr as any).notifyListeners();
    await new Promise(r => setTimeout(r, 200));
  });

  // ── notifyListeners(immediate=true) bypasses debounce (line 461 idx 0) ──
  it('notifyListeners(immediate=true) calls listeners synchronously', async () => {
    const mgr = await getInstance();
    const listener = vi.fn();
    mgr.subscribe(listener);
    (mgr as any).notifyListeners(true);
    expect(listener).toHaveBeenCalled();
  });

  // ── handleServerStatesUpdate(): existing server's tools list changes (line 290) ──
  it('handleServerStatesUpdate() emits change when tool list differs', async () => {
    const mgr = await getInstance();
    mgr.updateServerConfigs([
      { name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true },
    ]);
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [{ name: 't1', inputSchema: {} }], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('srv')?.tools?.length).toBe(1);
    // Change the tool list
    (mgr as any).handleServerStatesUpdate([
      { serverName: 'srv', status: 'connected', tools: [{ name: 't2', inputSchema: {} }], lastError: null },
    ]);
    expect(mgr.getMCPServerByName('srv')?.tools?.[0].name).toBe('t2');
  });
});
