// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ─────────────────────────────────────────────────────────
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn(() => false));
const mockCreateLogger = vi.hoisted(() => vi.fn(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
})));

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: mockCreateLogger,
}));

vi.mock('@/atom/external', () => ({
  external: vi.fn(() => (calc: any) => ({
    use: () => calc(),
  })),
}));

// Stub window.electronAPI.agentChat before module import
const mockAgentChatListeners: Record<string, (data: any) => void> = {};
function setupElectronAPI() {
  const makeListener = (eventName: string) => (cb: any) => {
    mockAgentChatListeners[eventName] = cb;
    return () => { delete mockAgentChatListeners[eventName]; };
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

// ── imports after mocks ───────────────────────────────────────────────────────
setupElectronAPI();
import {
  AgentChatSessionCacheManager,
  extractFilePathsFromText,
} from '../agentChatSessionCacheManager';

// Helper to create a fresh manager instance (resets singleton)
function freshManager(): AgentChatSessionCacheManager {
  // Reset the static singleton so each test starts clean
  (AgentChatSessionCacheManager as any).instance = undefined;
  return AgentChatSessionCacheManager.getInstance();
}

describe('AgentChatSessionCacheManager', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  // ── singleton ──────────────────────────────────────────────────────────────
  it('getInstance() returns the same instance', () => {
    const a = AgentChatSessionCacheManager.getInstance();
    const b = AgentChatSessionCacheManager.getInstance();
    expect(a).toBe(b);
  });

  // ── initial state ──────────────────────────────────────────────────────────
  it('starts with null currentChatId and currentChatSessionId', () => {
    expect(mgr.getCurrentChatId()).toBeNull();
    expect(mgr.getCurrentChatSessionId()).toBeNull();
  });

  it('hasChatSessionCache returns false for unknown session', () => {
    expect(mgr.hasChatSessionCache('nonexistent')).toBe(false);
    expect(mgr.hasChatSessionCache(null)).toBe(false);
    expect(mgr.hasChatSessionCache(undefined)).toBe(false);
  });

  it('getChatSessionCache returns null for unknown session', () => {
    expect(mgr.getChatSessionCache('nope')).toBeNull();
  });

  it('getCurrentChatSessionCache returns null when no current session', () => {
    expect(mgr.getCurrentChatSessionCache()).toBeNull();
  });

  // ── createChatSessionCache / getChatSessionCache ───────────────────────────
  it('createChatSessionCache creates a cache entry', () => {
    mgr.createChatSessionCache('session-1', 'chat-1');
    expect(mgr.hasChatSessionCache('session-1')).toBe(true);
    const cache = mgr.getChatSessionCache('session-1');
    expect(cache).not.toBeNull();
    expect(cache!.chatSessionId).toBe('session-1');
    expect(cache!.chatId).toBe('chat-1');
    expect(cache!.chatStatus).toBe('idle');
    expect(cache!.messages).toEqual([]);
  });

  it('createChatSessionCache with initialData uses provided messages', () => {
    const messages = [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 }] as any;
    mgr.createChatSessionCache('session-2', 'chat-2', { messages });
    const cache = mgr.getChatSessionCache('session-2');
    expect(cache!.messages).toEqual(messages);
  });

  it('createChatSessionCache with legacy renderChatHistory fallback', () => {
    const msgs = [{ id: 'm2', role: 'assistant', content: [], timestamp: 0 }] as any;
    mgr.createChatSessionCache('session-3', 'chat-3', { renderChatHistory: msgs } as any);
    const cache = mgr.getChatSessionCache('session-3');
    expect(cache!.messages).toEqual(msgs);
  });

  it('createChatSessionCache ignores duplicate calls (cache already exists)', () => {
    mgr.createChatSessionCache('session-dup', 'chat-1');
    // Second call should be a no-op (cache already exists)
    mgr.createChatSessionCache('session-dup', 'chat-1');
    expect(mgr.hasChatSessionCache('session-dup')).toBe(true);
  });

  // ── setCurrentChatSessionId ────────────────────────────────────────────────
  it('setCurrentChatSessionId updates current IDs and notifies', () => {
    const cb = vi.fn();
    mgr.subscribeToCurrentChatSessionId(cb, true);

    mgr.setCurrentChatSessionId('chat-A', 'session-A');

    expect(mgr.getCurrentChatId()).toBe('chat-A');
    expect(mgr.getCurrentChatSessionId()).toBe('session-A');
    expect(cb).toHaveBeenCalledWith('session-A');
  });

  it('setCurrentChatSessionId is a no-op when values are unchanged', () => {
    mgr.setCurrentChatSessionId('chat-A', 'session-A');
    const cb = vi.fn();
    mgr.subscribeToCurrentChatSessionId(cb, true);

    mgr.setCurrentChatSessionId('chat-A', 'session-A'); // same values

    expect(cb).not.toHaveBeenCalled();
  });

  // ── subscribeToCurrentChatSessionId ───────────────────────────────────────
  it('subscribeToCurrentChatSessionId fires immediately when skipFirst=false', () => {
    mgr.setCurrentChatSessionId('c', 's');
    const cb = vi.fn();
    mgr.subscribeToCurrentChatSessionId(cb);
    expect(cb).toHaveBeenCalledWith('s');
  });

  it('subscribeToCurrentChatSessionId unsubscribe prevents future calls', () => {
    const cb = vi.fn();
    const unsub = mgr.subscribeToCurrentChatSessionId(cb, true);
    unsub();
    mgr.setCurrentChatSessionId('c', 's');
    expect(cb).not.toHaveBeenCalled();
  });

  // ── subscribeToChatSessionCacheLifecycle ───────────────────────────────────
  it('subscribeToChatSessionCacheLifecycle fires when cache is created', async () => {
    const cb = vi.fn();
    mgr.subscribeToChatSessionCacheLifecycle(cb);
    mgr.createChatSessionCache('sess-life', 'chat-life');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cb).toHaveBeenCalledWith('sess-life');
  });

  it('subscribeToChatSessionCacheLifecycle unsubscribe stops events', async () => {
    const cb = vi.fn();
    const unsub = mgr.subscribeToChatSessionCacheLifecycle(cb);
    unsub();
    mgr.createChatSessionCache('sess-unsub', 'chat-unsub');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cb).not.toHaveBeenCalled();
  });

  // ── addUserMessage ─────────────────────────────────────────────────────────
  it('addUserMessage appends to messages', () => {
    mgr.createChatSessionCache('sess-msg', 'chat-msg');
    const msg: any = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 0 };
    mgr.addUserMessage('sess-msg', msg);
    expect(mgr.getChatSessionCache('sess-msg')!.messages).toContainEqual(msg);
  });

  it('addUserMessage does nothing for missing cache', () => {
    // Should not throw
    const msg: any = { id: 'u1', role: 'user', content: [], timestamp: 0 };
    expect(() => mgr.addUserMessage('nonexistent', msg)).not.toThrow();
  });

  it('addUserMessage ignores user_img_ messages when browserControl enabled', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    mgr.createChatSessionCache('sess-img', 'chat-img');
    const imgMsg: any = { id: 'user_img_1', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess-img', imgMsg);
    expect(mgr.getChatSessionCache('sess-img')!.messages).toHaveLength(0);
    mockIsFeatureEnabled.mockReturnValue(false);
  });

  // ── removeMessage ──────────────────────────────────────────────────────────
  it('removeMessage removes a message by id', () => {
    mgr.createChatSessionCache('sess-rm', 'chat-rm');
    const msg: any = { id: 'r1', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess-rm', msg);
    expect(mgr.getChatSessionCache('sess-rm')!.messages).toHaveLength(1);
    mgr.removeMessage('sess-rm', 'r1');
    expect(mgr.getChatSessionCache('sess-rm')!.messages).toHaveLength(0);
  });

  it('removeMessage is a no-op for missing cache', () => {
    expect(() => mgr.removeMessage('no-cache', 'm1')).not.toThrow();
  });

  it('removeMessage is a no-op when message not found', () => {
    mgr.createChatSessionCache('sess-rm2', 'chat-rm2');
    const msg: any = { id: 'x1', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess-rm2', msg);
    mgr.removeMessage('sess-rm2', 'notexist');
    expect(mgr.getChatSessionCache('sess-rm2')!.messages).toHaveLength(1);
  });

  // ── replaceMessages ────────────────────────────────────────────────────────
  it('replaceMessages replaces messages array', () => {
    mgr.createChatSessionCache('sess-replace', 'chat-replace');
    const newMsgs: any[] = [{ id: 'n1', role: 'assistant', content: [{ type: 'text', text: 'new' }], timestamp: 0 }];
    mgr.replaceMessages('sess-replace', newMsgs);
    expect(mgr.getChatSessionCache('sess-replace')!.messages).toEqual(newMsgs);
  });

  it('replaceMessages does nothing for missing cache', () => {
    expect(() => mgr.replaceMessages('no-cache', [])).not.toThrow();
  });

  // ── setAssistantSayHiMessage ───────────────────────────────────────────────
  it('setAssistantSayHiMessage inserts say-hi message', () => {
    mgr.createChatSessionCache('sess-sayhi', 'chat-sayhi');
    mgr.setAssistantSayHiMessage('sess-sayhi', 'Hello there!');
    const msgs = mgr.getChatSessionCache('sess-sayhi')!.messages;
    expect(msgs.some(m => m.id?.startsWith('say-hi-'))).toBe(true);
  });

  it('setAssistantSayHiMessage inserts after system message if present', () => {
    mgr.createChatSessionCache('sess-sayhi-sys', 'chat-sayhi-sys');
    const sysMsg: any = { id: 'sys1', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }], timestamp: 0 };
    mgr.getChatSessionCache('sess-sayhi-sys')!.messages.push(sysMsg);
    mgr.setAssistantSayHiMessage('sess-sayhi-sys', 'Hi!');
    const msgs = mgr.getChatSessionCache('sess-sayhi-sys')!.messages;
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].id?.startsWith('say-hi-')).toBe(true);
  });

  it('setAssistantSayHiMessage clears message when given null', () => {
    mgr.createChatSessionCache('sess-clear-hi', 'chat-clear-hi');
    mgr.setAssistantSayHiMessage('sess-clear-hi', 'Yo!');
    mgr.setAssistantSayHiMessage('sess-clear-hi', null);
    const msgs = mgr.getChatSessionCache('sess-clear-hi')!.messages;
    expect(msgs.some(m => m.id?.startsWith('say-hi-'))).toBe(false);
  });

  it('setAssistantSayHiMessage does nothing for missing cache', () => {
    expect(() => mgr.setAssistantSayHiMessage('no-cache', 'hi')).not.toThrow();
  });

  // ── getUserMessageSendState ────────────────────────────────────────────────
  it('getUserMessageSendState returns canSend=false when no sessionId', () => {
    const result = mgr.getUserMessageSendState(null);
    expect(result.canSend).toBe(false);
  });

  it('getUserMessageSendState returns canSend=true when status is idle', () => {
    mgr.createChatSessionCache('sess-send', 'chat-send');
    const result = mgr.getUserMessageSendState('sess-send');
    expect(result.canSend).toBe(true);
    expect(result.error).toBe('');
  });

  it('getUserMessageSendState returns canSend=false when status is sending_response', () => {
    mgr.createChatSessionCache('sess-busy', 'chat-busy');
    (mgr as any).handleChatStatusChanged('sess-busy', 'sending_response');
    const result = mgr.getUserMessageSendState('sess-busy');
    expect(result.canSend).toBe(false);
    expect(result.error).toContain('sending_response');
  });

  it('getUserMessageSendState returns canSend=false when no cache exists', () => {
    const result = mgr.getUserMessageSendState('nonexistent');
    expect(result.canSend).toBe(false);
    expect(result.chatStatus).toBeNull();
  });

  // ── waitForSendReady ───────────────────────────────────────────────────────
  it('waitForSendReady resolves true immediately when already idle', async () => {
    mgr.createChatSessionCache('sess-ready', 'chat-ready');
    const result = await mgr.waitForSendReady('sess-ready', 100);
    expect(result).toBe(true);
  });

  it('waitForSendReady resolves false on timeout', async () => {
    mgr.createChatSessionCache('sess-timeout', 'chat-timeout');
    (mgr as any).handleChatStatusChanged('sess-timeout', 'sending_response');
    const result = await mgr.waitForSendReady('sess-timeout', 50);
    expect(result).toBe(false);
  });

  it('waitForSendReady resolves true when status transitions to idle', async () => {
    mgr.createChatSessionCache('sess-wait', 'chat-wait');
    (mgr as any).handleChatStatusChanged('sess-wait', 'sending_response');

    const promise = mgr.waitForSendReady('sess-wait', 1000);
    // Simulate backend sending idle
    setTimeout(() => (mgr as any).handleChatStatusChanged('sess-wait', 'idle'), 20);
    const result = await promise;
    expect(result).toBe(true);
  });

  // ── getAllChatSessionCaches ────────────────────────────────────────────────
  it('getAllChatSessionCaches returns all caches', () => {
    mgr.createChatSessionCache('s-all-1', 'c-all-1');
    mgr.createChatSessionCache('s-all-2', 'c-all-2');
    const all = mgr.getAllChatSessionCaches();
    expect(all['s-all-1']).toBeDefined();
    expect(all['s-all-2']).toBeDefined();
  });

  // ── setErrorMessage / clearErrorMessage ───────────────────────────────────
  it('setErrorMessage sets error message', () => {
    mgr.createChatSessionCache('sess-err', 'chat-err');
    mgr.setErrorMessage('sess-err', 'Something went wrong');
    expect(mgr.getChatSessionCache('sess-err')!.errorMessage).toBe('Something went wrong');
  });

  it('clearErrorMessage clears error message', () => {
    mgr.createChatSessionCache('sess-err2', 'chat-err2');
    mgr.setErrorMessage('sess-err2', 'oops');
    mgr.clearErrorMessage('sess-err2');
    expect(mgr.getChatSessionCache('sess-err2')!.errorMessage).toBeNull();
  });

  it('setErrorMessage does nothing for missing cache', () => {
    expect(() => mgr.setErrorMessage('no-cache', 'err')).not.toThrow();
  });

  it('clearErrorMessage does nothing for missing cache', () => {
    expect(() => mgr.clearErrorMessage('no-cache')).not.toThrow();
  });

  // ── cleanup ────────────────────────────────────────────────────────────────
  it('cleanup clears all session caches and resets current session', () => {
    mgr.createChatSessionCache('sess-cleanup', 'chat-cleanup');
    mgr.setCurrentChatSessionId('chat-cleanup', 'sess-cleanup');
    mgr.cleanup();
    expect(mgr.hasChatSessionCache('sess-cleanup')).toBe(false);
    expect(mgr.getCurrentChatSessionId()).toBeNull();
  });

  // ── registerDirectMessageUpdateCallback ───────────────────────────────────
  it('registerDirectMessageUpdateCallback registers and unregisters callback', () => {
    mgr.createChatSessionCache('sess-cb', 'chat-cb');
    mgr.setCurrentChatSessionId('chat-cb', 'sess-cb');
    const cb = vi.fn();
    const unsub = mgr.registerDirectMessageUpdateCallback('sess-cb', cb);
    unsub();
    // After unsubscribing, no callbacks should remain for that session
    const set = (mgr as any).directMessageUpdateCallbacks.get('sess-cb');
    expect(!set || set.size === 0).toBe(true);
  });

  // ── IPC event integration ──────────────────────────────────────────────────
  it('IPC currentChatSessionIdChanged updates current session', () => {
    mockAgentChatListeners['currentChatSessionIdChanged']?.({ chatId: 'c1', chatSessionId: 's1' });
    expect(mgr.getCurrentChatId()).toBe('c1');
    expect(mgr.getCurrentChatSessionId()).toBe('s1');
  });

  it('IPC chatSessionCacheCreated creates a cache entry', () => {
    mockAgentChatListeners['chatSessionCacheCreated']?.({
      chatSessionId: 'ipc-sess',
      chatId: 'ipc-chat',
      initialData: { messages: [] }
    });
    expect(mgr.hasChatSessionCache('ipc-sess')).toBe(true);
  });

  it('IPC chatSessionCacheDestroyed removes the cache entry', () => {
    mgr.createChatSessionCache('destroy-sess', 'destroy-chat');
    mockAgentChatListeners['chatSessionCacheDestroyed']?.({ chatSessionId: 'destroy-sess' });
    expect(mgr.hasChatSessionCache('destroy-sess')).toBe(false);
  });

  it('IPC chatStatusChanged updates chatStatus', () => {
    mgr.createChatSessionCache('status-sess', 'status-chat');
    mockAgentChatListeners['chatStatusChanged']?.({
      chatId: 'status-chat',
      chatSessionId: 'status-sess',
      chatStatus: 'sending_response'
    });
    expect(mgr.getChatSessionCache('status-sess')!.chatStatus).toBe('sending_response');
  });

  it('IPC chatStatusChanged coerces invalid status to idle', () => {
    mgr.createChatSessionCache('status-sess2', 'status-chat2');
    mockAgentChatListeners['chatStatusChanged']?.({
      chatId: 'status-chat2',
      chatSessionId: 'status-sess2',
      chatStatus: 'invalid_status'
    });
    expect(mgr.getChatSessionCache('status-sess2')!.chatStatus).toBe('idle');
  });

  it('IPC contextChange updates contextTokenUsage', () => {
    mgr.createChatSessionCache('ctx-sess', 'ctx-chat');
    mockAgentChatListeners['contextChange']?.({
      chatSessionId: 'ctx-sess',
      stats: { tokenCount: 500, totalMessages: 10, contextMessages: 8, compressionRatio: 0.8 }
    });
    const usage = mgr.getChatSessionCache('ctx-sess')!.contextTokenUsage;
    expect(usage.tokenCount).toBe(500);
    expect(usage.compressionRatio).toBe(0.8);
  });

  it('IPC streamingChunk content creates/updates assistant message', () => {
    mgr.createChatSessionCache('stream-sess', 'stream-chat');
    mgr.setCurrentChatSessionId('stream-chat', 'stream-sess');
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'stream-sess',
      type: 'content',
      messageId: 'msg-stream-1',
      contentDelta: { text: 'Hello ' },
      timestamp: Date.now()
    });
    const msgs = mgr.getChatSessionCache('stream-sess')!.messages;
    expect(msgs.some(m => m.id === 'msg-stream-1')).toBe(true);
  });

  it('IPC streamingChunk complete marks message as complete', () => {
    mgr.createChatSessionCache('complete-sess', 'complete-chat');
    mgr.setCurrentChatSessionId('complete-chat', 'complete-sess');
    // Create assistant message first
    const msg: any = { id: 'msg-comp-1', role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 0, streamingComplete: false };
    mgr.getChatSessionCache('complete-sess')!.messages.push(msg);

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'complete-sess',
      type: 'complete',
      messageId: undefined,
      complete: { messageId: 'msg-comp-1', hasToolCalls: false },
      timestamp: Date.now()
    });

    const found = mgr.getChatSessionCache('complete-sess')!.messages.find(m => m.id === 'msg-comp-1');
    expect(found?.streamingComplete).toBe(true);
  });

  it('IPC interactionRequest sets pendingInteractiveRequest', () => {
    mgr.createChatSessionCache('ir-sess', 'ir-chat');
    mockAgentChatListeners['interactionRequest']?.({
      chatSessionId: 'ir-sess',
      interactionId: 'int-1',
      type: 'confirm'
    });
    expect(mgr.getChatSessionCache('ir-sess')!.pendingInteractiveRequest).toBeDefined();
  });

  it('IPC interactionProcessed clears pendingInteractiveRequest', () => {
    mgr.createChatSessionCache('ip-sess', 'ip-chat');
    // Set up a pending request
    mockAgentChatListeners['interactionRequest']?.({
      chatSessionId: 'ip-sess',
      interactionId: 'int-2',
      type: 'confirm'
    });
    expect(mgr.getChatSessionCache('ip-sess')!.pendingInteractiveRequest).toBeDefined();

    mockAgentChatListeners['interactionProcessed']?.({
      chatSessionId: 'ip-sess',
      interactionId: 'int-2'
    });
    expect(mgr.getChatSessionCache('ip-sess')!.pendingInteractiveRequest).toBeNull();
  });

  // ── replaceFilePathInMessages ──────────────────────────────────────────────
  it('replaceFilePathInMessages replaces text path references', () => {
    mgr.createChatSessionCache('fp-sess', 'fp-chat');
    mgr.setCurrentChatSessionId('fp-chat', 'fp-sess');
    const msg: any = {
      id: 'fp-msg-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'See /Users/test/file.txt for details' }],
      timestamp: 0
    };
    mgr.getChatSessionCache('fp-sess')!.messages.push(msg);

    const count = mgr.replaceFilePathInMessages('/Users/test/file.txt', '/Users/test/new.txt');
    expect(count).toBe(1);
    const updated = mgr.getChatSessionCache('fp-sess')!.messages[0];
    expect((updated.content[0] as any).text).toContain('/Users/test/new.txt');
  });

  it('replaceFilePathInMessages returns 0 when no current session', () => {
    const count = mgr.replaceFilePathInMessages('/old', '/new');
    expect(count).toBe(0);
  });
});

// ── extractFilePathsFromText ───────────────────────────────────────────────────
describe('extractFilePathsFromText', () => {
  it('extracts Windows paths', () => {
    const text = 'See C:\\Users\\foo\\bar.txt for details';
    const paths = extractFilePathsFromText(text);
    expect(paths.some(p => p.includes('bar.txt'))).toBe(true);
  });

  it('extracts Unix paths', () => {
    const text = 'File is at /Users/john/documents/notes.md here';
    const paths = extractFilePathsFromText(text);
    expect(paths.some(p => p.includes('notes.md'))).toBe(true);
  });

  it('deduplicates paths', () => {
    const text = '/Users/a/b.txt and again /Users/a/b.txt';
    const paths = extractFilePathsFromText(text);
    const count = paths.filter(p => p.includes('b.txt')).length;
    expect(count).toBe(1);
  });

  it('returns empty array for text with no paths', () => {
    const paths = extractFilePathsFromText('Hello world, no paths here!');
    expect(paths).toEqual([]);
  });

  it('does not double-extract overlapping Windows/Unix paths', () => {
    // A Windows path that would look like a Unix path prefix — ensure no overlap
    const text = 'C:\\Users\\john\\file.txt';
    const paths = extractFilePathsFromText(text);
    // All paths should be backslash-normalized Windows paths, not Unix paths
    expect(paths.every(p => !p.startsWith('/Users'))).toBe(true);
  });
});
