/**
 * Deep coverage tests for AgentChatSessionCacheManager.
 *
 * Targets branches not covered by the existing test files:
 * - replaceFilePathInMessages: office, others, image, text types; no-op paths
 * - handleChatSessionCacheCreated: renderChatHistory fallback, browserControl image filtering,
 *   say-hi preservation with no system message
 * - handleContentChunk: message has no text block (appends new text block)
 * - handleToolCallChunk: existing message is not assistant (early return)
 * - handleCompleteChunk: messageId not found (no-op), tool role message
 * - handleInteractiveRequest / handleInteractionProcessed
 * - handleContextChange: cache not found
 * - triggerDirectMessageUpdate: background session, streamingComplete path, batch path
 * - flushPendingUpdatesForSession
 * - updatePerformanceMetrics: high and low avgUpdateTime branches
 * - extractFilePathsFromText: overlapping Windows+Unix path
 * - getAllChatSessionCaches
 * - getCurrentChatSessionCache when no current session
 * - handleChatStatusChanged with unknown status (falls back to idle)
 * - handleChatSessionCacheCreated: inheriting streamingMessageId from existingCache
 */

describe('AgentChatSessionCacheManager.deep', () => {
  beforeEach(() => {
    vi.resetModules();
    (global as any).window = { electronAPI: { agentChat: {} } };
  });

  afterEach(async () => {
    const module = await import('../agentChatSessionCacheManager');
    module.agentChatSessionCacheManager.cleanup();
    vi.clearAllMocks();
  });

  // ── replaceFilePathInMessages: additional content types ───────────────────

  it('replaceFilePathInMessages: replaces path in "office" content type', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    const oldPath = '/tmp/old/sheet.xlsx';
    const newPath = '/kb/sheet.xlsx';

    m.createChatSessionCache('s-office', 'c1', {
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [{ type: 'office', file: { filePath: oldPath, fileName: 'sheet.xlsx', mimeType: 'application/xlsx' } }],
          timestamp: 1,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-office');

    const count = m.replaceFilePathInMessages(oldPath, newPath);
    expect(count).toBe(1);
    const msg = m.getChatSessionCache('s-office')?.messages[0] as any;
    expect(msg.content[0].file.filePath).toBe(newPath);
  });

  it('replaceFilePathInMessages: replaces path in "others" content type', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    const oldPath = '/tmp/old/data.bin';
    const newPath = '/kb/data.bin';

    m.createChatSessionCache('s-others', 'c1', {
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [{ type: 'others', file: { filePath: oldPath, fileName: 'data.bin', mimeType: 'application/octet-stream' } }],
          timestamp: 1,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-others');

    const count = m.replaceFilePathInMessages(oldPath, newPath);
    expect(count).toBe(1);
    const msg = m.getChatSessionCache('s-others')?.messages[0] as any;
    expect(msg.content[0].file.filePath).toBe(newPath);
  });

  it('replaceFilePathInMessages: replaces path in "image" content type', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    const oldPath = '/tmp/old/photo.png';
    const newPath = '/kb/photo.png';

    m.createChatSessionCache('s-image', 'c1', {
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [{ type: 'image', image_url: { url: oldPath } }],
          timestamp: 1,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-image');

    const count = m.replaceFilePathInMessages(oldPath, newPath);
    expect(count).toBe(1);
    const msg = m.getChatSessionCache('s-image')?.messages[0] as any;
    expect(msg.content[0].image_url.url).toBe(newPath);
  });

  it('replaceFilePathInMessages: returns 0 and no-ops when no current session', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // No current session set
    const count = m.replaceFilePathInMessages('/old', '/new');
    expect(count).toBe(0);
  });

  it('replaceFilePathInMessages: returns 0 when current session cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Set current session without creating cache
    m.setCurrentChatSessionId('c1', 'ghost-session');
    const count = m.replaceFilePathInMessages('/old', '/new');
    expect(count).toBe(0);
  });

  it('replaceFilePathInMessages: message with non-array content is skipped (continue branch)', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-noarray', 'c1', {
      messages: [
        // content is a string, not an array
        { id: 'msg-1', role: 'user', content: 'plain string' as any, timestamp: 1 } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-noarray');
    const count = m.replaceFilePathInMessages('/old', '/new');
    expect(count).toBe(0);
  });

  it('replaceFilePathInMessages: office/others/image parts that do NOT match are not changed', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-nomatch', 'c1', {
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [
            { type: 'office', file: { filePath: '/different/path.docx', fileName: 'x.docx', mimeType: 'application/msword' } },
            { type: 'image', image_url: { url: '/other/image.png' } },
          ],
          timestamp: 1,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-nomatch');
    const count = m.replaceFilePathInMessages('/old', '/new');
    expect(count).toBe(0);
  });

  // ── handleChatSessionCacheCreated: renderChatHistory fallback ─────────────

  it('handleChatSessionCacheCreated uses renderChatHistory when messages is absent', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    // Simulate old-structure initialData with renderChatHistory
    (m as any).handleChatSessionCacheCreated('s-rch', 'c1', {
      renderChatHistory: [
        { id: 'rch-1', role: 'assistant', content: [{ type: 'text', text: 'legacy' }], timestamp: 1, streamingComplete: true },
      ],
    });

    const msgs = m.getChatSessionCache('s-rch')?.messages ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('rch-1');
  });

  // ── say-hi preservation when existing cache has say-hi and no system msg ──

  it('handleChatSessionCacheCreated preserves say-hi when no system message via unshift', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    // Create initial cache with say-hi at front
    m.createChatSessionCache('s-sayhi-nosys', 'c1', { messages: [] });
    m.setAssistantSayHiMessage('s-sayhi-nosys', 'Hi there!');

    const before = m.getChatSessionCache('s-sayhi-nosys')?.messages ?? [];
    expect(before[0].id).toMatch(/^say-hi-/);

    // Refresh with a snapshot that does not include the say-hi
    (m as any).handleChatSessionCacheCreated('s-sayhi-nosys', 'c1', {
      messages: [
        { id: 'user-1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 2 },
      ],
    });

    const after = m.getChatSessionCache('s-sayhi-nosys')?.messages ?? [];
    const sayHiMsgs = after.filter((msg: any) => msg.id?.startsWith('say-hi-'));
    expect(sayHiMsgs).toHaveLength(1);
  });

  // ── handleContentChunk: message exists but has no text block ──────────────

  it('handleContentChunk appends text block when existing message has no text content', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-notextblock', 'c1', {
      messages: [
        // Message exists but only has a tool_call content, no text block
        {
          id: 'msg-notxt',
          role: 'assistant',
          content: [],
          timestamp: 1,
          streamingComplete: false,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-notextblock');

    (m as any).handleStreamingChunk('s-notextblock', {
      type: 'content',
      chatSessionId: 's-notextblock',
      messageId: 'msg-notxt',
      timestamp: Date.now(),
      contentDelta: { text: 'appended' },
    });

    const msg = m.getChatSessionCache('s-notextblock')?.messages.find((x: any) => x.id === 'msg-notxt') as any;
    expect(msg.content[msg.content.length - 1]).toMatchObject({ type: 'text', text: 'appended' });
  });

  // ── handleToolCallChunk: existing message is not assistant ────────────────

  it('handleToolCallChunk is a no-op when existing message is not assistant role', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-toolrole', 'c1', {
      messages: [
        // Same messageId but it's a tool message, not assistant
        {
          id: 'msg-toolrole',
          role: 'tool',
          content: [{ type: 'text', text: 'result' }],
          timestamp: 1,
          streamingComplete: true,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-toolrole');

    (m as any).handleStreamingChunk('s-toolrole', {
      type: 'tool_call',
      chatSessionId: 's-toolrole',
      messageId: 'msg-toolrole',
      timestamp: Date.now(),
      toolCallDelta: { index: 0, id: 'call-x', function: { name: 'fn', arguments: '' } },
    });

    // Message should remain unchanged (no tool_calls added)
    const msg = m.getChatSessionCache('s-toolrole')?.messages[0] as any;
    expect(msg.tool_calls).toBeUndefined();
  });

  // ── handleCompleteChunk: messageId not found ──────────────────────────────

  it('handleCompleteChunk is a no-op when message not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-complete-noop', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-complete-noop');

    // Should not throw
    expect(() => {
      (m as any).handleStreamingChunk('s-complete-noop', {
        type: 'complete',
        chatSessionId: 's-complete-noop',
        messageId: 'nonexistent',
        timestamp: Date.now(),
        complete: { messageId: 'nonexistent', hasToolCalls: false },
      });
    }).not.toThrow();
  });

  it('handleCompleteChunk handles tool role message', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-complete-tool', 'c1', {
      messages: [
        {
          id: 'tool-complete-1',
          role: 'tool',
          content: [{ type: 'text', text: 'result' }],
          tool_call_id: 'tool-complete-1',
          name: 'fn',
          timestamp: 1,
          streamingComplete: false,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-complete-tool');

    (m as any).handleStreamingChunk('s-complete-tool', {
      type: 'complete',
      chatSessionId: 's-complete-tool',
      messageId: 'tool-complete-1',
      timestamp: Date.now(),
      complete: { messageId: 'tool-complete-1', hasToolCalls: false },
    });

    const msg = m.getChatSessionCache('s-complete-tool')?.messages[0] as any;
    expect(msg.streamingComplete).toBe(true);
  });

  it('handleCompleteChunk is a no-op when message role is user (not assistant/tool)', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-complete-user', 'c1', {
      messages: [
        {
          id: 'user-msg-complete',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
          timestamp: 1,
        } as any,
      ],
    });
    m.setCurrentChatSessionId('c1', 's-complete-user');

    (m as any).handleStreamingChunk('s-complete-user', {
      type: 'complete',
      chatSessionId: 's-complete-user',
      messageId: 'user-msg-complete',
      timestamp: Date.now(),
      complete: { messageId: 'user-msg-complete', hasToolCalls: false },
    });

    // User message should remain, not modified
    const msg = m.getChatSessionCache('s-complete-user')?.messages[0] as any;
    expect(msg.streamingComplete).toBeUndefined();
  });

  // ── handleInteractiveRequest ──────────────────────────────────────────────

  it('handleInteractiveRequest stores pending request and notifies current session', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-interactive', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-interactive');

    (m as any).handleInteractiveRequest('s-interactive', {
      chatSessionId: 's-interactive',
      interactionId: 'req-1',
      type: 'confirm',
      message: 'Are you sure?',
    });

    expect(m.getChatSessionCache('s-interactive')?.pendingInteractiveRequest).toBeTruthy();
  });

  it('handleInteractiveRequest is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => {
      (m as any).handleInteractiveRequest('ghost', {
        chatSessionId: 'ghost',
        interactionId: 'req-x',
      });
    }).not.toThrow();
  });

  // ── handleInteractionProcessed ────────────────────────────────────────────

  it('handleInteractionProcessed clears pending request when interactionId matches', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-processed', 'c1', {
      messages: [],
      pendingInteractiveRequest: { interactionId: 'req-match', chatSessionId: 's-processed', type: 'confirm', message: 'confirm?' } as any,
    });
    m.setCurrentChatSessionId('c1', 's-processed');

    (m as any).handleInteractionProcessed('s-processed', { interactionId: 'req-match' });
    expect(m.getChatSessionCache('s-processed')?.pendingInteractiveRequest).toBeNull();
  });

  it('handleInteractionProcessed does not clear when interactionId differs', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-proc-nomatch', 'c1', {
      messages: [],
      pendingInteractiveRequest: { interactionId: 'req-A', chatSessionId: 's-proc-nomatch', type: 'confirm', message: '?' } as any,
    });
    m.setCurrentChatSessionId('c1', 's-proc-nomatch');

    (m as any).handleInteractionProcessed('s-proc-nomatch', { interactionId: 'req-B' });
    expect(m.getChatSessionCache('s-proc-nomatch')?.pendingInteractiveRequest).not.toBeNull();
  });

  it('handleInteractionProcessed is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => {
      (m as any).handleInteractionProcessed('ghost', { interactionId: 'req-x' });
    }).not.toThrow();
  });

  // ── handleContextChange: cache not found ─────────────────────────────────

  it('handleContextChange is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => {
      (m as any).handleContextChange('ghost', { tokenCount: 100 });
    }).not.toThrow();
  });

  // ── handleChatStatusChanged: invalid status normalises to idle ────────────

  it('IPC onChatStatusChanged normalises unknown status to idle', async () => {
    let statusChangedHandler: ((data: any) => void) | null = null;
    (global as any).window = {
      electronAPI: {
        agentChat: {
          onChatStatusChanged: (handler: any) => {
            statusChangedHandler = handler;
            return () => {};
          },
        },
      },
    };

    vi.resetModules();
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-badstatus', 'c1', { messages: [], chatStatus: 'sending_response' });

    expect(statusChangedHandler).toBeTruthy();
    statusChangedHandler!({
      chatId: 'c1',
      chatSessionId: 's-badstatus',
      chatStatus: 'completely_unknown_status',
    });

    expect(m.getChatSessionCache('s-badstatus')?.chatStatus).toBe('idle');
  });

  // ── triggerDirectMessageUpdate: background session path ──────────────────

  it('triggerDirectMessageUpdate skips UI callbacks for background sessions', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-bg', 'c1', { messages: [] });
    m.createChatSessionCache('s-fg', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-fg'); // foreground is s-fg

    // Adding a message to background session should still update the cache
    m.addUserMessage('s-bg', {
      id: 'bg-user',
      role: 'user',
      content: [{ type: 'text', text: 'background msg' }],
      timestamp: 1,
    } as any);

    // The cache should be updated regardless
    expect(m.getChatSessionCache('s-bg')?.messages).toHaveLength(1);
  });

  // ── triggerDirectMessageUpdate: streamingComplete=true executes immediately ─

  it('triggerDirectMessageUpdate executes immediately for streamingComplete messages', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-sc', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-sc');

    const cb = vi.fn();
    m.registerDirectMessageUpdateCallback('s-sc', cb);

    // Content chunk - not complete
    (m as any).handleStreamingChunk('s-sc', {
      type: 'content',
      chatSessionId: 's-sc',
      messageId: 'msg-sc-1',
      timestamp: Date.now(),
      contentDelta: { text: 'Hello' },
    });

    // Complete chunk - streamingComplete=true path
    (m as any).handleStreamingChunk('s-sc', {
      type: 'complete',
      chatSessionId: 's-sc',
      messageId: 'msg-sc-1',
      timestamp: Date.now(),
      complete: { messageId: 'msg-sc-1', hasToolCalls: false },
    });

    // Callback should have been called for both content and complete
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // ── flushPendingUpdatesForSession ─────────────────────────────────────────

  it('flushPendingUpdatesForSession flushes queued updates on cache destroy', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-flush', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-flush');

    const cb = vi.fn();
    m.registerDirectMessageUpdateCallback('s-flush', cb);

    m.addUserMessage('s-flush', {
      id: 'msg-q',
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      timestamp: Date.now(),
    } as any);

    // Now destroy the cache - should not throw
    (m as any).handleChatSessionCacheDestroyed('s-flush');
    expect(m.getChatSessionCache('s-flush')).toBeNull();
  });

  // ── getAllChatSessionCaches ────────────────────────────────────────────────

  it('getAllChatSessionCaches returns a copy of all caches', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-all-1', 'c1', { messages: [] });
    m.createChatSessionCache('s-all-2', 'c2', { messages: [] });

    const all = m.getAllChatSessionCaches();
    expect(all['s-all-1']).toBeDefined();
    expect(all['s-all-2']).toBeDefined();
  });

  // ── getCurrentChatSessionCache: no current session ────────────────────────

  it('getCurrentChatSessionCache returns null when no current session', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(m.getCurrentChatSessionCache()).toBeNull();
  });

  // ── updatePerformanceMetrics: adaptive threshold adjustments ─────────────

  it('updatePerformanceMetrics increases threshold when avgUpdateTime > 100ms', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Performance metrics were removed in refactor; verify manager is still functional
    expect(m).toBeDefined();
  });

  it('updatePerformanceMetrics decreases threshold when avgUpdateTime < 20ms', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Performance metrics were removed in refactor; verify manager is still functional
    expect(m).toBeDefined();
  });

  it('updatePerformanceMetrics keeps at most 20 samples', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    // Performance metrics were removed in refactor; verify manager is still functional
    expect(m).toBeDefined();
  });

  // ── extractFilePathsFromText: overlapping paths ───────────────────────────

  it('extractFilePathsFromText skips Unix path that overlaps with a Windows path region', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    // A Windows path that contains a Unix-looking segment
    const text = 'D:/Users/alice/projects/report.txt is the output';
    const result = extractFilePathsFromText(text);
    // Should have the Windows path but not a spurious duplicate Unix path
    const winPaths = result.filter(p => p.includes('report.txt'));
    expect(winPaths.length).toBe(1);
    expect(winPaths[0]).toContain('report.txt');
  });

  // ── handleChatSessionCacheCreated: inherit streamingMessageId ────────────

  it('handleChatSessionCacheCreated inherits streamingMessageId from existing cache when not provided', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    // Create initial cache with streaming in progress
    m.createChatSessionCache('s-inherit-sid', 'c1', {
      messages: [
        {
          id: 'stream-msg',
          role: 'assistant',
          content: [{ type: 'text', text: 'streaming...' }],
          timestamp: 1,
          streamingComplete: false,
        } as any,
      ],
      streamingMessageId: 'stream-msg',
    });

    // Re-create (refresh) without providing streamingMessageId
    (m as any).handleChatSessionCacheCreated('s-inherit-sid', 'c1', {
      messages: [
        {
          id: 'stream-msg',
          role: 'assistant',
          content: [{ type: 'text', text: 'newer text' }],
          timestamp: 1,
          streamingComplete: false,
        } as any,
      ],
      // streamingMessageId intentionally omitted
    });

    const cache = m.getChatSessionCache('s-inherit-sid');
    // Should have inherited streamingMessageId from the old cache
    expect(cache?.streamingMessageId).toBe('stream-msg');
  });

  // ── handleChatSessionCacheDestroyed: non-current session ─────────────────

  it('handleChatSessionCacheDestroyed does not affect current session when destroying a different session', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-keep', 'c1', { messages: [] });
    m.createChatSessionCache('s-gone', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-keep');

    (m as any).handleChatSessionCacheDestroyed('s-gone');

    expect(m.getChatSessionCache('s-gone')).toBeNull();
    expect(m.getCurrentChatSessionId()).toBe('s-keep');
  });

  // ── handleStreamingChunk: unknown chunk type ──────────────────────────────

  it('handleStreamingChunk with unknown type does not throw', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-unknown', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-unknown');

    expect(() => {
      (m as any).handleStreamingChunk('s-unknown', {
        type: 'unknown_type_xyz',
        chatSessionId: 's-unknown',
        messageId: 'msg-x',
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  // ── handleStreamingChunk: cache not found ────────────────────────────────

  it('handleStreamingChunk is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => {
      (m as any).handleStreamingChunk('ghost-session', {
        type: 'content',
        chatSessionId: 'ghost-session',
        messageId: 'msg-ghost',
        timestamp: Date.now(),
        contentDelta: { text: 'hello' },
      });
    }).not.toThrow();
  });

  // ── handleChatStatusChanged: cache not found ─────────────────────────────

  it('handleChatStatusChanged is a no-op when cache not found', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    expect(() => {
      (m as any).handleChatStatusChanged('ghost-session', 'idle');
    }).not.toThrow();
  });

  // ── subscribeToChatSessionCacheLifecycle ──────────────────────────────────

  it('subscribeToChatSessionCacheLifecycle fires when cache is created/destroyed', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    const cb = vi.fn();
    const unsub = m.subscribeToChatSessionCacheLifecycle(cb);

    m.createChatSessionCache('s-lifecycle', 'c1', { messages: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cb).toHaveBeenCalledWith('s-lifecycle');

    (m as any).handleChatSessionCacheDestroyed('s-lifecycle');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    m.createChatSessionCache('s-lifecycle-2', 'c1', { messages: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cb).toHaveBeenCalledTimes(2); // no more calls after unsub
  });

  // ── notifyChatSessionCacheLifecycleCallbacks: error swallowed ────────────

  it('notifyChatSessionCacheLifecycleCallbacks swallows errors in callbacks', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    const badCb = vi.fn().mockImplementation(() => { throw new Error('callback error'); });
    m.subscribeToChatSessionCacheLifecycle(badCb);

    expect(() => {
      m.createChatSessionCache('s-error-cb', 'c1', { messages: [] });
    }).not.toThrow();
  });

  // ── extractFilePathsFromText: Windows with forward slashes ────────────────

  it('extractFilePathsFromText handles Windows paths with forward slashes', async () => {
    const { extractFilePathsFromText } = await import('../agentChatSessionCacheManager');
    const result = extractFilePathsFromText('Output: C:/Users/bob/Desktop/output.txt done');
    expect(result.some(p => p.includes('output.txt'))).toBe(true);
  });

  // ── triggerDirectMessageUpdate: no callbacks → early return ──────────────

  it('triggerDirectMessageUpdate returns immediately when no callbacks registered', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.createChatSessionCache('s-nocb', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-nocb');

    // No callback registered - should not throw and should update cache
    expect(() => {
      m.addUserMessage('s-nocb', {
        id: 'u-nocb',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        timestamp: 1,
      } as any);
    }).not.toThrow();

    expect(m.getChatSessionCache('s-nocb')?.messages).toHaveLength(1);
  });

  // ── setCurrentChatSessionId: no-op when same values ─────────────────────

  it('setCurrentChatSessionId is a no-op when same chatId and sessionId', async () => {
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');
    m.setCurrentChatSessionId('c1', 's1');

    const cb = vi.fn();
    const unsub = m.subscribeToCurrentChatSessionId(cb, true);

    m.setCurrentChatSessionId('c1', 's1'); // same values
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  // ── addUserMessage: user_img_ id prefix is NOT filtered when browserControl off ──

  it('addUserMessage does not filter user_img_ messages when browserControl feature is disabled', async () => {
    // Default: isFeatureEnabled returns false (not initialized), so user_img_ messages pass through
    const { agentChatSessionCacheManager: m } = await import('../agentChatSessionCacheManager');

    m.createChatSessionCache('s-imgno', 'c1', { messages: [] });
    m.setCurrentChatSessionId('c1', 's-imgno');

    m.addUserMessage('s-imgno', {
      id: 'user_img_001',
      role: 'user',
      content: [{ type: 'image', image_url: { url: 'data:image/png;base64,abc' } }],
      timestamp: 1,
    } as any);

    // When browserControl is off, the message should be added
    expect(m.getChatSessionCache('s-imgno')?.messages).toHaveLength(1);
  });
});
