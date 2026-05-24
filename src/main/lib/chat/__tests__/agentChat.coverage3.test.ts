/**
 * Additional coverage tests for agentChat.ts — coverage3
 * Targets paths not yet covered by coverage.test.ts and coverage2.test.ts:
 *  - addContextChangeListener (with & without cached stats)
 *  - removeContextChangeListener
 *  - addStatusChangeListener / unsubscribe
 *  - setChatStatus with listener error
 *  - getChatStatus / getChatStatusInfo / forceIdleStatus
 *  - getPendingInteractiveRequest
 *  - updateSessionTitle / getDisplayMessages
 *  - getCompressionStatus / isCompressionEnabled / setCompressionEnabled
 *  - getContextSummary (populated context history)
 *  - getCancellationToken
 *  - getCurrentModelId / getModelCapabilities / currentModelSupportsTools / currentModelSupportsImages
 *  - getSessionFromAuthManager success + failure
 *  - getChatId / getUserAlias / getChatSessionId
 *  - setSchedulerJobId / setSkipPersistence / setInteractionPolicy / getBlockedInteractionDetails
 *  - setSchedulerExecutionState / hydrateSchedulerMetadata
 *  - setEventSender / hasEventSender
 *  - destroy
 *  - getAgentInfo
 *  - editUserMessage
 *  - constructor with missing config throws
 *  - constructor with empty userAlias throws
 *  - getContextSummary empty
 *  - invalidateActiveExecution / cancelActiveToolExecution
 *  - startChat (SessionStart hook path via internal method)
 *  - getChatSessionEntryTypeForUserMessage
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

const { mockGetModelById, mockGetModelCapabilities, mockGetDefaultModel } = vi.hoisted(() => ({
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
    createChatSession = vi.fn();
    generateChatSessionTitle = vi.fn().mockResolvedValue(undefined);
    generateFallbackTitle = vi.fn().mockReturnValue('Fallback Title');
    addMessageToSession = vi.fn().mockResolvedValue(undefined);
    editUserMessage = vi.fn().mockResolvedValue([{ role: 'assistant', content: [] }]);
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: 0, targetUserMessage: null, targetContextUserIndex: 0 });
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 0 });
  },
}));

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool1' }, { name: 'tool2' }]);
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

// ─── Constructor error paths ─────────────────────────────────────────────────
describe('AgentChat - constructor error paths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when userAlias is empty string', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    expect(() => new AgentChat('', 'chat-1', 'session-1')).toThrow(/userAlias is empty/);
  });

  it('throws when config is not found', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect(() => new AgentChat('user1', 'chat-1', 'session-1')).toThrow(/no config found/);
  });

  it('creates agent without session data (new session path)', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-1', 'session-1');
    expect(agent).toBeDefined();
  });
});

// ─── Identity / simple getters ───────────────────────────────────────────────
describe('AgentChat - identity getters', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('getChatId returns chatId', () => {
    expect(agent.getChatId()).toBe('chat-1');
  });

  it('getUserAlias returns userAlias', () => {
    expect(agent.getUserAlias()).toBe('user1');
  });

  it('getChatSessionId returns chatSessionId', () => {
    expect(agent.getChatSessionId()).toBe('session-1');
  });

  it('getChatStatus returns current status string', () => {
    expect(typeof agent.getChatStatus()).toBe('string');
  });

  it('getChatStatusInfo returns chatId, chatStatus, agentName', () => {
    const info = agent.getChatStatusInfo();
    expect(info.chatId).toBe('chat-1');
    expect(info.agentName).toBe('TestAgent');
    expect(typeof info.chatStatus).toBe('string');
  });

  it('getPendingInteractiveRequest returns null initially', () => {
    expect(agent.getPendingInteractiveRequest()).toBeNull();
  });
});

// ─── forceIdleStatus ────────────────────────────────────────────────────────
describe('AgentChat - forceIdleStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when status is already idle', () => {
    const agent = createAgent();
    const spy = vi.spyOn(agent as any, 'setChatStatus');
    // status is 'idle' by default
    agent.forceIdleStatus();
    expect(spy).not.toHaveBeenCalled();
  });

  it('sets status to idle when not already idle', () => {
    const agent = createAgent();
    (agent as any).runtimeState.chatStatus = ChatStatus.SENDING_RESPONSE;
    const spy = vi.spyOn(agent as any, 'setChatStatus');
    agent.forceIdleStatus();
    expect(spy).toHaveBeenCalledWith(ChatStatus.IDLE);
  });
});

// ─── Status listeners ────────────────────────────────────────────────────────
describe('AgentChat - addStatusChangeListener', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns an unsubscribe function', () => {
    const listener = vi.fn();
    const unsubscribe = agent.addStatusChangeListener(listener);
    expect(typeof unsubscribe).toBe('function');
  });

  it('calls listener on status change', () => {
    const listener = vi.fn();
    agent.addStatusChangeListener(listener);
    (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(listener).toHaveBeenCalledWith(ChatStatus.SENDING_RESPONSE);
  });

  it('does not call listener after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = agent.addStatusChangeListener(listener);
    unsubscribe();
    (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setChatStatus does not throw when a listener throws', () => {
    agent.addStatusChangeListener(() => { throw new Error('listener error'); });
    expect(() => (agent as any).setChatStatus(ChatStatus.IDLE)).not.toThrow();
  });
});

// ─── Context listeners ───────────────────────────────────────────────────────
describe('AgentChat - addContextChangeListener / removeContextChangeListener', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('addContextChangeListener adds listener', () => {
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).toContain(listener);
  });

  it('addContextChangeListener immediately sends cached stats if available', () => {
    const cachedStats = { used: 10, total: 100 } as any;
    (agent as any).latestContextStats = cachedStats;
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).toHaveBeenCalledWith(cachedStats);
  });

  it('removeContextChangeListener removes listener', () => {
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.removeContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).not.toContain(listener);
  });

  it('removeContextChangeListener is no-op if listener not present', () => {
    const listener = vi.fn();
    expect(() => agent.removeContextChangeListener(listener)).not.toThrow();
  });
});

// ─── Session title ────────────────────────────────────────────────────────────
describe('AgentChat - updateSessionTitle', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns true and updates title when session exists', () => {
    const result = agent.updateSessionTitle('New Title');
    expect(result).toBe(true);
    expect(agent.getCurrentChatSession()?.title).toBe('New Title');
  });

  it('returns false when session is null', () => {
    agent.initializeEmptyChatSession();
    const result = agent.updateSessionTitle('New Title');
    expect(result).toBe(false);
  });
});

// ─── getDisplayMessages ──────────────────────────────────────────────────────
describe('AgentChat - getDisplayMessages', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns combined custom system prompt + chat history', () => {
    const msgs = agent.getDisplayMessages();
    expect(Array.isArray(msgs)).toBe(true);
  });
});

// ─── Compression helpers ──────────────────────────────────────────────────────
describe('AgentChat - compression helpers', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('isCompressionEnabled returns true', () => {
    expect(agent.isCompressionEnabled()).toBe(true);
  });

  it('setCompressionEnabled does not throw', () => {
    expect(() => agent.setCompressionEnabled(false)).not.toThrow();
    expect(() => agent.setCompressionEnabled(true)).not.toThrow();
  });

  it('getCompressionStatus returns expected shape', () => {
    const status = agent.getCompressionStatus();
    expect(status).toHaveProperty('enabled', true);
    expect(status).toHaveProperty('fullModeCompressionReady');
    expect(status).toHaveProperty('currentModel');
  });
});

// ─── getContextSummary ────────────────────────────────────────────────────────
describe('AgentChat - getContextSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty string when context history is empty', () => {
    const agent = createAgent();
    expect(agent.getContextSummary()).toBe('');
  });

  it('returns non-empty string when context history has messages', () => {
    const agent = createAgent({
      context_history: [
        { id: 'c1', role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: Date.now() },
        { id: 'c2', role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: Date.now() },
      ],
    });
    const summary = agent.getContextSummary();
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('handles more than 20 messages (takes last 20)', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `Message ${i}` }],
      timestamp: Date.now(),
    }));
    const agent = createAgent({ context_history: many });
    const summary = agent.getContextSummary();
    expect(summary).toBeDefined();
  });
});

// ─── getCancellationToken ─────────────────────────────────────────────────────
describe('AgentChat - getCancellationToken', () => {
  it('returns undefined when no token bound', () => {
    const agent = createAgent();
    expect(agent.getCancellationToken()).toBeUndefined();
  });
});

// ─── getCurrentModelId ────────────────────────────────────────────────────────
describe('AgentChat - getCurrentModelId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns model from agent config', () => {
    const agent = createAgent();
    expect(agent.getCurrentModelId()).toBe('gpt-5');
  });

  it('falls back to getDefaultModel when config is unavailable', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());
    // Simulate config becoming null mid-session
    mockProfileCacheManager.getChatConfig.mockReturnValueOnce(null);
    const modelId = agent.getCurrentModelId();
    expect(modelId).toBe('gpt-5'); // defaultModel fallback
  });
});

// ─── getModelCapabilities ─────────────────────────────────────────────────────
describe('AgentChat - getModelCapabilities', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns capabilities when found', () => {
    const caps = { supportsTools: true, supportsImages: false, tokenizer: 'o200k_base' };
    // Must persist across the getModelCapabilities call (not just once)
    mockGetModelCapabilities.mockReturnValue(caps);
    const agent = createAgent();
    const result = agent.getModelCapabilities('gpt-5');
    expect(result).toBe(caps);
    mockGetModelCapabilities.mockReturnValue(undefined); // reset
  });

  it('throws GhcApiError when capabilities not found', async () => {
    mockGetModelCapabilities.mockReturnValueOnce(null);
    const agent = createAgent();
    expect(() => agent.getModelCapabilities('unknown-model')).toThrow();
  });
});

// ─── currentModelSupportsTools / currentModelSupportsImages ──────────────────
describe('AgentChat - currentModelSupportsTools / currentModelSupportsImages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('currentModelSupportsTools returns boolean', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false, tokenizer: 'o200k_base' });
    const agent = createAgent();
    expect(agent.currentModelSupportsTools()).toBe(true);
  });

  it('currentModelSupportsImages returns boolean', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: true, tokenizer: 'o200k_base' });
    const agent = createAgent();
    expect(agent.currentModelSupportsImages()).toBe(true);
  });
});

// ─── getSessionFromAuthManager ────────────────────────────────────────────────
describe('AgentChat - getSessionFromAuthManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session when auth has ghcAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValueOnce({
      ghcAuth: {
        copilotTokens: { token: 'my-token' },
        user: { login: 'user1' },
      },
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).not.toBeNull();
    expect(session.type).toBe('ghc');
    expect(session.accessToken).toBe('my-token');
  });

  it('returns null when no ghcAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValueOnce(null);
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });

  it('returns null when getCurrentAuth throws', async () => {
    mockMainAuthManager.getCurrentAuth.mockImplementationOnce(() => {
      throw new Error('auth error');
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

// ─── scheduler / skip persistence / interaction policy ───────────────────────
describe('AgentChat - scheduler and policy setters', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('setSchedulerJobId stores jobId', () => {
    agent.setSchedulerJobId('job-42');
    expect((agent as any).schedulerJobId).toBe('job-42');
  });

  it('setSkipPersistence sets flag', () => {
    agent.setSkipPersistence(true);
    expect((agent as any).skipPersistence).toBe(true);
  });

  it('setInteractionPolicy sets policy', () => {
    agent.setInteractionPolicy('plain-text-only');
    expect((agent as any).interactionPolicy).toBe('plain-text-only');
  });

  it('getBlockedInteractionDetails returns null initially', () => {
    expect(agent.getBlockedInteractionDetails()).toBeNull();
  });

  it('setSchedulerExecutionState stores status and options', () => {
    agent.setSchedulerExecutionState('running', {
      startedAt: '2026-01-01T00:00:00Z',
    });
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('running');
    expect((agent as any).schedulerExecutionMetadata.schedulerStartedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('setSchedulerExecutionState stores completedAt and error', () => {
    agent.setSchedulerExecutionState('failed', {
      completedAt: '2026-01-01T01:00:00Z',
      error: 'boom',
    });
    expect((agent as any).schedulerExecutionMetadata.schedulerCompletedAt).toBe('2026-01-01T01:00:00Z');
    expect((agent as any).schedulerExecutionMetadata.schedulerError).toBe('boom');
  });

  it('hydrateSchedulerMetadata populates all fields', () => {
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-99',
      schedulerExecutionStatus: 'completed',
      schedulerStartedAt: '2026-01-01T00:00:00Z',
      schedulerCompletedAt: '2026-01-01T01:00:00Z',
      schedulerError: undefined,
    });
    expect((agent as any).schedulerJobId).toBe('job-99');
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('completed');
  });
});

// ─── setEventSender / hasEventSender ────────────────────────────────────────
describe('AgentChat - setEventSender / hasEventSender', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('setEventSender calls outputPort.setSender', () => {
    const spy = vi.spyOn((agent as any).outputPort, 'setSender');
    agent.setEventSender(null);
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('hasEventSender returns boolean from outputPort', () => {
    expect(typeof agent.hasEventSender()).toBe('boolean');
  });
});

// ─── destroy ─────────────────────────────────────────────────────────────────
describe('AgentChat - destroy', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('clears listeners and resets state', () => {
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.addStatusChangeListener(vi.fn());
    agent.destroy();
    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
    expect((agent as any).latestContextStats).toBeNull();
  });
});

// ─── getAgentInfo ─────────────────────────────────────────────────────────────
describe('AgentChat - getAgentInfo', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns agent info with tools count', async () => {
    const info = await agent.getAgentInfo();
    expect(info.name).toBe('TestAgent');
    expect(info.toolsCount).toBe(2);
    expect(info.chatHistoryLength).toBe(0);
  });

  it('throws when config is unavailable during getAgentInfo', async () => {
    mockProfileCacheManager.getChatConfig.mockReturnValueOnce(null);
    await expect(agent.getAgentInfo()).rejects.toThrow(/no config available/);
  });
});

// ─── editUserMessage ──────────────────────────────────────────────────────────
describe('AgentChat - editUserMessage', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('delegates to sessionService.editUserMessage and returns messages', async () => {
    const updatedMsg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    const result = await agent.editUserMessage('m1', updatedMsg);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── invalidateActiveExecution / cancelActiveToolExecution ────────────────────
describe('AgentChat - tool executor delegation', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('invalidateActiveExecution delegates to toolExecutor', () => {
    const spy = vi.spyOn((agent as any).toolExecutor, 'invalidateActiveExecution');
    agent.invalidateActiveExecution();
    expect(spy).toHaveBeenCalled();
  });

  it('cancelActiveToolExecution delegates to toolExecutor', async () => {
    const spy = vi.spyOn((agent as any).toolExecutor, 'cancelActiveToolExecution').mockResolvedValue(undefined);
    await agent.cancelActiveToolExecution();
    expect(spy).toHaveBeenCalled();
  });
});

// ─── getContextTokenUsage ─────────────────────────────────────────────────────
describe('AgentChat - getContextTokenUsage', () => {
  it('returns null initially', () => {
    const agent = createAgent();
    expect(agent.getContextTokenUsage()).toBeNull();
  });
});

// ─── getChatSessionEntryTypeForUserMessage ────────────────────────────────────
describe('AgentChat - getChatSessionEntryTypeForUserMessage (private)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns "new" when chat_history is empty', () => {
    const agent = createAgent();
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).getChatSessionEntryTypeForUserMessage(msg)).toBe('new');
  });

  it('returns "continued" when chat_history has messages', () => {
    const agent = createAgent({
      chat_history: [{ id: 'm0', role: 'user', content: [], timestamp: Date.now() }],
    });
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).getChatSessionEntryTypeForUserMessage(msg)).toBe('continued');
  });
});

// ─── getSubAgentConfig ────────────────────────────────────────────────────────
describe('AgentChat - getSubAgentConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when chatConfig has no sub_agents', () => {
    const agent = createAgent();
    const result = agent.getSubAgentConfig('non-existent');
    expect(result).toBeUndefined();
  });
});
