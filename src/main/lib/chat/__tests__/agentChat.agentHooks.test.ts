/**
 * agentChat.agentHooks.test.ts
 *
 * Covers the Phase 1 Agent Hooks runtime integration wired into AgentChat:
 *  - SessionStart + UserPromptSubmit lifecycle events
 *  - PreToolUse / PostToolUse / PostToolUseFailure via the dep-boundary wrappers
 *    (preToolUseAndApprove / executeToolCallWithHooks / postProcessToolResultWithHooks)
 *  - the turn-scoped additional-context buffer and cancellation guards
 *
 * The mock harness mirrors agentChat.coverage9.test.ts so a real AgentChat can be
 * constructed, plus a controllable AgentHookManager fake.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  mockGetModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: true, tokenizer: 'o200k_base' })),
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

const { mockGetChatSessionFilePath } = vi.hoisted(() => ({
  mockGetChatSessionFilePath: vi.fn(() => '/profiles/user1/chats/chat-1/session-1.json'),
}));

vi.mock('../../userDataADO/pathUtils', async () => ({
  extractMonthFromChatSessionId: vi.fn(() => '2026-01'),
  getChatSessionFilePath: mockGetChatSessionFilePath,
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

const { mockExternalAgentMessageHandler } = vi.hoisted(() => ({
  mockExternalAgentMessageHandler: vi.fn().mockResolvedValue([]),
}));

vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: mockExternalAgentMessageHandler,
}));

const { MockCancellationError } = vi.hoisted(() => ({
  MockCancellationError: class MockCancellationError extends Error {},
}));

vi.mock('../../cancellation', async () => ({
  CancellationToken: class {},
  CancellationError: MockCancellationError,
  CancellationTokenStatic: {},
}));

vi.mock('../../token', async () => ({
  createTokenCounter: vi.fn(() => ({ countTokens: vi.fn(() => 0) })),
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

const { mockHookManager } = vi.hoisted(() => ({
  mockHookManager: {
    isEnabled: vi.fn(() => false),
    runHooks: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../agentHooks/agentHookManager', async () => ({
  AgentHookManager: { getInstance: () => mockHookManager },
}));

const mockSetHookAdditionalContexts = vi.fn();
const mockSetHookSystemMessages = vi.fn();
const mockPrepareEditedUserMessage = vi.fn();
const mockApplyEditedUserMessage = vi.fn();

vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: class AgentChatPromptService {
    getCurrentAvailableTools = vi.fn().mockResolvedValue([]);
    getLatestCustomSystemPrompt = vi.fn().mockReturnValue([]);
    getGlobalSystemPrompt = vi.fn().mockReturnValue([]);
    getAgentSpecificSystemPrompt = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForContext = vi.fn().mockReturnValue([]);
    getCombinedSystemPromptForCurrentTurn = vi.fn().mockResolvedValue([]);
    refreshSkillSnapshotIfNeeded = vi.fn().mockResolvedValue(undefined);
    setHookAdditionalContexts = mockSetHookAdditionalContexts;
    setHookSystemMessages = mockSetHookSystemMessages;
    constructor(_opts: any) {}
  },
}));

vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: class AgentChatSessionService {
    saveChatSession = vi.fn().mockResolvedValue({ success: true });
    createChatSession = vi.fn();
    addMessageToSession = vi.fn().mockResolvedValue(undefined);
    prepareEditedUserMessage = mockPrepareEditedUserMessage;
    applyEditedUserMessage = mockApplyEditedUserMessage;
    generateChatSessionTitle = vi.fn().mockResolvedValue(undefined);
    generateFallbackTitle = vi.fn().mockReturnValue('Fallback');
    constructor(_opts: any) {}
  },
}));

const mockCalculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);

let capturedContextServiceOpts: any;
let capturedInteractionService: any;

vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: class AgentChatContextService {
    calculateAndNotifyContext = mockCalculateAndNotifyContext;
    addMessageToContext = vi.fn().mockResolvedValue(undefined);
    extractFactsFromConversation = vi.fn().mockResolvedValue(undefined);
    checkAndCompress = vi.fn().mockResolvedValue({ applied: false });
    calculateThreeComponentTokens = vi.fn().mockResolvedValue({ totalTokens: 0 });
    enhanceUserMessageContext = vi.fn().mockImplementation(async (m: any) => m);
    notifyContextChange = vi.fn();
    anchorTokenEstimate = vi.fn();
    constructor(opts: any) { capturedContextServiceOpts = opts; }
  },
}));

vi.mock('../agentChatInteractionService', async () => ({
  AgentChatInteractionService: class AgentChatInteractionService {
    buildInteractionId = vi.fn().mockReturnValue('int-id');
    batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    requestHookApprovalInteraction = vi.fn().mockResolvedValue(new Map());
    requestUserInfoInput = vi.fn().mockResolvedValue(null);
    requestUserChoice = vi.fn().mockResolvedValue(null);
    constructor(_opts: any) { capturedInteractionService = this; }
  },
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: class AgentChatToolPostProcessor {
    postProcessToolResult = vi.fn().mockResolvedValue({});
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
    constructor(_opts: any) {}
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
    queuedSteeringMessages: any[] = [];
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
    enqueueSteeringMessage(_m: any) {}
    removeSteeringMessage(_id: string) {}
    promoteSteeringMessage(_id: string) { return null; }
    peekNextSteeringMessage() { return this.queuedSteeringMessages[0] ?? null; }
    takeSteeringMessage(_id: string) { return null; }
    takeNextSteeringMessage() { return null; }
    restoreSteeringMessageToFront(m: any) {
      this.queuedSteeringMessages = this.queuedSteeringMessages.filter((x: any) => x.id !== m.id);
      this.queuedSteeringMessages.unshift(m);
    }
    clearSteeringMessages() { this.queuedSteeringMessages = []; }
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

let capturedTurnRunnerOpts: any;
const mockRunStreamMessage = vi.fn().mockResolvedValue([]);
const mockTurnRun = vi.fn().mockResolvedValue(undefined);
const mockRunRetry = vi.fn().mockResolvedValue([]);

vi.mock('../agentChatTurnRunner', async () => ({
  AgentChatTurnRunner: class AgentChatTurnRunner {
    run = mockTurnRun;
    runStreamMessage = mockRunStreamMessage;
    runRetry = mockRunRetry;
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
    constructor(_opts: any) {}
  },
}));

import { AgentChat } from '../agentChat';
import { surfaceUserPromptBlockResult } from '../agentChatHookRuntime';

const BASE_AGENT_CONFIG = {
  chat_id: 'chat-1',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'TestAgent',
    model: 'gpt-5',
    mcp_servers: [{ name: 'mcp1' }, { name: 'mcp2' }],
    skills: ['skillA', 'skillB'],
    workspace: '/ws',
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

function createAgent(sessionOverrides: Record<string, any> = {}, agentOverrides?: Record<string, any> | null) {
  const config = agentOverrides === null
    ? { chat_id: 'chat-1' }
    : { ...BASE_AGENT_CONFIG, agent: { ...BASE_AGENT_CONFIG.agent, ...agentOverrides } };
  mockProfileCacheManager.getChatConfig.mockReturnValue(config);
  return new AgentChat('user1', 'chat-1', 'session-1', makeSession(sessionOverrides));
}

function hookRuntime(agent: any) {
  return agent.getHookRuntime();
}

function userMessage(text = 'hello') {
  return { id: 'user_1', role: 'user', timestamp: 1, content: [{ type: 'text', text }] } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProfileCacheManager.getChatConfig.mockReturnValue(BASE_AGENT_CONFIG);
  mockGetModelCapabilities.mockReturnValue({ supportsTools: true, supportsImages: true, tokenizer: 'o200k_base' });
  mockGetDefaultModel.mockReturnValue('gpt-5');
  mockIsFeatureEnabled.mockReturnValue(false);
  mockHookManager.isEnabled.mockReturnValue(false);
  mockHookManager.runHooks.mockResolvedValue({});
  mockRunStreamMessage.mockResolvedValue([]);
  mockRunRetry.mockResolvedValue([]);
  mockTurnRun.mockResolvedValue(undefined);
  mockExternalAgentMessageHandler.mockResolvedValue([]);
  mockPrepareEditedUserMessage.mockImplementation((_messageId: string, message: any) => ({
    normalizedMessage: {
      id: message.id ?? 'user_1',
      role: 'user',
      timestamp: message.timestamp ?? 1,
      content: message.content,
    },
    targetUserIndex: 0,
    targetContextUserIndex: 0,
  }));
  mockApplyEditedUserMessage.mockResolvedValue(undefined);
});

// ─────────────────────────── helper methods ───────────────────────────

describe('getHookAgentSnapshot', () => {
  it('extracts chat id and workspace', () => {
    const agent = createAgent();
    const snap = hookRuntime(agent).getHookAgentSnapshot();
    expect(snap).toEqual({
      chatId: 'chat-1',
      agentName: 'TestAgent',
      workspacePath: '/ws',
      hookIds: [],
    });
  });

  it('falls back to defaults when workspace is missing or malformed', () => {
    const agent = createAgent({}, { mcp_servers: undefined, skills: 'not-array', workspace: '   ' });
    const snap = hookRuntime(agent).getHookAgentSnapshot();
    expect(snap.chatId).toBe('chat-1');
    expect(snap.agentName).toBe('TestAgent');
    expect(snap.workspacePath).toBeUndefined();
  });

  it('handles an absent agent config', () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(undefined);
    const snap = hookRuntime(agent).getHookAgentSnapshot();
    expect(snap.chatId).toBe('chat-1');
    expect(snap.agentName).toBe('Unknown Agent');
    expect(snap.workspacePath).toBeUndefined();
  });

  it('collects selected hook ids and drops blank or non-string entries', () => {
    const agent = createAgent({}, { hooks: ['hook-a', '  ', '', 5, 'hook-b'] });
    const snap = hookRuntime(agent).getHookAgentSnapshot();
    expect(snap.hookIds).toEqual(['hook-a', 'hook-b']);
  });

  it('uses the matching multi-agent entry hooks and chat-owned workspace', () => {
    const multiAgentConfig = {
      ...BASE_AGENT_CONFIG,
      chat_type: 'multi_agent',
      workspace: '/chat-workspace',
      agent: {
        ...BASE_AGENT_CONFIG.agent,
        name: 'Reviewer',
        workspace: '/fallback-workspace',
        hooks: ['fallback-hook'],
      },
      agents: [
        {
          ...BASE_AGENT_CONFIG.agent,
          name: 'Planner',
          workspace: '/planner-workspace',
          hooks: ['planner-hook'],
        },
        {
          ...BASE_AGENT_CONFIG.agent,
          name: 'Reviewer',
          workspace: '/reviewer-workspace',
          hooks: ['reviewer-hook', '', '  ', 42],
        },
      ],
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue(multiAgentConfig);

    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());
    const snap = hookRuntime(agent).getHookAgentSnapshot();

    expect(snap.agentName).toBe('Reviewer');
    expect(snap.workspacePath).toBe('/chat-workspace');
    expect(snap.hookIds).toEqual(['reviewer-hook']);
  });

  it('falls back to the primary agent hooks when no multi-agent entry matches', () => {
    const multiAgentConfig = {
      ...BASE_AGENT_CONFIG,
      chat_type: 'multi_agent',
      agent: {
        ...BASE_AGENT_CONFIG.agent,
        name: 'Reviewer',
        hooks: ['fallback-hook'],
      },
      agents: [
        { ...BASE_AGENT_CONFIG.agent, name: 'Planner', hooks: ['planner-hook'] },
      ],
    };
    mockProfileCacheManager.getChatConfig.mockReturnValue(multiAgentConfig);

    const agent = new AgentChat('user1', 'chat-1', 'session-1', makeSession());

    expect(hookRuntime(agent).getHookAgentSnapshot().hookIds).toEqual(['fallback-hook']);
  });
});

describe('buildHookRunContext / hookInputBase', () => {
  it('builds a run context from the agent snapshot', () => {
    const agent = createAgent();
    const ctx = hookRuntime(agent).buildHookRunContext();
    expect(ctx).toMatchObject({
      userAlias: 'user1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      agentName: 'TestAgent',
      workspacePath: '/ws',
    });
  });

  it('builds the shared base input fields', () => {
    const agent = createAgent();
    const base = hookRuntime(agent).hookInputBase();
    expect(base).toEqual({
      session_id: 'session-1',
      user_alias: 'user1',
      chat_id: 'chat-1',
      chat_session_id: 'session-1',
      agent_id: 'chat-1',
      agent_name: 'TestAgent',
      agent_type: 'TestAgent',
      transcript_path: '/profiles/user1/chats/chat-1/session-1.json',
      cwd: '/ws',
      permission_mode: 'default',
    });
  });
});

describe('parseToolArgs', () => {
  it('parses a valid JSON object string', () => {
    const agent = createAgent();
    expect(hookRuntime(agent).parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns {} for invalid JSON', () => {
    const agent = createAgent();
    expect(hookRuntime(agent).parseToolArgs('not json')).toEqual({});
  });
  it('returns {} for non-string input', () => {
    const agent = createAgent();
    expect(hookRuntime(agent).parseToolArgs(undefined)).toEqual({});
    expect(hookRuntime(agent).parseToolArgs(42)).toEqual({});
  });
  it('returns {} when JSON parses to a non-object', () => {
    const agent = createAgent();
    expect(hookRuntime(agent).parseToolArgs('123')).toEqual({});
    expect(hookRuntime(agent).parseToolArgs('null')).toEqual({});
  });
});

describe('applyHookResultIfActive', () => {
  it('reflects the bound cancellation token state', () => {
    const agent = createAgent();
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['active'] });
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['active']);
    mockSetHookAdditionalContexts.mockClear();
    (agent as any).runtimeState.bindCancellationToken({ isCancellationRequested: true });
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['cancelled'] });
    expect(mockSetHookAdditionalContexts).not.toHaveBeenCalled();
  });

  it('applies contexts when active and skips when cancelled', () => {
    const agent = createAgent();
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['c1'] });
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['c1']);

    mockSetHookAdditionalContexts.mockClear();
    (agent as any).runtimeState.bindCancellationToken({ isCancellationRequested: true });
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['c2'] });
    expect(mockSetHookAdditionalContexts).not.toHaveBeenCalled();
  });

  it('does nothing when there are no contexts', () => {
    const agent = createAgent();
    hookRuntime(agent).applyHookResultIfActive({});
    expect(mockSetHookAdditionalContexts).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── context buffers ───────────────────────────

describe('turn/session context buffers', () => {
  it('addTurnHookContexts is a no-op for empty input', () => {
    const agent = createAgent();
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: [] });
    expect(mockSetHookAdditionalContexts).not.toHaveBeenCalled();
  });

  it('clearTurnHookContexts is a no-op when already empty', () => {
    const agent = createAgent();
    hookRuntime(agent).clearTurnHookBuffers();
    expect(mockSetHookAdditionalContexts).not.toHaveBeenCalled();
  });

  it('combines session and turn contexts and clears only turn-scoped ones', () => {
    const agent = createAgent();
    hookRuntime(agent).replaceSessionHookContexts(['s1']);
    hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['t1'] });
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['s1', 't1']);
    hookRuntime(agent).clearTurnHookBuffers();
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['s1']);
  });
});

// ─────────────────────────── preToolUseAndApprove ───────────────────────────

describe('preToolUseAndApprove (PreToolUse + approval)', () => {
  const toolCalls = () => [
    { id: 't1', function: { name: 'toolA', arguments: '{"x":1}' } },
    { id: 't2', function: { name: 'toolB', arguments: '{"y":2}' } },
  ];

  it('fast-paths to the real approval when the feature is OFF', async () => {
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map([['t1', true]]));
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const tcs = toolCalls();
    const result = await hookRuntime(agent).preToolUseAndApprove(tcs);
    expect(realApproval).toHaveBeenCalledWith(tcs);
    expect(mockHookManager.runHooks).not.toHaveBeenCalled();
    expect(result.get('t1')).toBe(true);
  });

  it('passes original calls through when no hook makes changes', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map());
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const tcs = toolCalls();
    await hookRuntime(agent).preToolUseAndApprove(tcs);
    expect(realApproval).toHaveBeenCalledWith(tcs);
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PreToolUse',
      expect.objectContaining({
        session_id: 'session-1',
        agent_type: 'TestAgent',
        transcript_path: '/profiles/user1/chats/chat-1/session-1.json',
        permission_mode: 'default',
        tool_use_id: 't1',
        tool_call_id: 't1',
      }),
      expect.anything(),
    );
  });

  it('runs PreToolUse hooks for multiple tool calls concurrently', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    (agent as any).batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    const calls = toolCalls();
    const pending: Array<(value: Record<string, never>) => void> = [];
    mockHookManager.runHooks.mockImplementation(() => new Promise(resolve => {
      pending.push(resolve);
    }));

    const promise = hookRuntime(agent).preToolUseAndApprove(calls);
    await Promise.resolve();

    expect(mockHookManager.runHooks).toHaveBeenCalledTimes(calls.length);
    pending.forEach(resolve => resolve({}));
    await promise;
  });

  it('passes the active cancellation token to tool hooks as an AbortSignal', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    let cancelListener: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn((listener: () => void) => {
        cancelListener = listener;
        return { dispose: vi.fn() };
      }),
    };
    mockHookManager.runHooks.mockImplementation(async (_event: string, _input: any, context: any) => {
      observedSignal = context.signal;
      return {};
    });
    const agent = createAgent();
    (agent as any).batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    await hookRuntime(agent).preToolUseAndApprove([toolCalls()[0]], token);
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
    cancelListener?.();
    expect(observedSignal?.aborted).toBe(true);
  });

  it('blocks a tool (blockingError), excludes it from approval, and fails closed', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1' ? { blockingError: 'nope', additionalContexts: ['ctx'] } : {});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map([['t2', true]]));
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());
    const approvalArg = realApproval.mock.calls[0][0];
    expect(approvalArg.map((t: any) => t.id)).toEqual(['t2']);
    expect(map.get('t1')).toBe(false);
    expect(map.get('t2')).toBe(true);
    expect(hookRuntime(agent).blockedToolCallReasons.get('t1')).toBe('nope');
    expect(mockSetHookAdditionalContexts).toHaveBeenCalled();
  });

  it('blocks via preventContinuation with a fallback reason', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ preventContinuation: true });
    const agent = createAgent();
    (agent as any).batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    const map = await hookRuntime(agent).preToolUseAndApprove([toolCalls()[0]]);
    expect(hookRuntime(agent).blockedToolCallReasons.get('t1')).toBe('Blocked by Agent Hook');
    expect(map.get('t1')).toBe(false);
  });

  it('applies updatedInput by approving on the mutated (cloned) args', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1' ? { updatedInput: { x: 99 } } : {});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map());
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const calls = toolCalls();
    await hookRuntime(agent).preToolUseAndApprove(calls);
    const approvalArg = realApproval.mock.calls[0][0];
    expect(approvalArg.find((t: any) => t.id === 't1').function.arguments).toBe('{"x":99}');
    expect(approvalArg.find((t: any) => t.id === 't2').function.arguments).toBe('{"y":2}');
    expect(calls[0].function.arguments).toBe('{"x":99}');
    expect(hookRuntime(agent).effectiveToolInput.get('t1')).toEqual({ x: 99 });
  });

  it('fails closed when updatedInput cannot be serialized', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const circular: any = {}; circular.self = circular;
    mockHookManager.runHooks.mockResolvedValue({ updatedInput: circular });
    const agent = createAgent();
    (agent as any).batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map());
    const map = await hookRuntime(agent).preToolUseAndApprove([toolCalls()[0]]);
    expect(hookRuntime(agent).blockedToolCallReasons.get('t1')).toMatch(/could not be serialized/);
    expect(map.get('t1')).toBe(false);
  });

  it('honors a hook approval allow decision by skipping normal approval for that call', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1' ? { approvalDecision: 'allow' } : {});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map([['t2', true]]));
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());
    expect(realApproval.mock.calls[0][0].map((t: any) => t.id)).toEqual(['t2']);
    expect(map.get('t1')).toBe(true);
    expect(map.get('t2')).toBe(true);
  });

  it('revalidates mutated tool input even when the hook also returns allow', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1' ? { updatedInput: { x: 99 }, approvalDecision: 'allow' } : {});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map([['t1', true], ['t2', true]]));
    (agent as any).batchValidateAndRequestApproval = realApproval;

    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());

    expect(realApproval.mock.calls[0][0].map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(realApproval.mock.calls[0][0].find((t: any) => t.id === 't1').function.arguments).toBe('{"x":99}');
    expect(map.get('t1')).toBe(true);
  });

  it('returns an empty map (then fails closed) when every tool is blocked', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'all blocked' });
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map());
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());
    expect(realApproval).not.toHaveBeenCalled();
    expect(map.get('t1')).toBe(false);
    expect(map.get('t2')).toBe(false);
  });

  it('forces a confirmation prompt for an ask decision and excludes it from batch approval', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1'
        ? { approvalDecision: 'ask', approvalDecisionReason: 'confirm t1' }
        : {});
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map([['t2', true]]));
    (agent as any).batchValidateAndRequestApproval = realApproval;
    const askPrompt = vi.fn().mockResolvedValue(new Map([['t1', true]]));
    (agent as any).requestHookApproval = askPrompt;

    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());

    expect(realApproval.mock.calls[0][0].map((t: any) => t.id)).toEqual(['t2']);
    expect(askPrompt).toHaveBeenCalledWith([
      { toolCallId: 't1', toolName: 'toolA', reason: 'confirm t1' },
    ]);
    expect(map.get('t1')).toBe(true);
    expect(map.get('t2')).toBe(true);
  });

  it('rejects an ask tool when the user declines the confirmation', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockImplementation(async (_e: string, input: any) =>
      input.tool_call_id === 't1' ? { approvalDecision: 'ask' } : {});
    const agent = createAgent();
    (agent as any).batchValidateAndRequestApproval = vi.fn().mockResolvedValue(new Map([['t2', true]]));
    (agent as any).requestHookApproval = vi.fn().mockResolvedValue(new Map([['t1', false]]));
    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());
    expect(map.get('t1')).toBe(false);
    expect(map.get('t2')).toBe(true);
  });

  it('skips batch approval and fails closed when every tool is an ask with no decision', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ approvalDecision: 'ask' });
    const agent = createAgent();
    const realApproval = vi.fn().mockResolvedValue(new Map());
    (agent as any).batchValidateAndRequestApproval = realApproval;
    (agent as any).requestHookApproval = vi.fn().mockResolvedValue(new Map());
    const map = await hookRuntime(agent).preToolUseAndApprove(toolCalls());
    expect(realApproval).not.toHaveBeenCalled();
    expect(map.get('t1')).toBe(false);
    expect(map.get('t2')).toBe(false);
  });

  it('requestHookApproval delegates to the interaction service confirmation prompt', async () => {
    const agent = createAgent();
    const items = [{ toolCallId: 't1', toolName: 'toolA', reason: 'why' }];
    const first = await (agent as any).requestHookApproval(items);
    expect(first).toBeInstanceOf(Map);
    expect(capturedInteractionService.requestHookApprovalInteraction).toHaveBeenCalledWith(items);

    capturedInteractionService.requestHookApprovalInteraction.mockResolvedValueOnce(new Map([['t1', true]]));
    const second = await (agent as any).requestHookApproval(items);
    expect(second.get('t1')).toBe(true);
  });
});

// ─────────────────────────── executeToolCallWithHooks ───────────────────────────

describe('executeToolCallWithHooks', () => {
  const tc = () => ({ id: 't1', function: { name: 'toolA', arguments: '{"x":1}' } });

  it('fast-paths to the real executor when OFF', async () => {
    const agent = createAgent();
    const realExec = vi.fn().mockResolvedValue({ result: 'ok' });
    (agent as any).executeToolCall = realExec;
    const r = await hookRuntime(agent).executeToolCallWithHooks(tc(), true);
    expect(realExec).toHaveBeenCalledWith(tc(), true);
    expect(r).toEqual({ result: 'ok' });
  });

  it('short-circuits a blocked tool with a synthetic denied result', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    hookRuntime(agent).blockedToolCallReasons.set('t1', 'blocked!');
    const realExec = vi.fn();
    (agent as any).executeToolCall = realExec;
    const r = await hookRuntime(agent).executeToolCallWithHooks(tc(), undefined);
    expect(realExec).not.toHaveBeenCalled();
    expect(r).toMatchObject({ denied: true, blockedByHook: true, message: 'blocked!', tool_call_id: 't1' });
  });

  it('executes with mutated args when present', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    hookRuntime(agent).mutatedToolArgs.set('t1', '{"x":99}');
    hookRuntime(agent).effectiveToolInput.set('t1', { x: 99 });
    const realExec = vi.fn().mockResolvedValue({ result: 'ok' });
    (agent as any).executeToolCall = realExec;
    await hookRuntime(agent).executeToolCallWithHooks(tc(), true);
    expect(realExec.mock.calls[0][0].function.arguments).toBe('{"x":99}');
  });

  it('runs PostToolUseFailure and rethrows on a tool error', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    hookRuntime(agent).effectiveToolInput.set('t1', { x: 1 });
    (agent as any).executeToolCall = vi.fn().mockRejectedValue(new Error('boom'));
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['fail-ctx'] });
    await expect(hookRuntime(agent).executeToolCallWithHooks(tc(), true)).rejects.toThrow('boom');
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({ error: 'boom', is_interrupt: false, is_timeout: false }),
      expect.anything(),
    );
    expect(mockSetHookAdditionalContexts).toHaveBeenCalled();
  });

  it('marks PostToolUseFailure as a timeout when tool execution times out', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    hookRuntime(agent).effectiveToolInput.set('t1', { x: 1 });
    (agent as any).executeToolCall = vi.fn().mockRejectedValue(new Error('tool timed out after 30000ms'));
    mockHookManager.runHooks.mockResolvedValue({});

    await expect(hookRuntime(agent).executeToolCallWithHooks(tc(), true)).rejects.toThrow('timed out');

    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({ is_timeout: true, is_interrupt: false }),
      expect.anything(),
    );
  });

  it('rethrows a CancellationError without running the failure hook', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    (agent as any).executeToolCall = vi.fn().mockRejectedValue(new MockCancellationError('cancelled'));
    await expect(hookRuntime(agent).executeToolCallWithHooks(tc(), true)).rejects.toThrow('cancelled');
    expect(mockHookManager.runHooks).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── postProcessToolResultWithHooks ───────────────────────────

describe('postProcessToolResultWithHooks', () => {
  const tc = () => ({ id: 't1', function: { name: 'toolA', arguments: '{"x":1}' } });

  function primeMaps(agent: any) {
    hookRuntime(agent).blockedToolCallReasons.clear();
    hookRuntime(agent).mutatedToolArgs.clear();
    hookRuntime(agent).effectiveToolInput.clear();
    hookRuntime(agent).effectiveToolInput.set('t1', { x: 1 });
  }

  it('fast-paths to the real post-processor when OFF', async () => {
    const agent = createAgent();
    const realPost = vi.fn().mockResolvedValue({ done: true });
    (agent as any).postProcessToolResult = realPost;
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { ok: true });
    expect(realPost).toHaveBeenCalledWith(tc(), { ok: true });
    expect(r).toEqual({ done: true });
  });

  it('passes a blocked tool result through without running PostToolUse', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    hookRuntime(agent).blockedToolCallReasons.set('t1', 'blocked');
    const realPost = vi.fn().mockResolvedValue({ denied: true });
    (agent as any).postProcessToolResult = realPost;
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { denied: true });
    expect(r).toEqual({ denied: true });
    expect(mockHookManager.runHooks).not.toHaveBeenCalled();
  });

  it('replaces output via official updatedToolOutput on a successful result', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn(async (_toolCall: any, result: any) => result);
    mockHookManager.runHooks.mockResolvedValue({ updatedToolOutput: { data: 'replaced' }, additionalContexts: ['c'] });
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { success: true });
    expect(r).toEqual({ data: 'replaced' });
    expect((agent as any).postProcessToolResult).toHaveBeenCalledWith(tc(), { data: 'replaced' });
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUse',
      expect.objectContaining({
        tool_output: { success: true },
        tool_response: { success: true },
      }),
      expect.anything(),
    );
    expect(mockSetHookAdditionalContexts).toHaveBeenCalled();
  });

  it('prefers official updatedToolOutput over legacy updatedMCPToolOutput', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn(async (_toolCall: any, result: any) => result);
    mockHookManager.runHooks.mockResolvedValue({
      updatedToolOutput: { data: 'official' },
      updatedMCPToolOutput: { data: 'legacy' },
    });
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { success: true });
    expect(r).toEqual({ data: 'official' });
    expect((agent as any).postProcessToolResult).toHaveBeenCalledWith(tc(), { data: 'official' });
  });

  it('keeps the processed output when no updatedMCPToolOutput is returned', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockResolvedValue({ data: 'orig' });
    mockHookManager.runHooks.mockResolvedValue({});
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { success: true });
    expect(r).toEqual({ data: 'orig' });
  });

  it('replaces successful tool output with a blocked result when PostToolUse blocks', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    const realPost = vi.fn();
    (agent as any).postProcessToolResult = realPost;
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'DLP blocked output' });

    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { secret: 'raw' });

    expect(realPost).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      success: false,
      error: 'Blocked by Agent Hook',
      message: 'DLP blocked output',
      denied: true,
      blockedByHook: true,
      tool_call_id: 't1',
    });
  });

  it('refuses output replacement for an error result', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockResolvedValue({ success: false });
    mockHookManager.runHooks.mockResolvedValue({ updatedMCPToolOutput: { data: 'replaced' } });
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { success: false });
    expect(r).toEqual({ success: false });
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({
        error: 'Tool execution returned a failure result',
        is_interrupt: false,
        is_timeout: false,
      }),
      expect.anything(),
    );
  });

  it('runs PostToolUseFailure instead of PostToolUse for returned tool failures', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockResolvedValue({ success: false, error: 'bad args' });
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['failure context'] });

    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { success: false, error: 'bad args' });

    expect(r).toEqual({ success: false, error: 'bad args' });
    expect(mockHookManager.runHooks).toHaveBeenCalledTimes(1);
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({ error: 'bad args', is_interrupt: false, is_timeout: false }),
      expect.anything(),
    );
    expect(mockSetHookAdditionalContexts).toHaveBeenCalled();
  });

  it('marks PostToolUseFailure as interrupted for interrupted returned failures', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    const interruptedResult = { success: false, error: 'cancelled by user', interrupted: true };
    (agent as any).postProcessToolResult = vi.fn().mockResolvedValue(interruptedResult);
    mockHookManager.runHooks.mockResolvedValue({});

    await hookRuntime(agent).postProcessToolResultWithHooks(tc(), interruptedResult);

    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({ is_interrupt: true, is_timeout: false }),
      expect.anything(),
    );
  });

  it('refuses output replacement when the turn was cancelled', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockResolvedValue({ data: 'orig' });
    mockHookManager.runHooks.mockResolvedValue({ updatedMCPToolOutput: { data: 'replaced' } });
    (agent as any).runtimeState.bindCancellationToken({ isCancellationRequested: true });
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), { ok: true });
    expect(r).toEqual({ data: 'orig' });
  });

  it('runs PostToolUseFailure and rethrows when post-processing throws', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockRejectedValue(new Error('post boom'));
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['x'] });
    await expect(hookRuntime(agent).postProcessToolResultWithHooks(tc(), { ok: true })).rejects.toThrow('post boom');
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostToolUseFailure',
      expect.objectContaining({ error: 'post boom', is_interrupt: false, is_timeout: false }),
      expect.anything(),
    );
  });

  it('rethrows a post-processing CancellationError without the failure hook', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn().mockRejectedValue(new MockCancellationError('cancelled'));
    await expect(hookRuntime(agent).postProcessToolResultWithHooks(tc(), { ok: true })).rejects.toThrow('cancelled');
    expect(mockHookManager.runHooks).toHaveBeenCalledTimes(1);
    expect(mockHookManager.runHooks).toHaveBeenCalledWith('PostToolUse', expect.anything(), expect.anything());
  });

  it('treats a null tool result as a non-error and allows replacement', async () => {
    mockHookManager.isEnabled.mockReturnValue(true);
    const agent = createAgent();
    primeMaps(agent);
    (agent as any).postProcessToolResult = vi.fn(async (_toolCall: any, result: any) => result);
    mockHookManager.runHooks.mockResolvedValue({ updatedMCPToolOutput: 'replaced' });
    const r = await hookRuntime(agent).postProcessToolResultWithHooks(tc(), null);
    expect(r).toBe('replaced');
  });
});

// ─────────────────────────── surfaceUserPromptBlock ───────────────────────────

describe('surfaceUserPromptBlock', () => {
  it('emits the blocking reason and returns display messages', async () => {
    const addMsg = vi.fn().mockResolvedValue(undefined);
    const result = await surfaceUserPromptBlockResult({
      result: { blockingError: 'denied' },
      agentName: 'TestAgent',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      addMessageToSession: addMsg,
      emitStreamingChunk: mockEmitStreamingChunk,
      setIdle: vi.fn(),
      getDisplayMessages: () => [{ id: 'm1' }] as any,
    });
    expect(addMsg).toHaveBeenCalled();
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'content', contentDelta: { text: 'denied' } }));
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'complete' }));
    expect(result).toEqual([{ id: 'm1' }]);
  });

  it('uses a fallback reason when none is provided', async () => {
    await surfaceUserPromptBlockResult({
      result: {},
      agentName: 'TestAgent',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      addMessageToSession: vi.fn().mockResolvedValue(undefined),
      emitStreamingChunk: mockEmitStreamingChunk,
      setIdle: vi.fn(),
      getDisplayMessages: () => [],
    });
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({
      type: 'content',
      contentDelta: { text: 'Your message was blocked by an Agent Hook.' },
    }));
  });

  it('does not throw and still emits when setIdle is omitted (queued drain)', async () => {
    const addMsg = vi.fn().mockResolvedValue(undefined);
    const result = await surfaceUserPromptBlockResult({
      result: { blockingError: 'denied' },
      agentName: 'TestAgent',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      addMessageToSession: addMsg,
      emitStreamingChunk: mockEmitStreamingChunk,
      // setIdle omitted -> the queued drain keeps the session busy on a block.
      getDisplayMessages: () => [{ id: 'm1' }] as any,
    });
    expect(addMsg).toHaveBeenCalled();
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'complete' }));
    expect(result).toEqual([{ id: 'm1' }]);
  });
});

// ─────────────────────── runQueuedUserPromptSubmitHook ───────────────────────

describe('runQueuedUserPromptSubmitHook (queued-drain variant)', () => {
  it('surfaces a block WITHOUT idling the session', async () => {
    const agent = createAgent();
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'nope' });
    const rt = hookRuntime(agent);

    const outcome = await rt.runQueuedUserPromptSubmitHook('hello');
    expect(outcome.blocked).toBe(true);

    (agent as any).setChatStatus('sending_response');
    const msgs = await outcome.surfaceBlock();

    // Finding 3: the queued drain holds SENDING_RESPONSE across prompts, so a block
    // must NOT idle the session (idling mid-drain would break the mutex).
    expect(agent.getChatStatus()).toBe('sending_response');
    expect(Array.isArray(msgs)).toBe(true);
  });

  it('returns allowed and applyAllowed applies the hook context', async () => {
    const agent = createAgent();
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['ctx-x'] });
    const rt = hookRuntime(agent);
    const applySpy = vi.spyOn(rt, 'applyHookResultIfActive');

    const outcome = await rt.runQueuedUserPromptSubmitHook('hello');
    expect(outcome.blocked).toBe(false);

    outcome.applyAllowed();
    expect(applySpy).toHaveBeenCalledWith(
      expect.objectContaining({ additionalContexts: ['ctx-x'] }),
      undefined,
    );
  });

  it('contrasts with the interactive lifecycle, which DOES idle on a block', async () => {
    const agent = createAgent();
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'nope' });
    const rt = hookRuntime(agent);

    (agent as any).setChatStatus('sending_response');
    const blockResult = await rt.runUserPromptSubmitLifecycle('hello');

    expect(blockResult).not.toBeNull();
    // The interactive path ends the turn, so it idles the session on a block.
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('keeps the interactive lifecycle busy on a block when idleOnBlock is false', async () => {
    const agent = createAgent();
    mockHookManager.isEnabled.mockReturnValue(true);
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'nope' });
    const rt = hookRuntime(agent);

    (agent as any).setChatStatus('sending_response');
    const blockResult = await rt.runUserPromptSubmitLifecycle('hello', undefined, { idleOnBlock: false });

    // streamMessage passes idleOnBlock:false so it can still drain queued prompts
    // after a blocked primary while holding the SENDING_RESPONSE mutex; it idles in
    // its own finally once the drain completes.
    expect(blockResult).not.toBeNull();
    expect(agent.getChatStatus()).toBe('sending_response');
  });
});

// ─────────────────────────── streamMessage UserPromptSubmit ───────────────────────────

describe('streamMessage UserPromptSubmit integration', () => {
  it('marks the chat busy while UserPromptSubmit preflight is still running', async () => {
    let releaseSubmit!: () => void;
    let markSubmitEntered!: () => void;
    const submitEntered = new Promise<void>(resolve => { markSubmitEntered = resolve; });
    const submitRelease = new Promise<void>(resolve => { releaseSubmit = resolve; });
    mockHookManager.runHooks.mockImplementation(async (event: string) => {
      if (event === 'UserPromptSubmit') {
        markSubmitEntered();
        await submitRelease;
      }
      return {};
    });
    const agent = createAgent();

    const streamPromise = agent.streamMessage(userMessage(), undefined, undefined, {});
    await submitEntered;

    expect(agent.getChatStatus()).toBe('sending_response');
    releaseSubmit();
    await streamPromise;
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('blocks the prompt and skips the model when the hook blocks', async () => {
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'blocked prompt' });
    const agent = createAgent();
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).getDisplayMessages = () => [{ id: 'blocked' }];
    const result = await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(mockRunStreamMessage).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 'blocked' }]);
  });

  it('buffers additional contexts and proceeds to the model', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'UserPromptSubmit' ? { additionalContexts: ['turn-ctx'] } : {},
    );
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(mockSetHookAdditionalContexts).toHaveBeenCalledWith(['turn-ctx']);
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'UserPromptSubmit',
      expect.objectContaining({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-1',
        agent_type: 'TestAgent',
        permission_mode: 'default',
        prompt: 'hello',
      }),
      expect.anything(),
    );
    expect(mockRunStreamMessage).toHaveBeenCalled();
  });

  it('includes attachment metadata in the UserPromptSubmit prompt', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent();
    await agent.streamMessage({
      ...userMessage('review this'),
      content: [
        { type: 'text', text: 'review this' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc' },
          metadata: { fileName: 'diagram.png', fileSize: 1234, mimeType: 'image/png' },
        },
        {
          type: 'file',
          file: { fileName: 'notes.md', filePath: '/tmp/notes.md', mimeType: 'text/markdown' },
          metadata: { fileSize: 456 },
        },
        {
          type: 'office',
          file: { fileName: 'deck.pptx', filePath: '/tmp/deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
          metadata: { fileSize: 789 },
        },
        {
          type: 'others',
          file: { fileName: 'archive.zip', filePath: '', mimeType: 'application/zip' },
          metadata: { fileSize: 111 },
        },
      ],
    } as any, undefined, undefined, {});
    const submitCall = mockHookManager.runHooks.mock.calls.find((call: any[]) => call[0] === 'UserPromptSubmit');
    expect(submitCall?.[1].prompt).toContain('review this');
    expect(submitCall?.[1].prompt).toContain('[image: diagram.png, image/png, 1234 bytes]');
    expect(submitCall?.[1].prompt).toContain('[file: notes.md, text/markdown, 456 bytes, path: /tmp/notes.md]');
    expect(submitCall?.[1].prompt).toContain('[office: deck.pptx, application/vnd.openxmlformats-officedocument.presentationml.presentation, 789 bytes, path: /tmp/deck.pptx]');
    expect(submitCall?.[1].prompt).toContain('[attachment: archive.zip, application/zip, 111 bytes]');
  });

  it('fires SessionStart as startup on the first streamMessage turn even after the user message is persisted', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent();
    mockRunStreamMessage.mockImplementationOnce(async ({ userMessage: msg }: any) => {
      await (agent as any).AddMessageToSession(msg);
      await (agent as any).startChat();
      return [];
    });

    await agent.streamMessage(userMessage(), undefined, undefined, {});

    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'SessionStart',
      expect.objectContaining({ source: 'startup', trigger: 'new' }),
      expect.anything(),
    );
  });

  it('clears turn-scoped contexts in the finally block', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'UserPromptSubmit' ? { additionalContexts: ['turn-ctx'] } : {},
    );
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    // last sync after clear should drop the turn-scoped context
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith([]);
  });

  it('proceeds normally when the hook returns nothing', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(mockRunStreamMessage).toHaveBeenCalled();
  });
});

// ─────────────────────────── editUserMessage hook lifecycle ───────────────────────────

describe('editUserMessage hook lifecycle', () => {
  it('runs prompt, session-start, model, and stop hooks around edited prompts', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'UserPromptSubmit' ? { additionalContexts: ['edit-ctx'] } : {},
    );
    const edited = userMessage('edited prompt');
    mockPrepareEditedUserMessage.mockReturnValue({
      normalizedMessage: edited,
      targetUserIndex: 0,
      targetContextUserIndex: 0,
    });
    const agent = createAgent({
      chat_history: [userMessage('old prompt')],
      context_history: [userMessage('old prompt')],
    });

    await agent.editUserMessage('user_1', edited);

    const submitCall = mockHookManager.runHooks.mock.calls.find((call: any[]) => call[0] === 'UserPromptSubmit');
    const sessionStartCall = mockHookManager.runHooks.mock.calls.find((call: any[]) => call[0] === 'SessionStart');
    const stopCall = mockHookManager.runHooks.mock.calls.find((call: any[]) => call[0] === 'Stop');

    expect(submitCall?.[1]).toMatchObject({ prompt: 'edited prompt' });
    expect(sessionStartCall?.[1]).toMatchObject({ source: 'resume', trigger: 'resume' });
    expect(stopCall?.[1]).toMatchObject({ hook_event_name: 'Stop' });
    expect(mockApplyEditedUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedMessage: edited }),
      undefined,
    );
    expect(mockTurnRun).toHaveBeenCalledWith(expect.objectContaining({ deferFinalIdle: true }));
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith([]);
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('does not apply an edited prompt when UserPromptSubmit blocks it', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'UserPromptSubmit' ? { blockingError: 'blocked edit' } : {},
    );
    const edited = userMessage('blocked edited prompt');
    mockPrepareEditedUserMessage.mockReturnValue({
      normalizedMessage: edited,
      targetUserIndex: 0,
      targetContextUserIndex: 0,
    });
    const agent = createAgent({
      chat_history: [userMessage('old prompt')],
      context_history: [userMessage('old prompt')],
    });
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).getDisplayMessages = () => [{ id: 'blocked' }];

    const result = await agent.editUserMessage('user_1', edited);

    expect(result).toEqual([{ id: 'blocked' }]);
    expect(mockApplyEditedUserMessage).not.toHaveBeenCalled();
    expect(mockTurnRun).not.toHaveBeenCalled();
    expect(mockHookManager.runHooks.mock.calls.some((call: any[]) => call[0] === 'Stop')).toBe(false);
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('bypasses local hooks for external agent edits', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const edited = userMessage('external edit');
    mockPrepareEditedUserMessage.mockReturnValue({
      normalizedMessage: edited,
      targetUserIndex: 0,
      targetContextUserIndex: 0,
    });
    const agent = createAgent({
      chat_history: [userMessage('old external prompt')],
      context_history: [userMessage('old external prompt')],
    }, { source: 'EXTERNAL', hooks: ['legacy-hook'] });

    await agent.editUserMessage('user_1', edited);

    expect(mockApplyEditedUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedMessage: edited }),
      undefined,
    );
    expect(mockExternalAgentMessageHandler).toHaveBeenCalledWith(expect.anything(), edited, { persistUserMessage: false });
    expect(mockHookManager.runHooks).not.toHaveBeenCalled();
    expect(mockTurnRun).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── retryChat hook lifecycle ───────────────────────────

describe('retryChat hook lifecycle', () => {
  it('runs Stop and clears turn-scoped hook buffers after a successful retry', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'Stop' ? { additionalContexts: ['retry-stop'] } : {},
    );
    const agent = createAgent();
    mockRunRetry.mockImplementationOnce(async () => {
      hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['retry-turn'] });
      return [{ id: 'retry-result' }];
    });

    const result = await agent.retryChat();

    expect(result).toEqual([{ id: 'retry-result' }]);
    expect(mockRunRetry).toHaveBeenCalledWith({ token: undefined, callbacks: undefined, deferFinalIdle: true });
    expect(mockHookManager.runHooks).toHaveBeenCalledWith('Stop', expect.objectContaining({ hook_event_name: 'Stop' }), expect.anything());
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['retry-stop']);
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('clears turn-scoped hook buffers when retry fails before Stop', async () => {
    const agent = createAgent();
    mockRunRetry.mockImplementationOnce(async () => {
      hookRuntime(agent).applyHookResultIfActive({ additionalContexts: ['retry-turn'] });
      throw new Error('retry failed');
    });

    await expect(agent.retryChat()).rejects.toThrow('retry failed');

    expect(mockHookManager.runHooks).not.toHaveBeenCalledWith('Stop', expect.anything(), expect.anything());
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith([]);
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('bypasses local hooks and resends the latest user message for external agent retries', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const latest = userMessage('external retry');
    const agent = createAgent({
      chat_history: [
        userMessage('older prompt'),
        { id: 'assistant_1', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'answer' }] },
        latest,
      ],
    }, { source: 'EXTERNAL', hooks: ['legacy-hook'] });

    await agent.retryChat();

    expect(mockExternalAgentMessageHandler).toHaveBeenCalledWith(expect.anything(), latest, { persistUserMessage: false });
    expect(mockRunRetry).not.toHaveBeenCalled();
    expect(mockHookManager.runHooks).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── streamMessage Stop ───────────────────────────

describe('streamMessage Stop integration', () => {
  it('fires the Stop hook after the turn finishes responding', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(mockHookManager.runHooks).toHaveBeenCalledWith('Stop', expect.objectContaining({ hook_event_name: 'Stop' }), expect.anything());
  });

  it('passes the active turn cancellation token to Stop hooks', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const agent = createAgent();
    await agent.streamMessage(userMessage(), token as any, undefined, {});
    const stopCall = mockHookManager.runHooks.mock.calls.find((call: any[]) => call[0] === 'Stop');
    expect(stopCall?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('buffers Stop additional context at session scope so it survives the turn reset', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'Stop' ? { additionalContexts: ['stop-ctx'] } : {},
    );
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(hookRuntime(agent).getObservationalHookContexts()).toContain('stop-ctx');
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['stop-ctx']);
  });

  it('buffers Stop system messages at session scope so they are applied to later turns', async () => {
    mockHookManager.runHooks.mockImplementation(async (event: string) =>
      event === 'Stop' ? { systemMessages: ['stop-system'] } : {},
    );
    const agent = createAgent();
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    expect(mockSetHookSystemMessages).toHaveBeenLastCalledWith(['stop-system']);
  });

  it('keeps the chat non-idle until a slow Stop hook completes', async () => {
    let agent: any;
    let releaseStop!: () => void;
    let markStopEntered!: () => void;
    const stopEntered = new Promise<void>(resolve => { markStopEntered = resolve; });
    const stopRelease = new Promise<void>(resolve => { releaseStop = resolve; });
    mockHookManager.runHooks.mockImplementation(async (event: string) => {
      if (event === 'Stop') {
        markStopEntered();
        await stopRelease;
      }
      return {};
    });
    agent = createAgent();
    mockRunStreamMessage.mockImplementationOnce(async () => {
      (agent as any).setChatStatus('received_response');
      return [];
    });

    const streamPromise = agent.streamMessage(userMessage(), undefined, undefined, {});
    await stopEntered;

    expect(agent.getChatStatus()).not.toBe('idle');
    releaseStop();
    await streamPromise;
    expect(agent.getChatStatus()).toBe('idle');
  });

  it('does not fire the Stop hook when the prompt is blocked', async () => {
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'blocked prompt' });
    const agent = createAgent();
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).getDisplayMessages = () => [{ id: 'blocked' }];
    await agent.streamMessage(userMessage(), undefined, undefined, {});
    const stopCalls = mockHookManager.runHooks.mock.calls.filter((c: any[]) => c[0] === 'Stop');
    expect(stopCalls).toHaveLength(0);
  });
});

// ─────────────────────────── compaction lifecycle hooks ───────────────────────────

describe('compaction lifecycle hook wiring', () => {
  it('runs the PreCompact hook via onBeforeCompaction and buffers context at session scope', async () => {
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['pre-ctx'] });
    const agent = createAgent();
    await capturedContextServiceOpts.onBeforeCompaction('auto');
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PreCompact',
      expect.objectContaining({ hook_event_name: 'PreCompact', trigger: 'auto' }),
      expect.anything(),
    );
    expect(hookRuntime(agent).getObservationalHookContexts()).toContain('pre-ctx');
  });

  it('runs the PostCompact hook via onAfterCompaction with the manual trigger', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    createAgent();
    await capturedContextServiceOpts.onAfterCompaction('manual');
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'PostCompact',
      expect.objectContaining({ hook_event_name: 'PostCompact', trigger: 'manual' }),
      expect.anything(),
    );
  });

  it('does not apply late compaction hook context after the callback signal aborts', async () => {
    let resolveRunHooks: (value: { additionalContexts: string[] }) => void = () => {};
    mockHookManager.runHooks.mockImplementationOnce(() => new Promise(resolve => {
      resolveRunHooks = resolve;
    }));
    const agent = createAgent();
    const controller = new AbortController();

    const hookPromise = capturedContextServiceOpts.onBeforeCompaction('auto', { signal: controller.signal });
    controller.abort();
    resolveRunHooks({ additionalContexts: ['late-ctx'] });
    await hookPromise;

    expect(hookRuntime(agent).getObservationalHookContexts()).toEqual([]);
  });

  it('bounds the observational context buffer with oldest-first eviction', async () => {
    let n = 0;
    mockHookManager.runHooks.mockImplementation(async () => ({ additionalContexts: [`ctx-${n++}`] }));
    const agent = createAgent();
    for (let i = 0; i < 40; i++) {
      await capturedContextServiceOpts.onBeforeCompaction('auto');
    }
    const buf = hookRuntime(agent).getObservationalHookContexts() as string[];
    expect(buf.length).toBe(32);
    expect(buf).not.toContain('ctx-0');
    expect(buf[buf.length - 1]).toBe('ctx-39');
  });

  it('bounds session hook contexts and truncates oversized entries', async () => {
    const agent = createAgent();
    const runtime = hookRuntime(agent);
    runtime.addSessionHookContexts(Array.from({ length: 40 }, (_, index) => `ctx-${index}`));
    runtime.addSessionHookContexts(['x'.repeat(5000)]);

    const buf = runtime.getSessionHookContexts();
    expect(buf.length).toBe(32);
    expect(buf).not.toContain('ctx-0');
    expect(buf[buf.length - 1]).toHaveLength(4096);
  });

  it('bounds turn hook context and system-message buffers', async () => {
    const agent = createAgent();
    const runtime = hookRuntime(agent);
    for (let i = 0; i < 40; i++) {
      runtime.applyHookResultIfActive({ additionalContexts: [`turn-${i}`], systemMessages: [`sys-${i}`] });
    }

    expect(runtime.getTurnHookContexts()).toHaveLength(32);
    expect(runtime.getTurnHookContexts()[0]).toBe('turn-8');
    expect(mockSetHookSystemMessages).toHaveBeenLastCalledWith(expect.arrayContaining(['sys-39']));
    expect(mockSetHookSystemMessages.mock.calls.at(-1)?.[0]).toHaveLength(32);
  });
});

// ─────────────────────────── startChat SessionStart ───────────────────────────

describe('startChat SessionStart integration', () => {
  it('runs the SessionStart hook with trigger "new" on a fresh session', async () => {
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['session-ctx'] });
    const agent = createAgent();
    await (agent as any).startChat();
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'SessionStart',
      expect.objectContaining({ source: 'startup', trigger: 'new' }),
      expect.anything(),
    );
    expect(hookRuntime(agent).getSessionHookContexts()).toContain('session-ctx');
    expect(mockSetHookAdditionalContexts).toHaveBeenLastCalledWith(['session-ctx']);
  });

  it('uses trigger "resume" when chat history is non-empty', async () => {
    mockHookManager.runHooks.mockResolvedValue({});
    const agent = createAgent({ chat_history: [{ id: 'm', role: 'user' }] });
    await (agent as any).startChat();
    expect(mockHookManager.runHooks).toHaveBeenCalledWith(
      'SessionStart',
      expect.objectContaining({ source: 'resume', trigger: 'resume' }),
      expect.anything(),
    );
  });

  it('marks the chat busy while SessionStart preflight is still running', async () => {
    let releaseSessionStart!: () => void;
    let markSessionStartEntered!: () => void;
    const sessionStartEntered = new Promise<void>(resolve => { markSessionStartEntered = resolve; });
    const sessionStartRelease = new Promise<void>(resolve => { releaseSessionStart = resolve; });
    mockHookManager.runHooks.mockImplementation(async (event: string) => {
      if (event === 'SessionStart') {
        markSessionStartEntered();
        await sessionStartRelease;
      }
      return {};
    });
    const agent = createAgent();

    const startPromise = (agent as any).startChat();
    await sessionStartEntered;

    expect(agent.getChatStatus()).toBe('sending_response');
    releaseSessionStart();
    await startPromise;
  });

  it('preserves Agent Hook SessionStart context', async () => {
    mockHookManager.runHooks.mockResolvedValue({ additionalContexts: ['agent-ctx'] });
    const agent = createAgent();
    await (agent as any).startChat();
    expect(hookRuntime(agent).getSessionHookContexts()).toEqual(['agent-ctx']);
  });

  it('blocks the first model turn when SessionStart blocks', async () => {
    mockHookManager.runHooks.mockResolvedValue({ blockingError: 'session denied' });
    const agent = createAgent();
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).getDisplayMessages = () => [{ id: 'blocked-session' }];

    await (agent as any).startChat();

    expect(mockTurnRun).not.toHaveBeenCalled();
    expect(mockEmitStreamingChunk).toHaveBeenCalledWith(expect.objectContaining({
      type: 'content',
      contentDelta: { text: 'session denied' },
    }));
  });

  it('retries SessionStart on the next startChat call after a blocking result', async () => {
    mockHookManager.runHooks
      .mockResolvedValueOnce({ blockingError: 'session denied' })
      .mockResolvedValueOnce({});
    const agent = createAgent();
    (agent as any).AddMessageToSession = vi.fn().mockResolvedValue(undefined);
    (agent as any).getDisplayMessages = () => [{ id: 'blocked-session' }];

    await (agent as any).startChat();
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(false);
    expect(mockTurnRun).not.toHaveBeenCalled();

    await (agent as any).startChat();
    expect(mockHookManager.runHooks).toHaveBeenCalledTimes(2);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(true);
    expect(mockTurnRun).toHaveBeenCalledTimes(1);
  });

  it('does not mark SessionStart fired when cancellation interrupts the hook', async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    };
    mockHookManager.runHooks.mockImplementationOnce(async () => {
      token.isCancellationRequested = true;
      return {};
    });
    const agent = createAgent();

    await expect((agent as any).startChat(token)).rejects.toThrow('Operation cancelled during Agent SessionStart hook');
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(false);
    expect(mockTurnRun).not.toHaveBeenCalled();

    const nextToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    };
    await (agent as any).startChat(nextToken);

    expect(mockHookManager.runHooks).toHaveBeenCalledTimes(2);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(true);
    expect(mockTurnRun).toHaveBeenCalledTimes(1);
  });

  it('preserves the startup trigger when a blocked streamed first turn adds history', async () => {
    mockHookManager.runHooks
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ blockingError: 'session denied' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const agent = createAgent();
    mockRunStreamMessage.mockImplementation(async ({ token, callbacks }: any) => {
      await (agent as any).startChat(token, callbacks);
      return (agent as any).getDisplayMessages();
    });
    (agent as any).AddMessageToSession = vi.fn().mockImplementation(async (message: any) => {
      (agent as any).addMessageToChatHistory(message);
    });

    await agent.streamMessage(userMessage('first'));
    expect((agent as any).getChatHistory()).toHaveLength(1);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(false);

    await agent.streamMessage(userMessage('second'));

    const sessionStartInputs = mockHookManager.runHooks.mock.calls
      .filter(([event]) => event === 'SessionStart')
      .map(([, input]) => input);
    expect(sessionStartInputs).toEqual([
      expect.objectContaining({ source: 'startup', trigger: 'new' }),
      expect.objectContaining({ source: 'startup', trigger: 'new' }),
    ]);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(true);
    expect(hookRuntime(agent).getPendingSessionStartTrigger()).toBeNull();
    expect(mockTurnRun).toHaveBeenCalledTimes(1);
  });

  it('preserves the startup trigger when UserPromptSubmit blocks before SessionStart', async () => {
    mockHookManager.runHooks
      .mockResolvedValueOnce({ blockingError: 'prompt denied' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const agent = createAgent();
    mockRunStreamMessage.mockImplementation(async ({ token, callbacks }: any) => {
      await (agent as any).startChat(token, callbacks);
      return (agent as any).getDisplayMessages();
    });
    (agent as any).AddMessageToSession = vi.fn().mockImplementation(async (message: any) => {
      (agent as any).addMessageToChatHistory(message);
    });

    await agent.streamMessage(userMessage('first'));
    expect((agent as any).getChatHistory()).toHaveLength(1);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(false);

    await agent.streamMessage(userMessage('second'));

    const sessionStartInputs = mockHookManager.runHooks.mock.calls
      .filter(([event]) => event === 'SessionStart')
      .map(([, input]) => input);
    expect(sessionStartInputs).toEqual([
      expect.objectContaining({ source: 'startup', trigger: 'new' }),
    ]);
    expect(hookRuntime(agent).isSessionStartHookFired()).toBe(true);
    expect(mockTurnRun).toHaveBeenCalledTimes(1);
  });
});
