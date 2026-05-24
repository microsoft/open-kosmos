/**
 * agentChat.deep3.test.ts
 *
 * Targets remaining uncovered statements in agentChat.ts (round 3):
 * - factory/getter lazy-creation paths (createPromptService, getPromptService,
 *   createSessionService, getSessionService, createContextService, getContextService,
 *   createInteractionService, getInteractionService, createToolPostProcessor,
 *   getToolPostProcessor, createToolExecutor, getToolExecutor,
 *   createStreamingService, getStreamingService, createTurnRunner, getTurnRunner)
 * - Delegating public/private methods (getContextHistory, getChatHistory,
 *   getCancellationToken, invalidateActiveExecution, cancelActiveToolExecution,
 *   registerActiveToolCancellationHandler, getSubAgentConfig, getContextSummary,
 *   forceIdleStatus, destroy, updateSessionTitle, initializeEmptyChatSession,
 *   addMessageToChatHistory, getSchedulerMetadata, hasInjectedMcpImageHash,
 *   createMcpImageHash, getAgentInfo null-config branch,
 *   exitNewChatSessionState error branch)
 * - setChatStatus: listener throws but is caught; forceIdleStatus no-op when IDLE
 * - addStatusChangeListener / removeStatusChangeListener
 * - calculateThreeComponentTokens, calculateAndNotifyContext, notifyContextChange
 * - getContextTokenUsage, getDisplayMessages
 * - retryChat delegates to turnRunner
 * - streamMessage external agent branch
 * - getCurrentModelId, getLatestAgentConfig null paths
 */

// ── mocks ──────────────────────────────────────────────────────────────────

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

const { mockGetModelCapabilities, mockGetDefaultModel } = vi.hoisted(() => ({
  mockGetModelCapabilities: vi.fn(() => ({
    supportsTools: true, supportsImages: false, tokenizer: 'o200k_base',
    limits: { max_output_tokens: 4000 }, family: '', supports: { tool_calls: true, vision: false },
  })),
  mockGetDefaultModel: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn(),
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

// AgentChatTurnRunner — stub so createTurnRunner doesn't fail on imports
vi.mock('../agentChatTurnRunner', async () => ({
  AgentChatTurnRunner: vi.fn().mockImplementation(function (this: any) {
    this.runStreamMessage = vi.fn().mockResolvedValue([]);
    this.runRetry = vi.fn().mockResolvedValue([]);
  }),
}));

// Stub the inner service classes so factory methods succeed
vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: vi.fn().mockImplementation(function (this: any) {
    this.getAgentSpecificSystemPrompt = vi.fn(() => []);
    this.buildSubAgentsSystemPrompt = vi.fn(() => '');
    this.getCombinedSystemPromptForContext = vi.fn(() => []);
    this.getLatestCustomSystemPrompt = vi.fn(() => []);
    this.getCombinedSystemPromptForCurrentTurn = vi.fn(async () => []);
    this.refreshSkillSnapshotIfNeeded = vi.fn(async () => {});
    this.generateFallbackTitle = vi.fn(() => 'Fallback Title');
  }),
}));

vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: vi.fn().mockImplementation(function (this: any) {
    this.saveChatSession = vi.fn().mockResolvedValue({ success: true });
    this.generateChatSessionTitle = vi.fn(async () => {});
    this.generateFallbackTitle = vi.fn(() => 'Fallback');
    this.addMessageToSession = vi.fn(async () => {});
  }),
}));

vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: vi.fn().mockImplementation(function (this: any) {
    this.extractFactsFromConversation = vi.fn(async () => {});
    this.addMessageToContext = vi.fn(async () => {});
    this.enhanceUserMessageContext = vi.fn(async (m: any) => m);
    this.checkAndCompress = vi.fn(async () => ({ applied: false }));
    this.calculateAndNotifyContext = vi.fn(async () => {});
    this.calculateThreeComponentTokens = vi.fn(async () => ({ contextHistoryTokens: 10, systemPromptTokens: 5, toolsTokens: 2, totalTokens: 17 }));
    this.notifyContextChange = vi.fn();
    this.anchorTokenEstimate = vi.fn();
  }),
}));

vi.mock('../agentChatInteractionService', async () => ({
  AgentChatInteractionService: vi.fn().mockImplementation(function (this: any) {
    this.buildInteractionId = vi.fn(() => 'iid-1');
    this.buildInteractionHistoryEntry = vi.fn(() => ({}));
    this.buildInteractionSummary = vi.fn(() => 'summary');
    this.finalizeInteractiveRequest = vi.fn(async (req: any, resp: any) => resp);
    this.requestUserInteraction = vi.fn(async (_req: any, fb: any) => fb);
    this.requestApprovalInteraction = vi.fn(async () => new Map());
    this.batchValidateAndRequestApproval = vi.fn(async () => new Map());
    this.requestUserInfoInput = vi.fn(async () => null);
    this.requestUserChoice = vi.fn(async () => null);
  }),
}));

vi.mock('../agentChatToolPostProcessor', async () => ({
  AgentChatToolPostProcessor: vi.fn().mockImplementation(function (this: any) {
    this.postProcessToolResult = vi.fn(async (_tc: any, tr: any) => tr);
    this.postProcessForRequestInteractiveInputTool = vi.fn(async (r: any) => r);
    this.postProcessForGetMcpTemplateFromLibraryTool = vi.fn(async (r: any) => r);
    this.postProcessForGetAgentTemplateFromLibraryTool = vi.fn(async (r: any) => r);
  }),
}));

vi.mock('../agentChatToolExecutor', async () => ({
  AgentChatToolExecutor: vi.fn().mockImplementation(function (this: any) {
    this.executeToolCall = vi.fn(async () => 'tool-result');
    this.assertExecutionActive = vi.fn();
    this.invalidateActiveExecution = vi.fn();
    this.cancelActiveToolExecution = vi.fn(async () => {});
    this.registerActiveToolCancellationHandler = vi.fn(() => ({ dispose: vi.fn() }));
    this.cleanupIncompleteToolCalls = vi.fn(async () => {});
  }),
}));

vi.mock('../agentChatStreamingService', async () => ({
  AgentChatStreamingService: vi.fn().mockImplementation(function (this: any) {
    this.callWithToolsStreaming = vi.fn(async () => ({}));
    this.turnStartTime = 0;
    this.ttftReportedForTurn = false;
  }),
}));

vi.mock('../agentChatOutputPort', async () => ({
  AgentChatOutputPort: vi.fn().mockImplementation(function (this: any) {
    this.emitStatus = vi.fn();
    this.emitStreamingChunk = vi.fn();
    this.emitEvent = vi.fn();
    this.getSender = vi.fn(() => null);
    this.setSender = vi.fn();
    this.hasSender = vi.fn(() => false);
    this.clear = vi.fn();
  }),
}));

vi.mock('../agentChatPushReceiver', async () => ({
  AgentChatPushReceiver: vi.fn().mockImplementation(function (this: any) {
    this.destroy = vi.fn();
    this.startOrResetPushTimeout = vi.fn();
    this.cancelPushTimeout = vi.fn();
  }),
}));

vi.mock('../agentChatRuntimeState', async () => ({
  AgentChatRuntimeState: vi.fn().mockImplementation(function (this: any, status: any) {
    this.chatStatus = status;
    this.messagesToSave = [];
    this.saveChain = Promise.resolve();
    this.toolExecutionNonce = 0;
    this.currentCancellationToken = undefined;
    this.pendingInteractiveRequest = null;
    this.activeToolCancellationHandler = null;
    this.setChatStatus = vi.fn((s: any) => { this.chatStatus = s; });
    this.setMessagesToSave = vi.fn((m: any) => { this.messagesToSave = m; });
    this.setSaveChain = vi.fn((c: any) => { this.saveChain = c; });
    this.setToolExecutionNonce = vi.fn((n: any) => { this.toolExecutionNonce = n; });
    this.setPendingInteractiveRequest = vi.fn((r: any) => { this.pendingInteractiveRequest = r; });
    this.setActiveToolCancellationHandler = vi.fn((h: any) => { this.activeToolCancellationHandler = h; });
    this.clearCancellationToken = vi.fn();
    this.setCancellationToken = vi.fn((t: any) => { this.currentCancellationToken = t; });
  }),
}));

// ── SUT ────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentChat, ChatStatus } from '../agentChat';

// ── helpers ────────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  chat_id: 'chat-deep3',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'Deep3Agent',
    model: 'gpt-5',
    mcp_servers: [],
    system_prompt: '',
    workspace: '/ws',
    source: 'ON-DEVICE',
  },
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    chatSession_id: 'session-d3',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test',
    last_updated: '2026-01-01T00:00:00Z',
    ...overrides,
  } as any;
}

function createAgent(sessionOverrides: Record<string, any> = {}, agentOverrides: Record<string, any> = {}) {
  mockProfileCacheManager.getChatConfig.mockReturnValue({
    ...BASE_CONFIG,
    agent: { ...BASE_CONFIG.agent, ...agentOverrides },
  });
  return new AgentChat('user1', 'chat-deep3', 'session-d3', makeSession(sessionOverrides));
}

// ── lazy factory/getter tests ──────────────────────────────────────────────────

describe('AgentChat - lazy factory/getter coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getPromptService creates service when promptService is null', () => {
    const agent = createAgent();
    (agent as any).promptService = null;
    const svc = (agent as any).getPromptService();
    expect(svc).not.toBeNull();
    // Second call returns same instance
    expect((agent as any).getPromptService()).toBe(svc);
  });

  it('getSessionService creates service when sessionService is null', () => {
    const agent = createAgent();
    (agent as any).sessionService = null;
    const svc = (agent as any).getSessionService();
    expect(svc).not.toBeNull();
    expect((agent as any).getSessionService()).toBe(svc);
  });

  it('getContextService creates service when contextService is null', () => {
    const agent = createAgent();
    (agent as any).contextService = null;
    const svc = (agent as any).getContextService();
    expect(svc).not.toBeNull();
    expect((agent as any).getContextService()).toBe(svc);
  });

  it('getInteractionService creates service when interactionService is null', () => {
    const agent = createAgent();
    (agent as any).interactionService = null;
    const svc = (agent as any).getInteractionService();
    expect(svc).not.toBeNull();
    expect((agent as any).getInteractionService()).toBe(svc);
  });

  it('getToolPostProcessor creates processor when null', () => {
    const agent = createAgent();
    (agent as any).toolPostProcessor = null;
    const proc = (agent as any).getToolPostProcessor();
    expect(proc).not.toBeNull();
    expect((agent as any).getToolPostProcessor()).toBe(proc);
  });

  it('getToolExecutor creates executor when null', () => {
    const agent = createAgent();
    (agent as any).toolExecutor = null;
    const exec = (agent as any).getToolExecutor();
    expect(exec).not.toBeNull();
    expect((agent as any).getToolExecutor()).toBe(exec);
  });

  it('getStreamingService creates service when null', () => {
    const agent = createAgent();
    (agent as any).streamingService = null;
    const svc = (agent as any).getStreamingService();
    expect(svc).not.toBeNull();
    expect((agent as any).getStreamingService()).toBe(svc);
  });

  it('getTurnRunner creates runner when null', () => {
    const agent = createAgent();
    (agent as any).turnRunner = null;
    const runner = (agent as any).getTurnRunner();
    expect(runner).not.toBeNull();
    expect((agent as any).getTurnRunner()).toBe(runner);
  });
});

// ── delegation tests ───────────────────────────────────────────────────────────

describe('AgentChat - delegation methods', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getContextHistory returns [] when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(agent.getContextHistory()).toEqual([]);
  });

  it('getContextHistory returns context_history from session', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
    const agent = createAgent({ context_history: [msg] });
    expect(agent.getContextHistory()).toHaveLength(1);
  });

  it('getChatHistory returns [] when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(agent.getChatHistory()).toEqual([]);
  });

  it('getCancellationToken returns undefined by default', () => {
    const agent = createAgent();
    expect(agent.getCancellationToken()).toBeUndefined();
  });

  it('invalidateActiveExecution delegates to toolExecutor', () => {
    const agent = createAgent();
    agent.invalidateActiveExecution();
    expect((agent as any).toolExecutor.invalidateActiveExecution).toHaveBeenCalled();
  });

  it('cancelActiveToolExecution delegates to toolExecutor', async () => {
    const agent = createAgent();
    await agent.cancelActiveToolExecution();
    expect((agent as any).toolExecutor.cancelActiveToolExecution).toHaveBeenCalled();
  });

  it('getContextTokenUsage returns null initially', () => {
    const agent = createAgent();
    expect(agent.getContextTokenUsage()).toBeNull();
  });

  it('getDisplayMessages returns empty array when no chat history and no custom prompt', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    const msgs = agent.getDisplayMessages();
    expect(Array.isArray(msgs)).toBe(true);
  });

  it('getChatId returns the chatId', () => {
    const agent = createAgent();
    expect(agent.getChatId()).toBe('chat-deep3');
  });

  it('getUserAlias returns the user alias', () => {
    const agent = createAgent();
    expect(agent.getUserAlias()).toBe('user1');
  });

  it('getChatSessionId returns the chat session id', () => {
    const agent = createAgent();
    expect(agent.getChatSessionId()).toBe('session-d3');
  });

  it('getChatStatus returns IDLE by default', () => {
    const agent = createAgent();
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });

  it('getChatStatusInfo returns correct shape', () => {
    const agent = createAgent();
    const info = agent.getChatStatusInfo();
    expect(info).toHaveProperty('chatId', 'chat-deep3');
    expect(info).toHaveProperty('chatStatus');
    expect(info).toHaveProperty('agentName');
  });
});

// ── setChatStatus & listeners ──────────────────────────────────────────────────

describe('AgentChat - setChatStatus and status listeners', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setChatStatus notifies added listeners', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.addStatusChangeListener(listener);
    (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(listener).toHaveBeenCalledWith(ChatStatus.SENDING_RESPONSE);
  });

  it('setChatStatus catches listener that throws', () => {
    const agent = createAgent();
    const badListener = vi.fn(() => { throw new Error('listener boom'); });
    agent.addStatusChangeListener(badListener);
    expect(() => (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE)).not.toThrow();
  });

  it('addStatusChangeListener returns a disposer function that removes the listener', () => {
    const agent = createAgent();
    const listener = vi.fn();
    const disposer = agent.addStatusChangeListener(listener);
    // disposer is a plain function
    disposer();
    (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(listener).not.toHaveBeenCalled();
  });

  it('forceIdleStatus is a no-op when already IDLE', () => {
    const agent = createAgent();
    (agent as any).runtimeState.chatStatus = ChatStatus.IDLE;
    const setSpy = vi.spyOn(agent as any, 'setChatStatus');
    agent.forceIdleStatus();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('forceIdleStatus forces to IDLE when not IDLE', () => {
    const agent = createAgent();
    (agent as any).runtimeState.chatStatus = ChatStatus.SENDING_RESPONSE;
    agent.forceIdleStatus();
    expect((agent as any).runtimeState.setChatStatus).toHaveBeenCalledWith(ChatStatus.IDLE);
  });
});

// ── updateSessionTitle ─────────────────────────────────────────────────────────

describe('AgentChat - updateSessionTitle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(agent.updateSessionTitle('New')).toBe(false);
  });

  it('returns true and updates title when session exists', () => {
    const agent = createAgent();
    expect(agent.updateSessionTitle('Renamed')).toBe(true);
    expect((agent as any).currentChatSession.title).toBe('Renamed');
  });
});

// ── initializeEmptyChatSession ─────────────────────────────────────────────────

describe('AgentChat - initializeEmptyChatSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears currentChatSession, firstUserMessage, schedulerJobId', () => {
    const agent = createAgent();
    (agent as any).schedulerJobId = 'job-1';
    (agent as any).firstUserMessage = { role: 'user' };
    agent.initializeEmptyChatSession();
    expect((agent as any).currentChatSession).toBeNull();
    expect((agent as any).firstUserMessage).toBeNull();
    expect((agent as any).schedulerJobId).toBeUndefined();
    expect((agent as any).skipPersistence).toBe(false);
  });
});

// ── addMessageToChatHistory ────────────────────────────────────────────────────

describe('AgentChat - addMessageToChatHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when currentChatSession is null', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as any;
    expect(() => agent.addMessageToChatHistory(msg)).toThrow('currentChatSession must be initialized');
  });

  it('pushes message to chat_history', () => {
    const agent = createAgent();
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as any;
    agent.addMessageToChatHistory(msg);
    expect((agent as any).currentChatSession.chat_history).toHaveLength(1);
  });
});

// ── getSchedulerMetadata ───────────────────────────────────────────────────────

describe('AgentChat - getSchedulerMetadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty object when no scheduler fields set', () => {
    const agent = createAgent();
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta).toEqual({});
  });

  it('includes schedulerJobId when set', () => {
    const agent = createAgent();
    (agent as any).schedulerJobId = 'job-42';
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta.schedulerJobId).toBe('job-42');
  });

  it('includes all scheduler execution fields when set', () => {
    const agent = createAgent();
    (agent as any).schedulerExecutionMetadata = {
      schedulerExecutionStatus: 'running',
      schedulerStartedAt: '2026-01-01T00:00:00Z',
      schedulerCompletedAt: '2026-01-01T01:00:00Z',
      schedulerError: 'oops',
    };
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta.schedulerExecutionStatus).toBe('running');
    expect(meta.schedulerStartedAt).toBeDefined();
    expect(meta.schedulerCompletedAt).toBeDefined();
    expect(meta.schedulerError).toBe('oops');
  });
});

// ── createMcpImageHash & hasInjectedMcpImageHash ───────────────────────────────

describe('AgentChat - createMcpImageHash / hasInjectedMcpImageHash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createMcpImageHash returns a hex string', () => {
    const agent = createAgent();
    const hash = (agent as any).createMcpImageHash('base64data', 'image/png');
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hasInjectedMcpImageHash returns false when no chat history', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect((agent as any).hasInjectedMcpImageHash('abc123')).toBe(false);
  });

  it('hasInjectedMcpImageHash returns false when hash not present in messages', () => {
    const agent = createAgent();
    expect((agent as any).hasInjectedMcpImageHash('nonexistent-hash')).toBe(false);
  });
});

// ── getContextSummary ──────────────────────────────────────────────────────────

describe('AgentChat - getContextSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty string when no context history', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    expect(agent.getContextSummary()).toBe('');
  });

  it('returns summary lines for messages with text', () => {
    const agent = createAgent({
      context_history: [
        { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
      ],
    });
    const summary = agent.getContextSummary();
    expect(summary).toContain('[user]');
    expect(summary).toContain('[assistant]');
  });

  it('skips messages with empty text', () => {
    const agent = createAgent({
      context_history: [
        { role: 'user', content: [] },
        { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
      ],
    });
    const summary = agent.getContextSummary();
    expect(summary).not.toContain('[user]');
    expect(summary).toContain('[assistant]');
  });
});

// ── getSubAgentConfig ──────────────────────────────────────────────────────────

describe('AgentChat - getSubAgentConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when agent does not reference the sub-agent', () => {
    const agent = createAgent({}, { sub_agents: ['other-agent'] });
    expect(agent.getSubAgentConfig('my-agent')).toBeUndefined();
  });

  it('returns undefined when chatConfig has no agent property — via direct mock after construction', () => {
    const agent = createAgent();
    // Override getChatConfig to return no agent after construction
    mockProfileCacheManager.getChatConfig.mockReturnValue({ chat_id: 'chat-deep3' });
    expect(agent.getSubAgentConfig('some-agent')).toBeUndefined();
  });
});

// ── getAgentInfo ───────────────────────────────────────────────────────────────

describe('AgentChat - getAgentInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no config available', async () => {
    const agent = createAgent();
    // After construction, override so config returns null
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    await expect(agent.getAgentInfo()).rejects.toThrow('Cannot get agent info');
  });
});

// ── setEventSender / hasEventSender ───────────────────────────────────────────

describe('AgentChat - setEventSender / hasEventSender', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setEventSender delegates to outputPort', () => {
    const agent = createAgent();
    agent.setEventSender(null);
    expect((agent as any).outputPort.setSender).toHaveBeenCalledWith(null);
  });

  it('hasEventSender delegates to outputPort', () => {
    const agent = createAgent();
    expect(agent.hasEventSender()).toBe(false);
  });
});

// ── exitNewChatSessionState error branch ───────────────────────────────────────

describe('AgentChat - exitNewChatSessionState error branch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swallows error from agentChatManager.exitNewChatSessionFor', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockImplementationOnce(() => {
      throw new Error('manager boom');
    });
    expect(() => (agent as any).exitNewChatSessionState()).not.toThrow();
  });
});

// ── destroy ────────────────────────────────────────────────────────────────────

describe('AgentChat - destroy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears listeners and calls pushReceiver.destroy', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.addStatusChangeListener(listener);
    agent.destroy();
    expect((agent as any).pushReceiver.destroy).toHaveBeenCalled();
    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
  });
});

// ── calculateAndNotifyContext ──────────────────────────────────────────────────

describe('AgentChat - calculateAndNotifyContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to contextService.calculateAndNotifyContext', async () => {
    const agent = createAgent();
    await agent.calculateAndNotifyContext();
    expect((agent as any).contextService.calculateAndNotifyContext).toHaveBeenCalled();
  });
});

// ── retryChat ─────────────────────────────────────────────────────────────────

describe('AgentChat - retryChat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to turnRunner.runRetry', async () => {
    const agent = createAgent();
    const result = await agent.retryChat();
    expect(Array.isArray(result)).toBe(true);
    expect((agent as any).turnRunner.runRetry).toHaveBeenCalled();
  });
});

// ── streamMessage - external agent branch ─────────────────────────────────────

describe('AgentChat - streamMessage external agent branch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to handleExternalAgentMessage when source=EXTERNAL and feature enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const agent = createAgent({}, { source: 'EXTERNAL' });
    const fakeMsg = { role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }], id: 'u1', timestamp: Date.now() };
    await agent.streamMessage(fakeMsg);
    expect(mockHandleExternalAgent).toHaveBeenCalled();
  });
});

// ── getCurrentModelId ─────────────────────────────────────────────────────────

describe('AgentChat - getCurrentModelId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns default model when config has no model', () => {
    const agent = createAgent();
    // After construction, override so config returns null
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    expect(agent.getCurrentModelId()).toBe('gpt-5');
  });

  it('returns model from config when available', () => {
    const agent = createAgent({}, { model: 'claude-3.7-sonnet' });
    expect(agent.getCurrentModelId()).toBe('claude-3.7-sonnet');
  });
});

// ── initialize ────────────────────────────────────────────────────────────────

describe('AgentChat - initialize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swallows calculateAndNotifyContext errors during initialize', async () => {
    const agent = createAgent();
    (agent as any).contextService.calculateAndNotifyContext.mockRejectedValueOnce(new Error('context fail'));
    await expect(agent.initialize()).resolves.toBeUndefined();
  });
});
