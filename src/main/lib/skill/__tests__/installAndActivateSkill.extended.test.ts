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

describe('installAndActivateSkill — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordCompleted.mockResolvedValue(undefined);
    mockRecordAbandoned.mockResolvedValue(undefined);
    (skillsConfigManager.hasSkill as Mock).mockReturnValue(true);
  });

  // ─── install failures ────────────────────────────────────────────────────

  it('returns failed result when device install fails', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: false,
      skillName: '',
      error: 'FILE_NOT_FOUND',
    });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/bad/path' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('failed');
    expect(result.error).toBe('FILE_NOT_FOUND');
  });

  // ─── install-only mode ───────────────────────────────────────────────────

  it('install-only: already_callable when skill is already callable', async () => {
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
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: ['pdf'] },
    });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'install-only', chatId: 'chat-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('already_callable');
    expect(applySkillToAgents).not.toHaveBeenCalled();
  });

  it('install-only: installed_but_not_applied when not callable', async () => {
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
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'install-only', chatId: 'chat-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_but_not_applied');
    expect(applySkillToAgents).not.toHaveBeenCalled();
    // install-only mode does NOT trigger abandoned telemetry (condition: mode !== 'install-only')
    expect(mockRecordAbandoned).not.toHaveBeenCalled();
  });

  // ─── selected-agents mode ────────────────────────────────────────────────

  it('selected-agents: applies to explicit targets', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true,
      message: 'Applied',
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
      .mockReturnValueOnce(null) // availability before
      .mockReturnValueOnce({
        chat_type: 'single_agent',
        agent: { name: 'Kobi', skills: ['pdf'] },
      }); // availability after

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: {
        mode: 'selected-agents',
        chatId: 'chat-1',
        targets: [{ chatId: 'chat-1', agentName: 'Kobi' }],
      },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_and_callable');
  });

  it('selected-agents: empty targets => installed_but_not_applied', async () => {
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
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: {
        mode: 'selected-agents',
        chatId: 'chat-1',
        targets: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_but_not_applied');
  });

  // ─── all-agents mode ─────────────────────────────────────────────────────

  it('all-agents: applies to every agent across all chats', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'A', skills: [] },
        },
        {
          chat_id: 'chat-2',
          chat_type: 'multi_agent',
          agents: [{ name: 'B', skills: [] }, { name: 'C', skills: [] }],
        },
      ],
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true,
      message: 'Applied',
      skillName: 'pdf',
      appliedCount: 3,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [
        { chatId: 'chat-1', agentName: 'A' },
        { chatId: 'chat-2', agentName: 'B' },
        { chatId: 'chat-2', agentName: 'C' },
      ],
      skippedTargets: [],
    });
    (profileCacheManager.getChatConfig as Mock)
      .mockReturnValueOnce(null) // availability before
      .mockReturnValueOnce({
        chat_type: 'single_agent',
        agent: { name: 'A', skills: ['pdf'] },
      }); // availability after

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'all-agents', chatId: 'chat-1' },
    });

    expect(result.success).toBe(true);
    expect(applySkillToAgents).toHaveBeenCalledWith('tester', expect.objectContaining({
      skillName: 'pdf',
      targets: expect.arrayContaining([
        { chatId: 'chat-1', agentName: 'A' },
        { chatId: 'chat-2', agentName: 'B' },
        { chatId: 'chat-2', agentName: 'C' },
      ]),
    }));
  });

  it('all-agents: installed_but_not_applied when apply does not make skill callable', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: { name: 'A', skills: [] },
        },
      ],
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: false,
      message: 'Failed',
      skillName: 'pdf',
      appliedCount: 1,
      alreadyAppliedCount: 0,
      failedCount: 1,
      appliedTargets: [{ chatId: 'chat-1', agentName: 'A' }],
      skippedTargets: [{ chatId: 'chat-1', agentName: 'A', reason: 'UPDATE_FAILED' }],
      error: 'NO_AGENT_UPDATES',
    });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'all-agents', chatId: 'chat-1' },
    });

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('installed_but_not_applied');
    expect(result.error).toBe('NO_AGENT_UPDATES');
  });

  // ─── exception handling ──────────────────────────────────────────────────

  it('catches unexpected error and returns failed result', async () => {
    (addSkillFromDevice as Mock).mockRejectedValue(new Error('Unexpected crash'));

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('failed');
    expect(result.error).toBe('Unexpected crash');
  });

  it('catches non-Error exception', async () => {
    (addSkillFromDevice as Mock).mockRejectedValue('string error');

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('UNKNOWN_ERROR');
  });

  // ─── already_callable resolution ─────────────────────────────────────────

  it('returns already_callable when skill was callable before apply', async () => {
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
    // Both before and after availability: callable
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Kobi', skills: ['pdf'] },
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true,
      message: 'Already applied',
      skillName: 'pdf',
      appliedCount: 0,
      alreadyAppliedCount: 1,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [{ chatId: 'chat-1', agentName: 'Kobi', reason: 'ALREADY_APPLIED' }],
    });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent', chatId: 'chat-1' },
    });

    expect(result.resolution).toBe('already_callable');
    expect(result.currentChat.callable).toBe(true);
  });

  // ─── multi_agent current-agent resolve ────────────────────────────────────

  it('current-agent: resolves for multi_agent when agentName matches', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true,
      message: 'Applied',
      skillName: 'pdf',
      appliedCount: 1,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [{ chatId: 'chat-2', agentName: 'Kobi' }],
      skippedTargets: [],
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });
    // availability-before: multi_agent without agentName match => not callable
    // resolveCurrentAgentTarget call => multi_agent with agentName 'Kobi'
    // availability-after: callable
    (profileCacheManager.getChatConfig as Mock)
      .mockReturnValueOnce({
        chat_type: 'multi_agent',
        agents: [{ name: 'Kobi', skills: [] }],
      })
      .mockReturnValueOnce({
        chat_type: 'multi_agent',
        agents: [{ name: 'Kobi', skills: [] }],
      })
      .mockReturnValueOnce({
        chat_type: 'multi_agent',
        agents: [{ name: 'Kobi', skills: ['pdf'] }],
      });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent', chatId: 'chat-2', agentName: 'Kobi' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_and_callable');
    expect(applySkillToAgents).toHaveBeenCalledWith('tester', expect.objectContaining({
      skillName: 'pdf',
      targets: [{ chatId: 'chat-2', agentName: 'Kobi' }],
    }));
  });

  // ─── buildResult with undefined appliedTargets ───────────────────────────

  it('activation.success is false when appliedTargets is not provided (install-only path)', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'install-only' },
    });

    expect(result.activation.success).toBe(false);
  });

  // ─── install-only with no chatId ─────────────────────────────────────────

  it('current-agent: resolveCurrentAgentTarget returns null when no chatId', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent' }, // no chatId
    });

    // resolveCurrentAgentTarget returns null => installed_but_needs_target_selection
    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_but_needs_target_selection');
  });

  it('current-agent: resolveCurrentAgentTarget returns null when chatConfig not found', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'folder',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    // getSkillAvailability: getChatConfig returns null
    // resolveCurrentAgentTarget: getChatConfig returns null
    (profileCacheManager.getChatConfig as Mock).mockReturnValue(null);

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'current-agent', chatId: 'nonexistent-chat' },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('installed_but_needs_target_selection');
  });

  it('install-only: works without chatId', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true,
      skillName: 'pdf',
      skillVersion: '1.0.0',
      isOverwrite: false,
      inputType: 'zip',
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({
      skills: [{ name: 'pdf' }],
    });

    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf.zip' },
      activation: { mode: 'install-only' },
    });

    expect(result.success).toBe(true);
    expect(result.inputType).toBe('zip');
  });

  it('multi_agent current chat with matching agent name is callable', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({
      success: true, skillName: 'pdf', skillVersion: '1.0.0', isOverwrite: true, inputType: 'folder',
    });
    (applySkillToAgents as Mock).mockResolvedValue({
      success: true, skillName: 'pdf', appliedCount: 1, alreadyAppliedCount: 0, failedCount: 0,
      appliedTargets: [{ chatId: 'chat-1', agentName: 'Kobi' }], skippedTargets: [],
    });
    (profileCacheManager.getCachedProfile as Mock).mockReturnValue({ skills: [{ name: 'pdf' }] });
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      chat_type: 'multi_agent', agents: [{ name: 'Kobi', skills: ['pdf'] }],
    });
    const result = await installAndActivateSkill({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/tmp/pdf' },
      activation: { mode: 'selected-agents', chatId: 'chat-1', agentName: 'Kobi', targets: [{ chatId: 'chat-1', agentName: 'Kobi' }] },
    });
    expect(result.success).toBe(true);
  });

  it('device install failure without error/skillName uses fallbacks', async () => {
    (addSkillFromDevice as Mock).mockResolvedValue({ success: false });
    const result = await installAndActivateSkill({
      userAlias: 'tester', source: { type: 'device-path', value: '/tmp/pdf' }, activation: { mode: 'install-only' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INSTALL_FAILED');
  });

});
