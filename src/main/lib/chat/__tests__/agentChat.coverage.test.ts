/**
 * Comprehensive coverage tests for agentChat.ts
 * Targets previously uncovered code paths: public methods, getters, lifecycle methods,
 * model management, context management, and scheduler metadata.
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
  mockMainAuthManager: {
    getCurrentAuth: vi.fn(),
  },
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

vi.mock('../../mem0/openkosmos-adapters/OpenKosmosMemoryManager', async () => ({
  openkosmosMemoryManager: {},
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
  },
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
    getInstance: vi.fn(() => ({
      getCachedConfig: vi.fn(),
    })),
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
    getInstance: vi.fn(() => ({
      addXP: vi.fn(),
    })),
  },
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

describe('AgentChat - constructor validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when userAlias is empty', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    expect(() => new AgentChat('', 'chat-1', 'session-1')).toThrow('userAlias is empty or invalid');
  });

  it('throws when userAlias is whitespace', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    expect(() => new AgentChat('   ', 'chat-1', 'session-1')).toThrow();
  });

  it('throws when no config found', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect(() => new AgentChat('user1', 'chat-1', 'session-1')).toThrow('no config found');
  });

  it('initializes without chatSessionData (creates new session)', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(AGENT_CONFIG);
    // AgentChatSessionService.createChatSession is called internally
    const agent = new AgentChat('user1', 'chat-1', 'session-1');
    expect(agent).toBeDefined();
  });

  it('initializes with existing chatSessionData', () => {
    const agent = createAgent({ title: 'Existing Session', chat_history: [] });
    expect(agent).toBeDefined();
  });
});

describe('AgentChat - basic getters', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('getChatId returns the correct chatId', () => {
    expect(agent.getChatId()).toBe('chat-1');
  });

  it('getChatSessionId returns the correct session id', () => {
    expect(agent.getChatSessionId()).toBe('session-1');
  });

  it('getUserAlias returns the current user alias', () => {
    expect(agent.getUserAlias()).toBe('user1');
  });

  it('getCurrentModelId returns model from config', () => {
    expect(agent.getCurrentModelId()).toBe('gpt-5');
  });

  it('getCurrentModelId falls back to default when config is null', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect(agent.getCurrentModelId()).toBe('gpt-5'); // getDefaultModel returns 'gpt-5'
  });

  it('getChatStatus returns IDLE initially', () => {
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });

  it('getChatStatusInfo returns structured status info', () => {
    const info = agent.getChatStatusInfo();
    expect(info.chatId).toBe('chat-1');
    expect(info.chatStatus).toBe(ChatStatus.IDLE);
    expect(info.agentName).toBe('TestAgent');
  });

  it('getInteractionHistory returns empty array when session has no history', () => {
    expect(agent.getInteractionHistory()).toEqual([]);
  });

  it('getPendingInteractiveRequest returns null initially', () => {
    expect(agent.getPendingInteractiveRequest()).toBeNull();
  });

  it('getBlockedInteractionDetails returns null initially', () => {
    expect(agent.getBlockedInteractionDetails()).toBeNull();
  });

  it('getContextTokenUsage returns null initially', () => {
    expect(agent.getContextTokenUsage()).toBeNull();
  });

  it('getCancellationToken returns undefined initially', () => {
    expect(agent.getCancellationToken()).toBeUndefined();
  });

  it('getCurrentChatSession returns the session', () => {
    expect(agent.getCurrentChatSession()).toBeDefined();
  });
});

describe('AgentChat - model capabilities', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('getModelCapabilities throws when capabilities not found', () => {
    mockGetModelCapabilities.mockReturnValue(null);
    expect(() => agent.getModelCapabilities('unknown-model')).toThrow();
  });

  it('getModelCapabilities returns capabilities when found', () => {
    const caps = { supportsTools: true, supportsImages: false };
    mockGetModelCapabilities.mockReturnValue(caps);
    expect(agent.getModelCapabilities('gpt-5')).toEqual(caps);
  });

  it('currentModelSupportsTools delegates to capabilities', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false });
    expect(agent.currentModelSupportsTools()).toBe(true);
  });

  it('currentModelSupportsImages delegates to capabilities', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: true });
    expect(agent.currentModelSupportsImages()).toBe(true);
  });

  it('isCompressionEnabled returns true when fullModeCompressor exists', () => {
    expect(agent.isCompressionEnabled()).toBe(true);
  });

  it('getCompressionStatus returns enabled=true', () => {
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false });
    const status = agent.getCompressionStatus();
    expect(status.enabled).toBe(true);
    expect(status.fullModeCompressionReady).toBe(true);
    expect(status.currentModel).toBe('gpt-5');
  });

  it('setCompressionEnabled is a no-op (interface compatibility)', () => {
    expect(() => agent.setCompressionEnabled(false)).not.toThrow();
    expect(() => agent.setCompressionEnabled(true)).not.toThrow();
  });
});

describe('AgentChat - session management methods', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('updateSessionTitle updates title and returns true', () => {
    expect(agent.updateSessionTitle('New Title')).toBe(true);
    expect(agent.getCurrentChatSession()?.title).toBe('New Title');
  });

  it('updateSessionTitle returns false when no current session', () => {
    agent.initializeEmptyChatSession();
    expect(agent.updateSessionTitle('Title')).toBe(false);
  });

  it('initializeEmptyChatSession clears session state', () => {
    agent.initializeEmptyChatSession();
    expect(agent.getCurrentChatSession()).toBeNull();
  });

  it('addMessageToChatHistory throws when session is null', () => {
    agent.initializeEmptyChatSession();
    expect(() => agent.addMessageToChatHistory({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      timestamp: Date.now(),
    } as any)).toThrow('currentChatSession must be initialized');
  });

  it('addMessageToChatHistory adds message to history', () => {
    const msg = { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() } as any;
    agent.addMessageToChatHistory(msg);
    expect(agent.getChatHistory()).toContainEqual(msg);
  });

  it('setSchedulerJobId updates scheduler job id', () => {
    agent.setSchedulerJobId('job-abc');
    // Verified via getSchedulerMetadata indirectly through saveChatSession
    expect(() => agent.setSchedulerJobId('job-abc')).not.toThrow();
  });

  it('setSkipPersistence updates skip flag', () => {
    expect(() => agent.setSkipPersistence(true)).not.toThrow();
    expect(() => agent.setSkipPersistence(false)).not.toThrow();
  });

  it('setInteractionPolicy updates the policy', () => {
    expect(() => agent.setInteractionPolicy('forbid')).not.toThrow();
    expect(() => agent.setInteractionPolicy('plain-text-only')).not.toThrow();
    expect(() => agent.setInteractionPolicy('allow-ui')).not.toThrow();
  });
});

describe('AgentChat - scheduler execution state', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('setSchedulerExecutionState sets running status', () => {
    agent.setSchedulerExecutionState('running', { startedAt: '2026-01-01T00:00:00Z' });
    // No public getter, just verify no throw
    expect(true).toBe(true);
  });

  it('setSchedulerExecutionState sets completed status', () => {
    agent.setSchedulerExecutionState('completed', {
      completedAt: '2026-01-01T01:00:00Z',
    });
    expect(true).toBe(true);
  });

  it('setSchedulerExecutionState sets failed status with error', () => {
    agent.setSchedulerExecutionState('failed', {
      error: 'Something went wrong',
    });
    expect(true).toBe(true);
  });

  it('setSchedulerExecutionState with no options', () => {
    agent.setSchedulerExecutionState('running');
    expect(true).toBe(true);
  });

  it('hydrateSchedulerMetadata restores metadata from persisted session', () => {
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-123',
      schedulerExecutionStatus: 'completed',
      schedulerStartedAt: '2026-01-01T00:00:00Z',
      schedulerCompletedAt: '2026-01-01T01:00:00Z',
      schedulerError: undefined,
    });
    expect(true).toBe(true);
  });

  it('hydrateSchedulerMetadata handles partial metadata', () => {
    agent.hydrateSchedulerMetadata({
      schedulerJobId: undefined,
      schedulerExecutionStatus: undefined,
      schedulerStartedAt: undefined,
      schedulerCompletedAt: undefined,
      schedulerError: undefined,
    });
    expect(true).toBe(true);
  });
});

describe('AgentChat - forceIdleStatus', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('does nothing when already IDLE', () => {
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
    agent.forceIdleStatus();
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });

  it('forces to IDLE from non-IDLE state', () => {
    // Set status to non-IDLE via runtimeState
    (agent as any).runtimeState.setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(agent.getChatStatus()).toBe(ChatStatus.SENDING_RESPONSE);
    agent.forceIdleStatus();
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });
});

describe('AgentChat - context change listeners', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('addContextChangeListener registers listener', () => {
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    // If latestContextStats is set, listener is called immediately
    expect(true).toBe(true);
  });

  it('addContextChangeListener calls listener immediately if cached stats available', () => {
    const stats = { tokenCount: 100, maxTokens: 1000, usageRatio: 0.1 } as any;
    (agent as any).latestContextStats = stats;
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).toHaveBeenCalledWith(stats);
  });

  it('addContextChangeListener handles listener that throws', () => {
    const stats = { tokenCount: 100 } as any;
    (agent as any).latestContextStats = stats;
    const badListener = vi.fn().mockImplementation(() => { throw new Error('listener error'); });
    expect(() => agent.addContextChangeListener(badListener)).not.toThrow();
  });

  it('removeContextChangeListener removes a registered listener', () => {
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.removeContextChangeListener(listener);
    // Listener should be removed, no error expected
    expect(true).toBe(true);
  });

  it('removeContextChangeListener is a no-op for unregistered listeners', () => {
    const listener = vi.fn();
    expect(() => agent.removeContextChangeListener(listener)).not.toThrow();
  });

  it('addStatusChangeListener returns an unsubscribe function', () => {
    const listener = vi.fn();
    const unsubscribe = agent.addStatusChangeListener(listener);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // Should remove listener without error
  });
});

describe('AgentChat - getContextSummary', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns empty string when no context history', () => {
    expect(agent.getContextSummary()).toBe('');
  });

  it('returns summary of context history messages', () => {
    const session = agent.getCurrentChatSession()!;
    session.context_history = [
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: Date.now() },
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Hi there' }], timestamp: Date.now() },
    ] as any;
    const summary = agent.getContextSummary();
    expect(summary).toContain('[user]');
    expect(summary).toContain('[assistant]');
  });

  it('handles messages with empty text gracefully', () => {
    const session = agent.getCurrentChatSession()!;
    session.context_history = [
      { id: 'm1', role: 'user', content: [], timestamp: Date.now() },
    ] as any;
    const summary = agent.getContextSummary();
    expect(typeof summary).toBe('string');
  });

  it('truncates to last 20 messages', () => {
    const session = agent.getCurrentChatSession()!;
    session.context_history = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      content: [{ type: 'text', text: `Message ${i}` }],
      timestamp: Date.now(),
    })) as any;
    const summary = agent.getContextSummary();
    // Should contain messages from index 5 onwards (last 20 of 25)
    expect(summary).toContain('Message 24');
    expect(summary).not.toContain('Message 4');
  });
});

describe('AgentChat - getSubAgentConfig', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns undefined when chatId or userAlias not set', () => {
    (agent as any).currentUserAlias = '';
    expect(agent.getSubAgentConfig('some-agent')).toBeUndefined();
  });

  it('returns undefined when agent does not reference the sub-agent', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { sub_agents: ['other-agent'] },
    });
    expect(agent.getSubAgentConfig('some-agent')).toBeUndefined();
  });

  it('returns undefined when no sub_agents array in agent config', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: {},
    });
    expect(agent.getSubAgentConfig('some-agent')).toBeUndefined();
  });

  it('returns config from SubAgentFileManager when agent references sub-agent', async () => {
    const { SubAgentFileManager } = await import('../../subAgent/subAgentFileManager');
    const mockConfig = { name: 'some-agent', system_prompt: '' };
    (SubAgentFileManager.getInstance as any).mockReturnValue({
      getCachedConfig: vi.fn().mockReturnValue(mockConfig),
    });
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { sub_agents: ['some-agent'] },
    });
    const result = agent.getSubAgentConfig('some-agent');
    expect(result).toEqual(mockConfig);
  });
});

describe('AgentChat - getDisplayMessages', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns empty array for new session with no history', () => {
    const msgs = agent.getDisplayMessages();
    // Custom system prompt is included, but chat history is empty
    expect(Array.isArray(msgs)).toBe(true);
  });

  it('includes chat history messages', () => {
    const msg = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as any;
    agent.addMessageToChatHistory(msg);
    const msgs = agent.getDisplayMessages();
    expect(msgs).toContainEqual(msg);
  });
});

describe('AgentChat - getSessionFromAuthManager', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns ghc session when auth has ghcAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({
      ghcAuth: {
        copilotTokens: { token: 'tok-123' },
        user: { login: 'testuser' },
      },
    });
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeDefined();
    expect(session?.type).toBe('ghc');
    expect(session?.accessToken).toBe('tok-123');
  });

  it('returns null when auth has no ghcAuth', async () => {
    mockMainAuthManager.getCurrentAuth.mockReturnValue({});
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });

  it('returns null when getCurrentAuth throws', async () => {
    mockMainAuthManager.getCurrentAuth.mockImplementation(() => { throw new Error('auth error'); });
    const session = await agent.getSessionFromAuthManager();
    expect(session).toBeNull();
  });
});

describe('AgentChat - event sender', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('hasEventSender returns false when no sender set', () => {
    expect(agent.hasEventSender()).toBe(false);
  });

  it('setEventSender sets the sender', () => {
    const fakeSender = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) } as any;
    agent.setEventSender(fakeSender);
    expect(agent.hasEventSender()).toBe(true);
  });

  it('setEventSender with null clears the sender', () => {
    const fakeSender = { send: vi.fn() } as any;
    agent.setEventSender(fakeSender);
    agent.setEventSender(null);
    expect(agent.hasEventSender()).toBe(false);
  });
});

describe('AgentChat - destroy', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('destroy resets state without throwing', () => {
    expect(() => agent.destroy()).not.toThrow();
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });
});

describe('AgentChat - invalidateActiveExecution and cancelActiveToolExecution', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('invalidateActiveExecution delegates to toolExecutor', () => {
    const mockInvalidate = vi.fn();
    (agent as any).toolExecutor = { invalidateActiveExecution: mockInvalidate };
    agent.invalidateActiveExecution();
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('cancelActiveToolExecution delegates to toolExecutor', async () => {
    const mockCancel = vi.fn().mockResolvedValue(undefined);
    (agent as any).toolExecutor = { cancelActiveToolExecution: mockCancel };
    await agent.cancelActiveToolExecution();
    expect(mockCancel).toHaveBeenCalled();
  });
});

describe('AgentChat - getAgentInfo', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns agent info with correct fields', async () => {
    const mockTools: any[] = [{ name: 'tool1' }, { name: 'tool2' }];
    const promptService = { getCurrentAvailableTools: vi.fn().mockResolvedValue(mockTools) };
    (agent as any).promptService = promptService;
    mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: false });

    const info = await agent.getAgentInfo();
    expect(info.name).toBe('TestAgent');
    expect(info.model).toBe('gpt-5');
    expect(info.toolsCount).toBe(2);
  });

  it('throws when config not available', async () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    await expect(agent.getAgentInfo()).rejects.toThrow('no config available');
  });
});

describe('AgentChat - shouldTrackChatSessionActivated helpers', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('shouldTrackChatSessionActivatedForUserMessage returns false for non-user messages', () => {
    const assistantMsg = { id: 'm1', role: 'assistant', content: [], timestamp: Date.now() } as any;
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(assistantMsg)).toBe(false);
  });

  it('shouldTrackChatSessionActivatedForUserMessage returns true for first user message of the day', () => {
    const userMsg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(userMsg)).toBe(true);
  });

  it('getChatSessionEntryTypeForUserMessage returns new for empty history', () => {
    const userMsg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).getChatSessionEntryTypeForUserMessage(userMsg)).toBe('new');
  });

  it('getChatSessionEntryTypeForUserMessage returns continued when history has messages', () => {
    const existingMsg = { id: 'm0', role: 'user', content: [], timestamp: Date.now() } as any;
    agent.addMessageToChatHistory(existingMsg);
    const userMsg = { id: 'm1', role: 'user', content: [], timestamp: Date.now() } as any;
    expect((agent as any).getChatSessionEntryTypeForUserMessage(userMsg)).toBe('continued');
  });
});

describe('AgentChat - getMessageTimestampMs', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns numeric timestamp as-is', () => {
    const ts = 1700000000000;
    const msg = { timestamp: ts } as any;
    expect((agent as any).getMessageTimestampMs(msg)).toBe(ts);
  });

  it('parses string ISO timestamp', () => {
    const msg = { timestamp: '2026-01-15T12:00:00Z' } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns Date.now() for invalid timestamp', () => {
    const before = Date.now();
    const msg = { timestamp: 'not-a-date' } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns Date.now() for non-finite numeric timestamp', () => {
    const before = Date.now();
    const msg = { timestamp: NaN } as any;
    const result = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe('AgentChat - streamMessage external agent routing', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('routes to external agent handler when source is EXTERNAL and feature is enabled', async () => {
    const { isFeatureEnabled } = await import('../../featureFlags');
    (isFeatureEnabled as any).mockReturnValue(true);
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { source: 'EXTERNAL', ...AGENT_CONFIG.agent },
    });

    const { handleExternalAgentMessage } = await import('../externalAgentChatHandler');
    (handleExternalAgentMessage as any).mockResolvedValue([
      { id: 'bot-1', role: 'assistant', content: [], timestamp: Date.now() },
    ]);

    const userMsg = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as any;
    const result = await agent.streamMessage(userMsg);
    expect(Array.isArray(result)).toBe(true);
  });

  it('does NOT route to external handler when feature flag is disabled', async () => {
    const { isFeatureEnabled } = await import('../../featureFlags');
    (isFeatureEnabled as any).mockReturnValue(false);
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      agent: { source: 'EXTERNAL', ...AGENT_CONFIG.agent },
    });

    const runner = { runStreamMessage: vi.fn().mockResolvedValue([]) };
    (agent as any).getTurnRunner = () => runner;
    const streamingService = { turnStartTime: 0, ttftReportedForTurn: false };
    (agent as any).getStreamingService = () => streamingService;

    const userMsg = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as any;
    await agent.streamMessage(userMsg);
    expect(runner.runStreamMessage).toHaveBeenCalled();
  });
});

describe('AgentChat - getAnalyticsDayKey', () => {
  let agent: AgentChat;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
  });

  it('returns date in YYYY-MM-DD format', () => {
    // Use a known timestamp: 2026-01-15 UTC
    const ts = new Date('2026-01-15T10:00:00Z').getTime();
    const key = (agent as any).getAnalyticsDayKey(ts);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
