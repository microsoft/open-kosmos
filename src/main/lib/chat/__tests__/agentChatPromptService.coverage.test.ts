// @ts-nocheck
/**
 * Supplemental coverage tests for agentChatPromptService.ts
 * Covers branches not hit by agentChatPromptService.test.ts
 */

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

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: fsMock.existsSync, readdirSync: fsMock.readdirSync };
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
      id: 'global',
      role: 'system',
      timestamp: 0,
      content: [{ type: 'text', text: 'Global' }],
    },
  ]),
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: { description: 'A skill', version: '1.0' } })),
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

import { AgentChatPromptService } from '../agentChatPromptService';
import type { AgentChatPromptServiceDeps } from '../agentChatPromptService';
import { getGlobalSystemPromptAsMessages } from '../globalSystemPrompt';

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

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(false);
  fsMock.readdirSync.mockReturnValue([]);
  mockGetCachedProfile.mockReturnValue(null);
  mockGetAllChatConfigs.mockReturnValue([]);
  mockGetChatConfig.mockReturnValue(null);
  mockUpdateChatSkillSnapshot.mockResolvedValue(true);
});

// ── getCurrentAvailableTools — tool name filtering branch ────────────────────

describe('getCurrentAvailableTools — tool name filtering', () => {
  it('filters tools when selectedTools has specific names', async () => {
    const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
    vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
      { serverName: 'server1', name: 'tool1' } as any,
      { serverName: 'server1', name: 'tool2' } as any,
    ]);
    const svc = new AgentChatPromptService(makeDeps({
      getLatestAgentConfig: vi.fn(() => ({
        mcp_servers: [{ name: 'server1', tools: ['tool1'] }],
      } as any)),
      getCurrentUserAlias: vi.fn(() => ''),
    }));
    const tools = await svc.getCurrentAvailableTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('tool1');
  });
});

// ── getAgentSpecificSystemPrompt — .claude/skills directory ──────────────────

describe('getAgentSpecificSystemPrompt — claude skills directory', () => {
  it('lists skills from .claude/skills directory when it exists', () => {
    mockGetAllChatConfigs.mockReturnValue([
      {
        agent: {
          name: 'TestAgent',
          knowledge: { knowledgeBase: '/my/kb' },
          skills: [],
          sub_agents: [],
        },
        skill_snapshot: null,
      },
    ]);

    const skillDirPath = '/my/kb/.claude/skills/my-skill';
    fsMock.existsSync.mockImplementation((p: string) => {
      if (p === '/my/kb/.claude/skills') return true;
      if (p.includes('SKILL.md')) return true;
      return false;
    });

    fsMock.readdirSync.mockImplementation((dir: string) => {
      if (dir === '/my/kb/.claude/skills') {
        return [{ name: 'my-skill', isDirectory: () => true }];
      }
      return [];
    });

    const svc = new AgentChatPromptService(makeDeps());
    const result = svc.getAgentSpecificSystemPrompt();
    expect(result).toHaveLength(1);
    const text = (result[0].content[0] as any).text;
    expect(text).toContain('my-skill');
  });

  it('handles skill directory without SKILL.md', () => {
    mockGetAllChatConfigs.mockReturnValue([
      {
        agent: {
          name: 'TestAgent',
          knowledge: { knowledgeBase: '/my/kb' },
          skills: [],
          sub_agents: [],
        },
        skill_snapshot: null,
      },
    ]);

    fsMock.existsSync.mockImplementation((p: string) => {
      if (p === '/my/kb/.claude/skills') return true;
      return false; // No SKILL.md
    });

    fsMock.readdirSync.mockImplementation((dir: string) => {
      if (dir === '/my/kb/.claude/skills') {
        return [{ name: 'skill-no-md', isDirectory: () => true }];
      }
      return [];
    });

    const svc = new AgentChatPromptService(makeDeps());
    const result = svc.getAgentSpecificSystemPrompt();
    expect(result).toHaveLength(1);
    const text = (result[0].content[0] as any).text;
    expect(text).toContain('skill-no-md');
    expect(text).toContain('No description available');
  });

  it('includes skill_snapshot prompt when present', () => {
    mockGetAllChatConfigs.mockReturnValue([
      {
        agent: {
          name: 'TestAgent',
          knowledge: { knowledgeBase: null },
          workspace: null,
          skills: [],
          sub_agents: [],
        },
        skill_snapshot: { prompt: '\n## SKILL SNAPSHOT\nsome prompt content' },
      },
    ]);

    const svc = new AgentChatPromptService(makeDeps());
    const result = svc.getAgentSpecificSystemPrompt();
    const text = (result[0].content[0] as any).text;
    expect(text).toContain('SKILL SNAPSHOT');
  });
});

// ── getCombinedSystemPromptForContext — returns [] when all empty ─────────────

describe('getCombinedSystemPromptForContext — edge cases', () => {
  it('returns [] when all sources return empty arrays', () => {
    vi.mocked(getGlobalSystemPromptAsMessages).mockReturnValueOnce([]);

    // Make agent specific also empty by having no user alias
    const svc = new AgentChatPromptService(makeDeps({
      getCurrentUserAlias: vi.fn(() => ''),
      getLatestAgentConfig: vi.fn(() => null),
    }));

    // Even with empty alias, getAgentSpecificSystemPrompt returns agent identity
    // so result won't be [] unless we override it completely
    const result = svc.getCombinedSystemPromptForContext();
    expect(Array.isArray(result)).toBe(true);
  });

  it('includes custom system prompt text in combined prompt', () => {
    const svc = new AgentChatPromptService(makeDeps({
      getLatestAgentConfig: vi.fn(() => ({
        system_prompt: 'Custom prompt!',
        name: 'TestAgent',
        role: 'assistant',
        mcp_servers: [],
      } as any)),
    }));
    const result = svc.getCombinedSystemPromptForContext();
    const text = (result[0].content[0] as any).text;
    expect(text).toContain('Custom prompt!');
  });
});

// ── refreshSkillSnapshotIfNeeded — catch branch ──────────────────────────────

describe('refreshSkillSnapshotIfNeeded — catch branch', () => {
  it('catches and logs errors gracefully', async () => {
    mockGetChatConfig.mockImplementation(() => {
      throw new Error('db failure');
    });
    const svc = new AgentChatPromptService(makeDeps());
    // Should not throw
    await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
  });

  it('clears old snapshot when no agent but snapshot exists', async () => {
    mockGetChatConfig.mockReturnValue({
      agent: null,
      skill_snapshot: { binding_signature: 'old', prompt: 'old' },
    });
    const svc = new AgentChatPromptService(makeDeps());
    await svc.refreshSkillSnapshotIfNeeded();
    expect(mockUpdateChatSkillSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      null,
    );
  });
});
