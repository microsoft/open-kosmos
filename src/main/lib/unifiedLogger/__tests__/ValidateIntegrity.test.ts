import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheLogManager } from '../CacheLogManager';
import { LogEntryManager } from '../LogEntryManager';
import { SaveLogManager } from '../SaveLogManager';
import { PendingLogQueue } from '../PendingLogQueue';
import { PendingSaveQueue } from '../PendingSaveQueue';
import { UnifiedLoggerConfig, createLogEntry } from '../types';

const TEST_CONFIG: UnifiedLoggerConfig = {
  LOGGER_CACHE_MAX_SIZE: 3,
  LOGGER_DIRECTORY: '/tmp/test-logs',
  LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  LOGGER_ENABLE_CONSOLE: false,
};

describe('validateIntegrity defensive branches', () => {
  beforeEach(() => {
    CacheLogManager.resetInstance();
    LogEntryManager.resetInstance();
    SaveLogManager.resetInstance();
  });

  afterEach(() => {
    CacheLogManager.resetInstance();
    LogEntryManager.resetInstance();
    SaveLogManager.resetInstance();
  });

  // CacheLogManager.validateIntegrity error branches
  it('CacheLogManager.validateIntegrity detects invalid max capacity', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    (mgr as any).maxCapacity = -1;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid max capacity'))).toBe(true);
  });

  it('CacheLogManager.validateIntegrity detects missing config', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    (mgr as any).config = null;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Configuration is not set'))).toBe(true);
  });

  it('CacheLogManager.validateIntegrity detects missing pendingLogQueue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    (mgr as any).pendingLogQueue = null;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Pending log queue reference'))).toBe(true);
  });

  it('CacheLogManager.validateIntegrity detects invalid pendingSaveQueue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    // Force the save queue to have an invalid entry that fails validateIntegrity
    const badCache = Object.create(null); // not a CacheObject instance
    badCache.id = 'bad';
    // Push it into the pending save queue's internal array
    const psq = mgr.getPendingSaveQueue();
    (psq as any).queue.push(badCache);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
  });

  // LogEntryManager.validateIntegrity error branches
  it('LogEntryManager.validateIntegrity detects empty LOGGER_LEVELS', () => {
    const config = { ...TEST_CONFIG, LOGGER_LEVELS: [] as any };
    const mgr = LogEntryManager.getInstance(config);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid or empty logger levels'))).toBe(true);
  });

  it('LogEntryManager.validateIntegrity detects non-boolean LOGGER_ENABLE_CONSOLE', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    (mgr as any).config.LOGGER_ENABLE_CONSOLE = 'yes';
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid console enable'))).toBe(true);
  });

  it('LogEntryManager.validateIntegrity detects invalid LOGGER_CACHE_MAX_SIZE', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    (mgr as any).config.LOGGER_CACHE_MAX_SIZE = 0;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid cache max size'))).toBe(true);
  });

  it('LogEntryManager.validateIntegrity detects invalid pending queue', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    // Push a bad entry into the pending queue
    const badEntry = { id: '', level: '', message: '', timestamp: null } as any;
    (mgr as any).pendingLogQueue.enqueue(badEntry);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
  });

  // SaveLogManager.validateIntegrity error branches
  it('SaveLogManager.validateIntegrity detects missing config', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: '/tmp/test-logs' };
    const mgr = SaveLogManager.getInstance(config, q);
    (mgr as any).config = null;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Configuration is not set'))).toBe(true);
  });

  it('SaveLogManager.validateIntegrity detects invalid logDirectory', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: '/tmp/test-logs' };
    const mgr = SaveLogManager.getInstance(config, q);
    (mgr as any).logDirectory = '';
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid log directory'))).toBe(true);
  });

  it('SaveLogManager.validateIntegrity detects missing saveStats', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: '/tmp/test-logs' };
    const mgr = SaveLogManager.getInstance(config, q);
    (mgr as any).saveStats = null;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Save statistics not initialized'))).toBe(true);
  });

  it('SaveLogManager.validateIntegrity detects invalid pendingSaveQueue', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: '/tmp/test-logs' };
    const mgr = SaveLogManager.getInstance(config, q);
    // Make the save queue invalid
    const badCache = Object.create(null);
    badCache.id = 'bad';
    (q as any).queue.push(badCache);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
  });

  // PendingLogQueue.validateIntegrity !Array.isArray branch
  it('PendingLogQueue.validateIntegrity detects non-array queue', () => {
    const queue = new PendingLogQueue();
    (queue as any).queue = 'not an array';
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Queue is not an array'))).toBe(true);
  });

  // PendingSaveQueue.validateIntegrity !Array.isArray branch
  it('PendingSaveQueue.validateIntegrity detects non-array queue', () => {
    const queue = new PendingSaveQueue();
    (queue as any).queue = 'not an array';
    const result = queue.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Queue is not an array'))).toBe(true);
  });
});
