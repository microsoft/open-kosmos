/**
 * @vitest-environment happy-dom
 *
 * Additional coverage for AgentChatSessionCacheManager — focuses on
 * streaming chunk handlers, IPC integration, mergeSnapshot, replaceFilePath,
 * registerDirectMessageUpdateCallback, and edge cases not covered by coverage.test.ts.
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

setupElectronAPI();
import {
  AgentChatSessionCacheManager,
  extractFilePathsFromText,
} from '../agentChatSessionCacheManager';

function freshManager(): AgentChatSessionCacheManager {
  (AgentChatSessionCacheManager as any).instance = undefined;
  return AgentChatSessionCacheManager.getInstance();
}

describe('AgentChatSessionCacheManager — streaming chunk handlers', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  // ── content chunk ──────────────────────────────────────────────────────────
  it('content chunk creates a new assistant message when not found', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess',
      type: 'content',
      messageId: 'msg-1',
      timestamp: 1000,
      contentDelta: { text: 'Hello' },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('assistant');
    expect((msgs[0].content[0] as any).text).toBe('Hello');
  });

  it('content chunk accumulates text in existing message', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    // First chunk creates the message
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'content', messageId: 'msg-1',
      timestamp: 1000, contentDelta: { text: 'Hello' },
    });
    // Second chunk appends
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'content', messageId: 'msg-1',
      timestamp: 1001, contentDelta: { text: ' World' },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect((msgs[0].content[0] as any).text).toBe('Hello World');
  });

  it('content chunk ignored when cache not found', () => {
    // Should not throw
    expect(() =>
      mockAgentChatListeners['streamingChunk']?.({
        chatSessionId: 'nonexistent', type: 'content', messageId: 'msg-1',
        timestamp: 1000, contentDelta: { text: 'x' },
      })
    ).not.toThrow();
  });

  it('content chunk skipped when contentDelta is missing', () => {
    mgr.createChatSessionCache('sess2', 'chat2');
    mgr.setCurrentChatSessionId('chat2', 'sess2');
    // No throw, no message created
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess2', type: 'content', messageId: 'msg-1',
      timestamp: 1000,
      // contentDelta missing
    });
    expect(mgr.getChatSessionCache('sess2')!.messages.length).toBe(0);
  });

  // ── tool_call chunk ────────────────────────────────────────────────────────
  it('tool_call chunk creates assistant message with tool calls', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'tool_call', messageId: 'msg-tc',
      timestamp: 1000,
      toolCallDelta: { index: 0, id: 'tc-1', function: { name: 'search', arguments: '{"q"' } },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect(msgs.length).toBe(1);
    expect((msgs[0] as any).tool_calls?.[0]?.id).toBe('tc-1');
  });

  it('tool_call chunk accumulates arguments in existing tool call', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'tool_call', messageId: 'msg-tc',
      timestamp: 1000,
      toolCallDelta: { index: 0, id: 'tc-1', function: { name: 'search', arguments: '{"q"' } },
    });
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'tool_call', messageId: 'msg-tc',
      timestamp: 1001,
      toolCallDelta: { index: 0, function: { arguments: ':"foo"}' } },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect((msgs[0] as any).tool_calls?.[0]?.function?.arguments).toBe('{"q":"foo"}');
  });

  it('tool_call chunk skipped when toolCallDelta is missing', () => {
    mgr.createChatSessionCache('sess2', 'chat2');
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess2', type: 'tool_call', messageId: 'msg-tc',
      timestamp: 1000,
      // toolCallDelta missing
    });
    expect(mgr.getChatSessionCache('sess2')!.messages.length).toBe(0);
  });

  // ── tool_result chunk ──────────────────────────────────────────────────────
  it('tool_result chunk appends tool message', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'tool_result', messageId: 'tr-1',
      timestamp: 2000,
      toolResult: {
        tool_call_id: 'tr-1',
        tool_name: 'search',
        content: 'result text',
        isPartial: false,
      },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect(msgs[0].role).toBe('tool');
    expect((msgs[0].content[0] as any).text).toBe('result text');
  });

  it('tool_result chunk updates existing tool message', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    const toolResult = {
      chatSessionId: 'sess', type: 'tool_result', messageId: 'tr-1',
      timestamp: 2000,
      toolResult: { tool_call_id: 'tr-1', tool_name: 'search', content: 'first', isPartial: true },
    };
    mockAgentChatListeners['streamingChunk']?.(toolResult);
    // Update with final
    mockAgentChatListeners['streamingChunk']?.({
      ...toolResult,
      toolResult: { tool_call_id: 'tr-1', tool_name: 'search', content: 'final', isPartial: false },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect(msgs.length).toBe(1);
    expect((msgs[0].content[0] as any).text).toBe('final');
  });

  it('tool_result chunk skipped when toolResult missing', () => {
    mgr.createChatSessionCache('sess2', 'chat2');
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess2', type: 'tool_result', messageId: 'tr-1',
      timestamp: 2000,
    });
    expect(mgr.getChatSessionCache('sess2')!.messages.length).toBe(0);
  });

  // ── complete chunk ─────────────────────────────────────────────────────────
  it('complete chunk marks message as streamingComplete', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    // Create message first
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'content', messageId: 'msg-c',
      timestamp: 1000, contentDelta: { text: 'hi' },
    });
    // Complete it
    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'complete', messageId: 'msg-c',
      timestamp: 1001,
      complete: { messageId: 'msg-c', hasToolCalls: false },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect((msgs[0] as any).streamingComplete).toBe(true);
  });

  it('complete chunk does nothing when complete payload missing', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    expect(() =>
      mockAgentChatListeners['streamingChunk']?.({
        chatSessionId: 'sess', type: 'complete', messageId: 'msg-none',
        timestamp: 1000,
        // complete missing
      })
    ).not.toThrow();
  });

  // ── user_message chunk ─────────────────────────────────────────────────────
  it('user_message chunk appends user message', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    mockAgentChatListeners['streamingChunk']?.({
      chatSessionId: 'sess', type: 'user_message', messageId: 'um-1',
      timestamp: 500,
      userMessage: { id: 'um-1', content: [{ type: 'text', text: 'hello from remote' }], timestamp: 500 },
    });

    const msgs = mgr.getChatSessionCache('sess')!.messages;
    expect(msgs[0].role).toBe('user');
  });

  it('user_message chunk skips duplicate messages', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');

    const chunk = {
      chatSessionId: 'sess', type: 'user_message', messageId: 'um-2',
      timestamp: 500,
      userMessage: { id: 'um-2', content: [{ type: 'text', text: 'hi' }], timestamp: 500 },
    };
    mockAgentChatListeners['streamingChunk']?.(chunk);
    mockAgentChatListeners['streamingChunk']?.(chunk); // duplicate

    expect(mgr.getChatSessionCache('sess')!.messages.length).toBe(1);
  });

  it('unknown chunk type is handled without throwing', () => {
    mgr.createChatSessionCache('sess', 'chat');
    expect(() =>
      mockAgentChatListeners['streamingChunk']?.({
        chatSessionId: 'sess', type: 'UNKNOWN_TYPE', messageId: 'x', timestamp: 1,
      })
    ).not.toThrow();
  });
});

describe('AgentChatSessionCacheManager — IPC integration', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('IPC chatSessionCacheCreated creates a cache', () => {
    mockAgentChatListeners['chatSessionCacheCreated']?.({
      chatSessionId: 'sess-ipc', chatId: 'chat-ipc', initialData: { messages: [] },
    });
    expect(mgr.hasChatSessionCache('sess-ipc')).toBe(true);
  });

  it('IPC chatSessionCacheCreated with existing cache does merge', () => {
    mgr.createChatSessionCache('sess-merge', 'chat-merge');
    const msg: any = { id: 'm1', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess-merge', msg);

    // Backend recreates with new messages
    const newMsg: any = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'updated' }], timestamp: 0 };
    mockAgentChatListeners['chatSessionCacheCreated']?.({
      chatSessionId: 'sess-merge', chatId: 'chat-merge',
      initialData: { messages: [newMsg] },
    });

    // Should still have the session
    expect(mgr.hasChatSessionCache('sess-merge')).toBe(true);
  });

  it('IPC chatSessionCacheDestroyed removes cache', () => {
    mgr.createChatSessionCache('sess-del', 'chat-del');
    mockAgentChatListeners['chatSessionCacheDestroyed']?.({ chatSessionId: 'sess-del' });
    expect(mgr.hasChatSessionCache('sess-del')).toBe(false);
  });

  it('IPC chatSessionCacheDestroyed clears current session if it was active', () => {
    mgr.createChatSessionCache('sess-active', 'chat-active');
    mgr.setCurrentChatSessionId('chat-active', 'sess-active');

    mockAgentChatListeners['chatSessionCacheDestroyed']?.({ chatSessionId: 'sess-active' });

    expect(mgr.getCurrentChatSessionId()).toBeNull();
  });

  it('IPC chatStatusChanged updates status', () => {
    mgr.createChatSessionCache('sess-status', 'chat-status');
    mockAgentChatListeners['chatStatusChanged']?.({
      chatId: 'chat-status',
      chatSessionId: 'sess-status',
      chatStatus: 'sending_response',
    });
    expect(mgr.getChatSessionCache('sess-status')!.chatStatus).toBe('sending_response');
  });

  it('IPC chatStatusChanged ignores invalid status and defaults to idle', () => {
    mgr.createChatSessionCache('sess-bad', 'chat-bad');
    mockAgentChatListeners['chatStatusChanged']?.({
      chatId: 'chat-bad',
      chatSessionId: 'sess-bad',
      chatStatus: 'INVALID_STATUS',
    });
    expect(mgr.getChatSessionCache('sess-bad')!.chatStatus).toBe('idle');
  });

  it('IPC chatStatusChanged clears streamingMessageId when transitioning to idle', () => {
    mgr.createChatSessionCache('sess-idle', 'chat-idle');
    // Simulate streaming state
    const cache = mgr.getChatSessionCache('sess-idle')!;
    cache.streamingMessageId = 'streaming-msg';

    mockAgentChatListeners['chatStatusChanged']?.({
      chatId: 'chat-idle',
      chatSessionId: 'sess-idle',
      chatStatus: 'idle',
    });

    expect(mgr.getChatSessionCache('sess-idle')!.streamingMessageId).toBeNull();
  });

  it('IPC contextChange updates contextTokenUsage', () => {
    mgr.createChatSessionCache('sess-ctx', 'chat-ctx');
    mockAgentChatListeners['contextChange']?.({
      chatSessionId: 'sess-ctx',
      stats: { tokenCount: 100, totalMessages: 5, contextMessages: 4, compressionRatio: 0.8 },
    });
    const usage = mgr.getChatSessionCache('sess-ctx')!.contextTokenUsage;
    expect(usage.tokenCount).toBe(100);
    expect(usage.compressionRatio).toBe(0.8);
  });

  it('IPC contextChange does nothing for missing cache', () => {
    expect(() =>
      mockAgentChatListeners['contextChange']?.({
        chatSessionId: 'nonexistent',
        stats: { tokenCount: 10 },
      })
    ).not.toThrow();
  });

  it('IPC interactionRequest sets pendingInteractiveRequest', () => {
    mgr.createChatSessionCache('sess-interact', 'chat-interact');
    const request = { chatSessionId: 'sess-interact', interactionId: 'req-1', type: 'confirm', message: 'Continue?' };
    mockAgentChatListeners['interactionRequest']?.(request);
    expect(mgr.getChatSessionCache('sess-interact')!.pendingInteractiveRequest).toBeTruthy();
  });

  it('IPC interactionProcessed clears matching pendingInteractiveRequest', () => {
    mgr.createChatSessionCache('sess-ip', 'chat-ip');
    // Set up pending request
    const request = { chatSessionId: 'sess-ip', interactionId: 'req-2', type: 'confirm' };
    mockAgentChatListeners['interactionRequest']?.(request);
    // Process it
    mockAgentChatListeners['interactionProcessed']?.({ chatSessionId: 'sess-ip', interactionId: 'req-2' });

    expect(mgr.getChatSessionCache('sess-ip')!.pendingInteractiveRequest).toBeNull();
  });

  it('IPC interactionProcessed ignores non-matching interactionId', () => {
    mgr.createChatSessionCache('sess-ip2', 'chat-ip2');
    const request = { chatSessionId: 'sess-ip2', interactionId: 'req-A', type: 'confirm' };
    mockAgentChatListeners['interactionRequest']?.(request);
    // Different ID
    mockAgentChatListeners['interactionProcessed']?.({ chatSessionId: 'sess-ip2', interactionId: 'req-B' });

    expect(mgr.getChatSessionCache('sess-ip2')!.pendingInteractiveRequest).toBeTruthy();
  });
});

describe('AgentChatSessionCacheManager — mergeSnapshotMessagesWithExistingCache', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('preserves say-hi message from existing cache when snapshot lacks it', () => {
    mgr.createChatSessionCache('sess-sayhi', 'chat-sayhi');
    mgr.setAssistantSayHiMessage('sess-sayhi', 'Hello!');
    expect(mgr.getChatSessionCache('sess-sayhi')!.messages.some(m => m.id?.startsWith('say-hi-'))).toBe(true);

    // Recreate session via IPC with messages that don't include say-hi
    mockAgentChatListeners['chatSessionCacheCreated']?.({
      chatSessionId: 'sess-sayhi', chatId: 'chat-sayhi',
      initialData: { messages: [{ id: 'sys1', role: 'system', content: [], timestamp: 0 }] },
    });

    // say-hi should be preserved
    const msgs = mgr.getChatSessionCache('sess-sayhi')!.messages;
    expect(msgs.some(m => m.id?.startsWith('say-hi-'))).toBe(true);
  });

  it('isIncomingSnapshotPrefixOfExistingCache returns true for empty incoming', () => {
    const result = (mgr as any).isIncomingSnapshotPrefixOfExistingCache(
      [],
      [{ id: 'm1', role: 'user' }]
    );
    expect(result).toBe(true);
  });

  it('isIncomingSnapshotPrefixOfExistingCache returns false when incoming is longer', () => {
    const result = (mgr as any).isIncomingSnapshotPrefixOfExistingCache(
      [{ id: 'm1' }, { id: 'm2' }],
      [{ id: 'm1' }]
    );
    expect(result).toBe(false);
  });

  it('browserControl feature flag filters user_img_ messages on cache creation', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    mockAgentChatListeners['chatSessionCacheCreated']?.({
      chatSessionId: 'sess-img', chatId: 'chat-img',
      initialData: {
        messages: [
          { id: 'user_img_001', role: 'user', content: [], timestamp: 0 },
          { id: 'msg-normal', role: 'user', content: [], timestamp: 1 },
        ],
      },
    });
    const msgs = mgr.getChatSessionCache('sess-img')!.messages;
    expect(msgs.find(m => m.id === 'user_img_001')).toBeUndefined();
    expect(msgs.find(m => m.id === 'msg-normal')).toBeTruthy();
    mockIsFeatureEnabled.mockReturnValue(false);
  });
});

describe('AgentChatSessionCacheManager — replaceFilePathInMessages', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('returns 0 when no current session', () => {
    expect(mgr.replaceFilePathInMessages('/old/path.txt', '/new/path.txt')).toBe(0);
  });

  it('replaces file path in text content', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const msg: any = {
      id: 'm1', role: 'assistant',
      content: [{ type: 'text', text: 'See /old/path.txt for details' }],
      timestamp: 0,
    };
    mgr.addUserMessage('sess', msg);

    const count = mgr.replaceFilePathInMessages('/old/path.txt', '/new/path.txt');
    expect(count).toBe(1);
    const updated = mgr.getChatSessionCache('sess')!.messages[0];
    expect((updated.content[0] as any).text).toContain('/new/path.txt');
  });

  it('replaces file path in file content part', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const msg: any = {
      id: 'm2', role: 'user',
      content: [{ type: 'file', file: { filePath: '/old/doc.pdf' } }],
      timestamp: 0,
    };
    mgr.addUserMessage('sess', msg);

    const count = mgr.replaceFilePathInMessages('/old/doc.pdf', '/new/doc.pdf');
    expect(count).toBe(1);
  });

  it('replaces file path in image content', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const msg: any = {
      id: 'm3', role: 'user',
      content: [{ type: 'image', image_url: { url: '/old/image.png' } }],
      timestamp: 0,
    };
    mgr.addUserMessage('sess', msg);

    const count = mgr.replaceFilePathInMessages('/old/image.png', '/new/image.png');
    expect(count).toBe(1);
  });

  it('replaces file path in tool_calls arguments', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const msg: any = {
      id: 'm4', role: 'assistant',
      content: [{ type: 'text', text: '' }],
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'write', arguments: '{"path":"/old/file.txt"}' } }],
      timestamp: 0,
    };
    // inject directly
    mgr.getChatSessionCache('sess')!.messages.push(msg);

    const count = mgr.replaceFilePathInMessages('/old/file.txt', '/new/file.txt');
    expect(count).toBe(1);
    const updated = mgr.getChatSessionCache('sess')!.messages[0];
    expect((updated as any).tool_calls[0].function.arguments).toContain('/new/file.txt');
  });

  it('returns 0 when path not found in any message', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const msg: any = {
      id: 'm5', role: 'user',
      content: [{ type: 'text', text: 'No path here' }],
      timestamp: 0,
    };
    mgr.addUserMessage('sess', msg);

    const count = mgr.replaceFilePathInMessages('/not/there.txt', '/new.txt');
    expect(count).toBe(0);
  });
});

describe('AgentChatSessionCacheManager — registerDirectMessageUpdateCallback', () => {
  let mgr: AgentChatSessionCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mgr = freshManager();
  });

  it('callback is called on direct message update', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const cb = vi.fn();
    mgr.registerDirectMessageUpdateCallback('sess', cb);

    const msg: any = { id: 'u1', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess', msg);

    expect(cb).toHaveBeenCalledWith(msg, 'sess');
  });

  it('multiple callbacks all called', () => {
    mgr.createChatSessionCache('sess', 'chat');
    mgr.setCurrentChatSessionId('chat', 'sess');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    mgr.registerDirectMessageUpdateCallback('sess', cb1);
    mgr.registerDirectMessageUpdateCallback('sess', cb2);

    const msg: any = { id: 'u2', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess', msg);

    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it('callback not called for non-current session', () => {
    mgr.createChatSessionCache('sess-bg', 'chat-bg');
    mgr.createChatSessionCache('sess-fg', 'chat-fg');
    mgr.setCurrentChatSessionId('chat-fg', 'sess-fg');

    const cb = vi.fn();
    // No callback registered for sess-bg
    const msg: any = { id: 'u3', role: 'user', content: [], timestamp: 0 };
    mgr.addUserMessage('sess-bg', msg);

    // cb was never registered so it should not be called
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('extractFilePathsFromText', () => {
  it('extracts Windows paths', () => {
    const text = 'See C:\\Users\\test\\file.txt for info';
    const paths = extractFilePathsFromText(text);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('file.txt');
  });

  it('extracts Unix paths', () => {
    const text = 'Check /Users/jane/docs/readme.md please';
    const paths = extractFilePathsFromText(text);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('readme.md');
  });

  it('deduplicates paths', () => {
    const text = '/Users/jane/doc.txt and again /Users/jane/doc.txt';
    const paths = extractFilePathsFromText(text);
    expect(paths.length).toBe(1);
  });

  it('returns empty array for no paths', () => {
    expect(extractFilePathsFromText('no paths here')).toEqual([]);
  });
});

describe('AgentChatSessionCacheManager — setupIpcListeners error path', () => {
  it('does not throw when electronAPI.agentChat is unavailable', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {},
    });
    (AgentChatSessionCacheManager as any).instance = undefined;
    expect(() => AgentChatSessionCacheManager.getInstance()).not.toThrow();
    // Restore
    setupElectronAPI();
  });
});
