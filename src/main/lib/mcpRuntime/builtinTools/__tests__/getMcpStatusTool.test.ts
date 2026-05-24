import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetMcpServerInfo = vi.fn();
vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    getMcpServerInfo: (...args: unknown[]) => mockGetMcpServerInfo(...args),
  },
}));

// Cannot reference a variable in vi.mock factory (it's hoisted). Use a lazy getter instead.
let _currentUserAlias: string | undefined = 'alice';
vi.mock('../../mcpClientManager', () => ({
  mcpClientManager: {
    get currentUserAlias() { return _currentUserAlias; },
  },
}));

import { GetMcpStatusTool } from '../getMcpStatusTool';

// Helper: build a mock serverInfo response
function serverInfo(config: any, runtime?: any) {
  return { config, runtime };
}

describe('GetMcpStatusTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _currentUserAlias = 'alice';
  });

  describe('getDefinition', () => {
    it('returns a definition with name get_mcp_status', () => {
      const def = GetMcpStatusTool.getDefinition();
      expect(def.name).toBe('get_mcp_status');
      expect(def.inputSchema.required).toContain('mcp_name');
    });
  });

  describe('execute — input validation', () => {
    it('returns failure for empty mcp_name', async () => {
      const result = await GetMcpStatusTool.execute({ mcp_name: '' });
      expect(result.success).toBe(false);
      expect(result.status).toBe('NotAdded');
    });

    it('returns failure for whitespace-only mcp_name', async () => {
      const result = await GetMcpStatusTool.execute({ mcp_name: '   ' });
      expect(result.success).toBe(false);
    });
  });

  describe('execute — no active user', () => {
    it('returns failure when currentUserAlias is undefined', async () => {
      _currentUserAlias = undefined;
      const result = await GetMcpStatusTool.execute({ mcp_name: 'github' });
      expect(result.success).toBe(false);
      expect(result.status).toBe('NotAdded');
    });
  });

  describe('execute — server not in config', () => {
    it('returns NotAdded when config is absent', async () => {
      mockGetMcpServerInfo.mockReturnValue(serverInfo(null));
      const result = await GetMcpStatusTool.execute({ mcp_name: 'unknown-server' });
      expect(result.success).toBe(true);
      expect(result.status).toBe('NotAdded');
    });
  });

  describe('execute — server in config, no runtime', () => {
    it('returns Disconnected when runtime is absent', async () => {
      mockGetMcpServerInfo.mockReturnValue(serverInfo({ in_use: true, transport: 'stdio' }, null));
      const result = await GetMcpStatusTool.execute({ mcp_name: 'my-server' });
      expect(result.success).toBe(true);
      expect(result.status).toBe('Disconnected');
      expect(result.details?.transport).toBe('stdio');
    });
  });

  describe('execute — runtime states', () => {
    const cases: Array<[string, string]> = [
      ['connected', 'Connected'],
      ['connecting', 'Connecting'],
      ['disconnecting', 'Disconnecting'],
      ['disconnected', 'Disconnected'],
      ['error', 'Error'],
      ['needs-user-interaction', 'NeedsUserInteraction'],
      ['something-unknown', 'Disconnected'],
    ];

    for (const [runtimeStatus, expectedStatus] of cases) {
      it(`maps runtime "${runtimeStatus}" → status "${expectedStatus}"`, async () => {
        mockGetMcpServerInfo.mockReturnValue(
          serverInfo(
            { in_use: true, transport: 'stdio' },
            { status: runtimeStatus, tools: [{ name: 'tool1' }] }
          )
        );
        const result = await GetMcpStatusTool.execute({ mcp_name: 'srv' });
        expect(result.success).toBe(true);
        expect(result.status).toBe(expectedStatus);
      });
    }

    it('includes error_message for error status', async () => {
      mockGetMcpServerInfo.mockReturnValue(
        serverInfo(
          { in_use: false, transport: 'sse' },
          { status: 'error', tools: [], lastError: new Error('conn refused') }
        )
      );
      const result = await GetMcpStatusTool.execute({ mcp_name: 'bad-srv' });
      expect(result.details?.error_message).toContain('conn refused');
    });

    it('reports tools_count correctly', async () => {
      mockGetMcpServerInfo.mockReturnValue(
        serverInfo(
          { in_use: true, transport: 'stdio' },
          { status: 'connected', tools: [{ name: 'a' }, { name: 'b' }] }
        )
      );
      const result = await GetMcpStatusTool.execute({ mcp_name: 'srv' });
      expect(result.details?.tools_count).toBe(2);
    });
  });

  describe('execute — error handling', () => {
    it('returns failure when getMcpServerInfo throws', async () => {
      mockGetMcpServerInfo.mockImplementation(() => { throw new Error('db error'); });
      const result = await GetMcpStatusTool.execute({ mcp_name: 'boom' });
      expect(result.success).toBe(false);
      expect(result.status).toBe('NotAdded');
    });
  });
});
