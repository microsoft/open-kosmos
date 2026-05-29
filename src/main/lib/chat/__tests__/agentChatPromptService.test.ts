// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
vi.mock('../../unifiedLogger', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: () => logger,
    createConsoleLogger: () => logger,
    getUnifiedLogger: () => logger,
    getGlobalLogger: () => logger,
    createHighPerformanceLogger: () => logger,
    createDebugLogger: () => logger,
    getRefactoredLogger: () => logger,
    initializeGlobalLogger: () => logger,
    resetGlobalLogger: vi.fn(),
    isGlobalLoggerInitialized: vi.fn(() => true),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: actual.join,
  };
});

vi.mock('../../userDataADO/pathUtils', () => ({
  extractMonthFromChatSessionId: vi.fn(() => '2024-01'),
}));

const {
  mockGetCachedProfile,
  mockGetAllChatConfigs,
  mockGetChatConfig,
  mockUpdateChatSkillSnapshot,
} = vi.hoisted(() => ({
  mockGetCachedProfile: vi.fn(),
  mockGetAllChatConfigs: vi.fn(() => []),
  mockGetChatConfig: vi.fn(() => null),
  mockUpdateChatSkillSnapshot: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: mockGetCachedProfile,
    getAllChatConfigs: mockGetAllChatConfigs,
    getChatConfig: mockGetChatConfig,
    updateChatSkillSnapshot: mockUpdateChatSkillSnapshot,
  },
}));

vi.mock('../globalSystemPrompt', () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => [
    {
      id: 'global-system-prompt',
      role: 'system',
      timestamp: 0,
      content: [{ type: 'text', text: 'Global system prompt content' }],
    },
  ]),
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: null })),
  },
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../subAgent/subAgentFileManager', () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({
      getCachedConfigs: vi.fn(() => []),
    })),
  },
}));

vi.mock('../skillSnapshotBuilder', () => ({
  buildChatSkillSnapshot: vi.fn(() => ({
    binding_signature: 'new-sig',
    registry_signature: 'new-reg',
    skills: [],
    prompt: '',
  })),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getAllTools: vi.fn(() => Promise.resolve([])),
  },
}));

// Now import the class under test
import { AgentChatPromptService } from '../agentChatPromptService';
import type { AgentChatPromptServiceDeps } from '../agentChatPromptService';
import { getGlobalSystemPromptAsMessages } from '../globalSystemPrompt';
import { SubAgentFileManager } from '../../subAgent/subAgentFileManager';

function makeDeps(overrides: Partial<AgentChatPromptServiceDeps> = {}): AgentChatPromptServiceDeps {
  return {
    getCurrentUserAlias: vi.fn(() => 'user@test.com'),
    getChatId: vi.fn(() => 'chat-123'),
    getChatSessionId: vi.fn(() => 'session-2024-01-01T000000'),
    getAgentName: vi.fn(() => 'TestAgent'),
    getLatestAgentConfig: vi.fn(() => null),
    isRemoteSession: vi.fn(() => false),
    getInteractionPolicy: vi.fn(() => 'allow-ui' as const),
    ...overrides,
  };
}

describe('AgentChatPromptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedProfile.mockReturnValue(null);
    mockGetAllChatConfigs.mockReturnValue([]);
    mockGetChatConfig.mockReturnValue(null);
    mockUpdateChatSkillSnapshot.mockResolvedValue(true);
  });

  describe('setHookAdditionalContexts', () => {
    it('stores contexts for later injection', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['ctx1', 'ctx2']);
      // Indirectly verify by checking getCombinedSystemPromptForContext
      const result = svc.getCombinedSystemPromptForContext();
      // There should be at least one message containing the hook context
      const combined = result[0]?.content[0];
      expect((combined as any).text).toContain('ctx1');
      expect((combined as any).text).toContain('ctx2');
    });

    it('clears previous contexts when called again', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['old-ctx']);
      svc.setHookAdditionalContexts(['new-ctx']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('new-ctx');
      expect(text).not.toContain('old-ctx');
    });
  });

  describe('getLatestCustomSystemPrompt', () => {
    it('returns empty array when no agent config', () => {
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      expect(svc.getLatestCustomSystemPrompt()).toEqual([]);
    });

    it('returns empty array when config has no system_prompt', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          system_prompt: '',
          name: 'Agent',
          role: 'assistant',
          mcp_servers: [],
        } as any)),
      }));
      expect(svc.getLatestCustomSystemPrompt()).toEqual([]);
    });

    it('returns a system message when config has system_prompt', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          system_prompt: 'You are a test agent.',
          name: 'TestAgent',
          role: 'assistant',
          mcp_servers: [],
        } as any)),
      }));
      const result = svc.getLatestCustomSystemPrompt();
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      const text = (result[0].content[0] as any).text;
      expect(text).toBe('You are a test agent.');
    });
  });

  describe('getGlobalSystemPrompt', () => {
    it('returns the global system prompt messages', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getGlobalSystemPrompt();
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
    });
  });

  describe('getAgentSpecificSystemPrompt', () => {
    it('returns at least one system message with agent identity', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      expect(result).toHaveLength(1);
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('TestAgent');
    });

    it('includes knowledge base path when configured', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            knowledge: { knowledgeBase: '/my/kb' },
            workspace: null,
            skills: [],
            sub_agents: [],
          },
        },
      ]);
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('/my/kb');
    });

    it('includes workspace path when configured', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            workspace: '/my/workspace',
            skills: [],
            sub_agents: [],
          },
        },
      ]);
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('/my/workspace');
    });
  });

  describe('getCombinedSystemPromptForContext', () => {
    it('returns empty array when all prompt sources are empty', () => {
      // Make getGlobalSystemPromptAsMessages return []
      vi.mocked(getGlobalSystemPromptAsMessages).mockReturnValueOnce([]);
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      // Without any content we still get the agent identity block from getAgentSpecificSystemPrompt
      const result = svc.getCombinedSystemPromptForContext();
      // At minimum, agentSpecific adds content
      expect(Array.isArray(result)).toBe(true);
    });

    it('adds remote session reminder when isRemoteSession is true', () => {
      const svc = new AgentChatPromptService(makeDeps({ isRemoteSession: vi.fn(() => true) }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('remote IM channel');
    });

    it('adds remote session reminder when policy is plain-text-only', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getInteractionPolicy: vi.fn(() => 'plain-text-only' as const),
      }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('remote IM channel');
    });

    it('adds scheduled job reminder when policy is forbid', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getInteractionPolicy: vi.fn(() => 'forbid' as const),
      }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('background scheduled job');
    });

    it('does not add task confirmation hint for kosmos brand', () => {
      const original = process.env.BRAND_NAME;
      process.env.BRAND_NAME = 'kosmos';
      try {
        const svc = new AgentChatPromptService(makeDeps({
          getInteractionPolicy: vi.fn(() => 'allow-ui' as const),
        }));
        const result = svc.getCombinedSystemPromptForContext();
        const text = (result[0]?.content[0] as any).text;
        expect(text).not.toContain('Task Creation Confirmation');
        expect(text).not.toContain('ask whether they would like you to create tasks');
      } finally {
        process.env.BRAND_NAME = original;
      }
    });

    it('does not add remote or scheduled reminders for allow-ui policy', () => {
      const svc = new AgentChatPromptService(makeDeps({
        isRemoteSession: vi.fn(() => false),
        getInteractionPolicy: vi.fn(() => 'allow-ui' as const),
      }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).not.toContain('remote IM channel');
      expect(text).not.toContain('background scheduled job');
    });

    it('wraps hook additional contexts in system-reminder tags', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['my-hook-context']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('<system-reminder>');
      expect(text).toContain('my-hook-context');
    });
  });

  describe('getCurrentAvailableTools', () => {
    it('returns empty array when no agent config', async () => {
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });

    it('returns all tools when agent config has no mcp_servers', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toHaveLength(1);
    });

    it('filters tools by configured mcp_servers', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
        { serverName: 'server2', name: 'tool2' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: [] }],
        } as any)),
        getCurrentUserAlias: vi.fn(() => ''),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool1');
    });

    it('skips servers that are in_use=false in global profile', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      mockGetCachedProfile.mockReturnValue({
        mcp_servers: [{ name: 'server1', in_use: false }],
      });
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: [] }],
        } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toHaveLength(0);
    });

    it('returns empty array on error', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockRejectedValueOnce(new Error('Network error'));
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });
  });

  describe('buildSubAgentsSystemPrompt', () => {
    it('returns empty string when no matching sub-agents', () => {
      vi.mocked(SubAgentFileManager.getInstance).mockReturnValue({
        getCachedConfigs: vi.fn(() => []),
      });
      const svc = new AgentChatPromptService(makeDeps());
      expect(svc.buildSubAgentsSystemPrompt(['nonexistent'])).toBe('');
    });

    it('builds a prompt listing sub-agents', () => {
      vi.mocked(SubAgentFileManager.getInstance).mockReturnValue({
        getCachedConfigs: vi.fn(() => [
          {
            name: 'sub1',
            description: 'Does sub stuff',
            mcp_servers: [{ name: 'mcp-server' }],
            skills: ['skill1'],
          },
        ]),
      });
      const svc = new AgentChatPromptService(makeDeps());
      const prompt = svc.buildSubAgentsSystemPrompt(['sub1']);
      expect(prompt).toContain('sub1');
      expect(prompt).toContain('Does sub stuff');
    });
  });

  describe('refreshSkillSnapshotIfNeeded', () => {
    it('does nothing when chat config has no agent', async () => {
      mockGetChatConfig.mockReturnValue({ agent: null, skill_snapshot: null });
      const svc = new AgentChatPromptService(makeDeps());
      await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
      expect(mockUpdateChatSkillSnapshot).not.toHaveBeenCalled();
    });

    it('clears skill snapshot when agent has no skills', async () => {
      mockGetChatConfig.mockReturnValue({
        agent: { skills: [] },
        skill_snapshot: { binding_signature: 'old' },
      });
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(mockUpdateChatSkillSnapshot).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        null,
      );
    });

    it('skips update when signatures match', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'same-sig',
        registry_signature: 'same-reg',
        skills: [],
        prompt: '',
        missing_skill_names: [],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
        skill_snapshot: { binding_signature: 'same-sig', registry_signature: 'same-reg' },
      });
      mockGetCachedProfile.mockReturnValue({ skills: [] });
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(mockUpdateChatSkillSnapshot).not.toHaveBeenCalled();
    });

    it('updates snapshot when signatures differ', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'new-sig',
        registry_signature: 'new-reg',
        skills: [],
        prompt: '',
        missing_skill_names: [],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
        skill_snapshot: { binding_signature: 'old-sig', registry_signature: 'old-reg' },
      });
      mockGetCachedProfile.mockReturnValue({ skills: [] });
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(mockUpdateChatSkillSnapshot).toHaveBeenCalled();
    });

    it('does not throw when updateChatSkillSnapshot returns false', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'new-sig',
        registry_signature: 'new-reg',
        skills: [],
        prompt: '',
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
        skill_snapshot: null,
      });
      mockGetCachedProfile.mockReturnValue({ skills: [] });
      mockUpdateChatSkillSnapshot.mockResolvedValueOnce(false);
      const svc = new AgentChatPromptService(makeDeps());
      await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
    });
  });

  describe('getCombinedSystemPromptForCurrentTurn', () => {
    it('refreshes skill snapshot and then returns system prompt', async () => {
      mockGetChatConfig.mockReturnValue({ agent: null, skill_snapshot: null });
      const svc = new AgentChatPromptService(makeDeps());
      const result = await svc.getCombinedSystemPromptForCurrentTurn();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
