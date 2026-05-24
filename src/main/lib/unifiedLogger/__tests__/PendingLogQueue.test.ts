import { describe, it, expect, beforeEach } from 'vitest';
import { PendingLogQueue } from '../PendingLogQueue';
import { createLogEntry } from '../types';

function makeEntry(msg = 'test', level: any = 'INFO') {
  return createLogEntry(level, msg, 'src');
}

describe('PendingLogQueue', () => {
  let queue: PendingLogQueue;

  beforeEach(() => {
    queue = new PendingLogQueue();
  });

  it('starts empty', () => {
    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
    expect(queue.peek()).toBeNull();
    expect(queue.dequeue()).toBeNull();
  });

  it('enqueue and dequeue FIFO', () => {
    const e1 = makeEntry('first');
    const e2 = makeEntry('second');
    queue.enqueue(e1);
    queue.enqueue(e2);
    expect(queue.size()).toBe(2);
    expect(queue.peek()!.message).toBe('first');
    expect(queue.dequeue()!.message).toBe('first');
    expect(queue.dequeue()!.message).toBe('second');
    expect(queue.isEmpty()).toBe(true);
  });

  it('clear empties the queue', () => {
    queue.enqueue(makeEntry());
    queue.clear();
    expect(queue.isEmpty()).toBe(true);
  });

  it('getStats returns correct stats with entries', () => {
    const e1 = makeEntry('a');
    const e2 = makeEntry('b');
    e1.timestamp = new Date(1000);
    e2.timestamp = new Date(3000);
    queue.enqueue(e1);
    queue.enqueue(e2);
    const stats = queue.getStats();
    expect(stats.size).toBe(2);
    expect(stats.isEmpty).toBe(false);
    expect(stats.oldestEntry).toBeDefined();
    expect(stats.newestEntry).toBeDefined();
    expect(stats.memoryUsage).toBeGreaterThan(0);
  });

  it('getStats with empty queue returns no timestamps', () => {
    const stats = queue.getStats();
    expect(stats.size).toBe(0);
    expect(stats.isEmpty).toBe(true);
    expect(stats.memoryUsage).toBe(0);
    expect((stats as any).oldestEntry).toBeUndefined();
  });

  it('getLogsByTimeRange filters', () => {
    const e1 = makeEntry('old');
    e1.timestamp = new Date(1000);
    const e2 = makeEntry('new');
    e2.timestamp = new Date(5000);
    queue.enqueue(e1);
    queue.enqueue(e2);

    const results = queue.getLogsByTimeRange(new Date(500), new Date(2000));
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe('old');
  });

  it('getLogsByLevels filters', () => {
    queue.enqueue(makeEntry('info msg', 'INFO'));
    queue.enqueue(makeEntry('warn msg', 'WARN'));
    const results = queue.getLogsByLevels(['WARN']);
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe('WARN');
  });

  it('dequeueBatch dequeues correct count', () => {
    queue.enqueue(makeEntry('a'));
    queue.enqueue(makeEntry('b'));
    queue.enqueue(makeEntry('c'));

    const batch = queue.dequeueBatch(2);
    expect(batch).toHaveLength(2);
    expect(queue.size()).toBe(1);
  });

  it('dequeueBatch with count <= 0 returns empty', () => {
    queue.enqueue(makeEntry());
    expect(queue.dequeueBatch(0)).toEqual([]);
    expect(queue.dequeueBatch(-1)).toEqual([]);
  });

  it('dequeueBatch capped at queue size', () => {
    queue.enqueue(makeEntry('a'));
    const batch = queue.dequeueBatch(100);
    expect(batch).toHaveLength(1);
    expect(queue.isEmpty()).toBe(true);
  });

  it('enqueueBatch adds multiple entries', () => {
    queue.enqueueBatch([makeEntry('a'), makeEntry('b')]);
    expect(queue.size()).toBe(2);
  });

  it('validateIntegrity passes for valid queue', () => {
    queue.enqueue(makeEntry());
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(true);
  });

  it('validateIntegrity detects null entry', () => {
    (queue as any).queue.push(null);
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('null or undefined'))).toBe(true);
  });

  it('validateIntegrity detects missing id', () => {
    const e = makeEntry();
    e.id = '';
    (queue as any).queue.push(e);
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid or missing ID'))).toBe(true);
  });

  it('validateIntegrity detects missing level', () => {
    const e = makeEntry();
    (e as any).level = '';
    (queue as any).queue.push(e);
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid or missing level'))).toBe(true);
  });

  it('validateIntegrity detects missing message', () => {
    const e = makeEntry();
    (e as any).message = '';
    (queue as any).queue.push(e);
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid or missing message'))).toBe(true);
  });

  it('validateIntegrity detects invalid timestamp', () => {
    const e = makeEntry();
    (e as any).timestamp = 'not-a-date';
    (queue as any).queue.push(e);
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid or missing timestamp'))).toBe(true);
  });

  it('getDetailedInfo truncates long messages', () => {
    const e = makeEntry('x'.repeat(200));
    queue.enqueue(e);
    const info = queue.getDetailedInfo();
    expect(info.entries[0].message.endsWith('...')).toBe(true);
  });

  it('getDetailedInfo with short message', () => {
    queue.enqueue(makeEntry('short'));
    const info = queue.getDetailedInfo();
    expect(info.entries[0].message).toBe('short');
  });
});
