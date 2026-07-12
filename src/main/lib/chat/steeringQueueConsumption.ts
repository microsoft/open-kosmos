import type { Message, UserMessage } from '@shared/types/chatTypes';
import type { StreamingChunk } from '@shared/types/streamingTypes';

import { CancellationError, type CancellationToken } from '../cancellation';

/**
 * Shared plumbing for consuming queued steering prompts. The end-of-turn
 * follow-up path (AgentChat.streamMessage) is the single consumer: it persists
 * each queued message, mirrors it to the renderer as a user_message chunk, and
 * emits the consumed event that removes the item from the renderer queue.
 * Centralizing the chunk-shaping and consumed-event logic keeps a consumed
 * queued prompt indistinguishable from a prompt typed directly into the
 * composer.
 */
export interface QueuedSteeringEmitPort {
  chatId: string;
  chatSessionId: string;
  addMessageToSession: (message: UserMessage) => Promise<void>;
  emitStreamingChunk: (chunk: StreamingChunk) => void;
  emitQueuedSteeringMessageConsumed: (messageId: string) => void;
}

/**
 * Outcome of running a queued prompt's UserPromptSubmit hook WITHOUT surfacing a
 * block or applying its context yet. The drain decides — after confirming (at the
 * commit point) that the prompt is still queued — whether to surface a block or
 * apply the allowed prompt's hook context. Deferring both past the still-queued
 * check means a prompt the user cancelled during the hook window leaves no trace:
 * no stray "blocked" message and no leaked hook context.
 */
export interface QueuedPromptHookOutcome {
  /** True when a UserPromptSubmit hook denied the prompt. */
  blocked: boolean;
  /**
   * Persist + emit the "blocked" notice for a denied prompt and return the updated
   * display messages. Does NOT set the session idle: the drain holds
   * SENDING_RESPONSE across every queued prompt, so idling here would break that
   * mutex and let a concurrent send/steer interleave mid-drain.
   */
  surfaceBlock: () => Promise<Message[]>;
  /**
   * Apply an allowed prompt's UserPromptSubmit hook context (additionalContexts /
   * systemMessages) to the current turn's buffers. Called only AFTER the prompt is
   * committed, so a prompt removed during the hook window never contributes context
   * to a later prompt's turn.
   */
  applyAllowed: () => void;
}

export interface QueuedSteeringFollowUpPort extends QueuedSteeringEmitPort {
  /**
   * Return the FIFO head WITHOUT removing it. The drain runs the prompt's
   * UserPromptSubmit hook while the message is still in the queue so a concurrent
   * user cancel (`removeSteeringMessage`) during the hook window wins — the
   * commit-time `takeQueuedSteeringMessageById` below then finds it gone and the
   * prompt is skipped instead of being sent after the user cancelled it.
   */
  peekNextQueuedSteeringMessage: () => UserMessage | null;
  /**
   * Atomically remove the head prompt by id at the commit point. Returns the
   * message when it is still queued (proceed to persist + run), or null when it
   * was removed/cancelled during the hook window (skip it).
   */
  takeQueuedSteeringMessageById: (messageId: string | undefined) => UserMessage | null;
  /**
   * Restore a taken prompt to the FRONT of the queue. Called when a prompt was
   * removed from the queue (committed at the take point) but then failed/cancelled
   * BEFORE it was announced as consumed (a persist/turn failure): it must return
   * to the head so it stays consumable and FIFO order is preserved, matching the
   * manual-steer/idle-pump restore contract.
   */
  restoreQueuedSteeringMessageToFront: (message: UserMessage) => void;
  runFollowUpTurn: (message: UserMessage, token?: CancellationToken) => Promise<Message[]>;
  /**
   * Run the UserPromptSubmit hook for a queued prompt WITHOUT surfacing a block or
   * applying its context yet. The drain defers both until AFTER it has confirmed
   * (at the commit point) that the prompt is still queued, so a prompt the user
   * cancelled during the hook window leaves no trace. See QueuedPromptHookOutcome.
   * Keeping this on the port means the queued path enforces the same prompt policy
   * as the interactive path.
   */
  runPromptSubmitHook: (message: UserMessage, token?: CancellationToken) => Promise<QueuedPromptHookOutcome>;
  /**
   * Run the Stop hook for a completed queued turn. Each queued prompt is a full
   * turn, so it gets its own Stop exactly like a prompt typed into the composer.
   */
  runStopHook: (token?: CancellationToken) => Promise<void>;
  /**
   * Reset the turn-scoped hook buffers after a queued turn completes so the next
   * queued prompt starts from a clean hook context instead of inheriting this
   * prompt's UserPromptSubmit/PostToolUse additionalContext and system messages.
   */
  clearTurnHookBuffers: () => void;
}

export function buildQueuedUserMessageChunk(
  port: QueuedSteeringEmitPort,
  message: UserMessage,
): StreamingChunk {
  const fallbackId = `queued_user_${Date.now()}`;
  return {
    chunkId: `queued_user_${message.id || Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    messageId: message.id || fallbackId,
    chatId: port.chatId,
    chatSessionId: port.chatSessionId,
    timestamp: Date.now(),
    type: 'user_message',
    userMessage: {
      id: message.id,
      role: 'user',
      content: message.content,
      timestamp: message.timestamp,
    },
  } as StreamingChunk;
}

/**
 * Persist a single queued steering message, mirror it to the renderer, and emit
 * the consumed event so the renderer drops it from the queue list.
 */
export async function persistAndAnnounceQueuedSteeringMessage(
  port: QueuedSteeringEmitPort,
  message: UserMessage,
): Promise<void> {
  await port.addMessageToSession(message);
  port.emitStreamingChunk(buildQueuedUserMessageChunk(port, message));
  if (message.id) {
    port.emitQueuedSteeringMessageConsumed(message.id);
  }
}

/**
 * Drain the queued steering prompts one at a time, running a dedicated follow-up
 * turn for each so every queued prompt receives its own model response in FIFO
 * order. Consuming a single head per iteration (rather than draining the whole
 * queue up front) prevents queued prompts from being silently collapsed into a
 * single turn or removed from the renderer without ever being answered. Each
 * prompt first runs the UserPromptSubmit hook lifecycle, so queued prompts are
 * subject to the same prompt policy as prompts typed directly into the composer,
 * and finishes with its own Stop hook + turn-buffer reset so a queued prompt's
 * hook context never leaks into the next queued prompt's turn.
 *
 * Cancel-safe commit: each prompt is PEEKED (not removed) and its UserPromptSubmit
 * hook runs while it is still in the queue, so a concurrent user cancel
 * (`removeSteeringMessage`) during the hook window wins — the commit-time
 * `takeQueuedSteeringMessageById` then returns null and the prompt is skipped
 * instead of being sent after the user cancelled it. The hook does NOT surface a
 * block or apply its context during this window; the drain defers both until AFTER
 * the still-queued commit check, so a cancelled prompt leaves no stray "blocked"
 * message and leaks no hook context. A user Cancel (token cancel) that lands while
 * the hook awaits does not throw — the drain re-checks the token immediately after
 * the hook and throws before committing, so the cancelled prompt stays queued
 * instead of being persisted without a response. The content that is persisted and
 * run is the PEEKED, hook-validated snapshot (not the value the commit-time take
 * returned), so an edit that raced the hook cannot smuggle unvalidated content past
 * the UserPromptSubmit policy. Once the prompt is taken at the commit point, a
 * subsequent persist/turn failure BEFORE it is announced as consumed restores the
 * TAKEN entry (which reflects any edit that landed during the hook window, so main's
 * queue stays in sync with the renderer draft) to the FRONT of the queue and
 * rethrows, so a cancelled/failed prompt is never stranded (gone from the queue yet
 * still shown in the renderer), mirroring the manual-steer/idle-pump restore
 * contract.
 */
export async function drainQueuedSteeringFollowUpTurns(
  port: QueuedSteeringFollowUpPort,
  initialResult: Message[],
  token?: CancellationToken,
): Promise<Message[]> {
  let result = initialResult;

  for (;;) {
    if (token?.isCancellationRequested) {
      throw new CancellationError('Operation was cancelled');
    }

    // Peek the head WITHOUT removing it, then run its hook. Keeping the prompt in
    // the queue during the (possibly slow) hook lets a concurrent user cancel win.
    const message = port.peekNextQueuedSteeringMessage();
    if (!message) {
      return result;
    }

    // Run the UserPromptSubmit hook for the PEEKED prompt WITHOUT surfacing any
    // block or applying its context yet. Both are deferred until AFTER the
    // still-queued commit check below, so a prompt the user removed during the hook
    // window leaves no stray "blocked" message and leaks no hook context.
    const hookOutcome = await port.runPromptSubmitHook(message, token);

    // A user Cancel (Cancel button) can land while the hook awaited above. The hook
    // does NOT throw on cancellation — it resolves benignly — so re-check the token
    // here, BEFORE the commit/persist below. Without this a cancel that raced the
    // hook would fall through and persist the prompt (committing it and dropping its
    // draft) only for the follow-up turn to immediately throw CancellationError,
    // stranding a user message with no response. Throwing here instead leaves the
    // still-PEEKED prompt in the queue, consumable later.
    if (token?.isCancellationRequested) {
      throw new CancellationError('Operation was cancelled');
    }

    // Commit point: atomically remove the peeked prompt by id. If the user
    // cancelled it (removeSteeringMessage) during the hook window it is already
    // gone, so skip it — and skip surfacing/applying its hook outcome entirely, so a
    // cancelled prompt produces no stray block message and leaks no hook context.
    // Note we remove BY ID, not "the current head": a concurrent manual steer may
    // have promoted a different prompt ahead of this one while its hook was running.
    // We still commit the prompt whose hook we just ran (its UserPromptSubmit side
    // effects already executed; re-peeking the new head instead would re-run this
    // prompt's hook later — a double shell-hook execution and a turn-hook-context
    // leak). The promoted prompt simply becomes the next iteration's head. This is
    // the deliberate cost of the speculative peek->hook->commit protocol that lets a
    // cancel during the hook window win.
    const committed = port.takeQueuedSteeringMessageById(message.id);
    if (!committed) {
      continue;
    }

    if (hookOutcome.blocked) {
      // A UserPromptSubmit hook denied this now-committed prompt. Surface the block
      // (persist + emit) WITHOUT idling the session (the drain holds
      // SENDING_RESPONSE across prompts). If surfacing itself fails the prompt is
      // taken but not yet surfaced, so restore it to the front to avoid stranding
      // it; once surfaced it is treated as consumed and a failing consumed-emit must
      // NOT restore it (restoring would re-run and double-surface the block). Restore
      // the COMMITTED entry (`committed`), not the peeked snapshot (`message`): an
      // edit that landed during the hook window replaced the queue entry, so
      // `committed` is what the renderer still shows and what the retry must re-run.
      let surfaced = false;
      try {
        result = await hookOutcome.surfaceBlock();
        surfaced = true;
        if (message.id) {
          port.emitQueuedSteeringMessageConsumed(message.id);
        }
      } catch (error) {
        if (!surfaced) {
          port.restoreQueuedSteeringMessageToFront(committed);
        }
        throw error;
      }
      continue;
    }

    // Allowed: now that the prompt is committed, apply its UserPromptSubmit hook
    // context (additionalContexts/systemMessages) to this turn's buffers. Applying
    // only after the commit means a prompt removed during the hook window never
    // contributes context to a later prompt's turn.
    hookOutcome.applyAllowed();

    // Consume the PEEKED, hook-validated snapshot (`message`), NOT the value the
    // commit-time take returned (`committed`). An edit that landed during the hook
    // window replaced the queued entry; persisting `committed` would send content the
    // UserPromptSubmit hook never validated. Using `message` guarantees the content
    // we persist/run is exactly what the hook approved. `committed` is only the
    // atomic presence check that lets a concurrent cancel win.
    //
    // From here the prompt is removed from the queue but not yet announced as
    // consumed. A persist/turn failure before consumption must restore it to the
    // FRONT so it stays consumable; a failure AFTER consumption must NOT restore
    // it (the prompt is already persisted + its draft dropped, restoring would
    // duplicate it). The restore uses `committed` (the entry actually taken), NOT the
    // stale peeked `message`: if the user edited the prompt during the hook window,
    // `committed` holds the edited content the renderer still shows, and the retry
    // re-runs the UserPromptSubmit hook on it — so restoring `committed` keeps main's
    // queue in sync with the renderer and never loses the edit (there is no policy
    // concern because the restored prompt is re-validated before it is persisted).
    let consumed = false;
    try {
      await persistAndAnnounceQueuedSteeringMessage(port, message);
      consumed = true;
      result = await port.runFollowUpTurn(message, token);

      // Complete this queued prompt's turn lifecycle: run its Stop hook and reset
      // the turn-scoped hook buffers so the next queued prompt does not inherit
      // this prompt's accumulated hook context. Matches how a standalone turn ends.
      await port.runStopHook(token);
      port.clearTurnHookBuffers();
    } catch (error) {
      if (!consumed) {
        port.restoreQueuedSteeringMessageToFront(committed);
      }
      throw error;
    }
  }
}
