import type { UserMessage } from '@shared/types/chatTypes';

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
  GhcApiError: class GhcApiError extends Error {},
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn(),
  getModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: false, supports: { tool_calls: true, vision: false } })),
  getDefaultModel: vi.fn(() => 'gpt-5'),
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: {},
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


vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager, MockCancellationError } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
  },
  MockCancellationError: class MockCancellationError extends Error {},
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
  CancellationError: MockCancellationError,
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

import { AgentChat } from '../agentChat';

function createUserMessage(): UserMessage {
  return {
    id: 'user_1',
    role: 'user',
    timestamp: 123,
    content: [{ type: 'text', text: 'hello' }],
  };
}

function createAgentChat() {
  mockProfileCacheManager.getChatConfig.mockReturnValue({
    chat_id: 'chat-1',
    agent: {
      role: 'assistant',
      emoji: '🤖',
      name: 'OpenKosmos',
      model: 'gpt-5',
      mcp_servers: [],
      system_prompt: '',
    },
  });

  const agent = new AgentChat('alias', 'chat-1', 'session-1', {
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test',
    last_updated: '2026-04-06T00:00:00.000Z',
  } as any);

  return agent;
}

describe('AgentChat.streamMessage remote session state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not trigger context compression during initialize', async () => {
    const agent = createAgentChat();
    const checkAndCompress = vi.fn().mockResolvedValue({ applied: true });
    const calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });

    (agent as any).getContextService = () => ({
      checkAndCompress,
    });
    (agent as any).calculateAndNotifyContext = calculateAndNotifyContext;
    (agent as any).saveChatSession = saveChatSession;

    await agent.initialize();

    expect(checkAndCompress).not.toHaveBeenCalled();
    expect(saveChatSession).not.toHaveBeenCalled();
    expect(calculateAndNotifyContext).toHaveBeenCalledTimes(1);
  });

  it('does not block initialize on asynchronous context stats calculation', async () => {
    const agent = createAgentChat();
    const checkAndCompress = vi.fn().mockResolvedValue({ applied: true });
    const saveChatSession = vi.fn().mockResolvedValue({ success: true });
    let resolveContextRefresh: (() => void) | undefined;
    const calculateAndNotifyContext = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveContextRefresh = resolve;
      })
    );

    (agent as any).getContextService = () => ({
      checkAndCompress,
    });
    (agent as any).calculateAndNotifyContext = calculateAndNotifyContext;
    (agent as any).saveChatSession = saveChatSession;

    let initializeResolved = false;
    const initializePromise = agent.initialize().then(() => {
      initializeResolved = true;
    });

    await Promise.resolve();

    expect(initializeResolved).toBe(true);
    expect(checkAndCompress).not.toHaveBeenCalled();
    expect(saveChatSession).not.toHaveBeenCalled();
    expect(calculateAndNotifyContext).toHaveBeenCalledTimes(1);

    if (resolveContextRefresh) {
      resolveContextRefresh();
    }
    await initializePromise;
  });

  it('drains a queued steering message as an ordered follow-up turn', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    const addMessageToSession = vi.fn().mockResolvedValue(undefined);
    const emitStreamingChunk = vi.fn();
    const emitConsumed = vi.fn();
    (agent as any).AddMessageToSession = addMessageToSession;
    (agent as any).emitStreamingChunk = emitStreamingChunk;
    (agent as any).emitQueuedSteeringMessageConsumed = emitConsumed;

    const queued = {
      id: 'queued-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'follow up' }],
    };
    agent.steeringQueue.enqueue(queued as any);

    await agent.streamMessage(createUserMessage());

    // One primary turn plus exactly one follow-up turn for the queued message.
    expect(runStreamMessage).toHaveBeenCalledTimes(2);
    expect(addMessageToSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'queued-1' }));
    expect(emitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_message' }));
    expect(emitConsumed).toHaveBeenCalledWith('queued-1');
    // The queue is drained after consumption.
    expect((agent as any).runtimeState.queuedSteeringMessages).toHaveLength(0);
  });

  it('drains queued steering prompts even when the primary prompt is blocked by UserPromptSubmit', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).emitStreamingChunk = vi.fn();
    const emitConsumed = vi.fn();
    (agent as any).emitQueuedSteeringMessageConsumed = emitConsumed;

    const blockMessages = [
      { id: 'blocked', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'denied' }] },
    ];
    // The PRIMARY prompt is blocked by its UserPromptSubmit hook.
    const runUserPromptSubmitLifecycle = vi.fn().mockResolvedValue(blockMessages);
    // A prompt the user queued while that (slow) block hook ran is allowed.
    const runQueuedUserPromptSubmitHook = vi.fn().mockResolvedValue({
      blocked: false,
      surfaceBlock: vi.fn(async () => []),
      applyAllowed: vi.fn(),
    });
    const hookRuntime = {
      capturePendingSessionStartTrigger: vi.fn(),
      runUserPromptSubmitLifecycle,
      runQueuedUserPromptSubmitHook,
      runStopHook: vi.fn().mockResolvedValue(undefined),
      clearTurnHookBuffers: vi.fn(),
      clearPendingSessionStartTriggerIfFired: vi.fn(),
    };
    (agent as any).getHookRuntime = () => hookRuntime;

    const queued = {
      id: 'queued-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'follow up' }],
    };
    agent.steeringQueue.enqueue(queued as any);

    await agent.streamMessage(createUserMessage());

    // The blocked primary keeps the session busy (idleOnBlock:false) so the drain
    // still runs. Without this the queued prompt would be stranded: the enqueue saw
    // the session busy and never started the idle pump, and the old early-return
    // skipped the end-of-turn drain.
    expect(runUserPromptSubmitLifecycle).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { idleOnBlock: false },
    );
    expect(runQueuedUserPromptSubmitHook).toHaveBeenCalledTimes(1);
    // Only the queued follow-up turn runs a model turn; the blocked primary does not.
    expect(runStreamMessage).toHaveBeenCalledTimes(1);
    expect(emitConsumed).toHaveBeenCalledWith('queued-1');
    expect((agent as any).runtimeState.queuedSteeringMessages).toHaveLength(0);
    // The drain completes and the finally returns the session to idle.
    expect((agent as any).getChatStatus()).toBe('idle');
  });

  it('leaves a queued steering message in the queue when its follow-up hook throws before commit', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).emitStreamingChunk = vi.fn();
    const emitConsumed = vi.fn();
    (agent as any).emitQueuedSteeringMessageConsumed = emitConsumed;

    const hookError = new Error('queued hook boom');
    const runUserPromptSubmitLifecycle = vi.fn().mockResolvedValue(null); // primary prompt proceeds
    // The queued prompt now drains through the queued-drain hook variant; make it
    // throw before the commit point.
    const runQueuedUserPromptSubmitHook = vi.fn().mockRejectedValue(hookError);
    const hookRuntime = {
      capturePendingSessionStartTrigger: vi.fn(),
      runUserPromptSubmitLifecycle,
      runQueuedUserPromptSubmitHook,
      runStopHook: vi.fn().mockResolvedValue(undefined),
      clearTurnHookBuffers: vi.fn(),
      clearPendingSessionStartTriggerIfFired: vi.fn(),
    };
    (agent as any).getHookRuntime = () => hookRuntime;

    const queued = {
      id: 'queued-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'follow up' }],
    };
    agent.steeringQueue.enqueue(queued as any);

    await expect(agent.streamMessage(createUserMessage())).rejects.toBe(hookError);

    // The queued prompt is only PEEKED before its hook runs, so a hook throw
    // leaves it in the queue untouched (never taken, never restored) and it is
    // never announced as consumed.
    expect(emitConsumed).not.toHaveBeenCalled();
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual([
      'queued-1',
    ]);
  });

  it('restores a committed queued steering message to the front when persistence throws', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    (agent as any).emitStreamingChunk = vi.fn();
    const emitConsumed = vi.fn();
    (agent as any).emitQueuedSteeringMessageConsumed = emitConsumed;

    // The primary turn persists fine; the queued prompt's persistence throws after
    // it has been committed (taken by id) but before it is announced as consumed.
    const persistError = new Error('queued persist boom');
    const addMessageToSession = vi.fn((message: any) => {
      if (message?.id === 'queued-1') {
        return Promise.reject(persistError);
      }
      return Promise.resolve(undefined);
    });
    (agent as any).AddMessageToSession = addMessageToSession;

    const queued = {
      id: 'queued-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'follow up' }],
    };
    agent.steeringQueue.enqueue(queued as any);

    await expect(agent.streamMessage(createUserMessage())).rejects.toBe(persistError);

    // Committed (removed by id) then failed before consumption -> restored to the
    // FRONT so it stays consumable, and never announced as consumed.
    expect(emitConsumed).not.toHaveBeenCalled();
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual([
      'queued-1',
    ]);
  });

  it('drainQueuedSteeringWhileIdle consumes queued prompts and returns to idle', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([{ id: 'reply-1' }]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    const addMessageToSession = vi.fn().mockResolvedValue(undefined);
    const emitStreamingChunk = vi.fn();
    const emitConsumed = vi.fn();
    (agent as any).AddMessageToSession = addMessageToSession;
    (agent as any).emitStreamingChunk = emitStreamingChunk;
    (agent as any).emitQueuedSteeringMessageConsumed = emitConsumed;

    agent.steeringQueue.enqueue({
      id: 'idle-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'catch up' }],
    } as any);

    const result = await agent.drainQueuedSteeringWhileIdle();

    expect(result).toEqual([{ id: 'reply-1' }]);
    expect(runStreamMessage).toHaveBeenCalledTimes(1);
    expect(addMessageToSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'idle-1' }));
    expect(emitConsumed).toHaveBeenCalledWith('idle-1');
    expect((agent as any).runtimeState.queuedSteeringMessages).toHaveLength(0);
    // Status blips SENDING_RESPONSE then resets to idle in the finally.
    expect((agent as any).getChatStatus()).toBe('idle');
  });

  it('drainQueuedSteeringWhileIdle short-circuits for external-agent sessions without touching the queue', async () => {
    const agent = createAgentChat();
    (agent as any).shouldRouteToExternalAgent = () => true;
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });

    agent.steeringQueue.enqueue({
      id: 'idle-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'catch up' }],
    } as any);

    const result = await agent.drainQueuedSteeringWhileIdle();

    expect(result).toEqual([]);
    expect(runStreamMessage).not.toHaveBeenCalled();
    // Queue is left intact for the external agent to own.
    expect((agent as any).runtimeState.queuedSteeringMessages.map((m: any) => m.id)).toEqual([
      'idle-1',
    ]);
  });

  it('persists the hook-validated snapshot when an edit mutates the queue entry during its hook', async () => {
    const agent = createAgentChat();
    const runStreamMessage = vi.fn().mockResolvedValue([]);
    (agent as any).getTurnRunner = () => ({ runStreamMessage });
    const persisted: any[] = [];
    (agent as any).AddMessageToSession = vi.fn((message: any) => {
      persisted.push(message);
      return Promise.resolve(undefined);
    });
    (agent as any).emitStreamingChunk = vi.fn();
    (agent as any).emitQueuedSteeringMessageConsumed = vi.fn();

    // The queued prompt's hook runs against the PEEKED snapshot. Simulate a
    // concurrent in-place edit landing during that hook window: it must NOT
    // change the content that was already validated and is about to be sent.
    const runUserPromptSubmitLifecycle = vi.fn().mockResolvedValue(null); // primary prompt proceeds
    const runQueuedUserPromptSubmitHook = vi.fn().mockImplementationOnce(async () => {
      agent.steeringQueue.update({
        id: 'queued-1',
        role: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: 'edited-after-validation' }],
      } as any);
      return { blocked: false, surfaceBlock: vi.fn(async () => []), applyAllowed: vi.fn() };
    });
    (agent as any).getHookRuntime = () => ({
      capturePendingSessionStartTrigger: vi.fn(),
      runUserPromptSubmitLifecycle,
      runQueuedUserPromptSubmitHook,
      runStopHook: vi.fn().mockResolvedValue(undefined),
      clearTurnHookBuffers: vi.fn(),
      clearPendingSessionStartTriggerIfFired: vi.fn(),
    });

    agent.steeringQueue.enqueue({
      id: 'queued-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'validated-original' }],
    } as any);

    await agent.streamMessage(createUserMessage());

    const queuedPersist = persisted.find((m) => m.id === 'queued-1');
    expect(queuedPersist).toBeDefined();
    expect(queuedPersist.content[0].text).toBe('validated-original');
    expect(runStreamMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userMessage: expect.objectContaining({ content: [{ type: 'text', text: 'validated-original' }] }),
      })
    );
  });

  it('resets an explicit non-interactive policy after the turn completes', async () => {
    const agent = createAgentChat();
    (agent as any).blockedInteractionDetails = { error: 'stale' };
    const runner = {
      runStreamMessage: vi.fn().mockResolvedValue([]),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage(), undefined, undefined, {
      interactionPolicy: 'forbid',
    });

    expect((agent as any).interactionPolicy).toBe('allow-ui');
    expect((agent as any).blockedInteractionDetails).toBeNull();
  });

  it('sets currentTurnTriggerSource to scheduled during a scheduled turn', async () => {
    const agent = createAgentChat();
    let capturedTriggerSource: string | undefined;
    const runner = {
      runStreamMessage: vi.fn().mockImplementation(() => {
        capturedTriggerSource = (agent as any).currentTurnTriggerSource;
        return Promise.resolve([]);
      }),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage(), undefined, undefined, {
      interactionPolicy: 'forbid',
      triggerSource: 'scheduled',
    });

    expect(capturedTriggerSource).toBe('scheduled');
    expect((agent as any).currentTurnTriggerSource).toBe('user');
  });

  it('defaults currentTurnTriggerSource to user when not specified', async () => {
    const agent = createAgentChat();
    let capturedTriggerSource: string | undefined;
    const runner = {
      runStreamMessage: vi.fn().mockImplementation(() => {
        capturedTriggerSource = (agent as any).currentTurnTriggerSource;
        return Promise.resolve([]);
      }),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage());

    expect(capturedTriggerSource).toBe('user');
    expect((agent as any).currentTurnTriggerSource).toBe('user');
  });

  it('resets currentTurnTriggerSource to user after a scheduled turn so manual follow-ups are not misclassified', async () => {
    const agent = createAgentChat();
    const triggerSources: string[] = [];
    const runner = {
      runStreamMessage: vi.fn().mockImplementation(() => {
        triggerSources.push((agent as any).currentTurnTriggerSource);
        return Promise.resolve([]);
      }),
    };
    (agent as any).getTurnRunner = () => runner;

    await agent.streamMessage(createUserMessage(), undefined, undefined, {
      interactionPolicy: 'forbid',
      triggerSource: 'scheduled',
    });

    await agent.streamMessage(createUserMessage());

    expect(triggerSources).toEqual(['scheduled', 'user']);
  });

  it('resets currentTurnTriggerSource to user even when the scheduled turn fails', async () => {
    const agent = createAgentChat();
    const runner = {
      runStreamMessage: vi.fn().mockRejectedValue(new Error('llm error')),
    };
    (agent as any).getTurnRunner = () => runner;

    await expect(agent.streamMessage(createUserMessage(), undefined, undefined, {
      triggerSource: 'scheduled',
    })).rejects.toThrow('llm error');

    expect((agent as any).currentTurnTriggerSource).toBe('user');
  });
});

describe('AgentChat branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getAgentName returns Unknown Agent when config is null', () => {
    const agent = createAgentChat();
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect((agent as any).getAgentName()).toBe('Unknown Agent');
  });

  it('getLatestAgentConfig returns null when chatConfig has no agent', () => {
    const agent = createAgentChat();
    mockProfileCacheManager.getChatConfig.mockReturnValue({ chat_id: 'chat-1' });
    expect((agent as any).getLatestAgentConfig()).toBeNull();
  });

  it('getLatestAgentConfig returns config with empty mcp_servers when field is missing', () => {
    const agent = createAgentChat();
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      chat_id: 'chat-1',
      agent: { role: 'assistant', emoji: '🤖', name: 'OpenKosmos', model: 'gpt-5', system_prompt: '' },
    });
    const config = (agent as any).getLatestAgentConfig();
    expect(config.mcp_servers).toEqual([]);
  });

  it('hydrateSchedulerMetadata handles metadata without optional fields', () => {
    const agent = createAgentChat();
    agent.hydrateSchedulerMetadata({} as any);
    expect((agent as any).schedulerJobId).toBeUndefined();
    expect((agent as any).schedulerExecutionMetadata).toEqual({});
  });

  it('setSchedulerExecutionState sets running metadata', () => {
    const agent = createAgentChat();
    agent.setSchedulerExecutionState('running', {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: undefined,
      error: undefined,
    });
    const metadata = (agent as any).getSchedulerMetadata();
    expect(metadata.schedulerExecutionStatus).toBe('running');
    expect(metadata.schedulerStartedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('setChatStatus handles listener errors gracefully', () => {
    const agent = createAgentChat();
    const failingListener = vi.fn(() => { throw new Error('listener fail'); });
    (agent as any).statusChangeListeners = [failingListener];
    (agent as any).outputPort = { emitStatus: vi.fn() };

    expect(() => (agent as any).setChatStatus('idle')).not.toThrow();
    expect(failingListener).toHaveBeenCalled();
  });

  it('initializeEmptyChatSession resets scheduler metadata', () => {
    const agent = createAgentChat();
    agent.setSchedulerJobId('job-1');
    agent.setSchedulerExecutionState('completed', {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:05:00Z',
      error: undefined,
    });

    agent.initializeEmptyChatSession();

    expect((agent as any).schedulerJobId).toBeUndefined();
  });
});