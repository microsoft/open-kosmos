import { getSkillAvailability } from '../skillAvailability';
import { profileCacheManager } from '../../userDataADO';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
  },
}));

vi.mock('../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: vi.fn(),
    getSkill: vi.fn(),
    hasSkill: vi.fn(),
  },
}));

describe('getSkillAvailability — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(true);
  });

  it('returns not installed when the registry does not have the skill', () => {
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(false);
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf' });
    expect(result.installed).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
  });

  it('returns installed=false with no chatId when skill is not in the registry', () => {
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(false);
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf' });
    expect(result.installed).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns CHAT_NOT_FOUND when chatConfig is null', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf', chatId: 'chat-1' });
    expect(result.installed).toBe(true);
    expect(result.reason).toBe('CHAT_NOT_FOUND');
    expect(result.callableInCurrentChat).toBe(false);
  });

  it('returns AGENT_NOT_RESOLVED when single_agent chat has no agent', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      // no agent field
    });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf', chatId: 'chat-1' });
    expect(result.reason).toBe('AGENT_NOT_RESOLVED');
  });

  it('resolves multi_agent chat when agentName provided and matched', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'multi_agent',
      agents: [{ name: 'Kobi', skills: ['pdf'] }],
    });
    const result = getSkillAvailability({
      userAlias: 'tester',
      skillName: 'pdf',
      chatId: 'chat-1',
      agentName: 'Kobi',
    });
    expect(result.callableInCurrentChat).toBe(true);
    expect(result.currentAgentName).toBe('Kobi');
  });

  it('returns AGENT_NOT_RESOLVED for multi_agent when agentName not found', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'multi_agent',
      agents: [{ name: 'Other', skills: [] }],
    });
    const result = getSkillAvailability({
      userAlias: 'tester',
      skillName: 'pdf',
      chatId: 'chat-1',
      agentName: 'Kobi',
    });
    expect(result.reason).toBe('AGENT_NOT_RESOLVED');
  });

  it('returns installed=true but callableInCurrentChat=false when skill not in agent.skills', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: [] },
    });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf', chatId: 'chat-1' });
    expect(result.installed).toBe(true);
    expect(result.appliedToCurrentAgent).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
  });

  it('trims skillName before lookup', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: ['pdf'] },
    });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: '  pdf  ', chatId: 'chat-1' });
    expect(result.skillName).toBe('pdf');
    expect(result.installed).toBe(true);
  });
});
