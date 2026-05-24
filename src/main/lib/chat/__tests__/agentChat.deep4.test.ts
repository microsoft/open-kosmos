/**
 * agentChat.deep4.test.ts
 *
 * Targets remaining uncovered lines in agentChat.ts (round 4):
 * - getElectronApp branches (lines 13-24)
 * - constructor-wired callbacks exercised through public APIs
 * - createContextService setContextHistory / setLastUpdated lambdas
 * - createInteractionService reportBlockedInteraction / saveChatSession lambdas
 * - createSessionService setCurrentChatSession / setFirstUserMessage lambdas
 * - createToolExecutor getAgentMcpServerNames lambda
 * - notifyContextChange delegation (line 1628)
 * - emitStreamingChunk delegation (line 1683)
 * - destroy full path (line 1686-1694)
 * - cleanupIncompleteToolCalls delegation (line 1708)
 * - exitNewChatSessionState success + error branches (lines 1715-1731)
 * - getAgentInfo null-config and success branches (lines 1647-1667)
 * - addContextChangeListener / removeContextChangeListener (lines 1573-1602)
 */

// ── hoisted mock state ────────────────────────────────────────────────────────

const {
  mockNotifyContextChange,
  capturedContextDeps,
  capturedInteractionDeps,
  capturedSessionDeps,
  capturedToolExecutorDeps,
  mockOutputPort,
  mockAgentChatManager,
  mockProfileCacheManager,
} = vi.hoisted(() => ({
  mockNotifyContextChange: vi.fn(),
  capturedContextDeps: { value: null as any },
  capturedInteractionDeps: { value: null as any },
  capturedSessionDeps: { value: null as any },
  capturedToolExecutorDeps: { value: null as any },
  mockOutputPort: {
    emitStatus: vi.fn(),
    emitStreamingChunk: vi.fn(),
    emitEvent: vi.fn(),
    getSender: vi.fn(() => null),
    setSender: vi.fn(),
    hasSender: vi.fn(() => false),
    clear: vi.fn(),
  },
  mockAgentChatManager: { exitNewChatSessionFor: vi.fn() },
  mockProfileCacheManager: { getChatConfig: vi.fn() },
}));

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
vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn(),
  getModelCapabilities: vi.fn(() => ({
    supportsTools: true, supportsImages: false, tokenizer: 'o200k_base',
    limits: { max_output_tokens: 4000 }, family: '', supports: { tool_calls: true, vision: false },
  })),
  getDefaultModel: vi.fn(() => 'gpt-5'),
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));
vi.mock('../../llm/ghcModelApi', async () => ({ getEndpointForModel: vi.fn() }));
vi.mock('../../auth/authManager', async () => ({ mainAuthManager: { getCurrentAuth: vi.fn() } }));
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
vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));
vi.mock('../chatSessionStore', async () => ({ chatSessionStore: {} }));
vi.mock('../../skill/skillManager', async () => ({ skillManager: {} }));
vi.mock('../globalSystemPrompt', async () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => []),
}));
vi.mock('../../featureFlags', async () => ({
  featureFlagManager: {},
  isFeatureEnabled: vi.fn(() => false),
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
vi.mock('../../analytics', async () => ({
  analyticsManager: { recordChatSessionActivated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../plugin/hooks/hookRegistry', async () => ({
  hookRegistry: { execute: vi.fn().mockResolvedValue({ additionalContexts: [] }) },
}));
vi.mock('../agentChatManager', async () => ({ agentChatManager: mockAgentChatManager }));
vi.mock('../externalAgentChatHandler', async () => ({
  handleExternalAgentMessage: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../buddy/BuddyManager', async () => ({
  BuddyManager: { getInstance: vi.fn(() => ({ addXP: vi.fn() })) },
}));
vi.mock('../agentChatTurnRunner', async () => ({
  AgentChatTurnRunner: vi.fn().mockImplementation(function (this: any) {
    this.runStreamMessage = vi.fn().mockResolvedValue([]);
    this.runRetry = vi.fn().mockResolvedValue([]);
  }),
}));
vi.mock('../agentChatPromptService', async () => ({
  AgentChatPromptService: vi.fn().mockImplementation(function (this: any) {
    this.getAgentSpecificSystemPrompt = vi.fn(() => []);
    this.buildSubAgentsSystemPrompt = vi.fn(() => '');
    this.getCombinedSystemPromptForContext = vi.fn(() => []);
    this.getLatestCustomSystemPrompt = vi.fn(() => []);
    this.getCombinedSystemPromptForCurrentTurn = vi.fn(async () => []);
    this.refreshSkillSnapshotIfNeeded = vi.fn(async () => {});
    this.generateFallbackTitle = vi.fn(() => 'Fallback Title');
    this.getCurrentAvailableTools = vi.fn(async () => []);
  }),
}));
vi.mock('../agentChatSessionService', async () => ({
  AgentChatSessionService: vi.fn().mockImplementation(function (this: any, deps: any) {
    capturedSessionDeps.value = deps;
    this.saveChatSession = vi.fn().mockResolvedValue({ success: true });
    this.generateChatSessionTitle = vi.fn(async () => {});
    this.generateFallbackTitle = vi.fn(() => 'Fallback');
    this.addMessageToSession = vi.fn(async () => {});
  }),
}));
vi.mock('../agentChatContextService', async () => ({
  AgentChatContextService: vi.fn().mockImplementation(function (this: any, deps: any) {
    capturedContextDeps.value = deps;
    this.extractFactsFromConversation = vi.fn(async () => {});
    this.addMessageToContext = vi.fn(async () => {});
    this.enhanceUserMessageContext = vi.fn(async (m: any) => m);
    this.checkAndCompress = vi.fn(async () => ({ applied: false }));
    this.calculateAndNotifyContext = vi.fn(async () => {});
    this.calculateThreeComponentTokens = vi.fn(async () => ({
      contextHistoryTokens: 10, systemPromptTokens: 5, toolsTokens: 2, totalTokens: 17,
    }));
    this.notifyContextChange = mockNotifyContextChange;
    this.anchorTokenEstimate = vi.fn();
  }),
}));
vi.mock('../agentChatInteractionService', async () => ({
  AgentChatInteractionService: vi.fn().mockImplementation(function (this: any, deps: any) {
    capturedInteractionDeps.value = deps;
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
  AgentChatToolExecutor: vi.fn().mockImplementation(function (this: any, deps: any) {
    capturedToolExecutorDeps.value = deps;
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
    Object.assign(this, mockOutputPort);
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

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  chat_id: 'chat-d4',
  agent: {
    role: 'assistant',
    emoji: '🤖',
    name: 'Deep4Agent',
    model: 'gpt-5',
    mcp_servers: [],
    system_prompt: '',
    workspace: '/ws',
    source: 'ON-DEVICE' as const,
  },
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    chatSession_id: 'session-d4',
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
  return new AgentChat('user1', 'chat-d4', 'session-d4', makeSession(sessionOverrides));
}

// ── getElectronApp branches ───────────────────────────────────────────────────

describe('getElectronApp helper (exercised via construction)', () => {
  it('construction succeeds when global.electron.app is set', () => {
    const fakeApp = { getVersion: () => '1.0.0' };
    (global as any).electron = { app: fakeApp };
    expect(() => createAgent()).not.toThrow();
    delete (global as any).electron;
  });

  it('construction succeeds without global.electron mock', () => {
    delete (global as any).electron;
    expect(() => createAgent()).not.toThrow();
  });
});

// ── createContextService lambdas ─────────────────────────────────────────────

describe('AgentChat - createContextService inline lambdas', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedContextDeps.value = null; });

  it('setContextHistory updates currentChatSession.context_history', () => {
    const agent = createAgent();
    // deps are captured when the constructor runs; use them directly
    const deps = capturedContextDeps.value;
    expect(deps).not.toBeNull();
    const newHistory = [{ role: 'assistant', content: [] }];
    deps.setContextHistory(newHistory);
    expect((agent as any).currentChatSession.context_history).toEqual(newHistory);
  });

  it('setContextHistory is a no-op when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    // Force recreation so we get fresh deps pointing at the null-session agent
    (agent as any).contextService = null;
    (agent as any).getContextService();
    const deps = capturedContextDeps.value;
    expect(() => deps.setContextHistory([])).not.toThrow();
  });

  it('setLastUpdated updates currentChatSession.last_updated', () => {
    const agent = createAgent();
    const deps = capturedContextDeps.value;
    deps.setLastUpdated('2026-02-01T00:00:00Z');
    expect((agent as any).currentChatSession.last_updated).toBe('2026-02-01T00:00:00Z');
  });

  it('setLastUpdated is a no-op when no currentChatSession', () => {
    const agent = createAgent();
    (agent as any).currentChatSession = null;
    (agent as any).contextService = null;
    (agent as any).getContextService();
    const deps = capturedContextDeps.value;
    expect(() => deps.setLastUpdated('2026-02-01T00:00:00Z')).not.toThrow();
  });

  it('setContextTokenUsage stores contextTokenUsage', () => {
    const agent = createAgent();
    const deps = capturedContextDeps.value;
    const usage = { contextHistory: 10, systemPrompt: 5, tools: 2, total: 17 } as any;
    deps.setContextTokenUsage(usage);
    expect((agent as any).contextTokenUsage).toEqual(usage);
  });

  it('setLatestContextStats stores latestContextStats', () => {
    const agent = createAgent();
    const deps = capturedContextDeps.value;
    const stats = { total: 100 } as any;
    deps.setLatestContextStats(stats);
    expect((agent as any).latestContextStats).toEqual(stats);
  });
});

// ── createInteractionService lambdas ─────────────────────────────────────────

describe('AgentChat - createInteractionService lambdas', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedInteractionDeps.value = null; });

  it('reportBlockedInteraction stores blockedInteractionDetails', () => {
    const agent = createAgent();
    const deps = capturedInteractionDeps.value;
    expect(deps).not.toBeNull();
    const details = { reason: 'blocked', toolName: 'shell' };
    deps.reportBlockedInteraction(details);
    expect((agent as any).blockedInteractionDetails).toEqual(details);
  });

  it('saveChatSession lambda invokes the session service', async () => {
    const agent = createAgent();
    const deps = capturedInteractionDeps.value;
    await deps.saveChatSession();
    expect((agent as any).sessionService.saveChatSession).toHaveBeenCalled();
  });

  it('getPendingInteractiveRequest returns runtimeState value', () => {
    const agent = createAgent();
    const deps = capturedInteractionDeps.value;
    (agent as any).runtimeState.pendingInteractiveRequest = { id: 'req1' };
    expect(deps.getPendingInteractiveRequest()).toEqual({ id: 'req1' });
  });

  it('setPendingInteractiveRequest calls runtimeState setter', () => {
    const agent = createAgent();
    const deps = capturedInteractionDeps.value;
    deps.setPendingInteractiveRequest({ id: 'req2' });
    expect((agent as any).runtimeState.setPendingInteractiveRequest).toHaveBeenCalledWith({ id: 'req2' });
  });
});

// ── createSessionService lambdas ─────────────────────────────────────────────

describe('AgentChat - createSessionService lambdas', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedSessionDeps.value = null; });

  it('setCurrentChatSession replaces currentChatSession', () => {
    const agent = createAgent();
    const deps = capturedSessionDeps.value;
    expect(deps).not.toBeNull();
    const newSess = makeSession({ title: 'Replaced' });
    deps.setCurrentChatSession(newSess);
    expect((agent as any).currentChatSession.title).toBe('Replaced');
  });

  it('setFirstUserMessage stores firstUserMessage', () => {
    const agent = createAgent();
    const deps = capturedSessionDeps.value;
    const msg = { role: 'user', content: [] } as any;
    deps.setFirstUserMessage(msg);
    expect((agent as any).firstUserMessage).toEqual(msg);
  });

  it('setMessagesToSave calls runtimeState.setMessagesToSave', () => {
    const agent = createAgent();
    const deps = capturedSessionDeps.value;
    const messages = [{ role: 'user' }] as any;
    deps.setMessagesToSave(messages);
    expect((agent as any).runtimeState.setMessagesToSave).toHaveBeenCalledWith(messages);
  });

  it('setSaveChain calls runtimeState.setSaveChain', () => {
    const agent = createAgent();
    const deps = capturedSessionDeps.value;
    const chain = Promise.resolve();
    deps.setSaveChain(chain);
    expect((agent as any).runtimeState.setSaveChain).toHaveBeenCalledWith(chain);
  });

  it('getSkipPersistence returns skipPersistence', () => {
    const agent = createAgent();
    (agent as any).skipPersistence = true;
    const deps = capturedSessionDeps.value;
    expect(deps.getSkipPersistence()).toBe(true);
  });
});

// ── createToolExecutor getAgentMcpServerNames lambda ─────────────────────────

describe('AgentChat - createToolExecutor getAgentMcpServerNames lambda', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedToolExecutorDeps.value = null; });

  it('returns server names from latest agent config', () => {
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      ...BASE_CONFIG,
      agent: { ...BASE_CONFIG.agent, mcp_servers: [{ name: 'srv1' }, { name: 'srv2' }] },
    });
    new AgentChat('user1', 'chat-d4', 'session-d4', makeSession());
    const deps = capturedToolExecutorDeps.value;
    expect(deps).not.toBeNull();
    // The lambda fetches the latest config dynamically
    mockProfileCacheManager.getChatConfig.mockReturnValue({
      ...BASE_CONFIG,
      agent: { ...BASE_CONFIG.agent, mcp_servers: [{ name: 'srv1' }, { name: 'srv2' }] },
    });
    const names = deps.getAgentMcpServerNames();
    expect(names).toEqual(['srv1', 'srv2']);
  });

  it('returns empty array when no mcp_servers', () => {
    createAgent();
    const deps = capturedToolExecutorDeps.value;
    expect(deps.getAgentMcpServerNames()).toEqual([]);
  });
});

// ── notifyContextChange delegation ───────────────────────────────────────────

describe('AgentChat - notifyContextChange (private)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to contextService.notifyContextChange', () => {
    const agent = createAgent();
    const stats = { contextHistoryTokens: 5, systemPromptTokens: 2, toolsTokens: 1, totalTokens: 8 } as any;
    (agent as any).notifyContextChange(stats);
    expect(mockNotifyContextChange).toHaveBeenCalledWith(stats);
  });
});

// ── emitStreamingChunk (private) ─────────────────────────────────────────────

describe('AgentChat - emitStreamingChunk (private)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to outputPort.emitStreamingChunk', () => {
    const agent = createAgent();
    const chunk = { type: 'text', text: 'hello' };
    (agent as any).emitStreamingChunk(chunk);
    expect(mockOutputPort.emitStreamingChunk).toHaveBeenCalledWith(chunk);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('AgentChat - destroy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls pushReceiver.destroy, clears listeners and stats, calls outputPort.clear', () => {
    const agent = createAgent();
    agent.addStatusChangeListener(vi.fn());
    agent.addContextChangeListener(vi.fn());
    agent.destroy();
    expect((agent as any).pushReceiver.destroy).toHaveBeenCalled();
    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
    expect((agent as any).latestContextStats).toBeNull();
    expect(mockOutputPort.clear).toHaveBeenCalled();
  });
});

// ── cleanupIncompleteToolCalls (private) ─────────────────────────────────────

describe('AgentChat - cleanupIncompleteToolCalls (private)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to toolExecutor.cleanupIncompleteToolCalls', async () => {
    const agent = createAgent();
    await (agent as any).cleanupIncompleteToolCalls();
    expect((agent as any).toolExecutor.cleanupIncompleteToolCalls).toHaveBeenCalled();
  });
});

// ── exitNewChatSessionState (private) ────────────────────────────────────────

describe('AgentChat - exitNewChatSessionState (private)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls agentChatManager.exitNewChatSessionFor on success path', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockReturnValue(undefined);
    (agent as any).exitNewChatSessionState();
    expect(mockAgentChatManager.exitNewChatSessionFor).toHaveBeenCalledWith('chat-d4', 'session-d4');
  });

  it('catches and swallows errors when exitNewChatSessionFor throws', () => {
    const agent = createAgent();
    mockAgentChatManager.exitNewChatSessionFor.mockImplementation(() => {
      throw new Error('manager error');
    });
    expect(() => (agent as any).exitNewChatSessionState()).not.toThrow();
  });
});

// ── getAgentInfo ──────────────────────────────────────────────────────────────

describe('AgentChat - getAgentInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no config is available', async () => {
    const agent = createAgent();
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    await expect(agent.getAgentInfo()).rejects.toThrow('Cannot get agent info');
  });

  it('returns structured agent info when config exists', async () => {
    const agent = createAgent();
    const info = await agent.getAgentInfo();
    expect(info).toMatchObject({
      name: 'Deep4Agent',
      role: 'assistant',
      emoji: '🤖',
    });
    expect(typeof info.toolsCount).toBe('number');
    expect(typeof info.chatHistoryLength).toBe('number');
  });
});

// ── addContextChangeListener / removeContextChangeListener ───────────────────

describe('AgentChat - context change listener management', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addContextChangeListener adds listener to contextChangeListeners', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).toContain(listener);
  });

  it('removeContextChangeListener removes listener from contextChangeListeners', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.removeContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).not.toContain(listener);
  });

  it('removeContextChangeListener is a no-op if listener not registered', () => {
    const agent = createAgent();
    expect(() => agent.removeContextChangeListener(vi.fn())).not.toThrow();
  });

  it('addStatusChangeListener returns disposer that removes listener', () => {
    const agent = createAgent();
    const listener = vi.fn();
    const dispose = agent.addStatusChangeListener(listener);
    dispose();
    (agent as any).setChatStatus(ChatStatus.SENDING_RESPONSE);
    expect(listener).not.toHaveBeenCalled();
  });
});
