import { describe, expect, it, vi } from 'vitest';
import type { Message, UserMessage } from '@shared/types/chatTypes';
import type { CancellationToken } from '../../cancellation';
import { CancellationError } from '../../cancellation';
import {
  buildQueuedUserMessageChunk,
  drainQueuedSteeringFollowUpTurns,
  persistAndAnnounceQueuedSteeringMessage,
  type QueuedPromptHookOutcome,
  type QueuedSteeringEmitPort,
  type QueuedSteeringFollowUpPort,
} from '../steeringQueueConsumption';

function userMessage(id: string | undefined, text: string): UserMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
  } as UserMessage;
}

function hookOutcome(overrides: Partial<QueuedPromptHookOutcome> = {}): QueuedPromptHookOutcome {
  return {
    blocked: false,
    surfaceBlock: vi.fn(async () => []),
    applyAllowed: vi.fn(),
    ...overrides,
  };
}

function emitPort(overrides: Partial<QueuedSteeringEmitPort> = {}): QueuedSteeringEmitPort {
  return {
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    addMessageToSession: vi.fn().mockResolvedValue(undefined),
    emitStreamingChunk: vi.fn(),
    emitQueuedSteeringMessageConsumed: vi.fn(),
    ...overrides,
  };
}

describe('buildQueuedUserMessageChunk', () => {
  it('shapes a user_message chunk from the port and message id', () => {
    const port = emitPort();
    const chunk = buildQueuedUserMessageChunk(port, userMessage('u1', 'hi'));

    expect(chunk.type).toBe('user_message');
    expect(chunk.messageId).toBe('u1');
    expect(chunk.chatId).toBe('chat-1');
    expect(chunk.chatSessionId).toBe('session-1');
    expect(chunk.userMessage).toMatchObject({ id: 'u1', role: 'user' });
  });

  it('falls back to a generated messageId when the message has none', () => {
    const port = emitPort();
    const chunk = buildQueuedUserMessageChunk(port, userMessage(undefined, 'hi'));

    expect(chunk.messageId).toMatch(/^queued_user_/);
    expect(chunk.userMessage?.id).toBeUndefined();
  });
});

describe('persistAndAnnounceQueuedSteeringMessage', () => {
  it('persists, emits a chunk, and announces consumption for a message with an id', async () => {
    const port = emitPort();
    const message = userMessage('u1', 'hi');

    await persistAndAnnounceQueuedSteeringMessage(port, message);

    expect(port.addMessageToSession).toHaveBeenCalledWith(message);
    expect(port.emitStreamingChunk).toHaveBeenCalledTimes(1);
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
  });

  it('does not announce consumption when the message has no id', async () => {
    const port = emitPort();

    await persistAndAnnounceQueuedSteeringMessage(port, userMessage(undefined, 'hi'));

    expect(port.emitStreamingChunk).toHaveBeenCalledTimes(1);
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
  });
});

describe('drainQueuedSteeringFollowUpTurns', () => {
  function followUpPort(
    queue: UserMessage[],
    runFollowUpTurn: (message: UserMessage) => Promise<Message[]>,
    overrides: Partial<QueuedSteeringFollowUpPort> = {},
  ): QueuedSteeringFollowUpPort {
    return {
      ...emitPort(),
      peekNextQueuedSteeringMessage: vi.fn(() => queue[0] ?? null),
      takeQueuedSteeringMessageById: vi.fn((id?: string) => {
        const index = queue.findIndex((m) => m.id === id);
        if (index < 0) {
          return null;
        }
        return queue.splice(index, 1)[0] ?? null;
      }),
      restoreQueuedSteeringMessageToFront: vi.fn((message: UserMessage) => {
        queue.unshift(message);
      }),
      runFollowUpTurn: vi.fn(runFollowUpTurn),
      runPromptSubmitHook: vi.fn(async () => hookOutcome()),
      runStopHook: vi.fn().mockResolvedValue(undefined),
      clearTurnHookBuffers: vi.fn(),
      ...overrides,
    };
  }

  it('returns the initial result and runs no follow-up when the queue is empty', async () => {
    const initial: Message[] = [userMessage('a', 'initial')];
    const port = followUpPort([], async () => []);

    const result = await drainQueuedSteeringFollowUpTurns(port, initial);

    expect(result).toBe(initial);
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
  });

  it('processes a single queued message and returns its follow-up result', async () => {
    const followUp: Message[] = [userMessage('r1', 'reply')];
    const port = followUpPort([userMessage('u1', 'first')], async () => followUp);

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    expect(result).toBe(followUp);
    expect(port.runFollowUpTurn).toHaveBeenCalledTimes(1);
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
    // The queued prompt gets its own Stop hook + turn-buffer reset.
    expect(port.runStopHook).toHaveBeenCalledTimes(1);
    expect(port.clearTurnHookBuffers).toHaveBeenCalledTimes(1);
  });

  it('persists the peeked hook-validated snapshot, not an entry mutated during the hook', async () => {
    const queue = [userMessage('u1', 'validated-original')];
    const persisted: UserMessage[] = [];
    const port = followUpPort(queue, async () => [], {
      addMessageToSession: vi.fn(async (message: Message) => {
        persisted.push(message as UserMessage);
      }),
      // Simulate an in-place edit landing DURING the UserPromptSubmit hook: the
      // queue head is replaced with different content under the same id. The
      // commit-time take will return this mutated entry, but the drain must send
      // the snapshot the hook already validated.
      runPromptSubmitHook: vi.fn(async () => {
        queue[0] = userMessage('u1', 'edited-after-validation');
        return hookOutcome();
      }),
    });

    await drainQueuedSteeringFollowUpTurns(port, []);

    expect(persisted).toHaveLength(1);
    expect((persisted[0].content[0] as any).text).toBe('validated-original');
    expect(port.runFollowUpTurn).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: 'text', text: 'validated-original' }] }),
      undefined,
    );
  });

  it('runs one Stop hook and one buffer reset per queued prompt', async () => {
    const port = followUpPort(
      [userMessage('u1', 'first'), userMessage('u2', 'second'), userMessage('u3', 'third')],
      async () => [],
    );

    await drainQueuedSteeringFollowUpTurns(port, []);

    expect(port.runStopHook).toHaveBeenCalledTimes(3);
    expect(port.clearTurnHookBuffers).toHaveBeenCalledTimes(3);
  });

  it('runs the Stop hook and buffer reset after the follow-up turn completes', async () => {
    const order: string[] = [];
    const port = followUpPort([userMessage('u1', 'first')], async () => {
      order.push('run');
      return [];
    }, {
      runStopHook: vi.fn(async () => { order.push('stop'); }),
      clearTurnHookBuffers: vi.fn(() => { order.push('clear'); }),
    });

    await drainQueuedSteeringFollowUpTurns(port, []);

    expect(order).toEqual(['run', 'stop', 'clear']);
  });

  it('forwards the cancellation token to the per-turn Stop hook', async () => {
    const token = { isCancellationRequested: false } as unknown as CancellationToken;
    const port = followUpPort([userMessage('u1', 'first')], async () => []);

    await drainQueuedSteeringFollowUpTurns(port, [], token);

    expect(port.runStopHook).toHaveBeenCalledWith(token);
  });

  it('processes multiple queued messages one at a time in FIFO order', async () => {
    const processed: string[] = [];
    const port = followUpPort(
      [userMessage('u1', 'first'), userMessage('u2', 'second'), userMessage('u3', 'third')],
      async (message) => {
        processed.push(message.id as string);
        return [userMessage(`r-${message.id}`, 'reply')];
      },
    );

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    expect(processed).toEqual(['u1', 'u2', 'u3']);
    expect(port.runFollowUpTurn).toHaveBeenCalledTimes(3);
    expect((result[0] as UserMessage).id).toBe('r-u3');
  });

  it('throws CancellationError and stops draining when cancellation is requested', async () => {
    const token = { isCancellationRequested: true } as unknown as CancellationToken;
    const port = followUpPort([userMessage('u1', 'first')], async () => []);

    await expect(drainQueuedSteeringFollowUpTurns(port, [], token)).rejects.toBeInstanceOf(
      CancellationError,
    );
    expect(port.peekNextQueuedSteeringMessage).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
  });

  it('proceeds while a provided token is not cancelled', async () => {
    const token = { isCancellationRequested: false } as unknown as CancellationToken;
    const port = followUpPort([userMessage('u1', 'first')], async () => []);

    await drainQueuedSteeringFollowUpTurns(port, [], token);

    expect(port.runFollowUpTurn).toHaveBeenCalledTimes(1);
    expect(port.runFollowUpTurn).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), token);
  });

  it('runs the prompt submit hook then applies context before persisting each queued prompt', async () => {
    const order: string[] = [];
    const port = followUpPort([userMessage('u1', 'first')], async () => {
      order.push('run');
      return [];
    }, {
      runPromptSubmitHook: vi.fn(async () => {
        order.push('hook');
        return hookOutcome({ applyAllowed: () => order.push('apply') });
      }),
      addMessageToSession: vi.fn(async () => { order.push('persist'); }),
    });

    await drainQueuedSteeringFollowUpTurns(port, []);

    expect(port.runPromptSubmitHook).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), undefined);
    expect(order).toEqual(['hook', 'apply', 'persist', 'run']);
  });

  it('skips persisting and running a queued prompt that a hook blocks, but drops its draft', async () => {
    const blockMessages: Message[] = [userMessage('blocked-notice', 'denied')];
    const port = followUpPort([userMessage('u1', 'first')], async () => [], {
      runPromptSubmitHook: vi.fn(async () => hookOutcome({
        blocked: true,
        surfaceBlock: vi.fn(async () => blockMessages),
      })),
    });

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    // Blocked -> the prompt is neither persisted nor run, but the draft is dropped.
    expect(port.addMessageToSession).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
    expect(result).toBe(blockMessages);
    // A blocked prompt never ran a turn, so it gets no Stop hook or buffer reset.
    expect(port.runStopHook).not.toHaveBeenCalled();
    expect(port.clearTurnHookBuffers).not.toHaveBeenCalled();
  });

  it('does not announce consumption for a blocked prompt that has no id', async () => {
    const blockMessages: Message[] = [userMessage('blocked-notice', 'denied')];
    const port = followUpPort([userMessage(undefined, 'first')], async () => [], {
      runPromptSubmitHook: vi.fn(async () => hookOutcome({
        blocked: true,
        surfaceBlock: vi.fn(async () => blockMessages),
      })),
    });

    await drainQueuedSteeringFollowUpTurns(port, []);

    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
  });

  it('continues draining after a blocked prompt to the next queued prompt', async () => {
    const processed: string[] = [];
    const port = followUpPort(
      [userMessage('u1', 'first'), userMessage('u2', 'second')],
      async (message) => {
        processed.push(message.id as string);
        return [userMessage(`r-${message.id}`, 'reply')];
      },
      {
        runPromptSubmitHook: vi
          .fn()
          .mockResolvedValueOnce(hookOutcome({
            blocked: true,
            surfaceBlock: vi.fn(async () => [userMessage('blocked-notice', 'denied')]),
          }))
          .mockResolvedValueOnce(hookOutcome()),
      },
    );

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    // First prompt blocked (not run); second prompt runs normally.
    expect(processed).toEqual(['u2']);
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
    expect((result[0] as UserMessage).id).toBe('r-u2');
  });

  it('leaves the prompt in the queue and rethrows when the prompt submit hook throws', async () => {
    const queue = [userMessage('u1', 'first'), userMessage('u2', 'second')];
    const failure = new Error('hook exploded');
    const port = followUpPort(queue, async () => [], {
      runPromptSubmitHook: vi.fn().mockRejectedValue(failure),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // The prompt is only PEEKED before its hook runs, so a hook throw leaves it in
    // the queue untouched -- no take, no restore needed, FIFO order preserved.
    expect(port.takeQueuedSteeringMessageById).not.toHaveBeenCalled();
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
    expect(queue.map((m) => m.id)).toEqual(['u1', 'u2']);
    // Never persisted, announced, or ran a turn for the failed prompt.
    expect(port.addMessageToSession).not.toHaveBeenCalled();
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
  });

  it('skips a queued prompt the user cancelled during its hook window', async () => {
    const queue = [userMessage('u1', 'first'), userMessage('u2', 'second')];
    // Simulate the user cancelling u1 (removing it from the queue) while its
    // UserPromptSubmit hook runs: the hook resolves null (allow) but u1 is gone.
    const port = followUpPort(queue, async (message) => [userMessage(`r-${message.id}`, 'reply')], {
      runPromptSubmitHook: vi.fn(async (message: UserMessage) => {
        if (message.id === 'u1') {
          const index = queue.findIndex((m) => m.id === 'u1');
          if (index >= 0) {
            queue.splice(index, 1);
          }
        }
        return hookOutcome();
      }),
    });

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    // u1 was cancelled during its hook, so the commit-time take returns null and
    // the prompt is skipped -- never persisted, announced, run, or restored.
    expect(port.addMessageToSession).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalledWith('u1');
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
    // The next queued prompt still runs normally.
    expect((result[0] as UserMessage).id).toBe('r-u2');
    expect(queue).toHaveLength(0);
  });

  it('restores a taken prompt to the front when persistence throws before it is consumed', async () => {
    const queue = [userMessage('u1', 'first')];
    const failure = new Error('persist failed');
    const port = followUpPort(queue, async () => [], {
      addMessageToSession: vi.fn().mockRejectedValue(failure),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    expect(port.restoreQueuedSteeringMessageToFront).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
    );
    expect(queue.map((m) => m.id)).toEqual(['u1']);
    // Persistence failed, so the prompt was never announced as consumed.
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
  });

  it('restores the committed (edited) entry, not the stale peeked snapshot, when persistence fails after an edit', async () => {
    const original = userMessage('u1', 'original');
    const edited = userMessage('u1', 'edited');
    const queue = [original];
    const failure = new Error('persist failed');
    const port = followUpPort(queue, async () => [], {
      addMessageToSession: vi.fn().mockRejectedValue(failure),
      // The user edits the queued prompt during the hook window. The real
      // AgentChatRuntimeState.updateSteeringMessage REPLACES the array slot with a
      // NEW object, so the peeked snapshot (`original`) and the committed entry the
      // take returns (`edited`) diverge.
      runPromptSubmitHook: vi.fn(async () => {
        queue[0] = edited;
        return hookOutcome();
      }),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // Persist still uses the PEEKED, hook-validated snapshot (never the edited entry).
    expect(port.addMessageToSession).toHaveBeenCalledWith(original);
    // But the RESTORE uses the COMMITTED (edited) entry, so main's queue matches the
    // renderer draft and the retry re-runs the hook on the edited content. Restoring
    // the stale peeked snapshot would silently lose the user's edit.
    expect(port.restoreQueuedSteeringMessageToFront).toHaveBeenCalledWith(edited);
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalledWith(original);
    expect(queue.map((m) => m.content)).toEqual([edited.content]);
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
  });

  it('throws and leaves the prompt queued when the token is cancelled during its hook', async () => {
    const queue = [userMessage('u1', 'first')];
    const token = { isCancellationRequested: false } as unknown as CancellationToken;
    const port = followUpPort(queue, async () => [], {
      runPromptSubmitHook: vi.fn(async () => {
        // The user hits Cancel while the hook runs: the hook resolves benignly (it
        // does NOT throw), but the token flips to cancelled during the window.
        (token as unknown as { isCancellationRequested: boolean }).isCancellationRequested = true;
        return hookOutcome();
      }),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [], token)).rejects.toBeInstanceOf(
      CancellationError,
    );

    // Finding 1: a cancel that raced the hook must leave the prompt PEEKED (never
    // taken/persisted), so it stays queued and consumable instead of being committed
    // without a response.
    expect(port.takeQueuedSteeringMessageById).not.toHaveBeenCalled();
    expect(port.addMessageToSession).not.toHaveBeenCalled();
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
    expect(port.runFollowUpTurn).not.toHaveBeenCalled();
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
    expect(queue.map((m) => m.id)).toEqual(['u1']);
  });

  it('does not surface a block for a prompt the user removed during its blocking hook', async () => {
    const queue = [userMessage('u1', 'first'), userMessage('u2', 'second')];
    const surfaceBlock = vi.fn(async () => [userMessage('blocked-notice', 'denied')]);
    const port = followUpPort(queue, async (message) => [userMessage(`r-${message.id}`, 'reply')], {
      runPromptSubmitHook: vi.fn(async (message: UserMessage) => {
        if (message.id === 'u1') {
          const index = queue.findIndex((m) => m.id === 'u1');
          if (index >= 0) {
            queue.splice(index, 1);
          }
          return hookOutcome({ blocked: true, surfaceBlock });
        }
        return hookOutcome();
      }),
    });

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    // Finding 2: u1 was removed during its hook, so the commit-time take returns
    // null and the block is NEVER surfaced (no stray "blocked" message) and no
    // consumed event fires for it. The next queued prompt still runs normally.
    expect(surfaceBlock).not.toHaveBeenCalled();
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalledWith('u1');
    expect((result[0] as UserMessage).id).toBe('r-u2');
  });

  it('does not apply an allowed prompt hook context for a prompt removed during its hook', async () => {
    const queue = [userMessage('u1', 'first'), userMessage('u2', 'second')];
    const applyU1 = vi.fn();
    const port = followUpPort(queue, async (message) => [userMessage(`r-${message.id}`, 'reply')], {
      runPromptSubmitHook: vi.fn(async (message: UserMessage) => {
        if (message.id === 'u1') {
          const index = queue.findIndex((m) => m.id === 'u1');
          if (index >= 0) {
            queue.splice(index, 1);
          }
          return hookOutcome({ applyAllowed: applyU1 });
        }
        return hookOutcome();
      }),
    });

    const result = await drainQueuedSteeringFollowUpTurns(port, []);

    // Finding 4: u1 was removed during its hook, so its allowed-hook context is
    // never applied and cannot leak into u2's turn.
    expect(applyU1).not.toHaveBeenCalled();
    expect((result[0] as UserMessage).id).toBe('r-u2');
  });

  it('restores a blocked prompt to the front when surfacing the block throws', async () => {
    const queue = [userMessage('u1', 'first')];
    const failure = new Error('surface failed');
    const port = followUpPort(queue, async () => [], {
      runPromptSubmitHook: vi.fn(async () => hookOutcome({
        blocked: true,
        surfaceBlock: vi.fn().mockRejectedValue(failure),
      })),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // The prompt was taken (committed) but surfacing failed before it was announced
    // consumed, so it must be restored to the front to avoid stranding it (gone from
    // the queue yet still shown in the renderer).
    expect(port.restoreQueuedSteeringMessageToFront).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
    );
    expect(port.emitQueuedSteeringMessageConsumed).not.toHaveBeenCalled();
  });

  it('does NOT restore a prompt that already ran its turn when the follow-up turn throws', async () => {
    const queue = [userMessage('u1', 'first')];
    const failure = new Error('turn failed');
    const port = followUpPort(queue, async () => {
      throw failure;
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // The prompt was already persisted + announced (consumed) before the turn
    // threw, so restoring it would duplicate it. It must NOT be restored.
    expect(port.addMessageToSession).toHaveBeenCalledTimes(1);
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });

  it('does NOT restore a prompt when the Stop hook throws after the turn completes', async () => {
    const queue = [userMessage('u1', 'first')];
    const failure = new Error('stop failed');
    const port = followUpPort(queue, async () => [], {
      runStopHook: vi.fn().mockRejectedValue(failure),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // Already consumed (persisted + announced) and the turn ran, so no restore.
    expect(port.emitQueuedSteeringMessageConsumed).toHaveBeenCalledWith('u1');
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
  });

  it('does NOT restore a blocked prompt whose consumed emit throws', async () => {
    const queue = [userMessage('u1', 'first')];
    const failure = new Error('emit failed');
    const port = followUpPort(queue, async () => [], {
      runPromptSubmitHook: vi.fn(async () => hookOutcome({
        blocked: true,
        surfaceBlock: vi.fn(async () => [userMessage('blocked', 'denied')]),
      })),
      emitQueuedSteeringMessageConsumed: vi.fn(() => {
        throw failure;
      }),
    });

    await expect(drainQueuedSteeringFollowUpTurns(port, [])).rejects.toBe(failure);

    // The block was already surfaced, so the prompt is treated as consumed and must
    // not be restored even if the draft-drop emit fails (restoring would re-run and
    // double-surface the block).
    expect(port.restoreQueuedSteeringMessageToFront).not.toHaveBeenCalled();
  });
});
