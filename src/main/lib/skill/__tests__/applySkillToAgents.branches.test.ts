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

const createAgent = (name: string, skills?: string[]) => ({
  name,
  ...(skills ? { skills } : {}),
  role: '',
  emoji: 'A',
  model: '',
  mcp_servers: [],
  system_prompt: '',
});

describe('applySkillToAgents branch coverage', () => {
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

  it('returns an empty skillName when the input name is undefined', async () => {
    const result = await applySkillToAgents('tester', {
      skillName: undefined as unknown as string,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(result.skillName).toBe('');
    expect(profileCacheManager.getCachedProfile).not.toHaveBeenCalled();
  });

  it('resolves no targets for applyToAll when a single-agent chat has no agent', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-without-agent',
          chat_type: 'single_agent',
        },
      ],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      applyToAll: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_TARGETS');
  });

  it('uses an empty chat list when the cached profile has no chats array', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({});

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      applyToAll: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_TARGETS');
  });

  it('counts an already-applied single-agent target without updating it', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: createAgent('Deck Builder', ['pptx']),
        },
      ],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      targets: [{ chatId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(false);
    expect(result.alreadyAppliedCount).toBe(1);
    expect(result.skippedTargets).toEqual([
      { chatId: 'chat-1', agentName: 'Deck Builder', reason: 'ALREADY_APPLIED' },
    ]);
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('continues when a previously validated single-agent chat no longer exposes the target agent', async () => {
    let accessCount = 0;
    const transientChat = {
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      get agent() {
        accessCount += 1;
        return accessCount <= 2 ? createAgent('Deck Builder') : undefined;
      },
    };
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [transientChat],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      targets: [{ chatId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_AGENT_UPDATES');
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('continues when a previously validated chat is absent during the update pass', async () => {
    const originalMapGet = Map.prototype.get;
    let chatIdGetCount = 0;
    const mapGetSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      if (key === 'transient-chat') {
        chatIdGetCount += 1;
        if (chatIdGetCount === 3) {
          return undefined;
        }
      }

      return originalMapGet.call(this, key);
    });

    try {
      (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
        chats: [
          {
            chat_id: 'transient-chat',
            chat_type: 'single_agent',
            agent: createAgent('Deck Builder'),
          },
        ],
      });

      const result = await applySkillToAgents('tester', {
        skillName: 'pptx',
        targets: [{ chatId: 'transient-chat', agentName: 'Deck Builder' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NO_AGENT_UPDATES');
      expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
    } finally {
      mapGetSpy.mockRestore();
    }
  });

  it('continues without updating when a multi-agent chat loses its agents array after validation', async () => {
    let accessCount = 0;
    const transientChat = {
      chat_id: 'chat-2',
      chat_type: 'multi_agent',
      get agents() {
        accessCount += 1;
        return accessCount === 1 ? [createAgent('Designer')] : undefined;
      },
    };
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [transientChat],
    });

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_AGENT_UPDATES');
    expect(profileCacheManager.updateChatConfig).not.toHaveBeenCalled();
  });

  it('adds a skill to a multi-agent target that has no skills array', async () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      chats: [
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [createAgent('Designer')],
        },
      ],
    });
    (profileCacheManager.updateChatConfig as Mock).mockResolvedValue(true);

    const result = await applySkillToAgents('tester', {
      skillName: 'pptx',
      targets: [{ chatId: 'chat-2', agentName: 'Designer' }],
    });

    expect(result.success).toBe(true);
    expect(result.appliedTargets).toEqual([{ chatId: 'chat-2', agentName: 'Designer' }]);
    expect(profileCacheManager.updateChatConfig).toHaveBeenCalledWith(
      'tester',
      'chat-2',
      expect.objectContaining({
        agents: [expect.objectContaining({ name: 'Designer', skills: ['pptx'] })],
      }),
    );
  });
});
