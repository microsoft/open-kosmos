// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---- helpers ----

function makeElectronAPI() {
  const cleanup = vi.fn(() => vi.fn());
  return {
    agentChat: {
      onStreamingChunk: vi.fn(() => vi.fn()),
      onStreamingMessage: vi.fn(() => vi.fn()),
      onToolUse: vi.fn(() => vi.fn()),
      onToolResult: vi.fn(() => vi.fn()),
      onToolMessageAdded: vi.fn(() => vi.fn()),
      onContextChange: vi.fn(() => vi.fn()),
      initialize: vi.fn(async () => ({ success: true })),
      switchToChatSession: vi.fn(async () => ({ success: true, data: { chatSessionId: 'sess-1' } })),
      getCurrentInstance: vi.fn(async () => ({ success: true, data: { id: 'inst-1' } })),
      getCurrentChatId: vi.fn(async () => ({ success: true, data: 'chat-1' })),
      getChatHistory: vi.fn(async () => ({ success: true, data: [{ id: 'm1' }] })),
      getDisplayMessages: vi.fn(async () => ({ success: true, data: [{ id: 'm1' }] })),
      streamMessage: vi.fn(async () => ({ success: true, data: [{ id: 'm2' }] })),
      retryChat: vi.fn(async () => ({ success: true, data: [{ id: 'm3' }] })),
      editUserMessage: vi.fn(async () => ({ success: true, data: [{ id: 'm4' }] })),
      canEditUserMessage: vi.fn(async () => ({ success: true, data: { canEdit: true } })),
      cancelChatSession: vi.fn(async () => ({ success: true })),
      cancelChat: vi.fn(async () => ({ success: true })),
      syncChatHistory: vi.fn(async () => ({ success: true })),
      refreshCurrentInstance: vi.fn(async () => ({ success: true, data: { id: 'inst-2' } })),
      getCurrentContextTokenUsage: vi.fn(async () => ({ success: true, data: { tokenCount: 100, totalMessages: 5, contextMessages: 3, compressionRatio: 0.6 } })),
      replaceFilePathInSession: vi.fn(async () => ({ success: true })),
    },
  };
}

describe('AgentChatIpc', () => {
  let api: ReturnType<typeof makeElectronAPI>;

  beforeEach(() => {
    vi.resetModules();
    api = makeElectronAPI();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: api,
    });
  });

  async function getInstance() {
    const mod = await import('../agentChatIpc');
    return mod.agentChatIpc;
  }

  it('sets up all six IPC listeners on construction', async () => {
    await getInstance();
    expect(api.agentChat.onStreamingChunk).toHaveBeenCalled();
    expect(api.agentChat.onStreamingMessage).toHaveBeenCalled();
    expect(api.agentChat.onToolUse).toHaveBeenCalled();
    expect(api.agentChat.onToolResult).toHaveBeenCalled();
    expect(api.agentChat.onToolMessageAdded).toHaveBeenCalled();
    expect(api.agentChat.onContextChange).toHaveBeenCalled();
  });

  it('initialize() calls IPC and resolves', async () => {
    const ipc = await getInstance();
    await expect(ipc.initialize('alice')).resolves.toBeUndefined();
    expect(api.agentChat.initialize).toHaveBeenCalledWith('alice');
  });

  it('initialize() throws when IPC returns failure', async () => {
    api.agentChat.initialize.mockResolvedValue({ success: false, error: 'bad init' });
    const ipc = await getInstance();
    await expect(ipc.initialize('alice')).rejects.toThrow('bad init');
  });

  it('switchToChatSession() returns null for missing args', async () => {
    const ipc = await getInstance();
    await expect(ipc.switchToChatSession('', null)).resolves.toBeNull();
    await expect(ipc.switchToChatSession('chat-1', null)).resolves.toBeNull();
  });

  it('switchToChatSession() returns data on success', async () => {
    const ipc = await getInstance();
    const result = await ipc.switchToChatSession('chat-1', 'sess-1');
    expect(result).toEqual({ chatSessionId: 'sess-1' });
  });

  it('switchToChatSession() throws on IPC failure', async () => {
    api.agentChat.switchToChatSession.mockResolvedValue({ success: false, error: 'fail' });
    const ipc = await getInstance();
    await expect(ipc.switchToChatSession('chat-1', 'sess-1')).rejects.toThrow('fail');
  });

  it('getCurrentInstance() throws instructing to use async version', async () => {
    const ipc = await getInstance();
    expect(() => ipc.getCurrentInstance()).toThrow();
  });

  it('getCurrentInstanceAsync() returns data', async () => {
    const ipc = await getInstance();
    const result = await ipc.getCurrentInstanceAsync();
    expect(result).toEqual({ id: 'inst-1' });
  });

  it('getCurrentInstanceAsync() returns null on failure', async () => {
    api.agentChat.getCurrentInstance.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.getCurrentInstanceAsync()).toBeNull();
  });

  it('getCurrentChatId() throws', async () => {
    const ipc = await getInstance();
    expect(() => ipc.getCurrentChatId()).toThrow();
  });

  it('getCurrentChatIdAsync() returns chat id', async () => {
    const ipc = await getInstance();
    expect(await ipc.getCurrentChatIdAsync()).toBe('chat-1');
  });

  it('getCurrentChatIdAsync() returns null on failure', async () => {
    api.agentChat.getCurrentChatId.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.getCurrentChatIdAsync()).toBeNull();
  });

  it('getChatHistory() throws', async () => {
    const ipc = await getInstance();
    expect(() => ipc.getChatHistory()).toThrow();
  });

  it('getChatHistoryAsync() returns messages', async () => {
    const ipc = await getInstance();
    const messages = await ipc.getChatHistoryAsync();
    expect(messages).toEqual([{ id: 'm1' }]);
  });

  it('getChatHistoryAsync() returns empty on failure', async () => {
    api.agentChat.getChatHistory.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.getChatHistoryAsync()).toEqual([]);
  });

  it('getDisplayMessagesAsync() returns messages', async () => {
    const ipc = await getInstance();
    expect(await ipc.getDisplayMessagesAsync()).toEqual([{ id: 'm1' }]);
  });

  it('getDisplayMessagesAsync() returns empty on failure', async () => {
    api.agentChat.getDisplayMessages.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.getDisplayMessagesAsync()).toEqual([]);
  });

  it('streamMessage() returns messages and registers/unregisters callbacks', async () => {
    const ipc = await getInstance();
    const onMsg = vi.fn();
    const onTool = vi.fn();
    const onResult = vi.fn();
    const msgs = await ipc.streamMessage(
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 },
      { onAssistantMessage: onMsg, onToolUse: onTool, onToolResult: onResult },
    );
    expect(msgs).toEqual([{ id: 'm2' }]);
  });

  it('streamMessage() throws and cleans up callbacks on failure', async () => {
    api.agentChat.streamMessage.mockResolvedValue({ success: false, error: 'stream fail' });
    const ipc = await getInstance();
    const onMsg = vi.fn();
    await expect(ipc.streamMessage(
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 },
      { onAssistantMessage: onMsg },
    )).rejects.toThrow('stream fail');
  });

  it('streamMessage() with no callbacks works', async () => {
    const ipc = await getInstance();
    const msgs = await ipc.streamMessage(
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 },
    );
    expect(msgs).toEqual([{ id: 'm2' }]);
  });

  it('retryChat() returns messages', async () => {
    const ipc = await getInstance();
    expect(await ipc.retryChat('sess-1')).toEqual([{ id: 'm3' }]);
  });

  it('retryChat() throws on failure', async () => {
    api.agentChat.retryChat.mockResolvedValue({ success: false, error: 'retry fail' });
    const ipc = await getInstance();
    await expect(ipc.retryChat('sess-1')).rejects.toThrow('retry fail');
  });

  it('editUserMessage() returns messages', async () => {
    const ipc = await getInstance();
    const msgs = await ipc.editUserMessage('sess-1', 'msg-1', { id: 'msg-1', role: 'user', content: [], timestamp: 0 });
    expect(msgs).toEqual([{ id: 'm4' }]);
  });

  it('editUserMessage() throws on failure', async () => {
    api.agentChat.editUserMessage.mockResolvedValue({ success: false, error: 'edit fail' });
    const ipc = await getInstance();
    await expect(ipc.editUserMessage('sess-1', 'msg-1', { id: 'msg-1', role: 'user', content: [], timestamp: 0 })).rejects.toThrow('edit fail');
  });

  it('canEditUserMessage() returns canEdit result', async () => {
    const ipc = await getInstance();
    expect(await ipc.canEditUserMessage('sess-1', 'msg-1')).toEqual({ canEdit: true });
  });

  it('canEditUserMessage() throws on failure', async () => {
    api.agentChat.canEditUserMessage.mockResolvedValue({ success: false, error: 'cannot edit' });
    const ipc = await getInstance();
    await expect(ipc.canEditUserMessage('sess-1', 'msg-1')).rejects.toThrow('cannot edit');
  });

  it('cancelChatSession() succeeds', async () => {
    const ipc = await getInstance();
    await expect(ipc.cancelChatSession('sess-1')).resolves.toBeUndefined();
  });

  it('cancelChatSession() with no sessionId logs and returns early', async () => {
    const ipc = await getInstance();
    await expect(ipc.cancelChatSession(undefined)).resolves.toBeUndefined();
    expect(api.agentChat.cancelChatSession).not.toHaveBeenCalled();
  });

  it('cancelChatSession() throws on IPC failure', async () => {
    api.agentChat.cancelChatSession.mockResolvedValue({ success: false, error: 'cancel fail' });
    const ipc = await getInstance();
    await expect(ipc.cancelChatSession('sess-1')).rejects.toThrow('cancel fail');
  });

  it('cancelChat() uses provided chatId', async () => {
    const ipc = await getInstance();
    await expect(ipc.cancelChat('chat-1')).resolves.toBeUndefined();
    expect(api.agentChat.cancelChat).toHaveBeenCalledWith('chat-1');
  });

  it('cancelChat() fetches chatId when not provided', async () => {
    const ipc = await getInstance();
    await expect(ipc.cancelChat()).resolves.toBeUndefined();
    expect(api.agentChat.getCurrentChatId).toHaveBeenCalled();
    expect(api.agentChat.cancelChat).toHaveBeenCalledWith('chat-1');
  });

  it('cancelChat() handles no chatId available', async () => {
    api.agentChat.getCurrentChatId.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    await expect(ipc.cancelChat()).resolves.toBeUndefined();
    expect(api.agentChat.cancelChat).not.toHaveBeenCalled();
  });

  it('cancelChat() throws on IPC failure', async () => {
    api.agentChat.cancelChat.mockResolvedValue({ success: false, error: 'cancel chat fail' });
    const ipc = await getInstance();
    await expect(ipc.cancelChat('chat-1')).rejects.toThrow('cancel chat fail');
  });

  it('syncChatHistory() calls IPC', async () => {
    const ipc = await getInstance();
    await expect(ipc.syncChatHistory([])).resolves.toBeUndefined();
    expect(api.agentChat.syncChatHistory).toHaveBeenCalled();
  });

  it('refreshCurrentInstance() returns data', async () => {
    const ipc = await getInstance();
    expect(await ipc.refreshCurrentInstance()).toEqual({ id: 'inst-2' });
  });

  it('refreshCurrentInstance() returns null on failure', async () => {
    api.agentChat.refreshCurrentInstance.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.refreshCurrentInstance()).toBeNull();
  });

  it('getCurrentContextTokenUsage() returns usage data', async () => {
    const ipc = await getInstance();
    const usage = await ipc.getCurrentContextTokenUsage();
    expect(usage).toEqual({ tokenCount: 100, totalMessages: 5, contextMessages: 3, compressionRatio: 0.6 });
  });

  it('getCurrentContextTokenUsage() returns null on failure', async () => {
    api.agentChat.getCurrentContextTokenUsage.mockResolvedValue({ success: false });
    const ipc = await getInstance();
    expect(await ipc.getCurrentContextTokenUsage()).toBeNull();
  });

  it('getCurrentContextTokenUsage() returns null on throw', async () => {
    api.agentChat.getCurrentContextTokenUsage.mockRejectedValue(new Error('IPC error'));
    const ipc = await getInstance();
    expect(await ipc.getCurrentContextTokenUsage()).toBeNull();
  });

  it('addContextChangeListener() is notified via IPC event', async () => {
    // Capture the onContextChange callback
    let contextChangeHandler: ((data: any) => void) | null = null;
    api.agentChat.onContextChange.mockImplementation((cb: (data: any) => void) => {
      contextChangeHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const listener = vi.fn();
    ipc.addContextChangeListener(listener);

    contextChangeHandler!({ chatSessionId: 'sess-1', stats: { tokenCount: 42 } });
    expect(listener).toHaveBeenCalledWith({ tokenCount: 42 });
  });

  it('addContextChangeListener() immediately calls back with cached stats', async () => {
    let contextChangeHandler: ((data: any) => void) | null = null;
    api.agentChat.onContextChange.mockImplementation((cb: (data: any) => void) => {
      contextChangeHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    // First fire an event to populate cache
    contextChangeHandler!({ chatSessionId: 'sess-1', stats: { tokenCount: 99 } });

    const lateListener = vi.fn();
    ipc.addContextChangeListener(lateListener);
    expect(lateListener).toHaveBeenCalledWith({ tokenCount: 99 });
  });

  it('removeContextChangeListener() stops notifications', async () => {
    let contextChangeHandler: ((data: any) => void) | null = null;
    api.agentChat.onContextChange.mockImplementation((cb: (data: any) => void) => {
      contextChangeHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const listener = vi.fn();
    ipc.addContextChangeListener(listener);
    ipc.removeContextChangeListener(listener);

    contextChangeHandler!({ chatSessionId: 'sess-1', stats: { tokenCount: 10 } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('destroy() clears all cleanup functions and listener arrays', async () => {
    const cleanupFns = {
      chunk: vi.fn(),
      streaming: vi.fn(),
      toolUse: vi.fn(),
      toolResult: vi.fn(),
      toolMessageAdded: vi.fn(),
      contextChange: vi.fn(),
    };
    api.agentChat.onStreamingChunk.mockReturnValue(cleanupFns.chunk);
    api.agentChat.onStreamingMessage.mockReturnValue(cleanupFns.streaming);
    api.agentChat.onToolUse.mockReturnValue(cleanupFns.toolUse);
    api.agentChat.onToolResult.mockReturnValue(cleanupFns.toolResult);
    api.agentChat.onToolMessageAdded.mockReturnValue(cleanupFns.toolMessageAdded);
    api.agentChat.onContextChange.mockReturnValue(cleanupFns.contextChange);

    const ipc = await getInstance();
    ipc.destroy();

    expect(cleanupFns.chunk).toHaveBeenCalled();
    expect(cleanupFns.streaming).toHaveBeenCalled();
    expect(cleanupFns.toolUse).toHaveBeenCalled();
    expect(cleanupFns.toolResult).toHaveBeenCalled();
    expect(cleanupFns.toolMessageAdded).toHaveBeenCalled();
    expect(cleanupFns.contextChange).toHaveBeenCalled();
  });

  it('toolMessageAdded IPC event dispatches custom window event', async () => {
    let toolMessageHandler: ((data: any) => void) | null = null;
    api.agentChat.onToolMessageAdded.mockImplementation((cb: (data: any) => void) => {
      toolMessageHandler = cb;
      return vi.fn();
    });

    await getInstance();

    const eventListener = vi.fn();
    window.addEventListener('agentChat:toolMessageAdded', eventListener);

    toolMessageHandler!({ toolName: 'file_read', result: 'ok' });
    expect(eventListener).toHaveBeenCalledTimes(1);

    window.removeEventListener('agentChat:toolMessageAdded', eventListener);
  });

  it('streaming message listener error does not crash the handler', async () => {
    let streamingHandler: ((msg: any) => void) | null = null;
    api.agentChat.onStreamingMessage.mockImplementation((cb: (msg: any) => void) => {
      streamingHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    // Directly push into internal list via streamMessage to add then trigger
    const msg = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 } as any;

    // Start a stream to register callback
    const streamPromise = ipc.streamMessage(msg, { onAssistantMessage: badListener });
    streamingHandler!({ id: 'a1' });
    await streamPromise;
    // No throw means error was swallowed
  });

  it('toolUse listener error is swallowed', async () => {
    let toolUseHandler: ((name: string) => void) | null = null;
    api.agentChat.onToolUse.mockImplementation((cb: (name: string) => void) => {
      toolUseHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('tooluse error'); });
    const msg = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 } as any;
    const streamPromise = ipc.streamMessage(msg, { onToolUse: badListener });
    toolUseHandler!('some_tool');
    await streamPromise;
  });

  it('toolResult listener error is swallowed', async () => {
    let toolResultHandler: ((result: any) => void) | null = null;
    api.agentChat.onToolResult.mockImplementation((cb: (result: any) => void) => {
      toolResultHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('toolresult error'); });
    const msg = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 } as any;
    const streamPromise = ipc.streamMessage(msg, { onToolResult: badListener });
    toolResultHandler!({ id: 'r1' });
    await streamPromise;
  });

  it('contextChange listener error is swallowed', async () => {
    let contextChangeHandler: ((data: any) => void) | null = null;
    api.agentChat.onContextChange.mockImplementation((cb: (data: any) => void) => {
      contextChangeHandler = cb;
      return vi.fn();
    });

    const ipc = await getInstance();
    const badListener = vi.fn().mockImplementation(() => { throw new Error('context error'); });
    ipc.addContextChangeListener(badListener);
    // Should not throw
    contextChangeHandler!({ chatSessionId: 'sess-1', stats: { tokenCount: 1 } });
    expect(badListener).toHaveBeenCalled();
  });

  it('contextChange with no listeners logs debug without throw', async () => {
    let contextChangeHandler: ((data: any) => void) | null = null;
    api.agentChat.onContextChange.mockImplementation((cb: (data: any) => void) => {
      contextChangeHandler = cb;
      return vi.fn();
    });

    await getInstance();
    // No listeners registered
    expect(() => {
      contextChangeHandler!({ chatSessionId: 'sess-1', stats: { tokenCount: 1 } });
    }).not.toThrow();
  });

  it('destroy() is idempotent (safe to call twice)', async () => {
    const ipc = await getInstance();
    ipc.destroy();
    expect(() => ipc.destroy()).not.toThrow();
  });
});
