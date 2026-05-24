import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheLogManager } from '../CacheLogManager';
import { PendingLogQueue } from '../PendingLogQueue';
import { UnifiedLoggerConfig } from '../types';
import { createLogEntry } from '../types';

const TEST_CONFIG: UnifiedLoggerConfig = {
  LOGGER_CACHE_MAX_SIZE: 3,
  LOGGER_DIRECTORY: '/tmp/test-logs',
  LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  LOGGER_ENABLE_CONSOLE: false,
};

describe('CacheLogManager', () => {
  beforeEach(() => {
    CacheLogManager.resetInstance();
  });

  afterEach(() => {
    CacheLogManager.resetInstance();
  });

  it('getInstance throws without config on first call', () => {
    expect(() => CacheLogManager.getInstance()).toThrow();
  });

  it('getInstance creates singleton', () => {
    const q = new PendingLogQueue();
    const m1 = CacheLogManager.getInstance(TEST_CONFIG, q);
    const m2 = CacheLogManager.getInstance();
    expect(m1).toBe(m2);
  });

  it('isInitialized returns false before init, true after', () => {
    expect(CacheLogManager.isInitialized()).toBe(false);
    const q = new PendingLogQueue();
    CacheLogManager.getInstance(TEST_CONFIG, q);
    expect(CacheLogManager.isInitialized()).toBe(true);
  });

  it('notifyNewLogAdded processes entries from pending queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    q.enqueue(createLogEntry('INFO', 'msg1', 'src'));
    mgr.notifyNewLogAdded();
    expect(mgr.getCurrentCacheObjectInfo().currentSize).toBe(1);
  });

  it('cache fills up and moves to pending save queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    for (let i = 0; i < 3; i++) {
      q.enqueue(createLogEntry('INFO', `msg-${i}`, 'src'));
    }
    mgr.notifyNewLogAdded();
    // Cache was full, should have been pushed to save queue and new empty cache created
    expect(saveMgr.notifyPendingSaveAvailable).toHaveBeenCalled();
    expect(mgr.getCurrentCacheObjectInfo().currentSize).toBe(0);
    expect(mgr.getStats().pendingSaveQueueSize).toBe(1);
  });

  it('forceFlush pushes non-empty cache to save queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    q.enqueue(createLogEntry('INFO', 'msg', 'src'));
    mgr.notifyNewLogAdded();
    mgr.forceFlush();

    expect(saveMgr.notifyPendingSaveAvailable).toHaveBeenCalled();
    expect(mgr.getCurrentCacheObjectInfo().currentSize).toBe(0);
  });

  it('forceFlush with notifySaveManager=false does not notify', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    q.enqueue(createLogEntry('INFO', 'msg', 'src'));
    mgr.notifyNewLogAdded();
    mgr.forceFlush(false);

    expect(saveMgr.notifyPendingSaveAvailable).not.toHaveBeenCalled();
  });

  it('forceFlush on empty cache does nothing', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    mgr.forceFlush();
    expect(saveMgr.notifyPendingSaveAvailable).not.toHaveBeenCalled();
  });

  it('getStats returns all fields', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const stats = mgr.getStats();
    expect(stats).toHaveProperty('currentCacheObjectSize');
    expect(stats).toHaveProperty('currentCacheObjectCapacity');
    expect(stats).toHaveProperty('currentCacheObjectUtilization');
    expect(stats).toHaveProperty('pendingSaveQueueSize');
    expect(stats).toHaveProperty('pendingSaveQueueStats');
    expect(stats).toHaveProperty('totalCachedObjects');
    expect(stats).toHaveProperty('maxCapacity');
  });

  it('getStats totalCachedObjects counts non-empty current cache', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    q.enqueue(createLogEntry('INFO', 'x', 'src'));
    mgr.notifyNewLogAdded();
    const stats = mgr.getStats();
    expect(stats.totalCachedObjects).toBe(1); // current non-empty cache
  });

  it('updateConfig with new max size moves existing logs to save queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    q.enqueue(createLogEntry('INFO', 'x', 'src'));
    mgr.notifyNewLogAdded();

    mgr.updateConfig({ LOGGER_CACHE_MAX_SIZE: 10 });
    expect(saveMgr.notifyPendingSaveAvailable).toHaveBeenCalled();
    expect(mgr.getStats().maxCapacity).toBe(10);
  });

  it('updateConfig with same max size does not re-create cache', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    mgr.updateConfig({ LOGGER_CACHE_MAX_SIZE: 3 });
    expect(saveMgr.notifyPendingSaveAvailable).not.toHaveBeenCalled();
  });

  it('updateConfig without max size just updates config', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    mgr.updateConfig({ LOGGER_ENABLE_CONSOLE: false });
    expect(mgr.getConfig().LOGGER_ENABLE_CONSOLE).toBe(false);
  });

  it('getConfig returns copy', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const config = mgr.getConfig();
    expect(config.LOGGER_CACHE_MAX_SIZE).toBe(3);
  });

  it('clearAllCaches empties current cache and save queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    q.enqueue(createLogEntry('INFO', 'x', 'src'));
    mgr.notifyNewLogAdded();
    mgr.clearAllCaches();
    expect(mgr.getCurrentCacheObjectInfo().currentSize).toBe(0);
    expect(mgr.getStats().pendingSaveQueueSize).toBe(0);
  });

  it('getPendingSaveQueueInfo returns detailed info', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const info = mgr.getPendingSaveQueueInfo();
    expect(info).toHaveProperty('size');
    expect(info).toHaveProperty('isEmpty');
  });

  it('validateIntegrity passes for valid manager', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(true);
  });

  it('getDetailedInfo returns all sections', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const info = mgr.getDetailedInfo();
    expect(info).toHaveProperty('currentCacheObject');
    expect(info).toHaveProperty('pendingSaveQueue');
    expect(info).toHaveProperty('stats');
    expect(info).toHaveProperty('validation');
  });

  it('getPendingSaveQueue returns the queue', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    const psq = mgr.getPendingSaveQueue();
    expect(psq).toBeDefined();
  });

  it('notifyNewLogAdded handles addLog returning false (re-enqueue)', () => {
    // Make a tiny cache of size 1
    const config = { ...TEST_CONFIG, LOGGER_CACHE_MAX_SIZE: 1 };
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(config, q);
    const saveMgr = { notifyPendingSaveAvailable: vi.fn() };
    mgr.setSaveLogManager(saveMgr);

    // Fill the cache first via direct addLog
    const currentCache = (mgr as any).currentCacheObject;
    currentCache.addLog(createLogEntry('INFO', 'fill', 'src'));
    // Now it's full. Enqueue another entry.
    q.enqueue(createLogEntry('INFO', 'queued', 'src'));
    // notifyNewLogAdded should detect full, move to save queue, then continue
    mgr.notifyNewLogAdded();
    expect(saveMgr.notifyPendingSaveAvailable).toHaveBeenCalled();
  });

  it('validateIntegrity reports error when currentCacheObject has invalid state', () => {
    const q = new PendingLogQueue();
    const mgr = CacheLogManager.getInstance(TEST_CONFIG, q);
    // Corrupt the current cache: set maxCapacity <= 0
    (mgr as any).currentCacheObject.maxCapacity = -1;
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Current cache object validation failed'))).toBe(true);
  });
});
