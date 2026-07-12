/**
 * @vitest-environment happy-dom
 *
 * Branch-coverage tests for AgentChatSessionCacheManager.
 * Targets defensive branches not exercised by the existing test files:
 * - IPC handlers receiving payloads without chatSessionId
 * - handleChatSessionCacheDestroyed for unknown sessions
 * - registerDirectMessageUpdateCallback double-unregister and multi-callback paths
 * - React hooks: useCurrentChatId, useStreamingMessageId, CurrentSessionIdle, useMessagesWithStream
 * - Notify-callbacks error path
 */

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn(() => false));
const mockCreateLogger = vi.hoisted(() => vi.fn(() => ({
  debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(),
})));

vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }));
vi.mock('@/lib/utilities/logger', () => ({ createLogger: mockCreateLogger }));

// Mock external() so .use() calls invoke the calculator directly and we can
// exercise the selector branches without needing a real React-hooks environment.
vi.mock('@/atom/external', () => ({
  external: vi.fn(() => (calc: any) => ({ use: () => calc() })),
}));

const mockListeners: Record<string, (data: any) => void> = {};
function setupElectronAPI() {
  const makeListener = (name: string) => (cb: any) => {
    mockListeners[name] = cb;
    return () => { delete mockListeners[name]; };
  };
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      agentChat: {
        onCurrentChatSessionIdChanged: makeListener('currentChatSessionIdChanged'),
        onChatSessionCacheCreated: makeListener('chatSessionCacheCreated'),
        onChatSessionCacheDestroyed: makeListener('chatSessionCacheDestroyed'),
        onChatStatusChanged: makeListener('chatStatusChanged'),
        onContextChange: makeListener('contextChange'),
        onStreamingChunk: makeListener('streamingChunk'),
        onInteractionRequest: makeListener('interactionRequest'),
        onInteractionProcessed: makeListener('interactionProcessed'),
      },
    },
  });
}

setupElectronAPI();
import {
  AgentChatSessionCacheManager,
  agentChatSessionCacheManager,
  useCurrentChatId,
  useStreamingMessageId,
  useMessages,
  useMessagesWithStream,
  CurrentSessionStatus,
  CurrentSessionIdle,
  CurrentSessionError,
} from '../agentChatSessionCacheManager';

function freshManager(): AgentChatSessionCacheManager {
  (AgentChatSessionCacheManager as any).instance = undefined;
  return AgentChatSessionCacheManager.getInstance();
}

describe('AgentChatSessionCacheManager — IPC handlers reject payloads without chatSessionId', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('streamingChunk without chatSessionId is ignored', () => {
    expect(() =>
      mockListeners['streamingChunk']?.({ type: 'content', messageId: 'x', timestamp: 0 })
    ).not.toThrow();
    expect(mgr.getAllChatSessionCaches()).toEqual({});
  });

  it('interactionRequest without chatSessionId is ignored', () => {
    expect(() =>
      mockListeners['interactionRequest']?.({ interactionId: 'i', type: 'confirm' })
    ).not.toThrow();
  });

  it('interactionProcessed without chatSessionId is ignored', () => {
    expect(() =>
      mockListeners['interactionProcessed']?.({ interactionId: 'i' })
    ).not.toThrow();
  });
});

describe('AgentChatSessionCacheManager — handleChatSessionCacheDestroyed for unknown sessions', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('destroying a non-existent session is a no-op and does not clear current session', () => {
    mgr.createChatSessionCache('keep', 'chat-keep');
    mgr.setCurrentChatSessionId('chat-keep', 'keep');

    mockListeners['chatSessionCacheDestroyed']?.({ chatSessionId: 'unknown' });

    expect(mgr.getCurrentChatSessionId()).toBe('keep');
    expect(mgr.hasChatSessionCache('keep')).toBe(true);
  });
});

describe('AgentChatSessionCacheManager — registerDirectMessageUpdateCallback edge paths', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('unsubscribing twice is a no-op (set already removed)', () => {
    mgr.createChatSessionCache('sess', 'chat');
    const cb = vi.fn();
    const unsub = mgr.registerDirectMessageUpdateCallback('sess', cb);
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('unsubscribing one of two callbacks keeps the set alive', () => {
    mgr.createChatSessionCache('sess', 'chat');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = mgr.registerDirectMessageUpdateCallback('sess', cb1);
    mgr.registerDirectMessageUpdateCallback('sess', cb2);

    unsub1();

    const set = (mgr as any).directMessageUpdateCallbacks.get('sess');
    expect(set).toBeDefined();
    expect(set.size).toBe(1);
    expect(set.has(cb2)).toBe(true);
  });
});

describe('AgentChatSessionCacheManager — notifyCurrentChatSessionIdCallbacks error path', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('does not throw when a subscriber throws', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    mgr.subscribeToCurrentChatSessionId(bad, true);
    mgr.subscribeToCurrentChatSessionId(good, true);

    expect(() => mgr.setCurrentChatSessionId('c', 's')).not.toThrow();
    expect(bad).toHaveBeenCalledWith('s');
    expect(good).toHaveBeenCalledWith('s');
  });
});

describe('AgentChatSessionCacheManager — React hook integration covers selector branches', () => {
  let activeUnmount: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    // Use the module's singleton — selectors close over it, so freshManager()
    // would leave them pointing at a stale instance.
    agentChatSessionCacheManager.cleanup();
    activeUnmount = null;
  });

  afterEach(() => {
    if (activeUnmount) {
      act(() => activeUnmount!());
      activeUnmount = null;
    }
    agentChatSessionCacheManager.cleanup();
  });

  it('useCurrentChatId reflects manager chatId and updates on session change', () => {
    let renderedId: string | null | undefined;
    const Probe = () => {
      renderedId = useCurrentChatId();
      return <div data-testid="id">{renderedId ?? 'null'}</div>;
    };
    const result = render(<Probe />);
    activeUnmount = result.unmount;
    expect(renderedId).toBeNull();

    act(() => agentChatSessionCacheManager.setCurrentChatSessionId('chat-A', 'sess-A'));
    expect(renderedId).toBe('chat-A');
  });

  it('useStreamingMessageId returns null when no current session, then tracks streaming id', () => {
    let value: string | null | undefined;
    const Probe = () => {
      value = useStreamingMessageId();
      return null;
    };
    const result = render(<Probe />);
    activeUnmount = result.unmount;
    expect(value).toBeNull();

    act(() => {
      agentChatSessionCacheManager.createChatSessionCache('sess-stream', 'chat-stream');
      agentChatSessionCacheManager.setCurrentChatSessionId('chat-stream', 'sess-stream');
      agentChatSessionCacheManager.getChatSessionCache('sess-stream')!.streamingMessageId = 'msg-42';
    });
    expect(value).toBe('msg-42');
  });

  it('useMessages returns the cached messages array', () => {
    let value: any;
    const Probe = () => {
      value = useMessages();
      return null;
    };
    agentChatSessionCacheManager.createChatSessionCache('sess-msgs', 'chat-msgs');
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-msgs', 'sess-msgs');
    agentChatSessionCacheManager.addUserMessage('sess-msgs', { id: 'u1', role: 'user', content: [], timestamp: 0 } as any);

    const result = render(<Probe />);
    activeUnmount = result.unmount;
    expect(Array.isArray(value)).toBe(true);
    expect(value.length).toBe(1);
  });

  it('useMessagesWithStream returns empty payload when there is no current session', () => {
    let value: any;
    const Probe = () => {
      value = useMessagesWithStream();
      return null;
    };
    const result = render(<Probe />);
    activeUnmount = result.unmount;
    expect(value.messages).toEqual([]);
    expect(value.streamingMessageId).toBeUndefined();
  });

  it('useMessagesWithStream returns session messages + streamingMessageId when set', () => {
    agentChatSessionCacheManager.createChatSessionCache('sess-mws', 'chat-mws');
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-mws', 'sess-mws');
    agentChatSessionCacheManager.getChatSessionCache('sess-mws')!.streamingMessageId = 'stream-msg';

    let value: any;
    const Probe = () => {
      value = useMessagesWithStream();
      return null;
    };
    const result = render(<Probe />);
    activeUnmount = result.unmount;
    expect(value.streamingMessageId).toBe('stream-msg');
    expect(Array.isArray(value.messages)).toBe(true);
  });

  it('CurrentSessionStatus falls back to idle when no cache exists for the current session', () => {
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-orphan', 'sess-orphan');

    const status = CurrentSessionStatus.use();
    expect(status.chatStatus).toBe('idle');
    expect(status.chatSessionId).toBe('sess-orphan');
  });

  it('CurrentSessionStatus reads chatStatus from the active cache', () => {
    agentChatSessionCacheManager.createChatSessionCache('sess-have', 'chat-have');
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-have', 'sess-have');
    (agentChatSessionCacheManager as any).handleChatStatusChanged('sess-have', 'sending_response');

    const status = CurrentSessionStatus.use();
    expect(status.chatStatus).toBe('sending_response');
  });

  it('CurrentSessionIdle returns true when no session', () => {
    expect(CurrentSessionIdle.use()).toBe(true);
  });

  it('CurrentSessionIdle returns true when status is idle, false otherwise', () => {
    agentChatSessionCacheManager.createChatSessionCache('sess-idle', 'chat-idle');
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-idle', 'sess-idle');
    expect(CurrentSessionIdle.use()).toBe(true);

    (agentChatSessionCacheManager as any).handleChatStatusChanged('sess-idle', 'sending_response');
    expect(CurrentSessionIdle.use()).toBe(false);
  });

  it('CurrentSessionError returns null when no session', () => {
    expect(CurrentSessionError.use()).toBeNull();
  });

  it('CurrentSessionError surfaces an error message set on the active cache', () => {
    agentChatSessionCacheManager.createChatSessionCache('sess-e', 'chat-e');
    agentChatSessionCacheManager.setCurrentChatSessionId('chat-e', 'sess-e');
    agentChatSessionCacheManager.setErrorMessage('sess-e', 'kaboom');
    expect(CurrentSessionError.use()).toBe('kaboom');
  });
});
