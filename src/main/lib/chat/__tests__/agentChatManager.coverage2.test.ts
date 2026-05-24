// @ts-nocheck
/**
 * agentChatManager.coverage2.test.ts
 *
 * Targets remaining uncovered branches in agentChatManager.ts:
 * - updateSessionTitle: notifies renderer when current session
 * - getChatHistory: empty path and instance path
 * - syncChatHistory: both branches
 * - getCurrentContextTokenUsage: no instance, no stats, with stats
 * - setMainWindow: with window triggers calculateAndNotifyContext
 * - markChatSessionAsUnreadIfNeeded: non-interactive, protected, update success, update fails
 * - updateChatSessionReadStatus: no alias, session not persisted, update fails, success
 * - cancelActiveToolExecution: no instance, success, error
 * - handleSessionLostFocus (via onWindowLostForeground callback)
 * - cleanupIdleInstance (via onIdleTimeout callback)
 * - getCacheStats
 * - destroy with notifyFrontend=true
 * - waitForChatSessionIdle: timeout path, status becomes idle, status check throws
 */

// ─── Shared mock logger ───────────────────────────────────────────────────────

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
  forkChatSessionDirectory: vi.fn().mockResolvedValue('/some/dir'),
  isMainWindowForeground: vi.fn(() => true),
  getMainWindowState: vi.fn(() => ({ hasWindow: true, destroyed: false, visible: true, minimized: false, focused: true })),
  isProtectedSession: vi.fn(() => false),
  hasIdleTimer: vi.fn(() => false),
  reset: vi.fn(),
}));

vi.mock('../agentChatManagerSessionCoordinator', () => ({
  AgentChatManagerSessionCoordinator: vi.fn(function (opts: any, _timeout: number) {
    (mockSessionCoordinator as any)._opts = opts;
    return mockSessionCoordinator;
  }),
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

// ─── Mock subAgentManager (for dynamic import in cancelChatSession) ───────────

vi.mock('../../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: vi.fn().mockResolvedValue(0),
    })),
  },
}));

// ─── Import SUT ───────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('AgentChatManager (coverage2)', () => {
  let manager: AgentChatManager;

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
    manager = createFreshManager();
  });

  // ─── getCacheStats ─────────────────────────────────────────────────────

  describe('getCacheStats', () => {
    it('returns stats from registry and coordinator', () => {
      mockRegistry.getInstanceCount.mockReturnValue(2);
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1', 's2']);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');

      const stats = manager.getCacheStats();
      expect(stats.totalInstances).toBe(2);
      expect(stats.currentChatSessionId).toBe('s1');
      expect(stats.cachedChatSessionIds).toEqual(['s1', 's2']);
    });
  });

  // ─── updateSessionTitle ────────────────────────────────────────────────

  describe('updateSessionTitle', () => {
    it('returns false when no instance', () => {
      mockRegistry.getInstance.mockReturnValue(null);
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(false);
    });

    it('returns false when updateSessionTitle returns false', () => {
      const instance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => false) });
      mockRegistry.getInstance.mockReturnValue(instance);
      expect(manager.updateSessionTitle('sess-1', 'New Title')).toBe(false);
    });

    it('notifies renderer when session is current', () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      const result = manager.updateSessionTitle('sess-1', 'Updated');
      expect(result).toBe(true);
      expect(mockRendererBridge.notifyChatSessionCacheCreated).toHaveBeenCalled();
    });

    it('does not notify renderer when session is not current', () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-sess');
      manager.updateSessionTitle('sess-1', 'Updated');
      expect(mockRendererBridge.notifyChatSessionCacheCreated).not.toHaveBeenCalled();
    });
  });

  // ─── getChatHistory ────────────────────────────────────────────────────

  describe('getChatHistory', () => {
    it('returns empty array when no current instance', () => {
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(manager.getChatHistory()).toEqual([]);
    });

    it('returns history from current instance', () => {
      const msgs = [{ role: 'user', content: 'hi' }];
      const instance = makeMockAgentChat({ getChatHistory: vi.fn(() => msgs) });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);
      expect(manager.getChatHistory()).toEqual(msgs);
    });
  });

  // ─── syncChatHistory ───────────────────────────────────────────────────

  describe('syncChatHistory', () => {
    it('logs warning when current instance exists', () => {
      const instance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);
      manager.syncChatHistory([]);
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not fully implemented'),
      );
    });

    it('logs warning when no current instance', () => {
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      manager.syncChatHistory([]);
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No current instance'),
      );
    });
  });

  // ─── getCurrentContextTokenUsage ──────────────────────────────────────

  describe('getCurrentContextTokenUsage', () => {
    it('returns null when no current instance', () => {
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(manager.getCurrentContextTokenUsage()).toBeNull();
    });

    it('returns null when no latestContextStats', () => {
      const instance = makeMockAgentChat();
      (instance as any).latestContextStats = undefined;
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);
      expect(manager.getCurrentContextTokenUsage()).toBeNull();
    });

    it('returns stats when latestContextStats available', () => {
      const instance = makeMockAgentChat();
      (instance as any).latestContextStats = {
        tokenCount: 100,
        totalMessages: 5,
        contextMessages: 3,
        compressionRatio: 0.9,
      };
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);
      const result = manager.getCurrentContextTokenUsage();
      expect(result?.tokenCount).toBe(100);
      expect(result?.totalMessages).toBe(5);
    });
  });

  // ─── isActiveChatSessionId ─────────────────────────────────────────────

  describe('isActiveChatSessionId', () => {
    it('returns true when matching', () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');
      expect(manager.isActiveChatSessionId('s1')).toBe(true);
    });

    it('returns false when not matching', () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s2');
      expect(manager.isActiveChatSessionId('s1')).toBe(false);
    });
  });

  // ─── setMainWindow ─────────────────────────────────────────────────────

  describe('setMainWindow', () => {
    it('calls calculateAndNotifyContext for each instance when window is set', () => {
      const instance = makeMockAgentChat();
      mockRegistry.forEachInstance.mockImplementation((fn: any) => fn(instance, 'sess-1'));
      const mockWindow = { isDestroyed: vi.fn(() => false), webContents: {} };
      mockNotificationBridge.getMainWindow.mockReturnValue(mockWindow);
      manager.setMainWindow(mockWindow as any);
      expect(instance.calculateAndNotifyContext).toHaveBeenCalled();
    });

    it('handles calculateAndNotifyContext error gracefully', () => {
      const instance = makeMockAgentChat({
        calculateAndNotifyContext: vi.fn(() => { throw new Error('notify failed'); }),
      });
      mockRegistry.forEachInstance.mockImplementation((fn: any) => fn(instance, 'sess-1'));
      const mockWindow = { isDestroyed: vi.fn(() => false), webContents: {} };
      mockNotificationBridge.getMainWindow.mockReturnValue(mockWindow);
      expect(() => manager.setMainWindow(mockWindow as any)).not.toThrow();
      expect(sharedMockLogger.error).toHaveBeenCalled();
    });

    it('does not trigger when window is null', () => {
      const instance = makeMockAgentChat();
      mockRegistry.forEachInstance.mockImplementation((fn: any) => fn(instance, 'sess-1'));
      manager.setMainWindow(null);
      expect(instance.calculateAndNotifyContext).not.toHaveBeenCalled();
    });
  });

  // ─── cancelActiveToolExecution ─────────────────────────────────────────

  describe('cancelActiveToolExecution', () => {
    it('returns error when no instance', async () => {
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
    });

    it('returns success on successful cancel', async () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(true);
    });

    it('returns error when cancel throws', async () => {
      const instance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockRejectedValue(new Error('cancel error')),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const result = await manager.cancelActiveToolExecution('sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancel error');
    });
  });

  // ─── markChatSessionAsUnreadIfNeeded ──────────────────────────────────

  describe('markChatSessionAsUnreadIfNeeded', () => {
    it('skips when no instance', async () => {
      mockRegistry.getInstance.mockReturnValue(null);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no instance'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when non-interactive mode', async () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('non-interactive'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when session is protected', async () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(true);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('foreground protected'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('updates unread and notifies when eligible', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: { readStatus: 'read' } });
      mockChatSessionStore.setReadStatus.mockResolvedValue({ metadata: { readStatus: 'unread' } });
      mockProfileCacheManager.syncStarredChatSessionIndex.mockResolvedValue(undefined);
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(mockChatSessionStore.setReadStatus).toHaveBeenCalled();
    });

    it('logs warning when update does not persist', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null); // session not persisted
      await manager.markChatSessionAsUnreadIfNeeded('sess-1');
      expect(mockNotificationBridge.showChatSessionCompletionNotification).not.toHaveBeenCalled();
    });
  });

  // ─── getRuntimeMode ────────────────────────────────────────────────────

  describe('getRuntimeMode', () => {
    it('delegates to registry', () => {
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      expect(manager.getRuntimeMode('sess-1')).toBe('interactive');
    });
  });

  // ─── destroy ───────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('disposes all instances and resets state', () => {
      const instance = makeMockAgentChat();
      mockRegistry.listCachedSessionIds.mockReturnValue(['sess-1']);
      mockRegistry.getInstance.mockReturnValue(instance);
      manager.destroy(false);
      expect(instance.destroy).toHaveBeenCalled();
      expect(mockRegistry.clearAll).toHaveBeenCalled();
      expect(mockSessionCoordinator.reset).toHaveBeenCalled();
    });

    it('handles errors during instance disposal', () => {
      const instance = makeMockAgentChat({ destroy: vi.fn(() => { throw new Error('destroy error'); }) });
      mockRegistry.listCachedSessionIds.mockReturnValue(['sess-1']);
      mockRegistry.getInstance.mockReturnValue(instance);
      expect(() => manager.destroy()).not.toThrow();
      expect(sharedMockLogger.error).toHaveBeenCalled();
    });
  });

  // ─── initialize ────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('skips if already initialized for same alias', async () => {
      await manager.initialize('user1');
      await manager.initialize('user1'); // second call should be no-op
      expect(sharedMockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('reinitializes for different alias', async () => {
      await manager.initialize('user1');
      await manager.initialize('user2');
      expect(sharedMockLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  // ─── exitNewChatSessionFor ─────────────────────────────────────────────

  describe('exitNewChatSessionFor', () => {
    it('logs success when coordinator returns success', () => {
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({ success: true });
      manager.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Exited New Chat Session'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('logs warning when chatSessionId mismatch', () => {
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({
        success: false,
        existingChatSessionId: 'sess-other',
      });
      manager.exitNewChatSessionFor('chat-1', 'sess-1');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mismatch'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ─── onWindowLostForeground callback (handleSessionLostFocus) ─────────

  describe('window foreground callbacks', () => {
    it('handleSessionLostFocus skips when instance not found', () => {
      mockRegistry.getInstance.mockReturnValue(null);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-x');
      // Invoke the callback directly via constructor opts
      const bridgeOpts = (mockNotificationBridge as any)._opts;
      bridgeOpts?.onWindowLostForeground?.();
      // Should not throw, just log info
    });

    it('handleSessionLostFocus processes when instance found', () => {
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-x');
      const bridgeOpts = (mockNotificationBridge as any)._opts;
      bridgeOpts?.onWindowLostForeground?.();
    });

    it('onWindowRegainedForeground clears pending unread', () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-x');
      const bridgeOpts = (mockNotificationBridge as any)._opts;
      bridgeOpts?.onWindowRegainedForeground?.();
      expect(mockSessionCoordinator.clearPendingUnreadForCurrentSession).toHaveBeenCalled();
    });

    it('onWindowRegainedForeground does nothing when no current session', () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const bridgeOpts = (mockNotificationBridge as any)._opts;
      bridgeOpts?.onWindowRegainedForeground?.();
      expect(mockSessionCoordinator.clearPendingUnreadForCurrentSession).not.toHaveBeenCalled();
    });
  });

  // ─── cleanupIdleInstance (onIdleTimeout callback) ─────────────────────

  describe('cleanupIdleInstance via onIdleTimeout callback', () => {
    function getOnIdleTimeout() {
      const coordOpts = (mockSessionCoordinator as any)._opts;
      return coordOpts?.onIdleTimeout;
    }

    it('skips cleanup for protected session', () => {
      mockSessionCoordinator.isProtectedSession.mockReturnValue(true);
      const onIdleTimeout = getOnIdleTimeout();
      onIdleTimeout?.('sess-protected');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping cleanup'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when instance not found', () => {
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockRegistry.getInstance.mockReturnValue(null);
      const onIdleTimeout = getOnIdleTimeout();
      onIdleTimeout?.('sess-missing');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instance not found'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('skips when instance is not idle', () => {
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      const instance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(instance);
      const onIdleTimeout = getOnIdleTimeout();
      onIdleTimeout?.('sess-busy');
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('no longer idle'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('disposes idle instance', () => {
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      const instance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'idle') });
      mockRegistry.getInstance.mockReturnValue(instance);
      const onIdleTimeout = getOnIdleTimeout();
      onIdleTimeout?.('sess-idle');
      expect(instance.destroy).toHaveBeenCalled();
    });
  });

  // ─── waitForChatSessionIdle (via cancelChatSession paths) ─────────────

  describe('waitForChatSessionIdle behavior', () => {
    it('resolves immediately when instance not found', async () => {
      // Inject into private method directly
      mockRegistry.getInstance.mockReturnValue(null);
      const mgr = manager as any;
      await expect(mgr.waitForChatSessionIdle('no-sess', 100)).resolves.toBeUndefined();
    });

    it('resolves when status becomes idle', async () => {
      let callCount = 0;
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => {
          callCount++;
          return callCount >= 2 ? 'idle' : 'sending_response';
        }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mgr = manager as any;
      await expect(mgr.waitForChatSessionIdle('sess-1', 2000)).resolves.toBeUndefined();
    });

    it('resolves on status check error', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => { throw new Error('destroyed'); }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mgr = manager as any;
      await expect(mgr.waitForChatSessionIdle('sess-1', 500)).resolves.toBeUndefined();
    });
  });

  // ─── refreshCurrentInstance ────────────────────────────────────────────

  describe('refreshCurrentInstance', () => {
    it('returns null when no current chat session', async () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
      const result = await manager.refreshCurrentInstance();
      expect(result).toBeNull();
    });

    it('returns null when no instance found', async () => {
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('sess-1');
      mockRegistry.getInstance.mockReturnValue(null);
      const result = await manager.refreshCurrentInstance();
      expect(result).toBeNull();
    });
  });

  // ─── forkChatSession error paths ──────────────────────────────────────

  describe('forkChatSession', () => {
    it('returns error when no user alias', async () => {
      const result = await manager.forkChatSession('chat-1', 'sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('returns error when chatId missing', async () => {
      await manager.initialize('user1');
      const result = await manager.forkChatSession('', 'sess-1');
      expect(result.success).toBe(false);
    });

    it('returns error when copySession fails', async () => {
      await manager.initialize('user1');
      mockChatSessionStore.copySession.mockResolvedValue(false);
      const result = await manager.forkChatSession('chat-1', 'sess-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to copy');
    });
  });

  // ─── canEditUserMessage ────────────────────────────────────────────────

  describe('canEditUserMessage', () => {
    it('returns error when no instance', () => {
      mockRegistry.getInstance.mockReturnValue(null);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(false);
    });

    it('returns canEdit result from instance', () => {
      const instance = makeMockAgentChat({ canEditUserMessage: vi.fn(() => ({ canEdit: true })) });
      mockRegistry.getInstance.mockReturnValue(instance);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(true);
      expect(result.data?.canEdit).toBe(true);
    });

    it('returns error when canEditUserMessage throws', () => {
      const instance = makeMockAgentChat({
        canEditUserMessage: vi.fn(() => { throw new Error('check error'); }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const result = manager.canEditUserMessage('sess-1', 'msg-1');
      expect(result.success).toBe(false);
    });
  });

  // ─── syncProfileUpdate ────────────────────────────────────────────────

  describe('syncProfileUpdate', () => {
    it('does nothing when alias mismatch', async () => {
      await manager.initialize('user1');
      await manager.syncProfileUpdate('user2');
      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Alias mismatch'),
      );
    });

    it('cleans up obsolete instances', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat({ getChatId: vi.fn(() => 'old-chat') });
      mockRegistry.forEachInstance.mockImplementation((fn: any) => fn(instance, 'sess-old'));
      mockRegistry.getInstance.mockReturnValue(instance);
      mockProfileCacheManager.getAllChatConfigs.mockReturnValue([{ chat_id: 'new-chat' }]);
      await manager.syncProfileUpdate('user1');
      expect(instance.destroy).toHaveBeenCalled();
    });
  });
});
