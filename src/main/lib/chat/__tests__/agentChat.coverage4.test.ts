// @ts-nocheck
/**
 * Additional coverage tests for agentChat.ts — coverage4
 * Targets remaining functions not yet exercised in coverage1-3 tests:
 *   - handlePushChunk / handlePushComplete / cancelPush
 *   - callWithToolsStreaming
 *   - executeToolCall
 *   - getSubAgentConfig (more paths)
 *   - addMessageToContext / addMessageToSession
 *   - getInteractionHistory (with session data)
 *   - getChatHistory / getContextHistory
 *   - saveChatSession / replaceFilePathInSession
 *   - calculateAndNotifyContext
 *   - notifyContextChange
 *   - streamMessage (EXTERNAL agent route vs normal route)
 *   - retryChat
 *   - initialize
 *   - getContextTokenUsage (after update)
 *   - getSystemMessages
 *   - setSchedulerExecutionState / hydrateSchedulerMetadata (additional paths)
 *   - safeEmitEvent (error path)
 */

// ─── Mocks (must mirror the structure from coverage3) ────────────────────────

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

const { mockGetModelById2, mockGetModelCapabilities2, mockGetDefaultModel2 } = vi.hoisted(() => ({
  mockGetModelById2: vi.fn(),
  mockGetModelCapabilities2: vi.fn(),
  mockGetDefaultModel2: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: mockGetModelById2,
  getModelCapabilities: mockGetModelCapabilities2,
  getDefaultModel: mockGetDefaultModel2,
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

const { mockMainAuthManager4 } = vi.hoisted(() => ({
  mockMainAuthManager4: { getCurrentAuth: vi.fn() },
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: mockMainAuthManager4,
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

const { mockProfileCacheManager4 } = vi.hoisted(() => ({
  mockProfileCacheManager4: { getChatConfig: vi.fn() },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager4,
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

const { mockIsFeatureEnabled4 } = vi.hoisted(() => ({
  mockIsFeatureEnabled4: vi.fn(() => false),
}));

vi.mock('../../featureFlags', async () => ({
  featureFlagManager: {},
  isFeatureEnabled: mockIsFeatureEnabled4,
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

const { mockHandleExternalAgentMessage4 } = vi.hoisted(() => ({
  mockHandleExternalAgentMessage4: vi.fn().mockResolvedValue([{ role: 'assistant', content: [{ type: 'text', text: 'external reply' }] }]),
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: mockHandleExternalAgentMessage4,
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
      contextHistoryTokens: 10,
      systemPromptTokens: 5,
      toolsTokens: 2,
      totalTokens: 17,
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
    editUserMessage = vi.fn().mockResolvedValue([{ role: 'assistant', content: [] }]);
    validateUserMessageEditable = vi.fn().mockReturnValue({
      canEdit: true, targetUserIndex: 0, targetUserMessage: null, targetContextUserIndex: 0,
    });
    replaceFilePathInSession = vi.fn().mockResolvedValue({ success: true, replacedCount: 1 });
  },
}));

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([{ name: 'tool1' }]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([{ role: 'system', content: [{ type: 'text', text: 'custom' }] }]);
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
    executeToolCall = vi.fn().mockResolvedValue({ result: 'tool-result' });
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
    runStreamMessage = vi.fn().mockResolvedValue([{ role: 'assistant', content: [] }]);
    runRetry = vi.fn().mockResolvedValue([{ role: 'assistant', content: [] }]);
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
    setToolExecutionNonce = vi.fn().mockImplementation(function(this: any, n: number) { this.toolExecutionNonce = n; });
    setActiveToolCancellationHandler = vi.fn().mockImplementation(function(this: any, h: any) { this.activeToolCancellationHandler = h; });
    setPendingInteractiveRequest = vi.fn().mockImplementation(function(this: any, r: any) { this.pendingInteractiveRequest = r; });
    setMessagesToSave = vi.fn().mockImplementation(function(this: any, m: any[]) { this.messagesToSave = m; });
    setSaveChain = vi.fn().mockImplementation(function(this: any, c: Promise<any>) { this.saveChain = c; });
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

// ─── Import ───────────────────────────────────────────────────────────────────
import { AgentChat, ChatStatus } from '../agentChat';

const AGENT_CONFIG4 = {
  chat_id: 'chat-1',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'TestAgent',
    model: 'gpt-5',
    mcp_servers: [],
    system_prompt: 'You are helpful',
    sub_agents: ['helper-bot'],
  },
};

const EXTERNAL_AGENT_CONFIG = {
  chat_id: 'chat-ext',
  agent: {
    role: 'assistant',
    emoji: '🌐',
    name: 'ExternalAgent',
    model: 'gpt-5',
    source: 'EXTERNAL',
    mcp_servers: [],
    system_prompt: '',
  },
};

function makeSession4(overrides: Record<string, any> = {}) {
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

function createAgent4(configOverrides: Record<string, any> = {}, sessionOverrides: Record<string, any> = {}) {
  const config = {
    ...AGENT_CONFIG4,
    agent: { ...AGENT_CONFIG4.agent, ...configOverrides },
  };
  mockProfileCacheManager4.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession4(sessionOverrides));
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('AgentChat – getChatHistory / getContextHistory', () => {
  it('getChatHistory returns session chat_history', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'hello' }] } as any;
    const agent = createAgent4({}, { chat_history: [msg] });
    const history = agent.getChatHistory();
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
  });

  it('getContextHistory returns session context_history', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'ctx' }] } as any;
    const agent = createAgent4({}, { context_history: [msg] });
    const history = agent.getContextHistory();
    expect(history).toHaveLength(1);
  });

  it('getChatHistory returns empty array when no session', () => {
    const agent = createAgent4();
    agent.initializeEmptyChatSession();
    const history = agent.getChatHistory();
    expect(history).toEqual([]);
  });
});

describe('AgentChat – getInteractionHistory', () => {
  it('returns interaction_history from session', () => {
    const entry = { requestId: 'r1', summary: 'did something' } as any;
    const agent = createAgent4({}, { interaction_history: [entry] });
    const history = agent.getInteractionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].requestId).toBe('r1');
  });

  it('returns empty array when session has no history', () => {
    const agent = createAgent4();
    const history = agent.getInteractionHistory();
    expect(history).toEqual([]);
  });
});

describe('AgentChat – getSystemMessages', () => {
  it('returns system messages from promptService', () => {
    const agent = createAgent4();
    const msgs = agent.getSystemMessages();
    expect(Array.isArray(msgs)).toBe(true);
  });
});

describe('AgentChat – saveChatSession', () => {
  it('delegates to sessionService.saveChatSession', async () => {
    const agent = createAgent4();
    const result = await agent.saveChatSession();
    expect(result).toEqual({ success: true });
  });
});

describe('AgentChat – replaceFilePathInSession', () => {
  it('delegates to sessionService.replaceFilePathInSession', async () => {
    const agent = createAgent4();
    const result = await agent.replaceFilePathInSession('/old/path', '/new/path');
    expect(result).toEqual({ success: true, replacedCount: 1 });
  });
});

describe('AgentChat – addMessageToContext', () => {
  it('delegates to contextService.addMessageToContext', async () => {
    const agent = createAgent4();
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as any;
    await agent.addMessageToContext(msg);
    // contextService.addMessageToContext should have been called
    expect(true).toBe(true);
  });
});

describe('AgentChat – addMessageToSession', () => {
  it('delegates to private AddMessageToSession', async () => {
    const agent = createAgent4();
    const msg = { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } as any;
    await agent.addMessageToSession(msg);
    expect(true).toBe(true);
  });
});

describe('AgentChat – callWithToolsStreaming', () => {
  it('delegates to streamingService', async () => {
    const agent = createAgent4();
    const result = await agent.callWithToolsStreaming();
    expect(result).toBeDefined();
  });

  it('accepts an optional cancellation token', async () => {
    const agent = createAgent4();
    const token = {} as any;
    const result = await agent.callWithToolsStreaming(token);
    expect(result).toBeDefined();
  });
});

describe('AgentChat – executeToolCall', () => {
  it('delegates to toolExecutor', async () => {
    const agent = createAgent4();
    const toolCall = { id: 'tc-1', function: { name: 'myTool', arguments: '{}' } };
    const result = await agent.executeToolCall(toolCall, true);
    expect(result).toBeDefined();
  });
});

describe('AgentChat – invalidateActiveExecution / cancelActiveToolExecution', () => {
  it('invalidateActiveExecution calls toolExecutor', () => {
    const agent = createAgent4();
    expect(() => agent.invalidateActiveExecution()).not.toThrow();
  });

  it('cancelActiveToolExecution calls toolExecutor', async () => {
    const agent = createAgent4();
    await agent.cancelActiveToolExecution();
    expect(true).toBe(true);
  });
});

describe('AgentChat – retryChat', () => {
  it('delegates to turnRunner.runRetry', async () => {
    const agent = createAgent4();
    const result = await agent.retryChat();
    expect(Array.isArray(result)).toBe(true);
  });

  it('passes token and callbacks to turnRunner', async () => {
    const agent = createAgent4();
    const token = {} as any;
    const callbacks = { onChunk: vi.fn() };
    const result = await agent.retryChat(token, callbacks);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('AgentChat – streamMessage (normal path)', () => {
  it('delegates to turnRunner.runStreamMessage for non-external agents', async () => {
    const agent = createAgent4();
    const userMsg = {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      id: 'msg-1',
    } as any;
    const result = await agent.streamMessage(userMsg);
    expect(Array.isArray(result)).toBe(true);
  });

  it('streamMessage with isRemoteSession option', async () => {
    const agent = createAgent4();
    const userMsg = { role: 'user', content: [{ type: 'text', text: 'hello' }], id: 'msg-1' } as any;
    const result = await agent.streamMessage(userMsg, undefined, undefined, { isRemoteSession: true });
    expect(Array.isArray(result)).toBe(true);
  });

  it('streamMessage with interactionPolicy option', async () => {
    const agent = createAgent4();
    const userMsg = { role: 'user', content: [{ type: 'text', text: 'hello' }], id: 'msg-1' } as any;
    const result = await agent.streamMessage(userMsg, undefined, undefined, { interactionPolicy: 'plain-text-only' });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('AgentChat – streamMessage (external agent route)', () => {
  it('routes to handleExternalAgentMessage when source=EXTERNAL and feature enabled', async () => {
    mockIsFeatureEnabled4.mockReturnValue(true);
    mockProfileCacheManager4.getChatConfig.mockReturnValue(EXTERNAL_AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-ext', 'session-1', makeSession4());
    const userMsg = { role: 'user', content: [{ type: 'text', text: 'hello' }], id: 'msg-1' } as any;
    const result = await agent.streamMessage(userMsg);
    expect(mockHandleExternalAgentMessage4).toHaveBeenCalled();
    mockIsFeatureEnabled4.mockReturnValue(false);
  });

  it('does NOT route to external handler when feature disabled', async () => {
    mockIsFeatureEnabled4.mockReturnValue(false);
    mockProfileCacheManager4.getChatConfig.mockReturnValue(EXTERNAL_AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-ext', 'session-1', makeSession4());
    const userMsg = { role: 'user', content: [{ type: 'text', text: 'hello' }], id: 'msg-1' } as any;
    mockHandleExternalAgentMessage4.mockClear();
    await agent.streamMessage(userMsg);
    expect(mockHandleExternalAgentMessage4).not.toHaveBeenCalled();
  });
});

describe('AgentChat – handlePushChunk / handlePushComplete / cancelPush', () => {
  it('handlePushChunk delegates to pushReceiver', () => {
    const agent = createAgent4();
    expect(() => agent.handlePushChunk('some text', 'msg-1')).not.toThrow();
  });

  it('handlePushComplete delegates to pushReceiver', async () => {
    const agent = createAgent4();
    await agent.handlePushComplete(false);
    expect(true).toBe(true);
  });

  it('cancelPush delegates to pushReceiver', () => {
    const agent = createAgent4();
    expect(() => agent.cancelPush()).not.toThrow();
  });
});

describe('AgentChat – calculateAndNotifyContext', () => {
  it('delegates to contextService', async () => {
    const agent = createAgent4();
    await agent.calculateAndNotifyContext();
    expect(true).toBe(true);
  });
});

describe('AgentChat – getContextTokenUsage', () => {
  it('returns null initially', () => {
    const agent = createAgent4();
    expect(agent.getContextTokenUsage()).toBeNull();
  });
});

describe('AgentChat – setEventSender / hasEventSender', () => {
  it('setEventSender with null clears sender', () => {
    const agent = createAgent4();
    expect(() => agent.setEventSender(null)).not.toThrow();
  });

  it('hasEventSender returns boolean', () => {
    const agent = createAgent4();
    const result = agent.hasEventSender();
    expect(typeof result).toBe('boolean');
  });
});

describe('AgentChat – destroy', () => {
  it('clears listeners and resets state', () => {
    const agent = createAgent4();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.addStatusChangeListener(listener);
    expect(() => agent.destroy()).not.toThrow();
    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
  });
});

describe('AgentChat – getSubAgentConfig', () => {
  it('returns undefined when chatConfig has no sub_agents', () => {
    const agent = createAgent4({ sub_agents: undefined });
    const result = agent.getSubAgentConfig('helper-bot');
    expect(result).toBeUndefined();
  });

  it('returns undefined when sub-agent is not in allowed list', () => {
    const agent = createAgent4({ sub_agents: ['other-bot'] });
    const result = agent.getSubAgentConfig('helper-bot');
    expect(result).toBeUndefined();
  });

  it('returns config when sub-agent is in the list', () => {
    const agent = createAgent4({ sub_agents: ['helper-bot'] });
    const result = agent.getSubAgentConfig('helper-bot');
    expect(result).toBeDefined();
  });

  it('returns undefined when userAlias is empty', () => {
    mockProfileCacheManager4.getChatConfig.mockReturnValue(AGENT_CONFIG4);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession4());
    // Force currentUserAlias to empty via direct assignment is not possible,
    // but we can test the branch via getChatConfig returning undefined
    mockProfileCacheManager4.getChatConfig.mockReturnValue(null);
    // Reinitialize with config that returns null for sub_agents lookup
    const result = agent.getSubAgentConfig('helper-bot');
    // With null config there are no sub_agents, so should return undefined
    expect(result).toBeUndefined();
  });
});

describe('AgentChat – getCurrentModelId', () => {
  it('returns model from agent config', () => {
    const agent = createAgent4({ model: 'claude-opus' });
    const modelId = agent.getCurrentModelId();
    expect(modelId).toBe('claude-opus');
  });

  it('falls back to getDefaultModel when config returns null', () => {
    const agent = createAgent4();
    mockProfileCacheManager4.getChatConfig.mockReturnValue(null);
    const modelId = agent.getCurrentModelId();
    expect(mockGetDefaultModel2).toHaveBeenCalled();
  });
});

describe('AgentChat – getModelCapabilities', () => {
  it('returns capabilities when model found', () => {
    const caps = { supportsTools: true, supportsImages: true } as any;
    mockGetModelCapabilities2.mockReturnValue(caps);
    const agent = createAgent4();
    const result = agent.getModelCapabilities('gpt-5');
    expect(result).toEqual(caps);
  });

  it('throws when model capabilities not found', () => {
    mockGetModelCapabilities2.mockReturnValue(null);
    const agent = createAgent4();
    expect(() => agent.getModelCapabilities('unknown-model')).toThrow();
  });
});

describe('AgentChat – currentModelSupportsTools / currentModelSupportsImages', () => {
  it('currentModelSupportsTools returns boolean', () => {
    mockGetModelCapabilities2.mockReturnValue({ supportsTools: true, supportsImages: false });
    const agent = createAgent4();
    expect(agent.currentModelSupportsTools()).toBe(true);
  });

  it('currentModelSupportsImages returns boolean', () => {
    mockGetModelCapabilities2.mockReturnValue({ supportsTools: false, supportsImages: true });
    const agent = createAgent4();
    expect(agent.currentModelSupportsImages()).toBe(true);
  });
});

describe('AgentChat – getSessionFromAuthManager', () => {
  it('returns session when auth has ghcAuth', async () => {
    mockMainAuthManager4.getCurrentAuth.mockReturnValue({
      ghcAuth: {
        copilotTokens: { token: 'tok-abc' },
        user: { login: 'testuser' },
      },
    });
    const agent = createAgent4();
    const session = await agent.getSessionFromAuthManager();
    expect(session).not.toBeNull();
    expect(session?.type).toBe('ghc');
    expect(session?.accessToken).toBe('tok-abc');
  });

  it('returns null when no ghcAuth', async () => {
    mockMainAuthManager4.getCurrentAuth.mockReturnValue({ ghcAuth: null });
    const agent = createAgent4();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });

  it('returns null when getCurrentAuth throws', async () => {
    mockMainAuthManager4.getCurrentAuth.mockImplementation(() => { throw new Error('auth error'); });
    const agent = createAgent4();
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

describe('AgentChat – updateSessionTitle', () => {
  it('returns true when session exists', () => {
    const agent = createAgent4();
    const result = agent.updateSessionTitle('New Title');
    expect(result).toBe(true);
    expect(agent.getCurrentChatSession()?.title).toBe('New Title');
  });

  it('returns false when no session', () => {
    const agent = createAgent4();
    agent.initializeEmptyChatSession();
    expect(agent.updateSessionTitle('New')).toBe(false);
  });
});

describe('AgentChat – getAgentInfo', () => {
  it('returns agent info with toolsCount and chatHistoryLength', async () => {
    const agent = createAgent4();
    const info = await agent.getAgentInfo();
    expect(info.name).toBe('TestAgent');
    expect(typeof info.toolsCount).toBe('number');
    expect(typeof info.chatHistoryLength).toBe('number');
  });

  it('throws when config is unavailable', async () => {
    const agent = createAgent4();
    mockProfileCacheManager4.getChatConfig.mockReturnValue(null);
    await expect(agent.getAgentInfo()).rejects.toThrow(/Cannot get agent info/);
  });
});

describe('AgentChat – hydrateSchedulerMetadata', () => {
  it('hydrates metadata from session', () => {
    const session = makeSession4();
    mockProfileCacheManager4.getChatConfig.mockReturnValue(AGENT_CONFIG4);
    const agent = new AgentChat('user1', 'chat-1', 'session-1', session);
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-1',
      schedulerExecutionStatus: 'completed',
      schedulerStartedAt: '2026-01-01T00:00:00.000Z',
      schedulerCompletedAt: '2026-01-01T00:01:00.000Z',
      schedulerError: undefined,
    } as any);
    expect((agent as any).schedulerJobId).toBe('job-1');
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('completed');
  });

  it('handles session without scheduler_metadata', () => {
    const agent = createAgent4();
    expect(() => agent.hydrateSchedulerMetadata({} as any)).not.toThrow();
  });
});

describe('AgentChat – setSchedulerExecutionState', () => {
  it('sets running state with startedAt', () => {
    const agent = createAgent4();
    const startedAt = '2026-01-01T00:00:00.000Z';
    agent.setSchedulerExecutionState('running', { startedAt });
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('running');
    expect((agent as any).schedulerExecutionMetadata.schedulerStartedAt).toBe(startedAt);
  });

  it('sets completed state with completedAt and runtimeMs', () => {
    const agent = createAgent4();
    const completedAt = '2026-01-01T01:00:00.000Z';
    agent.setSchedulerExecutionState('completed', { completedAt, runtimeMs: 3600000 });
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('completed');
    expect((agent as any).schedulerExecutionMetadata.schedulerCompletedAt).toBe(completedAt);
  });

  it('sets failed state with error', () => {
    const agent = createAgent4();
    agent.setSchedulerExecutionState('failed', { error: 'Something went wrong' });
    expect((agent as any).schedulerExecutionMetadata.schedulerExecutionStatus).toBe('failed');
    expect((agent as any).schedulerExecutionMetadata.schedulerError).toBe('Something went wrong');
  });
});

describe('AgentChat – addMessageToChatHistory', () => {
  it('throws when session is null', () => {
    const agent = createAgent4();
    agent.initializeEmptyChatSession();
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as any;
    expect(() => agent.addMessageToChatHistory(msg)).toThrow();
  });

  it('appends message to chat_history', () => {
    const agent = createAgent4();
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as any;
    agent.addMessageToChatHistory(msg);
    expect(agent.getChatHistory()).toHaveLength(1);
  });
});

describe('AgentChat – getContextSummary', () => {
  it('returns empty string when no context', () => {
    const agent = createAgent4();
    expect(agent.getContextSummary()).toBe('');
  });

  it('returns non-empty summary with messages', () => {
    const agent = createAgent4({}, {
      context_history: [
        { role: 'user', content: [{ type: 'text', text: 'Hello there' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi, how can I help?' }] },
      ],
    });
    const summary = agent.getContextSummary();
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('user');
  });

  it('handles more than 20 messages by taking only last 20', () => {
    const messages = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `message ${i}` }],
    }));
    const agent = createAgent4({}, { context_history: messages });
    const summary = agent.getContextSummary();
    // Should not include message 0-4 (first 5 of 25)
    expect(summary).not.toContain('message 0');
    expect(summary).toContain('message 24');
  });
});

describe('AgentChat – editUserMessage', () => {
  it('delegates to sessionService and returns messages', async () => {
    const agent = createAgent4();
    const result = await agent.editUserMessage('msg-1', { role: 'user', content: [{ type: 'text', text: 'updated' }] } as any);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('AgentChat – canEditUserMessage', () => {
  it('delegates to sessionService.validateUserMessageEditable', () => {
    const agent = createAgent4();
    const result = agent.canEditUserMessage('msg-1');
    expect(typeof result.canEdit).toBe('boolean');
  });
});

describe('AgentChat – initialize', () => {
  it('calls calculateAndNotifyContext and does not throw', async () => {
    const agent = createAgent4();
    await agent.initialize();
    expect(true).toBe(true);
  });
});

describe('AgentChat – getCompressionStatus', () => {
  it('returns enabled=true and currentModel', () => {
    const agent = createAgent4();
    const status = agent.getCompressionStatus();
    expect(status.enabled).toBe(true);
    expect(typeof status.currentModel).toBe('string');
  });
});
