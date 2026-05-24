import { getSkillAvailability } from '../skillAvailability';
import { profileCacheManager } from '../../userDataADO';

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
  },
}));

describe('getSkillAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns callable when installed and applied to the single current agent', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });
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

  it('returns not resolved for multi-agent chat without explicit agent target', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });
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