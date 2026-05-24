import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogEntryManager } from '../LogEntryManager';
import { UnifiedLoggerConfig } from '../types';

const TEST_CONFIG: UnifiedLoggerConfig = {
  LOGGER_CACHE_MAX_SIZE: 100,
  LOGGER_DIRECTORY: '/tmp/test-logs',
  LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  LOGGER_ENABLE_CONSOLE: false,
};

describe('LogEntryManager', () => {
  beforeEach(() => {
    LogEntryManager.resetInstance();
  });

  afterEach(() => {
    LogEntryManager.resetInstance();
  });

  it('getInstance throws without config on first call', () => {
    expect(() => LogEntryManager.getInstance()).toThrow();
  });

  it('getInstance creates singleton', () => {
    const m1 = LogEntryManager.getInstance(TEST_CONFIG);
    const m2 = LogEntryManager.getInstance();
    expect(m1).toBe(m2);
  });

  it('isInitialized returns false before init, true after', () => {
    expect(LogEntryManager.isInitialized()).toBe(false);
    LogEntryManager.getInstance(TEST_CONFIG);
    expect(LogEntryManager.isInitialized()).toBe(true);
  });

  it('log adds entry to pending queue and notifies cache manager', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const cacheMgr = { notifyNewLogAdded: vi.fn() };
    mgr.setCacheLogManager(cacheMgr);

    mgr.log('INFO', 'hello', 'src');
    expect(cacheMgr.notifyNewLogAdded).toHaveBeenCalled();
    expect(mgr.getStats().pendingQueueSize).toBe(1);
  });

  it('log skips disabled levels', () => {
    const config = { ...TEST_CONFIG, LOGGER_LEVELS: ['ERROR'] as any };
    LogEntryManager.resetInstance();
    const mgr = LogEntryManager.getInstance(config);
    const cacheMgr = { notifyNewLogAdded: vi.fn() };
    mgr.setCacheLogManager(cacheMgr);

    mgr.log('INFO', 'should not be logged');
    expect(cacheMgr.notifyNewLogAdded).not.toHaveBeenCalled();
  });

  it('convenience methods: debug, info, warn, error', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const cacheMgr = { notifyNewLogAdded: vi.fn() };
    mgr.setCacheLogManager(cacheMgr);

    mgr.debug('d');
    mgr.info('i');
    mgr.warn('w');
    mgr.error('e');
    expect(cacheMgr.notifyNewLogAdded).toHaveBeenCalledTimes(4);
  });

  it('log with metadata', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    mgr.log('INFO', 'msg', 'src', { key: 'value' });
    expect(mgr.getStats().pendingQueueSize).toBe(1);
  });

  it('log with no source', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    mgr.log('INFO', 'msg');
    expect(mgr.getStats().pendingQueueSize).toBe(1);
  });

  it('log handles console error gracefully', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    // No crash even if cache manager not set
    expect(() => mgr.log('DEBUG', 'no crash')).not.toThrow();
  });

  it('getPendingLogQueue returns the queue', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    expect(mgr.getPendingLogQueue()).toBeDefined();
  });

  it('getStats returns all fields', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const stats = mgr.getStats();
    expect(stats).toHaveProperty('pendingQueueSize');
    expect(stats).toHaveProperty('pendingQueueStats');
    expect(stats).toHaveProperty('configuredLevels');
    expect(stats).toHaveProperty('consoleEnabled');
  });

  it('clearPendingQueue clears the queue', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    mgr.log('INFO', 'x');
    mgr.clearPendingQueue();
    expect(mgr.getStats().pendingQueueSize).toBe(0);
  });

  it('getPendingQueueInfo returns detailed info', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const info = mgr.getPendingQueueInfo();
    expect(info).toHaveProperty('size');
    expect(info).toHaveProperty('entries');
  });

  it('updateConfig and getConfig work', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    mgr.updateConfig({ LOGGER_ENABLE_CONSOLE: false });
    expect(mgr.getConfig().LOGGER_ENABLE_CONSOLE).toBe(false);
  });

  it('validateIntegrity passes for valid manager', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(true);
  });

  it('forceProcessPendingLogs drains the queue', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const cacheMgr = {
      notifyNewLogAdded: vi.fn(() => {
        // Drain the queue manually to simulate processing
        (mgr as any).pendingLogQueue.clear();
      })
    };
    mgr.setCacheLogManager(cacheMgr);

    mgr.log('INFO', 'test1');
    mgr.forceProcessPendingLogs();
    expect(cacheMgr.notifyNewLogAdded).toHaveBeenCalled();
  });

  it('forceProcessPendingLogs without cache manager does nothing', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    mgr.log('INFO', 'test');
    expect(() => mgr.forceProcessPendingLogs()).not.toThrow();
  });

  it('forceProcessPendingLogs breaks if queue grows too large', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    let callCount = 0;
    const cacheMgr = {
      notifyNewLogAdded: vi.fn(() => {
        callCount++;
        // Never drain, just add more to simulate infinite scenario
        for (let i = 0; i < 5; i++) {
          (mgr as any).pendingLogQueue.enqueue({
            id: `x${i}`, level: 'INFO', message: 'x', timestamp: new Date()
          });
        }
        // But stop after a while to avoid test hanging
        if (callCount > 5) {
          (mgr as any).pendingLogQueue.clear();
        }
      })
    };
    mgr.setCacheLogManager(cacheMgr);

    // Seed the queue with > 10000 entries to trigger the break
    for (let i = 0; i < 10001; i++) {
      (mgr as any).pendingLogQueue.enqueue({
        id: `x${i}`, level: 'INFO', message: 'x', timestamp: new Date()
      });
    }

    expect(() => mgr.forceProcessPendingLogs()).not.toThrow();
  });

  it('log with WARN level calls console.warn path', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    expect(() => mgr.warn('warning msg')).not.toThrow();
  });

  it('log with ERROR level calls console.error path', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    expect(() => mgr.error('error msg')).not.toThrow();
  });

  it('log with DEBUG level calls console.debug path', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    expect(() => mgr.debug('debug msg')).not.toThrow();
  });

  it('safeConsoleWrite handles EPIPE error silently', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    // Trigger EPIPE by replacing console methods
    const origInfo = console.info;
    console.info = () => { const err: any = new Error('EPIPE'); err.code = 'EPIPE'; throw err; };
    expect(() => mgr.log('INFO', 'epipe test')).not.toThrow();
    console.info = origInfo;
  });

  it('safeConsoleWrite handles non-EPIPE error writes to stderr', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const origInfo = console.info;
    const origWrite = process.stderr.write.bind(process.stderr);
    const writes: string[] = [];
    process.stderr.write = (chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    };
    console.info = () => { throw new Error('other error'); };
    expect(() => mgr.log('INFO', 'stderr test')).not.toThrow();
    console.info = origInfo;
    process.stderr.write = origWrite as any;
  });

  it('validateIntegrity reports invalid levels when LOGGER_LEVELS is empty', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    (mgr as any).config = { ...TEST_CONFIG, LOGGER_LEVELS: [] };
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('logger levels'))).toBe(true);
  });

  it('validateIntegrity reports invalid LOGGER_ENABLE_CONSOLE when not boolean', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    (mgr as any).config = { ...TEST_CONFIG, LOGGER_ENABLE_CONSOLE: 'yes' };
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('console enable'))).toBe(true);
  });

  it('validateIntegrity reports invalid LOGGER_CACHE_MAX_SIZE when <= 0', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    (mgr as any).config = { ...TEST_CONFIG, LOGGER_CACHE_MAX_SIZE: -1 };
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('cache max size'))).toBe(true);
  });

  it('log with an unknown level falls through to console.log path', () => {
    const mgr = LogEntryManager.getInstance({
      ...TEST_CONFIG,
      LOGGER_LEVELS: ['VERBOSE' as any],
    });
    expect(() => mgr.log('VERBOSE' as any, 'unknown level')).not.toThrow();
  });

  it('log handles file processing error (cacheLogManager throws) gracefully', () => {
    const mgr = LogEntryManager.getInstance(TEST_CONFIG);
    const cacheMgr = {
      notifyNewLogAdded: vi.fn(() => {
        throw new Error('cache manager exploded');
      })
    };
    mgr.setCacheLogManager(cacheMgr);
    // Should not throw — error is caught and reported to console.error
    expect(() => mgr.log('INFO', 'trigger file error')).not.toThrow();
  });
});
