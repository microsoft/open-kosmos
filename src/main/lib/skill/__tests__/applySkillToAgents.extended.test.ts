import { applySkillToAgents } from '../applySkillToAgents';
import { profileCacheManager } from '../../userDataADO';

const mockRecordSkillAppliedToAgent = vi.fn();

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    updateChatConfig: vi.fn(),
  },
}));

vi.mock('../../analytics', async () => ({
  analyticsManager: {
    recordSkillAppliedToAgent: (...args: unknown[]) => mockRecordSkillAppliedToAgent(...args),
  },
}));

describe('applySkillToAgents — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSkillAppliedToAgent.mockResolvedValue(undefined);
  });

  it('returns INVALID_INPUT when skillName is empty', async () => {
    const result = await applySkillToAgents('tester', { skillName: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(profileCacheManager.getCachedProfile).not.toHaveBeenCalled();
  });

  it('returns PROFILE_NOT_FOUND when profile is missing', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue(null);
    const result = await applySkillToAgents('tester', { skillName: 'pdf' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('PROFILE_NOT_FOUND');
  });

  it('returns PROFILE_NOT_FOUND when profile has no skills array', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ chats: [] });
    const result = await applySkillToAgents('tester', { skillName: 'pdf' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('PROFILE_NOT_FOUND');
  });

  it('returns SKILL_NOT_INSTALLED when skill not in profile', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'other-skill' }],
      chats: [],
    });
    const result = await applySkillToAgents('tester', { skillName: 'pdf' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('SKILL_NOT_INSTALLED');
  });

  it('returns NO_TARGETS when no targets can be resolved', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [],
    });
    // No targets, no agentChatIds, no agentNames, no applyToAll
    const result = await applySkillToAgents('tester', { skillName: 'pdf' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_TARGETS');
  });

  it('skips target when chatId not found in chatMap', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [],
    });
    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'nonexistent', agentName: 'Agent' }],
    });
    expect(result.success).toBe(false);
    expect(result.skippedTargets).toEqual([
      { chatId: 'nonexistent', agentName: 'Agent', reason: 'CHAT_NOT_FOUND' },
    ]);
  });

  it('skips target when agent not found in chat', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'OtherAgent', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'chat-1', agentName: 'MissingAgent' }],
    });
    expect(result.success).toBe(false);
    expect(result.skippedTargets[0].reason).toBe('AGENT_NOT_FOUND');
  });

  it('continues when single-agent updateChatConfig fails', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(false);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'chat-1', agentName: 'Agent' }],
    });
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.skippedTargets[0].reason).toBe('UPDATE_FAILED');
    expect(mockRecordSkillAppliedToAgent).not.toHaveBeenCalled();
  });

  it('continues when multi-agent updateChatConfig fails', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: [], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(false);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.skippedTargets.some(t => t.reason === 'UPDATE_FAILED')).toBe(true);
  });

  it('skips multi-agent update when all agents already have the skill (didChange=false)', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: ['pdf'], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
          ],
        },
      ],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });
    expect(result.success).toBe(false);
    expect(result.alreadyAppliedCount).toBe(1);
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('resolves targets by agentChatIds and agentNames (no explicit targets)', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: [], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      agentChatIds: ['chat-1'],
    });
    expect(result.appliedCount).toBe(1);
    expect(result.appliedTargets[0].chatId).toBe('chat-1');
  });

  it('resolves targets by applyToAll', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf', source: 'IN-LIBRARY' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      applyToAll: true,
    });
    expect(result.appliedCount).toBe(1);
  });

  it('deduplicates targets in explicit targets list', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [
        { chatId: 'chat-1', agentName: 'Agent' },
        { chatId: 'chat-1', agentName: 'Agent' }, // duplicate
      ],
    });
    expect(result.appliedCount).toBe(1);
    expect(profileCacheManager.updateChatConfig).toHaveBeenCalledTimes(1);
  });

  it('filters out blank targets from explicit list', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [
        { chatId: '', agentName: 'Agent' },
        { chatId: 'chat-1', agentName: '' },
      ],
    });
    expect(result.error).toBe('NO_TARGETS');
  });

  it('builds message for partial failure (some applied, some failed)', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent1', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'single_agent',
          agent: { name: 'Agent2', skills: [], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      targets: [
        { chatId: 'chat-1', agentName: 'Agent1' },
        { chatId: 'chat-2', agentName: 'Agent2' },
      ],
    });
    expect(result.appliedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.error).toBe('PARTIAL_FAILURE');
  });

  it('resolves multi-agent chat with agentNames filter', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: [], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
            { name: 'Reviewer', skills: [], role: '', emoji: 'C', model: '', mcp_servers: [], system_prompt: '' },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      agentNames: ['Designer'],
    });
    expect(result.appliedCount).toBe(1);
    expect(result.appliedTargets[0].agentName).toBe('Designer');
  });

  it('handles multi-agent chat with no agents array', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          // no agents field
        },
      ],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pdf',
      applyToAll: true,
    });
    expect(result.error).toBe('NO_TARGETS');
  });
});
