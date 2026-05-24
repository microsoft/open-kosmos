/**
 * @vitest-environment happy-dom
 */

describe('mcpClientCacheManager auth-interaction state', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        mcp: {
          onServerStatesUpdated: vi.fn(() => vi.fn()),
          getServerStatus: vi.fn(async () => ({ success: true, data: [] })),
        },
      },
    });
  });

  it('emits a connection failure toast event when auth is dismissed', async () => {
    const { mcpClientCacheManager } = await import('../mcpClientCacheManager');
    const listener = vi.fn();
    mcpClientCacheManager.subscribeConnectionFailure(listener);

    (mcpClientCacheManager as any).handleServerStatesUpdate([
      {
        serverName: 'edge-growth-brain',
        status: 'connecting',
        tools: [],
        lastError: null,
      },
    ]);

    (mcpClientCacheManager as any).handleServerStatesUpdate([
      {
        serverName: 'edge-growth-brain',
        status: 'error',
        tools: [],
        lastError: '[MCP_AUTH_CANCELLED] Authentication was canceled for MCP server "edge-growth-brain". Start the sign-in flow again to continue.',
      },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(mcpClientCacheManager.getMCPRuntimeState('edge-growth-brain')?.status).toBe('error');
  });
});