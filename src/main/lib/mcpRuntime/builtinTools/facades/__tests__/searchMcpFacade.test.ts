/**
 * Unit tests for SearchMcpFacade
 */

vi.mock('../../../../assetsFetcher/mcpLibraryFetcher', () => ({
  McpLibraryFetcher: {
    getInstance: vi.fn().mockReturnValue({
      getLibraryData: vi.fn().mockResolvedValue({
        success: true,
        data: {
          mcp_servers: [
            { name: 'github', description: 'GitHub MCP server', transport: 'stdio', version: '1.0.0' },
            { name: 'brave-search', description: 'Brave web search', transport: 'stdio', version: '1.0.0' },
            { name: 'filesystem', description: 'Local filesystem access', transport: 'stdio', version: '1.0.0' },
          ],
        },
      }),
    }),
  },
}));

vi.mock('../../getMcpStatusTool', () => ({
  GetMcpStatusTool: {
    execute: vi.fn().mockResolvedValue({ success: true, status: 'Connected' }),
  },
}));

vi.mock('../../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    currentUserAlias: 'test-user',
    getCachedProfile: vi.fn().mockReturnValue({
      mcp_servers: [
        { name: 'github', transport: 'stdio', source: 'IN-LIBRARY' },
        { name: 'local-db', transport: 'stdio', source: 'ON-DEVICE' },
      ],
    }),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchMcpFacade } from '../searchMcpFacade';

describe('SearchMcpFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinition()', () => {
    it('returns correct tool name', () => {
      expect(SearchMcpFacade.getDefinition().name).toBe('search_mcp');
    });
  });

  describe('validation', () => {
    it('rejects when neither query nor installed provided', async () => {
      const result = await SearchMcpFacade.execute({});
      expect(result.success).toBe(false);
    });
  });

  describe('query search error cases', () => {
    it('returns error when library fetch returns success=false', async () => {
      const { McpLibraryFetcher } = await import('../../../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValueOnce({
        getLibraryData: vi.fn().mockResolvedValue({ success: false, error: 'network' }),
      } as any);

      const result = await SearchMcpFacade.execute({ query: 'test' });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('LIBRARY_FETCH_FAILED');
    });

    it('returns error when fetcher.getLibraryData throws', async () => {
      const { McpLibraryFetcher } = await import('../../../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValueOnce({
        getLibraryData: vi.fn().mockRejectedValue(new Error('network timeout')),
      } as any);

      const result = await SearchMcpFacade.execute({ query: 'test' });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('SEARCH_ERROR');
    });
  });

  describe('query search', () => {
    it('searches library by name (case insensitive)', async () => {
      const result = await SearchMcpFacade.execute({ query: 'github' });
      expect(result.success).toBe(true);
      expect((result as any).results).toHaveLength(1);
      expect((result as any).results[0].name).toBe('github');
    });

    it('searches by description', async () => {
      const result = await SearchMcpFacade.execute({ query: 'web search' });
      expect(result.success).toBe(true);
      expect((result as any).results).toHaveLength(1);
      expect((result as any).results[0].name).toBe('brave-search');
    });

    it('returns empty for no matches', async () => {
      const result = await SearchMcpFacade.execute({ query: 'nonexistent' });
      expect(result.success).toBe(true);
      expect((result as any).total).toBe(0);
    });
  });

  describe('installed listing error cases', () => {
    it('returns error when currentUserAlias is null', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      const original = (profileCacheManager as any).currentUserAlias;
      (profileCacheManager as any).currentUserAlias = null;
      const result = await SearchMcpFacade.execute({ installed: true });
      expect(result.success).toBe(false);
      (profileCacheManager as any).currentUserAlias = original;
    });

    it('returns empty list when getCachedProfile returns null', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValueOnce(null as any);
      const result = await SearchMcpFacade.execute({ installed: true });
      expect(result.success).toBe(true);
      expect((result as any).servers).toEqual([]);
    });

    it('sets status=unknown when GetMcpStatusTool throws for a server', async () => {
      const { GetMcpStatusTool } = await import('../../getMcpStatusTool');
      vi.mocked(GetMcpStatusTool.execute).mockRejectedValueOnce(new Error('connection failed'));
      const result = await SearchMcpFacade.execute({ installed: true });
      expect(result.success).toBe(true);
      const servers = (result as any).servers as Array<{ status: string }>;
      expect(servers[0].status).toBe('unknown');
    });

    it('returns error when currentUserAlias access throws', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      const original = (profileCacheManager as any).currentUserAlias;
      Object.defineProperty(profileCacheManager, 'currentUserAlias', { get() { throw new Error('cache error'); }, configurable: true });
      const result = await SearchMcpFacade.execute({ installed: true });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('LIST_ERROR');
      Object.defineProperty(profileCacheManager, 'currentUserAlias', { value: original, writable: true, configurable: true });
    });
  });

  describe('installed listing', () => {
    it('lists installed servers with status', async () => {
      const result = await SearchMcpFacade.execute({ installed: true });
      expect(result.success).toBe(true);
      expect((result as any).servers).toHaveLength(2);
      expect((result as any).servers[0].name).toBe('github');
    });
  });
});
