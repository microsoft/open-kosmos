/**
 * agentChat.deep2.test.ts
 *
 * Targets remaining uncovered branches in agentChat.ts:
 *  - constructor: chatSessionData with interaction_history present / empty
 *  - getTokenCounter: recreates counter when model tokenizer changes mid-session
 *  - getCurrentModelConfig: model not found (returns defaults) vs model found (o3/o4 family, vision)
 *  - streamMessage: isRemoteSession=true, interactionPolicy override
 *  - streamMessage: emitUserMessage option, finalizes isRemoteSession/policy in finally
 *  - handleExternalAgentMessage: result.length===0 branch (starts push timeout)
 *  - handleExternalAgentMessage: result.length>0 branch (no push timeout)
 *  - handlePushChunk / handlePushComplete / cancelPush / addMessageToSession (delegates)
 *  - setChatStatus: listeners that throw are caught
 *  - addStatusChangeListener: unsubscribe removes listener
 *  - trackChatSessionActivated: records analytics (fire-and-forget)
 *  - shouldTrackChatSessionActivatedForUserMessage: false when currentChatSession is null
 *  - getContextSummary: messages with no text (empty) are skipped from parts
 *  - getSubAgentConfig: chatConfig has no agent property
 *  - getTokenCounter encoding switch path
 *  - exitNewChatSessionState: agentChatManager throws (logged but not propagated)
 *  - initialize: calculateAndNotifyContext failure is swallowed
 *  - startChat: sessionStartHookFired guard / hookResult with additionalContexts
 *  - startChat: stale nonce path (executionNonce !== activeNonce)
 */

// ── mocks ─────────────────────────────────────────────────────────────────────

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
  mockGetModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: false, tokenizer: 'o200k_base', limits: { max_output_tokens: 4000 }, family: '', supports: { tool_calls: true, vision: false } })),
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

vi.mock('../../mem0/openkosmos-adapters/OpenKosmosMemoryManager', async () => ({ openkosmosMemoryManager: {} }));
vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class {},
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
  CancellationError: class extends Error {},
  CancellationTokenStatic: {},
}));

vi.mock('../../token', async () => ({
  createTokenCounter: vi.fn(() => ({ countTokens: vi.fn(() => 0) })),
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
  SubAgentFileManager: {
    getInstance: vi.fn(() => ({ getCachedConfig: vi.fn(() => undefined) })),
  },
}));

const { mockAnalyticsManager } = vi.hoisted(() => ({
  mockAnalyticsManager: { recordChatSessionActivated: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../analytics', async () => ({ analyticsManager: mockAnalyticsManager }));

const { mockHookRegistry } = vi.hoisted(() => ({
  mockHookRegistry: { execute: vi.fn().mockResolvedValue({ additionalContexts: [] }) },
}));

vi.mock('../../plugin/hooks/hookRegistry', async () => ({ hookRegistry: mockHookRegistry }));

const { mockAgentChatManager } = vi.hoisted(() => ({
  mockAgentChatManager: { exitNewChatSessionFor: vi.fn() },
}));

vi.mock('../agentChatManager', async () => ({ agentChatManager: mockAgentChatManager }));

const { mockHandleExternalAgent } = vi.hoisted(() => ({
  mockHandleExternalAgent: vi.fn().mockResolvedValue([]),
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: mockHandleExternalAgent,
}));

vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: vi.fn(() => ({ addXP: vi.fn() })) },
}));

// ── SUT ──────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentChat, ChatStatus } from '../agentChat';

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE_AGENT_CONFIG = {
  chat_id: 'chat-1',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'DeepAgent',
    model: 'gpt-5',
    mcp_servers: [],
    system_prompt: 'You are helpful.',
    workspace: '/ws',
    source: 'ON-DEVICE',
  },
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    chatSession_id: 'session-1',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test',
    last_updated: '2026-01-01T00:00:00Z',
    ...overrides,
  } as any;
}

function createAgent(sessionOverrides: Record<string, any> = {}, configOverrides: Record<string, any> = {}) {
  const config = { ...BASE_AGENT_CONFIG, agent: { ...BASE_AGENT_CONFIG.agent, ...configOverrides } };
  mockProfileCacheManager.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

// ── constructor branches ──────────────────────────────────────────────────────

describe('AgentChat - constructor branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initializes with chatSessionData that has interaction_history populated', () => {
    const interactionHistory = [{ id: 'i1', type: 'choice', requestId: 'r1' }];
    const agent = createAgent({ interaction_history: interactionHistory });
    expect(agent.getInteractionHistory()).toEqual(interactionHistory);
  });

  it('initializes with chatSessionData where interaction_history is undefined (defaults to [])', () => {
    // makeSession always sets interaction_history, so explicitly test undefined
    mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
    const session = { chatSession_id: 'session-1', chat_history: [], context_history: [], title: 'T', last_updated: '2026-01-01T00:00:00Z' } as any;
    const agent = new AgentChat('user1', 'chat-1', 'session-1', session);
    expect(agent.getInteractionHistory()).toEqual([]);
  });

  it('creates new session when chatSessionData is not provided', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
    const agent = new AgentChat('user1', 'chat-1', 'session-1');
    expect(agent.getChatSessionId()).toBe('session-1');
  });
});

// ── getTokenCounter encoding switch ──────────────────────────────────────────

describe('AgentChat - getTokenCounter encoding switch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recreates token counter when model tokenizer changes', async () => {
    const tokenModule = await import('../../token');
    const createTokenCounterSpy = vi.spyOn(tokenModule, 'createTokenCounter');
    createTokenCounterSpy.mockReturnValue({ countTokens: vi.fn(() => 0) } as any);

    const agent = createAgent();
    createTokenCounterSpy.mockClear();

    // Switch model capabilities to a different tokenizer
    mockGetModelCapabilities.mockReturnValue({
      supportsTools: true, supportsImages: false,
      tokenizer: 'cl100k_base',
      limits: { max_output_tokens: 4000 }, family: '',
      supports: { tool_calls: true, vision: false },
    });
    // Set internal encoding to something different to trigger switch
    (agent as any).tokenCounterEncoding = 'o200k_base';

    (agent as any).getTokenCounter();
    expect(createTokenCounterSpy).toHaveBeenCalledTimes(1);
    expect((agent as any).tokenCounterEncoding).toBe('cl100k_base');

    // Calling again with same tokenizer should NOT recreate
    createTokenCounterSpy.mockClear();
    (agent as any).getTokenCounter();
    expect(createTokenCounterSpy).not.toHaveBeenCalled();
  });
});

// ── getCurrentModelConfig ─────────────────────────────────────────────────────

describe('AgentChat - getCurrentModelConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns defaults when model not found in ghcModels', () => {
    mockGetModelById.mockReturnValue(null);
    const agent = createAgent();
    const config = (agent as any).getCurrentModelConfig('unknown-model');
    expect(config.maxTokens).toBe(4000);
    expect(config.supportsTools).toBe(false);
    expect(config.supportsImages).toBe(false);
    expect(config.supportsTemperature).toBe(true);
  });

  it('returns supportsTemperature=false for o3 family model', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 8000 },
        family: 'o3-mini',
        supports: { tool_calls: true, vision: false },
      },
    });
    const agent = createAgent();
    const config = (agent as any).getCurrentModelConfig('o3-mini');
    expect(config.supportsTemperature).toBe(false);
    expect(config.supportsTools).toBe(true);
  });

  it('returns supportsTemperature=false for o4 family model', () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: { max_output_tokens: 16000 },
        family: 'o4-preview',
        supports: { tool_calls: true, vision: true },
      },
    });
    const agent = createAgent();
    const config = (agent as any).getCurrentModelConfig('o4-preview');
    expect(config.supportsTemperature).toBe(false);
    expect(config.supportsImages).toBe(true);
  });

  it('includes reasoningEffort from agent config', () => {
    mockGetModelById.mockReturnValue(null);
    const agent = createAgent({}, { reasoningEffort: 'HIGH' });
    const config = (agent as any).getCurrentModelConfig('gpt-5');
    expect(config.reasoningEffort).toBe('high');
  });
});

// ── streamMessage: isRemoteSession / policy options ───────────────────────────

describe('AgentChat - streamMessage options', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets isRemoteSession=true and interactionPolicy=plain-text-only for remote session', async () => {
    const agent = createAgent();

    const turnRunner = {
      runStreamMessage: vi.fn().mockResolvedValue([]),
    };
    (agent as any).turnRunner = turnRunner;
    (agent as any).streamingService = { turnStartTime: 0, ttftReportedForTurn: false };

    await agent.streamMessage(
      { id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any,
      undefined,
      undefined,
      { isRemoteSession: true },
    );

    // After the call (finally block), isRemoteSession and policy are restored
    expect((agent as any).isRemoteSession).toBe(false);
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });

  it('uses provided interactionPolicy override', async () => {
    const agent = createAgent();
    const turnRunner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).turnRunner = turnRunner;
    (agent as any).streamingService = { turnStartTime: 0, ttftReportedForTurn: false };

    // policy override should be used during the call
    let capturedPolicy: string | undefined;
    turnRunner.runStreamMessage.mockImplementation(async () => {
      capturedPolicy = (agent as any).interactionPolicy;
      return [];
    });

    await agent.streamMessage(
      { id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any,
      undefined,
      undefined,
      { interactionPolicy: 'forbid' },
    );

    expect(capturedPolicy).toBe('forbid');
    // Restored after
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });

  it('resets blockedInteractionDetails to null in finally', async () => {
    const agent = createAgent();
    (agent as any).blockedInteractionDetails = { reason: 'something' };
    const turnRunner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).turnRunner = turnRunner;
    (agent as any).streamingService = { turnStartTime: 0, ttftReportedForTurn: false };

    await agent.streamMessage({ id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any);
    expect((agent as any).blockedInteractionDetails).toBeNull();
  });

  it('propagates runStreamMessage error and still cleans up', async () => {
    const agent = createAgent();
    const turnRunner = { runStreamMessage: vi.fn().mockRejectedValue(new Error('stream error')) };
    (agent as any).turnRunner = turnRunner;
    (agent as any).streamingService = { turnStartTime: 0, ttftReportedForTurn: false };

    await expect(agent.streamMessage({ id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any))
      .rejects.toThrow('stream error');
    expect((agent as any).isRemoteSession).toBe(false);
    expect((agent as any).interactionPolicy).toBe('allow-ui');
  });
});

// ── handleExternalAgentMessage ────────────────────────────────────────────────

describe('AgentChat - handleExternalAgentMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts push timeout when external handler returns empty result', async () => {
    const agent = createAgent();
    mockHandleExternalAgent.mockResolvedValue([]);
    const startOrReset = vi.fn();
    (agent as any).pushReceiver = { startOrResetPushTimeout: startOrReset, destroy: vi.fn() };

    const userMsg = { id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any;
    await (agent as any).handleExternalAgentMessage(userMsg);

    expect(startOrReset).toHaveBeenCalled();
  });

  it('does NOT start push timeout when external handler returns non-empty result', async () => {
    const agent = createAgent();
    const errorMsg = { id: 'e1', role: 'assistant', content: [], timestamp: Date.now() };
    mockHandleExternalAgent.mockResolvedValue([errorMsg]);
    const startOrReset = vi.fn();
    (agent as any).pushReceiver = { startOrResetPushTimeout: startOrReset, destroy: vi.fn() };

    const userMsg = { id: 'u1', role: 'user', content: [], timestamp: Date.now() } as any;
    await (agent as any).handleExternalAgentMessage(userMsg);

    expect(startOrReset).not.toHaveBeenCalled();
  });
});

// ── push receiver delegation ──────────────────────────────────────────────────

describe('AgentChat - push receiver delegation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handlePushChunk delegates to pushReceiver', () => {
    const agent = createAgent();
    const handlePushChunk = vi.fn();
    (agent as any).pushReceiver = { handlePushChunk, destroy: vi.fn() };
    agent.handlePushChunk('some text', 'msg-1');
    expect(handlePushChunk).toHaveBeenCalledWith('some text', 'msg-1');
  });

  it('handlePushComplete delegates to pushReceiver', async () => {
    const agent = createAgent();
    const handlePushComplete = vi.fn().mockResolvedValue(undefined);
    (agent as any).pushReceiver = { handlePushComplete, destroy: vi.fn() };
    await agent.handlePushComplete(true);
    expect(handlePushComplete).toHaveBeenCalledWith(true);
  });

  it('cancelPush delegates to pushReceiver', () => {
    const agent = createAgent();
    const cancelPush = vi.fn();
    (agent as any).pushReceiver = { cancelPush, destroy: vi.fn() };
    agent.cancelPush();
    expect(cancelPush).toHaveBeenCalled();
  });
});

// ── addMessageToSession (public) ──────────────────────────────────────────────

describe('AgentChat - addMessageToSession (public)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to AddMessageToSession (sessionService)', async () => {
    const agent = createAgent();
    const addMsgMock = vi.fn().mockResolvedValue(undefined);
    (agent as any).sessionService = { addMessageToSession: addMsgMock };
    const msg = { id: 'x', role: 'user', content: [], timestamp: Date.now() } as any;
    await agent.addMessageToSession(msg);
    expect(addMsgMock).toHaveBeenCalledWith(msg);
  });
});

// ── setChatStatus listener error handling ─────────────────────────────────────

describe('AgentChat - setChatStatus listener error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('catches errors thrown by status change listeners and continues', () => {
    const agent = createAgent();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('listener threw'); });
    const goodListener = vi.fn();
    agent.addStatusChangeListener(badListener);
    agent.addStatusChangeListener(goodListener);

    // Should not throw
    expect(() => (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE)).not.toThrow();
    expect(goodListener).toHaveBeenCalled();
  });
});

// ── addStatusChangeListener unsubscribe ───────────────────────────────────────

describe('AgentChat - addStatusChangeListener unsubscribe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unsubscribe removes the listener', () => {
    const agent = createAgent();
    const listener = vi.fn();
    const unsubscribe = agent.addStatusChangeListener(listener);
    expect((agent as any).statusChangeListeners).toContain(listener);
    unsubscribe();
    expect((agent as any).statusChangeListeners).not.toContain(listener);
  });
});

// ── shouldTrackChatSessionActivatedForUserMessage: null session ───────────────

describe('AgentChat - shouldTrackChatSessionActivatedForUserMessage null session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when currentChatSession is null', () => {
    const agent = createAgent();
    agent.initializeEmptyChatSession();
    const msg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(msg)).toBe(false);
  });
});

// ── getContextSummary: messages with no text skipped ─────────────────────────

describe('AgentChat - getContextSummary skips empty text messages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips messages where getText returns empty string', () => {
    const agent = createAgent();
    const session = agent.getCurrentChatSession()!;
    // A tool message with no text content
    session.context_history = [
      { id: 'm1', role: 'tool', content: [], timestamp: Date.now() },
      { id: 'm2', role: 'user', content: [{ type: 'text', text: 'visible' }], timestamp: Date.now() },
    ] as any;
    const summary = agent.getContextSummary();
    expect(summary).toContain('visible');
    // Tool message with no text should be skipped
    expect(summary).not.toMatch(/\[tool\]/);
  });
});

// ── getSubAgentConfig: chatConfig has no agent property ───────────────────────

describe('AgentChat - getSubAgentConfig: chatConfig missing agent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when getChatConfig has no agent field', () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue({ chat_id: 'chat-1' }); // no agent
    expect(agent.getSubAgentConfig('some-agent')).toBeUndefined();
  });
});

// ── exitNewChatSessionState error path ────────────────────────────────────────

describe('AgentChat - exitNewChatSessionState error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swallows errors from agentChatManager.exitNewChatSessionFor', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockImplementation(() => {
      throw new Error('manager error');
    });
    // Should not propagate
    expect(() => (agent as any).exitNewChatSessionState()).not.toThrow();
  });
});

// ── startChat: sessionStartHookFired guard ────────────────────────────────────

describe('AgentChat - startChat sessionStartHookFired guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires SessionStart hook only once', async () => {
    const agent = createAgent();
    const turnRunner = {
      run: vi.fn().mockResolvedValue(undefined),
      handleFailure: vi.fn(),
    };
    (agent as any).turnRunner = turnRunner;

    // First call fires hook
    await (agent as any).startChat(undefined, {});
    expect(mockHookRegistry.execute).toHaveBeenCalledTimes(1);
    expect((agent as any).sessionStartHookFired).toBe(true);

    // Second call should NOT fire hook again
    mockHookRegistry.execute.mockClear();
    turnRunner.run.mockClear();
    await (agent as any).startChat(undefined, {});
    expect(mockHookRegistry.execute).not.toHaveBeenCalled();
  });

  it('injects additionalContexts from hook into promptService', async () => {
    const agent = createAgent();
    mockHookRegistry.execute.mockResolvedValueOnce({
      additionalContexts: ['Extra context 1', 'Extra context 2'],
    });

    const setHookAdditionalContexts = vi.fn();
    (agent as any).promptService = { setHookAdditionalContexts };

    const turnRunner = { run: vi.fn().mockResolvedValue(undefined), handleFailure: vi.fn() };
    (agent as any).turnRunner = turnRunner;

    await (agent as any).startChat(undefined, {});
    expect(setHookAdditionalContexts).toHaveBeenCalledWith(['Extra context 1', 'Extra context 2']);
  });

  it('continues even when hookRegistry.execute throws', async () => {
    const agent = createAgent();
    mockHookRegistry.execute.mockRejectedValueOnce(new Error('hook error'));

    const turnRunner = { run: vi.fn().mockResolvedValue(undefined), handleFailure: vi.fn() };
    (agent as any).turnRunner = turnRunner;

    await expect((agent as any).startChat(undefined, {})).resolves.not.toThrow();
  });
});

// ── startChat: stale nonce path ───────────────────────────────────────────────

describe('AgentChat - startChat stale nonce (stale cancellation)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips handleFailure when nonce is stale (newer turn started)', async () => {
    const agent = createAgent();
    // Mark hook as already fired to skip that path
    (agent as any).sessionStartHookFired = true;

    const handleFailure = vi.fn();
    const turnRunner = {
      run: vi.fn().mockImplementation(async ({ executionNonce }: any) => {
        // Simulate newer turn starting (bump nonce via the proper setter) before this turn fails
        (agent as any).runtimeState.setToolExecutionNonce(executionNonce + 1);
        throw new Error('cancelled');
      }),
      handleFailure,
    };
    (agent as any).turnRunner = turnRunner;

    await expect((agent as any).startChat(undefined, {})).rejects.toThrow('cancelled');
    // handleFailure should NOT be called because nonce is stale
    expect(handleFailure).not.toHaveBeenCalled();
  });

  it('calls handleFailure when nonce matches (this is the active turn)', async () => {
    const agent = createAgent();
    (agent as any).sessionStartHookFired = true;

    const handleFailure = vi.fn().mockResolvedValue(undefined);
    const turnRunner = {
      run: vi.fn().mockRejectedValue(new Error('api error')),
      handleFailure,
    };
    (agent as any).turnRunner = turnRunner;

    await expect((agent as any).startChat(undefined, {})).rejects.toThrow('api error');
    expect(handleFailure).toHaveBeenCalled();
  });
});

// ── initialize ────────────────────────────────────────────────────────────────

describe('AgentChat - initialize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves even when calculateAndNotifyContext fails', async () => {
    const agent = createAgent();
    (agent as any).contextService = {
      calculateAndNotifyContext: vi.fn().mockRejectedValue(new Error('ctx error')),
    };

    await expect(agent.initialize()).resolves.not.toThrow();
  });
});

// ── hasInjectedMcpImageHash ───────────────────────────────────────────────────

describe('AgentChat - hasInjectedMcpImageHash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when chat_history is empty', () => {
    const agent = createAgent();
    expect((agent as any).hasInjectedMcpImageHash('somehash')).toBe(false);
  });

  it('returns false when no image with matching hash exists', () => {
    const agent = createAgent();
    const session = agent.getCurrentChatSession()!;
    session.chat_history = [
      {
        id: 'm1', role: 'user', timestamp: Date.now(),
        content: [{
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,abc' },
          metadata: { autoInjectedToolResultHash: 'different-hash' },
        }],
      },
    ] as any;
    expect((agent as any).hasInjectedMcpImageHash('somehash')).toBe(false);
  });
});

// ── destroy: pushReceiver.destroy is called ───────────────────────────────────

describe('AgentChat - destroy pushReceiver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls pushReceiver.destroy on destroy', () => {
    const agent = createAgent();
    const destroyPush = vi.fn();
    (agent as any).pushReceiver = { destroy: destroyPush };
    agent.destroy();
    expect(destroyPush).toHaveBeenCalled();
  });
});
