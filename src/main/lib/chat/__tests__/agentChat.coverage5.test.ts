// @ts-nocheck
/**
 * agentChat.coverage5.test.ts
 *
 * Targets remaining uncovered branches in agentChat.ts:
 * - constructor: empty userAlias throws
 * - constructor: no config found throws
 * - forceIdleStatus: already IDLE (early return) vs non-IDLE
 * - setSchedulerExecutionState: with and without options
 * - hydrateSchedulerMetadata: all fields
 * - updateSessionTitle: no session (returns false), with session (returns true)
 * - initializeEmptyChatSession
 * - addMessageToChatHistory: no session (throws), with session (pushes)
 * - getChatStatusInfo
 * - getUserAlias
 * - getCurrentModelId: from config, fallback
 * - getTokenCounter: encoding change triggers recreation
 * - addStatusChangeListener and notifyStatusListeners
 * - getAgentInfo
 * - getDisplayMessages
 * - destroy clears listeners
 */

// ─── Mocks (mirrors coverage4) ────────────────────────────────────────────────

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

const { mockGetModelById5, mockGetModelCapabilities5, mockGetDefaultModel5 } = vi.hoisted(() => ({
  mockGetModelById5: vi.fn(),
  mockGetModelCapabilities5: vi.fn(() => ({ tokenizer: 'o200k_base', supportsTools: true, maxContextLength: 128000 })),
  mockGetDefaultModel5: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: mockGetModelById5,
  getModelCapabilities: mockGetModelCapabilities5,
  getDefaultModel: mockGetDefaultModel5,
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

const { mockMainAuthManager5 } = vi.hoisted(() => ({
  mockMainAuthManager5: { getCurrentAuth: vi.fn() },
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: mockMainAuthManager5,
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
}));

const { mockProfileCacheManager5 } = vi.hoisted(() => ({
  mockProfileCacheManager5: {
    getChatConfig: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager5,
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

vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({ getCachedConfig: vi.fn(() => ({ name: 'helper-bot' })) })),
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

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: vi.fn().mockResolvedValue([]),
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
    calculateThreeComponentTokens = vi.fn().mockResolvedValue({
      contextHistoryTokens: 10, systemPromptTokens: 5, toolsTokens: 2, totalTokens: 17,
    });
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
    editUserMessage = vi.fn().mockResolvedValue([]);
    validateUserMessageEditable = vi.fn().mockReturnValue({ canEdit: true, targetUserIndex: 0 });
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 0 });
    getDisplayMessages = vi.fn().mockReturnValue([]);
    updateSessionTitle = vi.fn().mockReturnValue(true);
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
    executeToolCall = vi.fn().mockResolvedValue({ result: 'ok' });
    assertExecutionActive = vi.fn();
    invalidateActiveExecution = vi.fn();
    cancelActiveToolExecution = vi.fn().mockResolvedValue(undefined);
    registerActiveToolCancellationHandler = vi.fn().mockReturnValue({ dispose: vi.fn() });
    cleanupIncompleteToolCalls = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../agentChatStreamingService', async () => ({
  AgentChatStreamingService: class {
    callWithToolsStreaming = vi.fn().mockResolvedValue({ messages: [], usage: {} });
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

    setChatStatus = vi.fn().mockImplementation(function(this: any, s: string) { this.chatStatus = s; });
    bindCancellationToken = vi.fn().mockImplementation(function(this: any, t: any) { this.currentCancellationToken = t; });
    clearCancellationToken = vi.fn().mockImplementation(function(this: any) { this.currentCancellationToken = undefined; });
    bumpToolExecutionNonce = vi.fn().mockImplementation(function(this: any) { this.toolExecutionNonce += 1; return this.toolExecutionNonce; });
    setToolExecutionNonce = vi.fn();
    setActiveToolCancellationHandler = vi.fn();
    setPendingInteractiveRequest = vi.fn().mockImplementation(function(this: any, r: any) { this.pendingInteractiveRequest = r; });
    setMessagesToSave = vi.fn();
    setSaveChain = vi.fn();
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

vi.mock('../globalSystemPrompt', async () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => []),
}));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/path') },
}));

// ─── Import ────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentChat, ChatStatus } from '../agentChat';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const BASE_CONFIG = {
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

function createAgent(configOverrides: Record<string, any> = {}, sessionOverrides: Record<string, any> = {}) {
  const config = { ...BASE_CONFIG, agent: { ...BASE_CONFIG.agent, ...configOverrides } };
  mockProfileCacheManager5.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentChat (coverage5)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelCapabilities5.mockReturnValue({ tokenizer: 'o200k_base', supportsTools: true, maxContextLength: 128000 });
    mockGetDefaultModel5.mockReturnValue('gpt-5');
  });

  // ─── constructor errors ───────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws when userAlias is empty', () => {
      mockProfileCacheManager5.getChatConfig.mockReturnValue(BASE_CONFIG);
      expect(() => new AgentChat('', 'chat-1', 'session-1')).toThrow('userAlias is empty');
    });

    it('throws when no config found', () => {
      mockProfileCacheManager5.getChatConfig.mockReturnValue(null);
      expect(() => new AgentChat('user1', 'chat-1', 'session-1')).toThrow('no config found');
    });

    it('creates with existing chat session data', () => {
      const agent = createAgent({}, { chat_history: [{ role: 'user', content: 'hi' }] });
      expect(agent.getChatHistory()).toHaveLength(1);
    });

    it('creates new session when no session data provided', () => {
      mockProfileCacheManager5.getChatConfig.mockReturnValue(BASE_CONFIG);
      const agent = new AgentChat('user1', 'chat-1', 'session-new');
      expect(agent.getChatId()).toBe('chat-1');
    });
  });

  // ─── forceIdleStatus ──────────────────────────────────────────────────────

  describe('forceIdleStatus', () => {
    it('does nothing when already idle', () => {
      const agent = createAgent();
      const runtimeState = (agent as any).runtimeState;
      runtimeState.chatStatus = 'idle';
      agent.forceIdleStatus();
      expect(runtimeState.setChatStatus).not.toHaveBeenCalled();
    });

    it('sets status to idle when not idle', () => {
      const agent = createAgent();
      const runtimeState = (agent as any).runtimeState;
      runtimeState.chatStatus = 'sending_response';
      agent.forceIdleStatus();
      expect(runtimeState.setChatStatus).toHaveBeenCalled();
    });
  });

  // ─── setSchedulerExecutionState ──────────────────────────────────────────

  describe('setSchedulerExecutionState', () => {
    it('sets status only when no options', () => {
      const agent = createAgent();
      agent.setSchedulerExecutionState('running');
      expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('running');
    });

    it('sets all options when provided', () => {
      const agent = createAgent();
      agent.setSchedulerExecutionState('completed', {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T01:00:00Z',
        error: undefined,
      });
      expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('completed');
      expect((agent as any).schedulerExecutionMetadata.schedulerStartedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('sets error when provided', () => {
      const agent = createAgent();
      agent.setSchedulerExecutionState('failed', { error: 'task failed' });
      expect((agent as any).schedulerExecutionMetadata.schedulerError).toBe('task failed');
    });
  });

  // ─── hydrateSchedulerMetadata ─────────────────────────────────────────────

  describe('hydrateSchedulerMetadata', () => {
    it('hydrates all scheduler fields', () => {
      const agent = createAgent();
      agent.hydrateSchedulerMetadata({
        schedulerJobId: 'job-1',
        schedulerExecutionStatus: 'completed',
        schedulerStartedAt: '2026-01-01T00:00:00Z',
        schedulerCompletedAt: '2026-01-01T01:00:00Z',
        schedulerError: undefined,
      });
      expect((agent as any).schedulerJobId).toBe('job-1');
      expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('completed');
    });

    it('handles missing optional fields', () => {
      const agent = createAgent();
      agent.hydrateSchedulerMetadata({
        schedulerJobId: undefined,
        schedulerExecutionStatus: undefined,
        schedulerStartedAt: undefined,
        schedulerCompletedAt: undefined,
        schedulerError: undefined,
      });
      expect((agent as any).schedulerJobId).toBeUndefined();
    });
  });

  // ─── updateSessionTitle ──────────────────────────────────────────────────

  describe('updateSessionTitle', () => {
    it('returns false when no current session', () => {
      const agent = createAgent();
      (agent as any).currentChatSession = null;
      expect(agent.updateSessionTitle('New Title')).toBe(false);
    });

    it('updates title and returns true', () => {
      const agent = createAgent();
      expect(agent.updateSessionTitle('New Title')).toBe(true);
      expect((agent as any).currentChatSession?.title).toBe('New Title');
    });
  });

  // ─── initializeEmptyChatSession ──────────────────────────────────────────

  describe('initializeEmptyChatSession', () => {
    it('clears session and related state', () => {
      const agent = createAgent();
      (agent as any).schedulerJobId = 'job-1';
      (agent as any).firstUserMessage = { role: 'user', content: 'hi' };
      agent.initializeEmptyChatSession();
      expect((agent as any).currentChatSession).toBeNull();
      expect((agent as any).firstUserMessage).toBeNull();
      expect((agent as any).schedulerJobId).toBeUndefined();
    });
  });

  // ─── addMessageToChatHistory ──────────────────────────────────────────────

  describe('addMessageToChatHistory', () => {
    it('throws when no currentChatSession', () => {
      const agent = createAgent();
      (agent as any).currentChatSession = null;
      expect(() => agent.addMessageToChatHistory({ role: 'user', content: 'hi' } as any))
        .toThrow('currentChatSession must be initialized');
    });

    it('adds message to chat history', () => {
      const agent = createAgent();
      agent.addMessageToChatHistory({ role: 'user', content: 'hello' } as any);
      expect(agent.getChatHistory()).toHaveLength(1);
    });
  });

  // ─── getChatStatusInfo ────────────────────────────────────────────────────

  describe('getChatStatusInfo', () => {
    it('returns chat status info', () => {
      const agent = createAgent();
      const info = agent.getChatStatusInfo();
      expect(info).toHaveProperty('chatId', 'chat-1');
      expect(info).toHaveProperty('chatStatus');
      expect(info).toHaveProperty('agentName');
    });
  });

  // ─── getUserAlias ─────────────────────────────────────────────────────────

  describe('getUserAlias', () => {
    it('returns current user alias', () => {
      const agent = createAgent();
      expect(agent.getUserAlias()).toBe('user1');
    });
  });

  // ─── getCurrentModelId ────────────────────────────────────────────────────

  describe('getCurrentModelId', () => {
    it('returns model from config', () => {
      const agent = createAgent({ model: 'claude-3.5-sonnet' });
      expect(agent.getCurrentModelId()).toBe('claude-3.5-sonnet');
    });

    it('falls back to default model when no config', () => {
      const agent = createAgent();
      mockProfileCacheManager5.getChatConfig.mockReturnValue(null);
      expect(agent.getCurrentModelId()).toBe('gpt-5');
    });
  });

  // ─── getTokenCounter (encoding change) ────────────────────────────────────

  describe('getTokenCounter - encoding change', () => {
    it('recreates token counter when encoding changes', () => {
      const agent = createAgent();
      (agent as any).tokenCounterEncoding = 'cl100k_base';
      const oldCounter = (agent as any).tokenCounter;

      // Now getTokenCounter should detect mismatch and recreate
      mockGetModelCapabilities5.mockReturnValue({ tokenizer: 'o200k_base' });
      const counter = (agent as any).getTokenCounter();
      expect(counter).toBeDefined();
      // A new counter should be created (different from old or encoding updated)
      expect((agent as any).tokenCounterEncoding).toBe('o200k_base');
    });
  });

  // ─── addStatusChangeListener ─────────────────────────────────────────────

  describe('addStatusChangeListener', () => {
    it('registers listener and removes it on dispose', () => {
      const agent = createAgent();
      const listener = vi.fn();
      const remove = agent.addStatusChangeListener(listener);
      expect(typeof remove).toBe('function');
      remove();
      // After removal, calling forEach on statusChangeListeners should not include listener
      expect((agent as any).statusChangeListeners).not.toContain(listener);
    });

    it('listener is called on status change', () => {
      const agent = createAgent();
      const listener = vi.fn();
      agent.addStatusChangeListener(listener);
      // Directly invoke listeners as AgentChat does internally
      (agent as any).statusChangeListeners.forEach((l: any) => l('sending_response'));
      expect(listener).toHaveBeenCalledWith('sending_response');
    });
  });

  // ─── getAgentInfo ─────────────────────────────────────────────────────────

  describe('getAgentInfo', () => {
    it('returns agent info', async () => {
      const agent = createAgent();
      const info = await agent.getAgentInfo();
      expect(info).toHaveProperty('name', 'TestAgent');
    });
  });

  // ─── getChatHistory and getContextHistory ─────────────────────────────────

  describe('getChatHistory', () => {
    it('returns empty array when no session', () => {
      const agent = createAgent();
      (agent as any).currentChatSession = null;
      expect(agent.getChatHistory()).toEqual([]);
    });

    it('returns history from session', () => {
      const msg = { role: 'user', content: 'hi' };
      const agent = createAgent({}, { chat_history: [msg] });
      expect(agent.getChatHistory()).toHaveLength(1);
    });
  });

  // ─── getPendingInteractiveRequest ─────────────────────────────────────────

  describe('getPendingInteractiveRequest', () => {
    it('returns null when no pending request', () => {
      const agent = createAgent();
      expect(agent.getPendingInteractiveRequest()).toBeNull();
    });

    it('returns pending request when set', () => {
      const agent = createAgent();
      const mockRequest = { type: 'approval', id: 'req-1' };
      (agent as any).runtimeState.pendingInteractiveRequest = mockRequest;
      expect(agent.getPendingInteractiveRequest()).toBe(mockRequest);
    });
  });

  // ─── destroy ─────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('clears all listeners and context change listeners', () => {
      const agent = createAgent();
      const statusListener = vi.fn();
      const contextListener = vi.fn();
      agent.addStatusChangeListener(statusListener);
      agent.addContextChangeListener(contextListener);
      agent.destroy();
      // After destroy, listeners should be cleared
      expect((agent as any).statusChangeListeners).toHaveLength(0);
      expect((agent as any).contextChangeListeners).toHaveLength(0);
    });
  });

  // ─── addContextChangeListener ─────────────────────────────────────────────

  describe('addContextChangeListener', () => {
    it('registers a context change listener', () => {
      const agent = createAgent();
      const listener = vi.fn();
      agent.addContextChangeListener(listener);
      expect((agent as any).contextChangeListeners).toHaveLength(1);
    });

    it('removes listener on dispose', () => {
      const agent = createAgent();
      const listener = vi.fn();
      agent.addContextChangeListener(listener);
      agent.removeContextChangeListener(listener);
      expect((agent as any).contextChangeListeners).toHaveLength(0);
    });
  });

  // ─── getBlockedInteractionDetails ─────────────────────────────────────────

  describe('getBlockedInteractionDetails', () => {
    it('returns null by default', () => {
      const agent = createAgent();
      expect(agent.getBlockedInteractionDetails()).toBeNull();
    });
  });

  // ─── getCurrentChatSession ────────────────────────────────────────────────

  describe('getCurrentChatSession', () => {
    it('returns current chat session', () => {
      const agent = createAgent();
      expect(agent.getCurrentChatSession()).toBeDefined();
    });

    it('returns null after initializeEmptyChatSession', () => {
      const agent = createAgent();
      agent.initializeEmptyChatSession();
      expect(agent.getCurrentChatSession()).toBeNull();
    });
  });

  // ─── getChatSessionId ─────────────────────────────────────────────────────

  describe('getChatSessionId', () => {
    it('returns the chat session id', () => {
      const agent = createAgent();
      expect(agent.getChatSessionId()).toBe('session-1');
    });
  });
});
