/**
 * Tests for subAgentDeliveryLedger — exercises the real on-disk ledger using
 * temporary directories (no fs mocks), covering every branch including the
 * read/write error fallbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const holder = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => holder.dir },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { recordPendingDelivery, peekPendingDeliveries, ackPendingDeliveries } from '../subAgentDeliveryLedger';

const LEDGER_FILE = 'sub-agent-pending-results.json';

function makeResult(taskId: string, extra: Record<string, unknown> = {}) {
  return { subAgentName: 'agent', taskId, success: true, turnCount: 1, durationMs: 1, ...extra } as any;
}

function ledgerPath(): string {
  return path.join(holder.dir, LEDGER_FILE);
}

describe('subAgentDeliveryLedger', () => {
  let baseTmp: string;

  beforeEach(() => {
    baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ledger-'));
    holder.dir = baseTmp;
  });

  afterEach(() => {
    fs.rmSync(baseTmp, { recursive: true, force: true });
  });

  it('peekPendingDeliveries returns [] when no ledger file exists', () => {
    expect(peekPendingDeliveries('sessNone')).toEqual([]);
  });

  it('records a result and peeks it without removing it', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
    // Peek does not remove — a second peek still sees it.
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('peek returns a copy that cannot mutate the ledger', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    const peeked = peekPendingDeliveries('sessA');
    peeked.push(makeResult('injected'));
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('ack removes a delivered entry so the next peek is empty', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    ackPendingDeliveries('sessA', ['t1']);
    expect(peekPendingDeliveries('sessA')).toEqual([]);
  });

  it('appends multiple distinct taskIds for the same session', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    recordPendingDelivery('sessA', makeResult('t2'));
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId).sort()).toEqual(['t1', 't2']);
  });

  it('acks only the given taskIds, leaving the rest pending', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    recordPendingDelivery('sessA', makeResult('t2'));
    ackPendingDeliveries('sessA', ['t1']);
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t2']);
  });

  it('ack of an unknown taskId leaves existing entries untouched', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    ackPendingDeliveries('sessA', ['nope']);
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('ack is a no-op when the taskId list is empty', () => {
    recordPendingDelivery('sessA', makeResult('t1'));
    ackPendingDeliveries('sessA', []);
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('ack is a no-op for a session with no pending entries', () => {
    expect(() => ackPendingDeliveries('sessNone', ['x'])).not.toThrow();
    expect(peekPendingDeliveries('sessNone')).toEqual([]);
  });

  it('de-duplicates by taskId, overwriting the previous entry', () => {
    recordPendingDelivery('sessA', makeResult('t1', { result: 'old' }));
    recordPendingDelivery('sessA', makeResult('t1', { result: 'new' }));
    const peeked = peekPendingDeliveries('sessA');
    expect(peeked).toHaveLength(1);
    expect(peeked[0].result).toBe('new');
  });

  it('keeps sessions isolated when acking', () => {
    recordPendingDelivery('sessA', makeResult('a1'));
    recordPendingDelivery('sessB', makeResult('b1'));
    ackPendingDeliveries('sessA', ['a1']);
    expect(peekPendingDeliveries('sessA')).toEqual([]);
    // sessB is untouched by acking sessA.
    expect(peekPendingDeliveries('sessB').map((r) => r.taskId)).toEqual(['b1']);
  });

  it('treats an invalid-JSON ledger file as empty (read fallback)', () => {
    fs.writeFileSync(ledgerPath(), 'this is not json{', 'utf-8');
    expect(peekPendingDeliveries('sessA')).toEqual([]);
  });

  it('treats a JSON array ledger as empty (non-object guard)', () => {
    fs.writeFileSync(ledgerPath(), '[]', 'utf-8');
    expect(peekPendingDeliveries('sessA')).toEqual([]);
  });

  it('treats a null ledger as empty (falsy guard)', () => {
    fs.writeFileSync(ledgerPath(), 'null', 'utf-8');
    expect(peekPendingDeliveries('sessA')).toEqual([]);
  });

  it('treats a non-object JSON ledger as empty (typeof guard)', () => {
    fs.writeFileSync(ledgerPath(), '42', 'utf-8');
    expect(peekPendingDeliveries('sessA')).toEqual([]);
  });

  it('returns [] for an explicitly empty session list', () => {
    fs.writeFileSync(ledgerPath(), JSON.stringify({ sessEmpty: [] }), 'utf-8');
    expect(peekPendingDeliveries('sessEmpty')).toEqual([]);
  });

  it('drops a corrupted (non-array) session entry and peeks empty without throwing', () => {
    fs.writeFileSync(ledgerPath(), JSON.stringify({ sessBad: { not: 'an array' } }), 'utf-8');
    expect(() => peekPendingDeliveries('sessBad')).not.toThrow();
    expect(peekPendingDeliveries('sessBad')).toEqual([]);
  });

  it('self-heals a corrupted session entry on the next record', () => {
    fs.writeFileSync(ledgerPath(), JSON.stringify({ sessBad: 42 }), 'utf-8');
    expect(() => recordPendingDelivery('sessBad', makeResult('t1'))).not.toThrow();
    expect(peekPendingDeliveries('sessBad').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('preserves valid session lists while dropping corrupted ones', () => {
    fs.writeFileSync(
      ledgerPath(),
      JSON.stringify({ good: [makeResult('g1')], bad: 'corrupt' }),
      'utf-8',
    );
    expect(peekPendingDeliveries('good').map((r) => r.taskId)).toEqual(['g1']);
    expect(peekPendingDeliveries('bad')).toEqual([]);
  });

  it('creates the ledger directory when it does not yet exist', () => {
    holder.dir = path.join(baseTmp, 'nested', 'does', 'not', 'exist');
    recordPendingDelivery('sessA', makeResult('t1'));
    expect(fs.existsSync(path.join(holder.dir, LEDGER_FILE))).toBe(true);
    expect(peekPendingDeliveries('sessA').map((r) => r.taskId)).toEqual(['t1']);
  });

  it('does not throw when the ledger cannot be written (write fallback)', () => {
    // Point userData at a regular file so writing under it fails (ENOTDIR).
    const asFile = path.join(baseTmp, 'iam-a-file');
    fs.writeFileSync(asFile, 'x', 'utf-8');
    holder.dir = asFile;
    expect(() => recordPendingDelivery('sessA', makeResult('t1'))).not.toThrow();
  });
});
