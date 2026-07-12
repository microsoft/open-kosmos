vi.mock('electron', async () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../wsServer', async () => {
  const handlers: Record<string, Function> = {};
  return {
    ExternalAgentWsServer: vi.fn().mockImplementation(function(this: any) {
      this.setTokenValidator = vi.fn();
      this.onPush = vi.fn((h: Function) => { handlers.push = h; });
      this.onPushEnd = vi.fn((h: Function) => { handlers.pushEnd = h; });
      this.onConnected = vi.fn((h: Function) => { handlers.connected = h; });
      this.onDisconnected = vi.fn((h: Function) => { handlers.disconnected = h; });
      this.start = vi.fn();
      this.stop = vi.fn();
      this.sendMessage = vi.fn(() => true);
      Object.defineProperty(this, 'isConnected', { get: () => true });
    }),
    __handlers: handlers,
  };
});

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/ipc/externalAgent', async () => ({
  mainToRender: {
    bindWebContents: vi.fn(() => ({
      statusChanged: vi.fn(),
    })),
  },
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(() => ({ sessions: [] })),
    ensureLoaded: vi.fn(() => ({
      file: { chat_history: [], context_history: [] },
      metadata: {},
    })),
    patchFile: vi.fn(),
    setReadStatus: vi.fn(() => Promise.resolve()),
  },
}));

const mockAgentChat = {
  hasEventSender: vi.fn(() => true),
  setEventSender: vi.fn(),
  handlePushChunk: vi.fn(),
  handlePushComplete: vi.fn(() => Promise.resolve()),
  addMessageToSession: vi.fn(() => Promise.resolve()),
};

vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: {
    getInstanceByChatSessionId: vi.fn(() => null),
    markChatSessionAsUnreadIfNeeded: vi.fn(() => Promise.resolve()),
  },
}));

import { ExternalAgentService } from '../externalAgentService';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { chatSessionStore } from '../../chat/chatSessionStore';
import { mainToRender } from '@shared/ipc/externalAgent';
const { __handlers } = await import('../wsServer') as any as { __handlers: Record<string, Function> };
import { agentChatManager } from '../../chat/agentChatManager';

describe('ExternalAgentService', () => {
  let service: ExternalAgentService;

  beforeEach(() => {
    // Reset singleton for each test
    (ExternalAgentService as any).instance = null;
    service = ExternalAgentService.getInstance();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('returns singleton instance', () => {
    const s2 = ExternalAgentService.getInstance();
    expect(service).toBe(s2);
  });

  it('starts WS server on given port', async () => {
    await service.start('test-alias', 9527);
    // Second call should skip (already started)
    await service.start('test-alias', 9527);
  });

  it('token validator returns false when no matching chat found', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1', agent: { source: 'EXTERNAL', authToken: 'different-token' } }],
    });
    await service.start('test-alias', 9527);

    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    expect(validator('tok-no-match')).toBe(false);
  });

  it('token validator returns false when profile not found', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue(null);
    await service.start('test-alias', 9527);

    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    expect(validator('tok-1')).toBe(false);
  });

  it('token validator accepts a matching external agent token', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1', agent: { source: 'EXTERNAL', authToken: 'tok-1' } }],
    });
    await service.start('test-alias', 9527);

    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    expect(validator('tok-1')).toBe(true);
    expect((service as any).tokenToChatId.get('tok-1')).toBe('chat-1');
  });

  it('stop() is safe before the service has started', async () => {
    await service.stop();
    expect(service.isConnected).toBe(false);
  });

  it('token validator rejects when the cached profile is missing', async () => {
    await service.start('test-alias', 9527);
    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    (profileCacheManager.getCachedProfile as any).mockReturnValue(null);

    expect(validator('tok-missing-profile')).toBe(false);
  });

  it('stops cleanly', async () => {
    await service.start('test-alias', 9527);
    await service.stop();
    expect(service.isConnected).toBe(false);
  });

  it('sendMessage returns false when not started', () => {
    expect(service.sendMessage('hello', 'chat1', 'conv1')).toBe(false);
  });

  it('sendMessage returns false when no authToken in chat config', async () => {
    await service.start('test-alias', 9527);
    (profileCacheManager.getChatConfig as any).mockReturnValue({
      agent: { source: 'EXTERNAL' },
    });
    expect(service.sendMessage('hello', 'chat1', 'conv1')).toBe(false);
  });

  it('sendMessage succeeds with valid authToken', async () => {
    await service.start('test-alias', 9527);
    (profileCacheManager.getChatConfig as any).mockReturnValue({
      agent: { source: 'EXTERNAL', authToken: 'tok-123' },
    });
    expect(service.sendMessage('hello', 'chat1', 'conv1')).toBe(true);
  });

  it('stop() resets alias to null so service can be re-initialized', async () => {
    await service.start('test-alias', 9527);
    await service.stop();

    expect(service.sendMessage('hello', 'chat1', 'conv1')).toBe(false);

    await service.start('new-alias', 9527);
    (profileCacheManager.getChatConfig as any).mockReturnValue({
      agent: { source: 'EXTERNAL', authToken: 'tok-new' },
    });
    expect(service.sendMessage('hello', 'chat1', 'conv1')).toBe(true);
  });
});

describe('ExternalAgentService push routing', () => {
  let service: ExternalAgentService;
  const handlers = __handlers as Record<string, Function>;

  /** Start service and register a token→chatId mapping via the token validator */
  async function startWithToken(token: string, chatId: string) {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: chatId, agent: { source: 'EXTERNAL', authToken: token } }],
    });
    await service.start('test-alias', 9527);
    // Trigger the token validator to populate tokenToChatId
    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    validator(token);
  }

  /** Flush microtask queue so fire-and-forget async handlers complete */
  const flush = () => new Promise(r => setTimeout(r, 0));

  beforeEach(async () => {
    (ExternalAgentService as any).instance = null;
    service = ExternalAgentService.getInstance();
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(null);
    vi.mocked(agentChatManager.markChatSessionAsUnreadIfNeeded).mockClear();
    vi.mocked(agentChatManager.markChatSessionAsUnreadIfNeeded).mockReturnValue(Promise.resolve());
    mockAgentChat.handlePushChunk.mockClear();
    mockAgentChat.handlePushComplete.mockClear();
    mockAgentChat.addMessageToSession.mockClear();
    mockAgentChat.setEventSender.mockClear();
    mockAgentChat.hasEventSender.mockReturnValue(true);
    vi.mocked(chatSessionStore.patchFile).mockClear();
    vi.mocked(chatSessionStore.ensureLoaded).mockClear();
    vi.mocked(chatSessionStore.ensureLoaded).mockResolvedValue({
      file: { chat_history: [], context_history: [] },
      metadata: {},
    } as any);
    vi.mocked(chatSessionStore.setReadStatus).mockResolvedValue(undefined as any);

    // Reset BrowserWindow mock to default (no windows)
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('routes push chunk through AgentChat when instance exists', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    handlers.push('hello world', 'conv-1', 'tok-1');
    await flush();

    expect(agentChatManager.getInstanceByChatSessionId).toHaveBeenCalledWith('conv-1');
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('hello world', expect.stringMatching(/^msg_push_/));
  });

  it('routes push_end: persists via AgentChat.addMessageToSession and cleans up UI', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    // Send chunk first so accumulator has text
    handlers.push('hello', 'conv-1', 'tok-1');
    await flush();

    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // AgentChat handles UI cleanup only (skipPersistence=true)
    expect(mockAgentChat.handlePushComplete).toHaveBeenCalledWith(true);
    // Service persists via AgentChat.addMessageToSession (single owner, atomic in-memory + disk)
    expect(mockAgentChat.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant' })
    );
    // patchFile should NOT be called when AgentChat exists
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
    expect(agentChatManager.markChatSessionAsUnreadIfNeeded).toHaveBeenCalledWith('conv-1');
  });

  it('accumulates push chunk when no AgentChat instance exists', async () => {
    await startWithToken('tok-1', 'chat-1');
    // agentChatManager returns null (default)

    handlers.push('accumulated text', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.handlePushChunk).not.toHaveBeenCalled();
    // Text is accumulated at the service layer for later persistence
    expect((service as any).pushStreams.get('conv-1').text).toBe('accumulated text');
  });

  it('persists push message and marks unread when no AgentChat instance exists', async () => {
    await startWithToken('tok-1', 'chat-1');
    // agentChatManager returns null (default)

    // Simulate push + push_end without AgentChat instance
    handlers.push('offline message', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.handlePushComplete).not.toHaveBeenCalled();
    expect(chatSessionStore.ensureLoaded).toHaveBeenCalledWith('test-alias', 'chat-1', 'conv-1');
    expect(chatSessionStore.patchFile).toHaveBeenCalledWith(
      'test-alias', 'chat-1', 'conv-1',
      expect.objectContaining({
        chat_history: expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]),
        context_history: expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]),
      })
    );
    expect(agentChatManager.markChatSessionAsUnreadIfNeeded).not.toHaveBeenCalled();
    expect(chatSessionStore.setReadStatus).toHaveBeenCalledWith(
      'test-alias', 'chat-1', 'conv-1', 'unread'
    );
  });

  it('ignores push from unknown token', async () => {
    await startWithToken('tok-1', 'chat-1');

    handlers.push('text', 'conv-1', 'unknown-token');
    await flush();

    expect(mockAgentChat.handlePushChunk).not.toHaveBeenCalled();
  });

  it('ignores push when the alias has been cleared', async () => {
    await startWithToken('tok-1', 'chat-1');
    (service as any).alias = null;

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.handlePushChunk).not.toHaveBeenCalled();
  });

  it('reuses the existing stream accumulator for later chunks', async () => {
    await startWithToken('tok-1', 'chat-1');

    handlers.push('first', 'conv-1', 'tok-1');
    await flush();
    handlers.push(' second', 'conv-1', 'tok-1');
    await flush();

    expect((service as any).pushStreams.get('conv-1').text).toBe('first second');
  });

  it('attaches a window sender before routing a push chunk when needed', async () => {
    await startWithToken('tok-1', 'chat-1');
    const webContents = {};
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents } as any,
    ]);
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);
    mockAgentChat.hasEventSender.mockReturnValue(false);

    handlers.push('hello', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.setEventSender).toHaveBeenCalledWith(webContents);
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('hello', expect.stringMatching(/^msg_push_/));
  });

  it('continues routing a push chunk when no window is available to attach', async () => {
    await startWithToken('tok-1', 'chat-1');
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);
    mockAgentChat.hasEventSender.mockReturnValue(false);

    handlers.push('hello', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.setEventSender).not.toHaveBeenCalled();
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('hello', expect.stringMatching(/^msg_push_/));
  });

  it('persists full text when AgentChat appears mid-stream (rejoin)', async () => {
    await startWithToken('tok-1', 'chat-1');

    // First chunks arrive without AgentChat (user away)
    handlers.push('AB', 'conv-1', 'tok-1');
    await flush();
    expect(mockAgentChat.handlePushChunk).not.toHaveBeenCalled();

    // User returns — AgentChat now exists
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);
    handlers.push('CD', 'conv-1', 'tok-1');
    await flush();
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('CD', expect.stringMatching(/^msg_push_/));

    // push_end: service persists full "ABCD" via AgentChat.addMessageToSession, AgentChat does UI-only cleanup
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: expect.arrayContaining([expect.objectContaining({ text: 'ABCD' })]) })
    );
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
    expect(mockAgentChat.handlePushComplete).toHaveBeenCalledWith(true);
  });

  it('handles AgentChat destroyed mid-stream', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    // First chunk with AgentChat
    handlers.push('AB', 'conv-1', 'tok-1');
    await flush();
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('AB', expect.stringMatching(/^msg_push_/));

    // AgentChat destroyed (idle timeout)
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(null);
    handlers.push('CD', 'conv-1', 'tok-1');
    await flush();

    // push_end: service persists full "ABCD", no AgentChat for UI
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(chatSessionStore.patchFile).toHaveBeenCalledWith(
      'test-alias', 'chat-1', 'conv-1',
      expect.objectContaining({
        chat_history: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: expect.arrayContaining([expect.objectContaining({ text: 'ABCD' })]) }),
        ]),
      })
    );
    expect(mockAgentChat.handlePushComplete).not.toHaveBeenCalled();
  });

  it('skips addMessageToSession when push_end arrives without prior push chunks (AgentChat path)', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    // push_end without any prior push message
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // AgentChat UI cleanup should still be called
    expect(mockAgentChat.handlePushComplete).toHaveBeenCalledWith(true);
    // But no message to persist
    expect(mockAgentChat.addMessageToSession).not.toHaveBeenCalled();
  });

  it('does not persist or mark unread when push_end has no text and no AgentChat instance', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(chatSessionStore.setReadStatus).mockClear();

    handlers.pushEnd('conv-1', 'tok-1');
    await flush();
    await flush();

    expect(chatSessionStore.ensureLoaded).not.toHaveBeenCalled();
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
    expect(chatSessionStore.setReadStatus).not.toHaveBeenCalled();
  });

  it('uses same message ID for streaming and persistence', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();

    // Capture the msgId passed to streaming
    const streamingMsgId = mockAgentChat.handlePushChunk.mock.calls[0][1];
    expect(streamingMsgId).toMatch(/^msg_push_/);

    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // Persisted message should use the same ID
    expect(mockAgentChat.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: streamingMsgId })
    );
  });

  it('marks unread via chatSessionStore when no AgentChat instance (offline)', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(chatSessionStore.setReadStatus).mockClear();

    handlers.push('offline msg', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(chatSessionStore.setReadStatus).toHaveBeenCalledWith(
      'test-alias', 'chat-1', 'conv-1', 'unread'
    );
  });

  it('warns and returns when ensureLoaded returns null (session not found)', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(chatSessionStore.ensureLoaded).mockResolvedValue(null as any);

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(chatSessionStore.ensureLoaded).toHaveBeenCalledWith('test-alias', 'chat-1', 'conv-1');
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
  });

  it('logs error when persistPushMessage throws', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(chatSessionStore.ensureLoaded).mockRejectedValue(new Error('disk failure'));

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // Error is swallowed by catch — just verify no unhandled rejection
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
  });

  it('ignores pushEnd from unknown token', async () => {
    await startWithToken('tok-1', 'chat-1');

    handlers.pushEnd('conv-1', 'unknown-token');
    await flush();

    expect(mockAgentChat.handlePushComplete).not.toHaveBeenCalled();
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
  });

  it('ignores pushEnd when the alias has been cleared', async () => {
    await startWithToken('tok-1', 'chat-1');
    (service as any).alias = null;

    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.handlePushComplete).not.toHaveBeenCalled();
    expect(chatSessionStore.patchFile).not.toHaveBeenCalled();
  });

  it('broadcasts status only to live windows', async () => {
    await service.start('test-alias', 9527);
    const aliveSender = { send: vi.fn() };
    const deadSender = { send: vi.fn() };
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => true, webContents: deadSender } as any,
      { isDestroyed: () => false, webContents: aliveSender } as any,
    ]);

    handlers.connected();
    handlers.disconnected();

    expect(mainToRender.bindWebContents).toHaveBeenCalledTimes(2);
    expect(mainToRender.bindWebContents).toHaveBeenCalledWith(aliveSender);
    expect(mainToRender.bindWebContents).not.toHaveBeenCalledWith(deadSender);
  });

  it('swallows markChatSessionAsUnreadIfNeeded errors (AgentChat path)', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);
    vi.mocked(agentChatManager.markChatSessionAsUnreadIfNeeded).mockRejectedValue(new Error('unread fail'));

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // Should not throw — error is caught
    expect(mockAgentChat.handlePushComplete).toHaveBeenCalled();
  });

  it('swallows chatSessionStore.setReadStatus errors (offline path)', async () => {
    await startWithToken('tok-1', 'chat-1');
    vi.mocked(chatSessionStore.setReadStatus).mockRejectedValue(new Error('status fail'));

    handlers.push('text', 'conv-1', 'tok-1');
    await flush();
    handlers.pushEnd('conv-1', 'tok-1');
    await flush();

    // Should not throw
    expect(chatSessionStore.ensureLoaded).toHaveBeenCalled();
  });

  it('attaches event sender when hasEventSender returns false and main window exists', async () => {
    const { BrowserWindow } = await import('electron');
    const mockWebContents = { send: vi.fn() };
    const mockWin = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as any]);

    await startWithToken('tok-1', 'chat-1');
    mockAgentChat.hasEventSender.mockReturnValue(false);
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    handlers.push('hello', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.setEventSender).toHaveBeenCalledWith(mockWebContents);
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalled();
  });

  it('warns when hasEventSender is false and no main window available', async () => {
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);

    await startWithToken('tok-1', 'chat-1');
    mockAgentChat.hasEventSender.mockReturnValue(false);
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);

    handlers.push('hello', 'conv-1', 'tok-1');
    await flush();

    expect(mockAgentChat.setEventSender).not.toHaveBeenCalled();
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalled();
  });

  it('covers direct awaited push branches for stable coverage', async () => {
    (service as any).alias = 'test-alias';
    (service as any).tokenToChatId.set('tok-1', 'chat-1');
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(mockAgentChat as any);
    mockAgentChat.hasEventSender.mockReturnValue(true);

    await (service as any).handlePushMessage('A', 'conv-direct', 'tok-1');
    await (service as any).handlePushMessage('B', 'conv-direct', 'tok-1');
    expect((service as any).pushStreams.get('conv-direct').text).toBe('AB');
    expect(mockAgentChat.handlePushChunk).toHaveBeenCalledWith('B', expect.stringMatching(/^msg_push_/));

    await (service as any).handlePushEnd('conv-direct', 'tok-1');
    expect(mockAgentChat.addMessageToSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([expect.objectContaining({ text: 'AB' })]),
      }),
    );

    mockAgentChat.addMessageToSession.mockClear();
    await (service as any).handlePushEnd('empty-agent-chat', 'tok-1');
    expect(mockAgentChat.handlePushComplete).toHaveBeenCalledWith(true);
    expect(mockAgentChat.addMessageToSession).not.toHaveBeenCalled();

    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(null);
    vi.mocked(chatSessionStore.setReadStatus).mockClear();
    await (service as any).handlePushEnd('empty-offline', 'tok-1');
    expect(chatSessionStore.setReadStatus).not.toHaveBeenCalled();

    (service as any).alias = null;
    await (service as any).handlePushMessage('ignored', 'conv-direct', 'tok-1');
    await (service as any).handlePushEnd('conv-direct', 'tok-1');
  });
});

describe('ExternalAgentService broadcastStatus', () => {
  let service: ExternalAgentService;
  const handlers = __handlers as Record<string, Function>;

  beforeEach(() => {
    (ExternalAgentService as any).instance = null;
    service = ExternalAgentService.getInstance();
    vi.mocked(agentChatManager.getInstanceByChatSessionId).mockReturnValue(null);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('sends statusChanged to all non-destroyed windows on connect/disconnect', async () => {
    const { BrowserWindow } = await import('electron');
    const mockWebContents = { send: vi.fn() };
    const mockWin = { isDestroyed: vi.fn(() => false), webContents: mockWebContents };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as any]);

    const { mainToRender } = await import('@shared/ipc/externalAgent');
    const mockStatusChanged = vi.fn();
    vi.mocked(mainToRender.bindWebContents).mockReturnValue({ statusChanged: mockStatusChanged } as any);

    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'chat-1', agent: { source: 'EXTERNAL', authToken: 'tok-1' } }],
    });
    await service.start('test-alias', 9527);

    // Trigger connected handler
    const validator = (service as any).wsServer.setTokenValidator.mock.calls[0][0];
    validator('tok-1');
    handlers.connected();

    expect(mainToRender.bindWebContents).toHaveBeenCalledWith(mockWebContents);
    expect(mockStatusChanged).toHaveBeenCalledWith({ connected: true });

    // Trigger disconnected handler
    handlers.disconnected();
    expect(mockStatusChanged).toHaveBeenCalledWith({ connected: false });
  });

  it('skips destroyed windows in broadcastStatus', async () => {
    const { BrowserWindow } = await import('electron');
    const mockWin = { isDestroyed: vi.fn(() => true), webContents: {} };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as any]);

    const { mainToRender } = await import('@shared/ipc/externalAgent');
    vi.mocked(mainToRender.bindWebContents).mockClear();

    await service.start('test-alias', 9527);
    handlers.connected();

    expect(mainToRender.bindWebContents).not.toHaveBeenCalled();
  });
});
