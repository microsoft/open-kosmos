import type { UserMessage } from '@shared/types/chatTypes';

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
  getModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: false, supports: { tool_calls: true, vision: false } })),
  getDefaultModel: vi.fn(() => 'gpt-5'),
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

vi.mock('../../mem0/openkosmos-adapters/OpenKosmosMemoryManager', async () => ({
  openkosmosMemoryManager: {},
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager, MockCancellationError } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
  },
  MockCancellationError: class MockCancellationError extends Error {},
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../chatSessionStore', async () => ({
  chatSessionStore: {},
}));

vi.mock('../../skill/skillManager', async () => ({
  skillManager: {},
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
  CancellationError: MockCancellationError,
  CancellationTokenStatic: {},
}));

vi.mock('../../token', async () => ({
  createTokenCounter: vi.fn(() => ({ countTokens: vi.fn(() => 0) })),
  TokenCounter: class TokenCounter {},
}));

vi.mock('../../compression/fullModeCompressor', async () => ({
  createFullModeCompressor: vi.fn(() => ({})),
  FullModeCompressor: class FullModeCompressor {},
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn(),
  detectTruncatedToolCalls: vi.fn(),
  sanitizeToolCallsForApi: vi.fn(),
  applyStorageCompressionToRecentMessages: vi.fn(),
}));

import { AgentChat } from '../agentChat';

function createUserMessage(): UserMessage {
  return {
    id: 'user_1',
    role: 'user',
    timestamp: 123,
    content: [{ type: 'text', text: 'hello' }],
  };
}

function createAgentChat() {
  mockProfileCacheManager.getChatConfig.mockReturnValue({
    chat_id: 'chat-1',
    agent: {
      role: 'assistant',
      emoji: '🤖',
      name: 'OpenKosmos',
      model: 'gpt-5',
      mcp_servers: [],
      system_prompt: '',
    },
  });

  const agent = new AgentChat('alias', 'chat-1', 'session-1', {
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test',
    last_updated: '2026-04-06T00:00:00.000Z',
  } as any);

  return agent;
}

describe('AgentChat.streamMessage remote session state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not trigger context compression during initialize', async () => {
    const agent = createAgentChat();
    const checkAndCompress = vi.fn().mockResolvedValue({ applied: true });
    const calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    (agent as any).getContextService = () => ({
      checkAndCompress,
    });
    (agent as any).calculateAndNotifyContext = calculateAndNotifyContext;
    (agent as any).saveChatSession = saveChatSession;

    await agent.initialize();

    expect(checkAndCompress).not.toHaveBeenCalled();
    expect(saveChatSession).not.toHaveBeenCalled();
    expect(calculateAndNotifyContext).toHaveBeenCalledTimes(1);
  });

  it('does not block initialize on asynchronous context stats calculation', async () => {
    const agent = createAgentChat();
    const checkAndCompress = vi.fn().mockResolvedValue({ applied: true });
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });
    let resolveContextRefresh: (() => void) | undefined;
    const calculateAndNotifyContext = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveContextRefresh = resolve;
      })
    );

    (agent as any).getContextService = () => ({
      checkAndCompress,
    });
    (agent as any).calculateAndNotifyContext = calculateAndNotifyContext;
    (agent as any).saveChatSession = saveChatSession;

    let initializeResolved = false;
    const initializePromise = agent.initialize().then(() => {
      initializeResolved = true;
    });

    await Promise.resolve();

    expect(initializeResolved).toBe(true);
    expect(checkAndCompress).not.toHaveBeenCalled();
    expect(saveChatSession).not.toHaveBeenCalled();
    expect(calculateAndNotifyContext).toHaveBeenCalledTimes(1);

    if (resolveContextRefresh) {
      resolveContextRefresh();
    }
    await initializePromise;
  });

  it('resets the remote-session flag after a successful streamed turn', async () => {
    const agent = createAgentChat();
    const runner = {
      runStreamMessage: vi.fn().mockResolvedValue([]),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage(), undefined, undefined, {
      isRemoteSession: true,
      emitUserMessage: true,
    });

    expect((agent as any).isRemoteSession).toBe(false);
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });

  it('resets the remote-session flag after a failed streamed turn', async () => {
    const agent = createAgentChat();
    const runner = {
      runStreamMessage: vi.fn().mockRejectedValue(new Error('boom')),
    };
    (agent as any).getTurnRunner = () => runner;

    await expect(agent.streamMessage(createUserMessage(), undefined, undefined, {
      isRemoteSession: true,
      emitUserMessage: true,
    })).rejects.toThrow('boom');

    expect((agent as any).isRemoteSession).toBe(false);
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });

  it('resets an explicit non-interactive policy after the turn completes', async () => {
    const agent = createAgentChat();
    (agent as any).blockedInteractionDetails = { error: 'stale' };
    const runner = {
      runStreamMessage: vi.fn().mockResolvedValue([]),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage(), undefined, undefined, {
      interactionPolicy: 'forbid',
    });

    expect((agent as any).interactionPolicy).toBe('allow-ui');
    expect((agent as any).blockedInteractionDetails).toBeNull();
  });
});