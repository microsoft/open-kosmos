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

describe('getSkillAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(true);
  });

  it('returns callable when installed and applied to the single current agent', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: ['pdf'] },
    });

    const result = getSkillAvailability({
      userAlias: 'tester',
      skillName: 'pdf',
      chatId: 'chat-1',
    });

    expect(result.installed).toBe(true);
    expect(result.appliedToCurrentAgent).toBe(true);
    expect(result.callableInCurrentChat).toBe(true);
    expect(result.currentAgentName).toBe('Kobi');
  });

  it('treats an agent with no skills array as not applied', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi' },
    });

    const result = getSkillAvailability({
      userAlias: 'tester',
      skillName: 'pdf',
      chatId: 'chat-1',
    });

    expect(result.installed).toBe(true);
    expect(result.appliedToCurrentAgent).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
    expect(result.currentAgentName).toBe('Kobi');
  });

  it('returns not resolved for multi-agent chat without explicit agent target', () => {
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'multi_agent',
      agents: [{ name: 'Kobi', skills: ['pdf'] }],
    });

    const result = getSkillAvailability({
      userAlias: 'tester',
      skillName: 'pdf',
      chatId: 'chat-1',
    });

    expect(result.installed).toBe(true);
    expect(result.appliedToCurrentAgent).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
    expect(result.reason).toBe('AGENT_NOT_RESOLVED');
  });
});