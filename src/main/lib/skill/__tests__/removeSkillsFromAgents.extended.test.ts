import { removeSkillsFromAgents } from '../removeSkillsFromAgents';
import { profileCacheManager } from '../../userDataADO';

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    updateChatConfig: vi.fn(),
  },
}));

describe('removeSkillsFromAgents — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INVALID_INPUT when skillNames is empty', async () => {
    const result = await removeSkillsFromAgents('tester', { skillNames: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when skillNames contains only blanks', async () => {
    const result = await removeSkillsFromAgents('tester', { skillNames: ['  ', ''] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns PROFILE_NOT_FOUND when profile is missing', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue(null);
    const result = await removeSkillsFromAgents('tester', { skillNames: ['pdf'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('PROFILE_NOT_FOUND');
  });

  it('returns PROFILE_NOT_FOUND when chats is not an array', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [] });
    const result = await removeSkillsFromAgents('tester', { skillNames: ['pdf'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('PROFILE_NOT_FOUND');
  });

  it('returns NO_TARGETS when options produce no resolved targets', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ chats: [] });
    const result = await removeSkillsFromAgents('tester', { skillNames: ['pdf'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_TARGETS');
  });

  it('skips target when chatId not found in chatMap', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ chats: [] });
    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [{ chatId: 'ghost', agentName: 'Agent' }],
    });
    expect(result.skippedTargets[0].reason).toBe('CHAT_NOT_FOUND');
  });

  it('skips target when agent not found in single_agent chat', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'RealAgent', skills: ['pdf'] },
        },
      ],
    });
    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [{ chatId: 'chat-1', agentName: 'FakeAgent' }],
    });
    expect(result.skippedTargets[0].reason).toBe('AGENT_NOT_FOUND');
  });

  it('handles single_agent update failure', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: ['pdf'] },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(false);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [{ chatId: 'chat-1', agentName: 'Agent' }],
    });
    expect(result.failedCount).toBe(1);
    expect(result.skippedTargets[0].reason).toBe('UPDATE_FAILED');
    expect(result.error).toBe('NO_AGENT_UPDATES');
  });

  it('handles multi-agent update failure', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: ['pdf'] },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(false);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });
    expect(result.failedCount).toBe(1);
    expect(result.skippedTargets.some(t => t.reason === 'UPDATE_FAILED')).toBe(true);
  });

  it('resolves targets via removeFromAll', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: ['pdf'] },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      removeFromAll: true,
    });
    expect(result.updatedAgentCount).toBe(1);
  });

  it('resolves targets via agentChatIds filter', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent', skills: ['pdf'] },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'single_agent',
          agent: { name: 'Agent2', skills: ['pdf'] },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      agentChatIds: ['chat-1'],
    });
    expect(result.updatedAgentCount).toBe(1);
    expect(result.updatedTargets[0].chatId).toBe('chat-1');
  });

  it('resolves targets via agentNames filter', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: ['pdf'] },
            { name: 'Reviewer', skills: ['pdf'] },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      agentNames: ['Designer'],
    });
    expect(result.updatedAgentCount).toBe(1);
    expect(result.updatedTargets[0].agentName).toBe('Designer');
  });

  it('partial failure: some updated, some failed', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Agent1', skills: ['pdf'] },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'single_agent',
          agent: { name: 'Agent2', skills: ['pdf'] },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [
        { chatId: 'chat-1', agentName: 'Agent1' },
        { chatId: 'chat-2', agentName: 'Agent2' },
      ],
    });
    expect(result.updatedAgentCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.error).toBe('PARTIAL_FAILURE');
  });

  it('skips multi-agent update when none of the skills are applied (didChange=false)', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: ['other'] },
          ],
        },
      ],
    });

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });
    expect(result.unchangedTargetCount).toBe(1);
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('handles single_agent with no agent object', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          // no agent field
        },
      ],
    });

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pdf'],
      removeFromAll: true,
    });
    // no targets resolved since single_agent with no agent => getChatAgents returns []
    expect(result.error).toBe('NO_TARGETS');
  });
});
