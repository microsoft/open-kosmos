const mockRemoveSkillsFromAgents = vi.fn();
const mockGetChatConfig = vi.fn();
let mockCurrentUserAlias: string | null = 'tester';

vi.mock('../../../skill/removeSkillsFromAgents', async () => ({
  removeSkillsFromAgents: (...args: unknown[]) => mockRemoveSkillsFromAgents(...args),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return mockCurrentUserAlias;
    },
    getChatConfig: (...args: unknown[]) => mockGetChatConfig(...args),
  },
}));

let mockExecutionContext: any = null;
vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: () => mockExecutionContext,
  },
}));

import { RemoveSkillsFromAgentsTool } from '../removeSkillsFromAgentsTool';

describe('RemoveSkillsFromAgentsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUserAlias = 'tester';
    mockExecutionContext = { chatId: 'chat-1', userAlias: 'tester', chatSessionId: 'session-1' };
    mockRemoveSkillsFromAgents.mockResolvedValue({
      success: true,
      skillNames: ['pptx'],
      message: 'Removed 1 skill binding from 1 agent.',
      updatedAgentCount: 1,
      removedBindingCount: 1,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [{ chatId: 'chat-1', agentName: 'Deck Builder', removedSkills: ['pptx'] }],
      skippedTargets: [],
      error: undefined,
    });
  });

  it('exposes a well-formed tool definition', () => {
    const def = RemoveSkillsFromAgentsTool.getDefinition();
    expect(def.name).toBe('remove_skills_from_agents');
    expect(def.inputSchema.required).toEqual(['skill_names']);
    expect(def.inputSchema.properties).toHaveProperty('remove_from_all');
  });

  it('defaults to the current single-agent chat agent', async () => {
    mockGetChatConfig.mockReturnValue({
      chat_type: 'single_agent',
      agent: { name: 'Deck Builder' },
    });

    const result = await RemoveSkillsFromAgentsTool.execute({
      skill_names: ['pptx'],
    });

    expect(mockRemoveSkillsFromAgents).toHaveBeenCalledWith('tester', {
      skillNames: ['pptx'],
      targets: [{ chatId: 'chat-1', agentName: 'Deck Builder' }],
    });
    expect(result.success).toBe(true);
  });

  it('requires explicit agent_names for multi-agent current chat defaults', async () => {
    mockGetChatConfig.mockReturnValue({
      chat_type: 'multi_agent',
      agents: [{ name: 'Designer' }, { name: 'Reviewer' }],
    });

    const result = await RemoveSkillsFromAgentsTool.execute({
      skill_names: ['pptx'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('AMBIGUOUS_CURRENT_AGENT');
    expect(mockRemoveSkillsFromAgents).not.toHaveBeenCalled();
  });

  it('rejects an empty skill list', async () => {
    const result = await RemoveSkillsFromAgentsTool.execute({ skill_names: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(mockRemoveSkillsFromAgents).not.toHaveBeenCalled();
  });

  it('rejects when skill_names is omitted entirely', async () => {
    const result = await RemoveSkillsFromAgentsTool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('normalizes null, blank, and duplicate skill names before removing', async () => {
    const result = await RemoveSkillsFromAgentsTool.execute({
      skill_names: [null as unknown as string, '  ', 'pptx', 'pptx'],
      remove_from_all: true,
    });

    expect(mockRemoveSkillsFromAgents).toHaveBeenCalledWith('tester', {
      skillNames: ['pptx'],
      agentChatIds: undefined,
      agentNames: undefined,
      removeFromAll: true,
    });
    expect(result.success).toBe(true);
  });

  it('returns NO_USER_SESSION when there is no signed-in alias', async () => {
    mockCurrentUserAlias = null;
    const result = await RemoveSkillsFromAgentsTool.execute({ skill_names: ['pptx'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
  });

  it('returns NO_CONTEXT when no targets and no active chat context', async () => {
    mockExecutionContext = null;
    const result = await RemoveSkillsFromAgentsTool.execute({ skill_names: ['pptx'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_CONTEXT');
  });

  it('returns CHAT_NOT_FOUND when the current chat cannot be resolved', async () => {
    mockGetChatConfig.mockReturnValue(null);
    const result = await RemoveSkillsFromAgentsTool.execute({ skill_names: ['pptx'] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('CHAT_NOT_FOUND');
  });

  it('targets explicit agent_names without touching the current chat context', async () => {
    const result = await RemoveSkillsFromAgentsTool.execute({
      skill_names: ['pptx'],
      agent_names: ['Reviewer'],
    });

    expect(mockGetChatConfig).not.toHaveBeenCalled();
    expect(mockRemoveSkillsFromAgents).toHaveBeenCalledWith('tester', {
      skillNames: ['pptx'],
      agentChatIds: undefined,
      agentNames: ['Reviewer'],
      removeFromAll: undefined,
    });
    expect(result.success).toBe(true);
  });

  it('targets explicit agent_chat_ids', async () => {
    const result = await RemoveSkillsFromAgentsTool.execute({
      skill_names: ['pptx'],
      agent_chat_ids: ['chat-9'],
    });

    expect(mockRemoveSkillsFromAgents).toHaveBeenCalledWith('tester', {
      skillNames: ['pptx'],
      agentChatIds: ['chat-9'],
      agentNames: undefined,
      removeFromAll: undefined,
    });
    expect(result.success).toBe(true);
  });
});
