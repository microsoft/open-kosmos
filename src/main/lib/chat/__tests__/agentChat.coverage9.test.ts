/**
 * agentChat.coverage9.test.ts
 *
 * Targets the remaining uncovered branches after coverage1-8:
 *  - pushReceiver callbacks getChatSessionId/setChatStatus (lines 277-278)
 *  - constructor calculateAndNotifyContext().catch error ternary (line 289)
 *  - getAgentName config?.name || 'Unknown Agent' (line 301)
 *  - getAgentMcpServerNames config?.mcp_servers?.map ?? [] null-config branch (line 480)
 *  - Buddy onUsageReceived catch String(error) non-Error branch (line 552)
 *  - setChatStatus listener catch ternary (line 641)
 *  - getLatestAgentConfig empty alias / empty chatId guards (line 704)
 *  - initialize() inner/outer catch ternaries (lines 732, 735)
 *  - drainBackgroundSubAgentResults results/notifications branches (865-878)
 *  - hydrateSchedulerMetadata schedulerError ternary (line 1015)
 *  - getContextSummary msg.role || 'unknown' (line 1199)
 *  - handleExternalAgentMessage callback opts (lines 1291, 1294)
 *  - getCurrentModelConfig max_output_tokens || 4000 (line 1566)
 *  - getSessionFromAuthManager accessToken || '' (line 1600) and catch String(error) (1607)
 *  - addContextChangeListener catch String(error) (line 1621)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoisted mocks (mirrors coverage8) ─────────────────────────────────────────

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

// Drain target — top-level mock so the dynamic import resolves to our manager.
const { mockSubAgentManager } = vi.hoisted(() => ({
  mockSubAgentManager: {
    drainResults: vi.fn(() => []),
    drainNotifications: vi.fn(() => []),
  },
}));

vi.mock('../../subAgent/subAgentManager', async () => ({
  SubAgentManager: { getInstance: () => mockSubAgentManager },
}));

// Delivery-ledger ack is invoked after the injected notification is persisted.
const { mockAckPendingDeliveries } = vi.hoisted(() => ({
  mockAckPendingDeliveries: vi.fn(),
}));

vi.mock('../../subAgent/subAgentDeliveryLedger', async () => ({
  ackPendingDeliveries: mockAckPendingDeliveries,
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

const { mockBuddyAddXP, mockBuddyGetInstance } = vi.hoisted(() => ({
  mockBuddyAddXP: vi.fn(),
  mockBuddyGetInstance: vi.fn(),
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: (...args: unknown[]) => mockBuddyGetInstance(...args) },
}));

// ─── Captured option objects ──────────────────────────────────────────────────

let capturedToolExecutorOpts: any;
let capturedTurnRunnerOpts: any;
let capturedPushReceiverOpts: any;

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
    constructor(_opts: any) {}
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
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: -1 });
    constructor(_opts: any) {}
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
    constructor(_opts: any) {}
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
    constructor(_opts: any) {}
  },
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: class AgentChatToolPostProcessor {
    postProcessToolResult = vi.fn().mockResolvedValue({});
    postProcessForRequestInteractiveInputTool = vi.fn().mockResolvedValue({});
    constructor(_opts: any) {}
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
    constructor(_opts: any) {}
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
const mockEmitStatus = vi.fn();

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: class AgentChatOutputPort {
    getSender = vi.fn().mockReturnValue(null);
    setSender = vi.fn();
    hasSender = vi.fn().mockReturnValue(true);
    emitStatus = mockEmitStatus;
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
    constructor(opts: any) { capturedPushReceiverOpts = opts; }
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { AgentChat } from '../agentChat';

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

beforeEach(() => {
  vi.clearAllMocks();
  mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
  mockGetModelById.mockReturnValue(undefined);
  mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: true, tokenizer: 'o200k_base' });
  mockGetDefaultModel.mockReturnValue('gpt-5');
  mockCalculateAndNotifyContext.mockResolvedValue(undefined);
  mockBuddyGetInstance.mockReturnValue({ addXP: mockBuddyAddXP });
  mockSubAgentManager.drainResults.mockReturnValue([]);
  mockSubAgentManager.drainNotifications.mockReturnValue([]);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('coverage9 — pushReceiver callbacks (lines 277-278)', () => {
  it('getChatSessionId returns session id, then "" when no session', () => {
    const agent = createAgent();
    expect(capturedPushReceiverOpts.getChatSessionId()).toBe('session-1');
    (agent as any).currentChatSession = null;
    expect(capturedPushReceiverOpts.getChatSessionId()).toBe('');
  });

  it('setChatStatus maps sending_response and idle', () => {
    createAgent();
    expect(() => capturedPushReceiverOpts.setChatStatus('sending_response')).not.toThrow();
    expect(() => capturedPushReceiverOpts.setChatStatus('idle')).not.toThrow();
    expect(typeof capturedPushReceiverOpts.getChatStatus()).toBe('string');
  });
});

describe('coverage9 — constructor calculateAndNotifyContext catch ternary (line 289)', () => {
  it('logs error.message when Error rejected in constructor', async () => {
    mockCalculateAndNotifyContext.mockRejectedValueOnce(new Error('ctx error'));
    createAgent();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('stringifies non-Error rejection in constructor', async () => {
    mockCalculateAndNotifyContext.mockRejectedValueOnce('plain string reject');
    createAgent();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('coverage9 — getAgentName fallback (line 301) + getLatestAgentConfig guards (line 704)', () => {
  it('returns "Unknown Agent" when config is null', () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect((agent as any).getAgentName()).toBe('Unknown Agent');
  });

  it('getLatestAgentConfig returns null when currentUserAlias empty', () => {
    const agent = createAgent();
    (agent as any).currentUserAlias = '';
    expect((agent as any).getLatestAgentConfig()).toBeNull();
  });

  it('getLatestAgentConfig returns null when chatId empty', () => {
    const agent = createAgent();
    (agent as any).chatId = '';
    expect((agent as any).getLatestAgentConfig()).toBeNull();
  });

  it('getLatestAgentConfig returns null when chatConfig has no agent', () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: undefined });
    expect((agent as any).getLatestAgentConfig()).toBeNull();
  });
});

describe('coverage9 — getAgentMcpServerNames ?? [] null-config branch (line 480)', () => {
  it('returns [] when getLatestAgentConfig is null', () => {
    createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    const names = capturedToolExecutorOpts.getAgentMcpServerNames();
    expect(names).toEqual([]);
  });

  it('returns server names when config present', () => {
    createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
    const names = capturedToolExecutorOpts.getAgentMcpServerNames();
    expect(names).toContain('mcp1');
  });
});

describe('coverage9 — Buddy onUsageReceived catch String(error) (line 552)', () => {
  it('swallows non-Error thrown by BuddyManager.getInstance', () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    mockBuddyGetInstance.mockImplementationOnce(() => { throw 'plain string buddy failure'; });
    expect(() => capturedTurnRunnerOpts.onUsageReceived({ totalTokens: 10 })).not.toThrow();
  });

  it('swallows Error thrown by BuddyManager.getInstance', () => {
    const agent = createAgent();
    (agent as any).getTurnRunner();
    mockBuddyGetInstance.mockImplementationOnce(() => { throw new Error('buddy down'); });
    expect(() => capturedTurnRunnerOpts.onUsageReceived({ totalTokens: 10 })).not.toThrow();
  });
});

describe('coverage9 — setChatStatus listener catch ternary (line 641)', () => {
  it('swallows Error and non-Error thrown by status listeners', () => {
    const agent = createAgent();
    agent.addStatusChangeListener(() => { throw new Error('listener error'); });
    agent.addStatusChangeListener(() => { throw 'plain string listener failure'; });
    // setChatStatus is private — drive it through pushReceiver callback.
    expect(() => capturedPushReceiverOpts.setChatStatus('sending_response')).not.toThrow();
  });
});

describe('coverage9 — initialize() catch ternaries (lines 732, 735)', () => {
  it('inner catch logs Error when calculateAndNotifyContext rejects with Error', async () => {
    const agent = createAgent();
    mockCalculateAndNotifyContext.mockRejectedValueOnce(new Error('init ctx error'));
    await agent.initialize();
    await Promise.resolve();
  });

  it('inner catch stringifies non-Error rejection', async () => {
    const agent = createAgent();
    mockCalculateAndNotifyContext.mockRejectedValueOnce('init plain failure');
    await agent.initialize();
    await Promise.resolve();
  });

  it('outer catch logs Error and rethrows when calculateAndNotifyContext throws synchronously', async () => {
    const agent = createAgent();
    // The wrapper is async, so a mock rejection becomes a promise rejection (inner catch).
    // To hit the outer try/catch the method itself must throw synchronously — override it.
    (agent as any).calculateAndNotifyContext = () => { throw new Error('sync init error'); };
    await expect(agent.initialize()).rejects.toThrow('sync init error');
  });

  it('outer catch stringifies non-Error sync throw and rethrows', async () => {
    const agent = createAgent();
    (agent as any).calculateAndNotifyContext = () => { throw 'sync plain failure'; };
    await expect(agent.initialize()).rejects.toBe('sync plain failure');
  });
});

describe('coverage9 — drainBackgroundSubAgentResults branches (lines 865-878)', () => {
  it('no-ops when no sessionId', async () => {
    const agent = createAgent();
    (agent as any).chatSessionId = '';
    await expect((agent as any).drainBackgroundSubAgentResults()).resolves.not.toThrow();
  });

  it('returns early when both results and notifications empty', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([]);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    expect((agent as any).getContextHistory()).toHaveLength(0);
  });

  it('injects completed result (success ternary true)', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub A', success: true, durationMs: 1500, turnCount: 3, result: 'done well' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    const history = (agent as any).getContextHistory();
    expect(history.length).toBe(1);
  });

  it('injects failed result with partialResult (success ternary false)', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub B', success: false, durationMs: 800, turnCount: 1, error: 'boom', partialResult: 'half' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    expect((agent as any).getContextHistory().length).toBe(1);
  });

  it('injects failed result without partialResult', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub C', success: false, durationMs: 200, turnCount: 0, error: 'fatal', partialResult: '' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    expect((agent as any).getContextHistory().length).toBe(1);
  });

  it('injects notifications when present (notifications.length > 0)', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([]);
    mockSubAgentManager.drainNotifications.mockReturnValue([
      { type: 'info', subAgentName: 'Sub D', message: 'started' },
    ] as any);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    expect((agent as any).getContextHistory().length).toBe(1);
  });

  it('injects both results and notifications together', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub E', success: true, durationMs: 1000, turnCount: 2, result: 'ok' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([
      { type: 'warn', subAgentName: 'Sub E', message: 'note' },
    ] as any);
    const agent = createAgent();
    await (agent as any).drainBackgroundSubAgentResults();
    expect((agent as any).getContextHistory().length).toBe(1);
  });

  it('persists then acks ledger entries for results carrying a taskId', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub F', success: true, durationMs: 1200, turnCount: 2, result: 'ok', taskId: 'task-1' },
      // Empty taskId exercises the `id.length > 0` filter arm (dropped from ack).
      { subAgentName: 'Sub G', success: true, durationMs: 900, turnCount: 1, result: 'ok2', taskId: '' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    const saveSpy = vi.spyOn(agent as any, 'saveChatSession').mockResolvedValue({ success: true });
    await (agent as any).drainBackgroundSubAgentResults();
    // The injected notification is persisted before the ledger is acked, and only
    // the non-empty taskId is acked.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(mockAckPendingDeliveries).toHaveBeenCalledWith('session-1', ['task-1']);
    expect((agent as any).getContextHistory().length).toBe(1);
  });

  it('does not persist or ack when drained results carry no taskId', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub H', success: true, durationMs: 500, turnCount: 1, result: 'ok' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    const saveSpy = vi.spyOn(agent as any, 'saveChatSession').mockResolvedValue({ success: true });
    await (agent as any).drainBackgroundSubAgentResults();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(mockAckPendingDeliveries).not.toHaveBeenCalled();
  });

  it('does not ack the ledger when persisting the notification fails', async () => {
    mockSubAgentManager.drainResults.mockReturnValue([
      { subAgentName: 'Sub I', success: true, durationMs: 700, turnCount: 1, result: 'ok', taskId: 'task-9' },
    ] as any);
    mockSubAgentManager.drainNotifications.mockReturnValue([]);
    const agent = createAgent();
    // saveChatSession resolves { success: false } WITHOUT throwing — the ack must
    // be skipped so the durable ledger entry survives for a later re-delivery.
    const saveSpy = vi.spyOn(agent as any, 'saveChatSession').mockResolvedValue({ success: false, error: 'disk full' });
    await (agent as any).drainBackgroundSubAgentResults();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(mockAckPendingDeliveries).not.toHaveBeenCalled();
  });
});

describe('coverage9 — hydrateSchedulerMetadata schedulerError ternary (line 1015)', () => {
  it('includes schedulerError when provided', () => {
    const agent = createAgent();
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-1',
      schedulerExecutionStatus: 'failed',
      schedulerStartedAt: '2024-01-01',
      schedulerCompletedAt: '2024-01-02',
      schedulerError: 'it failed',
    } as any);
    expect((agent as any).schedulerExecutionMetadata.schedulerError).toBe('it failed');
  });

  it('omits schedulerError when absent', () => {
    const agent = createAgent();
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-2',
      schedulerExecutionStatus: undefined,
      schedulerStartedAt: undefined,
      schedulerCompletedAt: undefined,
      schedulerError: undefined,
    } as any);
    expect((agent as any).schedulerExecutionMetadata.schedulerError).toBeUndefined();
  });
});

describe('coverage9 — getContextSummary msg.role || "unknown" (line 1199)', () => {
  it('uses "unknown" role when message has no role', () => {
    const agent = createAgent({
      context_history: [{ content: [{ type: 'text', text: 'no role here' }] }],
    });
    const summary = agent.getContextSummary();
    expect(summary).toContain('unknown');
  });

  it('uses message role when present', () => {
    const agent = createAgent({
      context_history: [{ role: 'assistant', content: [{ type: 'text', text: 'hi there' }] }],
    });
    expect(agent.getContextSummary()).toContain('assistant');
  });
});

describe('coverage9 — handleExternalAgentMessage callbacks (lines 1291, 1294)', () => {
  it('passes chatSessionId and exercises emitStatus / addMessageToSession / emitStreamingChunk', async () => {
    const agent = createAgent();
    mockHandleExternalAgentMessage.mockResolvedValueOnce([]);
    await (agent as any).handleExternalAgentMessage({ role: 'user', content: 'hi' });
    const opts = mockHandleExternalAgentMessage.mock.calls[0][0];
    expect(opts.chatSessionId).toBe('session-1');
    expect(() => opts.addMessageToSession({ role: 'assistant', content: 'reply' })).not.toThrow();
    expect(() => opts.emitStreamingChunk({ type: 'text', text: 'x' })).not.toThrow();
    expect(() => opts.emitStatus('sending')).not.toThrow();
    expect(() => opts.emitStatus('idle')).not.toThrow();
  });

  it('chatSessionId falls back to "" when no current session', async () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    mockHandleExternalAgentMessage.mockResolvedValueOnce([{ role: 'assistant', content: 'x' }]);
    await (agent as any).handleExternalAgentMessage({ role: 'user', content: 'hi' });
    const opts = mockHandleExternalAgentMessage.mock.calls[0][0];
    expect(opts.chatSessionId).toBe('');
  });
});

describe('coverage9 — getCurrentModelConfig max_output_tokens || 4000 (line 1566)', () => {
  it('falls back to 4000 when limits.max_output_tokens is missing', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: {},
        family: 'gpt',
        supports: { tool_calls: true, vision: true },
      },
    });
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('gpt-5');
    expect(cfg.maxTokens).toBe(4000);
    expect(cfg.supportsTools).toBe(true);
  });

  it('uses limits.max_output_tokens when present', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 12000 },
        family: 'gpt',
        supports: { tool_calls: false, vision: false },
      },
    });
    const agent = createAgent();
    const cfg = (agent as any).getCurrentModelConfig('gpt-5');
    expect(cfg.maxTokens).toBe(12000);
  });
});

describe('coverage9 — getSessionFromAuthManager accessToken || "" and catch (lines 1600, 1607)', () => {
  it('accessToken falls back to "" when copilotTokens has no token', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({
      ghcAuth: { copilotTokens: {}, user: { login: 'u1' } },
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session.accessToken).toBe('');
  });

  it('accessToken uses token when present', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({
      ghcAuth: { copilotTokens: { token: 'tok-123' }, user: { login: 'u1' } },
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session.accessToken).toBe('tok-123');
  });

  it('catch stringifies non-Error thrown by getCurrentAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockImplementation(() => { throw 'plain string auth failure'; });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

describe('coverage9 — addContextChangeListener catch ternary (line 1621)', () => {
  it('swallows Error thrown by listener when cached stats exist', () => {
    const agent = createAgent();
    (agent as any).latestContextStats = { totalTokens: 5 } as any;
    expect(() => agent.addContextChangeListener(() => { throw new Error('listener boom'); })).not.toThrow();
  });

  it('swallows non-Error thrown by listener when cached stats exist', () => {
    const agent = createAgent();
    (agent as any).latestContextStats = { totalTokens: 9 } as any;
    expect(() => agent.addContextChangeListener(() => { throw 'plain listener failure'; })).not.toThrow();
  });

  it('does not invoke listener when no cached stats', () => {
    const agent = createAgent();
    (agent as any).latestContextStats = null;
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
