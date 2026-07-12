/**
 * memexEvents — process-local event bus decoupling the memex write path from the
 * IPC layer. The `memex_memory` tool and Settings profile-memory management emit
 * `cardsChanged` after mutations; the memex IPC module forwards scoped
 * `memex:cardsChanged` payloads to the renderer.
 *
 * Kept tiny and dependency-free so both the tool (main/lib) and the IPC wiring
 * (main/startup) can import it without coupling to each other.
 */

import { EventEmitter } from 'node:events';
import type { MemexMemoryScope } from '@shared/types/memexTypes';

export interface MemexCardsChangedPayload {
  /** Profile alias that owns the changed memory. */
  userAlias: string;
  /** Memory scope whose cards changed. Defaults to current-agent for legacy callers. */
  scope?: MemexMemoryScope;
  /** Stable agent id whose memory changed. Required for current-agent changes. */
  agentId?: string;
  /** Originating chat id, used as a fallback when fan-out cannot resolve chats. */
  chatId?: string;
}

export const MEMEX_CARDS_CHANGED = 'cardsChanged';

class MemexEventBus extends EventEmitter {}

export const memexEvents = new MemexEventBus();

/** Notify subscribers that the given memory scope's card set changed. */
export function emitCardsChanged(payload: MemexCardsChangedPayload): void {
  if (!payload.userAlias) return;
  const scope = payload.scope ?? 'current-agent';
  if (scope === 'current-agent' && !payload.agentId) return;
  memexEvents.emit(MEMEX_CARDS_CHANGED, { ...payload, scope });
}
