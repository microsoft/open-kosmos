const { getAllWindowsMock, notificationIsSupportedMock, MockNotification, mockInterruptSession } = vi.hoisted(() => {
  const getAllWindowsMock = vi.fn(() => []);
  const notificationIsSupportedMock = vi.fn(() => true);

  class MockNotification {
    static isSupported = notificationIsSupportedMock;
    static instances: MockNotification[] = [];

    on = vi.fn();
    show = vi.fn();

    constructor() {
      MockNotification.instances.push(this);
    }
  }

  const mockInterruptSession = vi.fn();

  return { getAllWindowsMock, notificationIsSupportedMock, MockNotification, mockInterruptSession };
});

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  Notification: MockNotification,
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getChatConfig: vi.fn(),
    getAllChatConfigs: vi.fn(() => []),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../chatSessionStore', async () => ({
  chatSessionStore: {
    ensureLoaded: vi.fn(),
    setReadStatus: vi.fn(),
    patchMetadata: vi.fn(),
    getAggregate: vi.fn(),
  },
}));

vi.mock('../../cancellation', async () => ({
  CancellationTokenSource: vi.fn().mockImplementation(function () {
    const token = { isCancellationRequested: false };
    return {
      token,
      cancel: vi.fn(() => {
        token.isCancellationRequested = true;
      }),
      dispose: vi.fn(),
    };
  }),
  CancellationError: class CancellationError extends Error {},
}));

vi.mock('../interactiveRequestManager', async () => ({
  interactiveRequestManager: {
    interruptSession: (...args: any[]) => mockInterruptSession(...args),
    clearSession: vi.fn(),
  },
}));

vi.mock('../../subAgent/subAgentManager', async () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: vi.fn().mockResolvedValue(0),
    })),
  },
}));

import { AgentChatManager } from '../agentChatManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { chatSessionStore } from '../chatSessionStore';
import type { Message } from '@shared/types/chatTypes';
import { CancellationError } from '../../cancellation';

interface MockWindow {
  on: Mock;
  removeListener: Mock;
  isDestroyed: Mock<() => boolean>;
  isVisible: Mock<() => boolean>;
  isMinimized: Mock<() => boolean>;
  isFocused: Mock<() => boolean>;
  webContents: {
    send: Mock;
  };
  emitEvent: (eventName: string) => void;
}

function createMockWindow(overrides?: {
  isVisible?: boolean;
  isMinimized?: boolean;
  isFocused?: boolean;
}): MockWindow {
  const listeners = new Map<string, () => void>();
  const state = {
    isVisible: overrides?.isVisible ?? true,
    isMinimized: overrides?.isMinimized ?? false,
    isFocused: overrides?.isFocused ?? true,
  };

  return {
    on: vi.fn((eventName: string, listener: () => void) => {
      listeners.set(eventName, listener);
    }),
    removeListener: vi.fn((eventName: string) => {
      listeners.delete(eventName);
    }),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => state.isVisible),
    isMinimized: vi.fn(() => state.isMinimized),
    isFocused: vi.fn(() => state.isFocused),
    webContents: {
      send: vi.fn(),
    },
    emitEvent: (eventName: string) => {
      if (eventName === 'blur') {
        state.isFocused = false;
      }
      if (eventName === 'hide') {
        state.isVisible = false;
        state.isFocused = false;
      }
      if (eventName === 'minimize') {
        state.isMinimized = true;
        state.isFocused = false;
      }
      if (eventName === 'focus') {
        state.isVisible = true;
        state.isMinimized = false;
        state.isFocused = true;
      }
      if (eventName === 'show') {
        state.isVisible = true;
      }
      if (eventName === 'restore') {
        state.isVisible = true;
        state.isMinimized = false;
      }
      listeners.get(eventName)?.();
    },
  };
}

function createManager(): AgentChatManager {
  (AgentChatManager as any).instance = undefined;
  return AgentChatManager.getInstance();
}

function cleanupManagerSingleton(): void {
  const manager = (AgentChatManager as any).instance as AgentChatManager | undefined;
  manager?.destroy();
  (AgentChatManager as any).instance = undefined;
}

function registerInteractiveSession(manager: any, chatSessionId: string, instance: any): void {
  const managedInstance = {
    destroy: vi.fn(),
    ...instance,
  };

  manager.registry.setInstance(chatSessionId, managedInstance, 'interactive');
  manager.sessionCoordinator.activateSession(chatSessionId, managedInstance);
}

describe('AgentChatManager notifications', () => {
  const originalPlatform = process.platform;

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInterruptSession.mockReset();
    getAllWindowsMock.mockReturnValue([]);
    notificationIsSupportedMock.mockReturnValue(true);
    MockNotification.instances = [];
    (chatSessionStore.ensureLoaded as Mock).mockResolvedValue({});
    (chatSessionStore.setReadStatus as Mock).mockResolvedValue({
      metadata: {
        chatSession_id: 'chatSession_active',
        title: 'Focused Session',
        last_updated: '2026-03-20T10:00:00.000Z',
        readStatus: 'unread',
      },
    });
  });

  afterEach(() => {
    cleanupManagerSingleton();
  });

  it('marks the current interactive session as pending unread when the main window loses focus', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_active';
    const instance = {
      getChatStatus: vi.fn(() => 'sending_response'),
    };

    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);

    window.emitEvent('minimize');

    expect(manager.sessionCoordinator.hasPendingUnread(activeSessionId)).toBe(true);
  });

  it('does not treat the current session as protected when the main window is not foreground', () => {
    const manager = createManager() as any;
    const window = createMockWindow({
      isVisible: true,
      isMinimized: true,
      isFocused: false,
    });
    const activeSessionId = 'chatSession_active';

    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, { getChatStatus: vi.fn(() => 'idle') });

    expect(manager.isProtectedSession(activeSessionId)).toBe(false);
  });

  it('broadcasts runtime status changes for scheduled-silent instances without an attached sender', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const addStatusChangeListener = vi.fn();
    const instance = {
      addStatusChangeListener,
      hasEventSender: vi.fn(() => false),
      getChatId: vi.fn(() => 'chat_scheduled'),
      destroy: vi.fn(),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: {
        name: 'Scheduled Agent',
      },
    });

    manager.registerManagedInstance('scheduled_session_1', 'chat_scheduled', instance, 'scheduled-silent');

    const listener = addStatusChangeListener.mock.calls[0][0];
    listener('sending_response');

    expect(window.webContents.send).toHaveBeenCalledWith('agentChat:chatStatusChanged', expect.objectContaining({
      chatId: 'chat_scheduled',
      chatSessionId: 'scheduled_session_1',
      chatStatus: 'sending_response',
      agentName: 'Scheduled Agent',
    }));
  });

  it('does not duplicate runtime status broadcasts for interactive instances with an attached sender', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const addStatusChangeListener = vi.fn();
    const coordinatorHandleStatusChangeSpy = vi.spyOn(manager.sessionCoordinator, 'handleStatusChange');
    const instance = {
      addContextChangeListener: vi.fn(),
      addStatusChangeListener,
      hasEventSender: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_interactive'),
      getChatStatus: vi.fn(() => 'sending_response'),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      destroy: vi.fn(),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);

    manager.registerManagedInstance('interactive_session_1', 'chat_interactive', instance, 'interactive');

    const listener = addStatusChangeListener.mock.calls[0][0];
    listener('sending_response');

    expect(window.webContents.send).not.toHaveBeenCalledWith('agentChat:chatStatusChanged', expect.objectContaining({
      chatId: 'chat_interactive',
      chatSessionId: 'interactive_session_1',
      chatStatus: 'sending_response',
    }));
    expect(coordinatorHandleStatusChangeSpy).toHaveBeenCalledWith('interactive_session_1', 'sending_response', 'interactive');
  });

  it('broadcasts runtime status through the manager when the attached sender is stale', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const addStatusChangeListener = vi.fn();
    const instance = {
      addStatusChangeListener,
      hasEventSender: vi.fn(() => false),
      getChatId: vi.fn(() => 'chat_stale_sender'),
      destroy: vi.fn(),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: {
        name: 'Recovered Agent',
      },
    });

    manager.registerManagedInstance('scheduled_session_stale_sender', 'chat_stale_sender', instance, 'scheduled-silent');

    const listener = addStatusChangeListener.mock.calls[0][0];
    listener('received_response');

    expect(window.webContents.send).toHaveBeenCalledWith('agentChat:chatStatusChanged', expect.objectContaining({
      chatId: 'chat_stale_sender',
      chatSessionId: 'scheduled_session_stale_sender',
      chatStatus: 'received_response',
      agentName: 'Recovered Agent',
    }));
  });

  it('does not call sessionCoordinator twice for the final idle transition after stream completion', async () => {
    const manager = createManager() as any;
    const activeSessionId = 'chat_session_1';
    const coordinatorHandleStatusChangeSpy = vi.spyOn(manager.sessionCoordinator, 'handleStatusChange');
    const statusListeners: Array<(status: string) => void> = [];
    const message: Message = { id: 'user_1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() };
    const instance = {
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn((listener: (status: string) => void) => {
        statusListeners.push(listener);
        return vi.fn();
      }),
      hasEventSender: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_1'),
      getChatStatus: vi.fn(() => 'idle'),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      streamMessage: vi.fn(async () => {
        statusListeners[0]?.('received_response');
        statusListeners[0]?.('idle');
        return [{ id: 'assistant_1' }];
      }),
      destroy: vi.fn(),
    };

    manager.currentUserAlias = 'testuser';
  manager.registerManagedInstance(activeSessionId, 'chat_1', instance, 'interactive');
  manager.sessionCoordinator.activateSession(activeSessionId, instance);

    const result = await manager.streamMessage(activeSessionId, message);

    expect(result.success).toBe(true);
    const idleCalls = coordinatorHandleStatusChangeSpy.mock.calls.filter(
      ([sessionId, status]) => sessionId === activeSessionId && status === 'idle'
    );
    expect(idleCalls).toHaveLength(1);
  });

  it('shows a system notification when a blurred current session completes', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_active';
    const instance = {
      getChatStatus: vi.fn()
        .mockReturnValueOnce('sending_response')
        .mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_1'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Focused Session' })),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);
    manager.updateChatSessionReadStatus = vi.fn().mockResolvedValue(true);

    window.emitEvent('blur');
    await manager.markChatSessionAsUnreadIfNeeded(activeSessionId);

    expect(manager.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_1', activeSessionId, 'unread');
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].show).toHaveBeenCalledTimes(1);
  });

  it('clears pending unread state when the current session regains foreground', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_active';
    const instance = {
      getChatStatus: vi.fn(() => 'sending_response'),
    };

    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);

    window.emitEvent('blur');
    expect(manager.sessionCoordinator.hasPendingUnread(activeSessionId)).toBe(true);

    window.emitEvent('focus');
    expect(manager.sessionCoordinator.hasPendingUnread(activeSessionId)).toBe(false);
  });

  it('does not show a system notification when the blurred current session regains focus before completion', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_active';
    const instance = {
      getChatStatus: vi.fn()
        .mockReturnValueOnce('sending_response')
        .mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_1'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Focused Session' })),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);
    manager.updateChatSessionReadStatus = vi.fn().mockResolvedValue(true);

    window.emitEvent('blur');
    window.emitEvent('focus');
    await manager.markChatSessionAsUnreadIfNeeded(activeSessionId);

    expect(manager.updateChatSessionReadStatus).not.toHaveBeenCalled();
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('syncs profile starred index when read status is updated', async () => {
    const manager = createManager() as any;
    manager.currentUserAlias = 'testuser';

    const result = await manager.updateChatSessionReadStatus('chat_1', 'chatSession_active', 'read');

    expect(result).toBe(true);
    expect(chatSessionStore.setReadStatus).toHaveBeenCalledWith('testuser', 'chat_1', 'chatSession_active', 'read');
    expect(profileCacheManager.syncStarredChatSessionIndex).toHaveBeenCalledWith(
      'testuser',
      'chat_1',
      expect.objectContaining({
        chatSession_id: 'chatSession_active',
        readStatus: 'unread',
      }),
      { notifyRenderer: false },
    );
  });

  it('updates the active session title in memory and refreshes renderer cache', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const instance = {
      updateSessionTitle: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_1'),
      getDisplayMessages: vi.fn(() => []),
      getChatStatus: vi.fn(() => 'idle'),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn(() => vi.fn()),
      hasEventSender: vi.fn(() => true),
      destroy: vi.fn(),
    };

    manager.setMainWindow(window as any);
    manager.registerManagedInstance('chatSession_active', 'chat_1', instance, 'interactive');
    manager.sessionCoordinator.activateSession('chatSession_active', instance);

    const updated = manager.updateSessionTitle('chatSession_active', 'Renamed Title');

    expect(updated).toBe(true);
    expect(instance.updateSessionTitle).toHaveBeenCalledWith('Renamed Title');
    expect(window.webContents.send).toHaveBeenCalledWith(
      'agentChat:chatSessionCacheCreated',
      expect.objectContaining({
        chatSessionId: 'chatSession_active',
        chatId: 'chat_1',
        initialData: expect.objectContaining({
          renderChatHistory: [],
          chatStatus: 'idle',
          contextTokenUsage: null,
          pendingInteractiveRequest: null,
        }),
      }),
    );
  });

  it('updates a non-current runtime session title without refreshing renderer cache', () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const currentInstance = {
      updateSessionTitle: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_current'),
      getDisplayMessages: vi.fn(() => []),
      getChatStatus: vi.fn(() => 'idle'),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn(() => vi.fn()),
      hasEventSender: vi.fn(() => true),
      destroy: vi.fn(),
    };
    const backgroundInstance = {
      updateSessionTitle: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_background'),
      getDisplayMessages: vi.fn(() => []),
      getChatStatus: vi.fn(() => 'idle'),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn(() => vi.fn()),
      hasEventSender: vi.fn(() => true),
      destroy: vi.fn(),
    };

    manager.setMainWindow(window as any);
    manager.registerManagedInstance('chatSession_current', 'chat_current', currentInstance, 'interactive');
    manager.registerManagedInstance('chatSession_background', 'chat_background', backgroundInstance, 'interactive');
    manager.sessionCoordinator.activateSession('chatSession_current', currentInstance);
    window.webContents.send.mockClear();

    const updated = manager.updateSessionTitle('chatSession_background', 'Background Renamed Title');

    expect(updated).toBe(true);
    expect(backgroundInstance.updateSessionTitle).toHaveBeenCalledWith('Background Renamed Title');
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'agentChat:chatSessionCacheCreated',
      expect.objectContaining({
        chatSessionId: 'chatSession_background',
      }),
    );
  });

  it('returns false when the runtime session exists but has no hydrated chat session', () => {
    const manager = createManager() as any;
    const instance = {
      updateSessionTitle: vi.fn(() => false),
      getChatId: vi.fn(() => 'chat_1'),
      getDisplayMessages: vi.fn(() => []),
      getChatStatus: vi.fn(() => 'idle'),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn(() => vi.fn()),
      hasEventSender: vi.fn(() => true),
      destroy: vi.fn(),
    };

    manager.registerManagedInstance('chatSession_unhydrated', 'chat_1', instance, 'interactive');

    expect(manager.updateSessionTitle('chatSession_unhydrated', 'Renamed Title')).toBe(false);
  });

  it('returns false when updating the title of a non-existent runtime session', () => {
    const manager = createManager() as any;

    expect(manager.updateSessionTitle('missing_session', 'Renamed Title')).toBe(false);
  });

  it('shows a system notification when a blurred current session finishes via retryChat', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_retry';
    const instance = {
      getChatStatus: vi.fn()
        .mockReturnValueOnce('sending_response')
        .mockReturnValueOnce('idle')
        .mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_retry'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Retry Session' })),
      retryChat: vi.fn().mockResolvedValue([{ id: 'msg_1' }]),
      getDisplayMessages: vi.fn(() => [{ id: 'msg_1' }]),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);
    manager.updateChatSessionReadStatus = vi.fn().mockResolvedValue(true);

    window.emitEvent('blur');
    const result = await manager.retryChat(activeSessionId);

    expect(result).toEqual({ success: true, data: [{ id: 'msg_1' }] });
    expect(manager.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_retry', activeSessionId, 'unread');
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].show).toHaveBeenCalledTimes(1);
  });

  it('resyncs frontend cache via notifyChatSessionCacheCreated after successful retryChat', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_retry_resync';
    const displayMessages = [
      { id: 'user_1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: 'assistant_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const instance = {
      getChatStatus: vi.fn().mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_resync'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Resync Session' })),
      retryChat: vi.fn().mockResolvedValue(displayMessages),
      getDisplayMessages: vi.fn(() => displayMessages),
      getContextTokenUsage: vi.fn(() => ({ used: 100, limit: 4000 })),
      getPendingInteractiveRequest: vi.fn(() => null),
    };

    manager.currentUserAlias = 'testuser';
    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);
    manager.updateChatSessionReadStatus = vi.fn().mockResolvedValue(true);

    const result = await manager.retryChat(activeSessionId);

    expect(result.success).toBe(true);
    // Verify the frontend cache was resynced with the full display messages
    expect(window.webContents.send).toHaveBeenCalledWith(
      'agentChat:chatSessionCacheCreated',
      expect.objectContaining({
        chatSessionId: activeSessionId,
        chatId: 'chat_resync',
        initialData: expect.objectContaining({
          renderChatHistory: displayMessages,
          chatStatus: 'idle',
        }),
      }),
    );
  });

  it('does NOT resync frontend cache when retryChat fails', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_retry_fail';
    const instance = {
      getChatStatus: vi.fn().mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_fail'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Fail Session' })),
      retryChat: vi.fn().mockRejectedValue(new Error('API 502')),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
    };

    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);

    const result = await manager.retryChat(activeSessionId);

    expect(result.success).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'agentChat:chatSessionCacheCreated',
      expect.objectContaining({ chatSessionId: activeSessionId }),
    );
  });

  it('does NOT resync frontend cache when retryChat is cancelled', async () => {
    const manager = createManager() as any;
    const window = createMockWindow();
    const activeSessionId = 'chatSession_retry_cancel';
    const instance = {
      getChatStatus: vi.fn().mockReturnValue('idle'),
      getChatId: vi.fn(() => 'chat_cancel'),
      getCurrentChatSession: vi.fn(() => ({ title: 'Cancel Session' })),
      retryChat: vi.fn().mockRejectedValue(new CancellationError('cancelled')),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
    };

    manager.setMainWindow(window as any);
    registerInteractiveSession(manager, activeSessionId, instance);

    const result = await manager.retryChat(activeSessionId);

    expect(result).toEqual({ success: true, data: [] });
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'agentChat:chatSessionCacheCreated',
      expect.objectContaining({ chatSessionId: activeSessionId }),
    );
  });

  it('interrupts pending interactive requests in the no-cancellation-source fallback path', async () => {
    const manager = createManager() as any;
    const instance = {
      getChatStatus: vi.fn(() => 'sending_response'),
      getAgentInfo: vi.fn().mockResolvedValue({ name: 'OpenKosmos' }),
      getChatId: vi.fn(() => 'chat_1'),
      cancelPush: vi.fn(),
      destroy: vi.fn(),
    };

    manager.registry.setInstance('chat_session_1', instance, 'interactive');
    mockInterruptSession.mockReturnValue(true);

    const result = await manager.cancelChatSession('chat_session_1');

    expect(result).toEqual({ success: true });
    expect(mockInterruptSession).toHaveBeenCalledWith('chat_session_1');
  });

  it('waits for the cancelled turn to reach idle before returning success', async () => {
    const manager = createManager() as any;
    const startTime = Date.now();
    const instance = {
      getChatStatus: vi.fn(() => (Date.now() - startTime >= 150 ? 'idle' : 'sending_response')),
      getAgentInfo: vi.fn().mockResolvedValue({ name: 'OpenKosmos' }),
      getChatId: vi.fn(() => 'chat_1'),
      invalidateActiveExecution: vi.fn(),
      cancelActiveToolExecution: vi.fn().mockResolvedValue(undefined),
      forceIdleStatus: vi.fn(),
      destroy: vi.fn(),
    };

    manager.registry.setInstance('chat_session_1', instance, 'interactive');
    manager.registry.getOrCreateCancellationSource('chat_session_1');

    const result = await manager.cancelChatSession('chat_session_1');

    expect(result).toEqual({ success: true });
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(150);
    expect(instance.getChatStatus).toHaveBeenCalledWith();
    expect(instance.cancelActiveToolExecution).toHaveBeenCalledTimes(1);
  });

  it('forces idle status immediately during cancel, not waiting for timeout', async () => {
    const manager = createManager() as any;
    const callOrder: string[] = [];
    const instance = {
      getChatStatus: vi.fn(() => {
        // After forceIdleStatus is called, return 'idle'
        return callOrder.includes('forceIdleStatus') ? 'idle' : 'received_response';
      }),
      getAgentInfo: vi.fn().mockResolvedValue({ name: 'OpenKosmos' }),
      getChatId: vi.fn(() => 'chat_1'),
      invalidateActiveExecution: vi.fn(),
      cancelActiveToolExecution: vi.fn().mockResolvedValue(undefined),
      forceIdleStatus: vi.fn(() => { callOrder.push('forceIdleStatus'); }),
      destroy: vi.fn(),
    };

    manager.registry.setInstance('chat_session_1', instance, 'interactive');
    manager.registry.getOrCreateCancellationSource('chat_session_1');

    const startTime = Date.now();
    const result = await manager.cancelChatSession('chat_session_1');

    expect(result).toEqual({ success: true });
    // forceIdleStatus should be called immediately, not after 5s timeout
    expect(Date.now() - startTime).toBeLessThan(2000);
    expect(instance.forceIdleStatus).toHaveBeenCalled();
  });
});

describe('AgentChatManager.editUserMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupManagerSingleton();
  });

  it('forwards the edit to AgentChat, clears the cancellation source, and returns messages', async () => {
    const manager = createManager() as any;
    const coordinatorHandleStatusChangeSpy = vi.spyOn(manager.sessionCoordinator, 'handleStatusChange');
    const statusListeners: Array<(status: string) => void> = [];
    const updatedMessage: Message = {
      id: 'user_2',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: 'updated prompt' }],
    };
    const returnedMessages = [updatedMessage];
    const instance = {
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn((listener: (status: string) => void) => {
        statusListeners.push(listener);
        return vi.fn();
      }),
      hasEventSender: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_1'),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      editUserMessage: vi.fn(async () => {
        statusListeners[0]?.('idle');
        return returnedMessages;
      }),
      getChatStatus: vi.fn(() => 'idle'),
      destroy: vi.fn(),
    };

    manager.registerManagedInstance('chat_session_1', 'chat_1', instance, 'interactive');
    manager.sessionCoordinator.activateSession('chat_session_1', instance);

    const result = await manager.editUserMessage('chat_session_1', 'user_2', updatedMessage);

    expect(result).toEqual({ success: true, data: returnedMessages });
    expect(instance.editUserMessage).toHaveBeenCalledWith(
      'user_2',
      updatedMessage,
      expect.objectContaining({ isCancellationRequested: false }),
    );
    expect(coordinatorHandleStatusChangeSpy).toHaveBeenCalledWith('chat_session_1', 'idle', 'interactive');
    expect(manager.registry.getCancellationSource('chat_session_1')).toBeNull();
  });

  it('returns a readable error when no AgentChat instance exists', async () => {
    const manager = createManager() as any;
    const updatedMessage: Message = {
      id: 'user_2',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: 'updated prompt' }],
    };

    const result = await manager.editUserMessage('missing_session', 'user_2', updatedMessage);

    expect(result).toEqual({
      success: false,
      error: 'No agent instance found for this chat session',
    });
  });

  it('treats cancellation as a successful empty result and cleans up state', async () => {
    const manager = createManager() as any;
    const coordinatorHandleStatusChangeSpy = vi.spyOn(manager.sessionCoordinator, 'handleStatusChange');
    const statusListeners: Array<(status: string) => void> = [];
    const updatedMessage: Message = {
      id: 'user_2',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: 'updated prompt' }],
    };
    const instance = {
      addContextChangeListener: vi.fn(),
      addStatusChangeListener: vi.fn((listener: (status: string) => void) => {
        statusListeners.push(listener);
        return vi.fn();
      }),
      hasEventSender: vi.fn(() => true),
      getChatId: vi.fn(() => 'chat_1'),
      getDisplayMessages: vi.fn(() => []),
      getContextTokenUsage: vi.fn(() => null),
      getPendingInteractiveRequest: vi.fn(() => null),
      editUserMessage: vi.fn(async () => {
        statusListeners[0]?.('idle');
        throw new CancellationError('cancelled');
      }),
      getChatStatus: vi.fn(() => 'idle'),
      destroy: vi.fn(),
    };

    manager.registerManagedInstance('chat_session_1', 'chat_1', instance, 'interactive');
    manager.sessionCoordinator.activateSession('chat_session_1', instance);

    const result = await manager.editUserMessage('chat_session_1', 'user_2', updatedMessage);

    expect(result).toEqual({ success: true, data: [] });
    expect(coordinatorHandleStatusChangeSpy).toHaveBeenCalledWith('chat_session_1', 'idle', 'interactive');
    expect(manager.registry.getCancellationSource('chat_session_1')).toBeNull();
  });

  it('returns edit precheck results from AgentChat without mutating state', () => {
    const manager = createManager() as any;
    const instance = {
      canEditUserMessage: vi.fn(() => ({
        canEdit: false,
        error: 'This message can no longer be edited because its original content has been compressed out of the current context.',
      })),
      destroy: vi.fn(),
    };

    manager.registry.setInstance('chat_session_1', instance, 'interactive');

    const result = manager.canEditUserMessage('chat_session_1', 'user_2');

    expect(result).toEqual({
      success: true,
      data: {
        canEdit: false,
        error: 'This message can no longer be edited because its original content has been compressed out of the current context.',
      },
    });
    expect(instance.canEditUserMessage).toHaveBeenCalledWith('user_2');
  });
});

describe('AgentChatManager.streamMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupManagerSingleton();
  });

  it('rejects sends when the session is not idle', async () => {
    const manager = createManager() as any;
    const message: Message = {
      id: 'user_1',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: 'hello' }],
    };
    const instance = {
      getChatStatus: vi.fn(() => 'sending_response'),
      streamMessage: vi.fn(),
      destroy: vi.fn(),
    };

    manager.registry.setInstance('chat_session_1', instance, 'interactive');

    const result = await manager.streamMessage('chat_session_1', message);

    expect(result).toEqual({
      success: false,
      error: 'Cannot send a new message while chat status is sending_response',
    });
    expect(instance.streamMessage).not.toHaveBeenCalled();
  });
});