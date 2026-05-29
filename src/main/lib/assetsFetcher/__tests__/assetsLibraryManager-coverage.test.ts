/**
 * AssetsLibraryManager additional coverage tests
 *
 * Covers uncovered paths:
 * - checkAndUpdateLibraries() with isChecking guard
 * - checkAndUpdateLibraries() without alias (uses cachedAliases)
 * - checkAndUpdateLibraries() without alias and no cached aliases
 * - checkAndUpdateLibraries() exception path
 * - updateProfileRemoteVersions() profile-not-found path
 * - updateProfileRemoteVersions() MCP server, skill, agent update paths
 * - updateProfileRemoteVersions() update returning false (no increment)
 * - isCheckInProgress() and getLastCheckTime()
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getCachedAliases: vi.fn(() => ['testUser']),
    updateMcpServerConfig: vi.fn().mockResolvedValue(true),
    updateSkill: vi.fn().mockResolvedValue(true),
    updateChatAgent: vi.fn().mockResolvedValue(true),
    updateSubAgent: vi.fn().mockResolvedValue(true),
  },
}));

const { mockMcpFetcher, mockAgentFetcher, mockSkillFetcher, mockSubAgentFetcher } = vi.hoisted(() => ({
  mockMcpFetcher: {
    fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
    getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
  },
  mockAgentFetcher: {
    fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
    getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
  },
  mockSkillFetcher: {
    getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { skills: [] } }),
  },
  mockSubAgentFetcher: {
    fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { sub_agents: [] } }),
    getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { sub_agents: [] } }),
  },
}));

vi.mock('../mcpLibraryFetcher', async () => ({
  McpLibraryFetcher: { getInstance: vi.fn(() => mockMcpFetcher) },
}));

vi.mock('../agentLibraryFetcher', async () => ({
  AgentLibraryFetcher: { getInstance: vi.fn(() => mockAgentFetcher) },
}));

vi.mock('../../skill/skillLibraryFetcher', async () => ({
  SkillLibraryFetcher: { getInstance: vi.fn(() => mockSkillFetcher) },
}));

vi.mock('../subAgentLibraryFetcher', async () => ({
  SubAgentLibraryFetcher: { getInstance: vi.fn(() => mockSubAgentFetcher) },
}));

import { AssetsLibraryManager } from '../assetsLibraryManager';

// ─── Suite ───

describe('AssetsLibraryManager - Additional Coverage', () => {
  let manager: AssetsLibraryManager;

  beforeEach(async () => {
    (AssetsLibraryManager as any).instance = undefined;
    manager = AssetsLibraryManager.getInstance();
    vi.clearAllMocks();

    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
      mcp_servers: [],
      skills: [],
      chats: [],
      sub_agents: [],
    } as any);
    vi.mocked(profileCacheManager.getCachedAliases).mockReturnValue(['testUser']);
    vi.mocked(profileCacheManager.updateMcpServerConfig).mockResolvedValue(true);
    vi.mocked(profileCacheManager.updateSkill).mockResolvedValue(true);
    vi.mocked(profileCacheManager.updateChatAgent).mockResolvedValue(true);
    vi.mocked(profileCacheManager.updateSubAgent).mockResolvedValue(true);

    mockMcpFetcher.fetchAndUpdate.mockResolvedValue({ success: true, data: { mcp_servers: [] } });
    mockMcpFetcher.getLibraryData.mockResolvedValue({ success: true, data: { mcp_servers: [] } });
    mockAgentFetcher.fetchAndUpdate.mockResolvedValue({ success: true, data: { agents: [] } });
    mockAgentFetcher.getLibraryData.mockResolvedValue({ success: true, data: { agents: [] } });
    mockSkillFetcher.getLibraryData.mockResolvedValue({ success: true, data: { skills: [] } });
    mockSubAgentFetcher.fetchAndUpdate.mockResolvedValue({ success: true, data: { sub_agents: [] } });
    mockSubAgentFetcher.getLibraryData.mockResolvedValue({ success: true, data: { sub_agents: [] } });
  });

  afterEach(() => {
    (AssetsLibraryManager as any).instance = undefined;
  });

  // ─── State accessors ───
  describe('isCheckInProgress() / getLastCheckTime()', () => {
    it('returns false and null initially', () => {
      expect(manager.isCheckInProgress()).toBe(false);
      expect(manager.getLastCheckTime()).toBeNull();
    });

    it('updates lastCheckTime after a successful check', async () => {
      const before = Date.now();
      await manager.checkAndUpdateLibraries('testUser');
      const after = Date.now();

      expect(manager.getLastCheckTime()).toBeGreaterThanOrEqual(before);
      expect(manager.getLastCheckTime()).toBeLessThanOrEqual(after);
    });
  });

  // ─── isChecking guard ───
  describe('checkAndUpdateLibraries() - isChecking guard', () => {
    it('returns empty fetchResults when a check is already in progress', async () => {
      // Artificially set isChecking
      (manager as any).isChecking = true;

      const result = await manager.checkAndUpdateLibraries('testUser');

      expect(result.fetchResults).toEqual([]);
      expect(result.updateResult).toBeUndefined();

      (manager as any).isChecking = false;
    });
  });

  // ─── No alias provided ───
  describe('checkAndUpdateLibraries() without alias', () => {
    it('uses first cached alias when no alias argument provided', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedAliases).mockReturnValue(['autoAlias']);

      const { updateResult } = await manager.checkAndUpdateLibraries();

      expect(updateResult).toBeDefined();
    });

    it('skips profile update when no alias and no cached aliases', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedAliases).mockReturnValue([]);

      const { updateResult } = await manager.checkAndUpdateLibraries();

      expect(updateResult).toBeUndefined();
    });
  });

  // ─── Exception path ───
  describe('checkAndUpdateLibraries() exception path', () => {
    it('returns error fetchResults and resets isChecking when fetchAllLibraries throws', async () => {
      mockMcpFetcher.fetchAndUpdate.mockRejectedValue(new Error('Catastrophic failure'));
      mockAgentFetcher.fetchAndUpdate.mockRejectedValue(new Error('Catastrophic failure'));
      mockSkillFetcher.getLibraryData.mockRejectedValue(new Error('Catastrophic failure'));
      mockSubAgentFetcher.fetchAndUpdate.mockRejectedValue(new Error('Catastrophic failure'));

      // Simulate that fetchAllLibraries itself throws (mock the private method)
      const origFetch = (manager as any).fetchAllLibraries.bind(manager);
      vi.spyOn(manager as any, 'fetchAllLibraries').mockRejectedValue(new Error('Total crash'));

      const result = await manager.checkAndUpdateLibraries('testUser');

      expect(result.fetchResults).toHaveLength(1);
      expect(result.fetchResults[0].success).toBe(false);
      expect(result.fetchResults[0].error).toContain('Total crash');
      // isChecking should be reset
      expect(manager.isCheckInProgress()).toBe(false);
    });
  });

  // ─── updateProfileRemoteVersions edge cases ───
  describe('updateProfileRemoteVersions() - edge cases', () => {
    it('returns failure when profile not found', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue(null as any);

      const result = await manager.updateProfileRemoteVersions('unknownUser', []);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('unknownUser');
    });

    it('updates MCP server remoteVersion', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-1', remoteVersion: '1.0.0' }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const libraryResults = [
        { success: true, type: 'mcp' as const, items: [{ name: 'mcp-1', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedMcpServers).toBe(1);
      expect(profileCacheManager.updateMcpServerConfig).toHaveBeenCalledWith(
        'testUser', 'mcp-1', { remoteVersion: '2.0.0' }
      );
    });

    it('skips MCP update when remoteVersion already matches', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-1', remoteVersion: '2.0.0' }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const libraryResults = [
        { success: true, type: 'mcp' as const, items: [{ name: 'mcp-1', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedMcpServers).toBe(0);
    });

    it('handles MCP updateMcpServerConfig returning false (no increment)', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-1', remoteVersion: '1.0.0' }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateMcpServerConfig).mockResolvedValue(false);

      const libraryResults = [
        { success: true, type: 'mcp' as const, items: [{ name: 'mcp-1', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedMcpServers).toBe(0);
    });

    it('records error when updateMcpServerConfig throws', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-1', remoteVersion: '1.0.0' }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateMcpServerConfig).mockRejectedValue(new Error('DB error'));

      const libraryResults = [
        { success: true, type: 'mcp' as const, items: [{ name: 'mcp-1', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('updates skill remoteVersion', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [{ name: 'skill-1', remoteVersion: '1.0.0' }],
        chats: [],
        sub_agents: [],
      } as any);

      const libraryResults = [
        { success: true, type: 'skills' as const, items: [{ name: 'skill-1', version: '3.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedSkills).toBe(1);
      expect(profileCacheManager.updateSkill).toHaveBeenCalledWith(
        'testUser', 'skill-1', expect.objectContaining({ remoteVersion: '3.0.0' })
      );
    });

    it('handles updateSkill returning false (no increment)', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [{ name: 'skill-1', remoteVersion: '1.0.0' }],
        chats: [],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateSkill).mockResolvedValue(false);

      const libraryResults = [
        { success: true, type: 'skills' as const, items: [{ name: 'skill-1', version: '3.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedSkills).toBe(0);
    });

    it('records error when updateSkill throws', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [{ name: 'skill-1', remoteVersion: '1.0.0' }],
        chats: [],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateSkill).mockRejectedValue(new Error('Skill write error'));

      const libraryResults = [
        { success: true, type: 'skills' as const, items: [{ name: 'skill-1', version: '3.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('skill-1');
    });

    it('updates agent remoteVersion in chat', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [
          {
            chat_id: 'chat-1',
            agent: { name: 'my-agent', remoteVersion: '1.0.0' },
          },
        ],
        sub_agents: [],
      } as any);

      const libraryResults = [
        { success: true, type: 'agent' as const, items: [{ name: 'my-agent', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedAgents).toBe(1);
      expect(profileCacheManager.updateChatAgent).toHaveBeenCalledWith(
        'testUser', 'chat-1', { remoteVersion: '2.0.0' }
      );
    });

    it('skips chats without agent', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{ chat_id: 'chat-1' /* no agent */ }],
        sub_agents: [],
      } as any);

      const libraryResults = [
        { success: true, type: 'agent' as const, items: [{ name: 'my-agent', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedAgents).toBe(0);
    });

    it('handles updateChatAgent returning false (no increment)', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{ chat_id: 'chat-1', agent: { name: 'my-agent', remoteVersion: '1.0.0' } }],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateChatAgent).mockResolvedValue(false);

      const libraryResults = [
        { success: true, type: 'agent' as const, items: [{ name: 'my-agent', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedAgents).toBe(0);
    });

    it('records error when updateChatAgent throws', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{ chat_id: 'chat-1', agent: { name: 'my-agent', remoteVersion: '1.0.0' } }],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateChatAgent).mockRejectedValue(new Error('Chat update error'));

      const libraryResults = [
        { success: true, type: 'agent' as const, items: [{ name: 'my-agent', version: '2.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('my-agent');
    });

    it('skips library results with success=false', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');

      const libraryResults = [
        { success: false, type: 'mcp' as const, error: 'fetch failed' },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedMcpServers).toBe(0);
      expect(profileCacheManager.updateMcpServerConfig).not.toHaveBeenCalled();
    });

    it('uses empty arrays when profile has no mcp_servers/skills/chats/sub_agents', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({} as any);

      const libraryResults = [
        { success: true, type: 'mcp' as const, items: [{ name: 'x', version: '1.0.0' }] },
        { success: true, type: 'agent' as const, items: [{ name: 'y', version: '1.0.0' }] },
        { success: true, type: 'skills' as const, items: [{ name: 'z', version: '1.0.0' }] },
        { success: true, type: 'sub-agents' as const, items: [{ name: 'w', version: '1.0.0' }] },
      ];

      const result = await manager.updateProfileRemoteVersions('testUser', libraryResults);

      expect(result.updatedMcpServers).toBe(0);
      expect(result.updatedAgents).toBe(0);
      expect(result.updatedSkills).toBe(0);
      expect(result.updatedSubAgents).toBe(0);
    });
  });
});
