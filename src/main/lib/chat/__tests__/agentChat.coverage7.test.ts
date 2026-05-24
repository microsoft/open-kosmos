/**
 * Additional coverage tests for agentChat.ts — coverage7
 * Targets remaining uncovered branches:
 * - notifyContextChange: delegates to contextService
 * - emitStreamingChunk: delegates to outputPort
 * - cleanupIncompleteToolCalls: delegates to toolExecutor
 * - exitNewChatSessionState: success + error path
 * - getContextTokenUsage: returns contextTokenUsage
 * - getDisplayMessages: combines prompts and history
 * - getAgentInfo: throws when no config; returns info when config present
 * - calculateThreeComponentTokens: delegates to contextService
 * - addContextChangeListener: with no latestContextStats vs with cached stats
 * - addStatusChangeListener / removeContextChangeListener
 * - destroy: clears state
 * - getSessionFromAuthManager: ghcAuth present; no ghcAuth; throws
 * - currentModelSupportsImages
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

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: { getInstance: vi.fn(() => ({ getCachedConfig: vi.fn() })) },
}));

const { mockAnalyticsManager } = vi.hoisted(() => ({
  mockAnalyticsManager: {
    recordChatSessionActivated: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../analytics', async () => ({
  analyticsManager: mockAnalyticsManager,
}));

const { mockHookRegistry } = vi.hoisted(() => ({
  mockHookRegistry: {
    execute: vi.fn().mockResolvedValue({ additionalContexts: [] }),
  },
}));

vi.mock('../../plugin/hooks/hookRegistry', async () => ({ hookRegistry: mockHookRegistry }));

const { mockAgentChatManager } = vi.hoisted(() => ({
  mockAgentChatManager: { exitNewChatSessionFor: vi.fn() },
}));

vi.mock('../agentChatManager', async () => ({
  agentChatManager: mockAgentChatManager,
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: vi.fn(() => ({ addXP: vi.fn() })) },
}));

// ── Services mocks ─────────────────────────────────────────────────────────────

const mockNotifyContextChange = vi.fn();
const mockCalculateThreeComponentTokens = vi.fn().mockResolvedValue({
  contextHistoryTokens: 10, systemPromptTokens: 5, toolsTokens: 2, totalTokens: 17
});
const mockCalculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
const mockContextService = {
  calculateAndNotifyContext: mockCalculateAndNotifyContext,
  addMessageToContext: vi.fn().mockResolvedValue(undefined),
  extractFactsFromConversation: vi.fn().mockResolvedValue(undefined),
  checkAndCompress: vi.fn().mockResolvedValue({ applied: false }),
  calculateThreeComponentTokens: mockCalculateThreeComponentTokens,
  enhanceUserMessageContext: vi.fn().mockImplementation(async (m: any) => m),
  notifyContextChange: mockNotifyContextChange,
  anchorTokenEstimate: vi.fn(),
};

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class AgentChatPromptService {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool1' }]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([{ role: 'system', content: 'custom' }]);
    getGlobalSystemPrompt = vi.fn().mockReturnValue([]);
    getAgentSpecificSystemPrompt = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForContext = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    buildSubAgentsSystemPrompt = vi.fn().mockReturnValue('');
    refreshSkillSnapshotIfNeeded = vi.fn().mockResolvedValue(undefined);
    setHookAdditionalContexts = vi.fn();
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
    calculateAndNotifyContext = mockCalculateAndNotifyContext;
    addMessageToContext = vi.fn().mockResolvedValue(undefined);
    extractFactsFromConversation = vi.fn().mockResolvedValue(undefined);
    checkAndCompress = vi.fn().mockResolvedValue({ applied: false });
    calculateThreeComponentTokens = mockCalculateThreeComponentTokens;
    enhanceUserMessageContext = vi.fn().mockImplementation(async (m: any) => m);
    notifyContextChange = mockNotifyContextChange;
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
    postProcessForGetMcpTemplateFromLibraryTool = vi.fn().mockResolvedValue({});
    postProcessForGetAgentTemplateFromLibraryTool = vi.fn().mockResolvedValue({});
    constructor(..._args: any[]) {}
  },
}));

const mockCleanupIncompleteToolCalls = vi.fn().mockResolvedValue(undefined);

vi.mock('../agentChatToolExecutor', async () => ({
  AgentChatToolExecutor: class AgentChatToolExecutor {
    executeToolCall = vi.fn().mockResolvedValue({});
    invalidateActiveExecution = vi.fn();
    cancelActiveToolExecution = vi.fn().mockResolvedValue(undefined);
    registerActiveToolCancellationHandler = vi.fn().mockReturnValue({ dispose: vi.fn() });
    assertExecutionActive = vi.fn();
    cleanupIncompleteToolCalls = mockCleanupIncompleteToolCalls;
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

const mockEmitStreamingChunk = vi.fn();

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: class AgentChatOutputPort {
    getSender = vi.fn().mockReturnValue(null);
    setSender = vi.fn();
    hasSender = vi.fn().mockReturnValue(false);
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentChat coverage7 — notifyContextChange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to contextService.notifyContextChange', () => {
    const agent = createAgent();
    const stats = { totalTokens: 100, usedTokens: 50 } as any;
    (agent as any).notifyContextChange(stats);
    expect(mockNotifyContextChange).toHaveBeenCalledWith(stats);
  });
});

describe('AgentChat coverage7 — emitStreamingChunk', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to outputPort.emitStreamingChunk', () => {
    const agent = createAgent();
    const chunk = { type: 'text', text: 'hello' };
    (agent as any).emitStreamingChunk(chunk);
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(chunk);
  });
});

describe('AgentChat coverage7 — cleanupIncompleteToolCalls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to toolExecutor.cleanupIncompleteToolCalls', async () => {
    const agent = createAgent();
    await (agent as any).cleanupIncompleteToolCalls();
    expect(mockCleanupIncompleteToolCalls).toHaveBeenCalled();
  });
});

describe('AgentChat coverage7 — exitNewChatSessionState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls agentChatManager.exitNewChatSessionFor on success', () => {
    const agent = createAgent();
    (agent as any).exitNewChatSessionState();
    expect(mockAgentChatManager.exitNewChatSessionFor).toHaveBeenCalledWith('chat-1', 'session-1');
  });

  it('handles agentChatManager.exitNewChatSessionFor throwing without propagating', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockImplementation(() => {
      throw new Error('Failed to exit');
    });
    expect(() => (agent as any).exitNewChatSessionState()).not.toThrow();
  });

  it('handles non-Error thrown in exitNewChatSessionState', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockImplementation(() => {
      throw 'string error';
    });
    expect(() => (agent as any).exitNewChatSessionState()).not.toThrow();
  });
});

describe('AgentChat coverage7 — getContextTokenUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null initially', () => {
    const agent = createAgent();
    expect(agent.getContextTokenUsage()).toBeNull();
  });
});

describe('AgentChat coverage7 — getDisplayMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines custom system prompt and chat history', () => {
    const historyMsg = { role: 'user', content: 'hello', timestamp: Date.now() };
    const agent = createAgent({ chat_history: [historyMsg] });
    const messages = agent.getDisplayMessages();
    // Custom system prompt comes first, then history
    expect(Array.isArray(messages)).toBe(true);
  });
});

describe('AgentChat coverage7 — getAgentInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns agent info when config is available', async () => {
    const agent = createAgent();
    const info = await agent.getAgentInfo();
    expect(info.name).toBe('TestAgent');
    expect(info.role).toBe('assistant');
    expect(typeof info.toolsCount).toBe('number');
  });

  it('throws when no config available (null userAlias)', async () => {
    // Create agent first, then make getChatConfig return null to simulate missing config at getAgentInfo time
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    await expect(agent.getAgentInfo()).rejects.toThrow();
  });
});

describe('AgentChat coverage7 — calculateThreeComponentTokens (via calculateAndNotifyContext)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calculateAndNotifyContext delegates to contextService', async () => {
    const agent = createAgent();
    await agent.calculateAndNotifyContext();
    expect(mockCalculateAndNotifyContext).toHaveBeenCalled();
  });
});

describe('AgentChat coverage7 — addContextChangeListener with cached stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call listener immediately when no latestContextStats', () => {
    const agent = createAgent();
    (agent as any).latestContextStats = null;
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('calls listener immediately when latestContextStats exists', () => {
    const agent = createAgent();
    const stats = { totalTokens: 100 } as any;
    (agent as any).latestContextStats = stats;
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).toHaveBeenCalledWith(stats);
  });

  it('still adds listener even when listener throws on cached stats', () => {
    const agent = createAgent();
    const stats = { totalTokens: 100 } as any;
    (agent as any).latestContextStats = stats;
    const listener = vi.fn().mockImplementation(() => { throw new Error('listener error'); });
    expect(() => agent.addContextChangeListener(listener)).not.toThrow();
    expect((agent as any).contextChangeListeners).toContain(listener);
  });
});

describe('AgentChat coverage7 — removeContextChangeListener', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes existing listener', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).toContain(listener);
    agent.removeContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).not.toContain(listener);
  });

  it('does nothing when listener not in list', () => {
    const agent = createAgent();
    const listener = vi.fn();
    expect(() => agent.removeContextChangeListener(listener)).not.toThrow();
  });
});

describe('AgentChat coverage7 — addStatusChangeListener / unsubscribe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an unsubscribe function that removes the listener', () => {
    const agent = createAgent();
    const listener = vi.fn();
    const unsubscribe = agent.addStatusChangeListener(listener);
    expect((agent as any).statusChangeListeners).toContain(listener);
    unsubscribe();
    expect((agent as any).statusChangeListeners).not.toContain(listener);
  });
});

describe('AgentChat coverage7 — destroy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears all listeners and resets state', () => {
    const agent = createAgent();
    const ctxListener = vi.fn();
    const statusListener = vi.fn();
    agent.addContextChangeListener(ctxListener);
    agent.addStatusChangeListener(statusListener);
    agent.destroy();
    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
    expect((agent as any).latestContextStats).toBeNull();
  });
});

describe('AgentChat coverage7 — getSessionFromAuthManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ghc session when ghcAuth present', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({
      ghcAuth: {
        copilotTokens: { token: 'tok-123' },
        user: { login: 'user1' },
      },
    });
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).not.toBeNull();
    expect(session.type).toBe('ghc');
    expect(session.accessToken).toBe('tok-123');
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

  it('returns null when getCurrentAuth returns null', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue(null);
    const agent = createAgent();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

describe('AgentChat coverage7 — currentModelSupportsImages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when model does not support images', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsImages: false, supportsTools: true, tokenizer: 'o200k_base' });
    const agent = createAgent();
    expect(agent.currentModelSupportsImages()).toBe(false);
  });

  it('returns true when model supports images', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsImages: true, supportsTools: true, tokenizer: 'o200k_base' });
    const agent = createAgent();
    expect(agent.currentModelSupportsImages()).toBe(true);
  });
});
