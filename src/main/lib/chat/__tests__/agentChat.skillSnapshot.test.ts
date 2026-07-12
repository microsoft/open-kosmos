vi.mock('../../security/securityValidator', async () => ({
  SecurityValidator: class SecurityValidator {},
  ApprovalRequestItem: class ApprovalRequestItem {},
  BatchValidationResult: class BatchValidationResult {},
  ToolCallValidationResult: class ToolCallValidationResult {},
}));

vi.mock('../../auth/ghcConfig', async () => ({
  GHC_CONFIG: {},
}));

vi.mock('../../utilities/errors', async () => ({
  GhcApiError: class GhcApiError extends Error {},
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn(),
  getModelCapabilities: vi.fn(),
  getDefaultModel: vi.fn(() => 'claude-sonnet-4.6'),
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: {},
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../utilities/contentUtils', async () => ({
  formatFileSize: vi.fn(),
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', async () => ({
  openkosmosPlaceholderManager: {},
  containsOpenKosmosPlaceholder: vi.fn(() => false),
}));

vi.mock('../../userDataADO/userInputPlaceholderParser', async () => ({
  userInputPlaceholderParser: {},
  UserInputField: class UserInputField {},
}));


vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
    getAllChatConfigs: vi.fn(),
    getCachedProfile: vi.fn(),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
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

vi.mock('../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    hasSkill: vi.fn(),
  },
}));

vi.mock('../chatSessionStore', async () => ({
  chatSessionStore: {},
}));

vi.mock('../../skill/skillManager', async () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: null })),
  },
}));

vi.mock('../globalSystemPrompt', async () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => []),
}));

vi.mock('../../featureFlags', async () => ({
  featureFlagManager: {},
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../cancellation', async () => ({
  CancellationToken: class CancellationToken {},
  CancellationError: class CancellationError extends Error {},
  CancellationTokenStatic: {},
}));

vi.mock('../../token', async () => ({
  createTokenCounter: vi.fn(),
  TokenCounter: class TokenCounter {},
}));

vi.mock('../../compression/fullModeCompressor', async () => ({
  createFullModeCompressor: vi.fn(),
  FullModeCompressor: class FullModeCompressor {},
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn(),
  detectTruncatedToolCalls: vi.fn(),
  sanitizeToolCallsForApi: vi.fn(),
  checkCompressionNeeds: vi.fn(),
  compressContextHistoryWithFullMode: vi.fn(),
  applyStorageCompressionToRecentMessages: vi.fn(),
  formatMessagesForApi: vi.fn(),
  hasImageContentInMessages: vi.fn(),
  convertMcpToolsToOpenAiFormat: vi.fn(),
  validateToolsRequest: vi.fn(),
  determineToolChoice: vi.fn(),
}));

import { MessageHelper } from '@shared/types/chatTypes';
import { AgentChatPromptService } from '../agentChatPromptService';
import { buildChatSkillSnapshot } from '../skillSnapshotBuilder';
import { chatSkillSnapshotStore } from '../../userDataADO/chatSkillSnapshotStore';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';

function createPromptServiceForSkillSnapshot() {
  return new AgentChatPromptService({
    getCurrentUserAlias: () => 'testUser',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'chatSession_20260324000000',
    getAgentName: () => 'Agent One',
    getLatestAgentConfig: () => null,
    getInteractionPolicy: () => 'allow-ui',
  });
}

describe('AgentChatPromptService skill snapshot behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileCacheManager.getCachedProfile.mockReturnValue({ skills: [] });
    vi.mocked(chatSkillSnapshotStore.get).mockReturnValue(undefined);
    vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
  });

  it('refreshes and persists a missing skill snapshot before the next turn', async () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: {
        role: 'assistant',
        emoji: '🤖',
        name: 'Agent One',
        model: 'claude-sonnet-4.6',
        mcp_servers: [],
        system_prompt: 'agent prompt',
        skills: ['pptx'],
      },
    });
    vi.mocked(skillsConfigManager.getSkills).mockReturnValue([
      {
        name: 'pptx',
        description: 'Create decks',
        version: '1.0.0',
        source: 'ON-DEVICE',
      },
    ] as any);

    const service = createPromptServiceForSkillSnapshot();

    await service.refreshSkillSnapshotIfNeeded();

    expect(chatSkillSnapshotStore.set).toHaveBeenCalledTimes(1);
    expect(chatSkillSnapshotStore.set).toHaveBeenCalledWith(
      'testUser',
      'chat-1',
      expect.objectContaining({
        binding_signature: '["pptx"]',
        skills: [
          expect.objectContaining({
            name: 'pptx',
            version: '1.0.0',
          }),
        ],
      }),
    );
  });

  it('skips persistence when the existing snapshot signatures still match', async () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'testUser',
      skillNames: ['pptx'],
      availableSkills: [
        {
          name: 'pptx',
          description: 'Create decks',
          version: '1.0.0',
          source: 'ON-DEVICE',
        },
      ],
    });

    mockProfileCacheManager.getChatConfig.mockReturnValue({
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: {
        role: 'assistant',
        emoji: '🤖',
        name: 'Agent One',
        model: 'claude-sonnet-4.6',
        mcp_servers: [],
        system_prompt: 'agent prompt',
        skills: ['pptx'],
      },
    });
    vi.mocked(chatSkillSnapshotStore.get).mockReturnValue(snapshot);
    vi.mocked(skillsConfigManager.getSkills).mockReturnValue([
      {
        name: 'pptx',
        description: 'Create decks',
        version: '1.0.0',
        source: 'ON-DEVICE',
      },
    ] as any);

    const service = createPromptServiceForSkillSnapshot();

    await service.refreshSkillSnapshotIfNeeded();

    expect(chatSkillSnapshotStore.set).not.toHaveBeenCalled();
  });

  it('injects the persisted skill snapshot prompt instead of live-resolving skills', () => {
    mockProfileCacheManager.getChatConfig.mockImplementation(() => ({
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: {
        role: 'assistant',
        emoji: '🤖',
        name: 'Agent One',
        model: 'claude-sonnet-4.6',
        mcp_servers: [],
        system_prompt: 'agent prompt',
        skills: ['missing-skill'],
      },
    }));
    vi.mocked(chatSkillSnapshotStore.get).mockReturnValue({
      binding_signature: '["missing-skill"]',
      registry_signature: '[]',
      generated_at: '2026-03-24T00:00:00.000Z',
      skills: [],
      prompt: '\n---\nSNAPSHOT_PROMPT_ONLY\n---',
    } as any);
    mockProfileCacheManager.getAllChatConfigs.mockReturnValue([
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          name: 'Agent One',
          model: 'claude-sonnet-4.6',
          mcp_servers: [],
          system_prompt: 'agent prompt',
          skills: ['missing-skill'],
        },
      },
    ]);
    vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);

    const service = createPromptServiceForSkillSnapshot();

    const messages = service.getAgentSpecificSystemPrompt();
    const text = MessageHelper.getText(messages[0]);

    expect(text).toContain('SNAPSHOT_PROMPT_ONLY');
    expect(text).not.toContain('No valid skills configured for this agent.');
  });
});