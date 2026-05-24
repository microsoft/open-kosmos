import { describe, it, expect, beforeEach } from 'vitest';
import { CacheObject } from '../CacheObject';
import { createLogEntry } from '../types';

function makeEntry(msg = 'test') {
  return createLogEntry('INFO', msg, 'test');
}

describe('CacheObject', () => {
  let cache: CacheObject;

  beforeEach(() => {
    cache = new CacheObject(3);
  });

  it('starts empty and not full', () => {
    expect(cache.isEmpty()).toBe(true);
    expect(cache.isFull()).toBe(false);
    expect(cache.getLength()).toBe(0);
  });

  it('addLog returns true and increments length', () => {
    const result = cache.addLog(makeEntry('a'));
    expect(result).toBe(true);
    expect(cache.getLength()).toBe(1);
    expect(cache.isEmpty()).toBe(false);
  });

  it('addLog returns false when full', () => {
    cache.addLog(makeEntry('a'));
    cache.addLog(makeEntry('b'));
    cache.addLog(makeEntry('c'));
    expect(cache.isFull()).toBe(true);
    const result = cache.addLog(makeEntry('d'));
    expect(result).toBe(false);
    expect(cache.getLength()).toBe(3);
  });

  it('clear empties the cache', () => {
    cache.addLog(makeEntry());
    cache.clear();
    expect(cache.isEmpty()).toBe(true);
  });

  it('getStats returns correct statistics', () => {
    cache.addLog(makeEntry('x'));
    const stats = cache.getStats();
    expect(stats.currentSize).toBe(1);
    expect(stats.maxCapacity).toBe(3);
    expect(stats.utilization).toBeCloseTo(33.33, 1);
    expect(stats.isEmpty).toBe(false);
    expect(stats.isFull).toBe(false);
    expect(stats.id).toBeTruthy();
    expect(stats.createdAt).toBeInstanceOf(Date);
    expect(stats.lastUpdated).toBeInstanceOf(Date);
  });

  it('getStats reports full correctly', () => {
    cache.addLog(makeEntry());
    cache.addLog(makeEntry());
    cache.addLog(makeEntry());
    const stats = cache.getStats();
    expect(stats.isFull).toBe(true);
    expect(stats.utilization).toBe(100);
  });

  it('getLogsByTimeRange filters correctly', () => {
    const e1 = createLogEntry('INFO', 'old', 'src');
    const e2 = createLogEntry('INFO', 'new', 'src');
    // Set timestamps
    e1.timestamp = new Date(1000);
    e2.timestamp = new Date(3000);
    cache.addLog(e1);
    cache.addLog(e2);

    const result = cache.getLogsByTimeRange(new Date(500), new Date(2000));
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('old');
  });

  it('getLogsByLevels filters correctly', () => {
    const e1 = createLogEntry('INFO', 'info msg', 'src');
    const e2 = createLogEntry('WARN', 'warn msg', 'src');
    cache.addLog(e1);
    cache.addLog(e2);

    const result = cache.getLogsByLevels(['WARN']);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('WARN');
  });

  it('clone creates a deep copy', () => {
    cache.addLog(makeEntry('original'));
    const cloned = cache.clone();

    expect(cloned.id).toBe(cache.id + '_clone');
    expect(cloned.getLength()).toBe(1);
    expect(cloned.logs[0].message).toBe('original');
    // Modify original should not affect clone
    cache.clear();
    expect(cloned.getLength()).toBe(1);
  });

  it('validateIntegrity passes for valid cache', () => {
    cache.addLog(makeEntry());
    const result = cache.validateIntegrity();
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateIntegrity detects invalid capacity', () => {
    const badCache = new CacheObject(-1);
    const result = badCache.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('capacity'))).toBe(true);
  });

  it('validateIntegrity detects lastUpdated before createdAt', () => {
    cache.createdAt = new Date(5000);
    cache.lastUpdated = new Date(1000);
    const result = cache.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Last updated'))).toBe(true);
  });

  it('validateIntegrity detects missing log fields', () => {
    cache.logs.push({ id: '', level: 'INFO', message: 'x', timestamp: new Date() });
    const result = cache.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('missing required fields'))).toBe(true);
  });

  it('validateIntegrity detects missing id', () => {
    cache.id = '';
    const result = cache.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('ID is missing'))).toBe(true);
  });

  it('validateIntegrity detects missing timestamps', () => {
    (cache as any).createdAt = null;
    const result = cache.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Timestamp'))).toBe(true);
  });
});
