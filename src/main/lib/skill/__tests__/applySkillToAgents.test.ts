import { applySkillToAgents } from '../applySkillToAgents';
import { profileCacheManager } from '../../userDataADO';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';
import { chatSkillSnapshotStore } from '../../userDataADO/chatSkillSnapshotStore';

const mockRecordSkillAppliedToAgent = vi.fn();

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    updateChatConfig: vi.fn(),
  },
}));

vi.mock('../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: vi.fn(),
    getSkill: vi.fn(),
    hasSkill: vi.fn(),
  },
}));

vi.mock('../../userDataADO/chatSkillSnapshotStore', () => ({
  chatSkillSnapshotStore: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    clearForAlias: vi.fn(),
    clearAll: vi.fn(),
    invalidateAffectedChats: vi.fn(),
  },
}));

describe('applySkillToAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSkillAppliedToAgent.mockResolvedValue(undefined);
    (skillsConfigManager.getSkill as Mock).mockReturnValue({
      name: 'pptx',
      description: 'PPTX skill',
      version: '1.0.0',
      remoteVersion: '',
      source: 'ON-DEVICE',
    });
  });

  it('applies a skill to matching single-agent and multi-agent targets', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pptx', description: 'PPTX skill', version: '1.0.0', source: 'ON-DEVICE' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'Deck Builder', skills: [], role: '', emoji: 'A', model: '', mcp_servers: [], system_prompt: '' },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Designer', skills: [], role: '', emoji: 'B', model: '', mcp_servers: [], system_prompt: '' },
            { name: 'Reviewer', skills: ['pptx'], role: '', emoji: 'C', model: '', mcp_servers: [], system_prompt: '' },
          ],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      targets: [
        { chatId: 'chat-1', agentName: 'Deck Builder' },
        { chatId: 'chat-2', agentName: 'Designer' },
        { chatId: 'chat-2', agentName: 'Reviewer' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.alreadyAppliedCount).toBe(1);
    expect(profileCacheManager.updateChatConfig).toHaveBeenCalledTimes(2);
    expect(profileCacheManager.updateChatConfig).toHaveBeenNthCalledWith(
      1,
      'tester',
      'chat-1',
      expect.objectContaining({
        agent: expect.objectContaining({ skills: ['pptx'] }),
      }),
    );
    expect(profileCacheManager.updateChatConfig).toHaveBeenNthCalledWith(
      2,
      'tester',
      'chat-2',
      expect.objectContaining({
        agents: expect.arrayContaining([
          expect.objectContaining({ name: 'Designer', skills: ['pptx'] }),
          expect.objectContaining({ name: 'Reviewer', skills: ['pptx'] }),
        ]),
      }),
    );
    expect(chatSkillSnapshotStore.clear).toHaveBeenCalledTimes(2);
    expect(chatSkillSnapshotStore.clear).toHaveBeenNthCalledWith(1, 'tester', 'chat-1');
    expect(chatSkillSnapshotStore.clear).toHaveBeenNthCalledWith(2, 'tester', 'chat-2');
  });
});