import { AgentChatRuntimeState } from '../agentChatRuntimeState';
import { ChatStatus } from '../agentChatTypes';

describe('AgentChatRuntimeState', () => {
  it('tracks mutable runtime state through explicit mutation methods', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);

    runtimeState.setChatStatus(ChatStatus.SENDING_RESPONSE);
    runtimeState.setPendingInteractiveRequest({ interactionId: 'int-1' } as any);
    runtimeState.setMessagesToSave([{ id: 'm1' }] as any);
    runtimeState.setActiveToolCancellationHandler(() => undefined);

    expect(runtimeState.chatStatus).toBe(ChatStatus.SENDING_RESPONSE);
    expect(runtimeState.pendingInteractiveRequest).toEqual(expect.objectContaining({ interactionId: 'int-1' }));
    expect(runtimeState.messagesToSave).toEqual([{ id: 'm1' }]);
    expect(typeof runtimeState.activeToolCancellationHandler).toBe('function');
  });

  it('clearCancellationToken only clears when nonce matches (stale turn guard)', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    const token1 = { isCancelled: () => false } as any;
    const token2 = { isCancelled: () => false } as any;

    // Turn 1 binds token and captures nonce
    runtimeState.bindCancellationToken(token1);
    const nonce1 = runtimeState.bumpToolExecutionNonce();
    expect(runtimeState.currentCancellationToken).toBe(token1);

    // Turn 2 starts (simulating cancel -> new message): binds new token, bumps nonce
    runtimeState.bindCancellationToken(token2);
    const nonce2 = runtimeState.bumpToolExecutionNonce();
    expect(runtimeState.currentCancellationToken).toBe(token2);
    expect(nonce2).not.toBe(nonce1);

    // Stale turn 1 reaches finally — nonce doesn't match, so should NOT clear
    if (nonce1 === runtimeState.toolExecutionNonce) {
      runtimeState.clearCancellationToken();
    }
    // Token2 must still be intact
    expect(runtimeState.currentCancellationToken).toBe(token2);

    // Active turn 2 reaches finally — nonce matches, clears normally
    if (nonce2 === runtimeState.toolExecutionNonce) {
      runtimeState.clearCancellationToken();
    }
    expect(runtimeState.currentCancellationToken).toBeUndefined();
  });

  it('preserves saveChain replacement and execution nonce increments', async () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    const saveChain = Promise.resolve({ success: true as const });

    runtimeState.setSaveChain(saveChain);

    expect(runtimeState.saveChain).toBe(saveChain);
    expect(runtimeState.bumpToolExecutionNonce()).toBe(1);
    expect(runtimeState.bumpToolExecutionNonce()).toBe(2);
  });

  it('setToolExecutionNonce directly sets the nonce to an arbitrary value', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);

    runtimeState.setToolExecutionNonce(42);
    expect(runtimeState.toolExecutionNonce).toBe(42);

    // bumpToolExecutionNonce increments from the explicitly set value
    expect(runtimeState.bumpToolExecutionNonce()).toBe(43);
  });
});

describe('AgentChatRuntimeState queued steering messages', () => {
  const makeMessage = (id: string, text = id): any => ({
    id,
    role: 'user',
    content: [{ type: 'text', text }],
  });

  it('enqueues new messages and upserts an existing id in place', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);

    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a', 'b']);

    // Upsert existing id -> replaces in place, does not append
    runtimeState.enqueueSteeringMessage(makeMessage('a', 'a-edited'));
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a', 'b']);
    expect((runtimeState.queuedSteeringMessages[0].content[0] as any).text).toBe('a-edited');
  });

  it('updateSteeringMessage replaces an existing message in place and returns true', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));

    const updated = runtimeState.updateSteeringMessage(makeMessage('a', 'a-edited'));

    expect(updated).toBe(true);
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a', 'b']);
    expect((runtimeState.queuedSteeringMessages[0].content[0] as any).text).toBe('a-edited');
  });

  it('updateSteeringMessage returns false and does NOT re-add a message that is gone', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));

    // Simulate an edit racing a consumption: the id was already taken from the
    // queue, so the update must be a no-op instead of resurrecting a duplicate.
    const updated = runtimeState.updateSteeringMessage(makeMessage('gone', 'late-edit'));

    expect(updated).toBe(false);
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a']);
  });

  it('removeSteeringMessage removes only the matching id', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));

    runtimeState.removeSteeringMessage('a');
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['b']);

    // Removing a non-existent id is a no-op
    runtimeState.removeSteeringMessage('missing');
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['b']);
  });

  it('promoteSteeringMessage moves a found message to the head and returns it', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));
    runtimeState.enqueueSteeringMessage(makeMessage('c'));

    const promoted = runtimeState.promoteSteeringMessage('c');
    expect(promoted?.id).toBe('c');
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('promoteSteeringMessage returns null when the id is missing', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));

    expect(runtimeState.promoteSteeringMessage('missing')).toBeNull();
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a']);
  });

  it('restoreSteeringMessageToFront prepends a message that is not in the queue', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));

    runtimeState.restoreSteeringMessageToFront(makeMessage('taken'));

    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['taken', 'a', 'b']);
  });

  it('restoreSteeringMessageToFront dedupes by id and moves the message to the head', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));
    runtimeState.enqueueSteeringMessage(makeMessage('c'));

    // 'b' is already present (e.g. an edit re-enqueued it); restoring must not
    // leave a duplicate and must place the restored copy at the front.
    runtimeState.restoreSteeringMessageToFront(makeMessage('b', 'b-restored'));

    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['b', 'a', 'c']);
    expect(runtimeState.queuedSteeringMessages[0]).toMatchObject({ id: 'b', content: [{ type: 'text', text: 'b-restored' }] });
  });

  it('takeSteeringMessage removes and returns a found message', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));

    const taken = runtimeState.takeSteeringMessage('a');
    expect(taken?.id).toBe('a');
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['b']);
  });

  it('takeSteeringMessage returns null when the id is missing', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    expect(runtimeState.takeSteeringMessage('missing')).toBeNull();
  });

  it('takeNextSteeringMessage pops the head or returns null when empty', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    expect(runtimeState.takeNextSteeringMessage()).toBeNull();

    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));
    expect(runtimeState.takeNextSteeringMessage()?.id).toBe('a');
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['b']);
  });

  it('peekNextSteeringMessage returns the head without removing it, or null when empty', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    expect(runtimeState.peekNextSteeringMessage()).toBeNull();

    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));
    expect(runtimeState.peekNextSteeringMessage()?.id).toBe('a');
    // Peeking must NOT remove the head: the queue is unchanged and a second peek
    // still returns the same message.
    expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(runtimeState.peekNextSteeringMessage()?.id).toBe('a');
  });

  it('clearSteeringMessages empties the queue', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    runtimeState.enqueueSteeringMessage(makeMessage('a'));
    runtimeState.enqueueSteeringMessage(makeMessage('b'));

    runtimeState.clearSteeringMessages();
    expect(runtimeState.queuedSteeringMessages).toEqual([]);
  });

  describe('editing hold', () => {
    it('setSteeringMessageEditing tracks at most one held id and replaces on switch', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      expect(runtimeState.editingSteeringMessageId).toBeNull();

      runtimeState.setSteeringMessageEditing('a', true);
      expect(runtimeState.editingSteeringMessageId).toBe('a');

      // Switching the edit target replaces the held id (renderer edits one at a time).
      runtimeState.setSteeringMessageEditing('b', true);
      expect(runtimeState.editingSteeringMessageId).toBe('b');
    });

    it('setSteeringMessageEditing(false) only releases when the id matches', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.setSteeringMessageEditing('a', true);

      // A stale unmark for a different draft must not free the hold on 'a'.
      runtimeState.setSteeringMessageEditing('b', false);
      expect(runtimeState.editingSteeringMessageId).toBe('a');

      runtimeState.setSteeringMessageEditing('a', false);
      expect(runtimeState.editingSteeringMessageId).toBeNull();
    });

    it('peekNextSteeringMessage skips a held head so the drain waits on it', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.enqueueSteeringMessage(makeMessage('b'));

      runtimeState.setSteeringMessageEditing('a', true);
      // Head 'a' is held: nothing is consumable even though 'b' sits behind it
      // (waiting at the head preserves FIFO instead of skipping ahead to 'b').
      expect(runtimeState.peekNextSteeringMessage()).toBeNull();

      // Releasing the hold makes the head consumable again.
      runtimeState.setSteeringMessageEditing('a', false);
      expect(runtimeState.peekNextSteeringMessage()?.id).toBe('a');
    });

    it('peekNextSteeringMessage returns the head when a non-head draft is held', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.enqueueSteeringMessage(makeMessage('b'));

      // Editing 'b' (not the head) must not block consuming the head 'a'.
      runtimeState.setSteeringMessageEditing('b', true);
      expect(runtimeState.peekNextSteeringMessage()?.id).toBe('a');
    });

    it('takeSteeringMessage refuses a held id so a hook-window edit is not committed', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));

      runtimeState.setSteeringMessageEditing('a', true);
      expect(runtimeState.takeSteeringMessage('a')).toBeNull();
      // The draft stays queued so it can be consumed after the edit finishes.
      expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a']);
    });

    it('takeNextSteeringMessage refuses a held head', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.setSteeringMessageEditing('a', true);

      expect(runtimeState.takeNextSteeringMessage()).toBeNull();
      expect(runtimeState.queuedSteeringMessages.map((m) => m.id)).toEqual(['a']);
    });

    it('updateSteeringMessage releases the hold on the edited id (edit submitted)', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.setSteeringMessageEditing('a', true);

      expect(runtimeState.updateSteeringMessage(makeMessage('a', 'edited'))).toBe(true);
      expect(runtimeState.editingSteeringMessageId).toBeNull();
      expect(runtimeState.peekNextSteeringMessage()).toMatchObject({ id: 'a', content: [{ type: 'text', text: 'edited' }] });
    });

    it('removeSteeringMessage clears a stale hold on the removed id', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.setSteeringMessageEditing('a', true);

      runtimeState.removeSteeringMessage('a');
      expect(runtimeState.editingSteeringMessageId).toBeNull();
    });

    it('clearSteeringMessages resets the editing hold', () => {
      const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
      runtimeState.enqueueSteeringMessage(makeMessage('a'));
      runtimeState.setSteeringMessageEditing('a', true);

      runtimeState.clearSteeringMessages();
      expect(runtimeState.editingSteeringMessageId).toBeNull();
    });
  });
});