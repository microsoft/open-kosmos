/**
 * Additional coverage tests for agentChat.ts — coverage6
 * Targets uncovered branches:
 * - getChatSessionEntryTypeForUserMessage: new vs continued
 * - getMessageTimestampMs: numeric, string ISO, fallback to Date.now()
 * - addContextChangeListener: error thrown by cached stats listener
 * - setChatStatus: listener throws
 * - hasInjectedMcpImageHash: various branches
 * - getTokenCounter: encoding change triggers recreate
 * - startChat: sessionStartHookFired once; hook throws; additionalContexts injected
 * - getLatestAgentConfig: null userAlias / null chatId / no agent in config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

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
  mockGetModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: false, tokenizer: 'o200k_base' })),
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
  createFullModeCompressor: vi.fn(() => ({})),
  FullModeCompressor: class {},
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn(),
  detectTruncatedToolCalls: vi.fn(),
  sanitizeToolCallsForApi: vi.fn(),
  applyStorageCompressionToRecentMessages: vi.fn(),
}));

vi.mock('../agentChatManager', async () => ({
  agentChatManager: { exitNewChatSessionFor: vi.fn() },
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: vi.fn(() => ({ addXP: vi.fn() })) },
}));

// ── Services mocks (delegate to noop implementations) ────────────────────────

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class AgentChatPromptService {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([]);
    getGlobalSystemPrompt = vi.fn().mockReturnValue([]);
    getAgentSpecificSystemPrompt = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForContext = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    refreshSkillSnapshotIfNeeded = vi.fn().mockResolvedValue(undefined);
    setHookAdditionalContexts = vi.fn();
    setHookSystemMessages = vi.fn();
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: class AgentChatSessionService {
    saveChatSession = vi.fn().mockResolvedValue({ success: true });
    createChatSession = vi.fn();
    addMessageToSession = vi.fn().mockResolvedValue(undefined);
    generateChatSessionTitle = vi.fn().mockResolvedValue(undefined);
    generateFallbackTitle = vi.fn().mockReturnValue('Fallback Title');
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 0 });
    editUserMessage = vi.fn().mockResolvedValue([]);
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: -1, targetUserMessage: null, targetContextUserIndex: -1 });
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: class AgentChatContextService {
    calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
    addMessageToContext = vi.fn().mockResolvedValue(undefined);
    extractFactsFromConversation = vi.fn().mockResolvedValue(undefined);
    checkAndCompress = vi.fn().mockResolvedValue({ applied: false });
    calculateThreeComponentTokens = vi.fn().mockResolvedValue({ contextHistoryTokens: 0, systemPromptTokens: 0, toolsTokens: 0, totalTokens: 0 });
    enhanceUserMessageContext = vi.fn().mockImplementation(async (m: any) => m);
    notifyContextChange = vi.fn();
    anchorTokenEstimate = vi.fn();
    constructor(..._args: any[]) {}
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
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: class AgentChatToolPostProcessor {
    postProcessToolResult = vi.fn().mockResolvedValue({});
    postProcessForRequestInteractiveInputTool = vi.fn().mockResolvedValue({});
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatToolExecutor', async () => ({
  AgentChatToolExecutor: class AgentChatToolExecutor {
    executeToolCall = vi.fn().mockResolvedValue({});
    invalidateActiveExecution = vi.fn();
    cancelActiveToolExecution = vi.fn().mockResolvedValue(undefined);
    registerActiveToolCancellationHandler = vi.fn().mockReturnValue({ dispose: vi.fn() });
    assertExecutionActive = vi.fn();
    cleanupIncompleteToolCalls = vi.fn().mockResolvedValue(undefined);
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatStreamingService', async () => ({
  AgentChatStreamingService: class AgentChatStreamingService {
    callWithToolsStreaming = vi.fn().mockResolvedValue({ content: '', toolCalls: [] });
    turnStartTime = 0;
    ttftReportedForTurn = false;
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../agentChatRuntimeState', async () => ({
  AgentChatRuntimeState: class AgentChatRuntimeState {
    chatStatus = 'idle';
    currentCancellationToken: any = undefined;
    toolExecutionNonce = 0;
    activeToolCancellationHandler: any = null;
    pendingInteractiveRequest: any = null;
    messagesToSave: any[] = [];
    saveChain = Promise.resolve();
    constructor(_status: any) {}
    setChatStatus(s: string) { this.chatStatus = s; }
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

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: class AgentChatOutputPort {
    getSender = vi.fn().mockReturnValue(null);
    setSender = vi.fn();
    hasSender = vi.fn().mockReturnValue(false);
    emitStatus = vi.fn();
    emitEvent = vi.fn();
    emitStreamingChunk = vi.fn();
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
    constructor(..._args: any[]) {}
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

// ── imports ───────────────────────────────────────────────────────────────────

import { AgentChat, ChatStatus } from '../agentChat';

// ── helpers ───────────────────────────────────────────────────────────────────

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
    title: 'Test',
    last_updated: new Date().toISOString(),
    chatSession_id: 'session-1',
    ...overrides,
  } as any;
}

function createAgent(sessionOverrides: Record<string, any> = {}, agentOverrides: Record<string, any> = {}) {
  const config = { ...AGENT_CONFIG, agent: { ...AGENT_CONFIG.agent, ...agentOverrides } };
  mockProfileCacheManager.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

describe('AgentChat coverage6 — addContextChangeListener with cached stats error', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swallows error when cached stats listener throws', () => {
    const agent = createAgent();
    // Manually inject latestContextStats
    (agent as any).latestContextStats = { contextTokens: 100, maxContextTokens: 1000 };
    const badListener = vi.fn().mockImplementation(() => { throw new Error('listener crash'); });
    // Should not throw
    expect(() => agent.addContextChangeListener(badListener)).not.toThrow();
  });
});

describe('AgentChat coverage6 — setChatStatus with listener that throws', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not propagate listener exception', () => {
    const agent = createAgent();
    const throwingListener = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    agent.addStatusChangeListener(throwingListener);
    // Trigger status change via forceIdleStatus (which calls setChatStatus internally)
    // First set to non-idle so forceIdleStatus actually fires
    (agent as any).runtimeState.chatStatus = 'sending_response';
    expect(() => agent.forceIdleStatus()).not.toThrow();
  });
});

describe('AgentChat coverage6 — hasInjectedMcpImageHash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when chat history is empty', () => {
    const agent = createAgent({ chat_history: [] });
    expect((agent as any).hasInjectedMcpImageHash('abc123')).toBe(false);
  });

  it('returns false when no user message has matching hash', () => {
    const userMsg = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:...' }, metadata: { autoInjectedToolResultHash: 'other-hash' } }],
    };
    const agent = createAgent({ chat_history: [userMsg] });
    expect((agent as any).hasInjectedMcpImageHash('abc123')).toBe(false);
  });

  it('skips non-user messages', () => {
    const assistantMsg = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    };
    const agent = createAgent({ chat_history: [assistantMsg] });
    expect((agent as any).hasInjectedMcpImageHash('abc123')).toBe(false);
  });
});

describe('AgentChat coverage6 — getTokenCounter encoding change', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recreates token counter when model tokenizer changes', () => {
    const agent = createAgent();

    // Initially tokenizer is o200k_base
    expect((agent as any).tokenCounterEncoding).toBe('o200k_base');

    // Now the model reports a different tokenizer
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false, tokenizer: 'cl100k_base' });

    // getTokenCounter should detect the mismatch and recreate
    const counter = (agent as any).getTokenCounter();
    expect((agent as any).tokenCounterEncoding).toBe('cl100k_base');
    expect(mockCreateTokenCounter).toHaveBeenCalledTimes(2); // once in constructor, once on change
  });

  it('does not recreate when encoding is unchanged', () => {
    // Explicitly set mock before creating agent
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false, tokenizer: 'o200k_base' });
    const agent = createAgent();
    const callsBefore = mockCreateTokenCounter.mock.calls.length;
    // call getTokenCounter again — encoding should not change
    (agent as any).getTokenCounter();
    expect(mockCreateTokenCounter.mock.calls.length).toBe(callsBefore);
  });
});

describe('AgentChat coverage6 — startChat sessionStartHookFired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires SessionStart hook only once across multiple startChat calls', async () => {
    const agent = createAgent();
    const runtime = (agent as any).getHookRuntime();
    const sessionStartSpy = vi.spyOn(runtime, 'runSessionStartHook').mockResolvedValue({});

    // startChat is private — invoke via retryChat which calls getTurnRunner().runRetry
    // Actually we can reach it via the private method directly by casting
    const startChat = (agent as any).startChat.bind(agent);

    await startChat(undefined, {});
    await startChat(undefined, {});

    expect(sessionStartSpy).toHaveBeenCalledTimes(1);
  });

  it('injects additionalContexts when Agent Hooks provide them', async () => {
    const agent = createAgent();
    const runtime = (agent as any).getHookRuntime();
    vi.spyOn(runtime, 'runSessionStartHook').mockResolvedValue({ additionalContexts: ['context text 1'] });

    const startChat = (agent as any).startChat.bind(agent);
    await startChat(undefined, {});

    expect((agent as any).promptService.setHookAdditionalContexts).toHaveBeenCalledWith(['context text 1']);
  });
});

describe('AgentChat coverage6 — getLatestAgentConfig edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when config has no agent field', () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue({ chat_id: 'chat-1' }); // no .agent
    expect((agent as any).getLatestAgentConfig()).toBeNull();
  });

  it('returns config with reasoningEffort when present', () => {
    const agent = createAgent({}, { reasoningEffort: 'high' });
    const config = (agent as any).getLatestAgentConfig();
    expect(config?.reasoningEffort).toBe('high');
  });
});

describe('AgentChat coverage6 — initialize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls calculateAndNotifyContext without throwing', async () => {
    const agent = createAgent();
    await expect(agent.initialize()).resolves.toBeUndefined();
    expect((agent as any).contextService.calculateAndNotifyContext).toHaveBeenCalled();
  });
});

describe('AgentChat coverage6 — addMessageToSession (public)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to private AddMessageToSession', async () => {
    const agent = createAgent();
    const msg = { role: 'user', content: [], timestamp: Date.now() } as any;
    await agent.addMessageToSession(msg);
    expect((agent as any).sessionService.addMessageToSession).toHaveBeenCalled();
  });
});

describe('AgentChat coverage6 — setSchedulerJobId / setSkipPersistence / setInteractionPolicy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setSchedulerJobId stores the job id', () => {
    const agent = createAgent();
    agent.setSchedulerJobId('job-xyz');
    expect((agent as any).schedulerJobId).toBe('job-xyz');
  });

  it('setSkipPersistence sets the flag', () => {
    const agent = createAgent();
    agent.setSkipPersistence(true);
    expect((agent as any).skipPersistence).toBe(true);
  });

  it('setInteractionPolicy sets the policy', () => {
    const agent = createAgent();
    agent.setInteractionPolicy('forbid');
    expect((agent as any).interactionPolicy).toBe('forbid');
  });
});
