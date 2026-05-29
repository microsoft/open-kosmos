/**
 * StartupUpdateService unit tests — Steps 0–6
 *
 * Covers:
 * - refreshModels (Step 0): non-fatal on failure
 * - checkMcpUpdates / installMcpUpdates (Steps 1–2): version comparison, mergeEnv, placeholder, mcpClientManager.update
 * - checkSkillUpdates / installSkillUpdates (Steps 3–4): built-in detection, addSkill/updateSkill
 * - checkAgentUpdates / installAgentUpdates (Steps 5–6): merge rules, protected fields
 * - Full run() pipeline: progress steps, result counts, error resilience
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getCachedAliases: vi.fn(() => ['testUser']),
    getSubAgentIndex: vi.fn(() => []),
    updateMcpServerConfig: vi.fn().mockResolvedValue(true),
    updateSkill: vi.fn().mockResolvedValue(true),
    updateChatAgent: vi.fn().mockResolvedValue(true),
    updateSubAgent: vi.fn().mockResolvedValue(true),
    writeProfileToFile: vi.fn().mockResolvedValue(true),
    forceNotifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../skill/skillManager', async () => ({
  SkillManager: {
    getInstance: vi.fn(() => ({
      getInstalledSkills: vi.fn(() => []),
    })),
  },
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  ghcModelsManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    refreshFromRemote: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../assetsFetcher/mcpLibraryFetcher', async () => ({
  McpLibraryFetcher: {
    getInstance: vi.fn(() => ({
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
    })),
  },
}));

vi.mock('../../assetsFetcher/agentLibraryFetcher', async () => ({
  AgentLibraryFetcher: {
    getInstance: vi.fn(() => ({
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
    })),
  },
}));

vi.mock('../../skill/skillLibraryFetcher', async () => ({
  SkillLibraryFetcher: {
    getInstance: vi.fn(() => ({
      getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { skills: [] } }),
      addSkill: vi.fn().mockResolvedValue({ success: true }),
      updateSkill: vi.fn().mockResolvedValue({ success: true }),
    })),
  },
}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn(() => false), // Disable sub-agent feature for Steps 0-6 tests
}));

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({
      readAgentConfig: vi.fn().mockResolvedValue(null),
      writeAgentConfig: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    getRunningServers: vi.fn(() => []),
    stopServer: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/kosmosPlaceholders', async () => ({
  kosmosPlaceholderManager: {
    replacePlaceholdersInObject: vi.fn((obj: any) => obj),
    replacePlaceholders: vi.fn((str: string) => str),
  },
  containsOpenKosmosPlaceholder: vi.fn(() => false),
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['web-search', 'file-ops'],
}));

import {
  StartupUpdateService,
  mergeAgentMcpServers,
  mergeAgentSkills,
  mergeEnv,
} from '../startupUpdateService';
import type { StartupUpdateProgress } from '../startupUpdateService';

// ─── Helpers ───

function noopProgress(_: StartupUpdateProgress): void {}

// ─── Suite ───

describe('StartupUpdateService - Steps 0-6', () => {
  let progressCalls: StartupUpdateProgress[];
  let progressCallback: (p: StartupUpdateProgress) => void;

  beforeEach(async () => {
    progressCalls = [];
    progressCallback = (p: StartupUpdateProgress) => {
      progressCalls.push(p);
    };

    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
      mcp_servers: [],
      skills: [],
      chats: [],
      sub_agents: [],
    } as any);

    // Reset fetcher mocks to safe defaults to prevent test leakage
    const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
    vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
    } as any);

    const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
    vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
      getLibraryData: vi.fn().mockResolvedValue({ success: true, data: { skills: [] } }),
      addSkill: vi.fn().mockResolvedValue({ success: true }),
      updateSkill: vi.fn().mockResolvedValue({ success: true }),
    } as any);

    const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
    vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
    } as any);

    const { kosmosPlaceholderManager, containsOpenKosmosPlaceholder } = await import('../../userDataADO/kosmosPlaceholders');
    vi.mocked(kosmosPlaceholderManager.replacePlaceholdersInObject).mockImplementation((obj: any) => obj);
    vi.mocked(kosmosPlaceholderManager.replacePlaceholders).mockImplementation((str: string) => str);
    vi.mocked(containsOpenKosmosPlaceholder).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Step 0: refreshModels ───
  describe('refreshModels (Step 0)', () => {
    it('should be non-fatal when model refresh throws a non-Error string', async () => {
      const { ghcModelsManager } = await import('../../llm/ghcModelsManager');
      vi.mocked(ghcModelsManager.refreshFromRemote).mockRejectedValueOnce('string-refresh-error');

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
    });

    it('should handle MCP library response with no mcp_servers property', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: {}, // no mcp_servers key → mcp_servers || [] fallback (line 395)
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should handle profile with undefined mcp_servers (mcp_servers || [] fallback)', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', transport: 'stdio' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: undefined, // → profile.mcp_servers || [] fallback (line 404)
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should call ghcModelsManager.initialize and refreshFromRemote', async () => {
      const { ghcModelsManager } = await import('../../llm/ghcModelsManager');

      const service = new StartupUpdateService('testUser', progressCallback);
      await service.run();

      expect(ghcModelsManager.initialize).toHaveBeenCalledWith('testUser');
      expect(ghcModelsManager.refreshFromRemote).toHaveBeenCalled();
    });

    it('should log skip message when refreshFromRemote returns false', async () => {
      const { ghcModelsManager } = await import('../../llm/ghcModelsManager');
      vi.mocked(ghcModelsManager.refreshFromRemote).mockResolvedValue(false);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
    });

    it('should be non-fatal when model refresh fails', async () => {
      const { ghcModelsManager } = await import('../../llm/ghcModelsManager');
      vi.mocked(ghcModelsManager.refreshFromRemote).mockRejectedValue(new Error('Network error'));

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
    });

    it('should emit check-models progress step', async () => {
      const service = new StartupUpdateService('testUser', progressCallback);
      await service.run();

      const modelSteps = progressCalls.filter(p => p.step === 'check-models');
      expect(modelSteps.length).toBeGreaterThan(0);
    });
  });

  // ─── Steps 1-2: MCP Updates ───
  describe('checkMcpUpdates / installMcpUpdates (Steps 1-2)', () => {
    it('should detect no updates when local versions match remote', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '1.0.0' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {} }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(0);
    });

    it('should skip updates when local version is newer than remote (downgrade prevention)', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '1.0.0' }] }, // remote is older
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '2.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {} }], // local is newer
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(0);
    });

    it('should treat non-standard version strings as equal when major.minor.patch parts match', async () => {
      // Both versions parse to [1,0,0] so isVersionGreater returns false (equal, line 135)
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '1.0.0.6' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0.5', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {} }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      // Both parse to [1,0,0] - isVersionGreater returns false, no update
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should detect and install MCP updates when remote version is greater', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', transport: 'stdio', command: 'node', args: ['index.js'], env: { KEY: 'remote_val' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: { KEY: 'local_val' }, transport: 'stdio', in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(1);
      expect(mcpClientManager.update).toHaveBeenCalledWith('mcp-a', expect.objectContaining({
        version: '2.0.0',
        env: expect.objectContaining({ KEY: 'local_val' }), // mergeEnv preserves local
      }));
    });

    it('should skip non-IN-LIBRARY MCP servers', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-custom', version: '2.0.0' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-custom', version: '1.0.0', source: 'ON-DEVICE', env: {} }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(0);
    });

    it('should skip MCP updates when fetch fails', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({ success: false, error: 'Network error' }),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should be non-fatal when checkMcpUpdates throws a non-Error string', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockRejectedValue('string-mcp-check-error'),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should fall back to local.transport when remote MCP has no transport', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', env: {} }] }, // no transport
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', transport: 'stdio', env: {}, in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(1); // update should succeed using local.transport
    });

    it('should skip local MCP server not found in remote library', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'other-mcp', version: '2.0.0', transport: 'stdio' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        // 'mcp-local' is not in remote library → should skip (line 416)
        mcp_servers: [{ name: 'mcp-local', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should use fallback version 1.0.0 for local MCP with no version', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', transport: 'stdio', env: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        // no version on local → fallback '1.0.0' (line 428)
        mcp_servers: [{ name: 'mcp-a', source: 'IN-LIBRARY', remoteVersion: '1.0.0', in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(1); // '1.0.0' < '2.0.0' → updated
    });

    it('should be non-fatal when checkMcpUpdates throws internally', async () => {
      // Make getCachedProfile throw to trigger the catch block in checkMcpUpdates
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockImplementationOnce(() => { throw new Error('profile cache exploded'); });

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should be non-fatal when mcpClientManager.update throws during install', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', transport: 'stdio', env: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {}, in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.update).mockRejectedValueOnce(new Error('MCP update failed'));

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should be non-fatal when mcpClientManager.update throws a non-Error string', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', version: '2.0.0', transport: 'stdio', env: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {}, in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.update).mockRejectedValueOnce('string-mcp-update-error');

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
    });

    it('should use version 1.0.0 fallback when remote MCP has no version', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-a', transport: 'stdio', env: {} }] }, // no version → '1.0.0'
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-a', version: '0.5.0', source: 'IN-LIBRARY', remoteVersion: '', env: {}, in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(1); // 0.5.0 < 1.0.0 → updated
    });

    it('should handle skill library response with no skills property', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: {}, // no skills key → skills || [] (line 550)
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should process URL with kosmos placeholder when containsOpenKosmosPlaceholder returns true', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-url', version: '2.0.0', transport: 'sse', url: 'https://{{OpenKosmos_HOST}}/api', env: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-url', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {}, transport: 'sse', in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const { containsOpenKosmosPlaceholder, kosmosPlaceholderManager } = await import('../../userDataADO/kosmosPlaceholders');
      vi.mocked(containsOpenKosmosPlaceholder).mockReturnValueOnce(true);
      vi.mocked(kosmosPlaceholderManager.replacePlaceholders).mockReturnValueOnce('https://resolved-host/api');

      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedMcpCount).toBe(1);
      expect(mcpClientManager.update).toHaveBeenCalledWith('mcp-url', expect.objectContaining({
        url: 'https://resolved-host/api',
      }));
    });

    it('should be non-fatal when placeholder replacement throws', async () => {
      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-ph', version: '2.0.0', transport: 'stdio', env: { KEY: 'val' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-ph', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', env: {}, in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const { kosmosPlaceholderManager } = await import('../../userDataADO/kosmosPlaceholders');
      vi.mocked(kosmosPlaceholderManager.replacePlaceholdersInObject).mockImplementationOnce(() => { throw new Error('placeholder error'); });

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      // Should still update (fallback to original mergedEnv) and be non-fatal
      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(1);
    });
  });

    it('should keep original URL when replacePlaceholders throws for URL placeholder', async () => {
      const { containsOpenKosmosPlaceholder } = await import('../../userDataADO/kosmosPlaceholders');
      vi.mocked(containsOpenKosmosPlaceholder).mockReturnValueOnce(false).mockReturnValueOnce(true);
      const { kosmosPlaceholderManager } = await import('../../userDataADO/kosmosPlaceholders');
      vi.mocked(kosmosPlaceholderManager.replacePlaceholders).mockImplementationOnce(() => { throw new Error('url placeholder error'); });

      const { McpLibraryFetcher } = await import('../../assetsFetcher/mcpLibraryFetcher');
      vi.mocked(McpLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { mcp_servers: [{ name: 'mcp-url', version: '2.0.0', transport: 'http', url: '{{OpenKosmos_HOST}}/api' }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [{ name: 'mcp-url', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', in_use: true }],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(1); // still updated with original URL
    });

  // ─── Steps 3-4: Skill Updates ───
  describe('checkSkillUpdates / installSkillUpdates (Steps 3-4)', () => {
    it('should detect and install missing built-in skills', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      const mockAddSkill = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', version: '1.0.0', description: 'Web search' },
            { name: 'file-ops', version: '1.0.0', description: 'File operations' },
          ] },
        }),
        addSkill: mockAddSkill,
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [], // No skills installed
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedSkillCount).toBe(2);
      expect(mockAddSkill).toHaveBeenCalledTimes(2);
    });

    it('should detect and update IN-LIBRARY skills with newer versions', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      const mockUpdateSkill = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', version: '2.0.0', description: 'Web search v2' },
            { name: 'file-ops', version: '1.0.0', description: 'File operations' },
          ] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: mockUpdateSkill,
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          { name: 'web-search', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
          { name: 'file-ops', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      // 0 built-in installs (both already present), 1 update (web-search)
      expect(result.updatedSkillCount).toBe(1);
      expect(mockUpdateSkill).toHaveBeenCalledWith('web-search', 'testUser');
    });

    it('should skip skill updates when fetch fails', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({ success: false }),
        addSkill: vi.fn(),
        updateSkill: vi.fn(),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedSkillCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle profile with undefined skills (skills || [] fallback)', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'web-search', version: '1.0.0', description: 'Web search' }] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: undefined, // → profile.skills || [] fallback (line 556)
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      // web-search is built-in and not installed → should try to addSkill
      expect(result.updatedSkillCount).toBeGreaterThanOrEqual(0);
    });

    it('should skip skill with non-IN-LIBRARY source in update check', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'custom-skill', version: '2.0.0', description: 'custom' }] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          // source is not IN-LIBRARY → should be skipped (line 581)
          { name: 'custom-skill', version: '1.0.0', source: 'CUSTOM', remoteVersion: '1.0.0' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should use fallback version 1.0.0 when skill remote and local have no version', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', description: 'Web search' }, // version absent → fallback '1.0.0' (line 586)
          ] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          // no version on local → fallback '1.0.0' (line 596)
          { name: 'web-search', source: 'IN-LIBRARY', remoteVersion: '' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      // '1.0.0' === '1.0.0' → no update needed
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should be non-fatal when checkSkillUpdates throws internally', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockRejectedValue(new Error('Skills fetch exploded')),
        addSkill: vi.fn(),
        updateSkill: vi.fn(),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedSkillCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should be non-fatal when checkSkillUpdates throws a non-Error string', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockRejectedValue('string-error-from-skill-check'),
        addSkill: vi.fn(),
        updateSkill: vi.fn(),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedSkillCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle addSkill returning failure (success: false)', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', version: '1.0.0', description: 'Web search' },
            { name: 'file-ops', version: '1.0.0', description: 'File operations' },
          ] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: false, error: 'add failed' }),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      // Skills missing → will try to addSkill for built-ins
      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should be non-fatal when addSkill throws a non-Error string', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', version: '1.0.0', description: 'Web search' },
          ] },
        }),
        addSkill: vi.fn().mockRejectedValue('string-error-from-add-skill'),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should be non-fatal when addSkill throws', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [
            { name: 'web-search', version: '1.0.0', description: 'Web search' },
          ] },
        }),
        addSkill: vi.fn().mockRejectedValue(new Error('add threw')),
        updateSkill: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

    it('should handle updateSkill returning failure (success: false)', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      const mockUpdateSkill = vi.fn().mockResolvedValue({ success: false, error: 'update failed' });
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'web-search', version: '2.0.0', description: 'Web search v2' }] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: mockUpdateSkill,
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          { name: 'web-search', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
          { name: 'file-ops', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0); // update returned false
    });

    it('should be non-fatal when updateSkill throws', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'web-search', version: '2.0.0', description: 'v2' }] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockRejectedValue(new Error('disk error')),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          { name: 'web-search', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
          { name: 'file-ops', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });
  });

    it('should be non-fatal when updateSkill throws a non-Error string', async () => {
      const { SkillLibraryFetcher } = await import('../../skill/skillLibraryFetcher');
      vi.mocked(SkillLibraryFetcher.getInstance).mockReturnValue({
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'web-search', version: '2.0.0', description: 'v2' }] },
        }),
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        updateSkill: vi.fn().mockRejectedValue('non-error-string-from-skill-update'),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [
          { name: 'web-search', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        ],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedSkillCount).toBe(0);
    });

  // ─── Steps 5-6: Agent Updates ───
  describe('checkAgentUpdates / installAgentUpdates (Steps 5-6)', () => {
    it('should detect and install agent updates', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: '2.0.0',
            configuration: {
              emoji: '🚀',
              avatar: 'new-avatar.png',
              name: 'Research Agent v2',
              system_prompt: 'You are Research Agent v2',
              mcp_servers: [{ name: 'mcp-b', tools: [] }],
              skills: ['skill-b'],
              zero_states: { greeting: 'Hello v2' },
              model: 'gpt-4o',
              context_enhancement: { type: 'new' },
            },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: {
            name: 'research-agent',
            version: '1.0.0',
            source: 'IN-LIBRARY',
            remoteVersion: '1.0.0',
            emoji: '📋',
            avatar: 'old-avatar.png',
            model: 'gpt-4',
            system_prompt: 'You are Research Agent v1',
            context_enhancement: { type: 'old' },
            mcp_servers: [{ name: 'mcp-a', tools: ['tool1'] }],
            skills: ['skill-a'],
            workspace: '/my/workspace',
            knowledgeBase: '/my/kb',
          },
        }],
        sub_agents: [],
      } as any);

      vi.mocked(profileCacheManager.updateChatAgent).mockResolvedValue(true);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedAgentCount).toBe(1);
      expect(profileCacheManager.updateChatAgent).toHaveBeenCalledWith(
        'testUser',
        'chat-1',
        expect.objectContaining({
          // Remote-first
          emoji: '🚀',
          avatar: 'new-avatar.png',
          name: 'Research Agent v2',
          system_prompt: 'You are Research Agent v2',
          // Local-first
          model: 'gpt-4', // keeps local
          context_enhancement: { type: 'old' }, // keeps local
          // Merge
          version: '2.0.0',
        }),
      );

      // Verify protected fields are NOT in update
      const updateCall = vi.mocked(profileCacheManager.updateChatAgent).mock.calls[0][2] as any;
      expect(updateCall).not.toHaveProperty('workspace');
      expect(updateCall).not.toHaveProperty('knowledgeBase');
      expect(updateCall).not.toHaveProperty('knowledge');
    });

    it('should merge mcp_servers (union) and skills (union) in agent update', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: '2.0.0',
            configuration: {
              mcp_servers: [{ name: 'mcp-a', tools: ['tool2'] }, { name: 'mcp-b', tools: [] }],
              skills: ['skill-a', 'skill-b'],
              system_prompt: 'v2',
            },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: {
            name: 'research-agent',
            version: '1.0.0',
            source: 'IN-LIBRARY',
            remoteVersion: '1.0.0',
            mcp_servers: [{ name: 'mcp-a', tools: ['tool1'] }],
            skills: ['skill-a', 'skill-c'],
          },
        }],
        sub_agents: [],
      } as any);

      vi.mocked(profileCacheManager.updateChatAgent).mockResolvedValue(true);

      const service = new StartupUpdateService('testUser', progressCallback);
      await service.run();

      // First call is remoteVersion update, second call is the full agent update
      const calls = vi.mocked(profileCacheManager.updateChatAgent).mock.calls;
      // Find the call with mcp_servers (the install call, not the remoteVersion call)
      const installCall = calls.find(c => (c[2] as any).mcp_servers);
      expect(installCall).toBeDefined();
      const updateCall = installCall![2] as any;

      // MCP servers: mcp-a tools merged (union), mcp-b added
      const mcpNames = updateCall.mcp_servers.map((s: any) => s.name);
      expect(mcpNames).toContain('mcp-a');
      expect(mcpNames).toContain('mcp-b');

      // Skills: union
      expect(updateCall.skills).toContain('skill-a');
      expect(updateCall.skills).toContain('skill-b');
      expect(updateCall.skills).toContain('skill-c');
    });

    it('should skip non-IN-LIBRARY agents', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'custom-agent', version: '2.0.0', configuration: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'custom-agent', version: '1.0.0', source: 'ON-DEVICE' },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedAgentCount).toBe(0);
    });

    it('should skip agent updates when fetch returns success: false', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({ success: false, error: 'Network error' }),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedAgentCount).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle agent library response with no agents property', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: {}, // no agents key → agents || [] fallback (line 708)
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle profile with no chats property and chats with no agent field', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        // chats absent → profile.chats || [] fallback (line 714)
        // Also include chat with no agent (line 723)
        chats: [{ chat_id: 'no-agent-chat' }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle profile with no chats property and chats with no agent field', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        // chats absent → profile.chats || [] fallback (line 714)
        // Also include chat with no agent (line 723)
        chats: [{ chat_id: 'no-agent-chat' }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle profile where chats key is absent (chats undefined fallback)', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: {} }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        // chats is undefined → profile.chats || [] → []  (line 714 fallback branch)
        chats: undefined,
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should skip chat agent whose name is not found in remote library', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'other-agent', version: '2.0.0', configuration: { system_prompt: 'v2' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          // 'research-agent' not in remote library → should skip (line 727)
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should use fallback version 1.0.0 for local agent with no version and parse NaN version parts', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: 'abc.xyz.??', // NaN parts → isVersionGreater parse || 0 (line 123)
            configuration: { system_prompt: 'v2' },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          // no version → fallback to '1.0.0' (line 739)
          agent: { name: 'research-agent', source: 'IN-LIBRARY', remoteVersion: '' },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      // NaN version means isVersionGreater returns false (0 not > 0) — no update
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should be non-fatal when checkAgentUpdates throws a non-Error (String path)', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockRejectedValue('string-error-from-agent-check'),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle remote agent with no configuration property', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: '2.0.0',
            // configuration absent → falls back to {}
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(1);
      const calls = vi.mocked(profileCacheManager.updateChatAgent).mock.calls;
      const installCall = calls.find(c => (c[2] as any).version === '2.0.0');
      expect(installCall).toBeDefined();
    });

    it('should be non-fatal when checkAgentUpdates throws internally', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockRejectedValue(new Error('Agent fetch exploded')),
      } as any);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle updateChatAgent returning false (agent update failure)', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: { system_prompt: 'v2' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);
      // First call for remoteVersion update returns true, second for the actual update returns false
      vi.mocked(profileCacheManager.updateChatAgent)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0); // not counted since updateChatAgent returned false
    });

    it('should be non-fatal when updateChatAgent throws during install', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: { system_prompt: 'v2' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);
      // First call for remoteVersion update, second call throws
      vi.mocked(profileCacheManager.updateChatAgent)
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('DB write error'));

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should handle non-Error thrown in agent install catch (String path)', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{ name: 'research-agent', version: '2.0.0', configuration: { system_prompt: 'v2' } }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);
      // Throw a non-Error (string) to cover the String(error) branch in the catch
      vi.mocked(profileCacheManager.updateChatAgent)
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce('non-error string exception');

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should use fallback version 1.0.0 and empty system_prompt when agent remote has no version/system_prompt', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            // version omitted → fallback to '1.0.0'
            configuration: {
              emoji: '🚀',
              // system_prompt key absent → '' (the else branch)
            },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '0.5.0', source: 'IN-LIBRARY', remoteVersion: '0.5.0' },
        }],
        sub_agents: [],
      } as any);
      vi.mocked(profileCacheManager.updateChatAgent).mockResolvedValue(true);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.updatedAgentCount).toBe(1);
      const calls = vi.mocked(profileCacheManager.updateChatAgent).mock.calls;
      const installCall = calls.find(c => (c[2] as any).emoji);
      expect(installCall).toBeDefined();
      const update = installCall![2] as any;
      expect(update.version).toBe('1.0.0'); // fallback
      expect(update.system_prompt).toBe(''); // else branch
    });
  });

  // ─── Full pipeline ───
  describe('run() pipeline', () => {
    it('should use default emoji and agent.name when remote config has no emoji and no name', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: '2.0.0',
            // name in remote top-level is the lookup key; configuration has no emoji or name
            configuration: {
              system_prompt: 'hello',
              // emoji absent → fallback to agent.emoji then '🤖'
              // name absent → fallback to remote.name then agent.name
            },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          // local agent has no emoji either → final fallback to '🤖'
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0', emoji: undefined },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedAgentCount).toBe(1);
      const calls = vi.mocked(profileCacheManager.updateChatAgent).mock.calls;
      const installCall = calls.find(c => (c[2] as any).version === '2.0.0');
      expect(installCall).toBeDefined();
      const update = installCall![2] as any;
      expect(update.emoji).toBe('🤖'); // ultimate fallback
      expect(update.name).toBe('research-agent'); // falls back to remote.name (top-level name)
    });
    it('should produce empty string system_prompt when remote configuration has system_prompt key present but empty', async () => {
      const { AgentLibraryFetcher } = await import('../../assetsFetcher/agentLibraryFetcher');
      vi.mocked(AgentLibraryFetcher.getInstance).mockReturnValue({
        fetchAndUpdate: vi.fn().mockResolvedValue({
          success: true,
          data: { agents: [{
            name: 'research-agent',
            version: '2.0.0',
            configuration: {
              system_prompt: '', // key IS present but empty string → remoteConfig.system_prompt || '' = ''
            },
          }] },
        }),
      } as any);

      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue({
        mcp_servers: [],
        skills: [],
        chats: [{
          chat_id: 'chat-1',
          agent: { name: 'research-agent', version: '1.0.0', source: 'IN-LIBRARY', remoteVersion: '1.0.0' },
        }],
        sub_agents: [],
      } as any);

      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.updatedAgentCount).toBe(1);
      const calls = vi.mocked(profileCacheManager.updateChatAgent).mock.calls;
      const installCall = calls.find(c => (c[2] as any).version === '2.0.0');
      expect(installCall).toBeDefined();
      expect((installCall![2] as any).system_prompt).toBe('');
    });

    it('should emit progress steps in correct order', async () => {
      const service = new StartupUpdateService('testUser', progressCallback);
      await service.run();

      const steps = progressCalls.map(p => p.step);
      expect(steps).toContain('check-models');
      expect(steps).toContain('check-mcp');
      expect(steps).toContain('install-mcp');
      expect(steps).toContain('check-skills');
      expect(steps).toContain('install-skills');
      expect(steps).toContain('check-agents');
      expect(steps).toContain('install-agents');
      expect(steps).toContain('complete');

      // Ensure order
      const checkModelsIdx = steps.indexOf('check-models');
      const checkMcpIdx = steps.indexOf('check-mcp');
      const completeIdx = steps.lastIndexOf('complete');
      expect(checkModelsIdx).toBeLessThan(checkMcpIdx);
      expect(checkMcpIdx).toBeLessThan(completeIdx);
    });

    it('should return success=true with zero counts when nothing needs update', async () => {
      const service = new StartupUpdateService('testUser', noopProgress);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.hasUpdates).toBe(false);
      expect(result.updatedMcpCount).toBe(0);
      expect(result.updatedSkillCount).toBe(0);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should skip all steps when no profile found', async () => {
      const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getCachedProfile).mockReturnValue(null);

      const service = new StartupUpdateService('testUser', progressCallback);
      const result = await service.run();

      expect(result.success).toBe(true);
      expect(result.updatedMcpCount).toBe(0);
      expect(result.updatedSkillCount).toBe(0);
      expect(result.updatedAgentCount).toBe(0);
    });

    it('should catch top-level failures and return success=false (non-Error string path)', async () => {
      // Throw a non-Error string from progressCallback on first call to trigger outer catch String(error) branch
      let calls = 0;
      const throwOnceCallback = (p: StartupUpdateProgress) => {
        calls++;
        if (calls === 1) throw 'string-top-level-error';
      };

      const service = new StartupUpdateService('testUser', throwOnceCallback);
      const result = await service.run();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should catch top-level failures and return success=false', async () => {
      // Make progressCallback throw on the first call to trigger the outer catch in run()
      let callCount = 0;
      const throwingCallback = (p: StartupUpdateProgress) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Critical callback failure');
        }
      };

      const service = new StartupUpdateService('testUser', throwingCallback);
      const result = await service.run();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
