/**
 * Action audit trail (in-memory + log).
 *
 * Every dispatched Computer Use action appends an entry here for observability
 * and post-hoc review. Kept deliberately small and side-effect-light: it logs
 * through the unified logger and retains a bounded in-memory ring so a long
 * session cannot grow unbounded.
 */

import { createLogger } from '../unifiedLogger';
import type { AuditEntry } from './types';

const logger = createLogger();

/** Upper bound on retained entries; oldest are dropped first. */
const MAX_ENTRIES = 500;

export class ActionAudit {
  private entries: AuditEntry[] = [];

  /** Record an action. `ts` defaults to now. Returns the stored entry. */
  record(entry: Omit<AuditEntry, 'ts'> & { ts?: number }): AuditEntry {
    const stored: AuditEntry = {
      chatSessionId: entry.chatSessionId,
      action: entry.action,
      target: entry.target,
      confirmed: entry.confirmed,
      ts: entry.ts ?? Date.now(),
    };
    this.entries.push(stored);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
    logger.info(
      `[ComputerUse] action=${stored.action} target=${stored.target ?? '-'} ` +
        `confirmed=${stored.confirmed} session=${stored.chatSessionId ?? '-'}`,
    );
    return stored;
  }

  /** List recorded entries, optionally filtered by chat session. */
  list(chatSessionId?: string): AuditEntry[] {
    if (chatSessionId === undefined) {
      return [...this.entries];
    }
    return this.entries.filter((e) => e.chatSessionId === chatSessionId);
  }

  /** Clear entries; with a session id clears only that session's entries. */
  clear(chatSessionId?: string): void {
    if (chatSessionId === undefined) {
      this.entries = [];
      return;
    }
    this.entries = this.entries.filter((e) => e.chatSessionId !== chatSessionId);
  }
}

let singleton: ActionAudit | null = null;

/** Process-wide audit instance. */
export function getActionAudit(): ActionAudit {
  if (!singleton) {
    singleton = new ActionAudit();
  }
  return singleton;
}
