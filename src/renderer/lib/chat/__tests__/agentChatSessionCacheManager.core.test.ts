/**
 * Core coverage tests for AgentChatSessionCacheManager.
 *
 * Targets uncovered branches:
 * - extractFilePathsFromText (standalone utility)
 * - getUserMessageSendState / waitForSendReady
 * - setErrorMessage / clearErrorMessage
 * - removeMessage
 * - setAssistantSayHiMessage
 * - handleContentChunk / handleToolCallChunk / handleToolResultChunk
 * - handleCompleteChunk / handleUserMessageChunk
 * - mergeSnapshotMessagesWithExistingCache (via createChatSessionCache)
 * - cleanup
 */

describe('extractFilePathsFromText', () => {
  beforeEach(() => {
    vi.resetModules();
    (global as any).window = { electronAPI: { agentChat: {} } };
  });

  it('extracts a Unix path from text', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    const result = extractFilePathsFromText('Saved to /Users/alice/projects/report.md here.');
    expect(result).toContain('/Users/alice/projects/report.md');
  });

  it('extracts a Windows path from text', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    const result = extractFilePathsFromText('File is at C:\\Users\\bob\\docs\\notes.txt right?');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('notes.txt');
  });

  it('deduplicates repeated paths', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    const result = extractFilePathsFromText(
      '/Users/alice/foo.txt and again /Users/alice/foo.txt'
    );
    expect(result.filter((p) => p.includes('foo.txt'))).toHaveLength(1);
  });

  it('returns empty array for plain text with no paths', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    expect(extractFilePathsFromText('Hello, world!')).toEqual([]);
  });

  it('does not match SharePoint-style URL fragments as Windows paths', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    const result = extractFilePathsFromText('https://contoso.sharepoint.com/:p:/r/Doc.aspx');
    expect(result).toEqual([]);
  });
});

// ─── Manager method tests ────────────────────────────────────────────────────

describe('AgentChatSessionCacheManager core methods', () => {
  beforeEach(() => {
    vi.resetModules();
    (global as any).window = { electronAPI: { agentChat: {} } };
  });

  afterEach(async () => {
    const module = await import('../agentChatSessionCacheManager');
    module.agentChatSessionCacheManager.cleanup();
    vi.clearAllMocks();
  });

  // ── getUserMessageSendState ────────────────────────────────────────────────

  it('getUserMessageSendState returns canSend=false when no sessionId', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(m.getUserMessageSendState(null)).toMatchObject({ canSend: false });
    expect(m.getUserMessageSendState(undefined)).toMatchObject({ canSend: false });
  });

  it('getUserMessageSendState returns canSend=false when status is not idle', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s1', 'c1', { messages: [], chatStatus: 'sending_response' });
    expect(m.getUserMessageSendState('s1')).toMatchObject({ canSend: false, chatStatus: 'sending_response' });
  });

  it('getUserMessageSendState returns canSend=true when status is idle', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s2', 'c1', { messages: [], chatStatus: 'idle' });
    expect(m.getUserMessageSendState('s2')).toMatchObject({ canSend: true, chatStatus: 'idle' });
  });

  it('getUserMessageSendState returns canSend=false with null chatStatus when cache missing', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    const result = m.getUserMessageSendState('nonexistent');
    expect(result.canSend).toBe(false);
    expect(result.chatStatus).toBeNull();
  });

  // ── waitForSendReady ───────────────────────────────────────────────────────

  it('waitForSendReady resolves true immediately when already idle', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-ready', 'c1', { messages: [], chatStatus: 'idle' });
    const result = await m.waitForSendReady('s-ready', 500);
    expect(result).toBe(true);
  });

  it('waitForSendReady resolves false on timeout when never idle', async () => {
    vi.useFakeTimers();
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-busy', 'c1', { messages: [], chatStatus: 'sending_response' });
    const promise = m.waitForSendReady('s-busy', 200);
    vi.advanceTimersByTime(300);
    const result = await promise;
    expect(result).toBe(false);
    vi.useRealTimers();
  });

  it('waitForSendReady resolves true when status becomes idle', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-transition', 'c1', { messages: [], chatStatus: 'sending_response' });
    const promise = m.waitForSendReady('s-transition', 2000);
    // Simulate status change via internal method
    (m as any).handleChatStatusChanged('s-transition', 'idle');
    const result = await promise;
    expect(result).toBe(true);
  });

  // ── setErrorMessage / clearErrorMessage ───────────────────────────────────

  it('setErrorMessage stores the error and clearErrorMessage removes it', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-err', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-err');

    m.setErrorMessage('s-err', 'Something went wrong');
    expect(m.getChatSessionCache('s-err')?.errorMessage).toBe('Something went wrong');

    m.clearErrorMessage('s-err');
    expect(m.getChatSessionCache('s-err')?.errorMessage).toBeNull();
  });

  it('setErrorMessage is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Should not throw
    expect(() => m.setErrorMessage('ghost', 'oops')).not.toThrow();
  });

  it('clearErrorMessage is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => m.clearErrorMessage('ghost')).not.toThrow();
  });

  // ── removeMessage ─────────────────────────────────────────────────────────

  it('removeMessage removes a message by id', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-rm', 'c1', {
      messages: [
        { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as any,
        { id: 'msg-2', role: 'assistant', content: [{ type: 'text', text: 'hello' }], timestamp: 2, streamingComplete: true } as any,
      ],
    });
    m.removeMessage('s-rm', 'msg-1');
    const msgs = m.getChatSessionCache('s-rm')?.messages ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg-2');
  });

  it('removeMessage is a no-op when message id does not exist', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-rm2', 'c1', {
      messages: [
        { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as any,
      ],
    });
    m.removeMessage('s-rm2', 'nonexistent');
    expect(m.getChatSessionCache('s-rm2')?.messages).toHaveLength(1);
  });

  it('removeMessage is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => m.removeMessage('ghost', 'msg-1')).not.toThrow();
  });

  // ── setAssistantSayHiMessage ──────────────────────────────────────────────

  it('setAssistantSayHiMessage inserts a say-hi message at the front when no system message', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-hi', 'c1', { messages: [] });
    m.setAssistantSayHiMessage('s-hi', 'Hello there!');
    const msgs = m.getChatSessionCache('s-hi')?.messages ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toMatch(/^say-hi-/);
    expect((msgs[0].content[0] as any).text).toBe('Hello there!');
  });

  it('setAssistantSayHiMessage inserts after system message when one exists', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-hi2', 'c1', {
      messages: [
        { id: 'sys-1', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }], timestamp: 1 } as any,
      ],
    });
    m.setAssistantSayHiMessage('s-hi2', 'Hi!');
    const msgs = m.getChatSessionCache('s-hi2')?.messages ?? [];
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].id).toMatch(/^say-hi-/);
  });

  it('setAssistantSayHiMessage clears the say-hi message when passed null', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-hi3', 'c1', { messages: [] });
    m.setAssistantSayHiMessage('s-hi3', 'Hello!');
    expect(m.getChatSessionCache('s-hi3')?.messages).toHaveLength(1);
    m.setAssistantSayHiMessage('s-hi3', null);
    expect(m.getChatSessionCache('s-hi3')?.messages).toHaveLength(0);
  });

  it('setAssistantSayHiMessage replaces an existing say-hi message', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-hi4', 'c1', { messages: [] });
    m.setAssistantSayHiMessage('s-hi4', 'First greeting');
    m.setAssistantSayHiMessage('s-hi4', 'Second greeting');
    const msgs = m.getChatSessionCache('s-hi4')?.messages ?? [];
    const sayHiMsgs = msgs.filter((msg) => msg.id?.startsWith('say-hi-'));
    expect(sayHiMsgs).toHaveLength(1);
    expect((sayHiMsgs[0].content[0] as any).text).toBe('Second greeting');
  });

  // ── Streaming chunk handlers ──────────────────────────────────────────────

  it('handleContentChunk creates a new assistant message on first chunk', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-content', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-content');

    (m as any).handleStreamingChunk('s-content', {
      type: 'content',
      chatSessionId: 's-content',
      messageId: 'msg-stream-1',
      timestamp: Date.now(),
      contentDelta: { text: 'Hello' },
    });

    const cache = m.getChatSessionCache('s-content');
    expect(cache?.messages).toHaveLength(1);
    const msg = cache?.messages[0] as any;
    expect(msg.id).toBe('msg-stream-1');
    expect(msg.role).toBe('assistant');
    expect(msg.content[0].text).toBe('Hello');
    expect(msg.streamingComplete).toBe(false);
  });

  it('handleContentChunk accumulates text on subsequent chunks', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-accum', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-accum');

    const chunkBase = { type: 'content', chatSessionId: 's-accum', messageId: 'msg-a', timestamp: Date.now() };
    (m as any).handleStreamingChunk('s-accum', { ...chunkBase, contentDelta: { text: 'Hello' } });
    (m as any).handleStreamingChunk('s-accum', { ...chunkBase, contentDelta: { text: ' world' } });

    const cache = m.getChatSessionCache('s-accum');
    const text = (cache?.messages[0]?.content[0] as any)?.text;
    expect(text).toBe('Hello world');
  });

  it('handleCompleteChunk marks the message as streamingComplete and clears streamingMessageId', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-complete', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-complete');

    // First send a content chunk to create the message
    (m as any).handleStreamingChunk('s-complete', {
      type: 'content',
      chatSessionId: 's-complete',
      messageId: 'msg-c1',
      timestamp: Date.now(),
      contentDelta: { text: 'Done.' },
    });

    expect(m.getChatSessionCache('s-complete')?.streamingMessageId).toBe('msg-c1');

    // Now send a complete chunk
    (m as any).handleStreamingChunk('s-complete', {
      type: 'complete',
      chatSessionId: 's-complete',
      messageId: 'msg-c1',
      timestamp: Date.now(),
      complete: { messageId: 'msg-c1', hasToolCalls: false },
    });

    const cache = m.getChatSessionCache('s-complete');
    expect(cache?.streamingMessageId).toBeNull();
    const msg = cache?.messages[0] as any;
    expect(msg.streamingComplete).toBe(true);
  });

  it('handleToolCallChunk creates assistant message with tool_calls', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-tool', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-tool');

    (m as any).handleStreamingChunk('s-tool', {
      type: 'tool_call',
      chatSessionId: 's-tool',
      messageId: 'msg-tool-1',
      timestamp: Date.now(),
      toolCallDelta: {
        index: 0,
        id: 'call-abc',
        function: { name: 'search', arguments: '{"q":' },
      },
    });

    const cache = m.getChatSessionCache('s-tool');
    const msg = cache?.messages[0] as any;
    expect(msg.role).toBe('assistant');
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0].id).toBe('call-abc');
    expect(msg.tool_calls[0].function.name).toBe('search');
    expect(msg.tool_calls[0].function.arguments).toBe('{"q":');
  });

  it('handleToolCallChunk accumulates arguments across chunks', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-toolargs', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-toolargs');

    const base = { type: 'tool_call', chatSessionId: 's-toolargs', messageId: 'msg-t2', timestamp: Date.now() };
    (m as any).handleStreamingChunk('s-toolargs', { ...base, toolCallDelta: { index: 0, id: 'call-1', function: { name: 'fn', arguments: '{"a":' } } });
    (m as any).handleStreamingChunk('s-toolargs', { ...base, toolCallDelta: { index: 0, function: { arguments: '1}' } } });

    const msg = m.getChatSessionCache('s-toolargs')?.messages[0] as any;
    expect(msg.tool_calls[0].function.arguments).toBe('{"a":1}');
  });

  it('handleToolResultChunk appends a tool message', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-result', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-result');

    (m as any).handleStreamingChunk('s-result', {
      type: 'tool_result',
      chatSessionId: 's-result',
      messageId: 'tool-call-99',
      timestamp: Date.now(),
      toolResult: {
        tool_call_id: 'tool-call-99',
        tool_name: 'read_file',
        content: '{"content":"file contents"}',
        isPartial: false,
      },
    });

    const cache = m.getChatSessionCache('s-result');
    expect(cache?.messages).toHaveLength(1);
    const msg = cache?.messages[0] as any;
    expect(msg.role).toBe('tool');
    expect(msg.id).toBe('tool-call-99');
    expect(msg.streamingComplete).toBe(true);
  });

  it('handleToolResultChunk updates existing tool message in place', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-result2', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-result2');

    const baseChunk = {
      type: 'tool_result',
      chatSessionId: 's-result2',
      messageId: 'tool-x',
      timestamp: Date.now(),
      toolResult: { tool_call_id: 'tool-x', tool_name: 'fn', content: 'partial', isPartial: true },
    };
    (m as any).handleStreamingChunk('s-result2', baseChunk);
    (m as any).handleStreamingChunk('s-result2', { ...baseChunk, toolResult: { ...baseChunk.toolResult, content: 'final', isPartial: false } });

    const cache = m.getChatSessionCache('s-result2');
    expect(cache?.messages).toHaveLength(1);
    expect((cache?.messages[0].content[0] as any).text).toBe('final');
  });

  it('handleUserMessageChunk appends a user message', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-usermsg', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-usermsg');

    (m as any).handleStreamingChunk('s-usermsg', {
      type: 'user_message',
      chatSessionId: 's-usermsg',
      messageId: 'user-remote-1',
      timestamp: Date.now(),
      userMessage: {
        id: 'user-remote-1',
        content: [{ type: 'text', text: 'remote user msg' }],
        timestamp: Date.now(),
      },
    });

    const cache = m.getChatSessionCache('s-usermsg');
    expect(cache?.messages).toHaveLength(1);
    expect(cache?.messages[0].role).toBe('user');
  });

  it('handleUserMessageChunk skips duplicate user messages', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-usermsg2', 'c1', {
      messages: [
        { id: 'user-dup', role: 'user', content: [{ type: 'text', text: 'already here' }], timestamp: 1 } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-usermsg2');

    (m as any).handleStreamingChunk('s-usermsg2', {
      type: 'user_message',
      chatSessionId: 's-usermsg2',
      messageId: 'user-dup',
      timestamp: Date.now(),
      userMessage: {
        id: 'user-dup',
        content: [{ type: 'text', text: 'already here' }],
        timestamp: Date.now(),
      },
    });

    expect(m.getChatSessionCache('s-usermsg2')?.messages).toHaveLength(1);
  });

  // ── addUserMessage ────────────────────────────────────────────────────────

  it('addUserMessage appends a user message to the cache', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-add', 'c1', { messages: [] });
    m.addUserMessage('s-add', {
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'test' }],
      timestamp: Date.now(),
    } as any);
    expect(m.getChatSessionCache('s-add')?.messages).toHaveLength(1);
  });

  it('addUserMessage is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() =>
      m.addUserMessage('ghost', { id: 'u1', role: 'user', content: [], timestamp: 1 } as any)
    ).not.toThrow();
  });

  // ── mergeSnapshotMessagesWithExistingCache ────────────────────────────────

  it('preserves trailing cached messages when snapshot is a strict prefix', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Create initial cache with two messages
    m.createChatSessionCache('s-merge', 'c1', {
      messages: [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 } as any,
        { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ans' }], timestamp: 2, streamingComplete: true } as any,
      ],
    });

    // Simulate cache refresh that only contains the first message (older snapshot)
    m.createChatSessionCache('s-merge', 'c1', {
      messages: [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 } as any,
      ],
    });

    const msgs = m.getChatSessionCache('s-merge')?.messages ?? [];
    // Both messages should be present (trailing message preserved)
    const ids = msgs.map((msg) => msg.id);
    expect(ids).toContain('u1');
    expect(ids).toContain('a1');
  });

  it('keeps streaming message version from existing cache when snapshot has older content', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-stream-merge', 'c1', {
      messages: [
        { id: 'streaming-msg', role: 'assistant', content: [{ type: 'text', text: 'latest text' }], timestamp: 1, streamingComplete: false } as any,
      ],
      streamingMessageId: 'streaming-msg',
    });

    // Inject an older snapshot that has older content for the same streaming message
    m.createChatSessionCache('s-stream-merge', 'c1', {
      messages: [
        { id: 'streaming-msg', role: 'assistant', content: [{ type: 'text', text: 'old text' }], timestamp: 1, streamingComplete: false } as any,
      ],
      streamingMessageId: 'streaming-msg',
    });

    const msgs = m.getChatSessionCache('s-stream-merge')?.messages ?? [];
    const streamingMsg = msgs.find((msg) => msg.id === 'streaming-msg') as any;
    // Frontend (newer) version should win
    expect(streamingMsg?.content[0]?.text).toBe('latest text');
  });

  // ── Direct callback registration ─────────────────────────────────────────

  it('registerDirectMessageUpdateCallback fires callback on message update and returns unsubscribe', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-cb', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-cb');

    const cb = vi.fn();
    const unsub = m.registerDirectMessageUpdateCallback('s-cb', cb);

    m.addUserMessage('s-cb', { id: 'u-cb', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as any);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    m.addUserMessage('s-cb', { id: 'u-cb2', role: 'user', content: [{ type: 'text', text: 'hi2' }], timestamp: 2 } as any);
    expect(cb).toHaveBeenCalledTimes(1); // no more calls after unsub
  });

  it('multiple callbacks for the same session all fire', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-multicb', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-multicb');

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    m.registerDirectMessageUpdateCallback('s-multicb', cb1);
    m.registerDirectMessageUpdateCallback('s-multicb', cb2);

    m.addUserMessage('s-multicb', { id: 'u-m', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as any);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  it('cleanup clears all session caches and resets current session', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-clean1', 'c1', { messages: [] });
    m.createChatSessionCache('s-clean2', 'c2', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-clean1');

    m.cleanup();

    expect(m.getChatSessionCache('s-clean1')).toBeNull();
    expect(m.getChatSessionCache('s-clean2')).toBeNull();
    expect(m.getCurrentChatSessionId()).toBeNull();
    expect(m.getCurrentChatId()).toBeNull();
  });

  // ── hasChatSessionCache ───────────────────────────────────────────────────

  it('hasChatSessionCache returns true only when cache exists', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(m.hasChatSessionCache(null)).toBe(false);
    expect(m.hasChatSessionCache(undefined)).toBe(false);
    expect(m.hasChatSessionCache('missing')).toBe(false);
    m.createChatSessionCache('s-has', 'c1', { messages: [] });
    expect(m.hasChatSessionCache('s-has')).toBe(true);
  });

  // ── replaceMessages ───────────────────────────────────────────────────────

  it('replaceMessages replaces the entire message array', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-replace', 'c1', {
      messages: [
        { id: 'old1', role: 'user', content: [{ type: 'text', text: 'old' }], timestamp: 1 } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-replace');

    const newMessages = [
      { id: 'new1', role: 'user', content: [{ type: 'text', text: 'new' }], timestamp: 2 } as any,
      { id: 'new2', role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 3, streamingComplete: true } as any,
    ];
    m.replaceMessages('s-replace', newMessages);
    expect(m.getChatSessionCache('s-replace')?.messages).toHaveLength(2);
    expect(m.getChatSessionCache('s-replace')?.messages[0].id).toBe('new1');
  });

  it('replaceMessages is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => m.replaceMessages('ghost', [])).not.toThrow();
  });

  // ── handleChatSessionCacheDestroyed ───────────────────────────────────────

  it('destroying a cache removes it and clears current session if it was active', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-destroy', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-destroy');

    (m as any).handleChatSessionCacheDestroyed('s-destroy');

    expect(m.getChatSessionCache('s-destroy')).toBeNull();
    expect(m.getCurrentChatSessionId()).toBeNull();
  });

  // ── handleContextChange ───────────────────────────────────────────────────

  it('handleContextChange updates contextTokenUsage', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-ctx', 'c1', { messages: [] });

    (m as any).handleContextChange('s-ctx', {
      tokenCount: 1234,
      totalMessages: 10,
      contextMessages: 8,
      compressionRatio: 0.5,
    });

    const cache = m.getChatSessionCache('s-ctx');
    expect(cache?.contextTokenUsage.tokenCount).toBe(1234);
    expect(cache?.contextTokenUsage.compressionRatio).toBe(0.5);
  });

  // ── createChatSessionCache public guard ───────────────────────────────────

  it('createChatSessionCache is a no-op if cache already exists', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-once', 'c1', {
      messages: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'orig' }], timestamp: 1 } as any,
      ],
    });
    m.createChatSessionCache('s-once', 'c1', { messages: [] }); // second call ignored

    // Original messages should still be there
    expect(m.getChatSessionCache('s-once')?.messages).toHaveLength(1);
  });

  // ── subscribeToCurrentChatSessionId ──────────────────────────────────────

  it('subscribeToCurrentChatSessionId fires the callback immediately by default', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.setCurrentChatSessionId('c1', 'session-sub');

    const cb = vi.fn();
    const unsub = m.subscribeToCurrentChatSessionId(cb);
    expect(cb).toHaveBeenCalledWith('session-sub');
    unsub();
  });

  it('subscribeToCurrentChatSessionId skips the immediate call when skipFirst=true', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    const cb = vi.fn();
    const unsub = m.subscribeToCurrentChatSessionId(cb, true);
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });
});
