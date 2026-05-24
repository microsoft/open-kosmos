import { getSkillAvailability } from '../skillAvailability';
import { profileCacheManager } from '../../userDataADO';

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
  },
}));

describe('getSkillAvailability — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not installed when profile is null', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue(null);
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf' });
    expect(result.installed).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
  });

  it('returns installed=false with no chatId when skill is not in profile', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [] });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf' });
    expect(result.installed).toBe(false);
    expect(result.callableInCurrentChat).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns CHAT_NOT_FOUND when chatConfig is null', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf', chatId: 'chat-1' });
    expect(result.installed).toBe(true);
    expect(result.reason).toBe('CHAT_NOT_FOUND');
    expect(result.callableInCurrentChat).toBe(false);
  });

  it('returns AGENT_NOT_RESOLVED when single_agent chat has no agent', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      // no agent field
    });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: 'pdf', chatId: 'chat-1' });
    expect(result.reason).toBe('AGENT_NOT_RESOLVED');
  });

  it('resolves multi_agent chat when agentName provided and matched', () => {
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
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
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
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
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
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
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: ['pdf'] },
    });
    const result = getSkillAvailability({ userAlias: 'tester', skillName: '  pdf  ', chatId: 'chat-1' });
    expect(result.skillName).toBe('pdf');
    expect(result.installed).toBe(true);
  });
});
