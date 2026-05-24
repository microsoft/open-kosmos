/**
 * Tests for profile-based builtin tools:
 *   - ListAgentsTool
 *   - GetAgentStatusTool
 *   - ApplySkillToAgentsTool
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/openkosmos-test') },
}));

const profileCacheManagerMock = {
  currentUserAlias: null as string | null,
  getCachedProfile: vi.fn(),
  getAllChatConfigs: vi.fn(),
};

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../skill/applySkillToAgents', () => ({
  applySkillToAgents: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../skill/installAndActivateSkill', () => ({
  installAndActivateSkill: vi.fn(async () => undefined),
}));

vi.mock('./builtinToolsManager', () => ({
  BuiltinToolsManager: { getContext: vi.fn(() => ({ currentChatId: 'chat-1', currentAgentName: 'Agent1' })) },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(agentNames: string[] = []) {
  return {
    chats: agentNames.map((name, i) => ({
      id: `chat-${i}`,
      agent: { name, role: 'assistant', emoji: '🤖', model: 'gpt-4' },
    })),
  };
}

beforeEach(() => {
  profileCacheManagerMock.currentUserAlias = null;
  profileCacheManagerMock.getCachedProfile.mockReset();
  profileCacheManagerMock.getAllChatConfigs.mockReset();
  vi.resetModules();
});

// ─────────────────────────────────────────────────────────────
// ListAgentsTool
// ─────────────────────────────────────────────────────────────
describe('ListAgentsTool', () => {
  it('returns error when no user session', async () => {
    profileCacheManagerMock.currentUserAlias = null;
    const { ListAgentsTool } = await import('../listAgentsTool');
    const result = await ListAgentsTool.execute();
    expect(result.success).toBe(false);
    expect(result.agents).toHaveLength(0);
  });

  it('returns error when profile not found', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getCachedProfile.mockReturnValue(null);
    const { ListAgentsTool } = await import('../listAgentsTool');
    const result = await ListAgentsTool.execute();
    expect(result.success).toBe(false);
  });

  it('returns empty list when no agents', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getCachedProfile.mockReturnValue(makeProfile([]));
    const { ListAgentsTool } = await import('../listAgentsTool');
    const result = await ListAgentsTool.execute();
    expect(result.success).toBe(true);
    expect(result.agents).toHaveLength(0);
  });

  it('returns unique agent names', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getCachedProfile.mockReturnValue(makeProfile(['Alice', 'Bob', 'Alice']));
    const { ListAgentsTool } = await import('../listAgentsTool');
    const result = await ListAgentsTool.execute();
    expect(result.success).toBe(true);
    expect(result.agents).toEqual(['Alice', 'Bob']);
    expect(result.count).toBe(2);
  });

  it('getDefinition returns list_agents name', async () => {
    const { ListAgentsTool } = await import('../listAgentsTool');
    expect(ListAgentsTool.getDefinition().name).toBe('list_agents');
  });
});

// ─────────────────────────────────────────────────────────────
// GetAgentStatusTool
// ─────────────────────────────────────────────────────────────
describe('GetAgentStatusTool', () => {
  it('returns error for missing agent_name', async () => {
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    const result = await GetAgentStatusTool.execute({ agent_name: '' });
    expect(result.success).toBe(false);
  });

  it('returns NotAdded when no user session', async () => {
    profileCacheManagerMock.currentUserAlias = null;
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    const result = await GetAgentStatusTool.execute({ agent_name: 'Alice' });
    expect(result.status).toBe('NotAdded');
  });

  it('returns NotAdded when profile not found', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getAllChatConfigs.mockReturnValue(null);
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    const result = await GetAgentStatusTool.execute({ agent_name: 'Alice' });
    expect(result.status).toBe('NotAdded');
  });

  it('returns Added when agent exists', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getAllChatConfigs.mockReturnValue(makeProfile(['Alice']).chats);
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    const result = await GetAgentStatusTool.execute({ agent_name: 'Alice' });
    expect(result.status).toBe('Added');
    expect(result.success).toBe(true);
  });

  it('returns NotAdded when agent not in profile', async () => {
    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getAllChatConfigs.mockReturnValue(makeProfile(['Bob']).chats);
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    const result = await GetAgentStatusTool.execute({ agent_name: 'Alice' });
    expect(result.status).toBe('NotAdded');
  });

  it('getDefinition returns get_agent_status name', async () => {
    const { GetAgentStatusTool } = await import('../getAgentStatusTool');
    expect(GetAgentStatusTool.getDefinition().name).toBe('get_agent_status');
  });
});

// ─────────────────────────────────────────────────────────────
// ApplySkillToAgentsTool
// ─────────────────────────────────────────────────────────────
describe('ApplySkillToAgentsTool', () => {
  it('returns error when skill_name is missing', async () => {
    const { ApplySkillToAgentsTool } = await import('../applySkillToAgentsTool');
    const result = await ApplySkillToAgentsTool.execute({ skill_name: '' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns error when no user session', async () => {
    profileCacheManagerMock.currentUserAlias = null;
    const { ApplySkillToAgentsTool } = await import('../applySkillToAgentsTool');
    const result = await ApplySkillToAgentsTool.execute({ skill_name: 'my-skill' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
  });

  it('getDefinition returns apply_skill_to_agents name', async () => {
    const { ApplySkillToAgentsTool } = await import('../applySkillToAgentsTool');
    expect(ApplySkillToAgentsTool.getDefinition().name).toBe('apply_skill_to_agents');
  });
});
