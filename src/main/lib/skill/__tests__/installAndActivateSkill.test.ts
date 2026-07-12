import { installAndActivateSkill } from '../installAndActivateSkill';
import { addSkillFromDevice } from '../skillDeviceImporter';
import { applySkillToAgents } from '../applySkillToAgents';
import { profileCacheManager } from '../../userDataADO';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';

const mockRecordCompleted = vi.fn();
const mockRecordAbandoned = vi.fn();

vi.mock('../skillDeviceImporter', async () => ({
  addSkillFromDevice: vi.fn(),
}));

vi.mock('../applySkillToAgents', async () => ({
  applySkillToAgents: vi.fn(),
}));


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

describe('installAndActivateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordCompleted.mockResolvedValue(undefined);
    mockRecordAbandoned.mockResolvedValue(undefined);
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(true);
  });

  it('installs and applies to the current single-agent chat', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true,
      message: 'Applied skill "pdf" to 1 agent.',
      skillName: 'pdf',
      appliedCount: 1,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [{ chatId: 'chat-1', agentName: 'Kobi' }],
      skippedTargets: [],
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });
    (profileCacheManager.getChatConfig as Mock)
      .mockReturnValueOnce({
        chat_type: 'single_agent',
        agent: { name: 'Kobi', skills: [] },
      })
      .mockReturnValueOnce({
        chat_type: 'single_agent',
        agent: { name: 'Kobi', skills: [] },
      })
      .mockReturnValueOnce({
        chat_type: 'single_agent',
        agent: { name: 'Kobi', skills: ['pdf'] },
      });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf-skill' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_and_callable');
    expect(result.currentChat.callable).toBe(true);
    expect(result.currentChat.agentName).toBe('Kobi');
    expect(applySkillToAgents).toHaveBeenCalledWith('tester', {
      skillName: 'pdf',
      targets: [{ chatId: 'chat-1', agentName: 'Kobi' }],
      requestSource: undefined,
    });
  });

  it('installs but requests target selection when current chat agent is ambiguous', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'multi_agent',
      agents: [{ name: 'Kobi', skills: [] }, { name: 'Reviewer', skills: [] }],
    });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf-skill' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_but_needs_target_selection');
    expect(result.currentChat.callable).toBe(false);
    expect(applySkillToAgents).not.toHaveBeenCalled();
  });

});