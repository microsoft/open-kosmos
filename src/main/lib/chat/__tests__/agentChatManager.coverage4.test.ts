// @ts-nocheck
/**
 * agentChatManager.coverage4.test.ts
 *
 * Targets uncovered branches/functions to bring agentChatManager.ts
 * above the 90% gate on functions and branches.
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

// ─── Mock subAgentManager ─────────────────────────────────────────────────────

const mockSubAgentCancelByParent = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock('../../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: mockSubAgentCancelByParent,
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

describe('AgentChatManager (coverage4)', () => {
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
    mockChatSessionStore.setReadStatus.mockResolvedValue(null);
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    mockSubAgentCancelByParent.mockResolvedValue(0);
    manager = createFreshManager();
  });

  // ─── getOrCreateInstanceByChatSession: chatSessionData found from store ─
  describe('getOrCreateInstanceByChatSession', () => {
    it('logs session data details when ensureLoaded returns file data', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'A' } });
      mockChatSessionStore.ensureLoaded.mockResolvedValue({
        file: { title: 'Existing', chat_history: [{ role: 'user' }, { role: 'assistant' }] },
        metadata: { schedulerMeta: true },
      });
      const instance = makeMockAgentChat();
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });

      await manager.switchToChatSession('chat-1', 'sess-with-data');

      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing ChatSession data'),
        expect.any(String),
        expect.objectContaining({ messagesCount: 2 }),
      );
    });

    it('logs session data with chat_history missing (fallback to 0)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'A' } });
      mockChatSessionStore.ensureLoaded.mockResolvedValue({
        file: { title: 'No History' },
        metadata: null,
      });
      const instance = makeMockAgentChat();
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });

      await manager.switchToChatSession('chat-1', 'sess-no-history');

      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing ChatSession data'),
        expect.any(String),
        expect.objectContaining({ messagesCount: 0 }),
      );
    });

    it('handles ensureLoaded throwing a non-Error value', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'A' } });
      mockChatSessionStore.ensureLoaded.mockRejectedValue('string-error');
      const instance = makeMockAgentChat();
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });

      await manager.switchToChatSession('chat-1', 'sess-load-err');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load existing ChatSession data'),
        expect.any(String),
        expect.objectContaining({ error: 'string-error' }),
      );
    });

    it('handles outer catch with non-Error (String fallback in error log)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'A' } });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);
      mockAgentChatConstructor.mockImplementation(() => { throw 'raw-string-throw'; });

      const result = await manager.switchToChatSession('chat-1', 'sess-outer-err');

      expect(result).toBeNull();
      expect(sharedMockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('raw-string-throw'),
      );
    });
  });

  // ─── startNewChatFor: existing new session id vs generated ──────────────
  describe('startNewChatFor', () => {
    it('logs when an existing new ChatSessionId is found for the chatId', async () => {
      await manager.initialize('user1');
      mockSessionCoordinator.getNewChatSessionId.mockReturnValue('existing-new-sess');
      mockSessionCoordinator.getOrCreateNewChatSessionId.mockReturnValue('existing-new-sess');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'A' } });

      const instance = makeMockAgentChat();
      mockRegistry.hasInstance.mockReturnValue(true);
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');

      await manager.startNewChatFor('chat-1');

      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing new ChatSessionId'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('handles switchToChatSession returning null (no instance)', async () => {
      await manager.initialize('user1');
      mockSessionCoordinator.getNewChatSessionId.mockReturnValue(null);
      mockProfileCacheManager.getChatConfig.mockReturnValue(null);

      const result = await manager.startNewChatFor('chat-no-config');

      expect(result).toBeNull();
    });
  });

  // ─── cancelChatSession branches ─────────────────────────────────────────
  describe('cancelChatSession', () => {
    it('handles no-source path when getAgentInfo returns name = null (fallback to Unknown)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
        getAgentInfo: vi.fn().mockResolvedValue({ name: null }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getCancellationSource.mockReturnValue(null);

      const result = await manager.cancelChatSession('sess-no-source');

      expect(result.success).toBe(true);
      expect(mockNotificationBridge.emitChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-no-source', 'idle', 'Unknown',
      );
    });

    it('handles no-source path when getAgentInfo throws (fallback to Unknown)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
        getAgentInfo: vi.fn().mockRejectedValue(new Error('agent info error')),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getCancellationSource.mockReturnValue(null);

      const result = await manager.cancelChatSession('sess-agent-err');

      expect(result.success).toBe(true);
    });

    it('handles no-source path when emitChatStatusChanged throws (forceError branch)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getCancellationSource.mockReturnValue(null);
      mockNotificationBridge.emitChatStatusChanged.mockImplementationOnce(() => {
        throw new Error('emit failed');
      });

      const result = await manager.cancelChatSession('sess-force-err');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to cancel');
    });

    it('handles no-source forceError branch with non-Error thrown value', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getCancellationSource.mockReturnValue(null);
      mockNotificationBridge.emitChatStatusChanged.mockImplementationOnce(() => {
        throw 'string-force-error';
      });

      const result = await manager.cancelChatSession('sess-str-err');

      expect(result.success).toBe(false);
    });

    it('covers source.cancel path with agentName fallback (name || Unknown)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
        getAgentInfo: vi.fn().mockResolvedValue({ name: '' }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
      };
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      await manager.cancelChatSession('sess-empty-name');

      expect(mockNotificationBridge.emitChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-empty-name', 'idle', 'Unknown',
      );
    });

    it('covers source.cancel path when getAgentInfo throws (catch branch)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
        getAgentInfo: vi.fn().mockRejectedValue(new Error('info fail')),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
      };
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      const result = await manager.cancelChatSession('sess-info-throw');

      expect(result.success).toBe(true);
      expect(mockNotificationBridge.emitChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-info-throw', 'idle', 'Unknown',
      );
    });

    it('covers sub-agent cancel count > 0 log branch', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
      };
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);
      mockSubAgentCancelByParent.mockResolvedValue(3);

      await manager.cancelChatSession('sess-subagent');

      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cancelled sub-agent tasks'),
        expect.any(String),
        expect.objectContaining({ cancelledCount: 3 }),
      );
    });

    it('covers sub-agent cancel error with non-Error thrown value', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
      };
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      const { SubAgentManager } = await import('../../subAgent/subAgentManager');
      (SubAgentManager.getInstance as any).mockReturnValueOnce({
        cancelByParentSession: vi.fn().mockRejectedValue('sub-agent-string-error'),
      });

      await manager.cancelChatSession('sess-sub-err');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cancel sub-agent tasks'),
        expect.any(String),
        expect.objectContaining({ error: 'sub-agent-string-error' }),
      );
    });

    it('covers cancelActiveToolExecution error with non-Error (String branch)', async () => {
      const instance = makeMockAgentChat({
        getChatStatus: vi.fn(() => 'processing'),
        cancelActiveToolExecution: vi.fn().mockRejectedValue('tool-cancel-string-error'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
      };
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      await manager.cancelChatSession('sess-tool-err');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cancel active tool execution'),
        expect.any(String),
        expect.objectContaining({ error: 'tool-cancel-string-error' }),
      );
    });

    it('covers outer catch with non-Error (String fallback in error log)', async () => {
      mockRegistry.getInstance.mockImplementation(() => { throw 'outer-cancel-error'; });

      const result = await manager.cancelChatSession('sess-outer');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── streamMessage: error branches ──────────────────────────────────────
  describe('streamMessage', () => {
    it('covers error path with non-Error object (no statusCode, String fallback)', async () => {
      const instance = makeMockAgentChat({
        streamMessage: vi.fn().mockRejectedValue('stream-string-error'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('covers error path with Error that has statusCode', async () => {
      const err = new Error('Too Many Requests');
      (err as any).statusCode = 429;
      const instance = makeMockAgentChat({
        streamMessage: vi.fn().mockRejectedValue(err),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('[HTTP 429]');
    });

    it('covers error path with Error without statusCode', async () => {
      const instance = makeMockAgentChat({
        streamMessage: vi.fn().mockRejectedValue(new Error('generic error')),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.streamMessage('sess-1', { id: 'm1', role: 'user', content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('generic error');
    });
  });

  // ─── retryChat: error branches ──────────────────────────────────────────
  describe('retryChat', () => {
    it('covers error path with non-Error (Unknown error fallback, no statusCode)', async () => {
      const instance = makeMockAgentChat({
        retryChat: vi.fn().mockRejectedValue('retry-string-error'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.retryChat('sess-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('covers error path with Error that has statusCode', async () => {
      const err = new Error('Server Error');
      (err as any).statusCode = 500;
      const instance = makeMockAgentChat({
        retryChat: vi.fn().mockRejectedValue(err),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.retryChat('sess-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('[HTTP 500]');
    });
  });

  // ─── editUserMessage: error branches ────────────────────────────────────
  describe('editUserMessage', () => {
    it('covers error path with non-Error (String fallback)', async () => {
      const instance = makeMockAgentChat({
        editUserMessage: vi.fn().mockRejectedValue('edit-string-error'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.editUserMessage('sess-1', 'msg-1', { id: 'msg-1', role: 'user', content: 'edited' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── canEditUserMessage: error branch with non-Error ────────────────────
  describe('canEditUserMessage', () => {
    it('covers error path with non-Error (Unknown error fallback)', () => {
      const instance = makeMockAgentChat({
        canEditUserMessage: vi.fn(() => { throw 'can-edit-string-error'; }),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = manager.canEditUserMessage('sess-1', 'msg-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── getCurrentContextTokenUsage: fallback || branches ──────────────────
  describe('getCurrentContextTokenUsage', () => {
    it('covers all || 0 / || 1.0 fallbacks when contextStats has falsy values', () => {
      const instance = makeMockAgentChat();
      (instance as any).latestContextStats = {
        tokenCount: 0,
        totalMessages: 0,
        contextMessages: 0,
        compressionRatio: 0,
      };
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);

      const result = manager.getCurrentContextTokenUsage();

      expect(result).toEqual({
        tokenCount: 0,
        totalMessages: 0,
        contextMessages: 0,
        compressionRatio: 1.0,
      });
    });

    it('covers fallbacks when contextStats fields are undefined', () => {
      const instance = makeMockAgentChat();
      (instance as any).latestContextStats = {};
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);

      const result = manager.getCurrentContextTokenUsage();

      expect(result).toEqual({
        tokenCount: 0,
        totalMessages: 0,
        contextMessages: 0,
        compressionRatio: 1.0,
      });
    });
  });

  // ─── createAgentWithChatSession: no config, metadata hydrate, init fail ─
  describe('createAgentWithChatSession (via switchToChatSession)', () => {
    it('throws when no chat config found (no config guard)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue(null);
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      const result = await manager.switchToChatSession('chat-no-cfg', 'sess-1');

      expect(result).toBeNull();
    });

    it('hydrates scheduler metadata when metadata is present', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });
      const hydrateSpyFn = vi.fn();
      mockChatSessionStore.ensureLoaded.mockResolvedValue({
        file: null,
        metadata: { someSchedulerField: true },
      });
      const instance = makeMockAgentChat({
        hydrateSchedulerMetadata: hydrateSpyFn,
      });
      mockAgentChatConstructor.mockImplementation(function (this: any) {
        Object.assign(this, instance);
      });

      await manager.switchToChatSession('chat-1', 'sess-meta');

      expect(hydrateSpyFn).toHaveBeenCalledWith({ someSchedulerField: true });
    });

    it('covers initialize failure path with non-Error (String fallback)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);
      const instance = makeMockAgentChat({
        initialize: vi.fn().mockRejectedValue('init-string-error'),
      });
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });

      const result = await manager.switchToChatSession('chat-1', 'sess-init-err');

      expect(result).toBeNull();
    });
  });

  // ─── setupStatusChangeListener: duplicate guard + no-alias branch ───────
  describe('setupStatusChangeListener (via registerManagedInstance)', () => {
    it('skips adding listener when __removeStatusChangeListener already exists', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });
      const instance = makeMockAgentChat();
      (instance as any).__removeStatusChangeListener = vi.fn();
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      await manager.switchToChatSession('chat-1', 'sess-dup-listener');

      expect(instance.addStatusChangeListener).not.toHaveBeenCalled();
    });

    it('covers status change callback when currentUserAlias is null (agentName fallback)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });
      const statusListeners: Function[] = [];
      const instance = makeMockAgentChat({
        addStatusChangeListener: vi.fn((cb: Function) => {
          statusListeners.push(cb);
          return vi.fn();
        }),
      });
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      await manager.switchToChatSession('chat-1', 'sess-status-cb');

      // Null out the alias to trigger the no-alias branch
      (manager as any).currentUserAlias = null;
      statusListeners[0]?.('idle');

      expect(mockRendererBridge.notifyChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-status-cb', 'idle', 'Unknown',
      );
    });

    it('covers status change callback when getChatConfig throws', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'Agent' } });
      const statusListeners: Function[] = [];
      const instance = makeMockAgentChat({
        addStatusChangeListener: vi.fn((cb: Function) => {
          statusListeners.push(cb);
          return vi.fn();
        }),
      });
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      await manager.switchToChatSession('chat-1', 'sess-cfg-throw');

      mockProfileCacheManager.getChatConfig.mockImplementation(() => { throw new Error('config error'); });
      statusListeners[0]?.('processing');

      expect(mockRendererBridge.notifyChatStatusChanged).toHaveBeenCalledWith(
        'chat-1', 'sess-cfg-throw', 'processing', 'Unknown',
      );
    });

    it('covers status change callback when instance has event sender (skip bridge notify)', async () => {
      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'MyAgent' } });
      const statusListeners: Function[] = [];
      const instance = makeMockAgentChat({
        hasEventSender: vi.fn(() => true),
        addStatusChangeListener: vi.fn((cb: Function) => {
          statusListeners.push(cb);
          return vi.fn();
        }),
      });
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      await manager.switchToChatSession('chat-1', 'sess-has-sender');

      statusListeners[0]?.('idle');

      expect(mockRendererBridge.notifyChatStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ─── updateChatSessionReadStatus: setReadStatus fails → false ───────────
  describe('updateChatSessionReadStatus (via markChatSessionAsUnreadIfNeeded)', () => {
    it('returns false and warns when setReadStatus returns null (not persisted)', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockResolvedValue(null);

      await manager.markChatSessionAsUnreadIfNeeded('sess-unread');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('updateChatSessionReadStatus failed to persist'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('covers setReadStatus throwing an error (catch branch)', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockRejectedValue(new Error('db error'));

      await manager.markChatSessionAsUnreadIfNeeded('sess-db-err');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update chat session read status'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('covers setReadStatus throwing non-Error (String fallback)', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockRejectedValue('string-db-error');

      await manager.markChatSessionAsUnreadIfNeeded('sess-str-db-err');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update chat session read status'),
        expect.any(String),
        expect.objectContaining({ error: 'string-db-error' }),
      );
    });

    it('covers successful persist + notification path', async () => {
      await manager.initialize('user1');
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);
      mockChatSessionStore.ensureLoaded.mockResolvedValue({ file: {}, metadata: {} });
      mockChatSessionStore.setReadStatus.mockResolvedValue({
        metadata: { readStatus: 'unread' },
      });

      await manager.markChatSessionAsUnreadIfNeeded('sess-persist-ok');

      expect(mockProfileCacheManager.syncStarredChatSessionIndex).toHaveBeenCalled();
      expect(mockNotificationBridge.showChatSessionCompletionNotification).toHaveBeenCalled();
    });

    it('covers no currentUserAlias → early return false', async () => {
      (manager as any).currentUserAlias = null;
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      mockSessionCoordinator.isProtectedSession.mockReturnValue(false);

      await manager.markChatSessionAsUnreadIfNeeded('sess-no-alias');

      expect(sharedMockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipped notification because unread update did not persist'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ─── cancelActiveToolExecution: error with non-Error ────────────────────
  describe('cancelActiveToolExecution', () => {
    it('covers error branch with non-Error thrown value', async () => {
      const instance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockRejectedValue('tool-string-error'),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.cancelActiveToolExecution('sess-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('covers error branch with Error object', async () => {
      const instance = makeMockAgentChat({
        cancelActiveToolExecution: vi.fn().mockRejectedValue(new Error('tool error')),
      });
      mockRegistry.getInstance.mockReturnValue(instance);

      const result = await manager.cancelActiveToolExecution('sess-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('tool error');
    });
  });

  // ─── forkChatSession: error branches ────────────────────────────────────
  describe('forkChatSession', () => {
    it('covers error with non-Error (String fallback)', async () => {
      await manager.initialize('user1');
      mockRegistry.hasInstance.mockReturnValue(true);
      const instance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(instance);
      mockChatSessionStore.copySession.mockRejectedValue('fork-string-error');

      const result = await manager.forkChatSession('chat-1', 'sess-src');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error during fork');
    });
  });

  // ─── handleSessionLostFocus: error branch with non-Error ────────────────
  describe('handleSessionLostFocus (via onWindowLostForeground)', () => {
    it('covers error branch with non-Error thrown value', () => {
      const onLostForeground = (mockSessionCoordinator as any)._opts?.onWindowLostForeground;
      if (!onLostForeground) return;

      mockRegistry.getInstance.mockImplementation(() => { throw 'lost-focus-string-error'; });

      onLostForeground();

      expect(sharedMockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error handling session lost focus'),
        expect.any(String),
        expect.objectContaining({ error: 'lost-focus-string-error' }),
      );
    });
  });

  // ─── Constructor delegate callbacks (scheduledRunner) ────────────────
  describe('scheduledRunner constructor delegates', () => {
    it('exercises all delegate callbacks passed to AgentChatManagerScheduledRunner', async () => {
      const { AgentChatManagerScheduledRunner } = await import('../agentChatManagerScheduledRunner');
      const constructorMock = vi.mocked(AgentChatManagerScheduledRunner);
      const opts = constructorMock.mock.calls[0]?.[0];
      if (!opts) return;

      await manager.initialize('user1');
      mockProfileCacheManager.getChatConfig.mockReturnValue({ agent: { name: 'X' } });
      const instance = makeMockAgentChat();
      mockAgentChatConstructor.mockImplementation(function (this: any) { Object.assign(this, instance); });
      mockChatSessionStore.ensureLoaded.mockResolvedValue(null);

      // createAgentWithChatSession delegate
      await expect(opts.createAgentWithChatSession('user1', 'c1', 's1')).resolves.toBeDefined();

      // registerManagedInstance delegate
      const regInstance = makeMockAgentChat();
      opts.registerManagedInstance('s2', 'c2', regInstance, 'scheduled');
      expect(mockRegistry.setInstance).toHaveBeenCalled();

      // updateChatSessionReadStatus delegate
      await opts.updateChatSessionReadStatus('c3', 's3', 'unread');

      // showChatSessionCompletionNotification delegate
      opts.showChatSessionCompletionNotification('c4', 's4', 'Task Done', 'completed');
      expect(mockNotificationBridge.showChatSessionCompletionNotification).toHaveBeenCalled();

      // disposeManagedInstance delegate
      mockRegistry.getInstance.mockReturnValue(makeMockAgentChat());
      opts.disposeManagedInstance('s5', false);

      // getRuntimeMode delegate
      mockRegistry.getRuntimeMode.mockReturnValue('scheduled-silent');
      expect(opts.getRuntimeMode('s6')).toBe('scheduled-silent');
      expect(mockRegistry.getRuntimeMode).toHaveBeenCalledWith('s6');
    });
  });

  // ─── setMainWindow: forEachInstance calculateAndNotifyContext error ──────
  describe('setMainWindow', () => {
    it('covers calculateAndNotifyContext error with non-Error (String fallback)', () => {
      const mockWindow = { isDestroyed: () => false };
      mockNotificationBridge.getMainWindow.mockReturnValue(mockWindow);
      const instance = makeMockAgentChat({
        calculateAndNotifyContext: vi.fn(() => { throw 'context-string-error'; }),
      });
      mockRegistry.forEachInstance.mockImplementation((cb: Function) => {
        cb(instance, 'sess-ctx-err');
      });

      manager.setMainWindow(mockWindow as any);

      expect(sharedMockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('context-string-error'),
      );
    });
  });
});
