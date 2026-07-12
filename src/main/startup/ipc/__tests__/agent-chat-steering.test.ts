/**
 * agent-chat-steering.ts IPC handler tests
 *
 * The idle pump and manual steer both delegate consumption to the manager-level
 * `drainQueuedSteeringWhileIdle`, which runs the cancel-safe peek -> hook ->
 * commit-by-id protocol with the session's cancellation source wired. These tests
 * assert the IPC layer routes to that drain, promotes before draining, and applies
 * update-only-if-present so an edit that raced a consumption never re-adds a
 * duplicate.
 */

const { mockHandle, mockInstance, mockAgentChatManager } = vi.hoisted(() => {
  const mockInstance = {
    canUseQueuedSteering: vi.fn().mockReturnValue(true),
    getChatStatus: vi.fn().mockReturnValue('idle'),
    setEventSender: vi.fn(),
    steeringQueue: {
      enqueue: vi.fn(),
      update: vi.fn().mockReturnValue(true),
      remove: vi.fn(),
      promote: vi.fn().mockReturnValue({ id: 'q1' }),
      hasPending: vi.fn().mockReturnValue(false),
      editingMessageId: vi.fn().mockReturnValue(null),
      setEditing: vi.fn(),
      clear: vi.fn(),
    },
  };

  const mockAgentChatManager = {
    getInstanceByChatSessionId: vi.fn().mockReturnValue(mockInstance),
    drainQueuedSteeringWhileIdle: vi.fn().mockResolvedValue({ success: true, data: [] }),
  };

  return { mockHandle: vi.fn(), mockInstance, mockAgentChatManager };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
}));

vi.mock('../../../lib/chat/agentChatManager', () => ({
  agentChatManager: mockAgentChatManager,
}));

vi.mock('../../../lib/unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import registerAgentChatSteeringIpc from '../agent-chat-steering';

type HandlerFn = (event: any, ...args: any[]) => Promise<any>;

function registerAndCollect(): Map<string, HandlerFn> {
  const handlers = new Map<string, HandlerFn>();
  mockHandle.mockImplementation((channel: string, fn: HandlerFn) => {
    handlers.set(channel, fn);
  });
  registerAgentChatSteeringIpc({} as any);
  return handlers;
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));
const fakeEvent = { sender: { isDestroyed: () => false, send: vi.fn() } } as any;
const msg = { id: 'q1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'queued' }] } as any;
const imageMsg = {
  id: 'q2',
  role: 'user',
  timestamp: 2,
  content: [{
    type: 'image',
    image_url: { url: 'data:image/png;base64,abc' },
    metadata: { fileName: 'image.png', fileSize: 3, mimeType: 'image/png' },
  }],
} as any;

describe('agent-chat-steering IPC handlers', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(mockInstance);
    mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValue({ success: true, data: [] });
    mockInstance.canUseQueuedSteering.mockReturnValue(true);
    mockInstance.getChatStatus.mockReturnValue('idle');
    mockInstance.steeringQueue.update.mockReturnValue(true);
    mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
    mockInstance.steeringQueue.hasPending.mockReturnValue(false);
    mockInstance.steeringQueue.editingMessageId.mockReturnValue(null);
    handlers = registerAndCollect();
  });

  describe('agentChat:enqueueQueuedSteeringMessage', () => {
    it('enqueues via the steering queue facade', async () => {
      // Busy so the enqueue does not also fire the idle drain.
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.enqueue).toHaveBeenCalledWith(msg);
    });

    it('rejects invalid session ids before looking up an instance', async () => {
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, '', msg);
      expect(result).toEqual({ success: false, error: 'Invalid chatSessionId' });
      expect(mockAgentChatManager.getInstanceByChatSessionId).not.toHaveBeenCalled();
    });

    it('rejects malformed queued user messages before mutating the queue', async () => {
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(
        fakeEvent,
        'session1',
        { id: 'q1', role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'nope' }] },
      );
      expect(result).toEqual({ success: false, error: 'Invalid queued user message role' });
      expect(mockInstance.steeringQueue.enqueue).not.toHaveBeenCalled();
    });

    it('accepts valid attachment content when enqueueing', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', imageMsg);
      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.enqueue).toHaveBeenCalledWith(imageMsg);
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'missing', msg);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('rejects external-agent sessions before enqueueing', async () => {
      mockInstance.canUseQueuedSteering.mockReturnValue(false);

      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);

      expect(result).toEqual({
        success: false,
        error: 'Queued steering is not supported for external agent sessions',
      });
      expect(mockInstance.steeringQueue.enqueue).not.toHaveBeenCalled();
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.steeringQueue.enqueue.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns the error message when an Error is thrown', async () => {
      mockInstance.steeringQueue.enqueue.mockImplementationOnce(() => { throw new Error('enqueue boom'); });
      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: false, error: 'enqueue boom' });
    });
  });

  describe('agentChat:updateQueuedSteeringMessage', () => {
    it('updates via the update-only-if-present facade (not enqueue)', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.update).toHaveBeenCalledWith(msg);
      expect(mockInstance.steeringQueue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects messages with invalid content parts before updating', async () => {
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(
        fakeEvent,
        'session1',
        { id: 'q1', role: 'user', timestamp: 1, content: [{ type: 'text' }] },
      );
      expect(result).toEqual({ success: false, error: 'Invalid queued user message content' });
      await expect(handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', { ...msg, content: [null] }))
        .resolves.toEqual({ success: false, error: 'Invalid queued user message content' });
      await expect(handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', { ...msg, content: [{ type: 'thinking', text: 'nope' }] }))
        .resolves.toEqual({ success: false, error: 'Invalid queued user message content' });
      expect(mockInstance.steeringQueue.update).not.toHaveBeenCalled();
    });

    it('rejects messages with missing attachment metadata before updating', async () => {
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(
        fakeEvent,
        'session1',
        { id: 'q1', role: 'user', timestamp: 1, content: [{ type: 'image', image_url: { url: 'x' }, metadata: { fileName: 'x', fileSize: 'bad', mimeType: 'image/png' } }] },
      );
      expect(result).toEqual({ success: false, error: 'Invalid queued user message content' });
      expect(mockInstance.steeringQueue.update).not.toHaveBeenCalled();
    });

    it('rejects non-record queued messages before updating', async () => {
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', null);
      expect(result).toEqual({ success: false, error: 'Invalid queued user message' });
      expect(mockInstance.steeringQueue.update).not.toHaveBeenCalled();
    });

    it('rejects queued messages with invalid id, timestamp, or empty content', async () => {
      await expect(handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', { ...msg, id: '' }))
        .resolves.toEqual({ success: false, error: 'Invalid queued user message id' });
      await expect(handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', { ...msg, timestamp: Number.NaN }))
        .resolves.toEqual({ success: false, error: 'Invalid queued user message timestamp' });
      await expect(handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', { ...msg, content: [] }))
        .resolves.toEqual({ success: false, error: 'Invalid queued user message content' });
    });

    it('is a silent success no-op when the message was already consumed (update returns false)', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.update.mockReturnValue(false);

      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();

      expect(result).toEqual({ success: true });
      // No drain: the prompt is gone, so there is nothing to consume and no
      // duplicate is resurrected.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'missing', msg);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('rejects external-agent sessions before updating', async () => {
      mockInstance.canUseQueuedSteering.mockReturnValue(false);

      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);

      expect(result).toEqual({
        success: false,
        error: 'Queued steering is not supported for external agent sessions',
      });
      expect(mockInstance.steeringQueue.update).not.toHaveBeenCalled();
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.steeringQueue.update.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns the error message when an Error is thrown', async () => {
      mockInstance.steeringQueue.update.mockImplementationOnce(() => { throw new Error('update boom'); });
      const result = await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: false, error: 'update boom' });
    });
  });

  describe('agentChat:removeQueuedSteeringMessage', () => {
    it('removes via the steering queue facade', async () => {
      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.remove).toHaveBeenCalledWith('q1');
    });

    it('rejects invalid message ids before removing', async () => {
      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', '');
      expect(result).toEqual({ success: false, error: 'Invalid messageId' });
      expect(mockInstance.steeringQueue.remove).not.toHaveBeenCalled();
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'missing', 'q1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.steeringQueue.remove.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns the error message when an Error is thrown', async () => {
      mockInstance.steeringQueue.remove.mockImplementationOnce(() => { throw new Error('remove boom'); });
      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      expect(result).toEqual({ success: false, error: 'remove boom' });
    });

    it('re-pumps when deleting the editing-held draft while idle so messages behind it resume', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // The deleted draft was the one being edited (a held head the drain waited
      // behind); its removal must let the queued-behind messages flow.
      mockInstance.steeringQueue.editingMessageId.mockReturnValue('q1');
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValue({ success: true, data: [msg] });

      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.remove).toHaveBeenCalledWith('q1');
      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('does NOT re-pump when deleting an ordinary (non-held) draft while idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // No draft is being edited, so an ordinary delete must not auto-send the rest
      // of the queue (e.g. trimming the queue after a cancel or during the
      // start-with-queue dialog).
      mockInstance.steeringQueue.editingMessageId.mockReturnValue(null);

      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q2');
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });

    it('does NOT re-pump when deleting the editing-held draft while a turn is running', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      mockInstance.steeringQueue.editingMessageId.mockReturnValue('q1');

      const result = await handlers.get('agentChat:removeQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(result).toEqual({ success: true });
      // The running turn's own end-of-turn drain will consume the rest of the queue.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });
  });

  describe('agentChat:setQueuedSteeringMessageEditing', () => {
    it('holds the draft (editing=true) without pumping, even when idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');

      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', true);
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.setEditing).toHaveBeenCalledWith('q1', true);
      // Holding must STOP consumption: no drain, no bound sender.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });

    it('releases the hold (editing=false) and re-pumps when the session is idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');

      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', false);
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.setEditing).toHaveBeenCalledWith('q1', false);
      // Releasing on idle exposes a head the drain skipped while held, so pump it.
      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('releases the hold without pumping when the session is not idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');

      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', false);
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.setEditing).toHaveBeenCalledWith('q1', false);
      // A running turn's own end-of-turn drain will pick up the released draft.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });

    it('rejects non-boolean editing flags before mutating editing state', async () => {
      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', 'true');
      expect(result).toEqual({ success: false, error: 'Invalid editing flag' });
      expect(mockInstance.steeringQueue.setEditing).not.toHaveBeenCalled();
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'missing', 'q1', true);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.steeringQueue.setEditing.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', true);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns the error message when an Error is thrown', async () => {
      mockInstance.steeringQueue.setEditing.mockImplementationOnce(() => { throw new Error('editing boom'); });
      const result = await handlers.get('agentChat:setQueuedSteeringMessageEditing')!(fakeEvent, 'session1', 'q1', false);
      expect(result).toEqual({ success: false, error: 'editing boom' });
    });
  });

  describe('agentChat:steerQueuedSteeringMessage', () => {
    it('promotes and stops (no drain) when the session is not idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');

      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.promote).toHaveBeenCalledWith('q1');
      // The running turn's end-of-turn drain consumes the promoted head later.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('rejects invalid message ids before promoting', async () => {
      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', null);
      expect(result).toEqual({ success: false, error: 'Invalid messageId' });
      expect(mockInstance.steeringQueue.promote).not.toHaveBeenCalled();
    });

    it('returns error when a non-idle promote finds nothing', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      mockInstance.steeringQueue.promote.mockReturnValue(null);

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'missing');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No queued steering message found/);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('promotes then schedules the cancel-safe drain when the session is idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: true, data: [{ id: 'm1' } as any] });

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);
      expect(mockInstance.steeringQueue.promote).toHaveBeenCalledWith('q1');
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
      expect(result).toEqual({ success: true });
    });

    it('returns before the scheduled idle drain completes', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      let resolveDrain!: (value: { success: true; data: any[] }) => void;
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockReturnValueOnce(new Promise((resolve) => {
        resolveDrain = resolve;
      }));

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');

      expect(result).toEqual({ success: true });
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);

      resolveDrain({ success: true, data: [] });
      await flushAsync();
    });

    it('returns error when an idle promote finds nothing', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue(null);

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'missing');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No queued steering message found/);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('leaves scheduled drain failures to the idle pump', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: false, error: 'drain boom' });

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('leaves scheduled drain cancellation to the idle pump', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: true, cancelled: true, data: [] });

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'missing', 'q1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('rejects external-agent sessions before promoting', async () => {
      mockInstance.canUseQueuedSteering.mockReturnValue(false);

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');

      expect(result).toEqual({
        success: false,
        error: 'Queued steering is not supported for external agent sessions',
      });
      expect(mockInstance.steeringQueue.promote).not.toHaveBeenCalled();
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns success when the scheduled idle drain throws', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockRejectedValueOnce(new Error('drain throw'));

      const result = await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(result).toEqual({ success: true });
    });

    it('binds then releases the event sender across a scheduled idle drain', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: true, data: [] });

      await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');
      await flushAsync();

      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('does not touch the event sender when the session stays busy after a promote', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');
      mockInstance.steeringQueue.promote.mockReturnValue({ id: 'q1' });

      await handlers.get('agentChat:steerQueuedSteeringMessage')!(fakeEvent, 'session1', 'q1');

      // While a turn is streaming it owns the event sender; a steer must not
      // overwrite it (a different WebContents would otherwise capture the active
      // turn's stream), so the sender is left entirely untouched on the busy path.
      expect(mockInstance.setEventSender).not.toHaveBeenCalled();
    });
  });

  describe('idle queue pump (busy->idle race: enqueue/update after the turn drain)', () => {
    it('drives the cancel-safe drain for a message enqueued while the session is idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');

      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: true });

      await flushAsync();

      expect(mockInstance.steeringQueue.enqueue).toHaveBeenCalledWith(msg);
      expect(mockInstance.setEventSender).toHaveBeenCalledWith(fakeEvent.sender);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('does not pump when the session is busy', async () => {
      mockInstance.getChatStatus.mockReturnValue('sending_response');

      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      expect(result).toEqual({ success: true });

      await flushAsync();

      expect(mockInstance.steeringQueue.enqueue).toHaveBeenCalledWith(msg);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).not.toHaveBeenCalled();
    });

    it('clears the event sender after the drain completes while idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');

      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();

      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('does not start a second pump while one is already draining', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');

      let resolveDrain: (value: { success: boolean }) => void = () => {};
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockImplementationOnce(
        () => new Promise((resolve) => { resolveDrain = resolve; }),
      );

      // First enqueue starts the pump, which parks on the pending drain.
      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      // Second enqueue arrives while the pump holds the guard -> must not drain again.
      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);

      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledTimes(1);

      resolveDrain({ success: true });
      await flushAsync();
    });

    it('pumps an edited draft that lands while the session is idle', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockInstance.steeringQueue.update.mockReturnValue(true);

      await handlers.get('agentChat:updateQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();

      expect(mockInstance.steeringQueue.update).toHaveBeenCalledWith(msg);
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledWith('session1');
    });

    it('swallows a drain rejection (Error) without escaping the fire-and-forget pump', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockRejectedValueOnce(new Error('pump boom'));

      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();

      // The handler still resolves success (the pump is fire-and-forget) and the
      // finally cleanup still runs.
      expect(result).toEqual({ success: true });
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('swallows a drain rejection (non-Error) without escaping the fire-and-forget pump', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockRejectedValueOnce('string boom');

      const result = await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();

      expect(result).toEqual({ success: true });
    });

    it('re-pumps a message that raced the post-drain window after releasing the guard', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // The manager drain awaits unread persistence after flipping status back to
      // idle; a message enqueued in that window had its pump skipped by the still-
      // held guard. The first pump CONSUMED the original head (data non-empty), and
      // its post-drain re-check sees the raced message (hasPending true); the
      // re-pump then drains it and the second re-check sees an empty queue.
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValue({ success: true, data: [msg] });
      mockInstance.steeringQueue.hasPending.mockReturnValueOnce(true).mockReturnValue(false);

      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();
      await flushAsync();

      // Two drains: the initial pump plus the re-pump for the stranded message.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledTimes(2);
      // The bound sender is only released once the queue is finally empty; it is
      // NOT nulled between the two drains (the re-pump reuses the bound sender).
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('does NOT re-pump when the drain consumed nothing yet the queue still reports pending (external-agent infinite-loop guard)', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // A session routed to an external agent returns [] from the drain WITHOUT
      // ever consuming the queue, so `hasPending()` stays true indefinitely.
      // Re-pumping on hasPending alone would reschedule the same no-op drain
      // forever (a hot infinite loop) — the consumed-progress guard must stop it.
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValue({ success: true, data: [] });
      mockInstance.steeringQueue.hasPending.mockReturnValue(true);

      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();
      await flushAsync();

      // Exactly one drain: no progress means no re-pump, even though hasPending is true.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledTimes(1);
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('does NOT re-pump after a cancelled drain (never resends the prompt the user cancelled)', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // The cancel-safe drain leaves the peeked prompt queued on a user cancel, so
      // the queue still reports pending — but re-pumping it would resend the very
      // prompt the user just cancelled with a fresh token.
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: true, cancelled: true, data: [] });
      mockInstance.steeringQueue.hasPending.mockReturnValue(true);

      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();
      await flushAsync();

      // Exactly one drain: the cancel stops auto-consumption instead of resending.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledTimes(1);
      // The queue is left for manual action and the bound sender is released.
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });

    it('does NOT re-pump after a failed drain (never spins on a deterministic failure)', async () => {
      mockInstance.getChatStatus.mockReturnValue('idle');
      // A deterministic persist/hook failure restores the prompt to the front, so
      // the queue reports pending — re-pumping would retry the same failure forever.
      mockAgentChatManager.drainQueuedSteeringWhileIdle.mockResolvedValueOnce({ success: false, error: 'persist boom' });
      mockInstance.steeringQueue.hasPending.mockReturnValue(true);

      await handlers.get('agentChat:enqueueQueuedSteeringMessage')!(fakeEvent, 'session1', msg);
      await flushAsync();
      await flushAsync();

      // Exactly one drain: the failure is left for manual retry, not re-pumped.
      expect(mockAgentChatManager.drainQueuedSteeringWhileIdle).toHaveBeenCalledTimes(1);
      expect(mockInstance.setEventSender).toHaveBeenLastCalledWith(null);
    });
  });

  describe('agentChat:clearQueuedSteeringMessages', () => {
    it('clears via the steering queue facade', async () => {
      const result = await handlers.get('agentChat:clearQueuedSteeringMessages')!(fakeEvent, 'session1');
      expect(result).toEqual({ success: true });
      expect(mockInstance.steeringQueue.clear).toHaveBeenCalled();
    });

    it('rejects invalid session ids before clearing', async () => {
      const result = await handlers.get('agentChat:clearQueuedSteeringMessages')!(fakeEvent, '   ');
      expect(result).toEqual({ success: false, error: 'Invalid chatSessionId' });
      expect(mockInstance.steeringQueue.clear).not.toHaveBeenCalled();
    });

    it('returns error when no instance is found', async () => {
      mockAgentChatManager.getInstanceByChatSessionId.mockReturnValue(null);
      const result = await handlers.get('agentChat:clearQueuedSteeringMessages')!(fakeEvent, 'missing');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent instance found/);
    });

    it('returns Unknown error when a non-Error is thrown', async () => {
      mockInstance.steeringQueue.clear.mockImplementationOnce(() => { throw 'boom'; });
      const result = await handlers.get('agentChat:clearQueuedSteeringMessages')!(fakeEvent, 'session1');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('returns the error message when an Error is thrown', async () => {
      mockInstance.steeringQueue.clear.mockImplementationOnce(() => { throw new Error('clear boom'); });
      const result = await handlers.get('agentChat:clearQueuedSteeringMessages')!(fakeEvent, 'session1');
      expect(result).toEqual({ success: false, error: 'clear boom' });
    });
  });
});
