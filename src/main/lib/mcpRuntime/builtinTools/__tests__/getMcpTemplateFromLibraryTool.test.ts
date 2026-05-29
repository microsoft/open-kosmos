import { GetMcpTemplateFromLibraryTool } from '../getMcpTemplateFromLibraryTool';

const mockGetLibraryData = vi.fn();
const mockGetInstance = vi.fn();
const mockGetCachedAliases = vi.fn();
const mockGetCachedProfile = vi.fn();

vi.mock('../../../assetsFetcher/mcpLibraryFetcher', () => ({
  McpLibraryFetcher: {
    getInstance: () => ({
      getLibraryData: mockGetLibraryData,
    }),
  },
}));

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedAliases: (...args: any[]) => mockGetCachedAliases(...args),
    getCachedProfile: (...args: any[]) => mockGetCachedProfile(...args),
  },
}));

vi.mock('../../../unifiedLogger', async () => import('../../../__mocks__/unifiedLogger'));

const baseLibraryData = {
  mcp_servers: [
    {
      name: 'filesystem',
      description: 'Filesystem MCP server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { ROOT_DIR: '/tmp' },
    },
    {
      name: 'github',
      description: 'GitHub MCP server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
  ],
};

describe('GetMcpTemplateFromLibraryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedAliases.mockReturnValue([]);
    mockGetCachedProfile.mockReturnValue(null);
  });

  // ========== getDefinition ==========

  it('getDefinition returns correct schema', () => {
    const def = GetMcpTemplateFromLibraryTool.getDefinition();
    expect(def.name).toBe('get_mcp_template_from_library');
    const props = (def.inputSchema as any).properties;
    expect(props.mcp_name).toBeDefined();
    expect((def.inputSchema as any).required).toContain('mcp_name');
  });

  // ========== Validation ==========

  it('returns failure for empty mcp_name', async () => {
    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: '' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(result.message).toContain('mcp_name is required');
  });

  it('returns failure for whitespace-only mcp_name', async () => {
    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  // ========== Library fetch failure ==========

  it('returns failure when library fetch fails', async () => {
    mockGetLibraryData.mockResolvedValue({ success: false, error: 'Network timeout' });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LIBRARY_FETCH_FAILED');
    expect(result.message).toContain('Network timeout');
  });

  it('returns failure when library fetch returns no data', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: null });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LIBRARY_FETCH_FAILED');
  });

  // ========== Server not found ==========

  it('returns failure when server name not found in library', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SERVER_NOT_FOUND');
    expect(result.message).toContain('"nonexistent" not found');
    expect(result.message).toContain('filesystem');
  });

  // ========== Success without local merge ==========

  it('returns config when server found and no local alias', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });
    mockGetCachedAliases.mockReturnValue([]); // no aliases

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(true);
    expect(result.config?.name).toBe('filesystem');
    expect(result.config?.transport).toBe('stdio');
    expect(result.config?.env).toEqual({ ROOT_DIR: '/tmp' });
  });

  it('returns config for server without env', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'github' });

    expect(result.success).toBe(true);
    expect(result.config?.name).toBe('github');
    expect(result.config?.env).toBeUndefined();
  });

  // ========== Success with local ENV merge ==========

  it('merges local ENV when server is installed locally', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });
    mockGetCachedAliases.mockReturnValue(['alice']);
    mockGetCachedProfile.mockReturnValue({
      mcp_servers: [
        {
          name: 'filesystem',
          env: { ROOT_DIR: '/home/alice/workspace', EXTRA_VAR: 'extra' },
        },
      ],
    });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(true);
    // ROOT_DIR overwritten with local value
    expect(result.config?.env?.ROOT_DIR).toBe('/home/alice/workspace');
    // EXTRA_VAR added from local
    expect(result.config?.env?.EXTRA_VAR).toBe('extra');
  });

  it('uses library ENV as-is when local server has no env', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });
    mockGetCachedAliases.mockReturnValue(['alice']);
    mockGetCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'filesystem', env: {} }],
    });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(true);
    // No merge: library ENV unchanged
    expect(result.config?.env).toEqual({ ROOT_DIR: '/tmp' });
  });

  it('uses local ENV directly when library server has no env', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });
    mockGetCachedAliases.mockReturnValue(['alice']);
    mockGetCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'github', env: { GITHUB_TOKEN: 'my-token' } }],
    });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'github' });

    expect(result.success).toBe(true);
    expect(result.config?.env).toEqual({ GITHUB_TOKEN: 'my-token' });
  });

  it('skips merge when local profile has no matching server', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });
    mockGetCachedAliases.mockReturnValue(['alice']);
    mockGetCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'other-server', env: { FOO: 'bar' } }],
    });

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(true);
    expect(result.config?.env).toEqual({ ROOT_DIR: '/tmp' });
  });

  // ========== getAvailableMcpServers ==========

  it('getAvailableMcpServers returns server names', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: baseLibraryData });

    const names = await GetMcpTemplateFromLibraryTool.getAvailableMcpServers();

    expect(names).toContain('filesystem');
    expect(names).toContain('github');
  });

  it('getAvailableMcpServers returns empty array on fetch failure', async () => {
    mockGetLibraryData.mockResolvedValue({ success: false });

    const names = await GetMcpTemplateFromLibraryTool.getAvailableMcpServers();

    expect(names).toEqual([]);
  });

  it('getAvailableMcpServers returns empty array on exception', async () => {
    mockGetLibraryData.mockRejectedValue(new Error('Network error'));

    const names = await GetMcpTemplateFromLibraryTool.getAvailableMcpServers();

    expect(names).toEqual([]);
  });

  // ========== Error handling ==========

  it('returns failure on unexpected exception in execute', async () => {
    mockGetLibraryData.mockRejectedValue(new Error('Unexpected crash'));

    const result = await GetMcpTemplateFromLibraryTool.execute({ mcp_name: 'filesystem' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('EXECUTION_ERROR');
    expect(result.message).toContain('Unexpected crash');
  });
});
