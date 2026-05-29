/**
 * Unit tests for SearchAgentsFacade
 */

vi.mock('../../../../assetsFetcher/agentLibraryFetcher', () => ({
  AgentLibraryFetcher: {
    getInstance: vi.fn().mockReturnValue({
      getLibraryData: vi.fn().mockResolvedValue({
        success: true,
        data: {
          agents: [
            { name: 'Research Agent', description: 'Helps with research tasks', version: '1.0.0' },
            { name: 'Planning Agent', description: 'Project management assistant', version: '1.0.0' },
            { name: 'Coding Agent', description: 'Code generation helper', version: '1.0.0' },
          ],
        },
      }),
    }),
  },
}));

vi.mock('../../listAgentsTool', () => ({
  ListAgentsTool: {
    execute: vi.fn().mockResolvedValue({ success: true, agents: ['Bot1', 'Bot2'], count: 2, message: 'Found 2 agent(s)' }),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchAgentsFacade } from '../searchAgentsFacade';
import { ListAgentsTool } from '../../listAgentsTool';

describe('SearchAgentsFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinition()', () => {
    it('returns correct tool name', () => {
      expect(SearchAgentsFacade.getDefinition().name).toBe('search_agents');
    });
  });

  describe('validation', () => {
    it('rejects when neither query nor installed provided', async () => {
      const result = await SearchAgentsFacade.execute({});
      expect(result.success).toBe(false);
    });
  });

  describe('library fetch error cases', () => {
    it('returns error when library fetch returns success=false', async () => {
      const { AgentLibraryFetcher } = await import('../../../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValueOnce({
        getLibraryData: vi.fn().mockResolvedValue({ success: false, error: 'network' }),
      } as any);

      const result = await SearchAgentsFacade.execute({ query: 'test' });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('LIBRARY_FETCH_FAILED');
    });

    it('returns error when fetcher.getLibraryData throws', async () => {
      const { AgentLibraryFetcher } = await import('../../../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValueOnce({
        getLibraryData: vi.fn().mockRejectedValue(new Error('network timeout')),
      } as any);

      const result = await SearchAgentsFacade.execute({ query: 'test' });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('SEARCH_ERROR');
    });
  });

  describe('query search', () => {
    it('searches library by name', async () => {
      const result = await SearchAgentsFacade.execute({ query: 'research' });
      expect(result.success).toBe(true);
      expect((result as any).results).toHaveLength(1);
      expect((result as any).results[0].name).toBe('Research Agent');
    });

    it('searches by description', async () => {
      const result = await SearchAgentsFacade.execute({ query: 'project management' });
      expect(result.success).toBe(true);
      expect((result as any).results[0].name).toBe('Planning Agent');
    });
  });

  describe('installed listing', () => {
    it('delegates to ListAgentsTool', async () => {
      const result = await SearchAgentsFacade.execute({ installed: true });
      expect(result.success).toBe(true);
      expect(ListAgentsTool.execute).toHaveBeenCalled();
    });
  });
});
