vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentChatPushReceiver, PushReceiverHost } from '../agentChatPushReceiver';

function createHost(overrides: Partial<PushReceiverHost> = {}): PushReceiverHost {
  return {
    chatId: 'chat-1',
    getChatSessionId: () => 'session-1',
    setChatStatus: vi.fn(),
    getChatStatus: () => 'idle',
    emitStreamingChunk: vi.fn(),
    addMessageToSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AgentChatPushReceiver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handlePushChunk', () => {
    it('sets status to sending_response on first chunk', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('hello');

      expect(host.setChatStatus).toHaveBeenCalledWith('sending_response');
    });

    it('emits streaming content chunk', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('hello');

      const chunk = (host.emitStreamingChunk as any).mock.calls[0][0];
      expect(chunk.type).toBe('content');
      expect(chunk.contentDelta.text).toBe('hello');
      expect(chunk.chatId).toBe('chat-1');
      expect(chunk.chatSessionId).toBe('session-1');
    });

    it('does not set status again on subsequent chunks', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('a');
      receiver.handlePushChunk('b');

      expect(host.setChatStatus).toHaveBeenCalledTimes(1);
    });

    it('uses same messageId across chunks', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('a');
      receiver.handlePushChunk('b');

      const chunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      expect(chunks[0].messageId).toBe(chunks[1].messageId);
    });
  });

  describe('handlePushComplete', () => {
    it('persists accumulated text and emits complete chunk', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('hello ');
      receiver.handlePushChunk('world');
      await receiver.handlePushComplete();

      // Persisted message
      const savedMsg = (host.addMessageToSession as any).mock.calls[0][0];
      expect(savedMsg.role).toBe('assistant');
      expect(savedMsg.content[0].text).toBe('hello world');

      // Complete chunk emitted
      const chunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      const completeChunk = chunks.find((c: any) => c.type === 'complete');
      expect(completeChunk).toBeDefined();
      expect(completeChunk.complete.hasToolCalls).toBe(false);

      // Status set to idle
      expect(host.setChatStatus).toHaveBeenLastCalledWith('idle');
    });

    it('sets idle when called with no push in progress and status is sending_response', async () => {
      const host = createHost({ getChatStatus: () => 'sending_response' });
      const receiver = new AgentChatPushReceiver(host);

      await receiver.handlePushComplete();

      expect(host.setChatStatus).toHaveBeenCalledWith('idle');
      expect(host.addMessageToSession).not.toHaveBeenCalled();
    });

    it('does not change status when no push in progress and already idle', async () => {
      const host = createHost({ getChatStatus: () => 'idle' });
      const receiver = new AgentChatPushReceiver(host);

      await receiver.handlePushComplete();

      expect(host.setChatStatus).not.toHaveBeenCalled();
    });

    it('persists even when accumulated text is empty', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('');
      await receiver.handlePushComplete();

      // Should still persist and complete (pushMsgId was set)
      expect(host.addMessageToSession).toHaveBeenCalled();
      const chunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      expect(chunks.some((c: any) => c.type === 'complete')).toBe(true);
    });

    it('resets state so next push creates new messageId', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('first');
      await receiver.handlePushComplete();

      const firstMsgId = (host.emitStreamingChunk as any).mock.calls[0][0].messageId;

      receiver.handlePushChunk('second');
      await receiver.handlePushComplete();

      const allChunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      const secondContentChunk = allChunks.find((c: any) => c.type === 'content' && c.contentDelta.text === 'second');
      expect(secondContentChunk!.messageId).not.toBe(firstMsgId);
    });
  });

  describe('cancelPush', () => {
    it('clears push state and sets idle when push was in progress', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('partial');
      (host.setChatStatus as any).mockClear();

      receiver.cancelPush();

      expect(host.setChatStatus).toHaveBeenCalledWith('idle');
    });

    it('does not set idle when no push was in progress', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.cancelPush();

      expect(host.setChatStatus).not.toHaveBeenCalled();
    });

    it('does not persist accumulated text', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('will be discarded');
      receiver.cancelPush();

      expect(host.addMessageToSession).not.toHaveBeenCalled();
    });

    it('clears timeout so auto-complete does not fire', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('data');
      receiver.cancelPush();
      (host.setChatStatus as any).mockClear();

      // Advance past timeout — nothing should happen
      vi.advanceTimersByTime(130_000);

      expect(host.addMessageToSession).not.toHaveBeenCalled();
      expect(host.setChatStatus).not.toHaveBeenCalled();
    });
  });

  describe('timeout', () => {
    it('auto-completes after PUSH_TIMEOUT_MS with no new chunks', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('timeout test');

      // Advance to just before timeout — should not complete
      vi.advanceTimersByTime(119_999);
      expect(host.addMessageToSession).not.toHaveBeenCalled();

      // Advance past timeout
      vi.advanceTimersByTime(1);

      // Allow async handlePushComplete to resolve
      await Promise.resolve();

      expect(host.addMessageToSession).toHaveBeenCalled();
      const savedMsg = (host.addMessageToSession as any).mock.calls[0][0];
      expect(savedMsg.content[0].text).toBe('timeout test');
    });

    it('resets timeout on each chunk', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('a');
      vi.advanceTimersByTime(100_000); // 100s — within 120s timeout
      receiver.handlePushChunk('b');
      vi.advanceTimersByTime(100_000); // another 100s from last chunk — still within new 120s

      expect(host.addMessageToSession).not.toHaveBeenCalled();

      vi.advanceTimersByTime(20_001); // now exceeds 120s from last chunk
      await Promise.resolve();

      expect(host.addMessageToSession).toHaveBeenCalled();
      const savedMsg = (host.addMessageToSession as any).mock.calls[0][0];
      expect(savedMsg.content[0].text).toBe('ab');
    });
  });

  describe('destroy', () => {
    it('clears timeout and state without persisting', () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('data');
      receiver.destroy();

      vi.advanceTimersByTime(130_000);
      expect(host.addMessageToSession).not.toHaveBeenCalled();
    });
  });

  describe('handlePushComplete with skipPersistence', () => {
    it('skips persistence when skipPersistence=true but still emits complete chunk', async () => {
      const host = createHost();
      const receiver = new AgentChatPushReceiver(host);

      receiver.handlePushChunk('data');
      await receiver.handlePushComplete(true);

      expect(host.addMessageToSession).not.toHaveBeenCalled();
      const chunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      const completeChunk = chunks.find((c: any) => c.type === 'complete');
      expect(completeChunk).toBeDefined();
      expect(host.setChatStatus).toHaveBeenLastCalledWith('idle');
    });
  });

  describe('timeout with no prior chunk', () => {
    it('emits a timeout system message and sets idle when push was never started', async () => {
      const host = createHost({ getChatStatus: () => 'sending_response' });
      const receiver = new AgentChatPushReceiver(host);

      // Manually start timeout without having sent a chunk (simulates external trigger)
      receiver.startOrResetPushTimeout();

      vi.advanceTimersByTime(120_001);
      await Promise.resolve();

      // System message should be added
      const savedMsg = (host.addMessageToSession as any).mock.calls[0]?.[0];
      expect(savedMsg).toBeDefined();
      expect(savedMsg.role).toBe('system');
      expect(savedMsg.content[0].text).toContain('did not respond');

      // Two streaming chunks emitted (content + complete)
      const chunks = (host.emitStreamingChunk as any).mock.calls.map((c: any) => c[0]);
      expect(chunks.some((c: any) => c.type === 'content')).toBe(true);
      expect(chunks.some((c: any) => c.type === 'complete')).toBe(true);

      expect(host.setChatStatus).toHaveBeenCalledWith('idle');
    });
  });
});
