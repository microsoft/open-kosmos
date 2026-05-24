import { removeSkillsFromAgents } from '../removeSkillsFromAgents';
import { profileCacheManager } from '../../userDataADO';

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    updateChatConfig: vi.fn(),
  },
}));

describe('removeSkillsFromAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes matching skills from single-agent and multi-agent targets', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          skill_snapshot: { prompt: 'old' },
          agent: { name: 'Deck Builder', skills: ['pptx', 'figma'], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: ['pptx', 'jira'], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
            { name: 'Reviewer', skills: ['jira'], role: '', emoji: 'C', model: '', mcp_servers: [], system_prompt: '' },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pptx', 'jira'],
      targets: [
        { chatId: 'chat-1', agentName: 'Deck Builder' },
        { chatId: 'chat-2', agentName: 'Designer' },
        { chatId: 'chat-2', agentName: 'Reviewer' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.updatedAgentCount).toBe(3);
    expect(result.removedBindingCount).toBe(4);
    expect(profileCacheManager.updateChatConfig).toHaveBeenCalledTimes(2);
    expect(profileCacheManager.updateChatConfig).toHaveBeenNthCalledWith(
      1,
      'tester',
      'chat-1',
      expect.objectContaining({
        agent: expect.objectContaining({ skills: ['figma'] }),
        skill_snapshot: undefined,
      }),
    );
    expect(profileCacheManager.updateChatConfig).toHaveBeenNthCalledWith(
      2,
      'tester',
      'chat-2',
      expect.objectContaining({
        agents: expect.arrayContaining([
          expect.objectContaining({ name: 'Designer', skills: [] }),
          expect.objectContaining({ name: 'Reviewer', skills: [] }),
        ]),
        skill_snapshot: undefined,
      }),
    );
  });

  it('reports unchanged targets when none of the requested skills are applied', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Deck Builder', skills: ['figma'], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['pptx'],
      targets: [{ chatId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(false);
    expect(result.updatedAgentCount).toBe(0);
    expect(result.unchangedTargetCount).toBe(1);
    expect(result.skippedTargets).toEqual([
      { chatId: 'chat-1', agentName: 'Deck Builder', reason: 'SKILLS_NOT_APPLIED' },
    ]);
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('can remove stale skill names even when they are not globally installed', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Deck Builder', skills: ['legacy-skill'], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await removeSkillsFromAgents('tester', {
      skillNames: ['legacy-skill'],
      targets: [{ chatId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(true);
    expect(result.removedBindingCount).toBe(1);
    expect(profileCacheManager.updateChatConfig).toHaveBeenCalledWith(
      'tester',
      'chat-1',
      expect.objectContaining({
        agent: expect.objectContaining({ skills: [] }),
        skill_snapshot: undefined,
      }),
    );
  });
});