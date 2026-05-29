import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetLibraryData = vi.fn();
vi.mock('../../../assetsFetcher/agentLibraryFetcher', () => ({
  AgentLibraryFetcher: {
    getInstance: () => ({ getLibraryData: (...args: unknown[]) => mockGetLibraryData(...args) }),
  },
}));

const mockGetCachedAliases = vi.fn().mockReturnValue([]);
const mockGetAllChatConfigs = vi.fn().mockReturnValue([]);
vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedAliases: (...args: unknown[]) => mockGetCachedAliases(...args),
    getAllChatConfigs: (...args: unknown[]) => mockGetAllChatConfigs(...args),
  },
}));

import { GetAgentTemplateFromLibraryTool } from '../getAgentTemplateFromLibraryTool';

function makeAgent(name: string, extra: Record<string, any> = {}) {
  return {
    name,
    version: '1.0.0',
    description: `${name} description`,
    configuration: { workspace: '/default/path', model: 'gpt-4.1' },
    ...extra,
  };
}

describe('GetAgentTemplateFromLibraryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedAliases.mockReturnValue([]);
    mockGetAllChatConfigs.mockReturnValue([]);
  });

  describe('getDefinition', () => {
    it('returns a definition with name get_agent_template_from_library', () => {
      const def = GetAgentTemplateFromLibraryTool.getDefinition();
      expect(def.name).toBe('get_agent_template_from_library');
      expect(def.inputSchema.required).toContain('agent_name');
    });
  });

  describe('execute — input validation', () => {
    it('returns failure for empty agent_name', async () => {
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: '' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('returns failure for whitespace-only agent_name', async () => {
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: '   ' });
      expect(result.success).toBe(false);
    });
  });

  describe('execute — library fetch failure', () => {
    it('returns failure when library fetch fails', async () => {
      mockGetLibraryData.mockResolvedValue({ success: false, error: 'CDN unreachable' });
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('LIBRARY_FETCH_FAILED');
      expect(result.message).toContain('CDN unreachable');
    });

    it('returns failure when library data is null', async () => {
      mockGetLibraryData.mockResolvedValue({ success: true, data: null });
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('LIBRARY_FETCH_FAILED');
    });
  });

  describe('execute — agent not found', () => {
    it('returns AGENT_NOT_FOUND when name does not match', async () => {
      mockGetLibraryData.mockResolvedValue({
        success: true,
        data: { agents: [makeAgent('Research Agent'), makeAgent('Code Agent')] },
      });
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'NonExistent' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('AGENT_NOT_FOUND');
      expect(result.message).toContain('Research Agent');
    });
  });

  describe('execute — success (no local agent)', () => {
    it('returns agent config on exact name match', async () => {
      mockGetLibraryData.mockResolvedValue({
        success: true,
        data: { agents: [makeAgent('Research Agent'), makeAgent('Research Agent')] },
      });

      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(true);
      expect(result.config?.name).toBe('Research Agent');
      expect(result.config?.version).toBe('1.0.0');
      expect(result.message).toContain('Research Agent');
    });
  });

  describe('execute — local workspace preservation', () => {
    it('replaces workspace with the local agent workspace when found', async () => {
      mockGetCachedAliases.mockReturnValue(['alice']);
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'Research Agent', workspace: '/alice/custom-workspace' } },
      ]);
      mockGetLibraryData.mockResolvedValue({
        success: true,
        data: { agents: [makeAgent('Research Agent')] },
      });

      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(true);
      expect(result.config?.configuration?.workspace).toBe('/alice/custom-workspace');
      expect(result.message).toContain('Local workspace preserved');
    });

    it('keeps library workspace when local agent has no workspace', async () => {
      mockGetCachedAliases.mockReturnValue(['alice']);
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'Research Agent', workspace: '' } },
      ]);
      mockGetLibraryData.mockResolvedValue({
        success: true,
        data: { agents: [makeAgent('Research Agent')] },
      });

      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(true);
      expect(result.config?.configuration?.workspace).toBe('/default/path');
    });
  });

  describe('execute — error handling', () => {
    it('returns EXECUTION_ERROR when fetcher throws', async () => {
      mockGetLibraryData.mockRejectedValue(new Error('fetch boom'));
      const result = await GetAgentTemplateFromLibraryTool.execute({ agent_name: 'Research Agent' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
    });
  });

  describe('getAvailableAgents', () => {
    it('returns agent names from library', async () => {
      mockGetLibraryData.mockResolvedValue({
        success: true,
        data: { agents: [makeAgent('Agent A'), makeAgent('Agent B')] },
      });
      const names = await GetAgentTemplateFromLibraryTool.getAvailableAgents();
      expect(names).toEqual(['Agent A', 'Agent B']);
    });

    it('returns empty array on fetch failure', async () => {
      mockGetLibraryData.mockResolvedValue({ success: false });
      expect(await GetAgentTemplateFromLibraryTool.getAvailableAgents()).toEqual([]);
    });

    it('returns empty array when fetcher throws', async () => {
      mockGetLibraryData.mockRejectedValue(new Error('boom'));
      expect(await GetAgentTemplateFromLibraryTool.getAvailableAgents()).toEqual([]);
    });
  });
});
