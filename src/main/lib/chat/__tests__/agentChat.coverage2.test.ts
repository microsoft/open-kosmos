/**
 * Additional coverage tests for agentChat.ts — coverage2
 * Targets paths not hit by agentChat.coverage.test.ts:
 *  - canEditUserMessage, addMessageToContext, addMessageToSession (public)
 *  - handlePushChunk / handlePushComplete / cancelPush
 *  - getSystemMessages / getContextHistory / getChatHistory
 *  - getInteractionHistory with populated history
 *  - shouldTrackChatSessionActivated with existing same-day message
 *  - getAnalyticsDayKey edge cases via getMessageTimestampMs paths
 *  - trackChatSessionActivated (fire-and-forget, no throw)
 *  - streamMessage routing (EXTERNAL agent path + normal path)
 *  - retryChat delegation
 *  - executeToolCall delegation
 *  - calculateAndNotifyContext
 *  - addStatusChangeListener / unsubscribe
 *  - initialize
 *  - handlePushComplete public method
 */

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
  GhcApiError: class GhcApiError extends Error {
    constructor(msg: string, public code: number) { super(msg); }
  },
}));

const {
  mockGetModelById,
  mockGetModelCapabilities,
  mockGetDefaultModel,
} = vi.hoisted(() => ({
  mockGetModelById: vi.fn(),
  mockGetModelCapabilities: vi.fn(),
  mockGetDefaultModel: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: mockGetModelById,
  getModelCapabilities: mockGetModelCapabilities,
  getDefaultModel: mockGetDefaultModel,
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

const { mockMainAuthManager } = vi.hoisted(() => ({
  mockMainAuthManager: { getCurrentAuth: vi.fn() },
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: mockMainAuthManager,
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

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: { getChatConfig: vi.fn() },
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

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../featureFlags', async () => ({
  featureFlagManager: {},
  isFeatureEnabled: mockIsFeatureEnabled,
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

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({ getCachedConfig: vi.fn() })),
  },
}));

vi.mock('../../analytics', async () => ({
  analyticsManager: {
    recordChatSessionActivated: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../plugin/hooks/hookRegistry', async () => ({
  hookRegistry: {
    execute: vi.fn().mockResolvedValue({ additionalContexts: [] }),
  },
}));

vi.mock('../agentChatManager', async () => ({
  agentChatManager: {
    exitNewChatSessionFor: vi.fn(),
  },
}));

const { mockHandleExternalAgentMessage } = vi.hoisted(() => ({
  mockHandleExternalAgentMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: mockHandleExternalAgentMessage,
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: {
    getInstance: vi.fn(() => ({ addXP: vi.fn() })),
  },
}));

// Mock AgentChat sub-services so heavy async ops don't fire in unit tests
vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: class {
    calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
    extractFactsFromConversation = vi.fn().mockResolvedValue(undefined);
    addMessageToContext = vi.fn().mockResolvedValue(undefined);
    enhanceUserMessageContext = vi.fn().mockImplementation(async (m: any) => m);
    checkAndCompress = vi.fn().mockResolvedValue({ applied: false });
    calculateThreeComponentTokens = vi.fn().mockResolvedValue({ contextHistoryTokens: 0, systemPromptTokens: 0, toolsTokens: 0, totalTokens: 0 });
    notifyContextChange = vi.fn();
    anchorTokenEstimate = vi.fn();
  },
}));

vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: class {
    saveChatSession = vi.fn().mockResolvedValue({ success: true });
    createChatSession = vi.fn().mockImplementation((params: any) => {
      // minimal implementation
    });
    generateChatSessionTitle = vi.fn().mockResolvedValue(undefined);
    generateFallbackTitle = vi.fn().mockReturnValue('Fallback Title');
    addMessageToSession = vi.fn().mockResolvedValue(undefined);
    editUserMessage = vi.fn().mockResolvedValue([]);
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: 0, targetUserMessage: null, targetContextUserIndex: 0 });
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 0 });
  },
}));

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([]);
    getGlobalSystemPrompt = vi.fn().mockReturnValue([]);
    getAgentSpecificSystemPrompt = vi.fn().mockReturnValue([]);
    buildSubAgentsSystemPrompt = vi.fn().mockReturnValue('');
    getCombinedSystemPromptForContext = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    refreshSkillSnapshotIfNeeded = vi.fn().mockResolvedValue(undefined);
    setHookAdditionalContexts = vi.fn();
  },
}));

vi.mock('../agentChatInteractionService', async () => ({
  AgentChatInteractionService: class {
    buildInteractionId = vi.fn().mockReturnValue('id-123');
    buildInteractionHistoryEntry = vi.fn().mockReturnValue({});
    buildInteractionSummary = vi.fn().mockReturnValue('summary');
    finalizeInteractiveRequest = vi.fn().mockResolvedValue({});
    requestUserInteraction = vi.fn().mockResolvedValue({});
    requestApprovalInteraction = vi.fn().mockResolvedValue(new Map());
    batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    requestUserInfoInput = vi.fn().mockResolvedValue(null);
    requestUserChoice = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: class {
    postProcessToolResult = vi.fn().mockResolvedValue(undefined);
    postProcessForRequestInteractiveInputTool = vi.fn().mockResolvedValue(undefined);
    postProcessForGetMcpTemplateFromLibraryTool = vi.fn().mockResolvedValue(undefined);
    postProcessForGetAgentTemplateFromLibraryTool = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../agentChatToolExecutor', async () => ({
  AgentChatToolExecutor: class {
    executeToolCall = vi.fn().mockResolvedValue(undefined);
    assertExecutionActive = vi.fn();
    invalidateActiveExecution = vi.fn();
    cancelActiveToolExecution = vi.fn().mockResolvedValue(undefined);
    registerActiveToolCancellationHandler = vi.fn().mockReturnValue({ dispose: vi.fn() });
    cleanupIncompleteToolCalls = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../agentChatStreamingService', async () => ({
  AgentChatStreamingService: class {
    callWithToolsStreaming = vi.fn().mockResolvedValue({});
    turnStartTime = 0;
    ttftReportedForTurn = false;
  },
}));

vi.mock('../agentChatTurnRunner', async () => ({
  AgentChatTurnRunner: class {
    run = vi.fn().mockResolvedValue(undefined);
    handleFailure = vi.fn().mockResolvedValue(undefined);
    runStreamMessage = vi.fn().mockResolvedValue([]);
    runRetry = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: class {
    emitStatus = vi.fn();
    emitEvent = vi.fn();
    emitStreamingChunk = vi.fn();
    getSender = vi.fn().mockReturnValue(null);
    setSender = vi.fn();
    hasSender = vi.fn().mockReturnValue(false);
    clear = vi.fn();
  },
}));

vi.mock('../agentChatRuntimeState', async () => ({
  AgentChatRuntimeState: class {
    chatStatus = 'idle';
    currentCancellationToken: any = undefined;
    toolExecutionNonce = 0;
    activeToolCancellationHandler: any = null;
    pendingInteractiveRequest: any = null;
    messagesToSave: any[] = [];
    saveChain: Promise<any> = Promise.resolve();

    setChatStatus = vi.fn().mockImplementation((s: string) => { this.chatStatus = s; });
    bindCancellationToken = vi.fn().mockImplementation((t: any) => { this.currentCancellationToken = t; });
    clearCancellationToken = vi.fn().mockImplementation(() => { this.currentCancellationToken = undefined; });
    bumpToolExecutionNonce = vi.fn().mockImplementation(() => { this.toolExecutionNonce += 1; return this.toolExecutionNonce; });
    setToolExecutionNonce = vi.fn().mockImplementation((n: number) => { this.toolExecutionNonce = n; });
    setActiveToolCancellationHandler = vi.fn().mockImplementation((h: any) => { this.activeToolCancellationHandler = h; });
    setPendingInteractiveRequest = vi.fn().mockImplementation((r: any) => { this.pendingInteractiveRequest = r; });
    setMessagesToSave = vi.fn().mockImplementation((m: any[]) => { this.messagesToSave = m; });
    setSaveChain = vi.fn().mockImplementation((c: Promise<any>) => { this.saveChain = c; });
  },
}));

vi.mock('../agentChatPushReceiver', async () => ({
  AgentChatPushReceiver: class {
    handlePushChunk = vi.fn();
    handlePushComplete = vi.fn().mockResolvedValue(undefined);
    startOrResetPushTimeout = vi.fn();
    cancelPush = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('../../mem0/openkosmos-adapters/OpenKosmosMemoryManager', async () => ({
  openkosmosMemoryManager: {},
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

import { AgentChat, ChatStatus } from '../agentChat';

const AGENT_CONFIG = {
  chat_id: 'chat-1',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'TestAgent',
    model: 'gpt-5',
    mcp_servers: [],
    system_prompt: 'You are helpful',
  },
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test Session',
    last_updated: '2026-01-01T00:00:00.000Z',
    chatSession_id: 'session-1',
    ...overrides,
  } as any;
}

function createAgent(sessionOverrides: Record<string, any> = {}, configOverrides: Record<string, any> = {}) {
  const config = { ...AGENT_CONFIG, agent: { ...AGENT_CONFIG.agent, ...configOverrides } };
  mockProfileCacheManager.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------
describe('AgentChat - initialize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls calculateAndNotifyContext without throwing', async () => {
    const agent = createAgent();
    await expect(agent.initialize()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Chat/context history
// ---------------------------------------------------------------------------
describe('AgentChat - getChatHistory / getContextHistory', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('getChatHistory returns empty array initially', () => {
    expect(agent.getChatHistory()).toEqual([]);
  });

  it('getChatHistory returns messages after adding', () => {
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    agent.addMessageToChatHistory(msg);
    expect(agent.getChatHistory()).toContainEqual(msg);
  });

  it('getContextHistory returns empty array initially', () => {
    expect(agent.getContextHistory()).toEqual([]);
  });

  it('getContextHistory returns populated context history', () => {
    const session = agent.getCurrentChatSession()!;
    session.context_history = [{ id: 'c1', role: 'user', content: [] }] as any;
    expect(agent.getContextHistory()).toHaveLength(1);
  });

  it('getContextHistory returns empty array when session is null', () => {
    agent.initializeEmptyChatSession();
    expect(agent.getContextHistory()).toEqual([]);
  });

  it('getChatHistory returns empty array when session is null', () => {
    agent.initializeEmptyChatSession();
    expect(agent.getChatHistory()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSystemMessages
// ---------------------------------------------------------------------------
describe('AgentChat - getSystemMessages', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns array (delegates to getCombinedSystemPromptForContext)', () => {
    expect(Array.isArray(agent.getSystemMessages())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getInteractionHistory with populated history
// ---------------------------------------------------------------------------
describe('AgentChat - getInteractionHistory populated', () => {
  it('returns populated interaction history from session', () => {
    const entry = { id: 'i1', type: 'approval', timestamp: '2026-01-01' } as any;
    const agent = createAgent({ interaction_history: [entry] });
    expect(agent.getInteractionHistory()).toContainEqual(entry);
  });

  it('returns empty array when session is null', () => {
    const agent = createAgent();
    agent.initializeEmptyChatSession();
    expect(agent.getInteractionHistory()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// canEditUserMessage
// ---------------------------------------------------------------------------
describe('AgentChat - canEditUserMessage', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('delegates to sessionService.validateUserMessageEditable', () => {
    const result = agent.canEditUserMessage('msg-id');
    // mock returns { canEdit: true }
    expect(result.canEdit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addMessageToContext (public)
// ---------------------------------------------------------------------------
describe('AgentChat - addMessageToContext', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('calls contextService.addMessageToContext without throwing', async () => {
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    await expect(agent.addMessageToContext(msg)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addMessageToSession (public)
// ---------------------------------------------------------------------------
describe('AgentChat - addMessageToSession (public)', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('resolves without throwing', async () => {
    const msg = { id: 'm1', role: 'assistant', content: [], timestamp: Date.now() } as any;
    await expect(agent.addMessageToSession(msg)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Push receiver delegation
// ---------------------------------------------------------------------------
describe('AgentChat - push receiver methods', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('handlePushChunk delegates to pushReceiver', () => {
    const spy = vi.spyOn((agent as any).pushReceiver, 'handlePushChunk');
    agent.handlePushChunk('hello', 'msg-1');
    expect(spy).toHaveBeenCalledWith('hello', 'msg-1');
  });

  it('handlePushComplete delegates to pushReceiver', async () => {
    const spy = vi.spyOn((agent as any).pushReceiver, 'handlePushComplete').mockResolvedValue(undefined);
    await agent.handlePushComplete(true);
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('cancelPush delegates to pushReceiver', () => {
    const spy = vi.spyOn((agent as any).pushReceiver, 'cancelPush');
    agent.cancelPush();
    expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// calculateAndNotifyContext
// ---------------------------------------------------------------------------
describe('AgentChat - calculateAndNotifyContext', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('resolves without throwing', async () => {
    await expect(agent.calculateAndNotifyContext()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// callWithToolsStreaming
// ---------------------------------------------------------------------------
describe('AgentChat - callWithToolsStreaming', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('resolves with streaming api response object', async () => {
    const result = await agent.callWithToolsStreaming(undefined);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// executeToolCall
// ---------------------------------------------------------------------------
describe('AgentChat - executeToolCall', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('delegates to toolExecutor.executeToolCall', async () => {
    const spy = vi.spyOn((agent as any).toolExecutor, 'executeToolCall').mockResolvedValue({ result: 'ok' });
    const result = await agent.executeToolCall({ id: 'tc1', function: { name: 'foo', arguments: '{}' } }, true);
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ result: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// retryChat
// ---------------------------------------------------------------------------
describe('AgentChat - retryChat', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('delegates to turnRunner.runRetry', async () => {
    const spy = vi.spyOn((agent as any).turnRunner ?? (agent as any).createTurnRunner(), 'runRetry').mockResolvedValue([]);
    // Assign the mock turnRunner
    const mockRunner = { runRetry: vi.fn().mockResolvedValue([{ role: 'assistant' }]) };
    (agent as any).turnRunner = mockRunner;
    const result = await agent.retryChat(undefined, {});
    expect(mockRunner.runRetry).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// streamMessage - EXTERNAL agent routing
// ---------------------------------------------------------------------------
describe('AgentChat - streamMessage EXTERNAL routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to handleExternalAgentMessage when agent.source is EXTERNAL and feature enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const config = {
      ...AGENT_CONFIG,
      agent: { ...AGENT_CONFIG.agent, source: 'EXTERNAL' },
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue(config);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());

    mockHandleExternalAgentMessage.mockResolvedValue([]);
    const result = await agent.streamMessage({ id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any);
    expect(mockHandleExternalAgentMessage).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });

  it('does NOT route to external handler when feature is disabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    const config = {
      ...AGENT_CONFIG,
      agent: { ...AGENT_CONFIG.agent, source: 'EXTERNAL' },
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue(config);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());

    const mockRunner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).turnRunner = mockRunner;

    await agent.streamMessage({ id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any);
    expect(mockHandleExternalAgentMessage).not.toHaveBeenCalled();
    expect(mockRunner.runStreamMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// streamMessage - normal path options
// ---------------------------------------------------------------------------
describe('AgentChat - streamMessage normal path', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('sets isRemoteSession from options and resets after', async () => {
    const mockRunner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).turnRunner = mockRunner;

    await agent.streamMessage(
      { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any,
      undefined,
      {},
      { isRemoteSession: true, interactionPolicy: 'plain-text-only' }
    );
    // After call, should be reset to false
    expect((agent as any).isRemoteSession).toBe(false);
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });

  it('emits user message when emitUserMessage option is set', async () => {
    const mockRunner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).turnRunner = mockRunner;

    await agent.streamMessage(
      { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any,
      undefined,
      {},
      { emitUserMessage: true }
    );
    expect(mockRunner.runStreamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ emitUserMessage: true })
    );
  });
});

// ---------------------------------------------------------------------------
// trackChatSessionActivated (fire-and-forget, no throw)
// ---------------------------------------------------------------------------
describe('AgentChat - trackChatSessionActivated', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('does not throw when called', () => {
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect(() => (agent as any).trackChatSessionActivated(msg, 'new')).not.toThrow();
    expect(() => (agent as any).trackChatSessionActivated(msg, 'continued')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// shouldTrackChatSessionActivated with same-day history
// ---------------------------------------------------------------------------
describe('AgentChat - shouldTrackChatSessionActivated same-day check', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns false when a same-day user message already exists in chat_history', () => {
    const now = Date.now();
    const existingMsg = { id: 'm0', role: 'user', content: [], timestamp: now } as any;
    agent.addMessageToChatHistory(existingMsg);

    const newMsg = { id: 'm1', role: 'user', content: [], timestamp: now } as any;
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(newMsg)).toBe(false);
  });

  it('returns true when previous user message is on a different day', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const oldMsg = { id: 'm0', role: 'user', content: [], timestamp: yesterday } as any;
    agent.addMessageToChatHistory(oldMsg);

    const newMsg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(newMsg)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMessageTimestampMs edge cases
// ---------------------------------------------------------------------------
describe('AgentChat - getMessageTimestampMs', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns timestamp when message.timestamp is a finite number', () => {
    const ts = 1700000000000;
    const msg = { id: 'm1', role: 'user', content: [], timestamp: ts } as any;
    expect((agent as any).getMessageTimestampMs(msg)).toBe(ts);
  });

  it('returns parsed timestamp when message.timestamp is a valid ISO string', () => {
    const isoStr = '2026-01-01T00:00:00.000Z';
    const msg = { id: 'm1', role: 'user', content: [], timestamp: isoStr } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    expect(typeof result).toBe('number');
    expect(result).toBe(Date.parse(isoStr));
  });

  it('returns Date.now() approx when timestamp is invalid string', () => {
    const before = Date.now();
    const msg = { id: 'm1', role: 'user', content: [], timestamp: 'not-a-date' } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns Date.now() approx when timestamp is missing', () => {
    const before = Date.now();
    const msg = { id: 'm1', role: 'user', content: [] } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// getAnalyticsDayKey
// ---------------------------------------------------------------------------
describe('AgentChat - getAnalyticsDayKey', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns a date string in YYYY-MM-DD format', () => {
    const key = (agent as any).getAnalyticsDayKey(Date.now());
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns consistent key for same epoch value', () => {
    const ts = 1700000000000;
    const k1 = (agent as any).getAnalyticsDayKey(ts);
    const k2 = (agent as any).getAnalyticsDayKey(ts);
    expect(k1).toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// saveChatSession
// ---------------------------------------------------------------------------
describe('AgentChat - saveChatSession', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('resolves with success object', async () => {
    const result = await agent.saveChatSession();
    expect(result).toEqual({ success: true });
  });
});

// ---------------------------------------------------------------------------
// replaceFilePathInSession
// ---------------------------------------------------------------------------
describe('AgentChat - replaceFilePathInSession', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('resolves with replacedCount', async () => {
    const result = await agent.replaceFilePathInSession('/old/path', '/new/path');
    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createMcpImageHash / hasInjectedMcpImageHash
// ---------------------------------------------------------------------------
describe('AgentChat - createMcpImageHash and hasInjectedMcpImageHash', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('createMcpImageHash returns a hex string', () => {
    const hash = (agent as any).createMcpImageHash('base64data', 'image/png');
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('hasInjectedMcpImageHash returns false for unknown hash', () => {
    expect((agent as any).hasInjectedMcpImageHash('nonexistenthash')).toBe(false);
  });

  it('hasInjectedMcpImageHash returns true when hash matches injected image', () => {
    const hash = (agent as any).createMcpImageHash('base64data', 'image/png');
    const session = agent.getCurrentChatSession()!;
    session.chat_history = [
      {
        id: 'm1',
        role: 'user',
        content: [
          {
            type: 'image',
            data: 'base64data',
            mimeType: 'image/png',
            metadata: { autoInjectedToolResultHash: hash },
          },
        ],
        timestamp: Date.now(),
      },
    ] as any;
    expect((agent as any).hasInjectedMcpImageHash(hash)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleExternalAgentMessage - result is non-empty (send failed path)
// ---------------------------------------------------------------------------
describe('AgentChat - handleExternalAgentMessage non-empty result', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT call startOrResetPushTimeout when result is non-empty', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const config = {
      ...AGENT_CONFIG,
      agent: { ...AGENT_CONFIG.agent, source: 'EXTERNAL' },
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue(config);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());

    const errorMsg = [{ id: 'err', role: 'assistant', content: [] }];
    mockHandleExternalAgentMessage.mockResolvedValue(errorMsg);

    const spy = vi.spyOn((agent as any).pushReceiver, 'startOrResetPushTimeout');
    await agent.streamMessage({ id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any);
    expect(spy).not.toHaveBeenCalled();
  });
});
