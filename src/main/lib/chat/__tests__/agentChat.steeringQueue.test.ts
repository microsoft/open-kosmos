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

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
  },
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
  CancellationError: class CancellationError extends Error {},
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

function createUserMessage(id: string): UserMessage {
  return {
    id,
    role: 'user',
    timestamp: 123,
    content: [{ type: 'text', text: id }],
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

describe('AgentChat.steeringQueue facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueue delegates to runtime state', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));
    agent.steeringQueue.enqueue(createUserMessage('b'));

    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual(['a', 'b']);
  });

  it('update delegates to runtime state (in place) and does not re-add a missing id', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));

    const updatedPresent = agent.steeringQueue.update({ ...createUserMessage('a'), content: [{ type: 'text', text: 'edited' }] } as any);
    expect(updatedPresent).toBe(true);
    expect(((agent as any).runtimeState.queuedSteeringMessages[0].content[0] as any).text).toBe('edited');

    const updatedMissing = agent.steeringQueue.update(createUserMessage('gone'));
    expect(updatedMissing).toBe(false);
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual(['a']);
  });

  it('remove delegates to runtime state', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));
    agent.steeringQueue.enqueue(createUserMessage('b'));

    agent.steeringQueue.remove('a');
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual(['b']);
  });

  it('promote moves a message to the head and returns it', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));
    agent.steeringQueue.enqueue(createUserMessage('b'));

    const promoted = agent.steeringQueue.promote('b');
    expect(promoted?.id).toBe('b');
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual(['b', 'a']);
  });

  it('hasPending reflects whether the queue has a head', () => {
    const agent = createAgentChat();
    expect(agent.steeringQueue.hasPending()).toBe(false);

    agent.steeringQueue.enqueue(createUserMessage('a'));
    expect(agent.steeringQueue.hasPending()).toBe(true);

    agent.steeringQueue.clear();
    expect(agent.steeringQueue.hasPending()).toBe(false);
  });

  it('setEditing holds the head so hasPending/peek report nothing consumable', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));
    expect(agent.steeringQueue.hasPending()).toBe(true);

    // Holding the head (user editing it) makes it invisible to the drain.
    agent.steeringQueue.setEditing('a', true);
    expect(agent.steeringQueue.hasPending()).toBe(false);
    expect((agent as any).runtimeState.editingSteeringMessageId).toBe('a');
    // The facade accessor mirrors the held id for the remove-repump gate.
    expect(agent.steeringQueue.editingMessageId()).toBe('a');

    // Releasing it restores consumability.
    agent.steeringQueue.setEditing('a', false);
    expect(agent.steeringQueue.hasPending()).toBe(true);
    expect(agent.steeringQueue.editingMessageId()).toBeNull();
  });

  it('clear empties the queue', () => {
    const agent = createAgentChat();
    agent.steeringQueue.enqueue(createUserMessage('a'));
    agent.steeringQueue.enqueue(createUserMessage('b'));

    agent.steeringQueue.clear();
    expect((agent as any).runtimeState.queuedSteeringMessages).toEqual([]);
  });

  it('exposes only IPC-safe queue operations', () => {
    const agent = createAgentChat();

    expect(Object.keys(agent.steeringQueue).sort()).toEqual([
      'clear',
      'editingMessageId',
      'enqueue',
      'hasPending',
      'promote',
      'remove',
      'setEditing',
      'update',
    ]);
  });

  it('allows queued steering for local agents', () => {
    const agent = createAgentChat();

    expect(agent.canUseQueuedSteering()).toBe(true);
  });
});
