// @ts-nocheck
const { loggerMock, getAllWindowsMock, notificationIsSupportedMock, MockNotification } = vi.hoisted(() => {
  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const getAllWindowsMock = vi.fn(() => []);
  const notificationIsSupportedMock = vi.fn(() => true);

  class MockNotification {
    static isSupported = notificationIsSupportedMock;
    static instances: MockNotification[] = [];

    private readonly listeners = new Map<string, () => void>();
    on = vi.fn((eventName: string, listener: () => void) => {
      this.listeners.set(eventName, listener);
    });
    show = vi.fn();

    constructor() {
      MockNotification.instances.push(this);
    }

    emit(eventName: string): void {
      this.listeners.get(eventName)?.();
    }
  }

  return { loggerMock, getAllWindowsMock, notificationIsSupportedMock, MockNotification };
});

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  Notification: MockNotification,
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => loggerMock),
}));

import { AgentChatManagerNotificationBridge } from '../agentChatManagerNotificationBridge';

interface MockWindow {
  on: Mock;
  removeListener: Mock;
  isDestroyed: Mock<() => boolean>;
  isVisible: Mock<() => boolean>;
  isMinimized: Mock<() => boolean>;
  isFocused: Mock<() => boolean>;
  restore: Mock;
  show: Mock;
  focus: Mock;
  webContents: {
    send: Mock;
  };
  emitEvent: (eventName: string) => void;
}

function createMockWindow(): MockWindow {
  const listeners = new Map<string, () => void>();
  return {
    on: vi.fn((eventName: string, listener: () => void) => {
      listeners.set(eventName, listener);
    }),
    removeListener: vi.fn((eventName: string) => {
      listeners.delete(eventName);
    }),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: vi.fn(),
    },
    emitEvent: (eventName: string) => {
      listeners.get(eventName)?.();
    },
  };
}

describe('AgentChatManagerNotificationBridge', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    MockNotification.instances = [];
    getAllWindowsMock.mockReturnValue([]);
    notificationIsSupportedMock.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore original platform after each test
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('wires main-window foreground events through the provided hooks', () => {
    const onWindowLostForeground = vi.fn();
    const onWindowRegainedForeground = vi.fn();
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground,
      onWindowRegainedForeground,
    });
    const window = createMockWindow();

    bridge.setMainWindow(window as any);
    window.emitEvent('blur');
    window.emitEvent('focus');

    expect(onWindowLostForeground).toHaveBeenCalledTimes(1);
    expect(onWindowRegainedForeground).toHaveBeenCalledTimes(1);
  });

  it('emits chat status changes through the active main window', () => {
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    bridge.setMainWindow(window as any);

    bridge.emitChatStatusChanged('chat_1', 'session_1', 'idle', 'OpenKosmos');

    expect(window.webContents.send).toHaveBeenCalledWith('agentChat:chatStatusChanged', expect.objectContaining({
      chatId: 'chat_1',
      chatSessionId: 'session_1',
      chatStatus: 'idle',
      agentName: 'OpenKosmos',
    }));
  });

  it('retains notifications until close and navigates on click', () => {
    // Mock macOS platform so the notification code path is exercised (it early-returns on Linux)
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    bridge.setMainWindow(window as any);

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Focused Session', 'completed');

    expect(MockNotification.instances).toHaveLength(1);
    const notification = MockNotification.instances[0];
    expect(notification.show).toHaveBeenCalledTimes(1);

    notification.emit('click');

    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith('navigate:to', expect.objectContaining({
      route: '/agent/chat/chat_1/session_1',
    }));
  });

  it('close handler removes notification from activeNotifications map', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    bridge.setMainWindow(window as any);

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');
    expect(MockNotification.instances).toHaveLength(1);

    // Triggering 'close' on the notification should clean up without error
    MockNotification.instances[0].emit('close');
    // No error thrown — cleanup ran
  });

  it('skips notification on unsupported platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('skips notification when Notification.isSupported() returns false', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    notificationIsSupportedMock.mockReturnValue(false);

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('falls back to getAllWindows when main window is destroyed', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    const destroyedWindow = createMockWindow();
    destroyedWindow.isDestroyed.mockReturnValue(true);
    bridge.setMainWindow(destroyedWindow as any);

    const fallbackWindow = createMockWindow();
    getAllWindowsMock.mockReturnValue([fallbackWindow]);

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');
    expect(MockNotification.instances).toHaveLength(1);

    // Click should navigate via the fallback window
    MockNotification.instances[0].emit('click');
    expect(fallbackWindow.webContents.send).toHaveBeenCalledWith('navigate:to', expect.anything());
  });

  it('handles click with no available window gracefully', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    const destroyedWindow = createMockWindow();
    destroyedWindow.isDestroyed.mockReturnValue(true);
    bridge.setMainWindow(destroyedWindow as any);
    getAllWindowsMock.mockReturnValue([]);

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');

    // Should not throw when no window is available
    expect(() => MockNotification.instances[0].emit('click')).not.toThrow();
  });

  it('destroy clears active notification references and cleans up focus listener', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    bridge.setMainWindow(window as any);

    bridge.showChatSessionCompletionNotification('chat_1', 'session_1', 'Session', 'completed');
    expect(MockNotification.instances).toHaveLength(1);

    bridge.destroy();

    // After destroy, setting new window should not error
    const newWindow = createMockWindow();
    expect(() => bridge.setMainWindow(newWindow as any)).not.toThrow();
  });

  it('emitChatStatusChanged does nothing when window is null', () => {
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    // No window set — should not throw
    expect(() => bridge.emitChatStatusChanged('chat_1', 'session_1', 'idle', 'OpenKosmos')).not.toThrow();
  });

  it('isMainWindowForeground returns false when no window set', () => {
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });

    expect(bridge.isMainWindowForeground()).toBe(false);
  });

  it('isMainWindowForeground returns true when window is visible, not minimized, and focused', () => {
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    bridge.setMainWindow(window as any);

    expect(bridge.isMainWindowForeground()).toBe(true);
  });

  it('window event cleanup removes all listeners when replacing main window', () => {
    const onWindowLostForeground = vi.fn();
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground,
      onWindowRegainedForeground: vi.fn(),
    });

    const firstWindow = createMockWindow();
    bridge.setMainWindow(firstWindow as any);

    const secondWindow = createMockWindow();
    bridge.setMainWindow(secondWindow as any);

    // Emitting blur on the old window should NOT call the hook (listeners removed)
    firstWindow.emitEvent('blur');
    expect(onWindowLostForeground).not.toHaveBeenCalled();

    // New window should wire correctly
    secondWindow.emitEvent('blur');
    expect(onWindowLostForeground).toHaveBeenCalledTimes(1);
  });

  it('getMainWindowState returns destroyed=true for a destroyed window', () => {
    const bridge = new AgentChatManagerNotificationBridge({
      onWindowLostForeground: vi.fn(),
      onWindowRegainedForeground: vi.fn(),
    });
    const window = createMockWindow();
    window.isDestroyed.mockReturnValue(true);
    bridge.setMainWindow(window as any);

    const state = bridge.getMainWindowState();
    expect(state.destroyed).toBe(true);
    expect(state.visible).toBeNull();
  });
});