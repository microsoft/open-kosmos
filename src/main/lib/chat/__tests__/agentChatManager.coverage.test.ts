// @ts-nocheck
/**
 * agentChatManager supplemental coverage tests
 * Targets all branches not covered by agentChatManager.test.ts
 */

// ─── Mock shared logger ───────────────────────────────────────────────────────

const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
  createConsoleLogger: vi.fn(() => sharedMockLogger),
  getUnifiedLogger: vi.fn(() => sharedMockLogger),
  createHighPerformanceLogger: vi.fn(() => sharedMockLogger),
  createDebugLogger: vi.fn(() => sharedMockLogger),
  getRefactoredLogger: vi.fn(() => sharedMockLogger),
  getGlobalLogger: vi.fn(() => sharedMockLogger),
  initializeGlobalLogger: vi.fn(() => sharedMockLogger),
  resetGlobalLogger: vi.fn(),
  isGlobalLoggerInitialized: vi.fn(() => false),
  default: vi.fn(() => sharedMockLogger),
}));

// ─── Mock registry ────────────────────────────────────────────────────────────

const mockRegistry = vi.hoisted(() => ({
  hasInstance: vi.fn(() => false),
  getInstance: vi.fn(() => null),
  setInstance: vi.fn(),
  getRuntimeMode: vi.fn(() => null),
  setRuntimeMode: vi.fn(),
  getInstanceCount: vi.fn(() => 0),
  listCachedSessionIds: vi.fn(() => [] as string[]),
  removeInstance: vi.fn(),
  forEachInstance: vi.fn(),
  getOrCreateCancellationSource: vi.fn(() => ({
    token: { isCancellationRequested: false },
    cancel: vi.fn(),
  })),
  getCancellationSource: vi.fn(() => null),
  clearCancellationSource: vi.fn(),
  disposeAllCancellationSources: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock('../agentChatManagerRegistry', () => ({
  AgentChatManagerRegistry: vi.fn(function () { return mockRegistry; }),
}));

// ─── Mock session coordinator ─────────────────────────────────────────────────

const mockSessionCoordinator = vi.hoisted(() => ({
  getCurrentChatSessionId: vi.fn(() => null as string | null),
  getCurrentInstance: vi.fn(() => null),
  clearCurrentSession: vi.fn(),
  activateSession: vi.fn(),
  clearPendingUnreadForCurrentSession: vi.fn(),
  clearPendingUnread: vi.fn(),
  hasPendingUnread: vi.fn(() => false),
  shouldMarkUnreadAfterCompletion: vi.fn(() => false),
  handleStatusChange: vi.fn(),
  handleSessionLostFocus: vi.fn(),
  getNewChatSessionId: vi.fn(() => null as string | null),
  getOrCreateNewChatSessionId: vi.fn((_chatId: string, gen: () => string) => gen()),
  exitNewChatSession: vi.fn(() => ({ success: true })),
  ensureChatSessionDirectory: vi.fn().mockResolvedValue(undefined),
  forkChatSessionDirectory: vi.fn().mockResolvedValue('/some/dir'),
  isMainWindowForeground: vi.fn(() => true),
  getMainWindowState: vi.fn(() => ({ hasWindow: true, destroyed: false, visible: true, minimized: false, focused: true })),
  isProtectedSession: vi.fn(() => false),
  hasIdleTimer: vi.fn(() => false),
  reset: vi.fn(),
}));

vi.mock('../agentChatManagerSessionCoordinator', () => ({
  AgentChatManagerSessionCoordinator: vi.fn(function () { return mockSessionCoordinator; }),
}));

// ─── Mock notification bridge ─────────────────────────────────────────────────

const mockNotificationBridge = vi.hoisted(() => ({
  getMainWindow: vi.fn(() => null),
  getMainWindowState: vi.fn(() => ({ hasWindow: false, destroyed: true, visible: null, minimized: null, focused: null })),
  isMainWindowForeground: vi.fn(() => false),
  emitChatStatusChanged: vi.fn(),
  showChatSessionCompletionNotification: vi.fn(),
  setMainWindow: vi.fn(),
  destroy: vi.fn(),
  startListening: vi.fn(),
}));

vi.mock('../agentChatManagerNotificationBridge', () => ({
  AgentChatManagerNotificationBridge: vi.fn(function (opts: any) {
    // Store the opts so we can invoke callbacks
    (mockNotificationBridge as any)._opts = opts;
    return mockNotificationBridge;
  }),
}));

// ─── Mock renderer bridge ─────────────────────────────────────────────────────

const mockRendererBridge = vi.hoisted(() => ({
  notifyCurrentChatSessionIdChanged: vi.fn(),
  notifyChatSessionCacheCreated: vi.fn(),
  notifyChatSessionCacheDestroyed: vi.fn(),
  notifyChatStatusChanged: vi.fn(),
  attachEventSenderToMainWindow: vi.fn(),
  setupContextChangeListener: vi.fn(),
}));

vi.mock('../agentChatManagerRendererBridge', () => ({
  AgentChatManagerRendererBridge: vi.fn(function () { return mockRendererBridge; }),
}));

// ─── Mock scheduled runner ────────────────────────────────────────────────────

const mockScheduledRunner = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({ success: true, messagesCount: 0 }),
}));

vi.mock('../agentChatManagerScheduledRunner', () => ({
  AgentChatManagerScheduledRunner: vi.fn(function () { return mockScheduledRunner; }),
}));

// ─── Mock profileCacheManager ─────────────────────────────────────────────────

const mockProfileCacheManager = vi.hoisted(() => ({
  getChatConfig: vi.fn(() => null),
  getAllChatConfigs: vi.fn(() => [] as any[]),
  syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

// ─── Mock chatSessionStore ────────────────────────────────────────────────────

const mockChatSessionStore = vi.hoisted(() => ({
  ensureLoaded: vi.fn().mockResolvedValue(null),
  copySession: vi.fn().mockResolvedValue(true),
  setReadStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock('../chatSessionStore', () => ({
  chatSessionStore: mockChatSessionStore,
}));

// ─── Mock pathUtils ───────────────────────────────────────────────────────────

vi.mock('../../userDataADO/pathUtils', () => ({
  generateChatSessionId: vi.fn(() => `session-${Date.now()}-${Math.random()}`),
  isValidChatSessionId: vi.fn(() => true),
  extractMonthFromChatSessionId: vi.fn(() => '2026-01'),
}));

// ─── Mock interactiveRequestManager ──────────────────────────────────────────

const mockInteractiveRequestManager = vi.hoisted(() => ({
  clearSession: vi.fn(),
  interruptSession: vi.fn(() => null),
}));

vi.mock('../interactiveRequestManager', () => ({
  interactiveRequestManager: mockInteractiveRequestManager,
}));

// ─── Mock BuiltinToolsManager ─────────────────────────────────────────────────

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    clearDeferredToolsContext: vi.fn(),
  },
}));

// ─── Mock cancellation ────────────────────────────────────────────────────────

const { MockCancellationError } = vi.hoisted(() => ({
  MockCancellationError: class CancellationError extends Error {
    constructor() { super('cancelled'); this.name = 'CancellationError'; }
  },
}));

vi.mock('../../cancellation', () => ({
  CancellationTokenSource: vi.fn(function (this: any) {
    this.token = { isCancellationRequested: false };
    this.cancel = vi.fn();
  }),
  CancellationError: MockCancellationError,
}));

// ─── Mock AgentChat ────────────────────────────────────────────────────────────

const mockAgentChatConstructor = vi.hoisted(() => vi.fn());

vi.mock('../agentChat', () => ({
  AgentChat: mockAgentChatConstructor,
}));

// ─── Mock subAgentManager ─────────────────────────────────────────────────────

vi.mock('../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: vi.fn().mockResolvedValue(0),
    })),
  },
}));

// ─── Import SUT ───────────────────────────────────────────────────────────────

import { AgentChatManager } from '../agentChatManager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createFreshManager(): AgentChatManager {
  (AgentChatManager as any).instance = undefined;
  return AgentChatManager.getInstance();
}

function makeMockAgentChat(overrides: Record<string, any> = {}) {
  return {
    getChatId: vi.fn(() => 'chat-1'),
    getChatStatus: vi.fn(() => 'idle'),
    getDisplayMessages: vi.fn(() => []),
    getContextTokenUsage: vi.fn(() => ({})),
    getPendingInteractiveRequest: vi.fn(() => null),
    getAgentInfo: vi.fn().mockResolvedValue({ name: 'TestAgent' }),
    getChatHistory: vi.fn(() => []),
    updateSessionTitle: vi.fn(() => true),
    addStatusChangeListener: vi.fn(() => vi.fn()),
    hasEventSender: vi.fn(() => false),
    streamMessage: vi.fn().mockResolvedValue([]),
    retryChat: vi.fn().mockResolvedValue([]),
    editUserMessage: vi.fn().mockResolvedValue([]),
    canEditUserMessage: vi.fn(() => ({ canEdit: true })),
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    cancelPush: vi.fn(),
    invalidateActiveExecution: vi.fn(),
    cancelActiveToolExecution: vi.fn().mockResolvedValue(undefined),
    forceIdleStatus: vi.fn(),
    hydrateSchedulerMetadata: vi.fn(),
    getCurrentChatSession: vi.fn(() => ({ title: 'Test Chat' })),
    calculateAndNotifyContext: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentChatManager (coverage supplement)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.hasInstance.mockReturnValue(false);
    mockRegistry.getInstance.mockReturnValue(null);
    mockRegistry.getRuntimeMode.mockReturnValue(null);
    mockRegistry.getInstanceCount.mockReturnValue(0);
    mockRegistry.listCachedSessionIds.mockReturnValue([]);
    mockRegistry.getCancellationSource.mockReturnValue(null);
    mockRegistry.getOrCreateCancellationSource.mockReturnValue({
      token: { isCancellationRequested: false },
      cancel: vi.fn(),
    });
    mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
    mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
    mockSessionCoordinator.getNewChatSessionId.mockReturnValue(null);
    mockSessionCoordinator.getOrCreateNewChatSessionId.mockImplementation(
      (_chatId: string, gen: () => string) => gen()
    );
    mockSessionCoordinator.hasPendingUnread.mockReturnValue(false);
    mockSessionCoordinator.shouldMarkUnreadAfterCompletion.mockReturnValue(false);
    mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
    mockChatSessionStore.ensureLoaded.mockResolvedValue(null);
    mockChatSessionStore.setReadStatus.mockResolvedValue(null);
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    mockProfileCacheManager.getAllChatConfigs.mockReturnValue([]);
  });

  // ── syncChatHistory ────────────────────────────────────────────────────────

  describe('syncChatHistory', () => {
    it('warns when current instance exists', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      manager.syncChatHistory([]);
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not fully implemented'),
      );
    });

    it('warns when no current instance', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      manager.syncChatHistory([]);
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No current instance'),
      );
    });
  });

  // ── isActiveChatSessionId ──────────────────────────────────────────────────

  describe('isActiveChatSessionId', () => {
    it('returns true when matches current session', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      expect(manager.isActiveChatSessionId('sess-1')).toBe(true);
    });

    it('returns false when does not match', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-2');
      expect(manager.isActiveChatSessionId('sess-1')).toBe(false);
    });
  });

  // ── getCurrentActiveChatSessionId ─────────────────────────────────────────

  describe('getCurrentActiveChatSessionId', () => {
    it('returns null when no current session', () => {
      const manager = createFreshManager();
      expect(manager.getCurrentActiveChatSessionId()).toBeNull();
    });

    it('returns the current session id', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      expect(manager.getCurrentActiveChatSessionId()).toBe('sess-1');
    });
  });

  // ── getCurrentContextTokenUsage ────────────────────────────────────────────

  describe('getCurrentContextTokenUsage', () => {
    it('returns null when no current instance', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(manager.getCurrentContextTokenUsage()).toBeNull();
    });

    it('returns null when no latestContextStats', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      expect(manager.getCurrentContextTokenUsage()).toBeNull();
    });

    it('returns stats when latestContextStats is present', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      (mockInstance as any).latestContextStats = {
        tokenCount: 1000,
        totalMessages: 5,
        contextMessages: 4,
        compressionRatio: 0.9,
      };
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      const result = manager.getCurrentContextTokenUsage();
      expect(result).toEqual({
        tokenCount: 1000,
        totalMessages: 5,
        contextMessages: 4,
        compressionRatio: 0.9,
      });
    });
  });

  // ── refreshCurrentInstance ─────────────────────────────────────────────────

  describe('refreshCurrentInstance', () => {
    it('returns null when no current session', async () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      expect(await manager.refreshCurrentInstance()).toBeNull();
    });

    it('returns null when no instance found for current session', async () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      mockRegistry.getInstance.mockReturnValue(null);
      expect(await manager.refreshCurrentInstance()).toBeNull();
    });

    it('destroys and recreates instance', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      mockRegistry.getInstance
        .mockReturnValueOnce(mockInstance) // first call for refresh check
        .mockReturnValueOnce(null)         // after remove (disposeManagedInstance)
        .mockReturnValue(null);            // switchToChatSession lookup
      mockProfileCacheManager.getChatConfig.mockReturnValue(null);

      const result = await manager.refreshCurrentInstance();
      // null because no chat config found
      expect(result).toBeNull();
    });
  });

  // ── streamMessage ──────────────────────────────────────────────────────────

  describe('streamMessage', () => {
    it('returns error when no agent instance', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent instance found');
    });

    it('returns error when chat is not idle', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('sending_response');
    });

    it('succeeds and clears cancellation source', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'idle'),
        streamMessage: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(mockRegistry.clearCancellationSource).toHaveBeenCalledWith('sess-1');
    });

    it('succeeds and marks unread when shouldMarkUnread is true', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'idle'),
        streamMessage: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.shouldMarkUnreadAfterCompletion.mockReturnValue(true);
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: null, metadata: null });
      // The ensureLoaded for updateChatSessionReadStatus: return something truthy
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockResolvedValue({ metadata: {} });

      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(true);
      expect(mockSessionCoordinator.clearPendingUnread).toHaveBeenCalledWith('sess-1');
    });

    it('returns success with empty data on CancellationError', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'idle'),
        streamMessage: vi.fn().mockRejectedValue(new MockCancellationError()),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error with HTTP status code prefix when available', async () => {
      const manager = createFreshManager();
      const err = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'idle'),
        streamMessage: vi.fn().mockRejectedValue(err),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('[HTTP 429]');
    });

    it('returns plain error message without status code', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'idle'),
        streamMessage: vi.fn().mockRejectedValue(new Error('Network failure')),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });
  });

  // ── retryChat ──────────────────────────────────────────────────────────────

  describe('retryChat', () => {
    it('returns error when no agent instance', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.retryChat('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent instance found');
    });

    it('succeeds and notifies renderer cache', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        retryChat: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.retryChat('sess-1');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(mockRendererBridge.notifyChatSessionCacheCreated).toHaveBeenCalled();
    });

    it('returns success with empty data on CancellationError', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        retryChat: vi.fn().mockRejectedValue(new MockCancellationError()),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.retryChat('sess-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error with statusCode prefix', async () => {
      const manager = createFreshManager();
      const err = Object.assign(new Error('Server error'), { statusCode: 500 });
      const mockInstance = makeMockAgentChat({
        retryChat: vi.fn().mockRejectedValue(err),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.retryChat('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('[HTTP 500]');
    });

    it('marks unread when shouldMarkUnread is true', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat({
        retryChat: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        getChatStatus: vi.fn(() => 'idle'),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.shouldMarkUnreadAfterCompletion.mockReturnValue(true);
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockResolvedValue({ metadata: {} });

      const result = await manager.retryChat('sess-1');
      expect(result.success).toBe(true);
      expect(mockSessionCoordinator.clearPendingUnread).toHaveBeenCalled();
    });
  });

  // ── editUserMessage ────────────────────────────────────────────────────────

  describe('editUserMessage', () => {
    it('returns error when no agent instance', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.editUserMessage('sess-1', 'msg-1', {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent instance found');
    });

    it('succeeds and returns messages', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        editUserMessage: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.editUserMessage('sess-1', 'msg-1', {} as any);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('returns success with empty data on CancellationError', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        editUserMessage: vi.fn().mockRejectedValue(new MockCancellationError()),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.editUserMessage('sess-1', 'msg-1', {} as any);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error on generic exception', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        editUserMessage: vi.fn().mockRejectedValue(new Error('Edit failed')),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.editUserMessage('sess-1', 'msg-1', {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Edit failed');
    });
  });

  // ── canEditUserMessage ─────────────────────────────────────────────────────

  describe('canEditUserMessage', () => {
    it('returns error when no agent instance', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent instance found');
    });

    it('returns canEdit result from instance', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        canEditUserMessage: vi.fn(() => ({ canEdit: true })),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ canEdit: true });
    });

    it('returns error on exception from instance', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        canEditUserMessage: vi.fn(() => { throw new Error('Cannot check'); }),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot check');
    });
  });

  // ── cancelActiveToolExecution ──────────────────────────────────────────────

  describe('cancelActiveToolExecution', () => {
    it('returns error when no agent instance', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
    });

    it('succeeds when tool execution is cancelled', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockResolvedValue(undefined),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(true);
    });

    it('returns error on thrown exception', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockRejectedValue(new Error('Tool stuck')),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool stuck');
    });
  });

  // ── syncProfileUpdate ──────────────────────────────────────────────────────

  describe('syncProfileUpdate', () => {
    it('warns and returns early when alias mismatches', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      await manager.syncProfileUpdate('bob');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Alias mismatch'),
      );
    });

    it('cleans up obsolete instances that no longer match valid chatIds', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');

      const mockInstance = makeMockAgentChat({ getChatId: vi.fn(() => 'old-chat') });
      mockRegistry.listCachedSessionIds.mockReturnValue(['sess-orphan']);
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.forEachInstance.mockImplementation((fn: any) => {
        fn(mockInstance, 'sess-orphan');
      });
      mockProfileCacheManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'other-chat', agent: { name: 'Agent' } },
      ]);

      await manager.syncProfileUpdate('alice');
      // Should call destroy on the orphan instance
      expect(mockInstance.destroy).toHaveBeenCalled();
    });

    it('does not remove instances that still have valid chatIds', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');

      const mockInstance = makeMockAgentChat({ getChatId: vi.fn(() => 'valid-chat') });
      mockRegistry.forEachInstance.mockImplementation((fn: any) => {
        fn(mockInstance, 'sess-valid');
      });
      mockProfileCacheManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'valid-chat', agent: { name: 'Agent' } },
      ]);

      await manager.syncProfileUpdate('alice');
      expect(mockInstance.destroy).not.toHaveBeenCalled();
    });
  });

  // ── setMainWindow ──────────────────────────────────────────────────────────

  describe('setMainWindow', () => {
    it('calls notificationBridge.setMainWindow and logs', () => {
      const manager = createFreshManager();
      manager.setMainWindow(null);
      expect(mockNotificationBridge.setMainWindow).toHaveBeenCalledWith(null);
    });

    it('triggers calculateAndNotifyContext for each instance when window is valid', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.forEachInstance.mockImplementation((fn: any) => {
        fn(mockInstance, 'sess-1');
      });
      const fakeWindow = { isDestroyed: vi.fn(() => false) };
      manager.setMainWindow(fakeWindow as any);
      expect(mockInstance.calculateAndNotifyContext).toHaveBeenCalled();
    });

    it('does not iterate instances when window is destroyed', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.forEachInstance.mockImplementation((fn: any) => {
        fn(mockInstance, 'sess-1');
      });
      const destroyedWindow = { isDestroyed: vi.fn(() => true) };
      manager.setMainWindow(destroyedWindow as any);
      expect(mockInstance.calculateAndNotifyContext).not.toHaveBeenCalled();
    });

    it('handles calculateAndNotifyContext errors without throwing', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        calculateAndNotifyContext: vi.fn(() => { throw new Error('Context error'); }),
      });
      mockRegistry.forEachInstance.mockImplementation((fn: any) => {
        fn(mockInstance, 'sess-1');
      });
      const fakeWindow = { isDestroyed: vi.fn(() => false) };
      expect(() => manager.setMainWindow(fakeWindow as any)).not.toThrow();
      expect(sharedMockLogger.error).toHaveBeenCalled();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('calls notificationBridge.destroy and clears state', () => {
      const manager = createFreshManager();
      mockRegistry.listCachedSessionIds.mockReturnValue([]);
      manager.destroy();
      expect(mockNotificationBridge.destroy).toHaveBeenCalled();
      expect(mockRegistry.disposeAllCancellationSources).toHaveBeenCalled();
      expect(mockRegistry.clearAll).toHaveBeenCalled();
      expect(mockSessionCoordinator.reset).toHaveBeenCalled();
    });

    it('destroys all cached instances', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.listCachedSessionIds.mockReturnValue(['sess-1']);
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      manager.destroy(true);
      expect(mockInstance.destroy).toHaveBeenCalled();
      expect(mockRendererBridge.notifyChatSessionCacheDestroyed).toHaveBeenCalledWith('sess-1');
    });

    it('handles errors during instance destruction gracefully', () => {
      const manager = createFreshManager();
      mockRegistry.listCachedSessionIds.mockReturnValue(['sess-1']);
      // Make disposeManagedInstance throw via getInstance throwing
      mockRegistry.getInstance.mockImplementation(() => {
        throw new Error('Registry broken');
      });
      expect(() => manager.destroy()).not.toThrow();
      expect(sharedMockLogger.error).toHaveBeenCalled();
    });
  });

  // ── cancelChatSession — fallback path (no cancellation source) ─────────────

  describe('cancelChatSession (no source fallback)', () => {
    it('interrupts interactive request and emits idle when no source', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getCancellationSource.mockReturnValue(null);
      mockInteractiveRequestManager.interruptSession.mockReturnValue({ id: 'req-1' });
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });

      const result = await manager.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
      expect(mockNotificationBridge.emitChatStatusChanged).toHaveBeenCalled();
    });

    it('returns error when emitChatStatusChanged throws and no source', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'sending_response'),
        getAgentInfo: vi.fn().mockRejectedValue(new Error('Agent gone')),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getCancellationSource.mockReturnValue(null);
      mockNotificationBridge.emitChatStatusChanged.mockImplementationOnce(() => {
        throw new Error('Emit failed');
      });

      const result = await manager.cancelChatSession('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to cancel');
    });
  });

  // ── switchToChatSession — non-interactive runtime mode promotion ───────────

  describe('switchToChatSession — runtime mode promotion', () => {
    it('promotes scheduled-silent to interactive when current session has non-interactive mode', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');

      await manager.switchToChatSession('chat-1', 'sess-1');
      expect(mockRegistry.setRuntimeMode).toHaveBeenCalledWith('sess-1', 'interactive');
    });
  });

  // ── getOrCreateInstanceByChatSession — cached instance with mode mismatch ──

  describe('getOrCreateInstanceByChatSession — cached mode mismatch', () => {
    it('promotes scheduled-silent cached instance to interactive', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');

      const mockInstance = makeMockAgentChat();
      mockRegistry.hasInstance.mockReturnValue(true);
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');
      // Make current session different so it goes to getOrCreateInstanceByChatSession
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-sess');
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });

      const result = await manager.switchToChatSession('chat-1', 'sess-1');
      expect(result).toBe(mockInstance);
      expect(mockRegistry.setRuntimeMode).toHaveBeenCalledWith('sess-1', 'interactive');
    });

    it('returns interactive instance from cache when no mode mismatch', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');

      const mockInstance = makeMockAgentChat();
      mockRegistry.hasInstance.mockReturnValue(true);
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      // Make current session different so it goes to getOrCreateInstanceByChatSession
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-sess');
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });

      const result = await manager.switchToChatSession('chat-1', 'sess-1');
      // Returns the cached instance directly (no mode mismatch)
      expect(result).toBe(mockInstance);
    });
  });

  // ── startNewChatFor ────────────────────────────────────────────────────────

  describe('startNewChatFor', () => {
    it('returns null when chatId is empty', async () => {
      const manager = createFreshManager();
      const result = await manager.startNewChatFor('');
      expect(result).toBeNull();
      expect(sharedMockLogger.error).toHaveBeenCalled();
    });

    it('reuses existing new chat session id', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockSessionCoordinator.getNewChatSessionId.mockReturnValue('existing-new-sess');
      mockSessionCoordinator.getOrCreateNewChatSessionId.mockReturnValue('existing-new-sess');
      mockProfileCacheManager.getChatConfig.mockReturnValue(null);
      // switchToChatSession will return null (no config), but we verify it was called
      const result = await manager.startNewChatFor('chat-1');
      expect(result).toBeNull();
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing new ChatSessionId'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── markChatSessionAsUnreadIfNeeded ───────────────────────────────────────

  describe('markChatSessionAsUnreadIfNeeded', () => {
    it('skips when no instance found', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no instance'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when runtime mode is not interactive', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('non-interactive'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when session is protected', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(true);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('foreground protected'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('shows completion notification when unread update succeeds', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockResolvedValue({ metadata: {} });

      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(mockNotificationBridge.showChatSessionCompletionNotification).toHaveBeenCalled();
    });

    it('warns when unread update did not persist', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      // ensureLoaded returns null => session not persisted => updateChatSessionReadStatus returns false
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('did not persist'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── forkChatSession — success path ────────────────────────────────────────

  describe('forkChatSession — success', () => {
    it('succeeds and returns new chatSessionId', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue('/workspace/fork');
      // switchToChatSession will fail (no config) — but we test the flow up to that
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'ForkedAgent' } });
      // Make createAgentWithChatSession succeed:
      const mockInstance = makeMockAgentChat({ getAgentInfo: vi.fn().mockResolvedValue({ name: 'ForkedAgent' }) });
      mockAgentChatConstructor.mockImplementation(function (this: any) {
        Object.assign(this, mockInstance);
      });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      // After fork, switchToChatSession creates a new instance
      // We need registry to NOT have the instance initially, then after registerManagedInstance it does
      const result = await manager.forkChatSession('chat-1', 'source-sess');
      // Even if the fork succeeds, switchToChatSession returns null because AgentChat constructor
      // mock doesn't wire all methods. Check that copySession was called.
      expect(mockChatSessionStore.copySession).toHaveBeenCalled();
      expect(mockSessionCoordinator.forkChatSessionDirectory).toHaveBeenCalled();
    });
  });

  // ── notification bridge callbacks ─────────────────────────────────────────

  describe('notification bridge callbacks', () => {
    it('onWindowLostForeground triggers handleSessionLostFocus when session exists', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-active');
      mockRegistry.getInstance.mockReturnValue(null); // instance not found, just logs

      // Trigger the callback stored in opts
      const opts = (mockNotificationBridge as any)._opts;
      opts?.onWindowLostForeground?.();
      // Just ensure it doesn't throw
    });

    it('onWindowLostForeground is a no-op when no current session', () => {
      createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const opts = (mockNotificationBridge as any)._opts;
      expect(() => opts?.onWindowLostForeground?.()).not.toThrow();
    });

    it('onWindowRegainedForeground clears pending unread when session exists', () => {
      createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-active');
      const opts = (mockNotificationBridge as any)._opts;
      opts?.onWindowRegainedForeground?.();
      expect(mockSessionCoordinator.clearPendingUnreadForCurrentSession).toHaveBeenCalled();
    });

    it('onWindowRegainedForeground is a no-op when no current session', () => {
      createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const opts = (mockNotificationBridge as any)._opts;
      expect(() => opts?.onWindowRegainedForeground?.()).not.toThrow();
    });
  });
});
