// @ts-nocheck
/**
 * agentChatManager deeper coverage — targets branches not covered by
 * agentChatManager.coverage.test.ts
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
}));

// ─── Mock registry ────────────────────────────────────────────────────────────

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
  forkChatSessionDirectory: vi.fn().mockResolvedValue('/forked/dir'),
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
  run: vi.fn().mockResolvedValue({ success: true, messagesCount: 2 }),
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

describe('AgentChatManager (deeper coverage)', () => {
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
      (_chatId: string, gen: () => string) => gen(),
    );
    mockSessionCoordinator.hasPendingUnread.mockReturnValue(false);
    mockSessionCoordinator.shouldMarkUnreadAfterCompletion.mockReturnValue(false);
    mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
    mockChatSessionStore.ensureLoaded.mockResolvedValue(null);
    mockChatSessionStore.setReadStatus.mockResolvedValue(null);
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    mockProfileCacheManager.getAllChatConfigs.mockReturnValue([]);
  });

  // ── initialize ─────────────────────────────────────────────────────────────
  describe('initialize', () => {
    it('sets currentUserAlias on first call', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized for user'),
        expect.any(String),
        expect.objectContaining({ alias: 'alice' }),
      );
    });

    it('is idempotent for same alias', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const logCallsBefore = sharedMockLogger.info.mock.calls.length;
      await manager.initialize('alice');
      // Second call should be skipped — no new log entries
      expect(sharedMockLogger.info.mock.calls.length).toBe(logCallsBefore);
    });

    it('re-initializes for different alias', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      await manager.initialize('bob');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized for user'),
        expect.any(String),
        expect.objectContaining({ alias: 'bob' }),
      );
    });
  });

  // ── generateChatSessionId ──────────────────────────────────────────────────
  describe('generateChatSessionId', () => {
    it('returns a non-empty string', () => {
      const manager = createFreshManager();
      const id = manager.generateChatSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  // ── getCacheStats ──────────────────────────────────────────────────────────
  describe('getCacheStats', () => {
    it('returns stats with zero instances when empty', () => {
      const manager = createFreshManager();
      mockRegistry.getInstanceCount.mockReturnValue(0);
      mockRegistry.listCachedSessionIds.mockReturnValue([]);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const stats = manager.getCacheStats();
      expect(stats).toEqual({
        totalInstances: 0,
        currentChatSessionId: null,
        cachedChatSessionIds: [],
      });
    });

    it('returns stats with populated sessions', () => {
      const manager = createFreshManager();
      mockRegistry.getInstanceCount.mockReturnValue(2);
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1', 's2']);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');
      const stats = manager.getCacheStats();
      expect(stats).toEqual({
        totalInstances: 2,
        currentChatSessionId: 's1',
        cachedChatSessionIds: ['s1', 's2'],
      });
    });
  });

  // ── getChatHistory ─────────────────────────────────────────────────────────
  describe('getChatHistory', () => {
    it('returns empty array when no current instance', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(manager.getChatHistory()).toEqual([]);
    });

    it('returns history from current instance', () => {
      const manager = createFreshManager();
      const messages = [{ id: 'm1' }, { id: 'm2' }] as any;
      const mockInstance = makeMockAgentChat({ getChatHistory: vi.fn(() => messages) });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      expect(manager.getChatHistory()).toEqual(messages);
    });
  });

  // ── getRuntimeMode ─────────────────────────────────────────────────────────
  describe('getRuntimeMode', () => {
    it('returns null when session has no mode', () => {
      const manager = createFreshManager();
      mockRegistry.getRuntimeMode.mockReturnValue(null);
      expect(manager.getRuntimeMode('sess-1')).toBeNull();
    });

    it('returns mode from registry', () => {
      const manager = createFreshManager();
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      expect(manager.getRuntimeMode('sess-1')).toBe('interactive');
    });
  });

  // ── updateSessionTitle ─────────────────────────────────────────────────────
  describe('updateSessionTitle', () => {
    it('returns false when instance not found', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(false);
    });

    it('returns false when instance.updateSessionTitle returns false', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => false) });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(false);
    });

    it('returns true and notifies renderer when current session', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => true) });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(true);
      expect(mockRendererBridge.notifyChatSessionCacheCreated).toHaveBeenCalled();
    });

    it('returns true but skips notify when not current session', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => true) });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-sess');
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(true);
      expect(mockRendererBridge.notifyChatSessionCacheCreated).not.toHaveBeenCalled();
    });
  });

  // ── removeInstanceByChatSession ────────────────────────────────────────────
  describe('removeInstanceByChatSession', () => {
    it('no-op when instance not found', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(() => manager.removeInstanceByChatSession('sess-1')).not.toThrow();
    });

    it('destroys instance and notifies frontend', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other');
      manager.removeInstanceByChatSession('sess-1');
      expect(mockInstance.destroy).toHaveBeenCalled();
      expect(mockRegistry.removeInstance).toHaveBeenCalledWith('sess-1');
      expect(mockRendererBridge.notifyChatSessionCacheDestroyed).toHaveBeenCalledWith('sess-1');
    });

    it('clears current session when removing the current session', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      manager.removeInstanceByChatSession('sess-1');
      expect(mockSessionCoordinator.clearCurrentSession).toHaveBeenCalledWith('sess-1');
      expect(mockRendererBridge.notifyCurrentChatSessionIdChanged).toHaveBeenCalledWith(null, null);
    });
  });

  // ── runScheduledJob ────────────────────────────────────────────────────────
  describe('runScheduledJob', () => {
    it('returns error when no current user alias', async () => {
      const manager = createFreshManager();
      const job = { id: 'job-1', name: 'Test Job', agentId: 'agent-1' } as any;
      const result = await manager.runScheduledJob(job);
      expect(result).toEqual({ success: false, error: 'No current user alias set' });
    });

    it('delegates to scheduledRunner after initializing', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockScheduledRunner.run.mockResolvedValue({ success: true, messagesCount: 3 });
      const job = { id: 'job-1', name: 'Test Job', agentId: 'agent-1' } as any;
      const result = await manager.runScheduledJob(job);
      expect(result.success).toBe(true);
      expect(result.messagesCount).toBe(3);
      expect(mockScheduledRunner.run).toHaveBeenCalled();
    });

    it('passes provided chatSessionId to scheduledRunner', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockScheduledRunner.run.mockResolvedValue({ success: true, messagesCount: 0 });
      const job = { id: 'job-1', name: 'Test Job', agentId: 'agent-1' } as any;
      const onReady = vi.fn();
      await manager.runScheduledJob(job, { chatSessionId: 'fixed-session', onReady });
      expect(mockScheduledRunner.run).toHaveBeenCalledWith(
        'alice',
        'fixed-session',
        job,
        expect.objectContaining({ onReady }),
      );
    });
  });

  // ── setMainWindow ──────────────────────────────────────────────────────────
  describe('setMainWindow', () => {
    it('delegates to notificationBridge and logs', () => {
      const manager = createFreshManager();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {},
      } as any;
      mockRegistry.forEachInstance.mockImplementation((cb: any) => {
        cb(makeMockAgentChat(), 'sess-1');
      });
      manager.setMainWindow(mockWindow);
      expect(mockNotificationBridge.setMainWindow).toHaveBeenCalledWith(mockWindow);
    });

    it('handles null window', () => {
      const manager = createFreshManager();
      manager.setMainWindow(null);
      expect(mockNotificationBridge.setMainWindow).toHaveBeenCalledWith(null);
    });
  });

  // ── syncProfileUpdate ──────────────────────────────────────────────────────
  describe('syncProfileUpdate', () => {
    it('warns and returns when alias does not match', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      await manager.syncProfileUpdate('bob');
      expect(sharedMockLogger.warn).toHaveBeenCalled();
    });

    it('cleans up obsolete instances when alias matches', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat({ getChatId: vi.fn(() => 'old-chat') });
      mockRegistry.forEachInstance.mockImplementation((cb: any) => {
        cb(mockInstance, 'sess-old');
      });
      mockRegistry.getInstance
        .mockReturnValueOnce(mockInstance) // for disposeManagedInstance
        .mockReturnValue(null);
      // getAllChatConfigs returns no chats, so 'old-chat' is obsolete
      mockProfileCacheManager.getAllChatConfigs.mockReturnValue([]);
      await manager.syncProfileUpdate('alice');
      // registry.forEachInstance was called
      expect(mockRegistry.forEachInstance).toHaveBeenCalled();
    });
  });

  // ── exitNewChatSessionFor ──────────────────────────────────────────────────
  describe('exitNewChatSessionFor', () => {
    it('logs success when exitNewChatSession returns success', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({ success: true });
      manager.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Exited New Chat Session'),
        expect.any(String),
        expect.objectContaining({ chatId: 'chat-1', chatSessionId: 'sess-1' }),
      );
    });

    it('warns when exitNewChatSession reports mismatch', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({
        success: false,
        existingChatSessionId: 'sess-other',
      });
      manager.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mismatch'),
        expect.any(String),
        expect.objectContaining({ requestedChatSessionId: 'sess-1' }),
      );
    });
  });

  // ── forkChatSession ────────────────────────────────────────────────────────
  describe('forkChatSession', () => {
    it('returns error when no current user alias', async () => {
      const manager = createFreshManager();
      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result).toEqual({ success: false, error: 'No current user alias set' });
    });

    it('returns error when chatId is empty', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const result = await manager.forkChatSession('', 'sess-src');
      expect(result).toEqual({ success: false, error: 'chatId and sourceChatSessionId are required' });
    });

    it('returns error when sourceChatSessionId is empty', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const result = await manager.forkChatSession('chat-1', '');
      expect(result).toEqual({ success: false, error: 'chatId and sourceChatSessionId are required' });
    });

    it('returns error when copySession fails', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(false);
      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result).toEqual({ success: false, error: 'Failed to copy ChatSession' });
    });

    it('returns error when forkChatSessionDirectory fails', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue(null);
      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result).toEqual({ success: false, error: 'Failed to provision forked ChatSession workspace' });
    });

    it('returns error when switchToChatSession returns null', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue('/dir');
      // switchToChatSession will fail because no chat config
      mockProfileCacheManager.getChatConfig.mockReturnValue(null);
      mockRegistry.hasInstance.mockReturnValue(false);
      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result).toEqual({ success: false, error: 'Failed to switch to forked ChatSession' });
    });

    it('returns success with target chatSessionId when all steps pass', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      const mockInstance = makeMockAgentChat();
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue('/dir');
      // Make switchToChatSession succeed by returning a cached instance
      mockRegistry.hasInstance.mockReturnValue(true);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('different-session');

      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result.success).toBe(true);
      expect(typeof result.chatSessionId).toBe('string');
    });

    it('catches unexpected errors and returns failure', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockRejectedValue(new Error('store boom'));
      const result = await manager.forkChatSession('chat-1', 'sess-src');
      expect(result.success).toBe(false);
      expect(result.error).toBe('store boom');
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────
  describe('destroy', () => {
    it('cleans up all instances and resets state', () => {
      const manager = createFreshManager();
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1', 's2']);
      // instances will return null so disposeManagedInstance is a no-op
      mockRegistry.getInstance.mockReturnValue(null);
      manager.destroy(false);
      expect(mockNotificationBridge.destroy).toHaveBeenCalled();
      expect(mockRegistry.disposeAllCancellationSources).toHaveBeenCalled();
      expect(mockRegistry.clearAll).toHaveBeenCalled();
      expect(mockSessionCoordinator.reset).toHaveBeenCalled();
    });

    it('notifies frontend for each instance when notifyFrontend=true', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1']);
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other');
      manager.destroy(true);
      expect(mockRendererBridge.notifyChatSessionCacheDestroyed).toHaveBeenCalledWith('s1');
    });
  });

  // ── cancelChatSession ──────────────────────────────────────────────────────
  describe('cancelChatSession', () => {
    it('returns error when no agent instance found', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.cancelChatSession('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active chat session instance found');
    });

    it('returns success immediately when chat is already idle', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'idle') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
    });

    it('cancels via source when active source exists', async () => {
      const manager = createFreshManager();
      const cancelFn = vi.fn();
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getCancellationSource.mockReturnValue({
        token: { isCancellationRequested: false },
        cancel: cancelFn,
      });
      const result = await manager.cancelChatSession('sess-1');
      expect(cancelFn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('falls back to force-idle when no cancellation source', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getCancellationSource.mockReturnValue(null);
      const result = await manager.cancelChatSession('sess-1');
      expect(result.success).toBe(true);
    });
  });

  // ── markChatSessionAsUnreadIfNeeded ────────────────────────────────────────
  describe('markChatSessionAsUnreadIfNeeded', () => {
    it('skips when no instance found', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalled();
    });

    it('skips when runtimeMode is not interactive', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('skipped: non-interactive'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when session is protected (foreground)', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(true);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('skipped: session is foreground protected'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('marks unread and shows notification when update succeeds', async () => {
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
  });

  // ── cancelActiveToolExecution ──────────────────────────────────────────────
  describe('cancelActiveToolExecution', () => {
    it('returns error when no instance', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active chat session instance found');
    });

    it('returns success when cancellation succeeds', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(true);
      expect(mockInstance.cancelActiveToolExecution).toHaveBeenCalled();
    });

    it('returns error when cancellation throws', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockRejectedValue(new Error('cancel boom')),
      });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('cancel boom');
    });
  });

  // ── startNewChatFor ────────────────────────────────────────────────────────
  describe('startNewChatFor', () => {
    it('returns null when chatId is empty', async () => {
      const manager = createFreshManager();
      const result = await manager.startNewChatFor('');
      expect(result).toBeNull();
    });

    it('logs when existing new chatSessionId is found', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockSessionCoordinator.getNewChatSessionId.mockReturnValue('existing-sess');
      mockSessionCoordinator.getOrCreateNewChatSessionId.mockReturnValue('existing-sess');
      // switchToChatSession will return null (no config)
      const result = await manager.startNewChatFor('chat-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing new ChatSessionId'),
        expect.any(String),
        expect.objectContaining({ chatId: 'chat-1' }),
      );
    });
  });
});
