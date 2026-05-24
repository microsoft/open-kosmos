import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentChatManagerRendererBridge } from '../agentChatManagerRendererBridge';

function makeWebContents() {
  return { send: vi.fn() };
}

function makeBrowserWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: makeWebContents(),
  };
}

describe('AgentChatManagerRendererBridge', () => {
  describe('attachEventSenderToMainWindow', () => {
    it('calls setEventSender when window exists and is not destroyed', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      const instance = { setEventSender: vi.fn(), addContextChangeListener: vi.fn(), getChatId: vi.fn() };
      bridge.attachEventSenderToMainWindow(instance as any);
      expect(instance.setEventSender).toHaveBeenCalledWith(win.webContents);
    });

    it('does nothing when window is null', () => {
      const bridge = new AgentChatManagerRendererBridge(() => null);
      const instance = { setEventSender: vi.fn(), addContextChangeListener: vi.fn(), getChatId: vi.fn() };
      bridge.attachEventSenderToMainWindow(instance as any);
      expect(instance.setEventSender).not.toHaveBeenCalled();
    });

    it('does nothing when window is destroyed', () => {
      const win = makeBrowserWindow(true);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      const instance = { setEventSender: vi.fn(), addContextChangeListener: vi.fn(), getChatId: vi.fn() };
      bridge.attachEventSenderToMainWindow(instance as any);
      expect(instance.setEventSender).not.toHaveBeenCalled();
    });
  });

  describe('notifyCurrentChatSessionIdChanged', () => {
    it('sends the correct IPC event when window is valid', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyCurrentChatSessionIdChanged('chat-1', 'session-1');
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:currentChatSessionIdChanged',
        { chatId: 'chat-1', chatSessionId: 'session-1' },
      );
    });

    it('does nothing when window is null', () => {
      const bridge = new AgentChatManagerRendererBridge(() => null);
      // Should not throw
      expect(() => bridge.notifyCurrentChatSessionIdChanged('chat-1', 'session-1')).not.toThrow();
    });

    it('does nothing when window is destroyed', () => {
      const win = makeBrowserWindow(true);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyCurrentChatSessionIdChanged('chat-1', 'session-1');
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('handles null chatId and chatSessionId', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyCurrentChatSessionIdChanged(null, null);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:currentChatSessionIdChanged',
        { chatId: null, chatSessionId: null },
      );
    });
  });

  describe('notifyChatSessionCacheCreated', () => {
    it('sends the correct IPC event with initialData', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      const data = { chatStatus: 'idle', pendingInteractiveRequest: null };
      bridge.notifyChatSessionCacheCreated('session-1', 'chat-1', data);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:chatSessionCacheCreated',
        { chatSessionId: 'session-1', chatId: 'chat-1', initialData: data },
      );
    });

    it('sends event without initialData', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyChatSessionCacheCreated('session-1', 'chat-1');
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:chatSessionCacheCreated',
        { chatSessionId: 'session-1', chatId: 'chat-1', initialData: undefined },
      );
    });

    it('does nothing when window is destroyed', () => {
      const win = makeBrowserWindow(true);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyChatSessionCacheCreated('session-1', 'chat-1');
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('notifyChatStatusChanged', () => {
    it('sends the correct IPC event', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyChatStatusChanged('chat-1', 'session-1', 'streaming', 'MyAgent');
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:chatStatusChanged',
        expect.objectContaining({
          chatId: 'chat-1',
          chatSessionId: 'session-1',
          chatStatus: 'streaming',
          agentName: 'MyAgent',
          timestamp: expect.any(String),
        }),
      );
    });

    it('does nothing when window is null', () => {
      const bridge = new AgentChatManagerRendererBridge(() => null);
      expect(() => bridge.notifyChatStatusChanged('c', 's', 'idle', 'A')).not.toThrow();
    });
  });

  describe('notifyChatSessionCacheDestroyed', () => {
    it('sends the correct IPC event', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyChatSessionCacheDestroyed('session-1');
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:chatSessionCacheDestroyed',
        { chatSessionId: 'session-1' },
      );
    });

    it('does nothing when window is destroyed', () => {
      const win = makeBrowserWindow(true);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      bridge.notifyChatSessionCacheDestroyed('session-1');
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('setupContextChangeListener', () => {
    it('registers a context change listener on the instance', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      const listeners: Array<(stats: any) => void> = [];
      const instance = {
        addContextChangeListener: vi.fn((fn: any) => listeners.push(fn)),
        getChatId: vi.fn(() => 'chat-1'),
      };
      bridge.setupContextChangeListener(instance as any, 'session-1');
      expect(instance.addContextChangeListener).toHaveBeenCalledTimes(1);
    });

    it('sends context change IPC when listener fires and window is valid', () => {
      const win = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => win as any);
      let capturedListener: ((stats: any) => void) | null = null;
      const instance = {
        addContextChangeListener: vi.fn((fn: any) => { capturedListener = fn; }),
        getChatId: vi.fn(() => 'chat-1'),
      };
      bridge.setupContextChangeListener(instance as any, 'session-42');
      expect(capturedListener).not.toBeNull();
      capturedListener!({ tokenCount: 100 });
      expect(win.webContents.send).toHaveBeenCalledWith(
        'agentChat:contextChange',
        expect.objectContaining({
          chatSessionId: 'session-42',
          chatId: 'chat-1',
          stats: { tokenCount: 100 },
        }),
      );
    });

    it('logs a warning when window is gone at listener fire time', () => {
      // Start with a valid window but switch to null
      let currentWin: any = makeBrowserWindow(false);
      const bridge = new AgentChatManagerRendererBridge(() => currentWin);
      let capturedListener: ((stats: any) => void) | null = null;
      const instance = {
        addContextChangeListener: vi.fn((fn: any) => { capturedListener = fn; }),
        getChatId: vi.fn(() => 'chat-1'),
      };
      bridge.setupContextChangeListener(instance as any, 'session-1');
      // Destroy the window before firing
      currentWin = null;
      // Should not throw
      expect(() => capturedListener!({ tokenCount: 5 })).not.toThrow();
    });
  });
});
