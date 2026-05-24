import { type Message } from '@shared/types/chatTypes';
import { deserializeMessage } from '@shared/utils/deserialize-message';

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
  getDefaultModel: vi.fn(),
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: {},
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

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

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {},
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

import { AgentChatSessionService } from '../agentChatSessionService';

function createTextMessage(id: string, role: 'user' | 'assistant' | 'system', text: string, timestamp: number) {
  return deserializeMessage({ id, role, timestamp, content: [{ type: 'text', text }] });
}

function createSessionServiceForEdit(sessionOverrides?: {
  chatHistory?: Message[];
  contextHistory?: Message[];
  title?: string;
}) {
  const currentChatSession = {
    chat_history: sessionOverrides?.chatHistory ?? [],
    context_history: sessionOverrides?.contextHistory ?? [],
    last_updated: '2026-03-20T00:00:00.000Z',
    title: sessionOverrides?.title ?? 'Existing Title',
  };
  let firstUserMessage: Message | null = null;
  const setMessagesToSave = vi.fn();

  const service = new AgentChatSessionService({
    getCurrentChatSession: () => currentChatSession as any,
    setCurrentChatSession: vi.fn(),
    getCurrentUserAlias: () => 'user',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getAgentName: () => 'OpenKosmos',
    getFirstUserMessage: () => firstUserMessage,
    setFirstUserMessage: (message) => { firstUserMessage = message; },
    getSchedulerMetadata: () => ({}),
    getMessagesToSave: () => [],
    setMessagesToSave,
    getSaveChain: () => Promise.resolve({ success: true }),
    setSaveChain: vi.fn(),
    addMessageToChatHistory: vi.fn(),
    addMessageToContext: vi.fn().mockResolvedValue(undefined),
    shouldTrackChatSessionActivatedForUserMessage: () => false,
    getChatSessionEntryTypeForUserMessage: () => 'continued',
    trackChatSessionActivated: vi.fn(),
    exitNewChatSessionState: vi.fn(),
    calculateAndNotifyContext: vi.fn().mockResolvedValue(undefined),
    startChat: vi.fn().mockResolvedValue(undefined),
    getDisplayMessages: () => currentChatSession.chat_history as any,
    getSkipPersistence: () => false,
  });

  service.saveChatSession = vi.fn().mockResolvedValue({ success: true });

  return { service, currentChatSession, getFirstUserMessage: () => firstUserMessage, setMessagesToSave };
}

describe('AgentChatSessionService.editUserMessage', () => {
  it('replaces the selected user message, truncates downstream history, and regenerates', async () => {
    const firstUser = createTextMessage('user_1', 'user', 'first prompt', 1000);
    const firstAssistant = createTextMessage('assistant_1', 'assistant', 'first answer', 1001);
    const targetUser = createTextMessage('user_2', 'user', 'old prompt', 1002);
    const downstreamAssistant = createTextMessage('assistant_2', 'assistant', 'old answer', 1003);
    const toolMessage: Message = {
      id: 'tool_1',
      role: 'tool',
      name: 'write_file',
      tool_call_id: 'tool_call_1',
      timestamp: 1004,
      streamingComplete: true,
      content: [{ type: 'text', text: 'done' }],
    };

    const { service, currentChatSession, setMessagesToSave } = createSessionServiceForEdit({
      chatHistory: [firstUser, firstAssistant, targetUser, downstreamAssistant, toolMessage],
      contextHistory: [firstUser, firstAssistant, targetUser, downstreamAssistant, toolMessage],
    });

    const updatedMessage = createTextMessage('draft_id', 'user', 'new prompt', 9999);

    const result = await service.editUserMessage('user_2', updatedMessage);

    expect(currentChatSession.chat_history).toEqual([
      firstUser,
      firstAssistant,
      expect.objectContaining({
        id: 'user_2',
        role: 'user',
        timestamp: 1002,
        content: [{ type: 'text', text: 'new prompt' }],
      }),
    ]);
    expect(currentChatSession.context_history).toEqual(currentChatSession.chat_history);
    expect(service.saveChatSession).toHaveBeenCalledTimes(1);
    expect(setMessagesToSave).toHaveBeenCalledWith([]);
    expect(result).toEqual(currentChatSession.chat_history);
  });

  it('allows editing an older user message when it is still present in context history', async () => {
    const firstUser = createTextMessage('user_1', 'user', 'first prompt', 1000);
    const firstAssistant = createTextMessage('assistant_1', 'assistant', 'first answer', 1001);
    const laterUser = createTextMessage('user_2', 'user', 'later prompt', 1002);
    const laterAssistant = createTextMessage('assistant_2', 'assistant', 'later answer', 1003);

    const { service, currentChatSession } = createSessionServiceForEdit({
      chatHistory: [firstUser, firstAssistant, laterUser, laterAssistant],
      contextHistory: [firstUser, firstAssistant, laterUser, laterAssistant],
    });

    const result = await service.editUserMessage(
      'user_1',
      createTextMessage('draft_id', 'user', 'edited first prompt', 2000),
    );

    expect(currentChatSession.chat_history).toEqual([
      expect.objectContaining({
        id: 'user_1',
        content: [{ type: 'text', text: 'edited first prompt' }],
      }),
    ]);
    expect(currentChatSession.context_history).toEqual(currentChatSession.chat_history);
    expect(service.saveChatSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual(currentChatSession.chat_history);
  });

  it('resets the session title when editing the first user message', async () => {
    const firstUser = createTextMessage('user_1', 'user', 'initial prompt', 1000);
    const firstAssistant = createTextMessage('assistant_1', 'assistant', 'initial answer', 1001);

    const { service, currentChatSession, getFirstUserMessage } = createSessionServiceForEdit({
      chatHistory: [firstUser, firstAssistant],
      contextHistory: [firstUser, firstAssistant],
      title: 'Old Title',
    });

    await service.editUserMessage('user_1', createTextMessage('draft_id', 'user', 'rewritten prompt', 2000));

    expect(currentChatSession.title).toBe('New Chat');
    expect(getFirstUserMessage()).toEqual(
      expect.objectContaining({
        id: 'user_1',
        content: [{ type: 'text', text: 'rewritten prompt' }],
      }),
    );
  });

  it('prevents editing when a user message is no longer present in context history', () => {
    const targetUser = createTextMessage('user_2', 'user', 'latest prompt', 1002);
    const { service } = createSessionServiceForEdit({
      chatHistory: [targetUser],
      contextHistory: [],
    });

    expect(service.validateUserMessageEditable('user_2')).toEqual({
      canEdit: false,
      targetUserIndex: 0,
      targetUserMessage: targetUser,
      targetContextUserIndex: -1,
      error: 'This message can no longer be edited because its original content has been compressed out of the current context.',
    });
  });
});
