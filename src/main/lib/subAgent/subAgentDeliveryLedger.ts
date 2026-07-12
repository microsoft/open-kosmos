/**
 * SubAgentDeliveryLedger — durable outbox for background sub-agent results.
 *
 * Background sub-agent results are normally delivered to the parent chat
 * session through an in-memory result queue (drained when the parent's next
 * turn runs, e.g. via auto-wake). If the app exits before a result is drained,
 * that in-memory queue is lost and the result is never delivered.
 *
 * This ledger persists pending background results to disk, keyed by parent
 * session id, so they can be recovered and delivered after an app restart.
 * Entries are PEEKED (not removed) when the parent drains them, and only acked
 * once the parent has woken and made forward progress past that delivery — so a
 * crash in the drain->inject window re-delivers rather than silently dropping a
 * completed result (at-least-once delivery).
 *
 * Storage: {userData}/sub-agent-pending-results.json
 * Shape:   { [parentSessionId]: SubAgentTaskResult[] }
 *
 * The ledger is intentionally global (not per-profile) so it can be drained
 * using only a parentSessionId — the result payload is self-contained and the
 * durable per-profile task record still lives in SubAgentTaskStore.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { SubAgentTaskResult } from '../userDataADO/types/profile';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

type LedgerData = Record<string, SubAgentTaskResult[]>;

function getLedgerPath(): string {
  return path.join(app.getPath('userData'), 'sub-agent-pending-results.json');
}

function readLedger(): LedgerData {
  const filePath = getLedgerPath();
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Defensively drop any session entry whose value is not an array, so a
      // partially-corrupted ledger can never make record/drain throw (which
      // would otherwise suppress delivery). Dropped entries self-heal on the
      // next write.
      const sanitized: LedgerData = {};
      for (const [sessionId, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) {
          sanitized[sessionId] = value as SubAgentTaskResult[];
        }
      }
      return sanitized;
    }
    return {};
  } catch (err) {
    logger.warn('[SubAgentDeliveryLedger] Failed to read ledger, treating as empty', 'readLedger', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

function writeLedger(data: LedgerData): void {
  const filePath = getLedgerPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic write: write to a temp file then rename into place.
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    logger.error('[SubAgentDeliveryLedger] Failed to write ledger', 'writeLedger', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Persist a background sub-agent result as pending delivery for its parent
 * session. De-duplicates by taskId — re-recording the same taskId overwrites
 * the previous entry rather than appending a duplicate.
 */
export function recordPendingDelivery(parentSessionId: string, result: SubAgentTaskResult): void {
  const data = readLedger();
  const list = data[parentSessionId] ?? [];
  const existingIndex = list.findIndex((r) => r.taskId === result.taskId);
  if (existingIndex >= 0) {
    list[existingIndex] = result;
  } else {
    list.push(result);
  }
  data[parentSessionId] = list;
  writeLedger(data);
}

/**
 * Return (without removing) all pending results for a parent session. Returns a
 * shallow copy so callers cannot mutate the ledger's in-memory state, and an
 * empty array when there are none. Peeked entries MUST be acked with
 * ackPendingDeliveries once the parent has made forward progress past the
 * delivery, otherwise they are returned again on the next peek.
 */
export function peekPendingDeliveries(parentSessionId: string): SubAgentTaskResult[] {
  const data = readLedger();
  const list = data[parentSessionId];
  return list ? [...list] : [];
}

/**
 * Acknowledge (remove) the given taskIds from a parent session's pending
 * deliveries. Called only AFTER the results have been delivered and the parent
 * has made forward progress, so a result is never deleted before it is
 * confirmed delivered. An empty taskId list or a session with no pending
 * entries is a no-op.
 */
export function ackPendingDeliveries(parentSessionId: string, taskIds: string[]): void {
  if (taskIds.length === 0) return;
  const data = readLedger();
  const list = data[parentSessionId];
  if (!list) return;
  const ackSet = new Set(taskIds);
  const remaining = list.filter((r) => !ackSet.has(r.taskId));
  if (remaining.length === 0) {
    delete data[parentSessionId];
  } else {
    data[parentSessionId] = remaining;
  }
  writeLedger(data);
}
