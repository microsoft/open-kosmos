const mockRemoveSkillsFromAgents = vi.fn();
const mockGetChatConfig = vi.fn();

vi.mock('../../../skill/removeSkillsFromAgents', async () => ({
  removeSkillsFromAgents: (...args: unknown[]) => mockRemoveSkillsFromAgents(...args),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    currentUserAlias: 'tester',
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
});