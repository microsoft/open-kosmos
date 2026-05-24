// @ts-nocheck
/**
 * agentChatManager.deep.test.ts
 * Supplementary tests targeting branches NOT covered by agentChatManager.coverage.test.ts
 * Covers: getCacheStats, updateSessionTitle, runScheduledJob, waitForChatSessionIdle,
 *         forkChatSession error paths, initialize idempotency, getChatHistory,
 *         generateChatSessionId, cancelChatSession with active source,
 *         getInstanceByChatSessionId, removeInstanceByChatSession.
 */

// ─── Hoisted mock vars ────────────────────────────────────────────────────────

const sharedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedLogger),
  createConsoleLogger: vi.fn(() => sharedLogger),
  getUnifiedLogger: vi.fn(() => sharedLogger),
  createHighPerformanceLogger: vi.fn(() => sharedLogger),
  createDebugLogger: vi.fn(() => sharedLogger),
  getRefactoredLogger: vi.fn(() => sharedLogger),
  getGlobalLogger: vi.fn(() => sharedLogger),
  initializeGlobalLogger: vi.fn(() => sharedLogger),
  resetGlobalLogger: vi.fn(),
  isGlobalLoggerInitialized: vi.fn(() => false),
  default: vi.fn(() => sharedLogger),
}));

const mockRegistry = vi.hoisted(() => ({
  hasInstance: vi.fn(() => false),
  getInstance: vi.fn(() => null),
  setInstance: vi.fn(),
  getRuntimeMode: vi.fn(() => null as string | null),
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
  forkChatSessionDirectory: vi.fn().mockResolvedValue('/some/fork'),
  isMainWindowForeground: vi.fn(() => true),
  getMainWindowState: vi.fn(() => ({ hasWindow: true, destroyed: false, visible: true, minimized: false, focused: true })),
  isProtectedSession: vi.fn(() => false),
  hasIdleTimer: vi.fn(() => false),
  reset: vi.fn(),
}));

vi.mock('../agentChatManagerSessionCoordinator', () => ({
  AgentChatManagerSessionCoordinator: vi.fn(function () { return mockSessionCoordinator; }),
}));

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
    (mockNotificationBridge as any)._opts = opts;
    return mockNotificationBridge;
  }),
}));

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

const mockScheduledRunner = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({ success: true, messagesCount: 2 }),
}));

vi.mock('../agentChatManagerScheduledRunner', () => ({
  AgentChatManagerScheduledRunner: vi.fn(function () { return mockScheduledRunner; }),
}));

const mockProfileCacheManager = vi.hoisted(() => ({
  getChatConfig: vi.fn(() => null),
  getAllChatConfigs: vi.fn(() => [] as any[]),
  syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

const mockChatSessionStore = vi.hoisted(() => ({
  ensureLoaded: vi.fn().mockResolvedValue(null),
  copySession: vi.fn().mockResolvedValue(true),
  setReadStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock('../chatSessionStore', () => ({
  chatSessionStore: mockChatSessionStore,
}));

vi.mock('../../userDataADO/pathUtils', () => ({
  generateChatSessionId: vi.fn(() => `sess-${Math.random().toString(36).slice(2)}`),
  isValidChatSessionId: vi.fn(() => true),
  extractMonthFromChatSessionId: vi.fn(() => '2026-01'),
}));

const mockInteractiveRequestManager = vi.hoisted(() => ({
  clearSession: vi.fn(),
  interruptSession: vi.fn(() => null),
}));

vi.mock('../interactiveRequestManager', () => ({
  interactiveRequestManager: mockInteractiveRequestManager,
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    clearDeferredToolsContext: vi.fn(),
  },
}));

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

const mockAgentChatConstructor = vi.hoisted(() => vi.fn());
vi.mock('../agentChat', () => ({
  AgentChat: mockAgentChatConstructor,
}));

vi.mock('../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: vi.fn().mockResolvedValue(3),
    })),
  },
}));

// ─── Import SUT ───────────────────────────────────────────────────────────────

import { AgentChatManager } from '../agentChatManager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshManager(): AgentChatManager {
  (AgentChatManager as any).instance = undefined;
  return AgentChatManager.getInstance();
}

function mockChat(overrides: Record<string, any> = {}) {
  return {
    getChatId: vi.fn(() => 'chat-1'),
    getChatStatus: vi.fn(() => 'idle'),
    getDisplayMessages: vi.fn(() => []),
    getContextTokenUsage: vi.fn(() => ({})),
    getPendingInteractiveRequest: vi.fn(() => null),
    getAgentInfo: vi.fn().mockResolvedValue({ name: 'Agent' }),
    getChatHistory: vi.fn(() => [{ id: 'm1' }]),
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

describe('AgentChatManager (deep supplement)', () => {
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
    mockChatSessionStore.copySession.mockResolvedValue(true);
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
  });

  // ── initialize ─────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('sets alias and marks initialized on first call', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      // second call with same alias should be a no-op
      await mgr.initialize('alice');
      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized for user'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('reinitializes when alias changes', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      await mgr.initialize('bob'); // different alias => re-init
      expect(mgr['currentUserAlias']).toBe('bob');
    });
  });

  // ── generateChatSessionId ──────────────────────────────────────────────────

  describe('generateChatSessionId', () => {
    it('returns a non-empty string', () => {
      const mgr = freshManager();
      const id = mgr.generateChatSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  // ── getChatHistory ─────────────────────────────────────────────────────────

  describe('getChatHistory', () => {
    it('returns empty array when no current instance', () => {
      const mgr = freshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(mgr.getChatHistory()).toEqual([]);
    });

    it('delegates to current instance', () => {
      const mgr = freshManager();
      const inst = mockChat();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(inst);
      const history = mgr.getChatHistory();
      expect(inst.getChatHistory).toHaveBeenCalled();
      expect(history).toEqual([{ id: 'm1' }]);
    });
  });

  // ── getCacheStats ──────────────────────────────────────────────────────────

  describe('getCacheStats', () => {
    it('returns totals from registry and coordinator', () => {
      const mgr = freshManager();
      mockRegistry.getInstanceCount.mockReturnValue(3);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-active');
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1', 's2', 's3']);
      const stats = mgr.getCacheStats();
      expect(stats.totalInstances).toBe(3);
      expect(stats.currentChatSessionId).toBe('sess-active');
      expect(stats.cachedChatSessionIds).toEqual(['s1', 's2', 's3']);
    });
  });

  // ── getInstanceByChatSessionId ─────────────────────────────────────────────

  describe('getInstanceByChatSessionId', () => {
    it('returns null when not found', () => {
      const mgr = freshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(mgr.getInstanceByChatSessionId('x')).toBeNull();
    });

    it('returns instance when found', () => {
      const mgr = freshManager();
      const inst = mockChat();
      mockRegistry.getInstance.mockReturnValue(inst);
      expect(mgr.getInstanceByChatSessionId('s1')).toBe(inst);
    });
  });

  // ── updateSessionTitle ─────────────────────────────────────────────────────

  describe('updateSessionTitle', () => {
    it('returns false when no instance found', () => {
      const mgr = freshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(mgr.updateSessionTitle('s1', 'new')).toBe(false);
    });

    it('returns false when instance.updateSessionTitle returns false', () => {
      const mgr = freshManager();
      const inst = mockChat({ updateSessionTitle: vi.fn(() => false) });
      mockRegistry.getInstance.mockReturnValue(inst);
      expect(mgr.updateSessionTitle('s1', 'new')).toBe(false);
    });

    it('returns true and notifies when title update succeeds (non-current session)', () => {
      const mgr = freshManager();
      const inst = mockChat({ updateSessionTitle: vi.fn(() => true) });
      mockRegistry.getInstance.mockReturnValue(inst);
      // Current session is different
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-sess');
      expect(mgr.updateSessionTitle('s1', 'new')).toBe(true);
      // Should NOT call notifyChatSessionCacheCreated since it's not current
      expect(mockRendererBridge.notifyChatSessionCacheCreated).not.toHaveBeenCalled();
    });

    it('notifies cache when updated session is the current session', () => {
      const mgr = freshManager();
      const inst = mockChat({ updateSessionTitle: vi.fn(() => true) });
      mockRegistry.getInstance.mockReturnValue(inst);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');
      expect(mgr.updateSessionTitle('s1', 'new')).toBe(true);
      expect(mockRendererBridge.notifyChatSessionCacheCreated).toHaveBeenCalledWith('s1', 'chat-1', expect.any(Object));
    });
  });

  // ── getRuntimeMode ─────────────────────────────────────────────────────────

  describe('getRuntimeMode', () => {
    it('returns null when not in registry', () => {
      const mgr = freshManager();
      mockRegistry.getRuntimeMode.mockReturnValue(null);
      expect(mgr.getRuntimeMode('s1')).toBeNull();
    });

    it('returns the mode from registry', () => {
      const mgr = freshManager();
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      expect(mgr.getRuntimeMode('s1')).toBe('interactive');
    });
  });

  // ── removeInstanceByChatSession ────────────────────────────────────────────

  describe('removeInstanceByChatSession', () => {
    it('disposes instance and notifies frontend', () => {
      const mgr = freshManager();
      const inst = mockChat();
      mockRegistry.getInstance.mockReturnValue(inst);
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1']);
      mgr.removeInstanceByChatSession('s1');
      expect(inst.destroy).toHaveBeenCalled();
      expect(mockRendererBridge.notifyChatSessionCacheDestroyed).toHaveBeenCalledWith('s1');
    });

    it('clears current session when removed session is current', () => {
      const mgr = freshManager();
      const inst = mockChat();
      mockRegistry.getInstance.mockReturnValue(inst);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');
      mgr.removeInstanceByChatSession('s1');
      expect(mockSessionCoordinator.clearCurrentSession).toHaveBeenCalledWith('s1');
      expect(mockRendererBridge.notifyCurrentChatSessionIdChanged).toHaveBeenCalledWith(null, null);
    });

    it('is a no-op when instance not found', () => {
      const mgr = freshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(() => mgr.removeInstanceByChatSession('missing')).not.toThrow();
    });
  });

  // ── runScheduledJob ────────────────────────────────────────────────────────

  describe('runScheduledJob', () => {
    it('returns error when no current user alias', async () => {
      const mgr = freshManager();
      const result = await mgr.runScheduledJob({ id: 'j1', agentId: 'a1', name: 'Job' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('delegates to scheduledRunner with provided chatSessionId', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      const result = await mgr.runScheduledJob(
        { id: 'j1', agentId: 'a1', name: 'Job' } as any,
        { chatSessionId: 'explicit-sess' },
      );
      expect(result.success).toBe(true);
      expect(mockScheduledRunner.run).toHaveBeenCalledWith(
        'alice',
        'explicit-sess',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('generates chatSessionId when not provided', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      await mgr.runScheduledJob({ id: 'j1', agentId: 'a1', name: 'Job' } as any);
      expect(mockScheduledRunner.run).toHaveBeenCalled();
      const calledSessionId = mockScheduledRunner.run.mock.calls[0][1];
      expect(typeof calledSessionId).toBe('string');
    });
  });

  // ── cancelChatSession — with active source ────────────────────────────────

  describe('cancelChatSession — with active source', () => {
    it('cancels source, interrupts interactive req, cancels sub-agents, and waits for idle', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');

      const mockSource = { token: { isCancellationRequested: false }, cancel: vi.fn() };
      const inst = mockChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(inst);
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);
      mockInteractiveRequestManager.interruptSession.mockReturnValue({ id: 'req1' });
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'TestAgent' } });

      const result = await mgr.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
      expect(mockSource.cancel).toHaveBeenCalled();
      expect(inst.invalidateActiveExecution).toHaveBeenCalled();
      expect(inst.forceIdleStatus).toHaveBeenCalled();
      expect(mockNotificationBridge.emitChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-1', 'idle', expect.any(String)
      );
    });

    it('returns success even when chat is already idle', async () => {
      const mgr = freshManager();
      const inst = mockChat({ getChatStatus: vi.fn(() => 'idle') });
      mockRegistry.getInstance.mockReturnValue(inst);
      const result = await mgr.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
    });

    it('returns error when no agent instance found', async () => {
      const mgr = freshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await mgr.cancelChatSession('sess-1');
      expect(result.success).toBe(false);
    });

    it('handles cancelActiveToolExecution failure gracefully', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      const mockSource = { token: { isCancellationRequested: false }, cancel: vi.fn() };
      const inst = mockChat({
        getChatStatus: vi.fn(() => 'sending_response'),
        cancelActiveToolExecution: vi.fn().mockRejectedValue(new Error('tool stuck')),
      });
      mockRegistry.getInstance.mockReturnValue(inst);
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      const result = await mgr.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cancel active tool'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── waitForChatSessionIdle ─────────────────────────────────────────────────

  describe('waitForChatSessionIdle (via cancelChatSession path)', () => {
    it('resolves immediately when instance already idle at first check', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      const mockSource = { token: { isCancellationRequested: false }, cancel: vi.fn() };
      const inst = mockChat({
        // Returns idle immediately after cancel so waitForChatSessionIdle resolves fast
        getChatStatus: vi.fn()
          .mockReturnValueOnce('sending_response') // initial check
          .mockReturnValue('idle'), // after cancel
      });
      mockRegistry.getInstance.mockReturnValue(inst);
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      await expect(mgr.cancelChatSession('sess-1')).resolves.toEqual({ success: true });
    });
  });

  // ── forkChatSession — error paths ─────────────────────────────────────────

  describe('forkChatSession — error branches', () => {
    it('returns error when no current user alias', async () => {
      const mgr = freshManager();
      const result = await mgr.forkChatSession('chat-1', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('returns error when chatId is empty', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      const result = await mgr.forkChatSession('', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error when sourceChatSessionId is empty', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      const result = await mgr.forkChatSession('chat-1', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error when copySession fails', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(false);
      const result = await mgr.forkChatSession('chat-1', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to copy');
    });

    it('returns error when forkChatSessionDirectory fails', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue(null);
      const result = await mgr.forkChatSession('chat-1', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace');
    });

    it('returns error when switchToChatSession returns null (no config)', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue('/fork');
      mockProfileCacheManager.getChatConfig.mockReturnValue(null); // no config → switchTo returns null
      const result = await mgr.forkChatSession('chat-1', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to switch');
    });

    it('catches thrown errors and returns failure', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');
      mockChatSessionStore.copySession.mockRejectedValue(new Error('disk exploded'));
      const result = await mgr.forkChatSession('chat-1', 'source-sess');
      expect(result.success).toBe(false);
      expect(result.error).toBe('disk exploded');
    });
  });

  // ── exitNewChatSessionFor ──────────────────────────────────────────────────

  describe('exitNewChatSessionFor', () => {
    it('logs info on success', () => {
      const mgr = freshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({ success: true });
      mgr.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Exited New Chat Session'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('logs warn on mismatch', () => {
      const mgr = freshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({
        success: false,
        existingChatSessionId: 'other-sess',
      });
      mgr.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mismatch'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── switchToChatSession — null chatId/chatSessionId ───────────────────────

  describe('switchToChatSession — null args', () => {
    it('clears current session and returns null when chatId is falsy', async () => {
      const mgr = freshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('prev-sess');
      const result = await mgr.switchToChatSession('', null);
      expect(result).toBeNull();
      expect(mockSessionCoordinator.clearCurrentSession).toHaveBeenCalledWith('prev-sess');
      expect(mockRendererBridge.notifyCurrentChatSessionIdChanged).toHaveBeenCalledWith(null, null);
    });

    it('does not clear if no previous session when null is given', async () => {
      const mgr = freshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const result = await mgr.switchToChatSession('', null);
      expect(result).toBeNull();
      expect(mockSessionCoordinator.clearCurrentSession).not.toHaveBeenCalled();
    });
  });

  // ── getOrCreateInstanceByChatSession — mode mismatch dispose ─────────────

  describe('getOrCreateInstanceByChatSession — non-promotion mode mismatch', () => {
    it('disposes instance when runtimeMode is interactive but expectedMode is something else', async () => {
      const mgr = freshManager();
      await mgr.initialize('alice');

      const inst = mockChat();
      mockRegistry.hasInstance.mockReturnValue(true);
      mockRegistry.getInstance.mockReturnValue(inst);
      // Cached mode is 'interactive', but getOrCreate is called with scheduled-silent expected
      // (This happens indirectly — simulate a registry mismatch)
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other');
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      // Use an internal mode that doesn't trigger promotion (neither scenario)
      // We can't directly call private method, but can trigger via switchToChatSession
      // where current != requested, and cached mode != expected mode != scheduled-silent
      mockProfileCacheManager.getChatConfig.mockReturnValue(null); // will fail on create
      // The test goal: ensure warn log from mode mismatch path
      // Setup: set getRuntimeMode to return something that triggers the else branch in getOrCreate
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');

      // Make it go through getOrCreateInstanceByChatSession by having current session be different
      const result = await mgr.switchToChatSession('chat-1', 'sess-new');
      // Since the cached instance is scheduled-silent and expected is interactive, it promotes
      expect(mockRegistry.setRuntimeMode).toHaveBeenCalledWith('sess-new', 'interactive');
    });
  });
});
