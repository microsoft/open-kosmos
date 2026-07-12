import { type Message, MessageHelper } from '@shared/types/chatTypes';

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
  featureFlagManager: {
    isEnabled: vi.fn(() => false),
  },
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

import { AgentChatContextService } from '../agentChatContextService';
import { getEndpointForModel } from '../../llm/ghcModelApi';
import {
  checkCompressionNeeds,
  compressContextHistoryWithFullMode,
  formatMessagesForApi,
} from '../agentChatUtilities';

const createTextMessage = MessageHelper.createTextMessage;

function createContextService() {
  const currentChatSession = {
    chat_history: [],
    context_history: [],
    last_updated: '2026-03-20T00:00:00.000Z',
    title: 'Existing Title',
  };

  const service = new AgentChatContextService({
    getCurrentChatSession: () => currentChatSession as any,
    getCurrentUserAlias: () => 'user',
    getAgentName: () => 'OpenKosmos',
    getLatestAgentConfig: () => null,
    getCurrentModelId: () => 'gpt-5',
    getModelCapabilities: vi.fn() as any,
    getContextHistory: () => currentChatSession.context_history as any,
    getChatHistory: () => currentChatSession.chat_history as any,
    getCombinedSystemPromptForCurrentTurn: vi.fn() as any,
    getCurrentAvailableTools: vi.fn() as any,
    getTokenCounter: vi.fn() as any,
    getFullModeCompressor: vi.fn() as any,
    setChatStatus: vi.fn() as any,
    setContextHistory: vi.fn(),
    setLastUpdated: (timestamp) => {
      currentChatSession.last_updated = timestamp;
    },
    getContextChangeListeners: () => [],
    getLatestContextStats: () => null,
    setLatestContextStats: vi.fn(),
    setContextTokenUsage: vi.fn(),
  });

  service.calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);

  return { service, currentChatSession };
}

describe('AgentChatContextService compression and token gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEndpointForModel as Mock).mockReturnValue('/chat/completions');
  });

  it('counts tokens on the formatted API payload with image data stripped', async () => {
    const { service } = createContextService();
    const tokenCounter = {
      countTextTokens: vi.fn(() => 220),
      countMessagesTokens: vi.fn(() => 15),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 30 })),
    };
    const contextHistory = [createTextMessage('hello', 'user', 'user_1')];
    const systemMessages = [createTextMessage('system prompt', 'system', 'system_1')];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue(systemMessages);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool-a' }]);
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ]);

    await expect(service.calculateThreeComponentTokens()).resolves.toEqual({
      contextHistoryTokens: 214,
      systemPromptTokens: 15,
      toolsTokens: 30,
      totalTokens: 259,
    });

    expect(formatMessagesForApi).toHaveBeenCalledWith(
      systemMessages,
      contextHistory,
      true,
      '/chat/completions',
    );
    expect(tokenCounter.countTextTokens).toHaveBeenCalled();
    expect(tokenCounter.countMessagesTokens).toHaveBeenCalledWith(systemMessages);
  });

  it('strips base64 image data before text counting and adds image tokens separately', async () => {
    const { service } = createContextService();
    const base64Data = 'A'.repeat(5000);
    const imageMessage: Message = {
      id: 'img_1',
      role: 'user',
      timestamp: Date.now(),
      content: [
        { type: 'text', text: 'describe this' },
        {
          type: 'image',
          image_url: {
            url: `data:image/jpeg;base64,${base64Data}`,
            detail: 'low',
          },
          metadata: {
            fileName: 'test.png',
            fileSize: 3816,
            width: 512,
            height: 299,
            mimeType: 'image/png',
          },
        } as any,
      ],
    };
    const tokenCounter = {
      countTextTokens: vi.fn((text: string) => {
        if (text.includes(base64Data)) {
          throw new Error('base64 image data should have been stripped before text counting');
        }
        return 50;
      }),
      countMessagesTokens: vi.fn(() => 10),
      countImageTokens: vi.fn(() => ({ tokens: 85 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
    };

    (service as any).deps.getContextHistory = () => [imageMessage];
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: 'low' } },
        ],
      },
    ]);

    const result = await service.calculateThreeComponentTokens();

    expect(result.totalTokens).toBe(141);
    expect(tokenCounter.countImageTokens).toHaveBeenCalledWith({
      detail: 'low',
      width: 512,
      height: 299,
    });
  });

  it('accounts for file attachment metadata injected by formatMessagesForApi', async () => {
    const { service } = createContextService();
    const contextHistory = [createTextMessage('check this file', 'user', 'user_1')];
    const systemMessages = [createTextMessage('system prompt', 'system', 'system_1')];
    const tokenCounter = {
      countTextTokens: vi.fn(() => 300),
      countMessagesTokens: vi.fn(() => 15),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
    };

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue(systemMessages);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'check this file\n\n📁 **Text Files List:**\n- config.json (JSON, 50 lines)\n💡 Tip: use read_file' },
    ]);

    const result = await service.calculateThreeComponentTokens();

    expect(result.totalTokens).toBe(309);
    expect(formatMessagesForApi).toHaveBeenCalled();
    expect(tokenCounter.countTextTokens).toHaveBeenCalled();
    const countedPayload = (tokenCounter.countTextTokens as Mock).mock.calls[0][0] as string;
    expect(countedPayload).toContain('Text Files List');
  });

  it('marks compression complete only when a compacted history is applied', async () => {
    const { service } = createContextService();
    const setChatStatus = vi.fn();
    const setContextHistory = vi.fn();
    const setLastUpdated = vi.fn();
    const contextHistory = [
      createTextMessage('first', 'user', 'user_1'),
      createTextMessage('middle', 'assistant', 'assistant_1'),
      createTextMessage('last', 'user', 'user_2'),
    ];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ maxContextLength: 100, supportsTools: true }));
    (service as any).deps.setChatStatus = setChatStatus;
    (service as any).deps.setContextHistory = setContextHistory;
    (service as any).deps.setLastUpdated = setLastUpdated;
    (checkCompressionNeeds as Mock).mockResolvedValue(true);
    (compressContextHistoryWithFullMode as Mock).mockResolvedValue({
      success: true,
      compressedMessages: [contextHistory[0], contextHistory[2]],
    });

    await service.checkAndCompress();

    expect(setContextHistory).toHaveBeenCalledWith([contextHistory[0], contextHistory[2]]);
    expect(setChatStatus).toHaveBeenNthCalledWith(1, 'compressing_context');
    expect(setChatStatus).toHaveBeenNthCalledWith(2, 'compressed_context');
    expect(setLastUpdated).toHaveBeenCalledTimes(1);
  });

  it('does not emit compressed_context when compaction produces no applied result', async () => {
    const { service } = createContextService();
    const setChatStatus = vi.fn();
    const setContextHistory = vi.fn();
    const contextHistory = [
      createTextMessage('first', 'user', 'user_1'),
      createTextMessage('middle', 'assistant', 'assistant_1'),
    ];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ maxContextLength: 100, supportsTools: true }));
    (service as any).deps.setChatStatus = setChatStatus;
    (service as any).deps.setContextHistory = setContextHistory;
    (checkCompressionNeeds as Mock).mockResolvedValue(true);
    (compressContextHistoryWithFullMode as Mock).mockResolvedValue({
      success: false,
      compressedMessages: contextHistory,
    });

    await service.checkAndCompress();

    expect(setContextHistory).not.toHaveBeenCalled();
    expect(setChatStatus).toHaveBeenCalledTimes(1);
    expect(setChatStatus).toHaveBeenCalledWith('compressing_context');
  });

  it('supports silent cold-load compaction without status changes', async () => {
    const { service } = createContextService();
    const setChatStatus = vi.fn();
    const setContextHistory = vi.fn();
    const setLastUpdated = vi.fn();
    const contextHistory = [
      createTextMessage('first', 'user', 'user_1'),
      createTextMessage('middle', 'assistant', 'assistant_1'),
      createTextMessage('last', 'user', 'user_2'),
    ];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ maxContextLength: 100, supportsTools: true }));
    (service as any).deps.setChatStatus = setChatStatus;
    (service as any).deps.setContextHistory = setContextHistory;
    (service as any).deps.setLastUpdated = setLastUpdated;
    (checkCompressionNeeds as Mock).mockResolvedValue(true);
    (compressContextHistoryWithFullMode as Mock).mockResolvedValue({
      success: true,
      compressedMessages: [contextHistory[0], contextHistory[2]],
    });

    await expect(service.checkAndCompress({ emitStatus: false })).resolves.toEqual({ applied: true });

    expect(setContextHistory).toHaveBeenCalledWith([contextHistory[0], contextHistory[2]]);
    expect(setLastUpdated).toHaveBeenCalledTimes(1);
    expect(setChatStatus).not.toHaveBeenCalled();
  });

  it('supports forced compaction without consulting the threshold gate', async () => {
    const { service } = createContextService();
    const setContextHistory = vi.fn();
    const contextHistory = [
      createTextMessage('first', 'user', 'user_1'),
      createTextMessage('middle', 'assistant', 'assistant_1'),
      createTextMessage('last', 'user', 'user_2'),
    ];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ maxContextLength: 100, supportsTools: true }));
    (service as any).deps.setContextHistory = setContextHistory;
    (checkCompressionNeeds as Mock).mockResolvedValue(false);
    (compressContextHistoryWithFullMode as Mock).mockResolvedValue({
      success: true,
      compressedMessages: [contextHistory[0], contextHistory[2]],
    });

    await expect(service.checkAndCompress({ force: true, emitStatus: false })).resolves.toEqual({ applied: true });

    expect(checkCompressionNeeds).not.toHaveBeenCalled();
    expect(setContextHistory).toHaveBeenCalledWith([contextHistory[0], contextHistory[2]]);
  });
});

describe('AgentChatContextService token correction', () => {
  it('applies Claude model correction factor (×1.4) when no anchoring data', async () => {
    const { service } = createContextService();
    const tokenCounter = {
      countTextTokens: vi.fn(() => 100),
      countMessagesTokens: vi.fn(() => 10),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 50 })),
    };

    (service as any).deps.getContextHistory = () => [createTextMessage('hello', 'user', 'user_1')];
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool-a' }]);
    (service as any).deps.getCurrentModelId = () => 'claude-opus-4.7-1m-internal';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'user', content: 'hello' },
    ]);

    const result = await service.calculateThreeComponentTokens();

    // rawTotal = (100 + 1*3 + 3) + 50 = 156; ×1.4 = ceil(218.4) = 219
    expect(result.totalTokens).toBe(Math.ceil(156 * 1.4));
  });

  it('applies Gemini model correction factor (×1.1)', async () => {
    const { service } = createContextService();
    const tokenCounter = {
      countTextTokens: vi.fn(() => 100),
      countMessagesTokens: vi.fn(() => 10),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
    };

    (service as any).deps.getContextHistory = () => [createTextMessage('hello', 'user', 'user_1')];
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentModelId = () => 'gemini-2.5-pro';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'user', content: 'hello' },
    ]);

    const result = await service.calculateThreeComponentTokens();

    // rawTotal = 100 + 1*3 + 3 + 0 = 106; ×1.1 = ceil(116.6) = 117
    expect(result.totalTokens).toBe(Math.ceil(106 * 1.1));
  });

  it('applies no correction for GPT models (factor = 1.0)', async () => {
    const { service } = createContextService();
    const tokenCounter = {
      countTextTokens: vi.fn(() => 100),
      countMessagesTokens: vi.fn(() => 10),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
    };

    (service as any).deps.getContextHistory = () => [createTextMessage('hello', 'user', 'user_1')];
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentModelId = () => 'gpt-5';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'user', content: 'hello' },
    ]);

    const result = await service.calculateThreeComponentTokens();

    // rawTotal = 100 + 1*3 + 3 + 0 = 106; ×1.0 = 106
    expect(result.totalTokens).toBe(106);
  });

  it('anchorTokenEstimate overrides model correction factor', async () => {
    const { service } = createContextService();
    const tokenCounter = {
      countTextTokens: vi.fn(() => 100),
      countMessagesTokens: vi.fn(() => 10),
      countImageTokens: vi.fn(() => ({ tokens: 0 })),
      countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
    };

    (service as any).deps.getContextHistory = () => [createTextMessage('hello', 'user', 'user_1')];
    (service as any).deps.getTokenCounter = () => tokenCounter;
    (service as any).deps.getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    (service as any).deps.getCurrentModelId = () => 'claude-opus-4.7-1m-internal';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({ supportsTools: true }));
    (formatMessagesForApi as Mock).mockResolvedValue([
      { role: 'user', content: 'hello' },
    ]);

    // First call to set lastLocalEstimate
    await service.calculateThreeComponentTokens();

    // Anchor with API value (simulate server says 159 tokens for our 106 local estimate)
    service.anchorTokenEstimate(159);

    const result = await service.calculateThreeComponentTokens();

    // correctionRatio = 159/106 = 1.5; rawTotal = 106; ceil(106 * 1.5) = 159
    expect(result.totalTokens).toBe(159);
  });

  it('checkAndCompress passes outputTokenReserve from model capabilities', async () => {
    const { service } = createContextService();
    const contextHistory = [
      createTextMessage('hello', 'user', 'user_1'),
      createTextMessage('world', 'assistant', 'assistant_1'),
    ];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getCurrentModelId = () => 'gpt-5';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({
      maxContextLength: 100000,
      maxOutputLength: 8192,
      supportsTools: true,
    }));
    (service as any).deps.getFullModeCompressor = vi.fn();
    (checkCompressionNeeds as Mock).mockResolvedValue(false);

    await service.checkAndCompress();

    // Should be called with outputTokenReserve = min(8192, 20000) = 8192
    expect(checkCompressionNeeds).toHaveBeenCalledWith(
      contextHistory,
      100000,
      'OpenKosmos',
      expect.any(Function),
      8192,
    );
  });

  it('checkAndCompress caps outputTokenReserve at 20000', async () => {
    const { service } = createContextService();
    const contextHistory = [createTextMessage('hello', 'user', 'user_1')];

    (service as any).deps.getContextHistory = () => contextHistory;
    (service as any).deps.getCurrentModelId = () => 'claude-opus-4.7-1m-internal';
    (service as any).deps.getModelCapabilities = vi.fn(() => ({
      maxContextLength: 1000000,
      maxOutputLength: 64000,
      supportsTools: true,
    }));
    (service as any).deps.getFullModeCompressor = vi.fn();
    (checkCompressionNeeds as Mock).mockResolvedValue(false);

    await service.checkAndCompress();

    // Should be called with outputTokenReserve = min(64000, 20000) = 20000
    expect(checkCompressionNeeds).toHaveBeenCalledWith(
      contextHistory,
      1000000,
      'OpenKosmos',
      expect.any(Function),
      20000,
    );
  });
});