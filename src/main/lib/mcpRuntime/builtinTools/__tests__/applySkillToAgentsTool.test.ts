const {
  mockApplySkillToAgents,
  mockInstallAndActivateSkill,
  mockGetChatConfig,
  mockGetExecutionContext,
  mockHasSkill,
  mockGetSkills,
  mockGetSkill,
  profileCacheManagerMock,
} = vi.hoisted(() => {
  const mockApplySkillToAgents = vi.fn();
  const mockInstallAndActivateSkill = vi.fn();
  const mockGetChatConfig = vi.fn();
  const mockGetExecutionContext = vi.fn();
  const mockHasSkill = vi.fn();
  const mockGetSkills = vi.fn();
  const mockGetSkill = vi.fn();
  const profileCacheManagerMock = {
    currentUserAlias: 'tester' as string | null,
    getChatConfig: (...args: unknown[]) => mockGetChatConfig(...args),
  };

  return {
    mockApplySkillToAgents,
    mockInstallAndActivateSkill,
    mockGetChatConfig,
    mockGetExecutionContext,
    mockHasSkill,
    mockGetSkills,
    mockGetSkill,
    profileCacheManagerMock,
  };
});

vi.mock('../../../skill/applySkillToAgents', () => ({
  applySkillToAgents: (...args: unknown[]) => mockApplySkillToAgents(...args),
}));

vi.mock('../../../skill/installAndActivateSkill', () => ({
  installAndActivateSkill: (...args: unknown[]) => mockInstallAndActivateSkill(...args),
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: (...args: unknown[]) => mockGetSkills(...args),
    getSkill: (...args: unknown[]) => mockGetSkill(...args),
    hasSkill: (...args: unknown[]) => mockHasSkill(...args),
  },
}));

vi.mock('../builtinToolsManager', () => ({
  BuiltinToolsManager: {
    getExecutionContext: (...args: unknown[]) => mockGetExecutionContext(...args),
  },
}));

import { ApplySkillToAgentsTool } from '../applySkillToAgentsTool';

function applyResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    message: 'Applied skill to 1 agent.',
    skillName: 'demo-skill',
    appliedCount: 1,
    alreadyAppliedCount: 0,
    failedCount: 0,
    appliedTargets: [{ chatId: 'chat-1', agentName: 'Agent One' }],
    skippedTargets: [],
    error: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  profileCacheManagerMock.currentUserAlias = 'tester';
  mockHasSkill.mockReturnValue(true);
  mockGetSkills.mockReturnValue([]);
  mockGetSkill.mockReturnValue(undefined);
  mockGetExecutionContext.mockReturnValue({ userAlias: 'tester', chatId: 'chat-1', chatSessionId: 'session-1' });
  mockGetChatConfig.mockReturnValue({
    chat_type: 'single_agent',
    agent: { name: 'Agent One' },
  });
  mockApplySkillToAgents.mockResolvedValue(applyResult());
  mockInstallAndActivateSkill.mockResolvedValue({ success: true, message: 'Installed skill.', skillName: 'demo-skill' });
});

describe('ApplySkillToAgentsTool.getDefinition', () => {
  it('returns the apply_skill_to_agents schema', () => {
    const definition = ApplySkillToAgentsTool.getDefinition();

    expect(definition.name).toBe('apply_skill_to_agents');
    expect(definition.inputSchema.required).toEqual(['skill_name']);
    expect(definition.inputSchema.properties.source.enum).toEqual(['device']);
    expect(definition.description).toContain('Apply a skill');
  });
});

describe('ApplySkillToAgentsTool input and session validation', () => {
  it.each([
    { label: 'missing skill_name', args: {} },
    { label: 'empty skill_name', args: { skill_name: '' } },
    { label: 'whitespace skill_name', args: { skill_name: '   ' } },
    { label: 'non-string skill_name', args: { skill_name: 42 } },
  ])('rejects $label', async ({ args }) => {
    const result = await ApplySkillToAgentsTool.execute(args as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(mockHasSkill).not.toHaveBeenCalled();
  });

  it('returns NO_USER_SESSION when no current user alias exists', async () => {
    profileCacheManagerMock.currentUserAlias = null;

    const result = await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
    expect(mockHasSkill).not.toHaveBeenCalled();
  });
});

describe('ApplySkillToAgentsTool installed skill flow', () => {
  it('applies an installed skill to explicit targets without installing it again', async () => {
    const result = await ApplySkillToAgentsTool.execute({
      skill_name: '  demo-skill  ',
      agent_chat_ids: ['chat-2'],
      agent_names: ['Agent Two'],
      apply_to_all: false,
    });

    expect(result).toEqual({
      success: true,
      message: 'Applied skill to 1 agent.',
      skill_name: 'demo-skill',
      installed_in_this_call: false,
      applied_count: 1,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [{ chatId: 'chat-1', agentName: 'Agent One' }],
      skipped_targets: [],
      error: undefined,
    });
    expect(mockHasSkill).toHaveBeenCalledWith('tester', 'demo-skill');
    expect(mockInstallAndActivateSkill).not.toHaveBeenCalled();
    expect(mockApplySkillToAgents).toHaveBeenCalledWith('tester', {
      skillName: 'demo-skill',
      agentChatIds: ['chat-2'],
      agentNames: ['Agent Two'],
      applyToAll: false,
      requestSource: 'chat-tool',
    });
  });

  it('applies to the current single-agent chat when no explicit target is supplied', async () => {
    await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill' });

    expect(mockGetExecutionContext).toHaveBeenCalled();
    expect(mockGetChatConfig).toHaveBeenCalledWith('tester', 'chat-1');
    expect(mockApplySkillToAgents).toHaveBeenCalledWith('tester', {
      skillName: 'demo-skill',
      agentChatIds: ['chat-1'],
      agentNames: ['Agent One'],
      requestSource: 'chat-tool',
    });
  });

  it('does not send an agent name for a current multi-agent chat without a selected agent', async () => {
    mockGetChatConfig.mockReturnValue({ chat_type: 'multi_agent', agents: [{ name: 'Agent One' }] });

    await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill' });

    expect(mockApplySkillToAgents).toHaveBeenCalledWith('tester', {
      skillName: 'demo-skill',
      agentChatIds: ['chat-1'],
      agentNames: undefined,
      requestSource: 'chat-tool',
    });
  });

  it('returns NO_CONTEXT when default targeting has no active chat', async () => {
    mockGetExecutionContext.mockReturnValue({ userAlias: 'tester', chatSessionId: 'session-1' });

    const result = await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_CONTEXT');
    expect(mockApplySkillToAgents).not.toHaveBeenCalled();
  });

  it('returns CHAT_NOT_FOUND when the active chat cannot be loaded', async () => {
    mockGetChatConfig.mockReturnValue(null);

    const result = await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('CHAT_NOT_FOUND');
    expect(mockApplySkillToAgents).not.toHaveBeenCalled();
  });

  it('formats apply failures from the delegated apply helper', async () => {
    mockApplySkillToAgents.mockResolvedValue(applyResult({
      success: false,
      message: 'No target agents resolved for skill application.',
      appliedCount: 0,
      failedCount: 1,
      appliedTargets: [],
      skippedTargets: [{ chatId: 'chat-2', agentName: 'Missing', reason: 'AGENT_NOT_FOUND' }],
      error: 'NO_TARGETS',
    }));

    const result = await ApplySkillToAgentsTool.execute({
      skill_name: 'demo-skill',
      agent_names: ['Missing'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_TARGETS');
    expect(result.failed_count).toBe(1);
    expect(result.skipped_targets).toEqual([{ chatId: 'chat-2', agentName: 'Missing', reason: 'AGENT_NOT_FOUND' }]);
  });
});

describe('ApplySkillToAgentsTool installation flow', () => {
  it('returns SKILL_NOT_INSTALLED when source=device has no path', async () => {
    mockHasSkill.mockReturnValue(false);

    const result = await ApplySkillToAgentsTool.execute({ skill_name: 'demo-skill', source: 'device' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SKILL_NOT_INSTALLED');
    expect(mockInstallAndActivateSkill).not.toHaveBeenCalled();
    expect(mockApplySkillToAgents).not.toHaveBeenCalled();
  });

  it('requires a local path when the skill is not installed', async () => {
    mockHasSkill.mockReturnValue(false);

    const result = await ApplySkillToAgentsTool.execute({
      skill_name: 'demo-skill',
      agent_chat_ids: ['chat-1'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SKILL_NOT_INSTALLED');
    expect(mockInstallAndActivateSkill).not.toHaveBeenCalled();
    expect(mockApplySkillToAgents).not.toHaveBeenCalled();
  });

  it('installs a device skill from a trimmed path before applying it', async () => {
    mockHasSkill.mockReturnValue(false);

    await ApplySkillToAgentsTool.execute({
      skill_name: 'demo-skill',
      path: '  /Users/tester/skills/demo-skill  ',
      agent_names: ['Agent One'],
    });

    expect(mockInstallAndActivateSkill).toHaveBeenCalledWith({
      userAlias: 'tester',
      source: { type: 'device-path', value: '/Users/tester/skills/demo-skill' },
      requestSource: 'chat-tool',
      activation: { mode: 'install-only' },
    });
  });

  it('returns install failure details and does not apply when installation fails', async () => {
    mockHasSkill.mockReturnValue(false);
    mockInstallAndActivateSkill.mockResolvedValue({
      success: false,
      message: 'Skill package not found.',
      error: 'SKILL_PACKAGE_NOT_FOUND',
    });

    const result = await ApplySkillToAgentsTool.execute({
      skill_name: 'missing-skill',
      path: '/tmp/missing-skill',
      agent_chat_ids: ['chat-1'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Skill package not found.');
    expect(result.error).toBe('SKILL_PACKAGE_NOT_FOUND');
    expect(result.install_attempted).toBe(true);
    expect(mockApplySkillToAgents).not.toHaveBeenCalled();
  });

  it('uses fallback install failure fields when the installer omits details', async () => {
    mockHasSkill.mockReturnValue(false);
    mockInstallAndActivateSkill.mockResolvedValue({ success: false });

    const result = await ApplySkillToAgentsTool.execute({
      skill_name: 'unknown-skill',
      path: '/tmp/unknown-skill',
      agent_chat_ids: ['chat-1'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to install skill "unknown-skill".');
    expect(result.error).toBe('INSTALL_FAILED');
  });
});
