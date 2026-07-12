import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MessageHelper } from '@shared/types/chatTypes';

const mockCacheManager = vi.hoisted(() => ({
  getUserMessageSendState: vi.fn(),
  waitForSendReady: vi.fn(),
  setErrorMessage: vi.fn(),
}));

const mockAgentChatIpc = vi.hoisted(() => ({
  cancelChat: vi.fn(),
  streamMessage: vi.fn(),
  enqueueQueuedSteeringMessage: vi.fn(),
  updateQueuedSteeringMessage: vi.fn(),
  removeQueuedSteeringMessage: vi.fn(),
  setQueuedSteeringMessageEditing: vi.fn(),
  steerQueuedSteeringMessage: vi.fn(),
  clearQueuedSteeringMessages: vi.fn(),
}));

vi.mock('@renderer/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: mockCacheManager,
}));

vi.mock('@renderer/lib/chat/agentChatIpc', () => ({
  agentChatIpc: mockAgentChatIpc,
}));

import { queuedMessageAtom } from '../queued-message.atom';

function buildStore() {
  const map: Record<string, any> = {};
  function query(atom: any): any {
    const key: string = atom.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atom));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find BUILD symbol on atom');
    map[key] = (atom as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

function textMessage(text: string) {
  return MessageHelper.createTextMessage(text, 'user');
}

describe('queuedMessageAtom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheManager.getUserMessageSendState.mockReturnValue({ canSend: true });
    mockCacheManager.waitForSendReady.mockResolvedValue(true);
    mockAgentChatIpc.cancelChat.mockResolvedValue(undefined);
    mockAgentChatIpc.streamMessage.mockResolvedValue(undefined);
    mockAgentChatIpc.enqueueQueuedSteeringMessage.mockResolvedValue(undefined);
    mockAgentChatIpc.updateQueuedSteeringMessage.mockResolvedValue(undefined);
    mockAgentChatIpc.removeQueuedSteeringMessage.mockResolvedValue(undefined);
    mockAgentChatIpc.setQueuedSteeringMessageEditing.mockResolvedValue(undefined);
    mockAgentChatIpc.steerQueuedSteeringMessage.mockResolvedValue([]);
    mockAgentChatIpc.clearQueuedSteeringMessages.mockResolvedValue(undefined);
  });

  it('queues and cancels drafts per chat session', () => {
    const state = buildStore()(queuedMessageAtom);

    state.actions.queue('chat-1', 'session-1', textMessage('first'));
    state.actions.queue('chat-2', 'session-2', textMessage('second'));

    const firstSessionItems = state.get()['session-1']?.items ?? [];
    expect(firstSessionItems).toHaveLength(1);
    expect(MessageHelper.getText(firstSessionItems[0].message)).toBe('first');
    expect(state.get()['session-2']?.items).toHaveLength(1);

    state.actions.cancel('session-1', firstSessionItems[0].id);

    expect(state.get()['session-1']).toBeUndefined();
    expect(state.get()['session-2']?.items).toHaveLength(1);
  });

  it('edits a draft in place and keeps its queue position', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('first'));
    state.actions.queue('chat-1', 'session-1', textMessage('second'));
    const [first, second] = state.get()['session-1'].items;

    state.actions.startEdit('session-1', first.id);
    await state.actions.submitEdit('session-1', first.id, textMessage('updated first'));

    const items = state.get()['session-1'].items;
    expect(items.map((item: any) => item.id)).toEqual([first.id, second.id]);
    expect(MessageHelper.getText(items[0].message)).toBe('updated first');
    expect(items[0].status).toBe('queued');
    // startEdit holds the draft in main; submit releases the hold via update.
    expect(mockAgentChatIpc.setQueuedSteeringMessageEditing).toHaveBeenCalledWith('session-1', first.id, true);
  });

  it('holds the draft in main on startEdit and releases it on cancelEdit', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    const draft = state.get()['session-1'].items[0];

    state.actions.startEdit('session-1', draft.id);
    expect(mockAgentChatIpc.setQueuedSteeringMessageEditing).toHaveBeenCalledWith('session-1', draft.id, true);

    state.actions.cancelEdit('session-1', draft.id);
    expect(mockAgentChatIpc.setQueuedSteeringMessageEditing).toHaveBeenCalledWith('session-1', draft.id, false);
  });

  it('surfaces an error when the main-side edit hold cannot be set', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    const draft = state.get()['session-1'].items[0];
    mockAgentChatIpc.setQueuedSteeringMessageEditing.mockRejectedValueOnce(new Error('hold failed'));

    state.actions.startEdit('session-1', draft.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'hold failed');
  });

  it('defers steering while editing until the edit is submitted', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('before edit'));
    state.actions.queue('chat-1', 'session-1', textMessage('other draft'));
    const draft = state.get()['session-1'].items[0];

    state.actions.startEdit('session-1', draft.id);
    await state.actions.steerNow('session-1', draft.id);

    expect(state.get()['session-1'].items[0].pendingSteer).toBe(true);
    // The other draft is not marked pendingSteer.
    expect(state.get()['session-1'].items[1].pendingSteer).toBeFalsy();
    expect(mockAgentChatIpc.steerQueuedSteeringMessage).not.toHaveBeenCalled();

    await state.actions.submitEdit('session-1', draft.id, textMessage('after edit'));

    expect(mockAgentChatIpc.updateQueuedSteeringMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        id: draft.id,
        content: expect.arrayContaining([expect.objectContaining({ text: 'after edit' })]),
      }),
    );
    expect(mockAgentChatIpc.steerQueuedSteeringMessage).toHaveBeenCalledWith('session-1', draft.id);
    expect(state.get()['session-1'].items[0].id).toBe(draft.id);
  });

  it('promotes a pendingSteer edit before sending its content update', async () => {
    const state = buildStore()(queuedMessageAtom);
    // Head draft "ahead" is left un-drained (e.g. after a cancelled turn); the
    // edited+steered draft sits behind it. The steer must promote the edited draft
    // to the head BEFORE the content update pumps the queue, otherwise the update's
    // idle re-pump would start "ahead" running first and violate the steer intent.
    state.actions.queue('chat-1', 'session-1', textMessage('ahead'));
    state.actions.queue('chat-1', 'session-1', textMessage('to steer'));
    const steered = state.get()['session-1'].items[1];

    state.actions.startEdit('session-1', steered.id);
    await state.actions.steerNow('session-1', steered.id);
    expect(state.get()['session-1'].items[1].pendingSteer).toBe(true);

    await state.actions.submitEdit('session-1', steered.id, textMessage('to steer edited'));

    const steerOrder = mockAgentChatIpc.steerQueuedSteeringMessage.mock.invocationCallOrder[0];
    const updateOrder = mockAgentChatIpc.updateQueuedSteeringMessage.mock.invocationCallOrder[0];
    expect(steerOrder).toBeLessThan(updateOrder);
  });

  it('does not steer when submitting a plain (non-pendingSteer) edit', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('draft'));
    const draft = state.get()['session-1'].items[0];

    state.actions.startEdit('session-1', draft.id);
    await state.actions.submitEdit('session-1', draft.id, textMessage('edited'));

    expect(mockAgentChatIpc.steerQueuedSteeringMessage).not.toHaveBeenCalled();
    expect(mockAgentChatIpc.updateQueuedSteeringMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ id: draft.id }),
    );
  });

  it('ignores steerNow for a draft id that is not in the session queue', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('present'));

    await state.actions.steerNow('session-1', 'missing-draft-id');

    expect(mockAgentChatIpc.steerQueuedSteeringMessage).not.toHaveBeenCalled();
    expect(state.get()['session-1'].items).toHaveLength(1);
  });

  it('asks main to steer a queued draft without cancelling or sending from renderer', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockCacheManager.getUserMessageSendState.mockReturnValue({ canSend: false });
    state.actions.queue('chat-1', 'session-1', textMessage('steer'));
    const draft = state.get()['session-1'].items[0];

    await state.actions.steerNow('session-1', draft.id);

    expect(mockAgentChatIpc.steerQueuedSteeringMessage).toHaveBeenCalledWith('session-1', draft.id);
    expect(mockAgentChatIpc.cancelChat).not.toHaveBeenCalled();
    expect(mockCacheManager.waitForSendReady).not.toHaveBeenCalled();
    expect(state.get()['session-1'].items[0].id).toBe(draft.id);
  });

  it('keeps a draft in the queue until main reports it was consumed', async () => {
    const state = buildStore()(queuedMessageAtom);
    let finishSteer!: () => void;
    mockAgentChatIpc.steerQueuedSteeringMessage.mockReturnValue(new Promise<any[]>((resolve) => {
      finishSteer = () => resolve([]);
    }));
    state.actions.queue('chat-1', 'session-1', textMessage('steer'));
    const draft = state.get()['session-1'].items[0];

    const steerPromise = state.actions.steerNow('session-1', draft.id);

    expect(state.get()['session-1'].items[0].id).toBe(draft.id);
    await state.actions.steerNow('session-1', draft.id);
    expect(mockAgentChatIpc.steerQueuedSteeringMessage).toHaveBeenCalledTimes(1);

    finishSteer();
    await steerPromise;
    expect(state.get()['session-1'].items[0].id).toBe(draft.id);
  });

  it('keeps a draft in the queue when main rejects steering', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.steerQueuedSteeringMessage.mockRejectedValue(new Error('steer failed'));
    state.actions.queue('chat-1', 'session-1', textMessage('steer'));
    const draft = state.get()['session-1'].items[0];

    await state.actions.steerNow('session-1', draft.id);

    expect(state.get()['session-1'].items[0].id).toBe(draft.id);
    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'steer failed');
  });

  it('stringifies a non-Error steer rejection for the session error', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.steerQueuedSteeringMessage.mockRejectedValue('boom-string');
    state.actions.queue('chat-1', 'session-1', textMessage('steer'));
    const draft = state.get()['session-1'].items[0];

    await state.actions.steerNow('session-1', draft.id);

    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'boom-string');
  });

  it('getForSession returns items for a session and [] for null', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('first'));

    expect(state.actions.getForSession('session-1')).toHaveLength(1);
    expect(state.actions.getForSession(null)).toEqual([]);
    expect(state.actions.getForSession('unknown-session')).toEqual([]);
  });

  it('queue is a no-op when chatId or chatSessionId is missing', () => {
    const state = buildStore()(queuedMessageAtom);

    state.actions.queue(null, 'session-1', textMessage('x'));
    state.actions.queue('chat-1', null, textMessage('x'));

    expect(state.get()['session-1']).toBeUndefined();
    expect(mockAgentChatIpc.enqueueQueuedSteeringMessage).not.toHaveBeenCalled();
  });

  it('cancel is a no-op when chatSessionId is missing', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.cancel(null, 'draft-1');
    expect(mockAgentChatIpc.removeQueuedSteeringMessage).not.toHaveBeenCalled();
  });

  it('clearSession removes all drafts and notifies main', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    state.actions.queue('chat-1', 'session-1', textMessage('b'));

    state.actions.clearSession('session-1');

    expect(state.get()['session-1']).toBeUndefined();
    expect(mockAgentChatIpc.clearQueuedSteeringMessages).toHaveBeenCalledWith('session-1');
  });

  it('clearSession is a no-op when chatSessionId is missing', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.clearSession(null);
    expect(mockAgentChatIpc.clearQueuedSteeringMessages).not.toHaveBeenCalled();
  });

  it('cancelEdit reverts an editing draft back to queued', () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    state.actions.queue('chat-1', 'session-1', textMessage('b'));
    const draft = state.get()['session-1'].items[0];

    state.actions.startEdit('session-1', draft.id);
    expect(state.get()['session-1'].items[0].status).toBe('editing');

    state.actions.cancelEdit('session-1', draft.id);
    expect(state.get()['session-1'].items[0].status).toBe('queued');
    expect(state.get()['session-1'].items[0].pendingSteer).toBe(false);
    // The other draft is left untouched by cancelEdit.
    expect(state.get()['session-1'].items[1].status).toBe('queued');
    // cancelEdit releases the main-side hold so the drain can consume it again.
    expect(mockAgentChatIpc.setQueuedSteeringMessageEditing).toHaveBeenCalledWith('session-1', draft.id, false);
  });

  it('submitEdit is a no-op when the draft no longer exists', async () => {
    const state = buildStore()(queuedMessageAtom);
    await state.actions.submitEdit('session-1', 'missing-draft', textMessage('x'));
    expect(mockAgentChatIpc.updateQueuedSteeringMessage).not.toHaveBeenCalled();
  });

  it('reports enqueue failures to the session cache manager', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.enqueueQueuedSteeringMessage.mockRejectedValue(new Error('enqueue failed'));

    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'enqueue failed');
  });

  it('rolls back the ghost draft when enqueue fails', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.enqueueQueuedSteeringMessage.mockRejectedValue(new Error('enqueue failed'));

    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    // Optimistically present before the IPC settles.
    expect(state.get()['session-1'].items).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Enqueue rejected -> the ghost draft main never accepted is removed.
    expect(state.get()['session-1']).toBeUndefined();
  });

  it('re-inserts a cancelled draft at its original position when remove fails', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.removeQueuedSteeringMessage.mockRejectedValue(new Error('remove failed'));
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    state.actions.queue('chat-1', 'session-1', textMessage('b'));
    const [first, second] = state.get()['session-1'].items;

    state.actions.cancel('session-1', first.id);
    // Optimistically removed before the IPC settles.
    expect(state.get()['session-1'].items.map((i: any) => i.id)).toEqual([second.id]);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Remove rejected -> the still-queued prompt is re-inserted at its old index.
    expect(state.get()['session-1'].items.map((i: any) => i.id)).toEqual([first.id, second.id]);
    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'remove failed');
  });

  it('cancels an unknown draft id without attempting a rollback', async () => {
    const state = buildStore()(queuedMessageAtom);
    state.actions.queue('chat-1', 'session-1', textMessage('a'));

    // draftId not present -> no draft is captured, so no rollback is scheduled.
    state.actions.cancel('session-1', 'missing-draft');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAgentChatIpc.removeQueuedSteeringMessage).toHaveBeenCalledWith('session-1', 'missing-draft');
    expect(state.get()['session-1'].items).toHaveLength(1);
  });

  it('restores the session snapshot when clear fails', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.clearQueuedSteeringMessages.mockRejectedValue(new Error('clear failed'));
    state.actions.queue('chat-1', 'session-1', textMessage('a'));
    state.actions.queue('chat-1', 'session-1', textMessage('b'));
    const before = state.get()['session-1'].items.map((i: any) => i.id);

    state.actions.clearSession('session-1');
    expect(state.get()['session-1']).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear rejected -> the still-queued prompts are restored.
    expect(state.get()['session-1'].items.map((i: any) => i.id)).toEqual(before);
    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'clear failed');
  });

  it('clears an already-empty session without scheduling a rollback', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.clearQueuedSteeringMessages.mockRejectedValue(new Error('clear failed'));

    // No drafts queued -> the snapshot is empty, so no rollback is scheduled even
    // though the IPC rejects (nothing to restore).
    state.actions.clearSession('session-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAgentChatIpc.clearQueuedSteeringMessages).toHaveBeenCalledWith('session-1');
    expect(state.get()['session-1']).toBeUndefined();
  });

  it('does not clobber newly queued drafts when a failed clear rolls back', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.clearQueuedSteeringMessages.mockRejectedValue(new Error('clear failed'));
    state.actions.queue('chat-1', 'session-1', textMessage('a'));

    state.actions.clearSession('session-1');
    // The user queues a new draft before the failed clear settles.
    state.actions.queue('chat-1', 'session-1', textMessage('new'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Rollback must NOT clobber the newly queued draft.
    const items = state.get()['session-1'].items;
    expect(items).toHaveLength(1);
    expect(MessageHelper.getText(items[0].message)).toBe('new');
  });

  it('restores prior draft content when an edit update fails', async () => {
    const state = buildStore()(queuedMessageAtom);
    mockAgentChatIpc.updateQueuedSteeringMessage.mockRejectedValue(new Error('update failed'));
    state.actions.queue('chat-1', 'session-1', textMessage('original'));
    state.actions.queue('chat-1', 'session-1', textMessage('other'));
    const draft = state.get()['session-1'].items[0];

    state.actions.startEdit('session-1', draft.id);
    await state.actions.submitEdit('session-1', draft.id, textMessage('edited'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Update rejected -> the edited draft's prior content/status is restored while
    // the other draft is left untouched, so the renderer matches main's queue.
    const items = state.get()['session-1'].items;
    expect(MessageHelper.getText(items[0].message)).toBe('original');
    expect(items[0].status).toBe('editing');
    expect(MessageHelper.getText(items[1].message)).toBe('other');
    expect(mockCacheManager.setErrorMessage).toHaveBeenCalledWith('session-1', 'update failed');
  });

  it('removes a draft when main reports it was consumed', () => {
    const onConsumed = vi.fn();
    let consumedHandler: ((data: any) => void) | undefined;
    onConsumed.mockImplementation((cb: (data: any) => void) => {
      consumedHandler = cb;
      return vi.fn();
    });
    vi.stubGlobal('window', {
      electronAPI: { agentChat: { onQueuedSteeringMessageConsumed: onConsumed } },
    });

    try {
      const state = buildStore()(queuedMessageAtom);
      state.actions.queue('chat-1', 'session-1', textMessage('a'));
      const draft = state.get()['session-1'].items[0];

      expect(consumedHandler).toBeDefined();
      consumedHandler!({ chatSessionId: 'session-1', messageId: draft.id });

      expect(state.get()['session-1']).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clears a session\'s queued drafts when main reports its cache was destroyed', () => {
    const onConsumed = vi.fn().mockReturnValue(vi.fn());
    const onDestroyed = vi.fn();
    let destroyedHandler: ((data: any) => void) | undefined;
    onDestroyed.mockImplementation((cb: (data: any) => void) => {
      destroyedHandler = cb;
      return vi.fn();
    });
    vi.stubGlobal('window', {
      electronAPI: {
        agentChat: {
          onQueuedSteeringMessageConsumed: onConsumed,
          onChatSessionCacheDestroyed: onDestroyed,
        },
      },
    });

    try {
      const state = buildStore()(queuedMessageAtom);
      state.actions.queue('chat-1', 'session-1', textMessage('a'));
      state.actions.queue('chat-2', 'session-2', textMessage('b'));

      expect(destroyedHandler).toBeDefined();

      // Destroying an unknown session leaves every queue untouched.
      destroyedHandler!({ chatSessionId: 'session-unknown' });
      expect(state.get()['session-1']?.items).toHaveLength(1);
      expect(state.get()['session-2']?.items).toHaveLength(1);

      // Destroying a tracked session drops only that session's drafts (main
      // already lost them, so keeping them would strand ghost prompts).
      destroyedHandler!({ chatSessionId: 'session-1' });
      expect(state.get()['session-1']).toBeUndefined();
      expect(state.get()['session-2']?.items).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('subscribes to cache-destroyed even when the consumed listener is unavailable', () => {
    const onDestroyed = vi.fn();
    let destroyedHandler: ((data: any) => void) | undefined;
    onDestroyed.mockImplementation((cb: (data: any) => void) => {
      destroyedHandler = cb;
      return vi.fn();
    });
    vi.stubGlobal('window', {
      electronAPI: { agentChat: { onChatSessionCacheDestroyed: onDestroyed } },
    });

    try {
      const state = buildStore()(queuedMessageAtom);
      state.actions.queue('chat-1', 'session-1', textMessage('a'));

      expect(destroyedHandler).toBeDefined();
      destroyedHandler!({ chatSessionId: 'session-1' });

      expect(state.get()['session-1']).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('queues locally without attaching listeners when window is unavailable', () => {
    vi.stubGlobal('window', undefined);

    try {
      const state = buildStore()(queuedMessageAtom);
      expect(() => state.actions.queue('chat-1', 'session-1', textMessage('a'))).not.toThrow();
      expect(state.get()['session-1']?.items).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
