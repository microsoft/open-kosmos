/**
 * SubAgentAutoWake — Handles auto-waking parent sessions when background
 * sub-agent results become available. Extracted from AgentChatManager to
 * reduce file size.
 */

import { MessageHelper, UserMessage } from '@shared/types/chatTypes';
import { peekPendingDeliveries } from '../subAgent/subAgentDeliveryLedger';
import type { AgentChat } from './agentChat';

export interface AutoWakeHost {
  getSessionInstance(sessionId: string): AgentChat | undefined;
  reattachEventSender(instance: AgentChat): void;
  log(msg: string, method?: string, meta?: Record<string, unknown>): void;
}

/**
 * Manages the auto-wake lifecycle: listens for sub-agent completions,
 * debounces, and triggers parent turns.
 */
export class SubAgentAutoWakeController {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWakes = new Set<string>();
  private listenerSetup = false;
  private recoveryAttempted = new Set<string>();

  constructor(private host: AutoWakeHost) {}

  setup(): void {
    if (this.listenerSetup) return;
    this.listenerSetup = true;

    import('../subAgent/subAgentManager').then(({ SubAgentManager }) => {
      SubAgentManager.getInstance().on('subAgentResultReady', ({ parentSessionId }: { parentSessionId: string }) => {
        this.handleResultReady(parentSessionId);
      });
      this.host.log('[SubAgentAutoWake] Listener registered');
    }).catch(() => { /* non-fatal */ });
  }

  /**
   * Proactively recover durable ledger results for a session that is being
   * activated (e.g. reopened after an app restart). The in-memory
   * `subAgentResultReady` event does not survive a restart, so without this a
   * persisted result would sit undelivered until the user's next message to
   * that session drains the ledger. The first time a session is activated this
   * app run we peek the durable ledger and, if it holds pending results,
   * schedule the same debounced auto-wake used for live completions — which
   * injects the result on the next idle turn. Subsequent activations are
   * skipped so live event-driven delivery is never duplicated.
   */
  recoverPendingForSession(sessionId: string): void {
    if (this.recoveryAttempted.has(sessionId)) return;

    let hasPending = false;
    try {
      hasPending = peekPendingDeliveries(sessionId).length > 0;
    } catch {
      return;
    }
    if (!hasPending) return;

    // Consume the one-shot recovery guard only once we actually find a pending
    // result to recover. A session activated with an empty ledger may still
    // receive a result later this run (e.g. one dropped by a busy parent that
    // never retried before the user navigated away); leaving the guard unset
    // lets a later activation recover it instead of being permanently skipped.
    this.recoveryAttempted.add(sessionId);

    this.host.log('[SubAgentAutoWake] Recovering persisted results for session', 'recoverPendingForSession', { sessionId });
    this.handleResultReady(sessionId);
  }

  private handleResultReady(sessionId: string): void {
    const existing = this.debounceTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(sessionId, setTimeout(() => {
      this.debounceTimers.delete(sessionId);
      this.trigger(sessionId);
    }, 500));
  }

  private trigger(sessionId: string): void {
    if (this.pendingWakes.has(sessionId)) return;

    const instance = this.host.getSessionInstance(sessionId);
    if (!instance) return;

    if (instance.getChatStatus() !== 'idle') {
      // Parent is mid-turn. A result that completed during the turn must not be
      // silently dropped (which would strand it until the user's next message);
      // re-arm the debounce so the wake retries once the parent goes idle. Bound
      // the retry to the durable ledger still holding an undelivered result so
      // it self-terminates: as soon as the result is drained by any turn (and
      // the ledger acked), or the instance goes away, the retry stops. While a
      // disposed/unknown instance returns above without re-arming, ending the
      // loop.
      let stillPending = false;
      try {
        stillPending = peekPendingDeliveries(sessionId).length > 0;
      } catch {
        stillPending = false;
      }
      if (stillPending) this.handleResultReady(sessionId);
      return;
    }

    this.pendingWakes.add(sessionId);

    const msg: UserMessage = MessageHelper.createTextMessage(
      '<task-notification-trigger/>',
      'user',
    ) as UserMessage;
    (msg as any).metadata = { synthetic: true };

    this.host.log('[SubAgentAutoWake] Triggering parent turn', 'trigger', { sessionId });

    this.host.reattachEventSender(instance);

    instance.streamMessage(msg, undefined, undefined, {
      emitUserMessage: false,
      persistUserMessage: false,
      interactionPolicy: 'forbid',
    })
      .finally(() => { this.pendingWakes.delete(sessionId); });
  }
}
