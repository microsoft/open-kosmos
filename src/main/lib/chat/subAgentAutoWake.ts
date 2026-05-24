/**
 * SubAgentAutoWake — Handles auto-waking parent sessions when background
 * sub-agent results become available. Extracted from AgentChatManager to
 * reduce file size.
 */

import { MessageHelper, UserMessage } from '@shared/types/chatTypes';
import type { AgentChat } from './agentChat';

export interface AutoWakeHost {
  getSessionInstance(sessionId: string): AgentChat | undefined;
  reattachEventSender(instance: AgentChat): void;
  log(msg: string, method?: string, meta?: Record<string, unknown>): void;
  isFeatureEnabled(flag: string): boolean;
}

/**
 * Manages the auto-wake lifecycle: listens for sub-agent completions,
 * debounces, and triggers parent turns.
 */
export class SubAgentAutoWakeController {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWakes = new Set<string>();
  private listenerSetup = false;

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

  private handleResultReady(sessionId: string): void {
    if (!this.host.isFeatureEnabled('openkosmosFeatureSubAgentAutoWake')) return;

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
    if (!instance || instance.getChatStatus() !== 'idle') return;

    this.pendingWakes.add(sessionId);

    const msg: UserMessage = MessageHelper.createTextMessage(
      '<task-notification-trigger/>',
      'user',
    ) as UserMessage;
    (msg as any).metadata = { synthetic: true };

    this.host.log('[SubAgentAutoWake] Triggering parent turn', 'trigger', { sessionId });

    this.host.reattachEventSender(instance);

    instance.streamMessage(msg, undefined, undefined, { emitUserMessage: false })
      .finally(() => { this.pendingWakes.delete(sessionId); });
  }
}
