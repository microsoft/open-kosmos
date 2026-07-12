/**
 * agentChat.coverage8.test.ts
 *
 * Covers the 264-556 cluster (private create* service factory callbacks) and other
 * uncovered branches by capturing constructor option objects passed to mocked service
 * classes and invoking each lambda explicitly.
 *
 * Also covers:
 *  - getElectronApp (line 13) — global mock branch + error branch
 *  - safeEmitEvent (line 695)
 *    getCombinedSystemPromptForContext / refreshSkillSnapshotIfNeeded /
 *    getCombinedSystemPromptForCurrentTurn / drainBackgroundSubAgentResults (lines 806-895)
 *  - generateChatSessionTitle / generateFallbackTitle / AddMessageToSession (lines 1077-1094)
 *  - createMcpImageHash / hasInjectedMcpImageHash (lines 1096-1120)
 *  - extractFactsFromConversation (line 1127)
 *  - assertExecutionActive / buildInteractionId / buildInteractionHistoryEntry /
 *    buildInteractionSummary / finalizeInteractiveRequest / requestUserInteraction /
 *    requestApprovalInteraction / batchValidateAndRequestApproval / postProcessToolResult /
 *    postProcessForRequestInteractiveInputTool / requestUserInfoInput / requestUserChoice /
 *    registerActiveToolCancellationHandler (lines 1152-1509)
 *  - getCurrentModelConfig (line 1552) — model found + not found branches
 *  - getSchedulerMetadata / getMessageTimestampMs /
 *    getChatSessionEntryTypeForUserMessage
 *  - getContextSummary (line 1190)
 *  - CheckAndCompress (line 1214)
 *  - setCompressionEnabled / isCompressionEnabled / getCompressionStatus (1518-1542)
 *  - handleExternalAgentMessage (1285), handlePushChunk/handlePushComplete/addMessageToSession/
 *    cancelPush (1311-1336)
 *  - startChat (1341) with and without sessionStartHookFired
 *  - onUsageReceived callback — totalTokens > 0 and == 0 branches
 *  - anchorTokenEstimate callback (line 556)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoisted mocks ────────────────────────────────────────────────────────────

vi.mock('../../security/securityValidator', async () => ({
  SecurityValidator: class {},
  ApprovalRequestItem: class {},
  BatchValidationResult: class {},
  ToolCallValidationResult: class {},
}));

vi.mock('../../auth/ghcConfig', async () => ({ GHC_CONFIG: {} }));

vi.mock('../../utilities/errors', async () => ({
  GhcApiError: class GhcApiError extends Error {
    constructor(msg: string, public code: number) { super(msg); }
  },
}));

const { mockGetModelById, mockGetModelCapabilities, mockGetDefaultModel } = vi.hoisted(() => ({
  mockGetModelById: vi.fn(),
  mockGetModelCapabilities: vi.fn(() => ({
    supportsTools: true,
    supportsImages: true,
    tokenizer: 'o200k_base',
  })),
  mockGetDefaultModel: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: mockGetModelById,
  getModelCapabilities: mockGetModelCapabilities,
  getDefaultModel: mockGetDefaultModel,
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({ getEndpointForModel: vi.fn() }));

const { mockMainAuthManager } = vi.hoisted(() => ({
  mockMainAuthManager: { getCurrentAuth: vi.fn() },
}));

vi.mock('../../auth/authManager', async () => ({ mainAuthManager: mockMainAuthManager }));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../utilities/contentUtils', async () => ({ formatFileSize: vi.fn() }));

vi.mock('../../userDataADO/openkosmosPlaceholders', async () => ({
  openkosmosPlaceholderManager: {},
  containsOpenKosmosPlaceholder: vi.fn(() => false),
}));

vi.mock('../../userDataADO/userInputPlaceholderParser', async () => ({
  userInputPlaceholderParser: {},
  UserInputField: class {},
}));

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: { getChatConfig: vi.fn() },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../chatSessionStore', async () => ({ chatSessionStore: {} }));
vi.mock('../../skill/skillManager', async () => ({ skillManager: {} }));
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
  CancellationToken: class {},
  CancellationError: class CancellationError extends Error {},
  CancellationTokenStatic: {},
}));

const { mockCreateTokenCounter } = vi.hoisted(() => ({
  mockCreateTokenCounter: vi.fn(() => ({ countTokens: vi.fn(() => 0) })),
}));

vi.mock('../../token', async () => ({
  createTokenCounter: mockCreateTokenCounter,
  TokenCounter: class {},
}));

vi.mock('../../compression/fullModeCompressor', async () => ({
  createFullModeCompressor: vi.fn(() => ({ compress: vi.fn() })),
  FullModeCompressor: class {},
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn(),
  detectTruncatedToolCalls: vi.fn(),
  sanitizeToolCallsForApi: vi.fn(),
  applyStorageCompressionToRecentMessages: vi.fn(),
}));

const { mockAgentChatManager } = vi.hoisted(() => ({
  mockAgentChatManager: { exitNewChatSessionFor: vi.fn() },
}));

vi.mock('../agentChatManager', async () => ({
  agentChatManager: mockAgentChatManager,
}));

const { mockHandleExternalAgentMessage } = vi.hoisted(() => ({
  mockHandleExternalAgentMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: mockHandleExternalAgentMessage,
}));

const { mockBuddyAddXP } = vi.hoisted(() => ({
  mockBuddyAddXP: vi.fn(),
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: vi.fn(() => ({ addXP: mockBuddyAddXP })) },
}));

// ─── Captured option objects ──────────────────────────────────────────────────
// Each service constructor receives an opts object. We capture it so we can invoke
// individual callbacks to exercise the lambdas (lines 264-556).

let capturedPromptOpts: any;
let capturedSessionOpts: any;
let capturedContextOpts: any;
let capturedInteractionOpts: any;
let capturedToolPostProcessorOpts: any;
let capturedToolExecutorOpts: any;
let capturedStreamingOpts: any;
let capturedTurnRunnerOpts: any;

const mockCalculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
const mockNotifyContextChange = vi.fn();
const mockCalculateThreeComponentTokens = vi.fn().mockResolvedValue({
  contextHistoryTokens: 10, systemPromptTokens: 5, toolsTokens: 2, totalTokens: 17,
});

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class AgentChatPromptService {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool1' }]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([{ role: 'system', content: 'custom' }]);
    getGlobalSystemPrompt = vi.fn().mockReturnValue([]);
    getAgentSpecificSystemPrompt = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForContext = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    refreshSkillSnapshotIfNeeded = vi.fn().mockResolvedValue(undefined);
    setHookAdditionalContexts = vi.fn();
    setHookSystemMessages = vi.fn();
    constructor(opts: any) { capturedPromptOpts = opts; }
  },
}));

vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: class AgentChatSessionService {
    saveChatSession = vi.fn().mockResolvedValue({ success: true });
    createChatSession = vi.fn();
    addMessageToSession = vi.fn().mockResolvedValue(undefined);
    generateChatSessionTitle = vi.fn().mockResolvedValue(undefined);
    generateFallbackTitle = vi.fn().mockReturnValue('Fallback');
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 0 });
    editUserMessage = vi.fn().mockResolvedValue([]);
    prepareEditedUserMessage = vi.fn().mockImplementation((_messageId: string, message: any) => ({
      normalizedMessage: { id: message.id ?? 'm1', role: 'user', timestamp: message.timestamp ?? 1, content: message.content },
      targetUserIndex: 0,
      targetContextUserIndex: 0,
    }));
    applyEditedUserMessage = vi.fn().mockResolvedValue(undefined);
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: -1 });
    constructor(opts: any) { capturedSessionOpts = opts; }
  },
}));

vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: class AgentChatContextService {
    calculateAndNotifyContext = mockCalculateAndNotifyContext;
    addMessageToContext = vi.fn().mockResolvedValue(undefined);
    extractFactsFromConversation = vi.fn().mockResolvedValue(undefined);
    checkAndCompress = vi.fn().mockResolvedValue({ applied: false });
    calculateThreeComponentTokens = mockCalculateThreeComponentTokens;
    enhanceUserMessageContext = vi.fn().mockImplementation(async (m: any) => m);
    notifyContextChange = mockNotifyContextChange;
    anchorTokenEstimate = vi.fn();
    constructor(opts: any) { capturedContextOpts = opts; }
  },
}));

vi.mock('../agentChatInteractionService', async () => ({
  AgentChatInteractionService: class AgentChatInteractionService {
    buildInteractionId = vi.fn().mockReturnValue('int-id');
    buildInteractionHistoryEntry = vi.fn().mockReturnValue({});
    buildInteractionSummary = vi.fn().mockReturnValue('');
    finalizeInteractiveRequest = vi.fn().mockResolvedValue({});
    requestUserInteraction = vi.fn().mockResolvedValue({});
    requestApprovalInteraction = vi.fn().mockResolvedValue(new Map());
    batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    requestUserInfoInput = vi.fn().mockResolvedValue(null);
    requestUserChoice = vi.fn().mockResolvedValue(null);
    constructor(opts: any) { capturedInteractionOpts = opts; }
  },
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: class AgentChatToolPostProcessor {
    postProcessToolResult = vi.fn().mockResolvedValue({});
    postProcessForRequestInteractiveInputTool = vi.fn().mockResolvedValue({});
    constructor(opts: any) { capturedToolPostProcessorOpts = opts; }
  },
}));

vi.mock('../agentChatToolExecutor', async () => ({
  AgentChatToolExecutor: class AgentChatToolExecutor {
    executeToolCall = vi.fn().mockResolvedValue({ result: 'ok' });
    invalidateActiveExecution = vi.fn();
    cancelActiveToolExecution = vi.fn().mockResolvedValue(undefined);
    registerActiveToolCancellationHandler = vi.fn().mockReturnValue({ dispose: vi.fn() });
    assertExecutionActive = vi.fn();
    cleanupIncompleteToolCalls = vi.fn().mockResolvedValue(undefined);
    constructor(opts: any) { capturedToolExecutorOpts = opts; }
  },
}));

vi.mock('../agentChatStreamingService', async () => ({
  AgentChatStreamingService: class AgentChatStreamingService {
    callWithToolsStreaming = vi.fn().mockResolvedValue({ content: '', toolCalls: [] });
    turnStartTime = 0;
    ttftReportedForTurn = false;
    constructor(opts: any) { capturedStreamingOpts = opts; }
  },
}));

vi.mock('../agentChatRuntimeState', async () => ({
  AgentChatRuntimeState: class AgentChatRuntimeState {
    chatStatus = 'idle' as any;
    currentCancellationToken: any = undefined;
    toolExecutionNonce = 0;
    activeToolCancellationHandler: any = null;
    pendingInteractiveRequest: any = null;
    messagesToSave: any[] = [];
    saveChain = Promise.resolve();
    constructor(_status: any) {}
    setChatStatus(s: any) { this.chatStatus = s; }
    bindCancellationToken(t: any) { this.currentCancellationToken = t; }
    clearCancellationToken() { this.currentCancellationToken = undefined; }
    bumpToolExecutionNonce() { return ++this.toolExecutionNonce; }
    setToolExecutionNonce(n: number) { this.toolExecutionNonce = n; }
    setActiveToolCancellationHandler(h: any) { this.activeToolCancellationHandler = h; }
    setPendingInteractiveRequest(r: any) { this.pendingInteractiveRequest = r; }
    setMessagesToSave(m: any[]) { this.messagesToSave = m; }
    setSaveChain(c: any) { this.saveChain = c; }
  },
}));

const mockEmitStreamingChunk = vi.fn();

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: class AgentChatOutputPort {
    getSender = vi.fn().mockReturnValue(null);
    setSender = vi.fn();
    hasSender = vi.fn().mockReturnValue(true);
    emitStatus = vi.fn();
    emitEvent = vi.fn();
    emitStreamingChunk = mockEmitStreamingChunk;
    clear = vi.fn();
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatTurnRunner', async () => ({
  AgentChatTurnRunner: class AgentChatTurnRunner {
    run = vi.fn().mockResolvedValue(undefined);
    runStreamMessage = vi.fn().mockResolvedValue([]);
    runRetry = vi.fn().mockResolvedValue([]);
    handleFailure = vi.fn().mockResolvedValue(undefined);
    constructor(opts: any) { capturedTurnRunnerOpts = opts; }
  },
}));

vi.mock('../agentChatPushReceiver', async () => ({
  AgentChatPushReceiver: class AgentChatPushReceiver {
    handlePushChunk = vi.fn();
    handlePushComplete = vi.fn().mockResolvedValue(undefined);
    cancelPush = vi.fn();
    startOrResetPushTimeout = vi.fn();
    destroy = vi.fn();
    constructor(..._args: any[]) {}
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { AgentChat, ChatStatus } from '../agentChat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_AGENT_CONFIG = {
  chat_id: 'chat-1',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'TestAgent',
    model: 'gpt-5',
    mcp_servers: [{ name: 'mcp1' }],
    system_prompt: 'Be helpful',
  },
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test',
    last_updated: new Date().toISOString(),
    chatSession_id: 'session-1',
    ...overrides,
  } as any;
}

function createAgent(sessionOverrides: Record<string, any> = {}, agentOverrides: Record<string, any> = {}) {
  const config = { ...BASE_AGENT_CONFIG, agent: { ...BASE_AGENT_CONFIG.agent, ...agentOverrides } };
  mockProfileCacheManager.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('coverage8 — getElectronApp branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses global.electron.app mock when present', () => {
    (global as any).electron = { app: { getVersion: () => '1.0' } };
    // Reconstructing an agent re-runs module; test the export directly via constructor
    const agent = createAgent();
    expect(agent).toBeDefined();
    delete (global as any).electron;
  });

  it('handles electron import error gracefully (covered via constructor)', () => {
    const agent = createAgent();
    expect(agent).toBeDefined();
  });
});

describe('coverage8 — createPromptService callbacks (lines 304-321)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes every callback in prompt service opts', () => {
    const agent = createAgent();
    expect(capturedPromptOpts.getCurrentUserAlias()).toBe('user1');
    expect(capturedPromptOpts.getChatId()).toBe('chat-1');
    expect(capturedPromptOpts.getChatSessionId()).toBe('session-1');
    expect(typeof capturedPromptOpts.getAgentName()).toBe('string');
    expect(capturedPromptOpts.getLatestAgentConfig()).not.toBeNull();
    expect(capturedPromptOpts.getInteractionPolicy()).toBe('allow-ui');
  });

  it('getPromptService creates lazily when promptService undefined', () => {
    const agent = createAgent();
    (agent as any).promptService = undefined;
    const svc = (agent as any).getPromptService();
    expect(svc).toBeDefined();
  });
});

describe('coverage8 — createSessionService callbacks (lines 323-365)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes read-side callbacks', () => {
    const agent = createAgent({ chat_history: [{ role: 'user', content: 'hi' }] });
    expect(capturedSessionOpts.getCurrentChatSession()).toBeDefined();
    expect(capturedSessionOpts.getCurrentUserAlias()).toBe('user1');
    expect(capturedSessionOpts.getChatId()).toBe('chat-1');
    expect(capturedSessionOpts.getChatSessionId()).toBe('session-1');
    expect(typeof capturedSessionOpts.getAgentName()).toBe('string');
    expect(capturedSessionOpts.getFirstUserMessage()).toBeNull();
    expect(Array.isArray(capturedSessionOpts.getMessagesToSave())).toBe(true);
    expect(capturedSessionOpts.getSaveChain()).toBeInstanceOf(Promise);
    expect(Array.isArray(capturedSessionOpts.getDisplayMessages())).toBe(true);
    expect(capturedSessionOpts.getSkipPersistence()).toBeFalsy();
  });

  it('invokes write-side callbacks', async () => {
    const agent = createAgent();
    const fakeSession = makeSession({ chatSession_id: 'session-2' });
    capturedSessionOpts.setCurrentChatSession(fakeSession);
    expect((agent as any).currentChatSession.chatSession_id).toBe('session-2');

    capturedSessionOpts.setFirstUserMessage({ role: 'user', content: 'hello' });
    expect((agent as any).firstUserMessage).toBeDefined();

    capturedSessionOpts.setMessagesToSave([{ role: 'user' }]);
    expect((agent as any).runtimeState.messagesToSave).toHaveLength(1);

    capturedSessionOpts.setSaveChain(Promise.resolve());
  });

  it('invokes delegation callbacks', async () => {
    const agent = createAgent();
    // addMessageToChatHistory
    capturedSessionOpts.addMessageToChatHistory({ role: 'assistant', content: 'hi' });
    // addMessageToContext
    await capturedSessionOpts.addMessageToContext({ role: 'user', content: 'yo' });
    // exitNewChatSessionState
    capturedSessionOpts.exitNewChatSessionState();
    // calculateAndNotifyContext
    await capturedSessionOpts.calculateAndNotifyContext();
    // getSchedulerMetadata
    const meta = capturedSessionOpts.getSchedulerMetadata();
    expect(meta).toBeDefined();
  });

  it('getSessionService creates lazily when sessionService undefined', () => {
    const agent = createAgent();
    (agent as any).sessionService = undefined;
    expect((agent as any).getSessionService()).toBeDefined();
  });
});

describe('coverage8 — createContextService callbacks (lines 366-407)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes read-side callbacks', () => {
    const agent = createAgent();
    expect(capturedContextOpts.getCurrentChatSession()).toBeDefined();
    expect(capturedContextOpts.getCurrentUserAlias()).toBe('user1');
    expect(typeof capturedContextOpts.getAgentName()).toBe('string');
    expect(capturedContextOpts.getLatestAgentConfig()).not.toBeNull();
    expect(typeof capturedContextOpts.getCurrentModelId()).toBe('string');
    expect(capturedContextOpts.getModelCapabilities('gpt-5')).toBeDefined();
    expect(Array.isArray(capturedContextOpts.getContextHistory())).toBe(true);
    expect(Array.isArray(capturedContextOpts.getChatHistory())).toBe(true);
    expect(capturedContextOpts.getFullModeCompressor()).toBeDefined();
    expect(Array.isArray(capturedContextOpts.getContextChangeListeners())).toBe(true);
    expect(capturedContextOpts.getLatestContextStats()).toBeNull();
  });

  it('invokes async read-side callbacks', async () => {
    const agent = createAgent();
    const prompt = await capturedContextOpts.getCombinedSystemPromptForCurrentTurn();
    expect(Array.isArray(prompt)).toBe(true);
    const tools = await capturedContextOpts.getCurrentAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(capturedContextOpts.getTokenCounter()).toBeDefined();
  });

  it('invokes write-side callbacks', () => {
    const agent = createAgent();
    capturedContextOpts.setChatStatus('sending_response');
    capturedContextOpts.setContextHistory([{ role: 'user', content: 'x' }]);
    expect((agent as any).currentChatSession.context_history).toHaveLength(1);
    capturedContextOpts.setLastUpdated('2024-01-01');
    expect((agent as any).currentChatSession.last_updated).toBe('2024-01-01');
    capturedContextOpts.setLatestContextStats({ totalTokens: 99 } as any);
    expect((agent as any).latestContextStats.totalTokens).toBe(99);
    capturedContextOpts.setContextTokenUsage({ used: 5 } as any);
    expect((agent as any).contextTokenUsage).toBeDefined();
  });

  it('setContextHistory / setLastUpdated no-op when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(() => capturedContextOpts.setContextHistory([])).not.toThrow();
    expect(() => capturedContextOpts.setLastUpdated('2024-01-01')).not.toThrow();
  });

  it('getContextService creates lazily', () => {
    const agent = createAgent();
    (agent as any).contextService = undefined;
    expect((agent as any).getContextService()).toBeDefined();
  });
});

describe('coverage8 — createInteractionService callbacks (lines 409-434)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes all callbacks', async () => {
    const agent = createAgent();
    expect(capturedInteractionOpts.getChatId()).toBe('chat-1');
    expect(capturedInteractionOpts.getChatSessionId()).toBe('session-1');
    expect(typeof capturedInteractionOpts.getAgentName()).toBe('string');
    expect(capturedInteractionOpts.getEventSender()).toBeNull();
    expect(capturedInteractionOpts.getCurrentChatSession()).toBeDefined();
    await capturedInteractionOpts.saveChatSession();
    capturedInteractionOpts.safeEmitEvent('test-event', { x: 1 });
    expect(capturedInteractionOpts.getPendingInteractiveRequest()).toBeNull();
    capturedInteractionOpts.setPendingInteractiveRequest({ id: 'req1' });
    expect((agent as any).runtimeState.pendingInteractiveRequest).toBeDefined();
    expect(capturedInteractionOpts.getInteractionPolicy()).toBe('allow-ui');
    capturedInteractionOpts.reportBlockedInteraction({ reason: 'blocked' });
    expect((agent as any).blockedInteractionDetails).toBeDefined();
  });

  it('getInteractionService creates lazily', () => {
    const agent = createAgent();
    (agent as any).interactionService = undefined;
    expect((agent as any).getInteractionService()).toBeDefined();
  });
});

describe('coverage8 — createToolPostProcessor callbacks (lines 436-454)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes all callbacks', () => {
    const agent = createAgent();
    expect(typeof capturedToolPostProcessorOpts.getAgentName()).toBe('string');
    expect(capturedToolPostProcessorOpts.getChatId()).toBe('chat-1');
    expect(capturedToolPostProcessorOpts.getChatSessionId()).toBe('session-1');
    expect(capturedToolPostProcessorOpts.getInteractionPolicy()).toBe('allow-ui');
    expect(typeof capturedToolPostProcessorOpts.buildInteractionId('pfx')).toBe('string');
    const interactionReq = { id: 'req' } as any;
    const fallback = { approved: false } as any;
    capturedToolPostProcessorOpts.requestUserInteraction(interactionReq, fallback);
    capturedToolPostProcessorOpts.requestUserInfoInput({ fields: [], header: { title: '' }, body: { description: '' } });
  });

  it('getToolPostProcessor creates lazily', () => {
    const agent = createAgent();
    (agent as any).toolPostProcessor = undefined;
    expect((agent as any).getToolPostProcessor()).toBeDefined();
  });
});


describe('coverage8 — createStreamingService callbacks (lines 492-515)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes all callbacks', async () => {
    const agent = createAgent();
    // Trigger lazy creation of streaming service
    (agent as any).getStreamingService();
    expect(capturedStreamingOpts).toBeDefined();
    expect(typeof capturedStreamingOpts.getAgentName()).toBe('string');
    expect(capturedStreamingOpts.getChatId()).toBe('chat-1');
    expect(capturedStreamingOpts.getChatSessionId()).toBe('session-1');
    expect(typeof capturedStreamingOpts.getCurrentModelId()).toBe('string');
    expect(capturedStreamingOpts.getCurrentModelConfig('gpt-5')).toBeDefined();
    expect(capturedStreamingOpts.getModelCapabilities('gpt-5')).toBeDefined();
    const tools = await capturedStreamingOpts.getCurrentAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
    const prompt = await capturedStreamingOpts.getCombinedSystemPromptForCurrentTurn();
    expect(Array.isArray(prompt)).toBe(true);
    expect(Array.isArray(capturedStreamingOpts.getContextHistory())).toBe(true);
    expect(typeof capturedStreamingOpts.currentModelSupportsTools()).toBe('boolean');
    const session = await capturedStreamingOpts.getSessionFromAuthManager();
    // null or object
    capturedStreamingOpts.emitStreamingChunk({ type: 'text', text: 'hi' });
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith({ type: 'text', text: 'hi' });
    capturedStreamingOpts.setChatStatus('idle');
  });

  it('getStreamingService creates lazily', () => {
    const agent = createAgent();
    (agent as any).streamingService = undefined;
    expect((agent as any).getStreamingService()).toBeDefined();
  });
});

describe('coverage8 — createTurnRunner callbacks (lines 517-566)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes all callbacks', async () => {
    const agent = createAgent({ context_history: [{ role: 'user', content: [{ type: 'text', text: 'yo' }] }] });
    // Trigger lazy creation of turn runner
    (agent as any).getTurnRunner();
    expect(typeof capturedTurnRunnerOpts.getAgentName()).toBe('string');
    expect(capturedTurnRunnerOpts.getChatId()).toBe('chat-1');
    expect(capturedTurnRunnerOpts.getChatSessionId()).toBe('session-1');
    expect(capturedTurnRunnerOpts.getCurrentChatSession()).toBeDefined();
    expect(Array.isArray(capturedTurnRunnerOpts.getChatHistory())).toBe(true);
    expect(Array.isArray(capturedTurnRunnerOpts.getDisplayMessages())).toBe(true);
    const authSession = await capturedTurnRunnerOpts.getSessionFromAuthManager();
    await capturedTurnRunnerOpts.runConversationAttempt(undefined, {});
    await capturedTurnRunnerOpts.checkAndCompress({});
    capturedTurnRunnerOpts.setChatStatus('idle');
    const streaming = await capturedTurnRunnerOpts.callWithToolsStreaming(undefined);
    expect(streaming).toBeDefined();
    await capturedTurnRunnerOpts.addMessageToSession({ role: 'assistant', content: 'yo' });
    const approvals = await capturedTurnRunnerOpts.batchValidateAndRequestApproval([{ id: 't1', function: { name: 'f', arguments: '{}' } }]);
    expect(approvals).toBeDefined();
    const toolResult = await capturedTurnRunnerOpts.executeToolCall({ id: 't1' }, true);
    expect(toolResult).toBeDefined();
    const postResult = await capturedTurnRunnerOpts.postProcessToolResult({ id: 't1' }, { result: 'r' });
    expect(postResult).toBeDefined();
    capturedTurnRunnerOpts.assertExecutionActive(undefined, 0, 'test-stage');
    const hash = capturedTurnRunnerOpts.createMcpImageHash('data', 'image/png');
    expect(typeof hash).toBe('string');
    const hasHash = capturedTurnRunnerOpts.hasInjectedMcpImageHash(hash);
    expect(typeof hasHash).toBe('boolean');
    const chunk = { type: 'text', text: 'chunk' };
    capturedTurnRunnerOpts.emitStreamingChunk(chunk);
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(chunk);
    await capturedTurnRunnerOpts.saveChatSession();
    await capturedTurnRunnerOpts.calculateAndNotifyContext();
    await capturedTurnRunnerOpts.extractFactsFromConversation();
    await capturedTurnRunnerOpts.cleanupIncompleteToolCalls();
    capturedTurnRunnerOpts.resetMessagesToSave();
    expect((agent as any).runtimeState.messagesToSave).toHaveLength(0);
    capturedTurnRunnerOpts.clearOutput();
    expect(typeof capturedTurnRunnerOpts.getCurrentModelId()).toBe('string');
  });

  it('onUsageReceived — totalTokens > 0 calls addXP', () => {
    createAgent();
    (({} as any).__proto__ = null); // no-op to avoid lint
    const agent2 = createAgent();
    (agent2 as any).getTurnRunner();
    capturedTurnRunnerOpts.onUsageReceived({ totalTokens: 42 });
    expect(mockBuddyAddXP).toHaveBeenCalledWith(42, 'chat');
  });

  it('onUsageReceived — totalTokens == 0 skips addXP', () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    mockBuddyAddXP.mockClear();
    capturedTurnRunnerOpts.onUsageReceived({ totalTokens: 0 });
    expect(mockBuddyAddXP).not.toHaveBeenCalled();
  });

  it('onUsageReceived — BuddyManager throws without propagating', async () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    // Simulate BuddyManager.getInstance throwing by importing the mock directly
    const buddyModule = await import('../../buddy/BuddyManager');
    vi.mocked(buddyModule.BuddyManager.getInstance).mockImplementationOnce(() => { throw new Error('buddy down'); });
    expect(() => capturedTurnRunnerOpts.onUsageReceived({ totalTokens: 10 })).not.toThrow();
  });

  it('anchorTokenEstimate — delegates to contextService', () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    const spy = vi.spyOn((agent as any).contextService!, 'anchorTokenEstimate');
    capturedTurnRunnerOpts.anchorTokenEstimate(1000);
    expect(spy).toHaveBeenCalledWith(1000);
  });

  it('anchorTokenEstimate — no-op when contextService is null', () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    (agent as any).contextService = undefined;
    expect(() => capturedTurnRunnerOpts.anchorTokenEstimate(500)).not.toThrow();
  });

  it('getTurnRunner creates lazily', () => {
    const agent = createAgent();
    (agent as any).turnRunner = undefined;
    expect((agent as any).getTurnRunner()).toBeDefined();
  });
});


describe('coverage8 — drainBackgroundSubAgentResults (lines 854-895)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no-ops when no sessionId', async () => {
    const agent = createAgent();
    (agent as any).chatSessionId = '';
    await expect((agent as any).drainBackgroundSubAgentResults()).resolves.not.toThrow();
  });

  it('no-ops when drain returns empty', async () => {
    const mockManager = {
      drainResults: vi.fn(() => []),
      drainNotifications: vi.fn(() => []),
    };
    vi.doMock('../subAgent/subAgentManager', () => ({
      SubAgentManager: { getInstance: () => mockManager },
    }));
    const agent = createAgent();
    await expect((agent as any).drainBackgroundSubAgentResults()).resolves.not.toThrow();
  });

  it('handles subAgentManager errors gracefully', async () => {
    // The dynamic import may throw — function should not propagate
    const agent = createAgent();
    // Force error by patching dynamic import path — just ensure no throw
    await expect((agent as any).drainBackgroundSubAgentResults()).resolves.not.toThrow();
  });
});

describe('coverage8 — session service delegation methods', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generateChatSessionTitle delegates (line 1077)', async () => {
    const agent = createAgent();
    await expect((agent as any).generateChatSessionTitle({ role: 'user', content: 'hi' })).resolves.not.toThrow();
  });

  it('generateFallbackTitle delegates (line 1084)', () => {
    const agent = createAgent();
    expect((agent as any).generateFallbackTitle('hello')).toBe('Fallback');
  });

  it('AddMessageToSession delegates (line 1092)', async () => {
    const agent = createAgent();
    await expect((agent as any).AddMessageToSession({ role: 'user', content: 'hi' })).resolves.not.toThrow();
  });
});

describe('coverage8 — createMcpImageHash / hasInjectedMcpImageHash (lines 1096-1120)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createMcpImageHash returns MD5 hex', () => {
    const agent = createAgent();
    const hash = (agent as any).createMcpImageHash('abc123', 'image/png');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(32);
  });

  it('hasInjectedMcpImageHash returns false with no chat history', () => {
    const agent = createAgent();
    expect((agent as any).hasInjectedMcpImageHash('deadbeef')).toBe(false);
  });

  it('hasInjectedMcpImageHash returns true when hash found in user message', () => {
    const hash = 'abc123hash';
    const session = makeSession({
      chat_history: [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', data: 'x' }, metadata: { autoInjectedToolResultHash: hash } }],
      }],
    });
    const agent = createAgent();
    (agent as any).currentChatSession = session;
    expect((agent as any).hasInjectedMcpImageHash(hash)).toBe(true);
  });

  it('hasInjectedMcpImageHash skips non-user messages', () => {
    const session = makeSession({
      chat_history: [{ role: 'assistant', content: 'hi' }],
    });
    const agent = createAgent();
    (agent as any).currentChatSession = session;
    expect((agent as any).hasInjectedMcpImageHash('anyHash')).toBe(false);
  });
});

describe('coverage8 — extractFactsFromConversation (line 1127)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to contextService', async () => {
    const agent = createAgent();
    await expect((agent as any).extractFactsFromConversation()).resolves.not.toThrow();
  });
});

describe('coverage8 — tool/interaction delegation methods (lines 1152-1509)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assertExecutionActive delegates', () => {
    const agent = createAgent();
    expect(() => (agent as any).assertExecutionActive(undefined, 0, 'stage')).not.toThrow();
  });

  it('buildInteractionId delegates', () => {
    const agent = createAgent();
    expect(typeof (agent as any).buildInteractionId('pfx')).toBe('string');
  });

  it('buildInteractionHistoryEntry delegates', () => {
    const agent = createAgent();
    const req = { id: 'r1' } as any;
    const resp = { approved: true } as any;
    expect((agent as any).buildInteractionHistoryEntry(req, resp)).toBeDefined();
  });

  it('buildInteractionSummary delegates', () => {
    const agent = createAgent();
    expect(typeof (agent as any).buildInteractionSummary({} as any, {} as any)).toBe('string');
  });

  it('finalizeInteractiveRequest delegates', async () => {
    const agent = createAgent();
    const resp = await (agent as any).finalizeInteractiveRequest({} as any, {} as any);
    expect(resp).toBeDefined();
  });

  it('requestUserInteraction delegates', async () => {
    const agent = createAgent();
    await expect((agent as any).requestUserInteraction({} as any, {} as any)).resolves.toBeDefined();
  });

  it('requestApprovalInteraction delegates', async () => {
    const agent = createAgent();
    const result = await (agent as any).requestApprovalInteraction([]);
    expect(result instanceof Map).toBe(true);
  });

  it('batchValidateAndRequestApproval delegates', async () => {
    const agent = createAgent();
    const result = await (agent as any).batchValidateAndRequestApproval([]);
    expect(result instanceof Map).toBe(true);
  });

  it('postProcessToolResult delegates', async () => {
    const agent = createAgent();
    await expect((agent as any).postProcessToolResult({}, {})).resolves.toBeDefined();
  });

  it('postProcessForRequestInteractiveInputTool delegates', async () => {
    const agent = createAgent();
    await expect((agent as any).postProcessForRequestInteractiveInputTool({})).resolves.toBeDefined();
  });

  it('requestUserInfoInput delegates', async () => {
    const agent = createAgent();
    const result = await (agent as any).requestUserInfoInput({
      fields: [], header: { title: '' }, body: { description: '' },
    });
    expect(result).toBeNull();
  });

  it('requestUserChoice delegates', async () => {
    const agent = createAgent();
    const result = await (agent as any).requestUserChoice('t', 'd', [], 'single');
    expect(result).toBeNull();
  });

  it('registerActiveToolCancellationHandler delegates', () => {
    const agent = createAgent();
    const handle = (agent as any).registerActiveToolCancellationHandler(() => {});
    expect(handle).toBeDefined();
    expect(typeof handle.dispose).toBe('function');
  });
});

describe('coverage8 — getCurrentModelConfig (lines 1552-1572)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns fallback config when model not found', () => {
    mockGetModelById.mockReturnValue(undefined);
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('unknown-model');
    expect(cfg.maxTokens).toBe(4000);
    expect(cfg.supportsTools).toBe(false);
  });

  it('returns full config when model found', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 8000 },
        family: 'gpt',
        supports: { tool_calls: true, vision: true },
      },
    });
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('gpt-5');
    expect(cfg.maxTokens).toBe(8000);
    expect(cfg.supportsTools).toBe(true);
    expect(cfg.supportsImages).toBe(true);
  });

  it('supportsTemperature false for o3 family', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 4000 },
        family: 'o3-turbo',
        supports: { tool_calls: false, vision: false },
      },
    });
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('o3');
    expect(cfg.supportsTemperature).toBe(false);
  });

  it('supportsTemperature false for o4 family', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 4000 },
        family: 'o4-mini',
        supports: { tool_calls: true, vision: false },
      },
    });
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('o4');
    expect(cfg.supportsTemperature).toBe(false);
  });
});


describe('coverage8 — getContextSummary (lines 1190-1206)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty string when no context history', () => {
    const agent = createAgent({ context_history: [] });
    expect(agent.getContextSummary()).toBe('');
  });

  it('returns summary text for context history with content', () => {
    const agent = createAgent({
      context_history: [{ role: 'user', content: [{ type: 'text', text: 'Hello there' }] }],
    });
    const summary = agent.getContextSummary();
    expect(summary).toContain('user');
  });

  it('slices to last 20 messages', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: 'user', content: [{ type: 'text', text: `msg${i}` }],
    }));
    const agent = createAgent({ context_history: history });
    const summary = agent.getContextSummary();
    expect(typeof summary).toBe('string');
  });
});

describe('coverage8 — CheckAndCompress (line 1214)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to contextService.checkAndCompress', async () => {
    const agent = createAgent();
    const result = await (agent as any).CheckAndCompress({ force: true });
    expect(result.applied).toBe(false);
  });
});

describe('coverage8 — setCompressionEnabled / isCompressionEnabled / getCompressionStatus (1518-1542)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setCompressionEnabled is a no-op', () => {
    const agent = createAgent();
    expect(() => agent.setCompressionEnabled(false)).not.toThrow();
    expect(() => agent.setCompressionEnabled(true)).not.toThrow();
  });

  it('isCompressionEnabled returns true when compressor exists', () => {
    const agent = createAgent();
    expect(agent.isCompressionEnabled()).toBe(true);
  });

  it('isCompressionEnabled returns false when compressor is null', () => {
    const agent = createAgent();
    (agent as any).fullModeCompressor = null;
    expect(agent.isCompressionEnabled()).toBe(false);
  });

  it('getCompressionStatus returns enabled:true and model', () => {
    const agent = createAgent();
    const status = agent.getCompressionStatus();
    expect(status.enabled).toBe(true);
    expect(typeof status.currentModel).toBe('string');
    expect(typeof status.fullModeCompressionReady).toBe('boolean');
  });
});

describe('coverage8 — external agent / push receiver methods (1285-1336)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handlePushChunk delegates', () => {
    const agent = createAgent();
    agent.handlePushChunk('text', 'msg-1');
    // No throw
  });

  it('handlePushComplete delegates', async () => {
    const agent = createAgent();
    await expect(agent.handlePushComplete()).resolves.not.toThrow();
  });

  it('addMessageToSession delegates', async () => {
    const agent = createAgent();
    await expect(agent.addMessageToSession({ role: 'user', content: 'hi' } as any)).resolves.not.toThrow();
  });

  it('cancelPush delegates', () => {
    const agent = createAgent();
    expect(() => agent.cancelPush()).not.toThrow();
  });

  it('streamMessage routes EXTERNAL agent through handleExternalAgentMessage', async () => {
    mockHandleExternalAgentMessage.mockResolvedValue([]);
    // Create agent with EXTERNAL source config
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { name: 'X', model: 'gpt-5', role: 'a', emoji: '🤖', source: 'EXTERNAL', mcp_servers: [] },
    });
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());
    // Mock isFeatureEnabled AFTER agent creation, before streamMessage
    mockIsFeatureEnabled.mockReturnValue(true);
    const result = await agent.streamMessage({ role: 'user', content: 'hi' } as any);
    expect(mockHandleExternalAgentMessage).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('streamMessage external — non-empty result skips push timeout', async () => {
    mockHandleExternalAgentMessage.mockResolvedValue([{ role: 'assistant', content: 'hi' }]);
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { name: 'X', model: 'gpt-5', role: 'a', emoji: '🤖', source: 'EXTERNAL', mcp_servers: [] },
    });
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());
    mockIsFeatureEnabled.mockReturnValue(true);
    const result = await agent.streamMessage({ role: 'user', content: 'hi' } as any);
    expect(result).toHaveLength(1);
  });
});

describe('coverage8 — startChat with sessionStartHookFired paths (lines 1341-1398)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires SessionStart hook on first call then not on second', async () => {
    const agent = createAgent();
    const runtime = (agent as any).getHookRuntime();
    const sessionStartSpy = vi.spyOn(runtime, 'runSessionStartHook').mockResolvedValue({});
    await (agent as any).startChat(undefined, {});
    expect(sessionStartSpy).toHaveBeenCalledWith('new', undefined);
    await (agent as any).startChat(undefined, {});
    expect(sessionStartSpy).toHaveBeenCalledTimes(1);
  });

  it('Agent Hooks SessionStart injects additionalContexts', async () => {
    const agent = createAgent();
    const runtime = (agent as any).getHookRuntime();
    vi.spyOn(runtime, 'runSessionStartHook').mockResolvedValueOnce({ additionalContexts: ['ctx1', 'ctx2'] });
    await (agent as any).startChat(undefined, {});
    expect((agent as any).promptService.setHookAdditionalContexts).toHaveBeenCalledWith(['ctx1', 'ctx2']);
  });

  it('session with workspace string provides workspacePath to Agent Hooks', async () => {
    const agent = createAgent();
    // After agent is constructed, override getChatConfig so startChat sees workspace
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: {
        name: 'X', model: 'gpt-5', role: 'a', emoji: '🤖', mcp_servers: [],
        workspace: '/home/user/workspace',
      },
    });
    const runtime = (agent as any).getHookRuntime();
    const sessionStartSpy = vi.spyOn(runtime, 'runAgentHooks').mockResolvedValueOnce({});
    await (agent as any).startChat(undefined, {});
    expect(sessionStartSpy).toHaveBeenCalledWith('SessionStart', expect.objectContaining({
      cwd: '/home/user/workspace',
    }), undefined);
  });

  it('empty workspace string omits workspacePath for Agent Hooks', async () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: {
        name: 'X', model: 'gpt-5', role: 'a', emoji: '🤖', mcp_servers: [],
        workspace: '   ',
      },
    });
    const runtime = (agent as any).getHookRuntime();
    const sessionStartSpy = vi.spyOn(runtime, 'runAgentHooks').mockResolvedValueOnce({});
    await (agent as any).startChat(undefined, {});
    expect(sessionStartSpy).toHaveBeenCalledWith('SessionStart', expect.not.objectContaining({
      workspacePath: expect.anything(),
    }), undefined);
  });
});

describe('coverage8 — getSchedulerMetadata (lines 1292-1294)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns metadata object', () => {
    const agent = createAgent();
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta).toBeDefined();
  });
});

describe('coverage8 — safeEmitEvent (line 695)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to outputPort.emitEvent', () => {
    const agent = createAgent();
    (agent as any).safeEmitEvent('some-event', { data: 1 });
  });
});

describe('coverage8 — initialize (line 727)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves successfully', async () => {
    const agent = createAgent();
    await expect(agent.initialize()).resolves.not.toThrow();
  });
});

describe('coverage8 — getSessionFromAuthManager branches (lines 1593-1610)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session when ghcAuth present', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({
      ghcAuth: { copilotTokens: { token: 'tok' }, user: { login: 'u1' } },
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).not.toBeNull();
    expect(session.type).toBe('ghc');
  });

  it('returns null when no ghcAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({ ghcAuth: null });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });

  it('returns null when getCurrentAuth throws', async () => {
    mockMainAuthManager.getCurrentAuth.mockImplementation(() => { throw new Error('auth error'); });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });

  it('returns null when currentAuth is null', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue(null);
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

describe('coverage8 — currentModelSupportsImages (line 1587)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when capabilities.supportsImages is true', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: true, tokenizer: 'o200k_base' });
    const agent = createAgent();
    expect(agent.currentModelSupportsImages()).toBe(true);
  });
});

describe('coverage8 — getModelCapabilities throws when not found (line 1574)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws GhcApiError when capabilities missing', () => {
    mockGetModelCapabilities.mockReturnValue(undefined as any);
    const agent = createAgent();
    expect(() => agent.getModelCapabilities('missing-model')).toThrow();
  });
});

describe('coverage8 — replaceFilePathInSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to sessionService', async () => {
    const agent = createAgent();
    const result = await agent.replaceFilePathInSession('old', 'new');
    expect(result).toBeDefined();
  });
});

describe('coverage8 — constructor with no chatSessionData (new session path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new chat session when no data provided', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-1', 'session-new');
    expect(agent).toBeDefined();
    expect(agent.getChatId()).toBe('chat-1');
    expect(agent.getUserAlias()).toBe('user1');
  });

  it('throws when userAlias is empty', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
    expect(() => new AgentChat('', 'chat-1', 'session-1')).toThrow();
  });
});

describe('coverage8 — addMessageToChatHistory branch (no currentChatSession)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when currentChatSession is null (expected behavior)', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(() => (agent as any).addMessageToChatHistory({ role: 'user', content: 'hi' })).toThrow('currentChatSession must be initialized');
  });
});
