import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockProfileCacheManager = vi.hoisted(() => ({
  executeToolCall: vi.fn().mockResolvedValue({ result: 'ok' }),
  getMcpServerInfo: vi.fn().mockReturnValue({ config: { url: 'http://test' } }),
}));

const mockMcpClientManager = vi.hoisted(() => ({
  refreshBuiltinTools: vi.fn().mockResolvedValue(undefined),
  getAllMcpServerRuntimeStates: vi.fn().mockReturnValue([
    { serverName: 'server1', status: 'connected', tools: [], lastError: null },
  ]),
  getCurrentUserAlias: vi.fn().mockReturnValue('user@example.com'),
  disconnect: vi.fn().mockResolvedValue(undefined),
}));

const mockMcpAuthService = vi.hoisted(() => ({
  clearOAuthForServer: vi.fn().mockResolvedValue(undefined),
}));

const mockMcpAuthPromptRegistry = vi.hoisted(() => ({
  takeConsent: vi.fn().mockReturnValue(null),
  takeClientId: vi.fn().mockReturnValue(null),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
}));

vi.mock('../../lazy', () => ({
  getProfileCacheManager: vi.fn().mockResolvedValue(mockProfileCacheManager),
  getAdvancedLogger: () => mockLogger,
}));

vi.mock('../../../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: mockMcpClientManager,
}));

vi.mock('../../../lib/mcpRuntime/auth/McpAuthService', () => ({
  McpAuthService: {
    getInstance: () => mockMcpAuthService,
  },
}));

vi.mock('../../../lib/mcpRuntime/auth/mcpAuthPromptRegistry', () => ({
  mcpAuthPromptRegistry: mockMcpAuthPromptRegistry,
}));

// ── helpers ────────────────────────────────────────────────────────────────────
function getHandler(channel: string): (...args: any[]) => Promise<any> {
  const call = mockHandle.mock.calls.find(([name]: any[]) => name === channel);
  if (!call) throw new Error(`Handler not registered for channel: ${channel}`);
  return call[1];
}

const mockEvent = {
  sender: { getURL: vi.fn().mockReturnValue('http://localhost') },
};

// ── tests ──────────────────────────────────────────────────────────────────────
describe('startup/ipc/mcp', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: registerMcpIPC } = await import('../mcp');
    registerMcpIPC({} as any);
  });

  // ── mcp:getServerStatus ──────────────────────────────────────────────────────
  describe('mcp:getServerStatus', () => {
    it('returns serialized runtime states', async () => {
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(mockMcpClientManager.refreshBuiltinTools).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: [{ serverName: 'server1', status: 'connected', tools: [], lastError: null }],
      });
    });

    it('serializes lastError.message', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockReturnValueOnce([
        { serverName: 's', status: 'error', tools: [], lastError: new Error('oops') },
      ]);
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result.data[0].lastError).toBe('oops');
    });

    it('returns error on exception', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockImplementationOnce(() => {
        throw new Error('crash');
      });
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'crash' });
    });

    it('returns unknown error string for non-Error throws', async () => {
      mockMcpClientManager.getAllMcpServerRuntimeStates.mockImplementationOnce(() => {
        throw 'string error';
      });
      const handler = getHandler('mcp:getServerStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── mcp:executeTool ──────────────────────────────────────────────────────────
  describe('mcp:executeTool', () => {
    it('returns tool result on success', async () => {
      const handler = getHandler('mcp:executeTool');
      const result = await handler(mockEvent, 'myTool', { arg: 1 });
      expect(result).toEqual({ success: true, data: { result: 'ok' } });
    });

    it('returns error on failure', async () => {
      mockProfileCacheManager.executeToolCall.mockRejectedValueOnce(new Error('tool failed'));
      const handler = getHandler('mcp:executeTool');
      const result = await handler(mockEvent, 'myTool', {});
      expect(result).toEqual({ success: false, error: 'tool failed' });
    });

    it('returns unknown error for non-Error failures', async () => {
      mockProfileCacheManager.executeToolCall.mockRejectedValueOnce('tool failed');
      const handler = getHandler('mcp:executeTool');
      const result = await handler(mockEvent, 'myTool', {});
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── mcpAuth:respondConsent ───────────────────────────────────────────────────
  describe('mcpAuth:respondConsent', () => {
    it('returns invalid decision error for unknown decision', async () => {
      const handler = getHandler('mcpAuth:respondConsent');
      const result = await handler(mockEvent, 'req-1', 'invalid-decision');
      expect(result).toEqual({ success: false, error: 'Invalid MCP auth consent decision' });
    });

    it('calls handler when consent handler found', async () => {
      const mockConsentHandler = vi.fn();
      mockMcpAuthPromptRegistry.takeConsent.mockReturnValueOnce(mockConsentHandler);
      const handler = getHandler('mcpAuth:respondConsent');
      const result = await handler(mockEvent, 'req-1', 'allow-this-time');
      expect(mockConsentHandler).toHaveBeenCalledWith('allow-this-time');
      expect(result).toEqual({ success: true });
    });

    it('returns error when no pending handler', async () => {
      mockMcpAuthPromptRegistry.takeConsent.mockReturnValueOnce(null);
      const handler = getHandler('mcpAuth:respondConsent');
      const result = await handler(mockEvent, 'req-1', 'cancel');
      expect(result).toEqual({ success: false, error: 'No pending MCP auth consent request' });
    });

    it('accepts cancel decision', async () => {
      const mockConsentHandler = vi.fn();
      mockMcpAuthPromptRegistry.takeConsent.mockReturnValueOnce(mockConsentHandler);
      const handler = getHandler('mcpAuth:respondConsent');
      const result = await handler(mockEvent, 'req-1', 'cancel');
      expect(result).toEqual({ success: true });
    });
  });

  // ── mcpAuth:respondClientId ──────────────────────────────────────────────────
  describe('mcpAuth:respondClientId', () => {
    it('returns invalid response error for null response', async () => {
      const handler = getHandler('mcpAuth:respondClientId');
      const result = await handler(mockEvent, 'req-2', null);
      expect(result).toEqual({ success: false, error: 'Invalid MCP auth client-id response' });
    });

    it('returns invalid error for empty clientId', async () => {
      const handler = getHandler('mcpAuth:respondClientId');
      const result = await handler(mockEvent, 'req-2', { clientId: '   ' });
      expect(result).toEqual({ success: false, error: 'Invalid MCP auth client-id response' });
    });

    it('calls handler on cancel', async () => {
      const mockClientIdHandler = vi.fn();
      mockMcpAuthPromptRegistry.takeClientId.mockReturnValueOnce(mockClientIdHandler);
      const handler = getHandler('mcpAuth:respondClientId');
      const response = { cancelled: true } as const;
      const result = await handler(mockEvent, 'req-2', response);
      expect(mockClientIdHandler).toHaveBeenCalledWith(response);
      expect(result).toEqual({ success: true });
    });

    it('calls handler on provide clientId', async () => {
      const mockClientIdHandler = vi.fn();
      mockMcpAuthPromptRegistry.takeClientId.mockReturnValueOnce(mockClientIdHandler);
      const handler = getHandler('mcpAuth:respondClientId');
      const response = { clientId: 'my-client-id' };
      const result = await handler(mockEvent, 'req-2', response);
      expect(mockClientIdHandler).toHaveBeenCalledWith(response);
      expect(result).toEqual({ success: true });
    });

    it('returns error when no pending handler', async () => {
      mockMcpAuthPromptRegistry.takeClientId.mockReturnValueOnce(null);
      const handler = getHandler('mcpAuth:respondClientId');
      const result = await handler(mockEvent, 'req-2', { clientId: 'cid' });
      expect(result).toEqual({ success: false, error: 'No pending MCP auth client-id request' });
    });

    it('logs safely when the sender has no URL accessor', async () => {
      const mockClientIdHandler = vi.fn();
      mockMcpAuthPromptRegistry.takeClientId.mockReturnValueOnce(mockClientIdHandler);
      const handler = getHandler('mcpAuth:respondClientId');
      const response = { clientId: 'cid' };

      await expect(handler({ sender: {} }, 'req-2', response)).resolves.toEqual({ success: true });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        'mcpAuth:respondClientId',
        expect.objectContaining({ senderUrl: '' }),
      );
    });
  });

  // ── mcp:resetOAuth ───────────────────────────────────────────────────────────
  describe('mcp:resetOAuth', () => {
    it('returns error when no active alias', async () => {
      mockMcpClientManager.getCurrentUserAlias.mockReturnValueOnce(null);
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1');
      expect(result).toEqual({ success: false, error: 'No active profile' });
    });

    it('returns error when server not found', async () => {
      mockProfileCacheManager.getMcpServerInfo.mockReturnValueOnce(null);
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'missing-server');
      expect(result).toEqual({ success: false, error: 'Server "missing-server" not found' });
    });

    it('returns error when server has no config', async () => {
      mockProfileCacheManager.getMcpServerInfo.mockReturnValueOnce({ config: null });
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1');
      expect(result).toEqual({ success: false, error: 'Server "server1" not found' });
    });

    it('resets OAuth and returns success', async () => {
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1', 'tokens');
      expect(mockMcpAuthService.clearOAuthForServer).toHaveBeenCalledWith(
        'server1',
        { url: 'http://test' },
        'tokens',
      );
      expect(result).toEqual({ success: true });
    });

    it('uses default scope "tokens"', async () => {
      const handler = getHandler('mcp:resetOAuth');
      await handler(mockEvent, 'server1');
      expect(mockMcpAuthService.clearOAuthForServer).toHaveBeenCalledWith(
        'server1',
        { url: 'http://test' },
        'tokens',
      );
    });

    it('continues when disconnect fails', async () => {
      mockMcpClientManager.disconnect.mockRejectedValueOnce(new Error('disconnect failed'));
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1', 'all');
      expect(result).toEqual({ success: true });
    });

    it('returns error when clearOAuth throws', async () => {
      mockMcpAuthService.clearOAuthForServer.mockRejectedValueOnce(new Error('clear failed'));
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1', 'tokens');
      expect(result).toEqual({ success: false, error: 'clear failed' });
    });

    it('normalizes non-Error reset failures', async () => {
      mockMcpAuthService.clearOAuthForServer.mockRejectedValueOnce('clear failed');
      const handler = getHandler('mcp:resetOAuth');
      const result = await handler(mockEvent, 'server1', 'tokens');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });
});
